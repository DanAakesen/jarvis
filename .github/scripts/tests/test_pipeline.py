import copy
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from pipeline_evidence import ci_evidence
from hermetic import setUpModule  # noqa: F401
from pipeline_impact import CHECKS, PARTS, require_results, selection, workflow_recipe
from release_state import (
    budget_contacts_match, component_selection, prepare, qualify, record, select,
)
from smoke_reasons import CHECK_IDS, report_ok, safe_report

ROOT = Path(__file__).resolve().parents[3]
CONTEXT = {"schema": 1, "source": "a" * 40, "tree": "b" * 40, "run": 42, "attempt": 1}
INPUTS = dict.fromkeys(PARTS, "c" * 64)
VERSIONS = {
    "infra": {"deployment": "jarvis-infra"},
    "backend": {"image": "fixture.azurecr.io/jarvis-backend@sha256:" + "d" * 64,
                "revision": "backend--0001"},
    "web": {"source": "a" * 40, "bundle": "e" * 64},
    "agent": {"image": "fixture.azurecr.io/jarvis-agent@sha256:" + "f" * 64, "version": "12"},
}
ENV = {
    "GITHUB_RUN_ID": "42", "GITHUB_RUN_ATTEMPT": "1", "GITHUB_SHA": "a" * 40,
    "RELEASE_CONFIGURATION": '{"fixture":"synthetic"}',
}


def previous():
    return {**CONTEXT, "kind": "deployment", "applied_head": CONTEXT["source"],
            "accepted": False, "components": {
        part: {"state": "applied", "fingerprint": INPUTS[part],
               "version": copy.deepcopy(VERSIONS[part]), "origin": CONTEXT.copy(),
               **({"revision_origin": CONTEXT.copy()} if part == "backend" else {})}
        for part in PARTS
    }}


def smoke():
    return {"entries": [{"id": check, "status": "ok"} for check in sorted(CHECK_IDS)]}


class QualificationTests(unittest.TestCase):
    def test_missing_recipe_fails_closed(self):
        for source in ("nothing", "jobs:\n  smoke:\n    run: true"):
            with self.assertRaises(ValueError):
                workflow_recipe(source, "backend")

    def test_selected_failure_cancel_skip_or_missing_cannot_pass(self):
        selected = selection(["apps/web/src/App.tsx"])
        results = {key: {"result": "success" if value else "skipped"}
                   for key, value in selected.items()}
        self.assertTrue(require_results(results, selected))
        for key, status in (("web", "failure"), ("web", "cancelled"), ("web", "skipped"),
                            ("backend", "success"), ("python", "skipped")):
            changed = copy.deepcopy(results)
            changed[key]["result"] = status
            self.assertFalse(require_results(changed, selected))
        self.assertFalse(require_results({}, selected))

    def test_ci_receipt_is_exact_and_failure_is_not_success_shaped(self):
        selected = selection(None)
        results = {key: {"result": "success"} for key in ("plan", *CHECKS)}
        self.assertTrue(ci_evidence(results, selected, CONTEXT, {})["qualified"])
        for key in ("plan", *CHECKS):
            broken = copy.deepcopy(results)
            broken[key]["result"] = "skipped"
            self.assertFalse(ci_evidence(broken, selected, CONTEXT, {})["qualified"])
        self.assertFalse(ci_evidence(results, {}, CONTEXT, {})["qualified"])

    def test_release_requires_successful_matching_tree_head_and_pr(self):
        pull = {"number": 9, "merged_at": "now", "base": {"ref": "main"},
                "head": {"sha": "e" * 40}}
        run = {"id": 1, "head_sha": "e" * 40, "conclusion": "success", "run_attempt": 1,
               "event": "pull_request"}
        receipt = {**CONTEXT, "kind": "qualification", "qualified": True,
                   "pull_request": 9, "head": "e" * 40, "evidence_artifact": {"id": 2}}
        for field, bad in ((None, None), ("tree", "c" * 40), ("qualified", False),
                           ("pull_request", 8), ("head", "d" * 40)):
            candidate = receipt | ({field: bad} if field else {})
            with (patch("release_state.git", return_value=CONTEXT["tree"]),
                  patch("release_state.api", side_effect=[[pull], {"workflow_runs": [run]}]),
                  patch("release_state.artifact", return_value=candidate)):
                if field:
                    with self.assertRaisesRegex(RuntimeError, "qualification"):
                        qualify(CONTEXT["source"])
                else:
                    self.assertEqual(qualify(CONTEXT["source"])["run"], 1)


class SecretHandlingTests(unittest.TestCase):
    def test_budget_contact_values_are_compared_only_in_memory(self):
        configured = "synthetic.one@example.test, synthetic.two@example.test"
        env = {"JARVIS_BUDGET_CONTACT_EMAILS": configured,
               "RESOURCE_GROUP": "fixture-group", "SUBSCRIPTION_ID": "fixture-subscription"}
        for actual, expected in (
            (["synthetic.one@example.test", "synthetic.two@example.test"], True),
            (["synthetic.changed@example.test"], False),
            ([], False),
        ):
            with (patch.dict(os.environ, env),
                  patch("release_state.subprocess.run",
                        return_value=subprocess.CompletedProcess([], 0, json.dumps(actual), ""))):
                self.assertEqual(budget_contacts_match(), expected)
        for code, output in ((1, configured), (0, "private-not-json"), (0, "{}")):
            with (patch.dict(os.environ, env),
                  patch("release_state.subprocess.run",
                        return_value=subprocess.CompletedProcess([], code, output, ""))):
                with self.assertRaises((RuntimeError, ValueError)):
                    budget_contacts_match()
        with patch.dict(os.environ, env | {"JARVIS_BUDGET_CONTACT_EMAILS": ""}):
            with self.assertRaises(ValueError):
                budget_contacts_match()

    def test_sensitive_input_readback_precedes_infra_reuse_without_persisting_a_hash(self):
        for matches, superseded in ((True, False), (False, False), (False, True)):
            with tempfile.TemporaryDirectory() as folder:
                previous_cwd = os.getcwd()
                os.chdir(folder)
                try:
                    plan = {**CONTEXT, "selected": dict.fromkeys(PARTS, False),
                            "superseded": superseded}
                    Path("release-plan.json").write_text(json.dumps(plan))
                    output = io.StringIO()
                    with (patch.dict(os.environ, ENV | {"GITHUB_OUTPUT": "output"}),
                          patch("release_state.identity", return_value=CONTEXT),
                          patch("release_state.budget_contacts_match", return_value=matches) as read,
                          redirect_stdout(output)):
                        select()
                    saved = json.loads(Path("release-plan.json").read_text())
                    self.assertEqual(saved["selected"], dict.fromkeys(
                        PARTS, not matches and not superseded,
                    ))
                    self.assertEqual(set(saved), set(plan))
                    self.assertNotIn("example.test", output.getvalue())
                    self.assertEqual(read.call_count, 0 if superseded else 1)
                finally:
                    os.chdir(previous_cwd)

    def test_prepare_never_includes_sensitive_contact_input_in_fingerprints(self):
        with tempfile.TemporaryDirectory() as folder:
            previous_cwd = os.getcwd()
            os.chdir(folder)
            try:
                with (patch.dict(os.environ, ENV | {
                    "GITHUB_OUTPUT": "output", "RELEASE_BUDGET": "synthetic@example.test",
                    "JARVIS_BUDGET_CONTACT_EMAILS": "synthetic@example.test",
                }), patch("release_state.identity", return_value=CONTEXT),
                      patch("release_state.previous_release", return_value=(None, None)),
                      patch("release_state.git") as lookup,
                      patch("release_state.fingerprints", return_value=INPUTS) as fingerprint,
                      patch("release_state.qualify", return_value={"run": 40})):
                    prepare()
                fingerprint.assert_called_once_with(CONTEXT["source"], ENV["RELEASE_CONFIGURATION"])
                lookup.assert_not_called()
                self.assertNotIn("synthetic@example.test", Path("release-plan.json").read_text())
            finally:
                os.chdir(previous_cwd)

    def test_retained_report_is_complete_fixed_and_content_free(self):
        report = smoke()
        report["entries"][0].update({"status": "down", "reason": "private\n::error::secret",
                                     "details": {"token": "never-retain"}, "text": "never-retain"})
        serialized = json.dumps(safe_report(report))
        for value in ("private", "secret", "never-retain", "details"):
            self.assertNotIn(value, serialized)
        self.assertIn("not_reported_or_redacted", serialized)

    def test_cli_invalid_inputs_never_echo_payloads(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "private.json"
            path.write_text("private-user-content")
            result = subprocess.run(
                [os.sys.executable, str(ROOT / ".github/scripts/smoke_reasons.py"),
                 str(path), "--evidence", str(Path(folder) / "safe.json")],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(result.returncode, 2)
            self.assertNotIn("private-user-content", result.stdout + result.stderr)


class ReleaseStateTests(unittest.TestCase):
    def test_acceptance_failure_does_not_reapply_healthy_exact_inputs(self):
        self.assertEqual(component_selection(INPUTS, previous(), True), dict.fromkeys(PARTS, False))

    def test_missing_failed_mismatched_or_nonancestor_state_reapplies(self):
        self.assertTrue(all(component_selection(INPUTS, None, True).values()))
        self.assertTrue(all(component_selection(INPUTS, previous(), False).values()))

    def test_superseded_receipt_preserves_newer_source_horizon(self):
        prior = previous()
        prior["source"] = "d" * 40
        prior["applied_head"] = "e" * 40
        prior["superseded"] = True
        self.assertFalse(any(component_selection(INPUTS, prior, True).values()))

    def test_supersession_precedes_manual_reuse_and_qualification(self):
        with tempfile.TemporaryDirectory() as folder:
            previous_cwd = os.getcwd()
            os.chdir(folder)
            try:
                with (patch.dict(os.environ, ENV | {"GITHUB_OUTPUT": "output"}),
                      patch("release_state.identity", return_value=CONTEXT),
                      patch("release_state.git", return_value=CONTEXT["source"]),
                      patch("release_state.previous_release",
                            return_value=({"head_sha": "e" * 40},
                                          previous() | {"applied_head": "e" * 40})),
                      patch("release_state.is_ancestor", side_effect=[True, False]),
                      patch("release_state.fingerprints", return_value=INPUTS),
                      patch("release_state.qualify") as qualification):
                    prepare()
                    plan = json.loads(Path("release-plan.json").read_text())
                    self.assertTrue(plan["superseded"])
                    self.assertEqual(plan["applied_head"], "e" * 40)
                    self.assertFalse(any(plan["selected"].values()))
                    qualification.assert_not_called()
            finally:
                os.chdir(previous_cwd)

    def record_fixture(self, selected, results, prior=None, evidence=None):
        with tempfile.TemporaryDirectory() as folder:
            previous_cwd = os.getcwd()
            os.chdir(folder)
            try:
                plan = {**CONTEXT, "selected": selected, "inputs": INPUTS, "superseded": False,
                        "applied_head": CONTEXT["source"], "previous": prior,
                        "qualification": {"pull_request": 9, "run": 40}}
                Path("release-plan.json").write_text(json.dumps(plan))
                if evidence is not None:
                    Path("acceptance-evidence.json").write_text(json.dumps(evidence))
                with (patch.dict(os.environ, ENV | {
                    "RESULTS": json.dumps(results), "VERSIONS": json.dumps(VERSIONS),
                    "APPLY_ATTEMPTS": json.dumps(dict.fromkeys(PARTS, "1")),
                    "AGENT_BACKEND_REVISION": "",
                    "GITHUB_STEP_SUMMARY": "summary",
                }), patch("release_state.identity", return_value=CONTEXT)):
                    code = record()
                return code, json.loads(Path("release-evidence.json").read_text())
            finally:
                os.chdir(previous_cwd)

    def test_applied_and_accepted_are_distinct_and_original_failure_remains(self):
        results = {key: {"result": "success"} for key in ("plan", *PARTS, "smoke", "acceptance")}
        results["acceptance"]["result"] = "failure"
        code, receipt = self.record_fixture(dict.fromkeys(PARTS, True), results, evidence=smoke())
        self.assertEqual(code, 1)
        self.assertFalse(receipt["accepted"])
        self.assertTrue(all(value["state"] == "applied" for value in receipt["components"].values()))
        self.assertEqual(receipt["checks"]["acceptance"], "failure")
        self.assertFalse(any(component_selection(INPUTS, receipt, True).values()))

    def test_missing_acceptance_evidence_and_failed_or_cancelled_jobs_block(self):
        results = {key: {"result": "success"} for key in ("plan", *PARTS, "smoke", "acceptance")}
        self.assertEqual(self.record_fixture(dict.fromkeys(PARTS, True), results)[0], 1)
        for key in results:
            for status in ("failure", "cancelled", "skipped"):
                if (key, status) == ("acceptance", "skipped"):
                    continue
                broken = copy.deepcopy(results)
                broken[key]["result"] = status
                self.assertEqual(self.record_fixture(dict.fromkeys(PARTS, True), broken,
                                                     evidence=smoke())[0], 1)

    def test_manual_only_live_acceptance_is_not_run_and_does_not_block_release(self):
        results = {key: {"result": "success"} for key in ("plan", *PARTS, "smoke")}
        results["acceptance"] = {"result": "skipped"}
        code, receipt = self.record_fixture(dict.fromkeys(PARTS, True), results)
        self.assertEqual(code, 0)
        self.assertTrue(receipt["accepted"])
        self.assertEqual(receipt["checks"]["acceptance"], "skipped")
        self.assertEqual(receipt["acceptance_evidence"], "not run; live acceptance is manual only")
        self.assertNotIn("acceptance", receipt)
        results["smoke"]["result"] = "failure"
        self.assertEqual(self.record_fixture(dict.fromkeys(PARTS, True), results)[0], 1)

    def test_known_or_unknown_functional_failure_cannot_become_accepted(self):
        results = {key: {"result": "success"} for key in ("plan", *PARTS, "smoke", "acceptance")}
        for status in ("down", "degraded", "unknown"):
            report = smoke()
            next(entry for entry in report["entries"]
                 if entry["id"] == "chat_plain_approval")["status"] = status
            self.assertFalse(report_ok(report))
            self.assertEqual(self.record_fixture(dict.fromkeys(PARTS, True), results,
                                                 evidence=report)[0], 1)


class DeployWorkflowTests(unittest.TestCase):
    def test_workflow_keeps_main_only_oidc_and_exact_qualification_before_azure(self):
        deploy = (ROOT / ".github/workflows/deploy.yml").read_text()
        self.assertIn("if: github.ref == 'refs/heads/main'", deploy)
        self.assertIn("release_state.py plan", deploy)
        self.assertIn("github.event_name == 'workflow_dispatch' && inputs.live_acceptance == true", deploy)
        self.assertNotIn('cat "$response"', deploy)
        self.assertNotIn("RELEASE_BUDGET:", deploy)
        qualification = deploy.index("run: python .github/scripts/release_state.py plan")
        readback = deploy.index("name: Authenticate only after exact qualification")
        selected = deploy.index("run: python .github/scripts/release_state.py select")
        self.assertLess(qualification, readback)
        self.assertLess(readback, selected)


if __name__ == "__main__":
    unittest.main()
