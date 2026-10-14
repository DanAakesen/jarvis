import json
import os
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = ROOT / ".github/workflows/pr-title.yml"
HEAD = "a" * 40
REPO = "DanAakesen/jarvis"
READ = ["api", "--method", "GET", f"repos/{REPO}/pulls/822"]
ISSUE = ["issue", "view", "826", "--repo", REPO, "--json", "title", "--jq", ".title"]


def metadata(title="P9-113: Current title", body=f"Closes {REPO}#826", **changes):
    result = {
        "number": 822, "title": title, "body": body,
        "head": {"sha": HEAD}, "base": {"repo": {"full_name": REPO}},
        "updated_at": "2026-10-14T07:00:00Z",
    }
    result.update(changes)
    return result


def response(args, value=None, error=None):
    return {"args": args, "stdout": json.dumps(value) if isinstance(value, dict) else value or "",
            "error": error}


class PrTitleGateTests(unittest.TestCase):
    def gate(self, responses, event_title="Build(deps): Bump urllib3", event_body="Upstream body"):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        run = workflow.split("        run: ", 1)[1]
        command = textwrap.dedent(run[2:]) if run.startswith("|\n") else run.strip()
        with tempfile.TemporaryDirectory() as directory:
            scratch = Path(directory)
            plan = scratch / "responses.json"
            plan.write_text(json.dumps(responses), encoding="utf-8")
            calls = scratch / "calls.json"
            calls.write_text("[]", encoding="utf-8")
            gh = scratch / "gh"
            gh.write_text(
                "#!/usr/bin/env python3\n"
                "import json, os, sys\n"
                "from pathlib import Path\n"
                "plan = json.loads(Path(os.environ['RESPONSES']).read_text())\n"
                "path = Path(os.environ['CALLS'])\n"
                "calls = json.loads(path.read_text())\n"
                "index = len(calls)\n"
                "calls.append(sys.argv[1:])\n"
                "path.write_text(json.dumps(calls))\n"
                "if index >= len(plan) or sys.argv[1:] != plan[index]['args']:\n"
                "    sys.exit('Unexpected gh request; network is forbidden: ' + repr(sys.argv[1:]))\n"
                "item = plan[index]\n"
                "if item['error']:\n"
                "    sys.exit(item['error'])\n"
                "print(item['stdout'])\n",
                encoding="utf-8",
            )
            gh.chmod(0o755)
            result = subprocess.run(
                ["bash", "-euo", "pipefail", "-c", command], cwd=ROOT,
                env={**os.environ, "PATH": f"{scratch}:{os.environ['PATH']}",
                     "RESPONSES": str(plan), "CALLS": str(calls),
                     "REPO": REPO, "PR_NUMBER": "822", "PR_HEAD_SHA": HEAD,
                     "PR_TITLE": event_title, "PR_BODY": event_body,
                     "PR_URL": f"https://github.com/{REPO}/pull/822"},
                capture_output=True, text=True, encoding="utf-8", check=False, timeout=10,
            )
            return result, json.loads(calls.read_text(encoding="utf-8"))

    def assert_gate(self, responses, succeeds, message="", **event):
        result, calls = self.gate(responses, **event)
        self.assertEqual(result.returncode == 0, succeeds, result.stdout + result.stderr)
        self.assertIn(message, result.stdout + result.stderr)
        self.assertEqual(calls, [item["args"] for item in responses])
        return result

    def stable(self, current, issue_title="P9-113: Task"):
        responses = [response(READ, current)]
        if current["body"]:
            responses.append(response(ISSUE, issue_title))
        return responses + [response(READ, current)]

    def test_old_event_uses_current_same_head_metadata(self):
        self.assert_gate(self.stable(metadata()), True, "Validated current PR")

    def test_invalid_current_title_does_not_use_valid_event(self):
        self.assert_gate(
            self.stable(metadata("No task ID", None)), False, "No task ID",
            event_title="P9-113: Previously valid", event_body="Closes #826",
        )

    def test_current_missing_id_and_link_fails(self):
        self.assert_gate(self.stable(metadata("No task ID", None)), False, "No task ID")

    def test_current_issue_links_and_full_ids(self):
        for keyword in ("Fixes", "closes", "RESOLVES", "Refs"):
            for link in ("#826", f"{REPO}#826"):
                for task in ("P0-05", "P9-113", "P9-12345", "P12-106"):
                    with self.subTest(keyword=keyword, link=link, task=task):
                        self.assert_gate(
                            self.stable(metadata("Summary", f"{keyword} {link}"), f"{task}: Task"),
                            False, f"{task}: Summary",
                        )

    def test_linked_id_boundaries_remain_unchanged(self):
        for issue_title in ("P9-113x: Task", "P9-113_suffix: Task", "No task ID"):
            with self.subTest(issue_title=issue_title):
                self.assert_gate(self.stable(metadata("Summary"), issue_title), False, "No task ID")

    def test_foreign_repo_link_is_not_a_local_issue(self):
        self.assert_gate(self.stable(metadata("Summary", None))[:1] + [
            response(READ, metadata("Summary", "Closes other/repo#826"))
        ], False)

    def test_wip_fix_main_docs_and_normalization(self):
        for title in ("[WIP] P9-113: Summary", "fix-main: Summary", "docs: Summary",
                      "[WIP] fix-main: Summary", "[WIP] docs: Summary"):
            with self.subTest(title=title):
                self.assert_gate(self.stable(metadata(title, None)), True)
        for title in ("[P9-113] Summary", "[WIP] [P9-113] Summary"):
            with self.subTest(title=title):
                self.assert_gate(self.stable(metadata(title, None)), False, "P9-113: Summary")

    def test_api_failure_is_explicit_at_each_read(self):
        current = metadata()
        for responses, message in (
            ([response(READ, error="HTTP 503")], "Could not read"),
            ([response(READ, current), response(ISSUE, error="HTTP 403")], "Could not read linked issue"),
            (self.stable(current)[:-1] + [response(READ, error="HTTP 429")], "Could not read"),
        ):
            with self.subTest(message=message):
                self.assert_gate(responses, False, message)

    def test_wrong_head_or_pr_is_rejected_without_issue_lookup(self):
        for change in ({"head": {"sha": "b" * 40}}, {"number": 823},
                       {"base": {"repo": {"full_name": "other/repo"}}}):
            with self.subTest(change=change):
                self.assert_gate([response(READ, metadata(**change))], False)

    def test_malformed_api_metadata_fails_closed(self):
        for value in ("not JSON", {}, metadata(title=None), metadata(body=42)):
            with self.subTest(value=value):
                self.assert_gate([response(READ, value)], False, "Invalid PR metadata")

    def test_title_body_head_and_timestamp_races_never_write(self):
        current = metadata()
        for change in ({"title": "P9-113: Newer title"}, {"body": "Closes #999"},
                       {"head": {"sha": "b" * 40}}, {"updated_at": "2026-10-14T07:01:00Z"}):
            with self.subTest(change=change):
                responses = self.stable(current)[:-1] + [response(READ, metadata(**change))]
                self.assert_gate(responses, False, "changed")

    def test_untrusted_metadata_is_not_evaluated_or_logged_as_commands(self):
        title = 'P9-113: $(exit 73) `exit 74`; "quoted" & <tag>'
        self.assert_gate(self.stable(metadata(title, "Closes #826\n$(exit 75)")), True)
        result = self.assert_gate(
            self.stable(metadata("Summary\n::warning::injected", None)), False,
        )
        self.assertNotIn("\n::warning::injected", result.stdout)


if __name__ == "__main__":
    unittest.main()
