import unittest

from project_board import desired_status, items_to_mark_done, linked_issue_numbers


def issue(number=7, labels=(), blocked_by=0):
    return {
        "number": number,
        "state": "open",
        "labels": [{"name": name} for name in labels],
        "issue_dependencies_summary": {"blocked_by": blocked_by, "total_blocked_by": blocked_by},
    }


def pull(body, draft=False):
    return {"body": body, "draft": draft}


class ProjectBoardTests(unittest.TestCase):
    def test_unblocked_unclaimed_issue_is_ready(self):
        self.assertEqual(desired_status(issue(), []), "Ready")

    def test_blocked_issue_is_backlog(self):
        self.assertEqual(desired_status(issue(blocked_by=2), []), "Backlog")

    def test_worker_label_means_in_progress_even_when_blocked(self):
        for label in ("Codex", "Copilot", "Dan", "Jarvis"):
            self.assertEqual(desired_status(issue(labels=[label], blocked_by=1), []), "In progress")

    def test_needs_decision_issue_waits_for_dan_even_when_blocked(self):
        self.assertEqual(desired_status(issue(labels=["needs-decision"]), []), "Needs Dan")
        self.assertEqual(desired_status(issue(labels=["needs-decision"], blocked_by=1), []), "Needs Dan")

    def test_claimed_needs_decision_issue_is_in_progress(self):
        self.assertEqual(desired_status(issue(labels=["needs-decision", "Dan"]), []), "In progress")

    def test_other_labels_are_ignored(self):
        self.assertEqual(desired_status(issue(labels=["P0"]), []), "Ready")

    def test_open_draft_pr_means_in_progress(self):
        self.assertEqual(desired_status(issue(), [pull("Fixes #7", draft=True)]), "In progress")

    def test_open_ready_pr_means_in_review(self):
        self.assertEqual(desired_status(issue(labels=["Codex"]), [pull("Closes #7")]), "In review")

    def test_pr_for_another_issue_or_refs_does_not_count(self):
        pulls = [pull("Fixes #70"), pull("Refs #7")]
        self.assertEqual(desired_status(issue(), pulls), "Ready")

    def test_linked_issue_numbers(self):
        self.assertEqual(linked_issue_numbers("fixes #1, Resolves #22\ncloses #3 refs #4"), {1, 22, 3})
        self.assertEqual(linked_issue_numbers(None), set())

    def test_closed_issues_not_in_done_are_moved_to_done(self):
        def item(number, state, status):
            return {"id": f"item-{number}", "content": {"number": number, "state": state},
                    "fieldValueByName": {"name": status} if status else None}
        items = [item(1, "CLOSED", "In review"), item(2, "CLOSED", "Done"), item(3, "OPEN", "In review"),
                 item(4, "CLOSED", None), {"id": "draft", "content": None, "fieldValueByName": None}]
        self.assertEqual([entry["id"] for entry in items_to_mark_done(items)], ["item-1", "item-4"])


if __name__ == "__main__":
    unittest.main()