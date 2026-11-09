"""Bounded managed-worker qualification. Never changes production routing or the VM."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import shlex
import time
from uuid import uuid4

WORKERS = 5  # Owner-approved live test ceiling, separate from the production cap.
MIN_WORKSPACE_BYTES = 120 * 1024**3


def command(script: str) -> str:
    return 'python -c ' + shlex.quote(script)


def validate_results(results: list[dict]) -> None:
    if len(results) != WORKERS or len({x['worker'] for x in results}) != WORKERS:
        raise ValueError('Expected five independently addressed workers')
    if any(x['workspaceBytes'] < MIN_WORKSPACE_BYTES for x in results):
        raise ValueError('Workspace capacity did not meet the 128 GiB target')
    if max(x['startedAt'] for x in results) >= min(x['finishedAt'] for x in results):
        raise ValueError('Five-way overlapping execution was not demonstrated')
    if any(not x['posixPassed'] or not x['buildPassed'] for x in results):
        raise ValueError('Workspace filesystem/build qualification failed')


def probe_script(marker: str) -> str:
    # Only an internally generated UUID goes into the script, via repr.
    return f'''import fcntl,json,os,pathlib,subprocess,time
root=pathlib.Path('/files/jarvis');root.mkdir(parents=True,exist_ok=True)
marker={marker!r}
assert not (root/'owner').exists(), 'Workspace is not isolated'
(root/'owner').write_text(marker)
(root/'source').write_text('atomic')
os.link(root/'source',root/'linked')
os.rename(root/'source',root/'renamed')
with (root/'lock').open('w') as f: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
assert (root/'linked').read_text()==(root/'renamed').read_text()=='atomic'
subprocess.run(['git','init',str(root/'repo')],check=True,capture_output=True,timeout=30)
subprocess.run(['dotnet','new','console','--output',str(root/'build'),'--no-restore'],check=True,capture_output=True,timeout=90)
subprocess.run(['dotnet','build',str(root/'build'),'--nologo'],check=True,capture_output=True,timeout=180)
v=os.statvfs(root)
print(json.dumps({{'worker':marker,'workspaceBytes':v.f_blocks*v.f_frsize,'freeBytes':v.f_bavail*v.f_frsize,'posixPassed':True,'buildPassed':True}}))
'''


def checked_exec(box, script: str) -> dict:
    result = box.exec(command(script))
    if result.exit_code != 0:
        # stdout/stderr may include credentials or signed URLs; do not retain them.
        raise RuntimeError('Sandbox qualification command failed')
    return json.loads(result.stdout.strip().splitlines()[-1])


def qualify(args) -> None:
    from azure.containerapps.sandbox import SandboxGroupClient, SandboxVolume, endpoint_for_region
    from azure.identity import AzureCliCredential

    outputs = json.loads(args.outputs.read_text())
    identity = outputs['identityResourceId']['value']
    client_id = outputs['identityClientId']['value']
    run = 'q-' + uuid4().hex
    labels = {'jarvis-purpose': 'qualification', 'jarvis-run': run}
    evidence = {'run': run, 'workersRequested': WORKERS, 'routingChanged': False,
                'image': args.image, 'results': [], 'passed': False, 'cleanupPassed': False}
    volumes: list[str] = []
    boxes = []
    def save():
        args.state.write_text(json.dumps(evidence, indent=2) + '\n')
    save()
    credential = AzureCliCredential()
    group = SandboxGroupClient(endpoint_for_region('swedencentral'), credential,
        subscription_id=args.subscription, resource_group='rg-jarvis', sandbox_group='jarvis-factory')
    try:
        # Only read-only permission probes are retried while a new scoped role propagates.
        for attempt in range(13):
            try:
                list(group.list_sandboxes(labels=labels))
                break
            except Exception as error:
                if getattr(error, 'status_code', None) != 403 or attempt == 12:
                    raise
                time.sleep(10)
        image = group.begin_create_disk_image(args.image, name='factory-qualified-' + args.image[-16:],
            managed_identity_resource_id=identity, entrypoint=['/bin/sh', '-c'], cmd=['sleep infinity'],
            polling_timeout=1200).result()
        evidence['diskImageId'] = image.id
        save()
        # Create one, inspect its disk/build, then add four. Never run six or 100.
        for index in range(WORKERS):
            volume = f'{run}-{index}'
            volumes.append(volume)  # Include uncertain creates in owned cleanup.
            group.create_volume(volume, type='DataDisk', size='128Gi', labels=labels)
            box = group.begin_create_sandbox(disk=None, disk_id=image.id, cpu='2000m', memory='4096Mi',
                disk_size='40Gi', auto_suspend_seconds=900, auto_suspend_mode='Disk',
                labels={**labels, 'jarvis-worker': str(index)},
                environment={'AZURE_CLIENT_ID': client_id, 'KEY_VAULT_URI': args.vault_uri,
                             'JARVIS_WORK_ROOT': '/files/jarvis'},
                volumes=[SandboxVolume(volume_name=volume, mountpoint='/files')],
                polling_timeout=600).result()
            boxes.append(box)
            # Explicit filesystem ownership; SDK execution and image USER are qualified live.
            result = box.exec('mkdir -p /files/jarvis && chmod 700 /files/jarvis')
            if result.exit_code:
                raise RuntimeError('Workspace directory setup failed')
            record = checked_exec(box, probe_script(volume))
            evidence['results'].append(record)
            save()
            print(f'Worker {index + 1}/{WORKERS}: workspace and build passed', flush=True)
        # All five ready before concurrent execution; do not use model calls for a disk test.
        def overlap(pair):
            index, box = pair
            timings = checked_exec(box, 'import json,time\ns=time.time()\ntime.sleep(30)\nprint(json.dumps({"startedAt":s,"finishedAt":time.time()}))')
            return index, timings
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            for index, timings in pool.map(overlap, enumerate(boxes)):
                evidence['results'][index].update(timings)
        validate_results(evidence['results'])
        evidence['overlappingWorkers'] = WORKERS
        save()
        # Credential access is observed as booleans only; no model tasks or writes.
        checked_exec(boxes[0], '''import asyncio,json,sys
sys.path.insert(0,'/app')
import app
async def check():
 for agent in ('codex','copilot'):
  credentials=await app._credentials_for(agent,include_github_token=False)
  assert credentials
  credentials.clear()
 print(json.dumps({'credentialsAccessible':True}))
asyncio.run(check())
''')
        evidence['credentialsAccessible'] = True
        first = boxes[0]
        first.begin_stop().result()
        evidence['stoppedState'] = first.get().state
        if evidence['stoppedState'] not in ('Stopped', 'Suspended'):
            raise RuntimeError('Independent worker shutdown was not observed')
        first.begin_resume().result()
        persisted = checked_exec(first, "import json,pathlib\nprint(json.dumps({'owner':pathlib.Path('/files/jarvis/owner').read_text()}))")
        if persisted['owner'] != volumes[0]:
            raise RuntimeError('Workspace did not survive stop/resume')
        evidence['diskPersistencePassed'] = True
        evidence['passed'] = True
        save()
    except Exception as error:
        evidence['failureType'] = type(error).__name__
        evidence['httpStatus'] = getattr(error, 'status_code', None)
        save()
        raise RuntimeError('Managed worker qualification failed; inspect sanitized evidence') from None
    finally:
        # A lost create response may still allocate a sandbox. Reconcile by this run's labels.
        errors = []
        try:
            for box in group.list_sandboxes(labels=labels):
                if all(box.labels.get(k) == v for k, v in labels.items()):
                    try:
                        group.get_sandbox_client(box.id).delete()
                    except Exception as error:
                        errors.append(type(error).__name__)
        except Exception as error:
            errors.append(type(error).__name__)
        for volume in volumes:
            for attempt in range(20):
                try:
                    group.delete_volume(volume)
                    break
                except Exception as error:
                    if getattr(error, 'status_code', None) == 404:
                        break
                    if getattr(error, 'status_code', None) == 409 and attempt < 19:
                        time.sleep(3)
                        continue
                    errors.append(type(error).__name__)
                    break
        evidence['cleanupErrors'] = errors
        evidence['cleanupPassed'] = not errors
        save()
        credential.close()
        if errors:
            raise RuntimeError('Canary resource cleanup requires follow-up') from None


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--subscription', required=True)
    parser.add_argument('--outputs', type=Path, required=True)
    parser.add_argument('--image', required=True)
    parser.add_argument('--vault-uri', required=True)
    parser.add_argument('--state', type=Path, required=True)
    qualify(parser.parse_args())
