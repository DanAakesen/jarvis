import unittest

from worker_label import label_changes, wants_label


def issue(number=7, assignees=(), labels=(), state="open"):
    return {
        "number": number,
        "state": state,
        "assignees": [{"login": login} for login in assignees],
        "labels": [{"name": name} for name in labels],
    }


def pull(body, state="open", merged=False):
    return {"body": body, "state": state, "merged_at": "2026-10-03T00:00:00Z" if merged else None}


class WorkerLabelTests(unittest.TestCase):
    def test_open_copilot_pr_claims_the_issue(self):
        self.assertTrue(wants_label(issue(), [pull("Fixes #7")]))

    def test_assignment_claims_before_the_pr_exists(self):
        self.assertTrue(wants_label(issue(assignees=["Copilot"]), []))

    def test_closed_unmerged_pr_releases_even_if_still_assigned(self):
        self.assertFalse(wants_label(issue(assignees=["Copilot"]), [pull("Fixes #7", state="closed")]))

    def test_replacement_pr_reclaims_after_an_abandoned_one(self):
        pulls = [pull("Fixes #7", state="closed"), pull("Closes #7")]
        self.assertTrue(wants_label(issue(assignees=["Copilot"]), pulls))

    def test_unassigned_issue_without_open_pr_is_free(self):
        self.assertFalse(wants_label(issue(), [pull("Fixes #7", state="closed", merged=True)]))

    def test_other_issues_and_refs_do_not_count(self):
        self.assertFalse(wants_label(issue(), [pull("Fixes #70"), pull("Refs #7")]))

    def test_changes_only_touch_open_issues_that_differ(self):
        issues = [
            issue(1, assignees=["Copilot"]),                  # needs label
            issue(2, labels=["Copilot"]),                     # stale label, remove
            issue(3, assignees=["Copilot"], labels=["Copilot"]),  # already right
            issue(4, labels=["Copilot"], state="closed"),     # closed: keep as record
            {"number": 5, "state": "open", "pull_request": {}, "labels": [], "assignees": []},
        ]
        self.assertEqual(label_changes(issues, []), [(1, True), (2, False)])


if __name__ == "__main__":
    unittest.main()