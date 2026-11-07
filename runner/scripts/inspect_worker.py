"""Read capacity and sanitized task outcomes from the provisioned worker; no task writes."""
import argparse
import base64
import json
import subprocess
import time
from pathlib import Path

from worker_diagnostics import deployment_errors


def az(subscription, *arguments):
    result = subprocess.run(['az', *arguments, '--subscription', subscription,
                             '--output', 'json', '--only-show-errors'],
                            capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise RuntimeError('Worker inspection control-plane request failed')
    return json.loads(result.stdout) if result.stdout.strip() else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--subscription', required=True)
    parser.add_argument('--state', type=Path, required=True)
    args = parser.parse_args()
    evidence = {}
    try:
        deployment = az(args.subscription, 'deployment', 'group', 'show', '--resource-group', 'rg-jarvis',
                        '--name', 'jarvis-factory-worker')
        properties = deployment.get('properties', {})
        evidence['deploymentState'] = properties.get('provisioningState')
        if properties.get('error'):
            evidence['deploymentErrors'] = deployment_errors(json.dumps(properties['error']))
    except RuntimeError:
        evidence['deploymentState'] = 'Unavailable'
    args.state.write_text(json.dumps(evidence, indent=2))
    vms = az(args.subscription, 'vm', 'list', '--resource-group', 'rg-jarvis')
    if not any(vm.get('name') == 'vm-jarvis-factory' for vm in vms):
        evidence['workerExists'] = False
        args.state.write_text(json.dumps(evidence, indent=2))
        print(json.dumps(evidence))
        return
    flags = ('--resource-group', 'rg-jarvis', '--name', 'vm-jarvis-factory')
    vm = az(args.subscription, 'vm', 'get-instance-view', *flags)
    power = next((x['code'] for x in vm['instanceView']['statuses'] if x['code'].startswith('PowerState/')), None)
    evidence.update(workerExists=True, powerStateBeforeInspection=power,
                    workspaceGiB=vm['storageProfile']['dataDisks'][0].get('diskSizeGB'))
    args.state.write_text(json.dumps(evidence))
    if power == 'PowerState/deallocated':
        az(args.subscription, 'vm', 'start', *flags, '--no-wait')
    program = '''import app,json
values=[]
for p in app.WORK_ROOT.glob(f'*/{app.TASK_STATE_DIR}/*.json'):
 try:
  raw=json.loads(p.read_text())
  values.append({k:raw.get(k) for k in ('invocation_id','session_id','task_id','status','work_completed','provider_stopped','work_commit_sha','finished_at')})
 except (OSError,ValueError): pass
print('JARVIS_WORKER_STATUS='+json.dumps({'disk':app._disk_snapshot(),'tasks':values[-100:]}))
'''
    encoded = base64.b64encode(program.encode()).decode()
    for _ in range(12):
        try:
            result = az(args.subscription, 'vm', 'run-command', 'invoke', *flags,
                '--command-id', 'RunShellScript', '--scripts',
                f"printf '%s' '{encoded}' | base64 -d | docker exec -i jarvis-factory python")
            lines = '\n'.join(x.get('message', '') for x in result.get('value', [])).splitlines()
            line = next((value for value in lines if value.startswith('JARVIS_WORKER_STATUS=')), None)
            if line:
                evidence.update(json.loads(line.split('=', 1)[1]))
                args.state.write_text(json.dumps(evidence, indent=2))
                print(json.dumps(evidence))
                return
        except (RuntimeError, subprocess.TimeoutExpired):
            pass
        time.sleep(20)
    raise RuntimeError('Worker inspection did not produce a readable result')


if __name__ == '__main__':
    main()
