import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "managed_chat_diagnostic_output.py"
SHAPES = ["conversation_developer_policy", "conversation_system_policy"]


class DiagnosticOutputTests(unittest.TestCase):
    def run_output(self, mode, raw):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "private.json"
            path.write_bytes(raw)
            return subprocess.run([sys.executable, str(SCRIPT), mode, str(path)],
                                  capture_output=True, text=True, timeout=5, check=False)

    def test_malformed_oversized_deep_and_scalar_inputs_never_leak_or_raise_traceback(self):
        for raw in [b"private_raw", b"\xffprivate_raw", b"[]", b"null", b"true", b"1",
                    b'"private_identifier"', b'{"private_identifier":',
                    b'{"private_identifier":"' + b"x" * (2 * 1024 * 1024) + b'"}',
                    b"[" * 2000 + b'"private_identifier"' + b"]" * 2000]:
            for mode in ["canary", "diagnostics"]:
                result = self.run_output(mode, raw)
                self.assertEqual(result.returncode, 0 if mode == "canary" else 1)
                self.assertEqual(result.stderr, "")
                self.assertNotIn("private", result.stdout)
                self.assertNotIn("provider_", result.stdout)

    def test_only_closed_nested_metadata_survives_forged_diagnostic_payload(self):
        rows = [{"shape": shape, "status": "unavailable", "reason": "private_identifier",
                 "stage": "private_identifier", "providerCause": {
                     "code": "private_identifier", "param": "private_identifier",
                     "exceptionType": "PrivateIdentifier", "details": [
                         {"code": "UnsupportedParameter", "target": "input.role", "message": "private"},
                         {"code": "private_identifier", "target": "private_identifier"},
                     ], "body": {"private_identifier": "private"}}} for shape in SHAPES]
        raw = json.dumps({"status": "diagnostic", "results": rows}).encode()
        result = self.run_output("diagnostics", raw)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, "")
        self.assertEqual(len(result.stdout.splitlines()), 2)
        self.assertIn("provider_detail_0_code=UnsupportedParameter provider_detail_0_target=input.role", result.stdout)
        self.assertNotIn("private", result.stdout.lower())

    def test_matrix_requires_exact_order_count_and_statuses_before_printing_any_evidence(self):
        rows = [{"shape": shape, "status": "ok"} for shape in SHAPES]
        for bad in [rows[::-1], rows[:-1], rows + rows, [None] * 2,
                    [{**rows[0], "status": ["ok"]}, *rows[1:]],
                    [{**rows[0], "shape": {"private_identifier": "private"}}, *rows[1:]]]:
            result = self.run_output("diagnostics", json.dumps({"status": "diagnostic", "results": bad}).encode())
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout + result.stderr, "")


if __name__ == "__main__":
    unittest.main()
