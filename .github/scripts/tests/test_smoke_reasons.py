import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

from smoke_reasons import (
    CHAT_AGENT_FAILURE_REASONS, CHAT_AGENT_INVOCATION_REASONS, CHECK_IDS, MAX_REPORT_BYTES, SAFE_REASONS,
    failure_reasons, report_ok, safe_report,
)

BACKEND_STATUS_SOURCE = Path(__file__).resolve().parents[3] / "apps/backend/src/system-status.ts"


def backend_reason_set(name: str) -> set[str]:
    source = BACKEND_STATUS_SOURCE.read_text(encoding="utf-8")
    block = source.split(f"export const {name}:", 1)[1].split("]);", 1)[0]
    return set(re.findall(r"'([a-z0-9_]+)'", block))


class SmokeReasonsTests(unittest.TestCase):
    def test_rate_limit_is_named_for_every_chat_check_in_logs_and_artifacts(self):
        report = {"entries": [
            {"id": check, "status": "down" if check.startswith("chat_") else "ok",
             "reason": "rate_limit_exceeded"} for check in sorted(CHECK_IDS)
        ]}
        retained = safe_report(report)
        self.assertFalse(report_ok(retained))
        self.assertEqual(failure_reasons(retained), [
            f"smoke_reason {check}: rate_limit_exceeded" for check in sorted(SAFE_REASONS)
        ])

    def test_hosted_origin_allowlist_matches_the_backend_exactly(self):
        self.assertEqual(backend_reason_set("chatAgentFailureReasons"), CHAT_AGENT_FAILURE_REASONS)

    def test_backend_side_failure_allowlist_matches_the_backend_exactly(self):
        self.assertEqual(backend_reason_set("chatAgentInvocationReasons"), CHAT_AGENT_INVOCATION_REASONS)
        self.assertFalse(CHAT_AGENT_INVOCATION_REASONS & CHAT_AGENT_FAILURE_REASONS)

    def test_fixed_hosted_and_backend_reasons_survive_artifact_sanitization_and_still_fail_acceptance(self):
        for code in sorted(CHAT_AGENT_FAILURE_REASONS | CHAT_AGENT_INVOCATION_REASONS):
            with self.subTest(code=code):
                report = {"entries": [{"id": check, "status": "ok"} for check in sorted(CHECK_IDS)]}
                entry = next(entry for entry in report["entries"] if entry["id"] == "chat_capabilities")
                entry.update({"status": "down", "reason": code,
                              "message": "never-retain", "details": {"token": "never-retain"}})
                retained = safe_report(report)
                self.assertIn({"id": "chat_capabilities", "status": "down", "reason": code},
                              retained["entries"])
                self.assertEqual(failure_reasons(retained), [f"smoke_reason chat_capabilities: {code}"])
                self.assertFalse(report_ok(retained))
                self.assertNotIn("never-retain", json.dumps(retained))
                self.assertEqual(code in SAFE_REASONS["chat_canary"], code == "rate_limit_exceeded")
                for check in SAFE_REASONS.keys() - {"chat_canary"}:
                    self.assertIn(code, SAFE_REASONS[check])

    def test_unknown_code_shaped_origins_are_redacted_in_logs_and_artifacts(self):
        for code in ("private_provider_detail", "settings_http_418", "error_privateexception",
                     "agent_http_418", "agent_error_code_other",
                     "settings_timeout\n::error::private"):
            with self.subTest(code=code):
                report = {"entries": [{"id": check, "status": "ok"} for check in sorted(CHECK_IDS)]}
                next(entry for entry in report["entries"] if entry["id"] == "chat_capabilities").update(
                    {"status": "down", "reason": code})
                retained = safe_report(report)
                self.assertEqual(failure_reasons(retained),
                                 ["smoke_reason chat_capabilities: not_reported_or_redacted"])
                self.assertFalse(report_ok(retained))
                self.assertNotIn(code, json.dumps(retained))

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
