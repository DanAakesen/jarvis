"""Behavioral contracts for unclaimed tasks and SHA-bound merge decisions."""

import copy
import unittest
from pathlib import Path

from coordinator_policy import (
    closing_issue_numbers,
    decide_merge,
    issue_task_id,
    latest_workflow_runs_green,
    parse_plan,
    ready_issue,
)

PLAN = """
| ID | Task | Acceptance criteria | Depends on | Status |
| --- | --- | --- | --- | --- |
| P0-01 | Foundation | Verified | — | Complete |
| P0-02 | Skeleton | Verified | P0-01 | Complete |
| P0-03 | Next task | Verified | P0-01, P0-02 | Not started |
| P0-04 | Manual setup | Verified | P0-03 | Blocked |
"""

PLAN_WITH_ISSUES = """
| ID | Issue | Task | Acceptance criteria | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| P0-01 | [#1](https://github.com/DanAakesen/jarvis/issues/1) | Foundation | Verified | — | Complete |
| P0-02 | [#2](https://github.com/DanAakesen/jarvis/issues/2) | Skeleton | Verified | P0-01 | Complete |
| P0-03 | [#3](https://github.com/DanAakesen/jarvis/issues/3) | Next task | Verified | P0-01, P0-02 | Not started |
| P0-04 | — | Manual setup | Verified | P0-03 | Blocked |
"""


class PlanPolicyTests(unittest.TestCase):
    def setUp(self):
        self.plan = parse_plan(PLAN)
        self.issue = {"number": 3, "title": "P0-03: Next task", "state": "OPEN", "labels": [{"name": "P0"}], "assignees": []}
        self.issues = {
            "P0-01": {"number": 1, "state": "CLOSED"},
            "P0-02": {"number": 2, "state": "closed"},
        }

    def ready(self, bodies=None):
        return ready_issue(self.issue, self.plan, self.issues, bodies or [])

    def test_real_plan_parses_including_range(self):
        plan = parse_plan((Path(__file__).resolve().parents[2] / "PLAN.md").read_text())
        self.assertEqual(plan["P0-11"]["deps"], [f"P0-{number:02}" for number in range(4, 11)])
        self.assertIn("P3-10", plan)

    def test_plan_status_issue_column_preserves_task_and_dependencies(self):
        self.plan = parse_plan(PLAN_WITH_ISSUES)
        self.assertEqual(self.plan, parse_plan(PLAN))
        self.assertEqual(self.ready(), (True, "ready"))
        self.issues["P0-02"]["state"] = "open"
        self.assertFalse(self.ready()[0])

    def test_five_and_six_column_tables_can_coexist(self):
        first = PLAN.split("| P0-02")[0]
        second = PLAN_WITH_ISSUES.replace("| P0-01 | [#1](https://github.com/DanAakesen/jarvis/issues/1) | Foundation | Verified | — | Complete |\n", "")
        self.assertEqual(parse_plan(first + "\n" + second), parse_plan(PLAN))

    def test_plan_status_normalizes_case_and_whitespace(self):
        for status in ["In Progress", "IN PROGRESS", "InProgress", "**In  progress**"]:
            with self.subTest(status=status):
                plan = parse_plan(PLAN_WITH_ISSUES.replace("Not started", status))
                self.assertEqual(plan["P0-03"]["status"], "In progress")
        plan = parse_plan(PLAN_WITH_ISSUES.replace("Not started", "NOT STARTED"))
        self.assertEqual(plan["P0-03"]["status"], "Not started")

    def test_issue_column_header_and_links_fail_closed_on_unknown_shape(self):
        malformed = [
            PLAN_WITH_ISSUES.replace("ID | Issue | Task", "ID | Task | Issue"),
            PLAN_WITH_ISSUES.replace("ID | Issue | Task", "ID | GitHub | Task"),
            PLAN_WITH_ISSUES.replace("[#1](https://github.com/DanAakesen/jarvis/issues/1)", "[#1](https://github.com/other/repo/issues/1)"),
            PLAN_WITH_ISSUES.replace("[#1](https://github.com/DanAakesen/jarvis/issues/1)", "[#2](https://github.com/DanAakesen/jarvis/issues/1)"),
            PLAN_WITH_ISSUES.replace("[#1](https://github.com/DanAakesen/jarvis/issues/1)", "arbitrary link"),
            PLAN_WITH_ISSUES.replace("Acceptance criteria", "Unknown column"),
            PLAN_WITH_ISSUES.replace("Not started", "Completed"),
        ]
        for markdown in malformed:
            with self.subTest(markdown=markdown), self.assertRaises(ValueError):
                parse_plan(markdown)

    def test_exact_title_only(self):
        self.assertEqual(issue_task_id("P0-03: Skeleton"), "P0-03")
        for title in ["[WIP] P0-03: Skeleton", "P0-3: Skeleton", " P0-03: Skeleton", "P0-03 Skeleton", "P0-03:", "P9-03: Other phase", "P0-03: Skeleton\nbody"]:
            with self.subTest(title=title):
                self.assertIsNone(issue_task_id(title))

    def test_malformed_plan_fails_closed(self):
        for invalid in ["no tasks", PLAN + "| P0-01 | duplicate | yes | — | Complete |", PLAN.replace("P0-01, P0-02", "anything"), PLAN.replace("Not started", "Ready"), PLAN.replace("P0-01, P0-02", "P1-04…P0-02"), PLAN.replace("P0-01, P0-02", "P0-04…P0-02")]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                parse_plan(invalid)

    def test_escaped_pipe_does_not_shift_dependencies(self):
        plan = parse_plan(PLAN.replace("Next task", r"Next \| task"))
        self.assertEqual(plan["P0-03"]["title"], "Next | task")

    def test_ready_issue_requires_plan_and_github(self):
        self.assertEqual(self.ready(), (True, "ready"))
        self.issues["P0-01"]["state"] = "open"
        self.assertFalse(self.ready()[0])
        self.issues.pop("P0-01")
        self.assertFalse(self.ready()[0])

    def test_every_worker_label_blocks_case_insensitively(self):
        for label in ["Codex", "CODEX", "codex", "Copilot", "COPILOT", "copilot", "Jarvis", "JARVIS", "jarvis", "Dan", "DAN", "dan"]:
            for wrapped in [label, {"name": label}]:
                with self.subTest(label=wrapped):
                    self.issue["labels"] = [wrapped]
                    self.assertFalse(self.ready()[0])

    def test_assigned_or_closed_issue_not_ready(self):
        self.issue["assignees"] = [{"login": "some-worker"}]
        self.assertFalse(self.ready()[0])
        self.issue["assignees"] = []
        self.issue["state"] = "closed"
        self.assertFalse(self.ready()[0])

    def test_search_ready_result_cannot_override_plan(self):
        # GitHub search may return a task for -is:blocked even with prerequisites
        # pending. Its search result is never a readiness decision.
        self.plan["P0-02"]["status"] = "In progress"
        self.assertFalse(self.ready()[0])
        self.plan.pop("P0-02")
        self.assertFalse(self.ready()[0])

    def test_manual_blocked_complete_progress_never_assigned(self):
        for status in ["Blocked", "Complete", "In progress"]:
            with self.subTest(status=status):
                self.plan["P0-03"]["status"] = status
                self.assertFalse(self.ready()[0])

    def test_no_plan_task_or_number_rejects(self):
        self.issue["title"] = "Some task"
        self.assertFalse(self.ready()[0])
        self.issue["title"] = "P0-03: Next task"
        self.issue.pop("number")
        self.assertFalse(self.ready()[0])

    def test_dependency_blocks_only_its_dependants(self):
        self.plan["P0-04"]["status"] = "In progress"
        self.assertTrue(self.ready()[0])

    def test_open_pr_claims_all_supported_closing_reference_forms(self):
        for body in ["Fixes #3", "closes #3", "Resolved #3", "Fixes DanAakesen/jarvis#3", "Fixes https://github.com/DanAakesen/jarvis/issues/3"]:
            with self.subTest(body=body):
                self.assertFalse(self.ready([body])[0])
        self.assertTrue(self.ready(["Refs #3", "Fixes other/repo#3", "Fixes https://github.com/other/repo/issues/3"])[0])

    def test_closing_keyword_boundaries(self):
        self.assertEqual(closing_issue_numbers("prefixes #3; Fixes #30; FIX #3"), {3, 30})
        self.assertEqual(closing_issue_numbers("Fixes 3"), set())


class MainPolicyTests(unittest.TestCase):
    @staticmethod
    def run(number=1, attempt=1, status="completed", conclusion="success", sha="main", name="CI"):
        return {"id": number, "name": name, "run_number": number, "run_attempt": attempt, "status": status, "conclusion": conclusion, "head_sha": sha}

    def test_current_main_exact_sha_and_workflows(self):
        self.assertTrue(latest_workflow_runs_green([self.run()], "main"))
        self.assertFalse(latest_workflow_runs_green([self.run()], "new-main"))
        self.assertFalse(latest_workflow_runs_green([], "main"))
        self.assertFalse(latest_workflow_runs_green([self.run()], "main", ("CI", "Deploy")))
        self.assertTrue(latest_workflow_runs_green([self.run(), self.run(name="Deploy")], "main", ("CI", "Deploy")))

    def test_new_run_or_rerun_overrides_old_green(self):
        old = self.run()
        self.assertFalse(latest_workflow_runs_green([old, self.run(number=2, status="in_progress", conclusion=None)], "main"))
        self.assertFalse(latest_workflow_runs_green([old, self.run(attempt=2, conclusion="failure")], "main"))

    def test_unknown_skipped_failed_not_green(self):
        for conclusion in [None, "skipped", "neutral", "failure", "cancelled", "timed_out", "action_required"]:
            with self.subTest(conclusion=conclusion):
                self.assertFalse(latest_workflow_runs_green([self.run(conclusion=conclusion)], "main"))


class MergePolicyTests(unittest.TestCase):
    def setUp(self):
        self.pr = {
            "state": "OPEN", "title": "P0-03: Backend", "isDraft": False,
            "baseRefName": "main", "headRepositorySameAsBase": True,
            "headRefOid": "head", "main_integrated": True,
            "integrated_main_sha": "main", "mergeable": "MERGEABLE",
            "files": ["apps/backend/src/index.ts"], "reviews": [],
        }
        self.checks = [{"id": 1, "name": "CI result", "head_sha": "head", "status": "completed", "conclusion": "success"}]

    def decision(self, main="main", green=True, unresolved=False, finished=True):
        return decide_merge(self.pr, main, green, self.checks, unresolved, finished)

    def test_positive_with_optional_skipped_neutral(self):
        for result in ["success", "skipped", "neutral"]:
            with self.subTest(result=result):
                self.checks.append({"id": 2, "name": "Optional", "head_sha": "head", "status": "completed", "conclusion": result})
                self.assertEqual(self.decision(), "ready")
                self.checks.pop()

    def test_draft_closed_unknown_source_and_conflict_rejected(self):
        for field, value in [("state", "CLOSED"), ("isDraft", True), ("isDraft", None), ("baseRefName", "other"), ("headRepositorySameAsBase", False), ("mergeable", "CONFLICTING"), ("mergeable", "UNKNOWN")]:
            with self.subTest(field=field, value=value):
                original = self.pr[field]
                self.pr[field] = value
                self.assertNotEqual(self.decision(), "ready")
                self.pr[field] = original

    def test_only_repair_can_merge_on_red_main(self):
        self.assertNotEqual(self.decision(green=False), "ready")
        self.pr["title"] = "docs: Clarify"
        self.pr["files"] = ["README.md"]
        self.assertNotEqual(self.decision(green=False), "ready")
        self.pr["title"] = "fix-main: Repair CI"
        self.assertEqual(self.decision(green=False), "ready")
        self.checks[0]["conclusion"] = "failure"
        self.assertNotEqual(self.decision(green=False), "ready")

    def test_main_moving_invalidates_previous_ancestry_proof(self):
        self.assertNotEqual(self.decision(main="new-main"), "ready")
        self.pr["main_integrated"] = False
        self.assertNotEqual(self.decision(), "ready")

    def test_head_moving_invalidates_check_evidence(self):
        self.pr["headRefOid"] = "new-head"
        self.assertNotEqual(self.decision(), "ready")

    def test_unknown_active_copilot_and_reviews_rejected(self):
        self.assertNotEqual(self.decision(finished=False), "ready")
        self.assertNotEqual(self.decision(finished=None), "ready")
        self.assertNotEqual(self.decision(unresolved=True), "ready")
        self.assertNotEqual(self.decision(unresolved=None), "ready")
        self.pr["reviews"] = [{"state": "CHANGES_REQUESTED"}]
        self.assertNotEqual(self.decision(), "ready")

    def test_ci_gate_is_mandatory_never_skippable(self):
        for result in [None, "skipped", "neutral", "failure", "cancelled", "timed_out"]:
            with self.subTest(result=result):
                self.checks[0]["conclusion"] = result
                self.assertNotEqual(self.decision(), "ready")
        self.checks = []
        self.assertNotEqual(self.decision(), "ready")

    def test_optional_unknown_pending_or_failed_blocks(self):
        for status, conclusion in [("in_progress", None), ("queued", None), ("completed", "failure"), ("completed", None), ("completed", "cancelled")]:
            with self.subTest(status=status, conclusion=conclusion):
                self.checks.append({"id": 2, "name": "Optional", "head_sha": "head", "status": status, "conclusion": conclusion})
                self.assertNotEqual(self.decision(), "ready")
                self.checks.pop()

    def test_latest_rerun_cannot_be_hidden_by_old_green(self):
        old = copy.deepcopy(self.checks[0])
        newer = {**old, "id": 2, "status": "in_progress", "conclusion": None}
        self.checks = [newer, old]
        self.assertNotEqual(self.decision(), "ready")
        newer.update(status="completed", conclusion="success")
        old["conclusion"] = "failure"
        self.assertEqual(self.decision(), "ready")

    def test_docs_title_never_disguises_executable_source(self):
        self.pr["title"] = "docs: Clarify setup"
        for files in [["docs/guide.md"], ["README.md", "PLAN.md", "docs/architecture-flows.html"]]:
            self.pr["files"] = files
            self.assertEqual(self.decision(), "ready")
        for files in [[], ["docs/reference/run.py"], ["docs/../apps/backend/index.ts"], [".github/workflows/merge.yml"], ["apps/backend/README.md"]]:
            self.pr["files"] = files
            self.assertNotEqual(self.decision(), "ready")

    def test_invalid_titles_not_mergeable(self):
        for title in ["Update stuff", "[WIP] P0-03: Backend", "fix-main:", "docs:"]:
            self.pr["title"] = title
            self.assertNotEqual(self.decision(), "ready")


if __name__ == "__main__":
    unittest.main()
