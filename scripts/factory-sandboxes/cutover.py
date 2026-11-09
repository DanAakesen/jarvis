"""Cut over only the exact five-worker-qualified runtime, then retire dedicated VM resources."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import time

sys.path.insert(0, str(Path('.github/scripts').resolve()))
from release_state import api, artifact, validate_previous, valid_origin, valid_version, UPLOAD  # noqa: E402


def az(*args):
    result = subprocess.run(['az', *args, '--subscription', os.environ['SUBSCRIPTION_ID'],
        '--only-show-errors', '--output', 'json'], capture_output=True, text=True, timeout=900)
    if result.returncode:
        raise RuntimeError('Azure operation failed: ' + args[0])
    return json.loads(result.stdout) if result.stdout.strip() else None


def accepted_backend(release: dict | None, source: str) -> dict:
    backend = (release or {}).get('components', {}).get('backend', {})
    # A script-only change may correctly reuse the same qualified backend image.
    # Require the exact release receipt, including its successful reuse checks.
    if (not release or release.get('accepted') is not True
            or release.get('source') != source or release.get('applied_head') != source
            or backend.get('state') not in {'applied', 'reused'}
            or not valid_version('backend', backend.get('version'))
            or not valid_origin(backend.get('origin')) or not valid_origin(backend.get('revision_origin'))):
        raise RuntimeError('Deploy and accept this exact backend revision before cutover')
    return backend


def cutover(root: Path):
    evidence = json.loads((root/'pool-canary.json').read_text())
    config = json.loads((root/'pool-config.json').read_text())
    outputs = json.loads((root/'infra.json').read_text())
    if (evidence.get('passed') is not True or evidence.get('cleanupPassed') is not True
            or evidence.get('overlappingWorkers') != 5 or len(evidence.get('sessions', [])) != 5
            or config['source'] != os.environ['GITHUB_SHA']):
        raise RuntimeError('Exact five-worker qualification is required before cutover')
    runs = api('/actions/workflows/deploy.yml/runs?branch=main&per_page=10')['workflow_runs']
    if not runs or runs[0]['status'] != 'completed' or runs[0]['conclusion'] != 'success':
        raise RuntimeError('The latest main deployment must finish successfully before cutover')
    release = artifact(runs[0], UPLOAD, 'release-evidence.json')
    validate_previous(runs[0], release)
    backend = accepted_backend(release, config['source'])
    app_name = outputs['backendAppName']['value']
    app = az('containerapp', 'show', '--resource-group', 'rg-jarvis', '--name', app_name)
    image = backend['version']['image']
    if app['properties']['template']['containers'][0]['image'] != image:
        raise RuntimeError('Backend image does not match the accepted deployment')
    settings = {
        'JARVIS_FACTORY_SANDBOX_IMAGE_ID': config['imageId'],
        'JARVIS_FACTORY_SANDBOX_SUBSCRIPTION': config['subscription'],
        'JARVIS_FACTORY_SANDBOX_IDENTITY_CLIENT_ID': config['identityClientId'],
        'JARVIS_FACTORY_SANDBOX_BACKEND_URL': config['backendUrl'],
        'JARVIS_FACTORY_SANDBOX_ENABLED': 'true',
    }
    az('containerapp', 'update', '--resource-group', 'rg-jarvis', '--name', app_name,
       '--set-env-vars', *(f'{key}={value}' for key, value in settings.items()),
       '--remove-env-vars', 'JARVIS_FACTORY_WORKER_RESOURCE_ID', 'JARVIS_FACTORY_WORKER_ENABLED')
    for _ in range(40):
        app = az('containerapp', 'show', '--resource-group', 'rg-jarvis', '--name', app_name)
        properties = app['properties']
        container = properties['template']['containers'][0]
        actual = {item['name']: item.get('value') for item in container.get('env', [])}
        if (properties.get('latestRevisionName') == properties.get('latestReadyRevisionName')
                and properties.get('latestRevisionName') and container['image'] == image
                and all(actual.get(key) == value for key, value in settings.items())
                and 'JARVIS_FACTORY_WORKER_ENABLED' not in actual):
            evidence['cutoverReadyRevision'] = properties['latestReadyRevisionName']
            evidence['cutoverPassed'] = True
            (root/'pool-canary.json').write_text(json.dumps(evidence, indent=2) + '\n')
            return evidence, outputs
        time.sleep(10)
    raise RuntimeError('Managed Factory backend revision did not become ready')


def retire_vm(evidence, outputs, root):
    if evidence.get('cutoverPassed') is not True:
        raise RuntimeError('Managed cutover must precede VM retirement')
    name = 'vm-jarvis-factory'
    scope = f"/subscriptions/{os.environ['SUBSCRIPTION_ID']}/resourceGroups/rg-jarvis"
    inventory = az('vm', 'list', '--resource-group', 'rg-jarvis')
    vm = next((value for value in inventory if value['name'] == name), None)
    if vm is None:
        raise RuntimeError('VM absent; inspect any remaining resources before declaring retirement')
    current = az('vm', 'get-instance-view', '--resource-group', 'rg-jarvis', '--name', name)
    if not any(value.get('code') == 'PowerState/deallocated' for value in current['instanceView']['statuses']):
        raise RuntimeError('Inspect/drain the existing VM before retirement; it is not deallocated')
    principal = vm['identity']['principalId']
    disks = [vm['storageProfile']['osDisk']['managedDisk']['id'],
             *(disk['managedDisk']['id'] for disk in vm['storageProfile'].get('dataDisks', []))]
    if any(not value.lower().startswith(scope.lower() + '/providers/microsoft.compute/disks/' + name)
           for value in disks):
        raise RuntimeError('VM references an unexpected shared disk')
    expected_nic = scope + '/providers/Microsoft.Network/networkInterfaces/' + name + '-nic'
    if [value['id'].lower() for value in vm['networkProfile']['networkInterfaces']] != [expected_nic.lower()]:
        raise RuntimeError('VM references an unexpected shared network interface')
    # Remove the obsolete identity's scoped grants, including grants on shared vault/registry.
    assignments = az('role', 'assignment', 'list', '--scope', scope, '--all')
    for assignment in assignments:
        dedicated_identity = assignment.get('principalId') == principal and assignment['scope'].lower().startswith(scope.lower() + '/')
        dedicated_vm_scope = assignment['scope'].lower() == (scope + '/providers/Microsoft.Compute/virtualMachines/' + name).lower()
        if dedicated_identity or dedicated_vm_scope:
            az('role', 'assignment', 'delete', '--ids', assignment['id'])
    az('vm', 'delete', '--resource-group', 'rg-jarvis', '--name', name, '--yes')
    for disk in disks:
        az('disk', 'delete', '--ids', disk, '--yes')
    for kind, suffix in [('nic', 'nic'), ('public-ip', 'outbound'), ('vnet', 'vnet'), ('nsg', 'nsg')]:
        az('network', kind, 'delete', '--resource-group', 'rg-jarvis', '--name', name + '-' + suffix)
    az('storage', 'container-rm', 'delete', '--resource-group', 'rg-jarvis',
       '--storage-account', outputs['storageAccountName']['value'], '--name', 'factory-worker')
    az('deployment', 'group', 'delete', '--resource-group', 'rg-jarvis', '--name', 'jarvis-factory-worker')
    remaining = az('resource', 'list', '--resource-group', 'rg-jarvis')
    if any(value['name'].startswith(name) for value in remaining):
        raise RuntimeError('Dedicated VM resources remain after retirement')
    evidence['vmResourcesRetired'] = True
    (root/'pool-canary.json').write_text(json.dumps(evidence, indent=2) + '\n')


if __name__ == '__main__':
    root = Path(os.environ['RUNNER_TEMP'])
    try:
        evidence, outputs = cutover(root)
        if os.environ.get('RETIRE_VM') == 'true':
            retire_vm(evidence, outputs, root)
    except Exception as error:
        print('Factory cutover stopped:', type(error).__name__, str(error) if type(error) is RuntimeError else '')
        raise SystemExit(1) from None
