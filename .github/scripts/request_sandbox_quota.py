"""Request only the approved 800 SandboxCores target; never allocate workers."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

TARGET = 800
REGION = 'swedencentral'
API = '2025-09-01'


def client(subscription):
    subscription = str(uuid.UUID(subscription))
    scope = f'/subscriptions/{subscription}/providers/Microsoft.App/locations/{REGION}'
    base = f'https://management.azure.com{scope}/providers/Microsoft.Quota/quotas'
    usage = f'https://management.azure.com{scope}/usages?api-version=2024-03-01'

    def call(method, url, body=None):
        parsed = urlsplit(url)
        if parsed.scheme != 'https' or parsed.netloc != 'management.azure.com' or parsed.fragment:
            raise ValueError('Quota URL outside the approved service')
        if method == 'GET':
            if parsed.path not in (scope + '/usages', urlsplit(base).path):
                raise ValueError('Quota read outside the approved scope')
        elif method == 'PUT':
            name = parsed.path.removeprefix(urlsplit(base).path + '/')
            if not re.fullmatch('SandboxCores', name, re.IGNORECASE) or body != {
                'properties': {'name': {'value': name}, 'limit': {'limitObjectType': 'LimitValue', 'value': TARGET}}
            }:
                raise ValueError('Only the exact SandboxCores target is authorized')
        else:
            raise ValueError('Unsupported quota operation')
        args = ['az', 'rest', '--method', method, '--url', url, '--only-show-errors', '--output', 'json']
        if body is not None:
            args += ['--body', json.dumps(body)]
        result = subprocess.run(args, capture_output=True, text=True, timeout=90, check=False)
        if result.returncode:
            match = re.search(r'\(([A-Za-z][A-Za-z0-9]{1,60})\)', result.stderr)
            raise RuntimeError('Quota API: ' + (match[1] if match else 'request failed'))
        value = json.loads(result.stdout) if result.stdout.strip() else {}
        if not isinstance(value, dict):
            raise TypeError('Invalid quota response')
        return value
    return base, usage, call


def actual_limit(value):
    matches = [r for r in value.get('value', []) if isinstance(r, dict)
               and isinstance(r.get('name'), dict) and isinstance(r['name'].get('value'), str)
               and r['name']['value'].casefold() == 'sandboxcores']
    if len(matches) != 1 or type(matches[0].get('limit')) is not int or matches[0]['limit'] < 0:
        raise ValueError('SandboxCores usage limit is missing or ambiguous')
    return matches[0]['limit']


def request(subscription, state, *, make_client=client, pause=time.sleep):
    base, usage, call = make_client(subscription)
    result = {'targetCores': TARGET, 'workersAllocated': 0, 'requestAttempted': False, 'approved': False}
    def save():
        state.write_text(json.dumps(result, indent=2) + '\n')
    save()
    try:
        limit = actual_limit(call('GET', usage))
        result['observedLimit'] = limit
        if limit >= TARGET:
            result['approved'] = True
            save()
            return result
        names, url = [], base + '?api-version=' + API
        for _ in range(10):
            page = call('GET', url)
            for row in page.get('value', []):
                props = row.get('properties') if isinstance(row, dict) else None
                obj = props.get('name') if isinstance(props, dict) else None
                name = obj.get('value') if isinstance(obj, dict) else None
                if isinstance(name, str) and name.casefold() == 'sandboxcores':
                    names.append(name)
            url = page.get('nextLink')
            if not url:
                break
        if url or len(names) != 1 or not re.fullmatch('SandboxCores', names[0], re.IGNORECASE):
            raise RuntimeError('Quota API does not expose one canonical SandboxCores resource; support request required')
        name = names[0]
        result['requestAttempted'] = True
        save()  # An uncertain PUT is never automatically submitted again.
        call('PUT', base + '/' + name + '?api-version=' + API, {
            'properties': {'name': {'value': name}, 'limit': {'limitObjectType': 'LimitValue', 'value': TARGET}}})
        result['submitted'] = True
        save()
        for _ in range(15):
            limit = actual_limit(call('GET', usage))
            result['observedLimit'] = limit
            result['approved'] = limit >= TARGET
            save()
            if result['approved']:
                break
            pause(20)
        return result
    except (RuntimeError, ValueError, TypeError, OSError, subprocess.TimeoutExpired) as error:
        result['failureType'] = type(error).__name__
        if type(error) is RuntimeError:
            result['failure'] = str(error)
        save()
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--subscription', required=True)
    parser.add_argument('--state', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(request(args.subscription, args.state), indent=2))
