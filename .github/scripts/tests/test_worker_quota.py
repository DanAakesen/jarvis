import copy
import importlib.util
import unittest
from pathlib import Path

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
