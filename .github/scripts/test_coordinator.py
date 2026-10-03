"""Coordinator integration contracts with a stateful, offline GitHub boundary."""

import base64
import copy
import io
import unittest
from contextlib import redirect_stdout
from urllib.parse import parse_qs, urlsplit

from coordinator import MARKER, Coordinator

PLAN = """
| ID | Task | Acceptance | Depends on | Status |
| --- | --- | --- | --- | --- |
| P0-01 | Foundation | Checked | — | Complete |
| P0-03 | Backend | Checked | P0-01 | Not started |
| P0-04 | Other task | Checked | P0-01 | Not started |
"""


def issue(number, state="open", worker=None):
    return {"number": number, "title": f"P0-{number:02}: Task", "state": state,
            "labels": [{"name": worker}] if worker else [], "assignees": []}


def pull(number=101, **overrides):
    return {"number": number, "title": "P0-03: Backend", "state": "open",
            "draft": False, "body": "", "labels": [], "mergeable": True,
            "head": {"sha": f"head-{number}", "ref": f"work-{number}",
                     "repo": {"full_name": "DanAakesen/jarvis"}},
            "base": {"ref": "main"}, "user": {"login": "human-worker"}, **overrides}


def ci_run(sha, success=True):
    return {"id": 1, "run_number": 1, "run_attempt": 1, "name": "CI", "head_sha": sha,
            "status": "completed", "conclusion": "success" if success else "failure",
            "path": ".github/workflows/ci.yml"}


class FakeGitHub:
    """Recognize actual endpoints and record writes; unexpected calls fail tests."""

    repo = "DanAakesen/jarvis"

    def __init__(self, user_token="user-token"):
        self.copilot_token = user_token
        self.sha = "main-a"
        self.main_reads = []
        self.plan = PLAN
        self.issues = [issue(1, "closed"), issue(3), issue(4)]
        self.pulls = []
        self.integrated = {}
        self.timelines = {}
        self.comments = {}
        self.files = {}
        self.ci = {self.sha: [ci_run(self.sha)]}
        self.blockers = {}
        self.issue_refresh = {}
        self.reads = []
        self.writes = []
        self.reviews_unresolved = False

    def add_pull(self, value, integrated=True, ci=True):
        self.pulls.append(copy.deepcopy(value))
        self.integrated[value["number"]] = integrated
        head = value["head"]["sha"]
        self.ci[head] = [ci_run(head)] if ci else []

    def current_pull(self, number):
        return next(value for value in self.pulls if value["number"] == number)

    def request(self, method, path, body=None, user_token=False):
        if method != "GET":
            self.writes.append((method, path, copy.deepcopy(body), user_token))
            if path.endswith("/merge"):
                self.sha = "main-after-merge"
                return {"merged": True}
            if path.endswith("/update-branch"):
                return {"message": "Updating pull request branch", "url": "ignored"}
            if path.endswith("/labels"):
                number = int(path.rsplit("/", 2)[1])
                current = next(value for value in self.issues if value["number"] == number)
                current["labels"].extend({"name": name} for name in body["labels"])
                return None
            if method == "DELETE" and path.endswith("/labels/Copilot"):
                number = int(path.rsplit("/", 3)[1])
                current = next(value for value in self.issues if value["number"] == number)
                current["labels"] = [label for label in current["labels"] if label["name"] != "Copilot"]
                return None
            if path.endswith("/dispatches"):
                return None
            raise AssertionError(f"Unexpected mutation: {method} {path}")
        self.reads.append((method, path))
        parsed = urlsplit(path)
        resource = parsed.path.removeprefix("/repos/DanAakesen/jarvis")
        if resource == "/git/ref/heads/main":
            sha = self.main_reads.pop(0) if self.main_reads else self.sha
            return {"object": {"sha": sha}}
        if resource == "/contents/PLAN.md":
            return {"encoding": "base64", "content": base64.b64encode(self.plan.encode()).decode()}
        if resource.startswith("/pulls/"):
            return copy.deepcopy(self.current_pull(int(resource.rsplit("/", 1)[1])))
        if resource.startswith("/compare/"):
            target = resource.rsplit("...", 1)[1]
            value = next(value for value in self.pulls if value["head"]["sha"] == target)
            return {"merge_base_commit": {"sha": self.sha if self.integrated[value["number"]] else "older-main"}}
        if resource.startswith("/issues/"):
            number = int(resource.rsplit("/", 1)[1])
            return copy.deepcopy(self.issue_refresh.get(number, next(value for value in self.issues if value["number"] == number)))
        raise AssertionError(f"Unexpected GET: {path}")

    def pages(self, path, key=None, user_token=False):
        self.reads.append(("PAGES", path))
        parsed = urlsplit(path)
        query = parse_qs(parsed.query)
        resource = parsed.path.removeprefix("/repos/DanAakesen/jarvis")
        if resource == "/pulls":
            return copy.deepcopy(self.pulls)
        if resource == "/issues":
            return copy.deepcopy(self.issues)
        if resource == "/actions/workflows/ci.yml/runs":
            self.assert_key(key, "workflow_runs")
            return copy.deepcopy(self.ci.get(query.get("head_sha", [self.sha])[0], []))
        if resource.startswith("/pulls/") and resource.endswith("/files"):
            number = int(resource.split("/")[2])
            return [{"filename": filename} for filename in self.files.get(number, ["apps/backend/src/index.ts"])]
        if resource.startswith("/issues/"):
            number = int(resource.split("/")[2])
            if resource.endswith("/timeline"):
                return copy.deepcopy(self.timelines.get(number, []))
            if resource.endswith("/comments"):
                return copy.deepcopy(self.comments.get(number, []))
            if resource.endswith("/dependencies/blocked_by"):
                return copy.deepcopy(self.blockers.get(number, []))
        if resource.startswith("/commits/"):
            sha = resource.split("/")[2]
            if resource.endswith("/check-runs"):
                self.assert_key(key, "check_runs")
                return ([{"id": 1, "name": "CI result", "head_sha": sha,
                          "status": "completed", "conclusion": "success"}] if self.ci.get(sha) else [])
            if resource.endswith("/statuses"):
                return []
        raise AssertionError(f"Unexpected pagination: {path}")

    @staticmethod
    def assert_key(actual, expected):
        if actual != expected:
            raise AssertionError(f"Wrong collection envelope {actual}, expected {expected}")

    def graphql(self, query, variables, user_token=False):
        self.reads.append(("GRAPHQL", variables["number"]))
        return {"repository": {"pullRequest": {"reviewDecision": None,
                "reviewThreads": {"nodes": [{"isResolved": not self.reviews_unresolved}],
                                  "pageInfo": {"hasNextPage": False}}}}}

    def repair_comment(self, number, body):
        self.writes.append(("REPAIR", number, body, True))
        self.comments.setdefault(number, []).append({"body": body, "created_at": "2026-10-03T20:00:00Z"})


class CoordinatorTests(unittest.TestCase):

    def execute(self, api, dry_run=False):
        coordinator = Coordinator(api, dry_run=dry_run)
        with redirect_stdout(io.StringIO()):
            coordinator.run()
        return coordinator

    def test_dry_run_never_merges_repairs_updates_or_dispatches(self):
        for scenario in ["ready", "conflict", "behind", "missing-main-ci", "issues"]:
            with self.subTest(scenario=scenario):
                api = FakeGitHub()
                if scenario != "issues":
                    value = pull(title="fix-main: Repair")
                    api.add_pull(value, integrated=scenario != "behind")
                    if scenario == "conflict":
                        api.current_pull(101)["mergeable"] = False
                    if scenario == "missing-main-ci":
                        api.ci[api.sha] = []
                self.execute(api, dry_run=True)
                self.assertEqual(api.writes, [])

    def test_missing_copilot_secret_leaves_conflicts_unmodified(self):
        api = FakeGitHub(user_token="")
        api.add_pull(pull(mergeable=False), integrated=False)
        coordinator = self.execute(api)
        self.assertEqual(api.writes, [])
        self.assertTrue(any("COPILOT_ASSIGNMENT_TOKEN" in line for line in coordinator.lines))

    def test_one_merge_stops_other_prs(self):
        api = FakeGitHub()
        api.add_pull(pull(102))
        api.add_pull(pull(101))
        self.execute(api)
        self.assertEqual(len(api.writes), 1)
        method, path, body, user_token = api.writes[0]
        self.assertEqual((method, path.rsplit("/", 2)[-2], body, user_token),
                         ("PUT", "101", {"merge_method": "squash", "sha": "head-101"}, True))
        self.assertNotIn(("GRAPHQL", 102), api.reads)
        self.assertGreaterEqual(sum(path.endswith("/git/ref/heads/main") for method, path in api.reads if method == "GET"), 3)

    def test_moving_main_at_last_gate_prevents_merge(self):
        api = FakeGitHub()
        api.add_pull(pull())
        api.main_reads = ["main-a", "main-a", "main-b"]
        coordinator = self.execute(api)
        self.assertEqual(api.writes, [])
        self.assertIn("Main changed before merge; deferred.", coordinator.lines)

    def test_head_change_at_final_inspection_prevents_merge(self):
        api = FakeGitHub(user_token="")
        api.add_pull(pull())
        coordinator = Coordinator(api)
        original = coordinator.pull_detail
        calls = 0

        def moving_head(number, sha):
            nonlocal calls
            calls += 1
            if calls == 2:
                value = api.current_pull(number)
                value["head"]["sha"] = "new-head"
                api.ci["new-head"] = [ci_run("new-head")]
            return original(number, sha)

        coordinator.pull_detail = moving_head
        with redirect_stdout(io.StringIO()):
            coordinator.run()
        self.assertEqual(api.writes, [])

    def test_repair_marker_blocks_duplicate_before_started_event_appears(self):
        api = FakeGitHub(user_token="user-token")
        api.issues = [issue(1, "closed"), issue(3, worker="Codex"), issue(4, worker="Dan")]
        api.add_pull(pull(mergeable=False), integrated=False)
        self.execute(api)
        self.assertEqual([write[0] for write in api.writes], ["REPAIR"])
        self.assertIn(f"<!-- {MARKER}:101:head-101:main-a -->", api.writes[0][2])
        api.writes.clear()
        self.execute(api)
        self.assertEqual(api.writes, [])

    def test_pending_repair_marker_prevents_merge_until_later_completion(self):
        api = FakeGitHub()
        api.add_pull(pull())
        api.comments[101] = [{"body": f"<!-- {MARKER}:101:older-head:older-main -->", "created_at": "2026-10-03T20:00:00Z"}]
        api.timelines[101] = [{"event": "copilot_work_finished", "created_at": "2026-10-03T19:59:00Z"}]
        coordinator = Coordinator(api)
        self.assertFalse(coordinator.pull_detail(101, "main-a")[3])
        api.timelines[101].append({"event": "copilot_work_finished", "created_at": "2026-10-03T20:01:00Z"})
        self.assertTrue(coordinator.pull_detail(101, "main-a")[3])

    def test_completed_copilot_draft_can_be_repaired_but_active_human_draft_is_untouched(self):
        for tracked, finished in [(True, True), (True, False), (False, False)]:
            with self.subTest(tracked=tracked, finished=finished):
                api = FakeGitHub()
                api.issues = []
                api.add_pull(pull(draft=True, mergeable=False), integrated=False)
                if tracked:
                    api.timelines[101] = [{"event": "copilot_work_finished" if finished else "copilot_work_started",
                                          "created_at": "2026-10-03T19:00:00Z"}]
                self.execute(api)
                self.assertEqual([write[0] for write in api.writes], ["REPAIR"] if tracked and finished else [])

    def test_async_branch_update_dispatches_ci_only_after_new_integrated_head_is_observed(self):
        api = FakeGitHub(user_token="")
        api.add_pull(pull(), integrated=False)
        self.execute(api)
        self.assertEqual([write[1].rsplit("/", 1)[-1] for write in api.writes], ["update-branch"])
        self.assertEqual(api.writes[0][2], {"expected_head_sha": "head-101"})
        # The accepted 202 hasn't changed the head yet; no stale CI dispatch.
        self.assertEqual(api.current_pull(101)["head"]["sha"], "head-101")
        api.writes.clear()
        api.current_pull(101)["head"]["sha"] = "integrated-head"
        api.integrated[101] = True
        api.ci["integrated-head"] = []
        self.execute(api)
        self.assertEqual(api.writes, [("POST", "/repos/DanAakesen/jarvis/actions/workflows/ci.yml/dispatches", {"ref": "work-101"}, False)])
        api.writes.clear()
        api.ci["integrated-head"] = [ci_run("integrated-head", success=False)]
        self.execute(api)
        self.assertEqual(api.writes, [])


    def test_open_unclaimed_issues_cannot_start_jobs_or_touch_the_board(self):
        for dry_run in [True, False]:
            with self.subTest(dry_run=dry_run):
                api = FakeGitHub()
                self.execute(api, dry_run=dry_run)
                self.assertEqual(api.writes, [])
                self.assertFalse(any(path.startswith("/repos/DanAakesen/jarvis/issues")
                                     for method, path in api.reads))
                self.assertFalse(any(method == "GRAPHQL" for method, path in api.reads))

    def test_workflow_token_merge_explicitly_dispatches_main_ci_without_more_merges(self):
        api = FakeGitHub(user_token="")
        api.add_pull(pull())
        api.add_pull(pull(102))
        api.files[101] = ["README.md"]
        self.execute(api)
        self.assertEqual([write[0] for write in api.writes], ["PUT", "POST"])
        self.assertTrue(api.writes[0][1].endswith("/pulls/101/merge"))
        self.assertEqual(api.writes[1][2], {"ref": "main"})

    def test_unresolved_review_prevents_otherwise_ready_merge(self):
        api = FakeGitHub(user_token="")
        api.add_pull(pull())
        api.reviews_unresolved = True
        self.execute(api)
        self.assertEqual(api.writes, [])

    def test_workflow_with_wrong_source_path_cannot_authorize_merge(self):
        api = FakeGitHub(user_token="")
        api.add_pull(pull())
        api.ci["head-101"][0]["path"] = ".github/workflows/untrusted-ci.yml"
        self.execute(api)
        self.assertFalse(any(write[1].endswith("/merge") for write in api.writes))

    def test_aggregate_workflow_evidence_uses_exact_head_and_named_workflow_endpoint(self):
        api = FakeGitHub(user_token="")
        api.add_pull(pull(), ci=False)
        self.execute(api)
        self.assertTrue(any("/actions/workflows/ci.yml/runs?branch=work-101&head_sha=head-101" in path
                            for method, path in api.reads if method == "PAGES"))
        self.assertFalse(any("/actions/runs" in path for method, path in api.reads if method == "PAGES"))
        self.assertEqual([write[0] for write in api.writes], ["POST"])

    def test_legitimate_docs_pr_behind_main_gets_branch_update(self):
        api = FakeGitHub(user_token="")
        api.add_pull(pull(title="docs: Update instructions"), integrated=False)
        api.files[101] = ["README.md"]
        self.execute(api)
        self.assertEqual([write[1].rsplit("/", 1)[-1] for write in api.writes], ["update-branch"])

    def test_docs_title_on_code_never_gets_maintenance_or_merge(self):
        api = FakeGitHub(user_token="")
        api.add_pull(pull(title="docs: Update instructions"), integrated=False)
        self.execute(api)
        self.assertEqual(api.writes, [])


if __name__ == "__main__":
    unittest.main()
