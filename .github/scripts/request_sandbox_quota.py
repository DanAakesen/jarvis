"""Request only the approved 800 SandboxCores target; never allocate workers."""
from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

TARGET = 800
REGION = 'swedencentral'
API = '2025-09-01'


def sanitized_detail(value):
    text = str(value)[:8192]
    text = re.sub(r'https?://\S+', '[url]', text, flags=re.IGNORECASE)
    text = re.sub(r'\b(?:Bearer|Basic)\s+\S+', '[credential]', text, flags=re.IGNORECASE)
    text = re.sub(r"\b(?:[\w-]*(?:token|password|secret|signature)|api[_-]?key|sig)[\"']?\s*[:=]\s*[\"']?[^\s\"',;]+", '[credential]', text, flags=re.IGNORECASE)
    text = re.sub(r'[A-Za-z0-9_/+=.-]{24,}', '[identifier]', text)
    return ' '.join(text.split())[:2000]


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
            if parsed.path not in (scope + '/usages', urlsplit(base).path, urlsplit(base).path.removesuffix('/quotas') + '/quotaRequests'):
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
            raise RuntimeError('Quota API: ' + sanitized_detail(result.stderr or 'request failed'))
        value = json.loads(result.stdout) if result.stdout.strip() else {}
        if not isinstance(value, dict):
            raise TypeError('Invalid quota response')
        return value
    return base, usage, call


def actual_limit(value):
    matches = [r for r in value.get('value', []) if isinstance(r, dict)
               and isinstance(r.get('name'), dict) and isinstance(r['name'].get('value'), str)
               and r['name']['value'].casefold() == 'sandboxcores']
    if len(matches) != 1:
        raise ValueError('SandboxCores usage limit is missing or ambiguous')
    limit = matches[0].get('limit')
    if type(limit) not in (int, float) or not math.isfinite(limit) or not 0 <= limit <= 2**53 or int(limit) != limit:
        raise ValueError('SandboxCores usage limit is invalid')
    return int(limit)


def request(subscription, state, *, inspect_only=False, make_client=client, pause=time.sleep):
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
        if inspect_only:
            history = call('GET', base.removesuffix('/quotas') + '/quotaRequests?api-version=' + API)
            result['requestHistory'] = [sanitized_detail(json.dumps(row)) for row in history.get('value', [])
                if 'sandboxcores' in json.dumps(row).casefold()][:20]
            result['historyHasMorePages'] = bool(history.get('nextLink'))
            result['inspectOnly'] = True
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
    parser.add_argument('--inspect-only', action='store_true')
    args = parser.parse_args()
    print(json.dumps(request(args.subscription, args.state, inspect_only=args.inspect_only), indent=2))
