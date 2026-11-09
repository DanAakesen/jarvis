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

    def test_vm_is_not_touched_before_cutover(self):
        with patch.object(module, 'az') as azure:
            with self.assertRaisesRegex(RuntimeError, 'precede VM retirement'):
                module.retire_vm({}, {}, Path('/unused'))
            azure.assert_not_called()

    def test_running_vm_is_not_deleted(self):
        with patch.dict(os.environ, SUBSCRIPTION_ID='sub'), patch.object(module, 'az', side_effect=[
                [{'name': 'vm-jarvis-factory'}], {'instanceView': {'statuses': [{'code': 'PowerState/running'}]}}
        ]) as azure:
            with self.assertRaisesRegex(RuntimeError, 'not deallocated'):
                module.retire_vm({'cutoverPassed': True}, {}, Path('/unused'))
            self.assertEqual([call.args[:2] for call in azure.call_args_list], [('vm','list'), ('vm','get-instance-view')])

    def test_shared_disk_stops_retirement_before_any_delete(self):
        vm = {'name': 'vm-jarvis-factory', 'identity': {'principalId': 'dedicated'},
              'storageProfile': {'osDisk': {'managedDisk': {'id': '/subscriptions/sub/resourceGroups/rg-jarvis/providers/Microsoft.Compute/disks/shared'}}}}
        with patch.dict(os.environ, SUBSCRIPTION_ID='sub'), patch.object(module, 'az', side_effect=[
                [vm], {'instanceView': {'statuses': [{'code': 'PowerState/deallocated'}]}}
        ]) as azure:
            with self.assertRaisesRegex(RuntimeError, 'shared disk'):
                module.retire_vm({'cutoverPassed': True}, {}, Path('/unused'))
            self.assertEqual(azure.call_count, 2)
