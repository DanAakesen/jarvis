"""Request only the compute headroom for the approved Sweden Central worker.

Uses the existing Azure CLI login. No role grants, VM allocation, region/size
changes or retry of a quota write. A submitted request is not an approved quota.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

REGION = 'swedencentral'
RESOURCES = ('standardDASv5Family', 'cores')
API_VERSION = '2025-09-01'


def quota_count(value):
    if type(value) is int and value >= 0:
        return value
    if type(value) is float and value.is_integer() and 0 <= value <= 2**53:
        return int(value)
    raise ValueError('Invalid quota limit or usage')


def required_limit(limit, usage):
    return max(quota_count(limit), quota_count(usage) + 2)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Unexpected quota API redirect')


class QuotaClient:
    def __init__(self, subscription):
        self.subscription = str(uuid.UUID(subscription))
        self.scope = f'/subscriptions/{self.subscription}/providers/Microsoft.Compute/locations/{REGION}'
        self.base = f'https://management.azure.com{self.scope}/providers/Microsoft.Quota/'
        self.token = None
        self.resource_names = None
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, method, url, payload=None):
        if not url.startswith(self.base) or urllib.parse.urlsplit(url).fragment:
            raise ValueError('Quota status URL is outside the approved scope')
        if self.token is None:
            result = subprocess.run([
                'az', 'account', 'get-access-token', '--subscription', self.subscription,
                '--resource', 'https://management.azure.com/', '--query', 'accessToken', '-o', 'tsv',
            ], check=False, capture_output=True, text=True, timeout=60)
            if result.returncode or not result.stdout.strip():
                raise RuntimeError('Azure login unavailable')
            self.token = result.stdout.strip()
        request = urllib.request.Request(url, method=method,
            data=json.dumps(payload).encode() if payload is not None else None,
            headers={'Authorization': f'Bearer {self.token}', 'Content-Type': 'application/json'})
        try:
            with self.opener.open(request, timeout=60) as response:
                raw = response.read(1_000_001)
                if len(raw) > 1_000_000:
                    raise RuntimeError('Quota response exceeded its bound')
                body = json.loads(raw) if raw else {}
                return body, response.headers.get('Location')
        except urllib.error.HTTPError as error:
            try:
                code = json.loads(error.read(65536)).get('error', {}).get('code', '')
            except (ValueError, AttributeError):
                code = ''
            code = code if isinstance(code, str) and re.fullmatch(r'[A-Za-z0-9_.-]{1,80}', code) else 'Unknown'
            raise RuntimeError(f'Quota API HTTP {error.code}: {code}') from None
        except (urllib.error.URLError, TimeoutError):
            raise RuntimeError('Quota API outcome unavailable; inspect request status before resubmitting') from None

    def url(self, operation, resource):
        return f'{self.base}{operation}/{resource}?api-version={API_VERSION}'

    def resolve_resource(self, resource):
        if resource.casefold() not in {name.casefold() for name in RESOURCES}:
            raise ValueError('Quota resource is outside the approved worker scope')
        if self.resource_names is None:
            names = {}
            url = f'{self.base}quotas?api-version={API_VERSION}'
            for _ in range(20):
                page, _ = self.request('GET', url)
                for row in page['value']:
                    name = row.get('properties', {}).get('name', {}).get('value') or row.get('name')
                    if not isinstance(name, str) or name.casefold() not in {x.casefold() for x in RESOURCES}:
                        continue
                    key = name.casefold()
                    if key in names and names[key] != name:
                        raise ValueError('Ambiguous quota resource name')
                    names[key] = name
                url = page.get('nextLink')
                if not url:
                    break
            else:
                raise RuntimeError('Quota catalogue pagination exceeded its bound')
            self.resource_names = names
        name = self.resource_names.get(resource.casefold())
        if name is None:
            raise RuntimeError(f'Approved worker resource missing from Azure quota catalogue: {resource}')
        return name

    def diagnostics(self):
        result = {'catalogueResourceNames': sorted(self.resource_names or {})}
        response = subprocess.run([
            'az', 'vm', 'list-usage', '--location', REGION,
            '--subscription', self.subscription, '--output', 'json', '--only-show-errors',
        ], check=False, capture_output=True, text=True, timeout=60)
        if response.returncode:
            result['computeUsageRead'] = 'Unavailable'
            return result
        wanted = {name.casefold() for name in RESOURCES}
        rows = []
        for row in json.loads(response.stdout):
            name = row.get('name', {}).get('value', '')
            if isinstance(name, str) and name.casefold() in wanted:
                limit, used = quota_count(row['limit']), quota_count(row['currentValue'])
                rows.append({'resource': name, 'limit': limit, 'usage': used,
                             'requiredLimit': required_limit(limit, used)})
        result['computeUsage'] = rows
        return result

    def snapshot(self, resource):
        resource = self.resolve_resource(resource)
        quota, _ = self.request('GET', self.url('quotas', resource))
        usage, _ = self.request('GET', self.url('usages', resource))
        limit = quota_count(quota['properties']['limit']['value'])
        used = quota_count(usage['properties']['usages']['value'])
        return {'resource': resource, 'limit': limit, 'usage': used,
                'requiredLimit': required_limit(limit, used)}

    def submit(self, resource, target):
        resource = self.resolve_resource(resource)
        _, location = self.request('PUT', self.url('quotas', resource), {
            'properties': {'name': {'value': resource},
                           'limit': {'limitObjectType': 'LimitValue', 'value': target}},
        })
        if location and not location.startswith(self.base):
            raise RuntimeError('Quota request submitted; unexpected status location requires inspection')
        return location


def run(client, submit, save, sleep=time.sleep):
    evidence = {'region': REGION, 'vmSize': 'Standard_D2as_v5', 'workspaceGiB': 128,
                'requiredFreeVcpus': 2, 'ready': False, 'quotas': []}
    save(evidence)
    try:
        # Read both before any write; missing permissions must not become a guess.
        evidence['quotas'] = [client.snapshot(resource) for resource in RESOURCES]
        save(evidence)
        if submit:
            for row in evidence['quotas']:
                # Family increases can also raise the regional limit. Read again.
                row.update(client.snapshot(row['resource']))
                if row['limit'] >= row['requiredLimit']:
                    row['state'] = 'AlreadyAvailable'
                    save(evidence)
                    continue
                row['state'] = 'Submitting'
                save(evidence)
                location = client.submit(row['resource'], row['requiredLimit'])
                row.update(state='Submitted', statusUrl=location)
                save(evidence)
                # Read-only polling is bounded; never repeat the PUT on timeout.
                for attempt in range(12):
                    current = client.snapshot(row['resource'])
                    row['observedLimit'] = current['limit']
                    row['observedUsage'] = current['usage']
                    if current['limit'] - current['usage'] >= 2:
                        row['state'] = 'Available'
                        break
                    if location:
                        status, _ = client.request('GET', location)
                        state = status.get('status') or status.get('properties', {}).get('provisioningState')
                        if state in ('Failed', 'Canceled', 'Cancelled', 'Denied'):
                            row['state'] = state
                            break
                    if attempt < 11:
                        sleep(10)
                save(evidence)
        final = [client.snapshot(resource) for resource in RESOURCES]
        evidence['readback'] = final
        evidence['ready'] = all(row['limit'] - row['usage'] >= 2 for row in final)
        save(evidence)
        return evidence
    except (RuntimeError, ValueError, KeyError, TypeError) as error:
        # Only controlled diagnostics are retained, never token/provider response bodies.
        evidence['error'] = str(error) if isinstance(error, RuntimeError) else 'Invalid quota response'
        if isinstance(client, QuotaClient):
            evidence['catalogueNames'] = sorted(client.resource_names or {})
            evidence['responseFailureType'] = type(error).__name__
            try:
                evidence['diagnostics'] = client.diagnostics()
            except (RuntimeError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired):
                evidence['diagnostics'] = {'computeUsageRead': 'Unavailable'}
        save(evidence)
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--subscription', required=True)
    parser.add_argument('--state', required=True, type=Path)
    parser.add_argument('--submit', action='store_true')
    args = parser.parse_args()
    args.state.parent.mkdir(parents=True, exist_ok=True)

    def save(value):
        args.state.write_text(json.dumps(value, indent=2))

    try:
        result = run(QuotaClient(args.subscription), args.submit, save)
    except (RuntimeError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired):
        raise SystemExit('Quota inspection/request failed; see the sanitized evidence artifact') from None
    print(json.dumps(result))
    if args.submit and not result['ready']:
        raise SystemExit('Quota is not available yet; submitted is not approved')


if __name__ == '__main__':
    main()
