import unittest

from reuse_factory_image import validate


class ReuseImageTests(unittest.TestCase):
    def setUp(self):
        self.run = {'path': '.github/workflows/factory-runtime.yml', 'head_branch': 'main',
                    'event': 'workflow_dispatch', 'status': 'completed', 'head_sha': 'a' * 40}
        self.config = {'source': 'a' * 40, 'subscription': 'subscription',
                       'imageId': '00000000-0000-4000-8000-000000000001',
                       'image': 'registry.azurecr.io/jarvis-runner-dotnet@sha256:' + 'b' * 64}

    def check(self, current='c' * 40, previous='c' * 40):
        return validate(self.run, self.config, current, previous, 'subscription', 'registry.azurecr.io')

    def test_same_runner_allows_new_adapter_source_without_claiming_runtime_passed(self):
        self.run['conclusion'] = 'failure'
        self.assertEqual(self.check()['source'], 'a' * 40)

    def test_changed_runner_cannot_reuse_old_image(self):
        with self.assertRaises(ValueError):
            self.check(previous='d' * 40)

    def test_untrusted_run_or_source_rejected(self):
        for field, value in [('head_branch', 'feature'), ('event', 'pull_request'),
                             ('status', 'in_progress'), ('path', '.github/workflows/ci.yml'),
                             ('head_sha', 'd' * 40)]:
            original = self.run[field]
            self.run[field] = value
            with self.assertRaises(ValueError, msg=field):
                self.check()
            self.run[field] = original

    def test_mutable_or_external_image_and_different_subscription_rejected(self):
        for field, value in [('image', 'registry.azurecr.io/jarvis-runner-dotnet:latest'),
                             ('image', 'other.azurecr.io/jarvis-runner-dotnet@sha256:' + 'b' * 64),
                             ('subscription', 'another'), ('imageId', '../../another-group')]:
            original = self.config[field]
            self.config[field] = value
            with self.assertRaises(ValueError, msg=field):
                self.check()
            self.config[field] = original
