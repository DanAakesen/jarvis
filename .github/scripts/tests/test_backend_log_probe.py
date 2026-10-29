import copy
import io
import json
import os
import tempfile
import time
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from backend_log_preflight import PreflightBlocked, inspect, private_write
from backend_log_probe_parameters import main as prepare_main
from backend_log_probe_parameters import parameters, read_private
from backend_log_probe_verdicts import CHECKS, lines
from pipeline_impact import deploy_parts
from test_backend_log_preflight import (
    BOOTSTRAP,
    CLIENT,
    CUSTOMER,
    EXPECTED,
    PRINCIPAL,
    SUBSCRIPTION,
    WEB,
    FakeAzure,
)


class PrivateParametersTests(unittest.TestCase):
    def test_consumes_only_valid_current_private_report_without_granting_or_enabling(self):
        report = inspect(EXPECTED, FakeAzure())
        result = parameters(report, EXPECTED)["parameters"]
        self.assertEqual(set(result), {"backendLogProbeWorkspaceId", "backendLogProbePrincipalId",
                                      "backendLogProbeAppName", "backendLogProbeForeignWorkspaceId"})
        self.assertEqual(result["backendLogProbeWorkspaceId"]["value"], CUSTOMER)
        self.assertEqual(result["backendLogProbePrincipalId"]["value"], PRINCIPAL)
        self.assertEqual(result["backendLogProbeForeignWorkspaceId"]["value"], "")
        self.assertNotIn("Enabled", json.dumps(result))
        self.assertEqual(deploy_parts(".github/scripts/backend_log_probe_parameters.py"), {"infra"})

    def test_uses_a_real_reported_foreign_candidate_without_claiming_proof(self):
        report = inspect(EXPECTED, FakeAzure())
        report["negative_workspace_candidates"] = [{"id": "/subscriptions/" + SUBSCRIPTION + "/resourceGroups/synthetic-other/providers/Microsoft.OperationalInsights/workspaces/synthetic-peer",
                                                   "properties": {"customerId": CLIENT}}]
        self.assertEqual(parameters(report, EXPECTED)["parameters"]["backendLogProbeForeignWorkspaceId"]["value"], CLIENT)
        report["negative_workspace_candidates"][0]["properties"]["customerId"] = CUSTOMER
        with self.assertRaises(PreflightBlocked):
            parameters(report, EXPECTED)

    def test_rejects_changed_target_missing_checks_or_wrong_stage(self):
        for patch_value in ({"targets": {}}, {"checks": []}, {"grant_applied": True}, {"reader_enabled": True},
                            {"schema": 2}, {"stage": "synthetic-secret"}):
            with self.subTest(patch_value=patch_value), self.assertRaises(PreflightBlocked):
                parameters({**inspect(EXPECTED, FakeAzure()), **patch_value}, EXPECTED)

    def test_rejects_symlink_stale_and_public_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "report.json"
            private_write(path, {"synthetic-private": CUSTOMER})
            self.assertEqual(read_private(path, time.time()), {"synthetic-private": CUSTOMER})
            path.chmod(0o644)
            with self.assertRaises(PreflightBlocked):
                read_private(path, time.time())
            path.chmod(0o600)
            with self.assertRaises(PreflightBlocked):
                read_private(path, time.time() + 301)
            link = Path(tmp) / "link"
            link.symlink_to(path)
            with self.assertRaises(OSError):
                read_private(link, time.time())

    def test_main_writes_only_private_parameters_and_prints_no_identifiers(self):
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            private_write(root / "backend-log-preflight.private.json", inspect(EXPECTED, FakeAzure()))
            with patch.dict(os.environ, {"RUNNER_TEMP": tmp, "GITHUB_REF": "refs/heads/main", "GITHUB_ACTIONS": "true", "SUBSCRIPTION_ID": SUBSCRIPTION}), \
                    patch("backend_log_probe_parameters.Path.read_text", side_effect=[json.dumps(BOOTSTRAP), json.dumps(WEB)]), \
                    redirect_stdout(output), redirect_stderr(output):
                self.assertEqual(prepare_main(), 0)
            params = root / "backend-log-probe.params.json"
            self.assertEqual(params.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(params.read_text())["parameters"]["backendLogProbeWorkspaceId"]["value"], CUSTOMER)
        for value in (CUSTOMER, PRINCIPAL, SUBSCRIPTION, EXPECTED["app_name"]):
            self.assertNotIn(value, output.getvalue())
        self.assertIn("no grant or reader enablement performed", output.getvalue())


class FixedVerdictTests(unittest.TestCase):
    def sample(self):
        return {"backendLogAuthorization": {"stage": "authorization_observations", "checkedAt": "2026-10-29T06:00:00.000Z",
                                           "identity": "matched", "checks": dict.fromkeys(CHECKS, "denied")}}

    def test_prints_only_fixed_verdicts_and_never_claims_isolation_or_activation(self):
        report = self.sample()
        report["backendLogAuthorization"]["checks"]["other_app"] = "no_visible_rows"
        text = "\n".join(lines(report))
        self.assertIn("empty negatives are not isolation proof", text)
        self.assertIn("no activation is performed here", text)
        self.assertIn("other_app: no_visible_rows", text)
        self.assertIn("not_configured", " ".join(lines({})))

    def test_rejects_untrusted_provider_text_keys_dates_and_status_values(self):
        base = self.sample()
        variants = []
        item = copy.deepcopy(base); item["backendLogAuthorization"]["providerText"] = "synthetic-secret"; variants.append(item)
        item = copy.deepcopy(base); item["backendLogAuthorization"]["checkedAt"] = "synthetic-secret"; variants.append(item)
        item = copy.deepcopy(base); item["backendLogAuthorization"]["checks"]["other_app"] = "synthetic-secret"; variants.append(item)
        item = copy.deepcopy(base); item["backendLogAuthorization"]["checks"]["other_app"] = ["denied"]; variants.append(item)
        item = copy.deepcopy(base); item["backendLogAuthorization"]["checks"]["caller_query"] = "denied"; variants.append(item)
        for item in variants:
            with self.assertRaises((ValueError, TypeError)):
                lines(item)

    def test_private_report_parameters_and_observation_inputs_are_not_artifacts(self):
        workflow = Path(".github/workflows/deploy.yml").read_text()
        self.assertNotIn("backend-log-preflight.private.json", workflow)
        self.assertNotIn("backend-log-probe.params.json", workflow)
        self.assertIn('python .github/scripts/backend_log_probe_verdicts.py "$response"', workflow)
        self.assertLess(workflow.index('python .github/scripts/smoke_reasons.py "$response" --evidence'),
                        workflow.index('if ! python .github/scripts/backend_log_probe_verdicts.py'))
        self.assertIn('python .github/scripts/backend_log_probe_parameters.py', Path(".github/scripts/deploy_bicep.sh").read_text())
        self.assertNotIn('JARVIS_BACKEND_LOGS_ENABLED', Path("infra/main.bicep").read_text())
