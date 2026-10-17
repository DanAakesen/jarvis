import copy
from contextlib import redirect_stdout
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from pipeline_evidence import ci_evidence, dispatched_pull, ownership
from pipeline_impact import (
    CHECKS, PARTS, checks_for, deploy_parts, fingerprints, require_results, selection, workflow_recipe,
)
from release_state import (
    artifact, budget_contacts_match, component_selection, prepare, previous_release, qualify,
    record, select,
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


class ImpactTests(unittest.TestCase):
    def test_known_dependencies_are_selected(self):
        for path in ("apps/backend/src/app.ts", "db/migrations/a.sql"):
            self.assertTrue({"backend", "database", "foundry", "web", "jarvis-agent"}
                            <= checks_for(path))
        self.assertTrue({"backend", "web"} <= checks_for("packages/contracts/src/index.js"))
        self.assertIn("backend", checks_for("agents/jarvis/presence-instructions.json"))
        self.assertIn("jarvis-agent", checks_for("docs/reference/voice-prototype/agent/requirements.txt"))

    def test_web_changes_do_not_run_unrelated_components(self):
        self.assertEqual({key for key, value in selection(["apps/web/src/App.tsx"]).items()
                          if value}, {"web", "python"})

    def test_shared_unknown_and_missing_base_fail_conservatively(self):
        for paths in (None, ["new-runtime/config"], [".github/workflows/ci.yml"],
                      [".github/scripts/pipeline_impact.py"]):
            self.assertTrue(all(selection(paths).values()))
        self.assertEqual(deploy_parts("new-runtime/config"), set(PARTS))
        self.assertEqual(deploy_parts(".github/workflows/new-runtime.yml"), set(PARTS))
        self.assertEqual(deploy_parts(".github/scripts/new-runtime.sh"), set(PARTS))

    def test_documentation_is_lightweight_except_real_image_inputs(self):
        self.assertEqual(selection(["README.md"]), dict.fromkeys(CHECKS, False) | {"python": True})
        self.assertEqual(deploy_parts("docs/features.md"), {"backend"})
        self.assertEqual(deploy_parts("agents/jarvis/presence-instructions.json"), {"backend", "agent"})
        self.assertEqual(deploy_parts("apps/web/package.json"), {"web", "backend"})
        self.assertEqual(deploy_parts("package-lock.json"), {"web", "backend"})
        self.assertEqual(deploy_parts("packages/contracts/src/index.js"), {"web", "backend"})

    def test_workflow_only_changes_do_not_rebuild_applications(self):
        for path in (".github/workflows/ci.yml", ".github/workflows/codeql.yml",
                     ".github/scripts/smoke_reasons.py"):
            self.assertEqual(deploy_parts(path), set())

    def test_exact_fingerprints_cover_blob_paths_modes_and_runtime_config(self):
        recipe = "\n".join(["name: Deploy", "env:", "  APP: prod", "", "jobs:"] +
                           [f"  {part}:\n    run: {part}" for part in PARTS])
        records = ["100644 blob " + "a" * 40 + "\tapps/backend/src/app.ts",
                   "100644 blob " + "b" * 40 + "\tapps/web/src/App.tsx",
                   "100644 blob " + "c" * 40 + "\tinfra/main.bicep"]

        def values(items, workflow=recipe, config="fixed"):
            with patch("pipeline_impact.git", side_effect=["\n".join(items), workflow]):
                return fingerprints("head", config)

        initial = values(records)
        backend = values([records[0].replace("a" * 40, "d" * 40), *records[1:]])
        self.assertNotEqual(initial["backend"], backend["backend"])
        self.assertEqual(initial["web"], backend["web"])
        self.assertNotEqual(initial["backend"], values(records, config="changed")["backend"])
        infra = values([*records[:2], records[2].replace("c" * 40, "d" * 40)])
        self.assertTrue(all(initial[part] != infra[part] for part in PARTS))
        self.assertEqual(initial, values(records, workflow=recipe + "\n  smoke:\n    run: changed"))
        own_job = values(records, workflow=recipe.replace("run: web", "run: new-web"))
        self.assertNotEqual(initial["web"], own_job["web"])
        self.assertEqual(initial["infra"], own_job["infra"])

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


class QualificationTests(unittest.TestCase):
    def test_ci_receipt_is_exact_and_failure_is_not_success_shaped(self):
        selected = selection(None)
        results = {key: {"result": "success"} for key in ("plan", *CHECKS)}
        self.assertTrue(ci_evidence(results, selected, CONTEXT, {})["qualified"])
        for key in ("plan", *CHECKS):
            broken = copy.deepcopy(results)
            broken[key]["result"] = "skipped"
            self.assertFalse(ci_evidence(broken, selected, CONTEXT, {})["qualified"])
        self.assertFalse(ci_evidence(results, {}, CONTEXT, {})["qualified"])

    def test_ownership_copies_only_bounded_issue_numbers(self):
        result = ownership({"pull_request": {"number": 10, "body":
                           "Fixes #880\nRefs #879\nprivate content; token=never-copy"}})
        self.assertEqual(result, {"pull_request": 10, "issues": [879, 880]})
        self.assertNotIn("private", json.dumps(result))

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

    def test_copilot_ready_dispatch_is_bound_to_its_existing_ready_pr(self):
        pull = {"number": 9, "head": {"sha": "a" * 40}, "base": {"ref": "main"},
                "draft": False, "state": "open"}
        for change in ({}, {"head": {"sha": "b" * 40}}, {"draft": True},
                       {"number": 8}, {"state": "closed"}, {"base": {"ref": "other"}}):
            with (patch.dict(os.environ, {"GITHUB_REPOSITORY": "fixture/repo"}),
                  patch("pipeline_evidence.subprocess.run", return_value=subprocess.CompletedProcess(
                      [], 0, json.dumps(pull | change), ""))):
                if change:
                    with self.assertRaises(ValueError):
                        dispatched_pull("9", "a" * 40)
                else:
                    self.assertEqual(dispatched_pull("9", "a" * 40)["number"], 9)


class ReleaseStateTests(unittest.TestCase):
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
                # A newer docs-only main commit has no Deploy run. Only a
                # verified applied-source horizon can supersede this release.
                lookup.assert_not_called()
                self.assertNotIn("synthetic@example.test", Path("release-plan.json").read_text())
            finally:
                os.chdir(previous_cwd)

    def test_acceptance_failure_does_not_reapply_healthy_exact_inputs(self):
        self.assertEqual(component_selection(INPUTS, previous(), True), dict.fromkeys(PARTS, False))

    def test_missing_failed_mismatched_or_nonancestor_state_reapplies(self):
        self.assertTrue(all(component_selection(INPUTS, None, True).values()))
        self.assertTrue(all(component_selection(INPUTS, previous(), False).values()))
        for change in ({"state": "unknown"}, {"fingerprint": "f" * 64},
                       {"version": {}}, {"origin": None}):
            prior = previous()
            prior["components"]["web"].update(change)
            result = component_selection(INPUTS, prior, True)
            self.assertTrue(result["web"])
            self.assertFalse(result["backend"])

    def test_superseded_receipt_preserves_newer_source_horizon(self):
        prior = previous()
        prior["source"] = "d" * 40
        prior["applied_head"] = "e" * 40
        prior["superseded"] = True
        # Reuse is controlled by the newer source horizon and exact component
        # inputs, never the old queued run's source SHA or accepted flag.
        self.assertFalse(any(component_selection(INPUTS, prior, True).values()))

    def test_backend_reuse_requires_separate_revision_provenance(self):
        prior = previous()
        del prior["components"]["backend"]["revision_origin"]
        selected = component_selection(INPUTS, prior, True)
        self.assertTrue(selected["backend"])
        self.assertFalse(selected["web"])

    def test_infra_reapplication_invalidates_downstream_configuration(self):
        prior = previous()
        prior["components"]["infra"]["state"] = "unknown"
        self.assertTrue(all(component_selection(INPUTS, prior, True).values()))

    def test_latest_unknown_receipt_is_not_replaced_with_older_green(self):
        runs = [{"id": number, "status": "completed", "event": "push", "head_branch": "main"}
                for number in (43, 41)]
        with (patch("release_state.api", return_value={"workflow_runs": runs}),
              patch("release_state.artifact", return_value=None) as read):
            run, receipt = previous_release(42)
            self.assertEqual(run["id"], 43)
            self.assertIsNone(receipt)
            read.assert_called_once()

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

    def record_fixture(self, selected, results, prior=None, evidence=None, attempts=None,
                       backend_revision=""):
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
                    "APPLY_ATTEMPTS": json.dumps(attempts or dict.fromkeys(PARTS, "1")),
                    "AGENT_BACKEND_REVISION": backend_revision,
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
        self.assertEqual(receipt["components"]["backend"]["version"], VERSIONS["backend"])
        self.assertFalse(any(component_selection(INPUTS, receipt, True).values()))

    def test_reused_versions_keep_their_original_source_not_new_release_sha(self):
        results = {key: {"result": "success"} for key in ("plan", "smoke", "acceptance")}
        results.update({key: {"result": "skipped"} for key in PARTS})
        prior = previous()
        prior["components"]["web"]["origin"]["source"] = "d" * 40
        code, receipt = self.record_fixture(dict.fromkeys(PARTS, False), results,
                                            prior=prior, evidence=smoke())
        self.assertEqual(code, 0)
        self.assertTrue(receipt["accepted"])
        self.assertEqual(receipt["components"]["web"]["origin"]["source"], "d" * 40)

    def test_missing_acceptance_evidence_and_failed_or_cancelled_jobs_block(self):
        results = {key: {"result": "success"} for key in ("plan", *PARTS, "smoke", "acceptance")}
        self.assertEqual(self.record_fixture(dict.fromkeys(PARTS, True), results)[0], 1)
        for key in results:
            for status in ("failure", "cancelled", "skipped"):
                broken = copy.deepcopy(results)
                broken[key]["result"] = status
                self.assertEqual(self.record_fixture(dict.fromkeys(PARTS, True), broken,
                                                     evidence=smoke())[0], 1)

    def test_known_or_unknown_functional_failure_cannot_become_accepted(self):
        results = {key: {"result": "success"} for key in ("plan", *PARTS, "smoke", "acceptance")}
        for status in ("down", "degraded", "unknown"):
            report = smoke()
            next(entry for entry in report["entries"]
                 if entry["id"] == "chat_plain_approval")["status"] = status
            self.assertFalse(report_ok(report))
            self.assertEqual(self.record_fixture(dict.fromkeys(PARTS, True), results,
                                                 evidence=report)[0], 1)

    def test_partial_agent_failure_invalidates_backend_identity_state(self):
        results = {key: {"result": "success"} for key in ("plan", *PARTS, "smoke", "acceptance")}
        results["agent"]["result"] = "failure"
        _, receipt = self.record_fixture(dict.fromkeys(PARTS, True), results, evidence=smoke())
        self.assertEqual(receipt["components"]["backend"]["state"], "unknown")

    def test_retried_acceptance_does_not_claim_new_artifact_producer_attempt(self):
        results = {key: {"result": "success"} for key in ("plan", *PARTS, "smoke", "acceptance")}
        with patch.dict(CONTEXT, {"attempt": 2}):
            code, receipt = self.record_fixture(dict.fromkeys(PARTS, True), results,
                                                evidence=smoke())
        self.assertEqual(code, 0)
        self.assertEqual(receipt["attempt"], 2)
        self.assertEqual(receipt["components"]["backend"]["origin"]["attempt"], 1)

    def test_agent_only_revision_keeps_image_origin_and_records_actual_revision_producer(self):
        selected = dict.fromkeys(PARTS, False) | {"agent": True}
        results = {key: {"result": "success" if selected.get(key, True) else "skipped"}
                   for key in ("plan", *PARTS, "smoke", "acceptance")}
        prior = previous()
        image_origin = {"source": "e" * 40, "run": 30, "attempt": 1}
        prior["components"]["backend"]["origin"] = image_origin
        prior["components"]["backend"]["revision_origin"] = image_origin
        with patch.dict(CONTEXT, {"attempt": 2}):
            code, receipt = self.record_fixture(
                selected, results, prior=prior, evidence=smoke(),
                attempts={"agent": "1"}, backend_revision="backend--0002",
            )
        self.assertEqual(code, 0)
        backend = receipt["components"]["backend"]
        self.assertEqual(backend["state"], "applied")
        self.assertEqual(backend["origin"], image_origin)
        self.assertEqual(backend["version"]["image"], VERSIONS["backend"]["image"])
        self.assertEqual(backend["version"]["revision"], "backend--0002")
        self.assertEqual(backend["revision_origin"],
                         {"source": CONTEXT["source"], "run": 42, "attempt": 1})


class ArtifactTests(unittest.TestCase):
    def archive(self, receipt):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as archive:
            archive.writestr("release-evidence.json", json.dumps(receipt))
        return output.getvalue()

    def test_artifact_identity_digest_schema_attempt_and_size_are_bound(self):
        raw = self.archive(CONTEXT)
        item = {"id": 7, "name": "release-evidence-1", "size_in_bytes": len(raw), "expired": False,
                "digest": "sha256:" + hashlib.sha256(raw).hexdigest()}
        with patch("release_state.api", side_effect=[{"artifacts": [item]}, raw]):
            self.assertEqual(artifact({"id": 42, "run_attempt": 1}, "release-evidence",
                                      "release-evidence.json")["evidence_artifact"]["id"], 7)
        for bad in (item | {"digest": "sha256:" + "0" * 64},
                    item | {"size_in_bytes": 1024 * 1024 + 1}):
            with patch("release_state.api", side_effect=[{"artifacts": [bad]}, raw]):
                with self.assertRaises(ValueError):
                    artifact({"id": 42, "run_attempt": 1}, "release-evidence", "release-evidence.json")
        with patch("release_state.api", side_effect=[{"artifacts": [item]}, raw]):
            with self.assertRaisesRegex(ValueError, "provenance"):
                artifact({"id": 43, "run_attempt": 1}, "release-evidence", "release-evidence.json")

    def test_expired_or_different_attempt_is_not_reused(self):
        item = {"id": 7, "name": "release-evidence-1", "size_in_bytes": 30, "expired": True}
        with patch("release_state.api", return_value={"artifacts": [item]}):
            self.assertIsNone(artifact({"id": 42, "run_attempt": 1}, "release-evidence", "unused"))


class SafeFailureTests(unittest.TestCase):
    def test_retained_report_is_complete_fixed_and_content_free(self):
        report = smoke()
        report["entries"][0].update({"status": "down", "reason": "private\n::error::secret",
                                     "details": {"token": "never-retain"}, "text": "never-retain"})
        serialized = json.dumps(safe_report(report))
        for value in ("private", "secret", "never-retain", "details"):
            self.assertNotIn(value, serialized)
        self.assertIn("not_reported_or_redacted", serialized)

    def test_missing_duplicate_unknown_and_invalid_status_fail_closed(self):
        for report in ({"entries": []}, {"entries": smoke()["entries"][:-1]},
                       {"entries": [smoke()["entries"][0]] * len(CHECK_IDS)}):
            with self.assertRaises(ValueError):
                safe_report(report)
        for bad in ({"id": "private"}, {"status": "private"}, {"id": []}, {"status": []}):
            report = smoke()
            report["entries"][0].update(bad)
            with self.assertRaises(ValueError):
                safe_report(report)

    def test_workflow_keeps_real_gates_and_main_only_oidc(self):
        ci = (ROOT / ".github/workflows/ci.yml").read_text()
        deploy = (ROOT / ".github/workflows/deploy.yml").read_text()
        self.assertIn("SELECTION: ${{ needs.plan.outputs.selection }}", ci)
        self.assertIn("pipeline_evidence.py", ci)
        self.assertIn("if: github.ref == 'refs/heads/main'", deploy)
        self.assertIn("release_state.py plan", deploy)
        self.assertIn("name: Live conversation acceptance", deploy)
        self.assertIn('and .status != "ok"', deploy)
        self.assertNotIn('cat "$response"', deploy)
        self.assertIn("'docs/features.md'", deploy)
        self.assertIn("name: release-plan-${{ needs.plan.outputs.attempt }}", deploy)
        self.assertNotIn("RELEASE_BUDGET:", deploy)
        qualification = deploy.index("run: python .github/scripts/release_state.py plan")
        readback = deploy.index("name: Authenticate only after exact qualification")
        selection = deploy.index("run: python .github/scripts/release_state.py select")
        self.assertLess(qualification, readback)
        self.assertLess(readback, selection)
        self.assertIn(
            "if: steps.inputs.outputs.infra == 'false' && steps.inputs.outputs.superseded != 'true'",
            deploy,
        )
        plan_permissions = deploy[deploy.index("  plan:"):deploy.index("    outputs:")]
        self.assertIn("pull-requests: read", plan_permissions)

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


if __name__ == "__main__":
    unittest.main()
