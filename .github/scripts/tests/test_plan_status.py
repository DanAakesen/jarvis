import json
import unittest
from pathlib import Path
from unittest.mock import patch

from plan_status import (
    dependencies_from_text,
    flatten_pages,
    new_tasks,
    plan_tasks,
    reconcile_plan,
    task_status,
    task_issue_map,
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
            "| P0-02 | [#2](https://github.com/DanAakesen/jarvis/issues/2) | Assigned-only task | assignee alone is ignored | None | Not started |",
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
            "| P0-06 | [#6](https://github.com/DanAakesen/jarvis/issues/6) | Merged task | merged PR | None | Not started |",
            reconciled,
        )
        self.assertIn("| P0-07 |  | New task: add a thing | works | P0-01, P0-02 | Not started |", reconciled)
        self.assertIn(
            "| P0-08 | [#8](https://github.com/DanAakesen/jarvis/issues/8) | Labelled task | worker label | None | In progress |",
            reconciled,
        )
        self.assertIn(
            "| P0-09 | [#9](https://github.com/DanAakesen/jarvis/issues/9) | Unknown label task | unrelated label | None | Not started |",
            reconciled,
        )
        self.assertIn(
            "| P0-10 | [#11](https://github.com/DanAakesen/jarvis/issues/11) | Closed task | closed without completion | None | Not started |",
            reconciled,
        )

    def test_is_idempotent_and_only_updates_issue_and_status_cells(self):
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
        new_task = next(task for task in tasks if task["id"] == "P0-07")
        self.assertEqual(new_task["dependencies"], ["P0-01", "P0-02"])

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

    def test_worker_labels_are_the_only_issue_claim_signal(self):
        for worker in ("Codex", "Copilot", "Dan", "Jarvis"):
            with self.subTest(worker=worker):
                issue = {
                    "number": 8,
                    "state": "open",
                    "labels": [{"name": worker}],
                    "assignees": [],
                }
                self.assertEqual(task_status("Not started", issue, []), "In progress")

        assigned_only = {
            "number": 8,
            "state": "open",
            "labels": [],
            "assignees": [{"login": "DanAakesen"}],
        }
        self.assertEqual(task_status("In progress", assigned_only, []), "Not started")

    def test_closed_unfinished_issue_resets_to_not_started_and_labels_only_record_worker(self):
        issue = {
            "number": 8,
            "state": "closed",
            "state_reason": "not_planned",
            "labels": [{"name": "Codex"}],
            "assignees": [],
        }
        self.assertEqual(task_status("Not started", issue, []), "Not started")
        self.assertEqual(task_status("In progress", issue, []), "Not started")
        self.assertEqual(task_status("Blocked", issue, []), "Blocked")

    def test_reopened_issue_does_not_complete_from_a_historical_merged_pr(self):
        issue = {
            "number": 794,
            "state": "open",
            "state_reason": None,
            "labels": [],
        }
        merged_pr = {
            "number": 802,
            "state": "closed",
            "merged_at": "2026-10-03T00:00:00Z",
            "body": "Fixes #794",
        }

        self.assertEqual(task_status("Complete", issue, [merged_pr]), "Not started")
        self.assertEqual(task_status("Blocked", issue, [merged_pr]), "Blocked")
        self.assertEqual(
            task_status(
                "Complete",
                issue,
                [merged_pr, {"state": "open", "body": "Fixes #794"}],
            ),
            "In progress",
        )
        self.assertEqual(
            task_status(
                "Complete",
                {**issue, "labels": [{"name": "Copilot"}]},
                [merged_pr],
            ),
            "In progress",
        )
        self.assertEqual(
            task_status(
                "Not started",
                {**issue, "state": "closed", "state_reason": "completed"},
                [merged_pr],
            ),
            "Complete",
        )
        self.assertEqual(task_status("In progress", None, [merged_pr]), "In progress")

    def test_reopened_issue_plan_row_is_reconciled_idempotently(self):
        plan = """| ID | Issue | Task | Acceptance criteria | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| P9-99 |  | Acceptance gate | Warm-speed evidence | None | Complete |
"""
        issue = {
            "number": 794,
            "title": "P9-99: Acceptance gate",
            "state": "open",
            "state_reason": None,
            "labels": [],
        }
        merged_pr = {
            "number": 802,
            "state": "closed",
            "merged_at": "2026-10-03T00:00:00Z",
            "body": "Fixes #794",
        }

        once = reconcile_plan(plan, [issue], [merged_pr])

        self.assertEqual(
            once.splitlines()[-1],
            "| P9-99 | [#794](https://github.com/DanAakesen/jarvis/issues/794) | Acceptance gate | Warm-speed evidence | None | Not started |",
        )
        self.assertEqual(reconcile_plan(once, [issue], [merged_pr]), once)


class FullTaskIdentifierTests(unittest.TestCase):
    plan = """| ID | Issue | Task | Acceptance criteria | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| P9-99 |  | Legacy | Existing behavior | None | Not started |
| P9-100 |  | Completed | Closed issue | P9-99 | Not started |
|  P9-101  |  | Status page | Real checks | P9-99, P9-100 | Not started |
| P12-106 |  | Blocked | Manual block | P9-100...102 | Blocked |
| P9-12345 |  | New task: details | Tests | P9-100, P12-106 | Not started |
"""
    issues = [
        {"number": 99, "title": "P9-99: Legacy", "state": "open"},
        {"number": 100, "title": "P9-100: Completed", "state": "closed", "state_reason": "completed"},
        {"number": 799, "title": "P9-101: Status page", "state": "open", "labels": [{"name": "Dan"}]},
        {"number": 106, "title": "P12-106: Blocked", "state": "open", "labels": [{"name": "Copilot"}]},
    ]

    def test_full_plan_rows_and_issue_mapping_keep_whole_ids(self):
        self.assertEqual(
            [task["id"] for task in plan_tasks(self.plan)],
            ["P9-99", "P9-100", "P9-101", "P12-106", "P9-12345"],
        )
        mapped = task_issue_map(self.issues)
        self.assertEqual(list(mapped), ["P9-99", "P9-100", "P9-101", "P12-106"])
        self.assertEqual(mapped["P9-101"]["number"], 799)

    def test_reconciliation_is_idempotent_and_preserves_other_cells_and_policies(self):
        once = reconcile_plan(self.plan, self.issues, [])
        self.assertEqual(reconcile_plan(once, self.issues, []), once)
        self.assertIn("|  P9-101  | [#799](https://github.com/DanAakesen/jarvis/issues/799)", once)
        self.assertEqual(
            [task["status"] for task in plan_tasks(once)],
            ["Not started", "Complete", "In progress", "Blocked", "Not started"],
        )
        for original, updated in zip(self.plan.splitlines(), once.splitlines()):
            for index, (before, after) in enumerate(zip(original.split("|"), updated.split("|"))):
                if index not in {2, 6}:
                    self.assertEqual(before, after)

    def test_new_issue_generation_uses_full_id_and_dependencies(self):
        pending = new_tasks(self.plan, self.issues, "DanAakesen/jarvis")
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["task_id"], "P9-12345")
        self.assertEqual(pending[0]["title"], "P9-12345: New task")
        self.assertEqual(pending[0]["labels"], ["P9"])
        self.assertEqual(pending[0]["depends_on"], ["P9-100", "P12-106"])

    def test_dependency_ids_require_boundaries_and_deduplicate_without_shortening(self):
        self.assertEqual(
            dependencies_from_text("P9-99, P9-100; P12-106; P9-100"),
            ["P9-99", "P9-100", "P12-106"],
        )
        self.assertEqual(dependencies_from_text("XP9-101 P9-101x P9-101_suffix"), [])
        self.assertEqual(dependencies_from_text("P9-12345"), ["P9-12345"])

    def test_full_ranges_expand_across_digit_widths_and_keep_legacy_order(self):
        for value in ("P9-99...101", "P9-99\N{HORIZONTAL ELLIPSIS}P9-101", "P9-99\N{EN DASH}101", "P9-99-101"):
            with self.subTest(value=value):
                self.assertEqual(dependencies_from_text(value), ["P9-99", "P9-100", "P9-101"])
        self.assertEqual(
            dependencies_from_text("P12-106, P9-100...102, P9-101"),
            ["P9-100", "P9-101", "P9-102", "P12-106"],
        )
        self.assertEqual(dependencies_from_text("P10-01\N{EN DASH}03"), ["P10-01", "P10-02", "P10-03"])
        self.assertEqual(dependencies_from_text("P9-100...102x"), ["P9-100"])

    def test_missing_title_or_row_separator_never_maps_a_shorter_id(self):
        for title in ("P9-101", "P9-101:", "P9-101 Summary", "P9-101x: Summary"):
            with self.subTest(title=title):
                self.assertEqual(task_issue_map([{"title": title, "number": 101}]), {})
        header = self.plan.splitlines()[0] + "\n"
        for task_id in ("P9-101x", "P9-101 Summary", "P9-101:"):
            plan = header + f"| {task_id} |  | Summary | Tests | None | Not started |\n"
            with self.subTest(task_id=task_id):
                self.assertEqual(plan_tasks(plan), [])
                self.assertEqual(reconcile_plan(plan, self.issues, []), plan)

    def test_dependency_range_allows_the_boundary_without_limiting_id_width(self):
        dependencies = dependencies_from_text("P9-99...1098")
        self.assertEqual(len(dependencies), 1000)
        self.assertEqual(dependencies[0], "P9-99")
        self.assertEqual(dependencies[-1], "P9-1098")
        self.assertEqual(
            dependencies_from_text("P9-999999999...1000000000"),
            ["P9-999999999", "P9-1000000000"],
        )

    def test_dependency_range_over_limit_fails_with_actionable_error(self):
        with self.assertRaisesRegex(
            ValueError, r"P9-99\.\.\.1099.*1001 tasks; limit is 1000.*Shorten the range",
        ):
            dependencies_from_text("P9-99...1099")

    def test_oversized_dependency_range_never_starts_iteration(self):
        with patch("plan_status.range", side_effect=AssertionError("must not iterate"), create=True) as iterate:
            with self.assertRaisesRegex(ValueError, r"999999901 tasks; limit is 1000"):
                dependencies_from_text("P9-99...999999999")
            iterate.assert_not_called()


if __name__ == "__main__":
    unittest.main()

    def test_two_digit_phases_are_parsed(self):
        plan = "\n".join([
            "| ID | Issue | Task | Acceptance criteria | Depends on | Status |",
            "| --- | --- | --- | --- | --- | --- |",
            "| P10-02 | | Link tasks to issues | Tests | P10-01, P9-40 | Planned |",
        ])
        tasks = plan_tasks(plan)
        self.assertEqual([task["id"] for task in tasks], ["P10-02"])
        self.assertEqual(tasks[0]["dependencies"], ["P10-01", "P9-40"])
        self.assertEqual(dependencies_from_text("P10-01–03"), ["P10-01", "P10-02", "P10-03"])
