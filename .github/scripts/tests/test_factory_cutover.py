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

    def test_retirement_removes_vm_wake_grant_but_preserves_shared_backend_access(self):
        scope = '/subscriptions/sub/resourceGroups/rg-jarvis'
        vm_id = scope + '/providers/Microsoft.Compute/virtualMachines/vm-jarvis-factory'
        vm = {'name': 'vm-jarvis-factory', 'identity': {'principalId': 'worker'},
              'storageProfile': {'osDisk': {'managedDisk': {'id': scope + '/providers/Microsoft.Compute/disks/vm-jarvis-factory-os'}}},
              'networkProfile': {'networkInterfaces': [{'id': scope + '/providers/Microsoft.Network/networkInterfaces/vm-jarvis-factory-nic'}]}}
        assignments = [
            {'id': 'old-secret-access', 'principalId': 'worker', 'scope': scope + '/providers/Microsoft.KeyVault/vaults/shared'},
            {'id': 'old-backend-wake', 'principalId': 'backend', 'scope': vm_id},
            {'id': 'keep-backend-vault', 'principalId': 'backend', 'scope': scope + '/providers/Microsoft.KeyVault/vaults/shared'},
        ]
        def azure(*args):
            if args[:2] == ('vm', 'list'): return [vm]
            if args[:2] == ('vm', 'get-instance-view'):
                return {'instanceView': {'statuses': [{'code': 'PowerState/deallocated'}]}}
            if args[:3] == ('rest', '--method', 'get'):
                self.assertEqual(args[3:], ('--url', 'https://management.azure.com' + scope
                    + '/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01'))
                return {'value': [{'id': value['id'], 'properties': value} for value in assignments]}
            if args[:2] == ('resource', 'list'): return []
            return None
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, SUBSCRIPTION_ID='sub'), \
             patch.object(module, 'az', side_effect=azure) as calls:
            evidence = {'cutoverPassed': True}
            module.retire_vm(evidence, {'storageAccountName': {'value': 'sharedstorage'}}, Path(directory))
            deleted = [call.args[-1] for call in calls.call_args_list if call.args[:3] == ('role', 'assignment', 'delete')]
            self.assertEqual(deleted, ['old-secret-access', 'old-backend-wake'])
            self.assertTrue(evidence['vmResourcesRetired'])

    def test_role_assignment_pages_stay_in_the_resource_group(self):
        scope = '/subscriptions/sub/resourceGroups/rg-jarvis'
        next_url = 'https://management.azure.com' + scope + '/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&skiptoken=next'
        assignment = {'id': 'grant', 'properties': {'principalId': 'worker', 'scope': scope + '/resource'}}
        with patch.object(module, 'az', side_effect=[{'value': [], 'nextLink': next_url}, {'value': [assignment]}]) as azure:
            self.assertEqual(module.role_assignments(scope), [{'id': 'grant', **assignment['properties']}])
            self.assertEqual(azure.call_args_list[-1].args[-1], next_url)
        for next_link in ['https://untrusted.invalid/path', 'https://management.azure.com/subscriptions/other/roleAssignments']:
            with patch.object(module, 'az', return_value={'value': [], 'nextLink': next_link}) as azure:
                with self.assertRaisesRegex(RuntimeError, 'left the resource group'):
                    module.role_assignments(scope)
                self.assertEqual(azure.call_count, 1)

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
