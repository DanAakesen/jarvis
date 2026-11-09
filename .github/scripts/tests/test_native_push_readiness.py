import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('native_push_readiness', Path(__file__).parents[1] / 'native_push_readiness.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NativePushReadinessTests(unittest.TestCase):
    def test_reports_presence_without_disclosing_values_or_secret_references(self):
        env = [{'name': 'APNS_TEAM_ID', 'value': 'private-team'},
               {'name': 'APNS_KEY_ID', 'value': 'private-key-id'},
               {'name': 'APNS_SIGNING_KEY', 'secretRef': 'private-key-reference'},
               {'name': 'APNS_ENVIRONMENT', 'value': 'production'},
               {'name': 'JARVIS_APPROVAL_NOTIFICATIONS_ENABLED', 'value': 'true'}]
        app = {'properties': {'latestRevisionName': 'ready', 'latestReadyRevisionName': 'ready',
                             'template': {'containers': [{'name': 'backend', 'env': env}]}}}
        result = module.summarize(app)
        self.assertNotIn('private-', json.dumps(result))
        self.assertTrue(result['revisionReady'])
        self.assertTrue(result['signingKeyUsesSecretReference'])
        self.assertTrue(result['apnsProduction'])
        self.assertTrue(all(result['apnsConfigured'].values()))
        app['properties']['template']['containers'][0]['env'] = []
        result = module.summarize(app)
        self.assertFalse(any(result['apnsConfigured'].values()))
        self.assertFalse(any(result['enabled'].values()))

    def test_arm_metadata_is_projected_and_pagination_stays_in_the_vault(self):
        base = 'https://management.azure.com/subscriptions/sub/resourceGroups/rg-jarvis/providers/Microsoft.KeyVault/vaults/vault/secrets'
        first = {'value': [{'name': 'vault/apns-key-id', 'properties': {
            'value': 'must-not-escape', 'secretUri': 'must-not-escape', 'attributes': {'enabled': True}}}],
            'nextLink': base + '?api-version=2026-05-15&$skiptoken=next'}
        reader = Mock(side_effect=[first, {'value': [{'name': 'apns-signing-key', 'properties': {'attributes': {'enabled': False}}}]}])
        with patch.dict(os.environ, SUBSCRIPTION_ID='sub'):
            result = module.secret_metadata('vault', reader)
        self.assertEqual(result, [
            {'name': 'apns-key-id', 'attributes': {'enabled': True}},
            {'name': 'apns-signing-key', 'attributes': {'enabled': False}}])
        self.assertNotIn('must-not-escape', json.dumps(result))
        self.assertEqual(reader.call_args_list[0].args[:4], ('rest', '--method', 'get', '--url'))
        for next_link in ['https://untrusted.invalid/next', base + '-other?next=1']:
            with patch.dict(os.environ, SUBSCRIPTION_ID='sub'):
                with self.assertRaisesRegex(RuntimeError, 'left the expected vault'):
                    module.secret_metadata('vault', Mock(return_value={'value': [], 'nextLink': next_link}))

    def test_missing_revision_is_not_ready(self):
        app = {'properties': {'template': {'containers': [{'name': 'backend'}]}}}
        self.assertFalse(module.summarize(app)['revisionReady'])
