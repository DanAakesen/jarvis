import unittest

from backend_log_preflight import PreflightBlocked
from chat_failure_diagnostics import allowed_codes, query, safe_rows
from pipeline_impact import deploy_parts


def payload(rows):
    return {'tables': [{'columns': [{'name': 'at', 'type': 'datetime'}, {'name': 'failure', 'type': 'string'}], 'rows': rows}]}


class ChatFailureDiagnosticsTests(unittest.TestCase):
    def test_emits_only_known_codes_and_never_raw_error_text(self):
        rows = safe_rows(payload([
            ['2026-11-08T20:00:00.123Z', 'Chat agent failed (model_bad_request_input)'],
            ['2026-11-08T20:01:00Z', 'private user text secret=value'],
            ['2026-11-08T20:02:00Z', 'Chat agent failed (synthetic_private_code)'],
        ]), allowed_codes())
        self.assertEqual([row['code'] for row in rows], ['model_bad_request_input', 'unclassified', 'unclassified'])
        self.assertNotIn('private', str(rows))
        self.assertNotIn('secret', str(rows))

    def test_fixed_query_scope_and_no_production_deploy_impact(self):
        value = query('ca-jarvis-backend-abcdefghijklm')
        self.assertIn('top 50 by at desc', value)
        self.assertIn('ago(12h)', value)
        for bad in ['', "ca-jarvis-backend-x' | take 1", 'another-app']:
            with self.assertRaises(PreflightBlocked):
                query(bad)
        for path in ['.github/scripts/chat_failure_diagnostics.py', '.github/workflows/chat-diagnostics.yml']:
            self.assertEqual(deploy_parts(path), set())

    def test_rejects_unexpected_columns_time_and_unbounded_rows(self):
        for body in [payload([['private text', 'error']]), payload([['2026-11-08T20:00:00Z', 'error']] * 51), {'tables': []}]:
            with self.assertRaises(PreflightBlocked):
                safe_rows(body, allowed_codes())
