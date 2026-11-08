import copy
import importlib.util
import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('worker_quota', Path(__file__).parents[1] / 'request_worker_quota.py')
quota = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quota)


class FakeQuota:
    def __init__(self, limit=0, usage=0, approve=True):
        self.limits = dict.fromkeys(quota.RESOURCES, limit)
        self.usage = usage
        self.approve = approve
        self.calls = []
        self.failure = None

    def snapshot(self, resource):
        return {'resource': resource, 'limit': self.limits[resource], 'usage': self.usage,
                'requiredLimit': quota.required_limit(self.limits[resource], self.usage)}

    def submit(self, resource, target):
        self.calls.append((resource, target))
        if self.failure:
            raise RuntimeError(self.failure)
        if self.approve:
            self.limits[resource] = target
            if resource == quota.RESOURCES[0]:
                self.limits['cores'] = max(self.limits['cores'], target)


class WorkerQuotaTests(unittest.TestCase):
    def run_request(self, client, submit=True):
        self.saved = []
        return quota.run(client, submit, lambda value: self.saved.append(copy.deepcopy(value)), sleep=lambda _: None)

    def test_uses_azure_catalogue_casing_for_reads_and_writes(self):
        client = quota.QuotaClient('00000000-0000-4000-8000-000000000000')
        calls = []
        def request(method, url, payload=None):
            calls.append((method, url, payload))
            if '/quotas?' in url:
                return {'value': [{'name': 'standardDASv5Family'}, {'name': 'cores'}]}, None
            if method == 'PUT':
                return {}, None
            if '/usages/' in url:
                return {'properties': {'usages': {'value': 0}}}, None
            return {'properties': {'limit': {'value': 0}}}, None
        client.request = request
        self.assertEqual(client.snapshot('standarddasv5family')['limit'], 0)
        client.submit('standarddasv5family', 2)
        self.assertIn('/quotas/standardDASv5Family?', calls[-1][1])
        self.assertEqual(calls[-1][2]['properties']['name']['value'], 'standardDASv5Family')
        self.assertEqual(sum('/quotas?' in call[1] for call in calls), 1)

    def test_missing_catalogue_resource_prevents_writes(self):
        client = quota.QuotaClient('00000000-0000-4000-8000-000000000000')
        calls = []
        def request(method, url, payload=None):
            calls.append(method)
            return {'value': [{'name': 'unrelatedFamily'}]}, None
        client.request = request
        with self.assertRaises(RuntimeError):
            client.submit(quota.RESOURCES[0], 2)
        self.assertEqual(calls, ['GET'])

    def test_compute_diagnostics_retain_only_approved_numeric_usage(self):
        client = quota.QuotaClient('00000000-0000-4000-8000-000000000000')
        client.resource_names = {'cores': 'cores'}
        response = subprocess.CompletedProcess([], 0, json.dumps([
            {'name': {'value': 'standardDASv5Family'}, 'limit': 0, 'currentValue': 0,
             'unrelated': 'must not retain'},
            {'name': {'value': 'unrelatedFamily'}, 'limit': 100, 'currentValue': 1},
        ]), '')
        with patch.object(quota.subprocess, 'run', return_value=response):
            actual = client.diagnostics()
        self.assertEqual(actual, {'catalogueResourceNames': ['cores'], 'computeUsage': [
            {'resource': 'standardDASv5Family', 'limit': 0, 'usage': 0, 'requiredLimit': 2}]})

    def test_integral_json_numbers_are_counts_but_fractional_values_are_not(self):
        self.assertEqual(quota.required_limit(0.0, 0.0), 2)
        self.assertEqual(quota.required_limit(20.0, 1.0), 20)
        for value in [True, -1.0, 0.5, float('nan'), float('inf'), '0', None]:
            with self.assertRaises(ValueError):
                quota.required_limit(value, 0)

    def test_unrelated_catalogue_rows_do_not_block_approved_name(self):
        client = quota.QuotaClient('00000000-0000-4000-8000-000000000000')
        client.request = lambda *args: ({'value': [
            {'name': None}, {'name': 'unrelated quota'},
            {'name': 'resource-id', 'properties': {'name': {'value': 'standardDASv5Family'}}},
        ]}, None)
        self.assertEqual(client.resolve_resource('standardDASv5Family'), 'standardDASv5Family')

    def test_inspection_never_submits(self):
        client = FakeQuota()
        result = self.run_request(client, False)
        self.assertEqual(client.calls, [])
        self.assertFalse(result['ready'])
        self.assertEqual(result['readback'][0]['requiredLimit'], 2)

    def test_requests_only_two_free_cpus_and_verifies_family_and_region(self):
        client = FakeQuota(limit=5, usage=5)
        result = self.run_request(client)
        self.assertEqual(client.calls, [(quota.RESOURCES[0], 7)])
        self.assertTrue(result['ready'])
        self.assertEqual(result['quotas'][1]['state'], 'AlreadyAvailable')

    def test_does_not_reduce_existing_limits_or_request_when_sufficient(self):
        client = FakeQuota(limit=50, usage=4)
        self.assertTrue(self.run_request(client)['ready'])
        self.assertEqual(client.calls, [])

    def test_pending_request_is_not_ready_or_retried(self):
        client = FakeQuota(approve=False)
        result = self.run_request(client)
        self.assertFalse(result['ready'])
        self.assertEqual(client.calls, [(quota.RESOURCES[0], 2), ('cores', 2)])
        self.assertEqual([row['state'] for row in result['quotas']], ['Submitted', 'Submitted'])

    def test_uncertain_write_is_not_retried_and_does_not_advance(self):
        client = FakeQuota()
        client.failure = 'Quota API outcome unavailable; inspect request status before resubmitting'
        with self.assertRaises(RuntimeError):
            self.run_request(client)
        self.assertEqual(len(client.calls), 1)
        self.assertEqual(self.saved[-1]['quotas'][0]['state'], 'Submitting')
        self.assertFalse(self.saved[-1]['ready'])

    def test_cannot_guess_missing_usage_or_accept_booleans(self):
        for limit, usage in [(0, None), (True, 0), (0, -1), ('5', 0)]:
            with self.assertRaises(ValueError):
                quota.required_limit(limit, usage)

    def test_status_cannot_send_token_to_another_host_or_subscription(self):
        client = quota.QuotaClient('00000000-0000-4000-8000-000000000000')
        for url in ['https://example.com/status', client.base.replace('000000000000', '000000000001')]:
            with self.assertRaises(ValueError):
                client.request('GET', url)

    def test_rejected_request_is_retained_without_retry(self):
        client = FakeQuota(approve=False)
        client.submit = lambda resource, target: 'https://example.test/status'
        client.request = lambda method, location: ({'status': 'Failed'}, None)
        result = self.run_request(client)
        self.assertFalse(result['ready'])
        self.assertEqual(result['quotas'][0]['state'], 'Failed')


if __name__ == '__main__':
    unittest.main()
