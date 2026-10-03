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

        self.assertIn("| P0-01 | Completed task | closed issue | None | Complete |", reconciled)
        self.assertIn("| P0-02 | Claimed task | assigned issue | None | In progress |", reconciled)
        self.assertIn("| P0-03 | PR task | open PR | None | In progress |", reconciled)
        self.assertIn("| P0-04 | Blocked task | manual block | None | Blocked |", reconciled)
        self.assertIn("| P0-05 | Abandoned task | closed unmerged PR | None | Not started |", reconciled)
        self.assertIn("| P0-06 | Merged task | merged PR | None | Complete |", reconciled)
        self.assertIn("| P0-07 | New task: add a thing | works | P0-01, P0-02 | Not started |", reconciled)

    def test_is_idempotent_and_only_updates_status_cells(self):
        once = reconcile_plan(self.plan, self.issues, self.pull_requests)
        self.assertEqual(reconcile_plan(once, self.issues, self.pull_requests), once)

        original_rows = self.plan.splitlines()
        updated_rows = once.splitlines()
        for original, updated in zip(original_rows, updated_rows):
            if original != updated:
                self.assertEqual(original.rsplit("|", 2)[0], updated.rsplit("|", 2)[0])

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

    def test_expands_dependency_range(self):
        row = "| P0-08 | Range | Ready | P0-04…P0-06 | Not started |"
        task = plan_tasks(row)[0]
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
