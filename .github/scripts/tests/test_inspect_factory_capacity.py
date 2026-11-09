import importlib.util
import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('factory_capacity', Path(__file__).parents[1] / 'inspect_factory_capacity.py')
capacity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capacity)
SUB = '00000000-0000-4000-8000-000000000000'


class FactoryCapacityTests(unittest.TestCase):
    def provider(self, locations=None):
        return {'state': 'observed', 'value': {
            'registrationState': 'Registered', 'unrelatedSecret': 'must-not-export',
            'resourceTypes': [{'resourceType': 'SandboxGroups',
                'apiVersions': ['2026-02-01-preview', '2026-01-01', 'invalid#path'],
                'locations': locations if locations is not None else ['Sweden Central']}],
        }}

    def test_catalogue_visibility_never_claims_capacity_or_workspace_qualification(self):
        calls = []
        def get(sub, path):
            calls.append((sub, path))
            if '/providers/Microsoft.App?' in path:
                return self.provider()
            return {'state': 'observed', 'value': {'value': [{'name': 'private-name'}]}}
        result = capacity.inspect(SUB, get=get)
        self.assertEqual(len(calls), 2)
        self.assertTrue(calls[1][1].endswith('?api-version=2026-01-01'))
        self.assertTrue(result['sandboxGroups']['regionListed'])
        self.assertEqual(result['groupRead']['countOnThisPage'], 1)
        for key in ['capacityVerified', 'dataPlaneAccessVerified', 'workspaceVerified',
                    'providerConcurrencyVerified', 'mutationsPerformed']:
            self.assertFalse(result[key])
        self.assertNotIn('private-name', json.dumps(result))
        self.assertNotIn('must-not-export', json.dumps(result))

    def test_missing_type_does_not_claim_service_absent_everywhere_or_attempt_api(self):
        with patch.object(capacity, 'arm_get') as unused:
            calls = []
            def get(sub, path):
                calls.append(path)
                return {'state': 'observed', 'value': {'resourceTypes': []}}
            result = capacity.inspect(SUB, get=get)
            self.assertEqual(result['sandboxGroups']['state'], 'not_listed')
            self.assertEqual(len(calls), 1)
            self.assertNotIn('groupRead', result)
            unused.assert_not_called()

    def test_another_region_is_not_sweden_central_qualification(self):
        result = capacity.catalogue(self.provider(['West US 2']))
        self.assertFalse(result['regionListed'])

    def test_empty_catalogue_is_distinct_from_unreadable_catalogue(self):
        for state in ['unavailable', 'invalid_response', 'response_too_large']:
            result = capacity.inspect(SUB, get=lambda *_: {'state': state})
            self.assertEqual(result['sandboxGroups'], {'state': state})
            self.assertFalse(result['capacityVerified'])

    def test_invalid_subscription_cannot_reach_azure(self):
        with self.assertRaises(ValueError):
            capacity.inspect('bad/subscription', get=lambda *_: self.fail('Azure must not be called'))

    def test_duplicate_catalogue_rows_are_not_silently_selected(self):
        value = self.provider()
        value['value']['resourceTypes'] *= 2
        self.assertEqual(capacity.catalogue(value)['state'], 'ambiguous_response')

    def test_invalid_group_list_is_not_zero_groups(self):
        def get(sub, path):
            return self.provider() if path.endswith('2021-04-01') else {'state': 'observed', 'value': {}}
        self.assertEqual(capacity.inspect(SUB, get=get)['groupRead']['state'], 'invalid_response')

    def test_pagination_is_reported_without_following_an_arbitrary_url(self):
        calls = []
        def get(sub, path):
            calls.append(path)
            return self.provider() if len(calls) == 1 else {'state': 'observed', 'value': {
                'value': [], 'nextLink': 'https://untrusted.invalid/private'}}
        result = capacity.inspect(SUB, get=get)
        self.assertTrue(result['groupRead']['morePages'])
        self.assertEqual(len(calls), 2)
        self.assertNotIn('untrusted', json.dumps(result))

    def test_transport_is_get_only_and_does_not_export_provider_errors(self):
        response = subprocess.CompletedProcess([], 1, '', 'private-provider-body')
        with patch.object(capacity.subprocess, 'run', return_value=response) as run:
            result = capacity.arm_get(SUB, f'/subscriptions/{SUB}/providers/Microsoft.App?api-version=2021-04-01')
        command = run.call_args.args[0]
        self.assertEqual(command[command.index('--method') + 1], 'get')
        self.assertEqual(result, {'state': 'unavailable'})
        self.assertNotIn('private-provider-body', json.dumps(result))

    def test_out_of_scope_transport_never_runs(self):
        with patch.object(capacity.subprocess, 'run') as run:
            with self.assertRaises(ValueError):
                capacity.arm_get(SUB, '/subscriptions/another/providers/Microsoft.App')
            run.assert_not_called()

    def test_transport_failure_and_malformed_response_preserve_unknown(self):
        path = f'/subscriptions/{SUB}/providers/Microsoft.App?api-version=2021-04-01'
        for body in ['[]', 'not json']:
            with patch.object(capacity.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, body, '')):
                self.assertEqual(capacity.arm_get(SUB, path)['state'], 'invalid_response')
        with patch.object(capacity.subprocess, 'run', side_effect=subprocess.TimeoutExpired('az', 60)):
            self.assertEqual(capacity.arm_get(SUB, path)['state'], 'unavailable')
