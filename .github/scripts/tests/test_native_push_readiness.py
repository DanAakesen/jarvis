import importlib.util
import json
from pathlib import Path
import unittest

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
