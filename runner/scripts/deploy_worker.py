"""Provision the approved 128 GiB worker; activate only after disk/identity/idle proof."""
from __future__ import annotations

import argparse
import base64
import json
import subprocess
import tempfile
import time
from pathlib import Path

from deploy import az, backend_settings
from worker_cloud_init import render

VM_NAME = 'vm-jarvis-factory'


def run_script(subscription, resource_group, script):
    return az(subscription, 'vm', 'run-command', 'invoke', '--resource-group', resource_group,
              '--name', VM_NAME, '--command-id', 'RunShellScript', '--scripts', script)


def power_state(subscription, resource_group):
    result = az(subscription, 'vm', 'get-instance-view', '--resource-group', resource_group, '--name', VM_NAME)
    return next((x['code'] for x in result['instanceView']['statuses'] if x['code'].startswith('PowerState/')), None)


def provision(args):
    outputs = json.loads(args.outputs.read_text())
    bootstrap = json.loads(Path('infra/bootstrap.output.json').read_text())
    backend_url, scope = backend_settings(outputs, bootstrap)
    resource_group = 'rg-jarvis'
    resource_id = f'/subscriptions/{args.subscription}/resourceGroups/{resource_group}/providers/Microsoft.Compute/virtualMachines/{VM_NAME}'
    evidence = {'resourceId': resource_id, 'workspaceGiB': 128, 'activated': False, 'safeToDeallocateOnFailure': False}
    args.state.write_text(json.dumps(evidence))
    digest = az(args.subscription, 'acr', 'manifest', 'show-metadata', '--registry', args.registry,
                '--name', f'jarvis-runner-dotnet:{args.tag}')['digest']
    image = f"{outputs['containerRegistryLoginServer']['value']}/jarvis-runner-dotnet@{digest}"
    storage = outputs['storageAccountName']['value']
    vault = outputs['keyVaultName']['value']
    config = {'image': image, 'environment': {
        'JARVIS_FACTORY_WORKER_RESOURCE_ID': resource_id,
        'JARVIS_FACTORY_WORKER_BLOB_URL': f'https://{storage}.blob.core.windows.net/factory-worker',
        'JARVIS_WORK_ROOT': '/files/jarvis', 'KEY_VAULT_URI': f'https://{vault}.vault.azure.net/',
        'JARVIS_BACKEND_URL': backend_url, 'JARVIS_API_SCOPE': scope,
        'JARVIS_GITHUB_APP_TOKEN_ENABLED': 'true',
        'JARVIS_DISK_LOW_THRESHOLD_BYTES': str(2 * 1024**3),
    }}
    backend = az(args.subscription, 'containerapp', 'show', '--resource-group', resource_group,
                 '--name', outputs['backendAppName']['value'])
    environment = backend['properties']['template']['containers'][0].get('env', [])
    if any(value.get('name') == 'JARVIS_FACTORY_WORKER_ENABLED' and value.get('value') == 'true' for value in environment):
        raise RuntimeError('Disable new worker routing and drain work before updating its image')
    identities = backend['identity']['userAssignedIdentities']
    if len(identities) != 1:
        raise RuntimeError('Expected one backend managed identity')
    backend_identity = next(iter(identities)).rsplit('/', 1)[1]
    existing = az(args.subscription, 'vm', 'list', '--resource-group', resource_group)
    exists = any(vm['name'] == VM_NAME for vm in existing)
    if exists:
        # Updating the host is deliberate and must never stop an active worker.
        # Provisioning reruns require it to be deallocated first.
        if power_state(args.subscription, resource_group) != 'PowerState/deallocated':
            raise RuntimeError('Worker update requires an idle, deallocated VM')
    evidence['safeToDeallocateOnFailure'] = True
    args.state.write_text(json.dumps(evidence))
    with tempfile.TemporaryDirectory() as temp:
        key = Path(temp, 'key')
        subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(key)], check=True)
        parameters = {'customData': '' if exists else render(config),
            'sshPublicKey': Path(str(key) + '.pub').read_text().strip(),
            'backendIdentityName': backend_identity, 'registryName': args.registry,
            'storageAccountName': storage, 'keyVaultName': vault}
        parameter_file = Path(temp, 'parameters.json')
        parameter_file.write_text(json.dumps({'parameters': {k: {'value': v} for k, v in parameters.items()}}))
        # Provisioning can exceed the helper's default short control-plane deadline.
        applied = subprocess.run(['az', 'deployment', 'group', 'create', '--resource-group', resource_group,
            '--name', 'jarvis-factory-worker', '--subscription', args.subscription,
            '--template-file', 'infra/factory-worker.bicep', '--parameters', '@' + str(parameter_file),
            '--only-show-errors', '--output', 'none'], capture_output=True, timeout=900)
        if applied.returncode:
            raise RuntimeError('Factory worker provisioning failed')
    az(args.subscription, 'vm', 'start', '--resource-group', resource_group, '--name', VM_NAME, '--no-wait')
    if exists:
        config64 = base64.b64encode(json.dumps(config).encode()).decode()
        run_script(args.subscription, resource_group,
                   f"printf '%s' '{config64}' | base64 -d > /etc/jarvis-worker.json\nsystemctl restart jarvis-factory")
    probe = '''import asyncio,json,app
async def main():
 d=app._disk_snapshot()
 assert d['disk_total_bytes'] >= 120*1024**3
 for a in ('codex','copilot'):
  c=await app._credentials_for(a,include_github_token=False)
  c.clear()
 print('JARVIS_WORKER_PROBE='+json.dumps({'workspaceBytes':d['disk_total_bytes'],'freeBytes':d['disk_free_bytes'],'credentialsAccessible':True}))
asyncio.run(main())
'''
    probe64 = base64.b64encode(probe.encode()).decode()
    # Repeated read-only probes tolerate package installation and role propagation.
    result = None
    for _ in range(15):
        try:
            if power_state(args.subscription, resource_group) == 'PowerState/deallocated':
                az(args.subscription, 'vm', 'start', '--resource-group', resource_group, '--name', VM_NAME, '--no-wait')
            response = run_script(args.subscription, resource_group,
                f"printf '%s' '{probe64}' | base64 -d | docker exec -i jarvis-factory python")
            text = '\n'.join(x.get('message', '') for x in response.get('value', []))
            line = next((x for x in text.splitlines() if x.startswith('JARVIS_WORKER_PROBE=')), None)
            if line:
                result = json.loads(line.split('=', 1)[1])
                break
        except (RuntimeError, subprocess.TimeoutExpired):
            pass
        time.sleep(30)
    if result is None:
        raise RuntimeError('Factory worker disk/credential probe did not pass')
    evidence.update(result, image=image)
    args.state.write_text(json.dumps(evidence))
    for _ in range(30):
        if power_state(args.subscription, resource_group) == 'PowerState/deallocated':
            evidence['idleDeallocationVerified'] = True
            break
        time.sleep(20)
    if not evidence.get('idleDeallocationVerified'):
        raise RuntimeError('Worker did not deallocate after idle')
    # Once traffic may reach this worker, a later deployment error must never
    # deallocate a newly accepted user task. Idle deallocation is already proven.
    evidence['safeToDeallocateOnFailure'] = False
    args.state.write_text(json.dumps(evidence))
    # Main Bicep preserves these reviewed settings on all later deployments.
    az(args.subscription, 'containerapp', 'update', '--resource-group', resource_group,
       '--name', outputs['backendAppName']['value'], '--set-env-vars',
       f'JARVIS_FACTORY_WORKER_RESOURCE_ID={resource_id}', 'JARVIS_FACTORY_WORKER_ENABLED=true')
    ready = False
    for _ in range(30):
        backend = az(args.subscription, 'containerapp', 'show', '--resource-group', resource_group,
                     '--name', outputs['backendAppName']['value'])
        properties = backend['properties']
        if properties.get('latestRevisionName') == properties.get('latestReadyRevisionName'):
            ready = True
            break
        time.sleep(10)
    if not ready:
        raise RuntimeError('Backend worker-routing revision did not become ready')
    evidence['backendReadyVerified'] = True
    evidence['activated'] = True
    args.state.write_text(json.dumps(evidence, indent=2))
    print('Factory worker provisioned: 128 GiB, identity verified, idle deallocation verified.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--subscription', required=True)
    parser.add_argument('--outputs', type=Path, required=True)
    parser.add_argument('--registry', required=True)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--state', type=Path, required=True)
    args = parser.parse_args()
    try:
        provision(args)
    except Exception:
        evidence = json.loads(args.state.read_text()) if args.state.exists() else {}
        if evidence.get('safeToDeallocateOnFailure') and not evidence.get('activated'):
            try:
                az(args.subscription, 'vm', 'deallocate', '--resource-group', 'rg-jarvis', '--name', VM_NAME, '--no-wait')
                evidence['failureDeallocationRequested'] = True
            except Exception:
                evidence['failureDeallocationRequested'] = False
            args.state.write_text(json.dumps(evidence, indent=2))
        raise


if __name__ == '__main__':
    main()
