import importlib.util
from pathlib import Path
import unittest

PATH = Path(__file__).resolve().parents[3] / 'scripts/factory-sandboxes/qualify.py'
spec = importlib.util.spec_from_file_location('sandbox_qualification', PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class QualificationTests(unittest.TestCase):
    def results(self):
        return [{'worker': str(i), 'workspaceBytes': 128 * 1024**3,
                 'startedAt': i, 'finishedAt': 40 + i,
                 'posixPassed': True, 'buildPassed': True} for i in range(5)]

    def test_five_real_overlapping_results_pass(self):
        module.validate_results(self.results())

    def test_100_results_rejected(self):
        with self.assertRaises(ValueError):
            module.validate_results(self.results() * 20)

    def test_serial_execution_is_not_concurrency(self):
        results = self.results()
        results[4]['startedAt'] = 41
        with self.assertRaises(ValueError):
            module.validate_results(results)

    def test_shared_worker_identity_rejected(self):
        results = self.results()
        results[4]['worker'] = '0'
        with self.assertRaises(ValueError):
            module.validate_results(results)

    def test_small_root_disk_is_not_a_workspace(self):
        results = self.results()
        results[4]['workspaceBytes'] = 40 * 1024**3
        with self.assertRaises(ValueError):
            module.validate_results(results)

    def test_failed_build_rejected(self):
        results = self.results()
        results[4]['buildPassed'] = False
        with self.assertRaises(ValueError):
            module.validate_results(results)

    def test_generated_probe_compiles(self):
        compile(module.probe_script('q-test-0'), '<probe>', 'exec')

    def test_failed_exec_does_not_echo_secrets(self):
        class Box:
            def exec(self, _command):
                class Result:
                    exit_code = 1
                    stdout = 'SECRET'
                    stderr = 'SECRET'
                return Result()
        with self.assertRaisesRegex(RuntimeError, '^Sandbox qualification command failed$'):
            module.checked_exec(Box(), 'pass')

    def test_service_diagnostics_do_not_retain_credentials_or_urls(self):
        from types import SimpleNamespace
        error = RuntimeError('Registry authentication: Bearer secret-value https://host/path?sig=secret')
        error.status_code = 401
        error.error = SimpleNamespace(code='Unauthorized')
        result = module.failure_details(error, 'image-import')
        self.assertEqual(result['serviceCode'], 'Unauthorized')
        self.assertEqual(result['failureStage'], 'image-import')
        self.assertEqual(result['serviceFacts'], ['registry', 'authentication'])
        self.assertNotIn('secret', str(result))
        self.assertNotIn('https', str(result))

    def test_problem_details_preserve_only_safe_volume_constraints(self):
        from types import SimpleNamespace
        import json
        error = RuntimeError('Bad request')
        error.status_code = 400
        error.response = SimpleNamespace(text=lambda: json.dumps({
            'title': 'InvalidRequest', 'errorCode': 4,
            'detail': 'Volume size exceeds maximum 128Gi. Bearer secret https://host?sig=hidden'}))
        result = module.failure_details(error, 'volume-create')
        self.assertEqual(result['serviceCode'], 'InvalidRequest')
        self.assertEqual(result['serviceErrorCode'], 4)
        self.assertEqual(result['sizeFacts'], ['128gi'])
        self.assertIn('maximum', result['serviceFacts'])
        self.assertNotIn('secret', str(result))
        self.assertNotIn('hidden', str(result))

    def test_storage_diagnostics_preserve_size_units_but_remove_auth_and_urls(self):
        from types import SimpleNamespace
        import json
        error = RuntimeError('Do not publish this exception or request headers')
        error.response = SimpleNamespace(text=lambda: json.dumps({'detail':
            'Invalid disk size 128Gi; use 128GiB. Bearer private-value token=another-private-value '
            'https://host/path?sig=private aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "password": "private-word"'}))
        result = module.failure_details(error, 'volume-create')
        self.assertIn('Invalid disk size 128Gi; use 128GiB.', result['validationDetail'])
        self.assertNotIn('private', str(result))
        self.assertNotIn('https://', str(result))
        self.assertNotIn('aaaaaaaa', str(result))
        self.assertNotIn('validationDetail', module.failure_details(error, 'image-import'))
