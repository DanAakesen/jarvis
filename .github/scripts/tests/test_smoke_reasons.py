import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from smoke_reasons import MAX_REPORT_BYTES, failure_reasons


class SmokeReasonsTests(unittest.TestCase):
    def test_prints_exact_allowlisted_failure_codes(self):
        self.assertEqual(failure_reasons({"entries": [
            {"id": "chat_canary", "status": "down", "reason": "acceptance_check_failed"},
            {"id": "chat_github_read", "status": "down", "reason": "github_issue_unavailable"},
            {"id": "chat_navigation", "status": "down", "reason": "navigation_refusal_missing"},
        ]}), [
            "smoke_reason chat_canary: acceptance_check_failed",
            "smoke_reason chat_github_read: github_issue_unavailable",
            "smoke_reason chat_navigation: navigation_refusal_missing",
        ])

    def test_never_prints_payloads_unknown_reasons_or_untrusted_check_ids(self):
        lines = failure_reasons({"private": "do-not-log", "entries": [
            {"id": "chat_navigation", "status": "down", "reason": "secret\n::warning::payload",
             "details": {"token": "do-not-log"}, "text": "do-not-log"},
            {"id": "chat_identity", "status": "degraded"},
            {"id": "do-not-log", "status": "down", "reason": "timeout"},
            {"id": "chat_github_read", "status": "down", "reason": ["do-not-log"]},
        ]})
        self.assertEqual(lines, [
            "smoke_reason chat_navigation: not_reported_or_redacted",
            "smoke_reason chat_identity: not_reported_or_redacted",
            "smoke_reason chat_github_read: not_reported_or_redacted",
        ])
        self.assertNotIn("do-not-log", "\n".join(lines))
        self.assertNotIn("::warning::", "\n".join(lines))

    def test_reason_must_belong_to_its_exact_check(self):
        self.assertEqual(failure_reasons({"entries": [
            {"id": "chat_navigation", "status": "down", "reason": "github_issue_unavailable"},
            {"id": "chat_navigation", "status": "down", "reason": "timeout"},
        ]}), [
            "smoke_reason chat_navigation: not_reported_or_redacted",
            "smoke_reason chat_navigation: timeout",
        ])

    def test_healthy_and_unknown_checks_do_not_fabricate_failure_reasons(self):
        self.assertEqual(failure_reasons({"entries": [
            {"id": "chat_navigation", "status": status, "reason": "timeout"}
            for status in ("ok", "unknown")
        ]}), [])

    def test_invalid_shapes_fail_explicitly_without_echoing_input(self):
        for report in [None, [], {}, {"entries": {}}, {"entries": ["private"]},
                       {"entries": [{"id": "chat_jobs", "status": "private"}]},
                       {"entries": [{"id": "chat_jobs", "status": []}]}]:
            with self.subTest(report=report), self.assertRaises(ValueError):
                failure_reasons(report)

    def test_cli_is_bounded_and_does_not_echo_invalid_reports(self):
        script = Path(__file__).resolve().parents[1] / "smoke_reasons.py"
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / "report.json"
            for raw in [b"private-invalid-json", b"\xff", b"x" * (MAX_REPORT_BYTES + 1)]:
                report.write_bytes(raw)
                result = subprocess.run([sys.executable, str(script), str(report)],
                                        capture_output=True, text=True, check=False)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, "")
                self.assertNotIn("private", result.stderr)
            report.write_text(json.dumps({"entries": [
                {"id": "chat_navigation", "status": "down", "reason": "navigation_refusal_missing"},
            ]}), encoding="utf-8")
            result = subprocess.run([sys.executable, str(script), str(report)],
                                    capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout.strip(),
                             "smoke_reason chat_navigation: navigation_refusal_missing")

    def test_workflow_prints_safe_reasons_before_the_unchanged_required_gate(self):
        workflow = Path(__file__).resolve().parents[2] / "workflows" / "deploy.yml"
        source = workflow.read_text(encoding="utf-8")
        diagnostic = 'python .github/scripts/smoke_reasons.py "$response" --evidence'
        gate = """select(.id != "pc_bridge" and .id != "chat_identity" and .id != "chat_no_timestamp" and .status != "ok")"""
        self.assertIn(diagnostic, source)
        self.assertIn(gate, source)
        self.assertLess(source.index(diagnostic), source.index(gate))
        self.assertNotIn('cat "$response"', source)


if __name__ == "__main__":
    unittest.main()
