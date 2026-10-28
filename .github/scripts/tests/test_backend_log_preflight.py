import io
import json
import os
import stat
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from backend_log_preflight import (
    ACTIONS,
    DATA_ACTIONS,
    DATA_READER,
    MAX_BYTES,
    Azure,
    PreflightBlocked,
    inspect,
    inventory_findings,
    main,
    private_write,
    targets,
)
from pipeline_impact import deploy_parts

SUBSCRIPTION = "11111111-1111-4111-8111-111111111111"
TENANT = "22222222-2222-4222-8222-222222222222"
PRINCIPAL = "33333333-3333-4333-8333-333333333333"
CLIENT = "44444444-4444-4444-8444-444444444444"
CUSTOMER = "55555555-5555-4555-8555-555555555555"
GROUP = f"/subscriptions/{SUBSCRIPTION}/resourceGroups/rg-jarvis"
IDENTITY = GROUP + "/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-jarvis-backend"
BOOTSTRAP = {"subscriptionId": SUBSCRIPTION, "tenantId": TENANT, "resourceGroup": "rg-jarvis",
             "backendIdentity": {"resourceId": IDENTITY, "principalId": PRINCIPAL, "clientId": CLIENT}}
WEB = {"backendUrl": "https://ca-jarvis-backend-aaaaaaaaaaaaa.synthetic.swedencentral.azurecontainerapps.io"}
EXPECTED = targets(BOOTSTRAP, WEB)


class FakeAzure:
    def __init__(self):
        self.calls = []
        self.identity = {"id": IDENTITY, "principalId": PRINCIPAL, "clientId": CLIENT, "tenantId": TENANT}
        self.app = {"id": EXPECTED["app_id"], "identities": {IDENTITY: {}}, "clientId": CLIENT}
        self.workspace = {"id": EXPECTED["workspace_id"], "customerId": CUSTOMER, "retention": 30,
                          "features": {"enableLogAccessUsingOnlyResourcePermissions": True}}
        self.table = {"id": EXPECTED["workspace_id"] + "/tables/ContainerAppConsoleLogs_CL", "plan": "Analytics",
                      "schema": {"columns": [{"name": "ContainerAppName_s", "type": "string"}, {"name": "Log_s", "type": "string"}],
                                 "standardColumns": [{"name": "TimeGenerated", "type": "datetime"}]}}
        self.role = {"name": DATA_READER, "properties": {"type": "BuiltInRole", "permissions": [
            {"actions": list(ACTIONS), "dataActions": list(DATA_ACTIONS), "notActions": [], "notDataActions": []}]}}
        self.assignments = [{"id": "synthetic-role-assignment", "properties": {"principalId": PRINCIPAL, "scope": GROUP, "principalType": "ServicePrincipal",
            "roleDefinitionId": GROUP + "/providers/Microsoft.Authorization/roleDefinitions/" + DATA_READER}}]
        self.peers = []

    def get(self, resource, version, query=None):
        self.calls.append((resource, version, query))
        if resource == IDENTITY:
            return self.identity
        if resource == EXPECTED["app_id"]:
            return self.app
        if resource == EXPECTED["workspace_id"]:
            return self.workspace
        if resource.endswith("/tables/ContainerAppConsoleLogs_CL"):
            return self.table
        if resource.endswith("/roleDefinitions/" + DATA_READER):
            return self.role
        raise AssertionError("Unexpected synthetic read")

    def pages(self, resource, version, parameters=None):
        self.calls.append((resource, version, parameters))
        return self.peers if resource.endswith("/workspaces") else self.assignments


class MetadataTests(unittest.TestCase):
    def test_reads_live_identity_workspace_schema_role_and_inventory_without_claiming_enforcement(self):
        azure = FakeAzure()
        result = inspect(EXPECTED, azure)
        self.assertEqual(result["workspace"]["customerId"], CUSTOMER)
        self.assertIn("live_identity_matches", result["checks"])
        self.assertIn("runtime_identity_matches", result["checks"])
        self.assertIn("role_inventory_read", result["checks"])
        self.assertIn("negative_workspace_candidate_missing", result["checks"])
        self.assertEqual(result["stage"], "metadata_only")
        for key in ("grant_applied", "reader_enabled", "provider_enforcement_verified", "effective_group_memberships_verified"):
            self.assertFalse(result[key])
        self.assertEqual(len(azure.calls), 8)
        self.assertNotIn("sharedKey", json.dumps(azure.calls))
        self.assertNotIn("Log_s", json.dumps(azure.calls))  # Schema is read; log content is never queried.

    def test_detects_recreated_identity_and_runtime_client_mismatch(self):
        for obj, key in (("identity", "principalId"), ("identity", "clientId"), ("identity", "tenantId"), ("app", "clientId")):
            with self.subTest(obj=obj, key=key):
                azure = FakeAzure()
                getattr(azure, obj)[key] = CUSTOMER
                with self.assertRaisesRegex(PreflightBlocked, "identity_mismatch"):
                    inspect(EXPECTED, azure)
        azure = FakeAzure()
        azure.app["identities"] = {}
        with self.assertRaisesRegex(PreflightBlocked, "runtime_identity_mismatch"):
            inspect(EXPECTED, azure)

    def test_rejects_wrong_workspace_missing_customer_id_unknown_mode_or_changed_retention(self):
        for key, value, reason in (("id", IDENTITY, "live_workspace_mismatch"), ("customerId", "not-a-guid", "live_workspace_mismatch"),
                                   ("features", {}, "access_mode_unavailable"), ("retention", 90, "retention_requires_review")):
            with self.subTest(key=key):
                azure = FakeAzure()
                azure.workspace[key] = value
                with self.assertRaisesRegex(PreflightBlocked, reason):
                    inspect(EXPECTED, azure)

    def test_rejects_unavailable_or_changed_console_schema(self):
        for mutate in (lambda t: t.update(plan="Basic"), lambda t: t["schema"].update(columns=[]),
                       lambda t: t["schema"]["columns"][0].update(type="dynamic")):
            azure = FakeAzure()
            mutate(azure.table)
            with self.assertRaisesRegex(PreflightBlocked, "console_(table_unavailable|schema_mismatch)"):
                inspect(EXPECTED, azure)

    def test_requires_arm_role_type_not_cli_role_type_or_custom_role(self):
        # az rest returns the ARM wire shape (properties.type), not the CLI model's roleType.
        for properties in ({"roleType": "BuiltInRole"}, {"type": "CustomRole"},
                           {"type": None, "roleType": "BuiltInRole"}):
            with self.subTest(properties=properties):
                azure = FakeAzure()
                azure.role["properties"] = {**properties, "permissions": azure.role["properties"]["permissions"]}
                with self.assertRaisesRegex(PreflightBlocked, "builtin_role_mismatch"):
                    inspect(EXPECTED, azure)

    def test_rejects_broader_builtin_permissions(self):
        for key, value in (("actions", ["*/read"]), ("dataActions", list(DATA_ACTIONS) + ["Microsoft.OperationalInsights/workspaces/jobs/export/action"]),
                           ("notActions", ["arbitrary"]), ("actions", None)):
            azure = FakeAzure()
            azure.role["properties"]["permissions"][0][key] = value
            with self.assertRaisesRegex(PreflightBlocked, "builtin_role_mismatch"):
                inspect(EXPECTED, azure)

    def test_inventory_flags_direct_and_unknown_group_log_grants_without_claiming_membership(self):
        expected = EXPECTED
        reader = {"properties": {"permissions": [{"actions": ["*/read"], "notActions": [], "dataActions": [], "notDataActions": []}]}}
        assignment = {"properties": {"principalId": PRINCIPAL, "principalType": "ServicePrincipal", "scope": GROUP,
            "roleDefinitionId": GROUP + "/providers/Microsoft.Authorization/roleDefinitions/" + DATA_READER}}
        self.assertEqual(inventory_findings(expected, [assignment], True, lambda _: reader), ["existing_workspace_log_grant_requires_review"])
        assignment["properties"].update(principalId=CLIENT, principalType="Group")
        self.assertEqual(inventory_findings(expected, [assignment], True, lambda _: reader), ["potential_group_log_grant_membership_unverified"])
        assignment["properties"].update(principalId=PRINCIPAL, principalType="ServicePrincipal", scope=GROUP + "/providers/Microsoft.CognitiveServices/accounts/synthetic")
        self.assertEqual(inventory_findings(expected, [assignment], True, lambda _: reader), ["existing_resource_log_grant_requires_review"])
        self.assertEqual(inventory_findings(expected, [assignment], False, lambda _: reader), [])
        assignment["properties"]["scope"] = expected["app_id"]
        self.assertEqual(inventory_findings(expected, [assignment], True, lambda _: reader), [])

    def test_foreign_workspace_is_only_a_candidate_not_a_negative_access_proof(self):
        azure = FakeAzure()
        azure.peers = [{"id": EXPECTED["workspace_id"], "properties": {"customerId": CUSTOMER}},
                       {"id": GROUP + "/providers/Microsoft.OperationalInsights/workspaces/synthetic-peer", "properties": {"customerId": CLIENT}}]
        result = inspect(EXPECTED, azure)
        self.assertIn("negative_workspace_candidate_found", result["checks"])
        self.assertEqual(len(result["negative_workspace_candidates"]), 1)
        self.assertFalse(result["provider_enforcement_verified"])

    def test_expected_targets_come_only_from_validated_repository_configuration(self):
        for change in ({"subscriptionId": "synthetic-secret"}, {"resourceGroup": "some-other-group"},
                       {"backendIdentity": {"resourceId": IDENTITY, "principalId": "invalid", "clientId": CLIENT}}):
            with self.assertRaises(PreflightBlocked):
                targets({**BOOTSTRAP, **change}, WEB)
        for url in ("https://evil.invalid", WEB["backendUrl"] + "?secret=value", WEB["backendUrl"].replace("https://", "https://secret@")):
            with self.assertRaises(PreflightBlocked):
                targets(BOOTSTRAP, {"backendUrl": url})

    def test_private_inventory_is_never_uploaded_and_existing_file_permissions_are_restricted(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "backend-log-preflight.private.json"
            path.write_text("old")
            path.chmod(0o666)
            private_write(path, {"synthetic-private-id": CUSTOMER})
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(json.loads(path.read_text())["synthetic-private-id"], CUSTOMER)
            link = Path(tmp) / "symlink"
            link.symlink_to(path)
            with self.assertRaises(OSError):
                private_write(link, {})
        workflow = Path(".github/workflows/deploy.yml").read_text()
        self.assertLess(workflow.index("Read-only backend log activation preflight"), workflow.index("Deploy Bicep, keeping"))
        self.assertNotIn("backend-log-preflight.private.json", workflow)
        self.assertEqual(deploy_parts(".github/scripts/backend_log_preflight.py"), {"infra"})


class TransportTests(unittest.TestCase):
    def test_main_keeps_identifiers_only_in_the_private_report(self):
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {
            "GITHUB_REF": "refs/heads/main", "GITHUB_ACTIONS": "true", "RUNNER_TEMP": tmp, "SUBSCRIPTION_ID": SUBSCRIPTION,
        }), patch("backend_log_preflight.Path.read_text", side_effect=[json.dumps(BOOTSTRAP), json.dumps(WEB)]), \
                patch("backend_log_preflight.Azure", return_value=FakeAzure()), redirect_stdout(output), redirect_stderr(output):
            self.assertEqual(main(), 0)
            report = json.loads((Path(tmp) / "backend-log-preflight.private.json").read_bytes())
            self.assertEqual(report["workspace"]["customerId"], CUSTOMER)
        for identifier in (SUBSCRIPTION, PRINCIPAL, CLIENT, CUSTOMER, EXPECTED["app_name"]):
            self.assertNotIn(identifier, output.getvalue())
        self.assertIn("grant and reader remain off", output.getvalue())

    def test_only_get_is_used_with_fixed_scope_queries_and_bounded_execution(self):
        seen = []
        def run(args, **kwargs):
            seen.append((args, kwargs))
            return subprocess.CompletedProcess(args, 0, b'{"value": []}', b'')
        azure = Azure(SUBSCRIPTION, run=run)
        self.assertEqual(azure.pages(GROUP + "/providers/Microsoft.Authorization/roleAssignments", "2022-04-01"), [])
        args, kwargs = seen[0]
        self.assertEqual(args[args.index("--method") + 1], "get")
        self.assertEqual(args[args.index("--subscription") + 1], SUBSCRIPTION)
        self.assertLessEqual(kwargs["timeout"], 30)
        self.assertNotIn("--debug", args)
        with self.assertRaisesRegex(PreflightBlocked, "unexpected_read_scope"):
            azure.get("/subscriptions/66666666-6666-4666-8666-666666666666/resourceGroups/other", "2022-04-01")

    def test_denials_timeouts_invalid_and_large_responses_are_safe_failures(self):
        def denied(args, **kwargs):
            return subprocess.CompletedProcess(args, 1, b'synthetic-secret', b'AuthorizationFailed synthetic-secret')
        for run, expected in ((denied, "azure_read_unavailable"),
                              (lambda *a, **k: subprocess.CompletedProcess(a, 0, b'{' + b'x' * MAX_BYTES, b''), "metadata_limit"),
                              (lambda *a, **k: subprocess.CompletedProcess(a, 0, b'not-json', b''), "invalid_metadata")):
            with self.assertRaisesRegex(PreflightBlocked, expected) as captured:
                Azure(SUBSCRIPTION, run=run).get(GROUP, "2022-04-01")
            self.assertNotIn("synthetic-secret", str(captured.exception))
        def timed_out(*args, **kwargs):
            raise subprocess.TimeoutExpired("synthetic-secret", 30)
        with self.assertRaisesRegex(PreflightBlocked, "azure_read_unavailable"):
            Azure(SUBSCRIPTION, run=timed_out).get(GROUP, "2022-04-01")

    def test_pagination_rejects_cross_host_cross_scope_and_excessive_results(self):
        for next_link in ("https://evil.invalid/data", f"https://management.azure.com/subscriptions/{SUBSCRIPTION}/other", "http://management.azure.com" + GROUP):
            body = {"value": [], "nextLink": next_link}
            run = lambda *a, body=body, **k: subprocess.CompletedProcess(a, 0, json.dumps(body).encode(), b'')
            with self.assertRaisesRegex(PreflightBlocked, "invalid_inventory_link"):
                Azure(SUBSCRIPTION, run=run).pages(GROUP, "2022-04-01")
        body = json.dumps({"value": [{}] * 1001}).encode()
        with self.assertRaisesRegex(PreflightBlocked, "inventory_limit"):
            Azure(SUBSCRIPTION, run=lambda *a, **k: subprocess.CompletedProcess(a, 0, body, b'')).pages(GROUP, "2022-04-01")

    def test_main_fails_closed_outside_normal_main_without_printing_private_input(self):
        output = io.StringIO()
        with patch.dict(os.environ, {"GITHUB_REF": "refs/pull/1/merge", "GITHUB_ACTIONS": "true", "synthetic-secret": "secret"}), redirect_stdout(output), redirect_stderr(output):
            self.assertEqual(main(), 1)
        self.assertIn("main_oidc_required", output.getvalue())
        self.assertNotIn("synthetic-secret", output.getvalue())


if __name__ == "__main__":
    unittest.main()
