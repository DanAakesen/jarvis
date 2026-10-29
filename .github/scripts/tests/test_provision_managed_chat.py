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

MANIFEST = {"instructions": "Synthetic private instruction æ", "tools": [
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
            if self.fail_create:
                raise script.Blocked("azure_request_failed")
            self.existing = True
            return {}
        if method == "PATCH":
            self.selector = body["agent_endpoint"]["version_selector"]
            return {}
        if "/versions/" in path:
            return copy.deepcopy(self.version)
        return {"name": script.AGENT_NAME, "state": "enabled", "instance_identity": self.identity,
                "agent_endpoint": {"version_selector": self.selector}}


class ProvisionTests(unittest.TestCase):
    def test_creates_one_version_pins_only_new_name_and_reuses_without_mutation(self):
        azure = FakeAzure()
        first = script.provision(azure, script.definition(MANIFEST))
        self.assertEqual(set(first), {"projectEndpoint", "agentName", "version", "fingerprint"})
        self.assertRegex(first["fingerprint"], "^[0-9a-f]{64}$")
        writes = [item for item in azure.calls if item[0] != "GET"]
        self.assertEqual([item[0] for item in writes], ["POST", "PATCH"])
        self.assertEqual(writes[0][2]["name"], script.AGENT_NAME)
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
