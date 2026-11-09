import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

PATH = Path(__file__).resolve().parents[3] / 'scripts/factory-sandboxes/cutover.py'
spec = importlib.util.spec_from_file_location('sandbox_cutover', PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CutoverTests(unittest.TestCase):
    def inputs(self, root, passed=False):
        (root/'pool-canary.json').write_text(json.dumps({'passed': passed, 'cleanupPassed': True,
            'overlappingWorkers': 5, 'sessions': [{}] * 5}))
        (root/'pool-config.json').write_text(json.dumps({'source': 'current'}))
        (root/'infra.json').write_text('{}')

    def test_failed_qualification_never_calls_azure(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(module, 'az') as azure:
            root = Path(directory)
            self.inputs(root)
            with self.assertRaisesRegex(RuntimeError, 'five-worker'):
                module.cutover(root)
            azure.assert_not_called()

    def test_latest_failed_deployment_cannot_use_older_success(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, GITHUB_SHA='current'), \
             patch.object(module, 'az') as azure, patch.object(module, 'api', return_value={
                 'workflow_runs': [{'status': 'completed', 'conclusion': 'failure'}]}):
            root = Path(directory)
            self.inputs(root, True)
            with self.assertRaisesRegex(RuntimeError, 'latest main deployment'):
                module.cutover(root)
            azure.assert_not_called()

    def test_exact_accepted_release_can_reuse_a_previously_qualified_backend_image(self):
        origin = {'source': 'a' * 40, 'run': 1, 'attempt': 1}
        backend = {'state': 'reused', 'origin': origin, 'revision_origin': origin,
                   'version': {'image': 'registry.azurecr.io/jarvis-backend@sha256:' + 'b' * 64, 'revision': 'backend--ready'}}
        receipt = {'source': 'c' * 40, 'applied_head': 'c' * 40, 'accepted': True, 'components': {'backend': backend}}
        self.assertEqual(module.accepted_backend(receipt, 'c' * 40), backend)
        with self.assertRaisesRegex(RuntimeError, 'exact backend revision'):
            module.accepted_backend(receipt, 'd' * 40)
        receipt['accepted'] = False
        with self.assertRaisesRegex(RuntimeError, 'exact backend revision'):
            module.accepted_backend(receipt, 'c' * 40)
