import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

PATH = Path(__file__).resolve().parents[3] / 'scripts/factory-sandboxes/image_auth.py'
spec = importlib.util.spec_from_file_location('factory_image_auth', PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
IMAGE = 'registry.azurecr.io/jarvis-runner-dotnet@sha256:' + 'a' * 64


class RegistryImportTests(unittest.TestCase):
    def test_uses_existing_entra_login_without_admin_credentials_or_docker_login(self):
        response = SimpleNamespace(returncode=0, stdout='{"loginServer":"registry.azurecr.io","accessToken":"synthetic-token-for-testing"}')
        with patch.object(module.subprocess, 'run', return_value=response) as run:
            value = module.acr_credentials(IMAGE, 'subscription')
            self.assertEqual(value['token'], 'synthetic-token-for-testing')
            self.assertEqual(value['username'], '00000000-0000-0000-0000-000000000000')
            self.assertIn('--expose-token', run.call_args.args[0])
            self.assertTrue(run.call_args.kwargs['capture_output'])

    def test_refuses_mutable_or_external_images_before_requesting_a_token(self):
        with patch.object(module.subprocess, 'run') as run:
            for image in ('registry.azurecr.io/jarvis-runner-dotnet:latest', 'external.example/image@sha256:' + 'a' * 64):
                with self.assertRaises(ValueError): module.acr_credentials(image, 'subscription')
            run.assert_not_called()

    def test_does_not_return_a_credential_for_a_different_registry(self):
        with patch.object(module.subprocess, 'run', return_value=SimpleNamespace(returncode=0,
                stdout='{"loginServer":"other.azurecr.io","accessToken":"synthetic-token-for-testing"}')):
            with self.assertRaisesRegex(RuntimeError, '^Registry login did not return a valid short-lived credential$'):
                module.acr_credentials(IMAGE, 'subscription')

    def test_failed_login_does_not_expose_cli_output(self):
        with patch.object(module.subprocess, 'run', return_value=SimpleNamespace(returncode=1,
                stdout='SECRET', stderr='SECRET')):
            with self.assertRaisesRegex(RuntimeError, '^Deployment identity could not authenticate to the runner registry$'):
                module.acr_credentials(IMAGE, 'subscription')
