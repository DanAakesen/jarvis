import copy
import io
import json
import stat
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

import provision_managed_chat as script

MANIFEST = {"instructions": "{{jarvis_policy}}", "tools": [
    {"type": "function", "name": "synthetic_b", "strict": False, "parameters": {"type": "object", "properties": {}}},
    {"type": "function", "name": "synthetic_a", "description": "Synthetic", "strict": False,
     "parameters": {"type": "object", "properties": {"text": {"type": "string"}}}},
]}


class FakeAzure:
    def __init__(self, existing=False):
        self.endpoint = script.PROJECT_ENDPOINT
        self.project_id = script.PROJECT_ID
        self.existing = existing
        self.calls = []
        self.selector = None
        self.version = {"name": script.AGENT_NAME, "version": "1", "status": "active", "metadata": script.MARKER,
                        "definition": script.definition(MANIFEST)}
        self.identity = {"principal_id": "11111111-2222-4333-8444-555555555555", "status": "active"}
        self.agent_state = "enabled"
        self.extra_versions = False
        self.fail_create = False

    def request(self, method, url, body=None):
        self.calls.append((method, url, body))
        if "/deployments/" in url:
            return {"properties": {"provisioningState": "Succeeded", "model": {"name": script.MODEL}}}
        target = self.project_id if "/projects/" in url else self.project_id.rsplit("/projects/", 1)[0]
        return {"id": target, "location": "swedencentral"}

    def inventory(self, path):
        self.calls.append(("GET", path, None))
        if path == "/agents":
            return [{"name": script.AGENT_NAME}] if self.existing else []
        return [self.version, self.version] if self.extra_versions else [self.version]

    def data(self, path, method="GET", body=None):
        self.calls.append((method, path, body))
        if method == "POST":
            assert path == "/agents", "A new agent uses the agent-creation route"
            assert body["name"] == script.AGENT_NAME
            if self.fail_create:
                raise script.Blocked("azure_request_failed")
            self.existing = True
            return {}
        if method == "PATCH":
            self.selector = body["agent_endpoint"]["version_selector"]
            return {}
        if "/versions/" in path:
            return copy.deepcopy(self.version)
        return {"name": script.AGENT_NAME, "state": self.agent_state, "instance_identity": self.identity,
                "agent_endpoint": {"version_selector": self.selector}}


class VersionedAzure(FakeAzure):
    def __init__(self):
        super().__init__(existing=True)
        self.versions = [copy.deepcopy(self.version)]
        self.versions[0]["definition"]["instructions"] = "Previous reviewed synthetic instructions"
        self.selector = {"version_selection_rules": [{"type": "FixedRatio", "agent_version": "1", "traffic_percentage": 100}]}

    def inventory(self, path):
        if "/versions" in path:
            self.calls.append(("GET", path, None))
            return copy.deepcopy(self.versions)
        return super().inventory(path)

    def data(self, path, method="GET", body=None):
        if method == "POST":
            # SDK create_version takes the agent name in the URL, not the body.
            assert path == "/agents/" + script.AGENT_NAME + "/versions"
            assert set(body) == {"metadata", "definition"}
            self.calls.append((method, path, body))
            self.versions.append({**copy.deepcopy(self.version), "version": str(len(self.versions) + 1),
                                  "definition": copy.deepcopy(body["definition"])})
            if self.fail_create:
                raise script.Blocked("azure_request_failed")
            return {}
        if "/versions/" in path:
            self.calls.append((method, path, body))
            return copy.deepcopy(next(value for value in self.versions if value["version"] == path.rsplit("/", 1)[1]))
        return super().data(path, method, body)


class ProvisionTests(unittest.TestCase):
    def test_inspection_reads_missing_drifted_and_exact_versions_without_writes(self):
        expected = script.definition(MANIFEST)
        missing = FakeAzure()
        self.assertEqual(script.inspect_comparison(missing, expected), {
            "state": "missing", "version_count": 0, "matching_version_count": 0, "pin": "absent"})
        azure = VersionedAzure()
        self.assertEqual(script.inspect_comparison(azure, expected), {
            "state": "present", "version_count": 1, "matching_version_count": 0, "pin": "other_version"})
        azure.versions[0]["definition"] = expected
        self.assertEqual(script.inspect_comparison(azure, expected), {
            "state": "present", "version_count": 1, "matching_version_count": 1, "pin": "matching"})
        self.assertTrue(all(call[0] == "GET" for call in missing.calls + azure.calls))

    def test_inspection_after_uncertain_create_identifies_match_without_repinning(self):
        azure = VersionedAzure()
        azure.fail_create = True
        expected = script.definition(MANIFEST)
        with self.assertRaises(script.Blocked):
            script.provision(azure, expected, refresh_definition=True)
        azure.calls.clear()
        self.assertEqual(script.inspect_comparison(azure, expected), {
            "state": "present", "version_count": 2, "matching_version_count": 1, "pin": "other_version"})
        self.assertTrue(all(call[0] == "GET" for call in azure.calls))
        self.assertEqual(azure.selector["version_selection_rules"][0]["agent_version"], "1")

    def test_inspection_rejects_ambiguous_or_unowned_versions_without_writes(self):
        for change in ["ambiguous", "unowned", "pin"]:
            azure = VersionedAzure()
            if change == "ambiguous":
                azure.versions = [copy.deepcopy(azure.version), {**copy.deepcopy(azure.version), "version": "2"}]
            elif change == "unowned":
                azure.versions[0]["metadata"] = {}
            else:
                azure.selector["version_selection_rules"][0]["agent_version"] = "unknown"
            with self.subTest(change=change), self.assertRaises(script.Blocked):
                script.inspect_comparison(azure, script.definition(MANIFEST))
            self.assertTrue(all(call[0] == "GET" for call in azure.calls))

    def test_refresh_is_explicit_preserves_old_version_and_reuses_exact_new_match(self):
        azure = VersionedAzure()
        expected = script.definition(MANIFEST)
        with self.assertRaisesRegex(script.Blocked, "^agent_definition_mismatch$"):
            script.provision(azure, expected)
        self.assertFalse(any(call[0] != "GET" for call in azure.calls))
        original = copy.deepcopy(azure.versions[0])
        activation = script.provision(azure, expected, refresh_definition=True)
        self.assertEqual(activation["version"], "2")
        self.assertEqual(azure.versions[0], original)
        writes = [call for call in azure.calls if call[0] != "GET"]
        self.assertEqual([call[0] for call in writes], ["POST", "PATCH"])
        self.assertEqual(writes[0], ("POST", "/agents/" + script.AGENT_NAME + "/versions",
                                     {"metadata": script.MARKER, "definition": expected}))
        azure.calls.clear()
        self.assertEqual(script.provision(azure, expected), activation)
        self.assertFalse(any(call[0] != "GET" for call in azure.calls))

    def test_uncertain_create_is_not_retried_and_later_run_discovers_exact_match(self):
        azure = VersionedAzure()
        azure.fail_create = True
        expected = script.definition(MANIFEST)
        with self.assertRaisesRegex(script.Blocked, "^azure_request_failed$"):
            script.provision(azure, expected, refresh_definition=True)
        self.assertEqual([call for call in azure.calls if call[0] != "GET"], [
            ("POST", "/agents/" + script.AGENT_NAME + "/versions", {"metadata": script.MARKER, "definition": expected})])
        self.assertEqual(azure.selector["version_selection_rules"][0]["agent_version"], "1")
        azure.calls.clear()
        self.assertEqual(script.provision(azure, expected, refresh_definition=True)["version"], "2")
        self.assertEqual([call[0] for call in azure.calls if call[0] != "GET"], ["PATCH"])

    def test_refresh_rejects_ambiguous_matches_unowned_versions_and_unknown_pin(self):
        for change in ["ambiguous", "unowned", "pin"]:
            with self.subTest(change=change):
                azure = VersionedAzure()
                if change == "ambiguous":
                    azure.versions = [copy.deepcopy(azure.version), {**copy.deepcopy(azure.version), "version": "2"}]
                elif change == "unowned":
                    azure.versions[0]["metadata"] = {}
                else:
                    azure.selector["version_selection_rules"][0]["agent_version"] = "unreviewed"
                with self.assertRaises(script.Blocked):
                    script.provision(azure, script.definition(MANIFEST), refresh_definition=True)
                self.assertFalse(any(call[0] != "GET" for call in azure.calls))

    def test_creates_one_version_pins_only_new_name_and_reuses_without_mutation(self):
        azure = FakeAzure()
        first = script.provision(azure, script.definition(MANIFEST))
        self.assertEqual(set(first), {"projectEndpoint", "agentName", "version", "fingerprint"})
        self.assertRegex(first["fingerprint"], "^[0-9a-f]{64}$")
        writes = [item for item in azure.calls if item[0] != "GET"]
        self.assertEqual([item[0] for item in writes], ["POST", "PATCH"])
        self.assertEqual(writes[0], ("POST", "/agents", {"name": script.AGENT_NAME,
                                                       "metadata": script.MARKER, "definition": script.definition(MANIFEST)}))
        self.assertEqual(writes[1][1], "/agents/" + script.AGENT_NAME)
        self.assertEqual(azure.selector["version_selection_rules"], [
            {"type": "FixedRatio", "agent_version": "1", "traffic_percentage": 100}])
        azure.calls.clear()
        self.assertEqual(script.provision(azure, script.definition(MANIFEST)), first)
        self.assertFalse(any(item[0] != "GET" for item in azure.calls))

    def test_existing_name_ambiguity_or_definition_mismatch_never_writes(self):
        for change in ["metadata", "extra_versions", "model", "builtins", "identity"]:
            with self.subTest(change=change):
                azure = FakeAzure(existing=True)
                if change == "metadata":
                    azure.version["metadata"] = {}
                elif change == "extra_versions":
                    azure.extra_versions = True
                elif change == "model":
                    azure.version["definition"]["model"] = "other"
                elif change == "builtins":
                    azure.version["definition"]["tools"][0]["default_config"]["enabled"] = True
                else:
                    azure.identity = {}
                with self.assertRaises(script.Blocked):
                    script.provision(azure, script.definition(MANIFEST))
                self.assertFalse(any(item[0] != "GET" for item in azure.calls))

    def test_optional_identity_status_reuses_existing_exact_version(self):
        for status in ["omitted", None, "active"]:
            with self.subTest(status=status):
                azure = FakeAzure(existing=True)
                if status == "omitted":
                    del azure.identity["status"]
                else:
                    azure.identity["status"] = status
                activation = script.provision(azure, script.definition(MANIFEST))
                self.assertEqual(activation["version"], "1")
                self.assertEqual([call[0] for call in azure.calls if call[0] != "GET"], ["PATCH"])
                azure.calls.clear()
                self.assertEqual(script.provision(azure, script.definition(MANIFEST)), activation)
                self.assertFalse(any(call[0] != "GET" for call in azure.calls))

    def test_disabled_unknown_or_invalid_identity_stops_before_pinning(self):
        for state, status, principal, reason in [
            ("disabled", "active", "11111111-2222-4333-8444-555555555555", "agent_state_not_enabled"),
            (None, "active", "11111111-2222-4333-8444-555555555555", "agent_state_not_enabled"),
            ("enabled", "disabled", "11111111-2222-4333-8444-555555555555", "agent_identity_not_active"),
            ("enabled", "unknown", "11111111-2222-4333-8444-555555555555", "agent_identity_not_active"),
            ("enabled", None, "private-invalid-principal", "agent_principal_unverified"),
            ("enabled", None, None, "agent_principal_unverified"),
        ]:
            with self.subTest(state=state, status=status, principal=principal):
                azure = FakeAzure(existing=True)
                azure.agent_state = state
                azure.identity = {"status": status, "principal_id": principal}
                with self.assertRaisesRegex(script.Blocked, "^" + reason + "$"):
                    script.provision(azure, script.definition(MANIFEST))
                self.assertFalse(any(call[0] != "GET" for call in azure.calls))

    def test_identity_status_population_keeps_same_principal_but_substitution_is_rejected(self):
        for replace in [False, True]:
            with self.subTest(replace=replace):
                azure = FakeAzure(existing=True)
                del azure.identity["status"]
                data = azure.data
                def update(path, method="GET", body=None, *, data=data, azure=azure, replace=replace):
                    result = data(path, method, body)
                    if method == "PATCH":
                        azure.identity = {**azure.identity, "status": "active"}
                        if replace:
                            azure.identity["principal_id"] = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
                    return result
                azure.data = update
                if replace:
                    with self.assertRaisesRegex(script.Blocked, "^agent_endpoint_unverified$"):
                        script.provision(azure, script.definition(MANIFEST))
                else:
                    self.assertEqual(script.provision(azure, script.definition(MANIFEST))["version"], "1")
                self.assertFalse(any(call[0] == "POST" for call in azure.calls))

    def test_uncertain_create_is_not_retried_and_does_not_pin(self):
        azure = FakeAzure()
        azure.fail_create = True
        with self.assertRaises(script.Blocked):
            script.provision(azure, script.definition(MANIFEST))
        self.assertEqual([item[0] for item in azure.calls if item[0] != "GET"], ["POST"])

    def test_manifest_uses_all_exact_functions_and_no_builtin_capabilities(self):
        definition = script.definition(MANIFEST)
        self.assertEqual([item["name"] for item in definition["tools"][1:]], ["synthetic_a", "synthetic_b"])
        self.assertEqual(definition["tools"][0], {"type": "microsoft_copilot_toolset_preview", "default_config": {"enabled": False}})
        for tool in [{"type": "web_search"}, {**MANIFEST["tools"][0], "strict": True},
                     {**MANIFEST["tools"][0], "name": "bad___tool"}]:
            with self.assertRaises(script.Blocked):
                script.definition({**MANIFEST, "tools": [tool]})
        with self.assertRaises(script.Blocked):
            script.definition({**MANIFEST, "tools": [MANIFEST["tools"][0]] * 2})

    def test_region_or_deployment_mismatch_stops_before_data_plane(self):
        for region in ["westus", None]:
            azure = FakeAzure()
            azure.request = lambda *args, region=region: {"id": script.PROJECT_ID, "location": region}
            with self.assertRaises(script.Blocked):
                script.provision(azure, script.definition(MANIFEST))
            self.assertEqual(azure.calls, [])
        with self.assertRaises(script.Blocked):
            script.validate_target("https://foreign.example/api/projects/other", script.PROJECT_ID)

    def test_cli_holds_bodies_privately_and_sanitizes_errors(self):
        azure = script.Azure(script.PROJECT_ENDPOINT, script.PROJECT_ID)
        def run(command, **kwargs):
            self.assertNotIn(MANIFEST["instructions"], " ".join(command))
            path = Path(command[command.index("--body") + 1][1:])
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(json.loads(path.read_text()), MANIFEST)
            self.assertIn("Foundry-Features=MicrosoftCopilot=V1Preview", command)
            return subprocess.CompletedProcess(command, 1, b"secret-provider-body", b"secret-token")
        with patch.object(script.subprocess, "run", side_effect=run), self.assertRaisesRegex(script.Blocked, "^azure_request_failed$"):
            azure.data("/agents", "POST", MANIFEST)

    def test_failed_requests_identify_only_fixed_operation_method_and_known_cause(self):
        account = "https://management.azure.com" + script.PROJECT_ID.rsplit("/projects/", 1)[0]
        data = script.PROJECT_ENDPOINT + "/agents"
        cases = [("GET", account, "account_read"),
                 ("GET", "https://management.azure.com" + script.PROJECT_ID, "project_read"),
                 ("GET", account + "/deployments/" + script.MODEL, "model_deployment_read"),
                 ("GET", data + "?cursor=PRIVATE", "agent_inventory"),
                 ("GET", data + "/" + script.AGENT_NAME, "agent_read"),
                 ("GET", data + "/" + script.AGENT_NAME + "/versions", "version_inventory"),
                 ("GET", data + "/" + script.AGENT_NAME + "/versions/PRIVATE", "version_read"),
                 ("POST", data, "agent_create"),
                 ("POST", data + "/" + script.AGENT_NAME + "/versions", "agent_version_create"),
                 ("PATCH", data + "/" + script.AGENT_NAME, "endpoint_pin")]
        error = b'ERROR: Forbidden({"error":{"code":"AuthorizationFailed","message":"PRIVATE token"}})'
        for method, url, operation in cases:
            azure = script.Azure(script.PROJECT_ENDPOINT, script.PROJECT_ID)
            with self.subTest(operation=operation), patch.object(script.subprocess, "run", return_value=(
                subprocess.CompletedProcess([], 1, b"PRIVATE response", error)
            )) as run, self.assertRaises(script.Blocked) as caught:
                azure.request(method, url, MANIFEST if method != "GET" else None)
            run.assert_called_once()
            self.assertEqual(str(caught.exception), "azure_request_failed")
            self.assertEqual(caught.exception.diagnostic, f"managed_chat_azure_diagnostic operation={operation} method={method}"
                             + f" mutation_attempted={str(method != 'GET').lower()} http_status=403 azure_code=AuthorizationFailed")
            self.assertNotIn("PRIVATE", caught.exception.diagnostic)

    def test_cli_error_metadata_ignores_messages_unknown_codes_and_malformed_values(self):
        cases = [(b'ERROR: Bad Request({"error":{"code":"InvalidArgument","message":"PRIVATE"}})',
                  {"http_status": 400, "azure_code": "InvalidArgument"}),
                 (b'ERROR: (AuthorizationFailed) PRIVATE client/scope/token', {"azure_code": "AuthorizationFailed"}),
                 (b'{"error":{"code":"Forbidden","message":"PRIVATE"}}', {"azure_code": "Forbidden"}),
                 (b'ERROR: Forbidden({"error":{"code":"PRIVATE_SECRET","message":"secret"}})', {"http_status": 403}),
                 (b'ERROR: Bad Request({"error":{"code":"Forbidden\\n::error::PRIVATE"}})', {"http_status": 400}),
                 (b'ERROR: Bad Request({invalid PRIVATE)', {"http_status": 400}),
                 (b'{"error":{"code":["Forbidden"],"message":"PRIVATE"}}', {}),
                 (b'{"error":true}', {}), (b'PRIVATE AuthorizationFailed status:403', {}),
                 (b'\xff', {}), (b'ERROR: Forbidden(' + b'X' * 65536 + b')', {})]
        for raw, expected in cases:
            with self.subTest(raw=raw[:60]):
                self.assertEqual(script.azure_error_metadata(raw), expected)

    def test_failed_readback_records_prior_mutation_and_never_retries(self):
        azure = script.Azure(script.PROJECT_ENDPOINT, script.PROJECT_ID)
        with patch.object(script.subprocess, "run", side_effect=[
            subprocess.CompletedProcess([], 0, b'{}', b''),
            subprocess.CompletedProcess([], 1, b'', b'ERROR: Not Found({"error":{"code":"NotFound"}})'),
        ]) as run:
            azure.data("/agents", "POST", MANIFEST)
            with self.assertRaises(script.Blocked) as caught:
                azure.data("/agents/" + script.AGENT_NAME)
        self.assertEqual(run.call_count, 2)
        self.assertIn("operation=agent_read method=GET mutation_attempted=true", caught.exception.diagnostic)

    def test_timeout_metadata_is_content_free_and_inspection_rejects_any_write(self):
        for method in ["GET", "POST"]:
            azure = script.Azure(script.PROJECT_ENDPOINT, script.PROJECT_ID)
            with patch.object(script.subprocess, "run", side_effect=subprocess.TimeoutExpired(
                ["PRIVATE"], 30, output=b"PRIVATE", stderr=b"PRIVATE"
            )) as run, self.assertRaises(script.Blocked) as caught:
                azure.data("/agents", method, MANIFEST if method == "POST" else None)
            run.assert_called_once()
            self.assertEqual(str(caught.exception), "azure_request_unavailable")
            self.assertNotIn("PRIVATE", caught.exception.diagnostic)
            self.assertIn("mutation_attempted=" + str(method == "POST").lower(), caught.exception.diagnostic)
        for method in ["POST", "PATCH"]:
            azure = script.Azure(script.PROJECT_ENDPOINT, script.PROJECT_ID, read_only=True)
            with patch.object(script.subprocess, "run") as run, self.assertRaisesRegex(
                script.Blocked, "^inspection_write_forbidden$"
            ):
                azure.data("/agents", method, MANIFEST)
            run.assert_not_called()

    def test_inspection_entrypoint_creates_no_activation_and_rejects_refresh(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest, output = Path(directory) / "manifest.json", Path(directory) / "activation.json"
            manifest.write_text(json.dumps(MANIFEST))
            args = ["--project-id", script.PROJECT_ID, "--project-endpoint", script.PROJECT_ENDPOINT,
                    "--manifest", str(manifest), "--output", str(output), "--inspect"]
            stdout = io.StringIO()
            with patch.object(script, "Azure", return_value=VersionedAzure()) as azure, \
                 patch.object(script, "provision") as apply, redirect_stdout(stdout):
                self.assertEqual(script.main(args), 0)
                azure.assert_called_once_with(script.PROJECT_ENDPOINT, script.PROJECT_ID, read_only=True)
                apply.assert_not_called()
            self.assertIn('managed_chat_inspection_ok {"matching_version_count":0', stdout.getvalue())
            self.assertFalse(output.exists())
            with patch.object(script, "Azure") as azure, redirect_stderr(io.StringIO()):
                self.assertEqual(script.main([*args, "--refresh-definition"]), 1)
                azure.assert_not_called()

    def test_failed_cli_entrypoint_prints_bounded_diagnostic_and_no_activation(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest, output = Path(directory) / "manifest.json", Path(directory) / "activation.json"
            manifest.write_text(json.dumps(MANIFEST))
            args = ["--project-id", script.PROJECT_ID, "--project-endpoint", script.PROJECT_ENDPOINT,
                    "--manifest", str(manifest), "--output", str(output), "--inspect"]
            stderr = io.StringIO()
            with patch.object(script.subprocess, "run", return_value=subprocess.CompletedProcess(
                [], 1, b'PRIVATE', b'ERROR: Forbidden({"error":{"code":"AuthorizationFailed","message":"PRIVATE"}})'
            )) as run, redirect_stderr(stderr):
                self.assertEqual(script.main(args), 1)
            run.assert_called_once()
            self.assertEqual(stderr.getvalue(), "managed_chat_azure_diagnostic operation=account_read method=GET"
                             " mutation_attempted=false http_status=403 azure_code=AuthorizationFailed\nazure_request_failed\n")
            self.assertFalse(output.exists())

    def test_inventory_follows_only_same_project_pages_and_refuses_incomplete_results(self):
        azure = script.Azure(script.PROJECT_ENDPOINT, script.PROJECT_ID)
        next_url = script.PROJECT_ENDPOINT + "/agents?api-version=v1&cursor=synthetic"
        with patch.object(azure, "request", side_effect=[{"data": [{"name": "a"}], "nextLink": next_url}, {"data": [{"name": "b"}]}]):
            self.assertEqual(azure.inventory("/agents"), [{"name": "a"}, {"name": "b"}])
        with patch.object(azure, "request", return_value={"data": [], "nextLink": "https://foreign.example/agents"}), self.assertRaisesRegex(script.Blocked, "inventory_invalid"):
            azure.inventory("/agents")
        with patch.object(azure, "request", return_value={"data": [], "nextLink": next_url}), self.assertRaisesRegex(script.Blocked, "inventory_incomplete"):
            azure.inventory("/agents")

    def test_failed_or_incomplete_activation_never_pins(self):
        for state in ["failed", "creating"]:
            azure = FakeAzure(existing=True)
            azure.version["status"] = state
            with patch.object(script.time, "sleep"), self.assertRaises(script.Blocked):
                script.provision(azure, script.definition(MANIFEST))
            self.assertFalse(any(item[0] != "GET" for item in azure.calls))

    def test_apply_saves_only_activation_and_never_prints_provider_error_content(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest, output = Path(directory) / "manifest.json", Path(directory) / "activation.json"
            manifest.write_text(json.dumps(MANIFEST))
            args = ["--project-id", script.PROJECT_ID, "--project-endpoint", script.PROJECT_ENDPOINT,
                    "--manifest", str(manifest), "--output", str(output), "--apply"]
            stdout, stderr = io.StringIO(), io.StringIO()
            with patch.object(script, "provision", side_effect=RuntimeError("private-provider-body token")), redirect_stdout(stdout), redirect_stderr(stderr):
                self.assertEqual(script.main(args), 1)
            self.assertEqual(stderr.getvalue(), "managed_chat_provisioning_unavailable\n")
            self.assertFalse(output.exists())
            activation = {"projectEndpoint": script.PROJECT_ENDPOINT, "agentName": script.AGENT_NAME,
                          "version": "1", "fingerprint": "a" * 64}
            with patch.object(script, "provision", return_value=activation), redirect_stdout(stdout):
                self.assertEqual(script.main(args), 0)
            self.assertEqual(json.loads(output.read_text()), activation)
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
            self.assertNotIn("private", stdout.getvalue())

    def test_dry_validation_does_not_call_azure_and_output_is_private_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest, output = Path(directory) / "manifest.json", Path(directory) / "activation.json"
            manifest.write_text(json.dumps(MANIFEST))
            stdout, stderr = io.StringIO(), io.StringIO()
            args = ["--project-id", script.PROJECT_ID, "--project-endpoint", script.PROJECT_ENDPOINT,
                    "--manifest", str(manifest), "--output", str(output)]
            with patch.object(script, "provision") as provision, redirect_stdout(stdout), redirect_stderr(stderr):
                self.assertEqual(script.main(args), 0)
                provision.assert_not_called()
            self.assertEqual(stdout.getvalue(), "managed_chat_manifest_validated\n")
            self.assertFalse(output.exists())
            script.private_write(output, {"fingerprint": "a" * 64})
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
            with self.assertRaises(FileExistsError):
                script.private_write(output, {})
            with redirect_stderr(io.StringIO()):
                self.assertEqual(script.main([*args, "--apply"]), 1)


if __name__ == "__main__":
    unittest.main()
