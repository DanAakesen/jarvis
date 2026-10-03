import json
import unittest
from pathlib import Path

from plan_status import (
    flatten_pages,
    new_tasks,
    plan_tasks,
    reconcile_plan,
    task_status,
)

FIXTURES = Path(__file__).parent / "fixtures"


class PlanStatusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = (FIXTURES / "plan.md").read_text(encoding="utf-8")
        cls.issues = flatten_pages(
            json.loads((FIXTURES / "issues.json").read_text(encoding="utf-8"))
        )
        cls.pull_requests = flatten_pages(
            json.loads(
                (FIXTURES / "pull-requests.json").read_text(encoding="utf-8")
            )
        )

    def test_reconciles_github_state_and_preserves_manual_block(self):
        reconciled = reconcile_plan(self.plan, self.issues, self.pull_requests)

        self.assertIn(
            "| P0-01 | [#1](https://github.com/DanAakesen/jarvis/issues/1) | Completed task | closed issue | None | Complete |",
            reconciled,
        )
        self.assertIn(
            "| P0-02 | [#2](https://github.com/DanAakesen/jarvis/issues/2) | Claimed task | assigned issue | None | In progress |",
            reconciled,
        )
        self.assertIn(
            "| P0-03 | [#3](https://github.com/DanAakesen/jarvis/issues/3) | PR task | open PR | None | In progress |",
            reconciled,
        )
        self.assertIn(
            "| P0-04 | [#4](https://github.com/DanAakesen/jarvis/issues/4) | Blocked task | manual block | None | Blocked |",
            reconciled,
        )
        self.assertIn(
            "| P0-05 | [#5](https://github.com/DanAakesen/jarvis/issues/5) | Abandoned task | closed unmerged PR | None | Not started |",
            reconciled,
        )
        self.assertIn(
            "| P0-06 | [#6](https://github.com/DanAakesen/jarvis/issues/6) | Merged task | merged PR | None | Complete |",
            reconciled,
        )
        self.assertIn("| P0-07 |  | New task: add a thing | works | P0-01, P0-02 | Not started |", reconciled)

    def test_is_idempotent_and_only_updates_status_cells(self):
        once = reconcile_plan(self.plan, self.issues, self.pull_requests)
        self.assertEqual(reconcile_plan(once, self.issues, self.pull_requests), once)

        original_rows = self.plan.splitlines()
        updated_rows = once.splitlines()
        issue_status_columns = {2, len(original_rows[0].split("|")) - 2}
        for original, updated in zip(original_rows, updated_rows):
            if original != updated:
                original_cells = original.split("|")
                updated_cells = updated.split("|")
                for index, (before, after) in enumerate(zip(original_cells, updated_cells)):
                    if index not in issue_status_columns:
                        self.assertEqual(before, after)

    def test_generates_new_issue_in_plan_format_and_expands_dependency_ranges(self):
        tasks = plan_tasks(self.plan)
        self.assertEqual(tasks[-1]["dependencies"], ["P0-01", "P0-02"])

        pending = new_tasks(self.plan, self.issues, "DanAakesen/jarvis")
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["title"], "P0-07: New task")
        self.assertEqual(pending[0]["labels"], ["P0"])
        self.assertIn("**Acceptance criteria:** works", pending[0]["body"])
        self.assertIn("### Before you start", pending[0]["body"])
        self.assertIn("### Definition of done", pending[0]["body"])
        self.assertEqual(pending[0]["depends_on"], ["P0-01", "P0-02"])

    def test_reconciles_issue_link_for_a_just_created_issue(self):
        created_issue = {
            "number": 70,
            "title": "P0-07: New task",
            "state": "open",
            "state_reason": None,
            "assignees": [],
        }

        reconciled = reconcile_plan(
            self.plan,
            [*self.issues, created_issue],
            self.pull_requests,
        )

        self.assertIn(
            "| P0-07 | [#70](https://github.com/DanAakesen/jarvis/issues/70) | New task: add a thing | works | P0-01, P0-02 | Not started |",
            reconciled,
        )

    def test_expands_dependency_range(self):
        plan = """| ID | Issue | Task | Acceptance criteria | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| P0-08 |  | Range | Ready | P0-04…P0-06 | Not started |
"""
        task = plan_tasks(plan)[0]
        self.assertEqual(task["dependencies"], ["P0-04", "P0-05", "P0-06"])

    def test_assignment_keeps_task_in_progress_until_issue_is_completed(self):
        issue = {
            "number": 8,
            "state": "closed",
            "state_reason": "not_planned",
            "assignees": [{"login": "DanAakesen"}],
        }
        self.assertEqual(task_status("Not started", issue, []), "In progress")


if __name__ == "__main__":
    unittest.main()
