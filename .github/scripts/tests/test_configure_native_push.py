import importlib.util
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1]))
spec = importlib.util.spec_from_file_location('configure_native_push', Path(__file__).parents[1] / 'configure_native_push.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ConfigureNativePushTests(unittest.TestCase):
    def test_missing_or_disabled_key_never_changes_the_app(self):
        outputs = {'keyVaultName': {'value': 'vault'}, 'backendAppName': {'value': 'backend'}}
        for metadata in [[], [{'name': name, 'attributes': {'enabled': name != 'apns-signing-key'}} for name in module.SECRET_NAMES]]:
            with patch.dict(os.environ, GITHUB_SHA='head', INFRA_DEPLOYMENT='infra'), \
                 patch.object(module, 'qualify'), patch.object(module, 'azure', side_effect=[outputs, metadata]) as azure:
                with self.assertRaisesRegex(RuntimeError, 'Create enabled Key Vault secrets'):
                    module.main()
                self.assertEqual(azure.call_count, 2)

    def test_activation_uses_references_and_requires_a_ready_revision(self):
        outputs = {'keyVaultName': {'value': 'vault'}, 'backendAppName': {'value': 'backend'}}
        metadata = [{'name': name, 'attributes': {'enabled': True}} for name in module.SECRET_NAMES]
        identity = '/subscriptions/sub/resourceGroups/rg-jarvis/providers/Microsoft.ManagedIdentity/userAssignedIdentities/backend'
        app = {'identity': {'userAssignedIdentities': {identity: {}}}}
        ready = {'revisionReady': True, 'enabled': {'JARVIS_APPROVAL_NOTIFICATIONS_ENABLED': True},
                 'apnsConfigured': dict.fromkeys(module.SECRET_NAMES, True), 'apnsProduction': True,
                 'signingKeyUsesSecretReference': True}
        with patch.dict(os.environ, GITHUB_SHA='head', INFRA_DEPLOYMENT='infra'), \
             patch.object(module, 'qualify') as qualify, patch.object(module, 'summarize', return_value=ready), \
             patch.object(module, 'azure', side_effect=[outputs, metadata, app, {}, {}, app]) as azure:
            module.main()
            qualify.assert_called_once_with('head')
            commands = [call.args for call in azure.call_args_list]
            self.assertFalse(any(c[:3] == ('keyvault', 'secret', 'show') for c in commands))
            references = commands[3]
            for name in module.SECRET_NAMES:
                self.assertIn(f'{name}=keyvaultref:https://vault.vault.azure.net/secrets/{name},identityref:{identity}', references)
            self.assertIn('APNS_ENVIRONMENT=production', commands[4])

    def test_unqualified_revision_never_reads_or_writes_azure(self):
        with patch.dict(os.environ, GITHUB_SHA='head'), patch.object(module, 'qualify', side_effect=RuntimeError('not qualified')), \
             patch.object(module, 'azure') as azure:
            with self.assertRaisesRegex(RuntimeError, 'not qualified'):
                module.main()
            azure.assert_not_called()
