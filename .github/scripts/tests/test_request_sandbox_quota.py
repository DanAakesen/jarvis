import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PATH = Path(__file__).resolve().parents[1] / 'request_sandbox_quota.py'
SPEC = importlib.util.spec_from_file_location('sandbox_quota', PATH)
quota = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(quota)
SUB = '00000000-0000-4000-8000-000000000001'


class SandboxQuotaTests(unittest.TestCase):
    def run_request(self, limits, catalogue, *, put_error=False, inspect_only=False):
        calls = []
        def call(method, url, body=None):
            calls.append((method, url, body))
            if method == 'PUT':
                if put_error:
                    raise RuntimeError('Quota API: unknown result')
                return {}
            if url == 'usage':
                return {'value': [{'name': {'value': 'SandboxCores'}, 'limit': limits.pop(0)}]}
            return {'value': catalogue}
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'state.json'
            try:
                quota.request(SUB, state, make_client=lambda _: ('quota', 'usage', call), pause=lambda _: None, inspect_only=inspect_only)
            except RuntimeError:
                pass
            result = json.loads(state.read_text())
        return result, calls

    def test_existing_higher_quota_is_never_lowered(self):
        result, calls = self.run_request([1000], [])
        self.assertTrue(result['approved'])
        self.assertEqual(len(calls), 1)

    def test_one_exact_request_requires_real_usage_readback(self):
        result, calls = self.run_request([300, 300, 800], [{'properties': {'name': {'value': 'SandboxCores'}}}])
        writes = [x for x in calls if x[0] == 'PUT']
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0][2]['properties']['limit']['value'], 800)
        self.assertTrue(result['approved'])
        self.assertEqual(result['workersAllocated'], 0)

    def test_missing_resource_never_submits_a_guessed_name(self):
        result, calls = self.run_request([300], [])
        self.assertFalse(result['requestAttempted'])
        self.assertFalse(any(x[0] == 'PUT' for x in calls))

    def test_uncertain_write_is_not_replayed(self):
        result, calls = self.run_request([300], [{'properties': {'name': {'value': 'SandboxCores'}}}], put_error=True)
        self.assertTrue(result['requestAttempted'])
        self.assertFalse(result['approved'])
        self.assertEqual(sum(x[0] == 'PUT' for x in calls), 1)

    def test_request_does_not_imply_approval(self):
        result, _ = self.run_request([300] * 16, [{'properties': {'name': {'value': 'SandboxCores'}}}])
        self.assertTrue(result['submitted'])
        self.assertFalse(result['approved'])

    def test_integral_usage_limit_accepts_json_decimal_representation(self):
        self.assertEqual(quota.actual_limit({'value': [{'name': {'value': 'SandboxCores'}, 'limit': 800.0}]}), 800)

    def test_invalid_usage_limit_cannot_claim_approval(self):
        for limit in (True, '800', 800.5, float('inf'), -1):
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                quota.actual_limit({'value': [{'name': {'value': 'SandboxCores'}, 'limit': limit}]})

    def test_other_services_or_quota_targets_never_reach_azure(self):
        base, _, call = quota.client(SUB)
        with patch.object(quota.subprocess, 'run') as run:
            for url, body in [('https://outside.invalid/private', None),
                              (base + '/OtherCores', {}),
                              (base + '/SandboxCores', {'properties': {'limit': {'value': 1000}}})]:
                with self.assertRaises(ValueError):
                    call('PUT', url, body)
            run.assert_not_called()

    def test_inspection_never_submits_a_request(self):
        result, calls = self.run_request([300], [{'properties': {'name': {'value': 'SandboxCores'}}}], inspect_only=True)
        self.assertTrue(result['inspectOnly'])
        self.assertFalse(result['requestAttempted'])
        self.assertTrue(all(call[0] == 'GET' for call in calls))

    def test_quota_diagnostics_preserve_reason_without_credentials(self):
        text = quota.sanitized_detail('ERROR: BadRequest: Contact support for quota 800. Bearer private-value token=private-value https://host?sig=private-value')
        self.assertIn('Contact support for quota 800.', text)
        self.assertNotIn('private-value', text)
        self.assertNotIn('https://', text)
