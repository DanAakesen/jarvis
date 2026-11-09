"""Reuse only an immutable image from this workflow with identical runner source."""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import zipfile
from pathlib import Path

from release_state import api, git


def validate(run, config, current_tree, previous_tree, subscription, registry):
    if (run.get('path') != '.github/workflows/factory-runtime.yml'
            or run.get('head_branch') != 'main' or run.get('event') != 'workflow_dispatch'
            or run.get('status') != 'completed' or config.get('source') != run.get('head_sha')
            or not re.fullmatch('[a-f0-9]{40}', current_tree or '')
            or current_tree != previous_tree or config.get('subscription') != subscription
            or not re.fullmatch('[a-f0-9-]{36}', config.get('imageId', ''))
            or not re.fullmatch(re.escape(registry) + r'/jarvis-runner-dotnet@sha256:[a-f0-9]{64}', config.get('image', ''))):
        raise ValueError('Prior worker image provenance or runner source mismatch')
    return {key: config[key] for key in ('image', 'imageId', 'source')}


def reuse(run_id, subscription, registry):
    if not re.fullmatch('[1-9][0-9]{0,17}', run_id):
        raise ValueError('Invalid previous runtime run')
    run = api('/actions/runs/' + run_id)
    listing = api(f'/actions/runs/{run_id}/artifacts?per_page=100')
    matches = [a for a in listing['artifacts'] if a['name'] == 'factory-runtime' and not a['expired']]
    if len(matches) != 1 or matches[0]['size_in_bytes'] > 1_048_576:
        raise ValueError('Prior runtime evidence is missing or ambiguous')
    item = matches[0]
    raw = api(f"/actions/artifacts/{item['id']}/zip", binary=True)
    if item.get('digest') != 'sha256:' + hashlib.sha256(raw).hexdigest():
        raise ValueError('Prior runtime artifact digest mismatch')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        info = archive.getinfo('pool-config.json')
        if info.file_size > 16_384:
            raise ValueError('Prior image configuration is oversized')
        config = json.loads(archive.read(info))
    source = run.get('head_sha', '')
    if not re.fullmatch('[a-f0-9]{40}', source):
        raise ValueError('Invalid prior source')
    tree = api(f'/git/trees/{source}')
    previous = [entry['sha'] for entry in tree['tree'] if entry['path'] == 'runner' and entry['type'] == 'tree']
    if len(previous) != 1:
        raise ValueError('Prior runner tree unavailable')
    result = validate(run, config, git('rev-parse', 'HEAD:runner'), previous[0], subscription, registry)
    result['run'] = int(run_id)
    return result


if __name__ == '__main__':
    result = reuse(os.environ['REUSE_IMAGE_RUN'], os.environ['SUBSCRIPTION_ID'], os.environ['REGISTRY_HOST'])
    (Path(os.environ['RUNNER_TEMP'])/'reused-worker-image.json').write_text(json.dumps(result) + '\n')
