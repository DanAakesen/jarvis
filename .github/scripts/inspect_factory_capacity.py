"""Read the managed-worker catalogue without allocating workers or changing quotas.

Catalogue visibility is not proof of usable capacity, data-plane permission,
128 GiB storage, or concurrent provider execution. Preserve those unknowns.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path

REGION = 'swedencentral'
RESOURCE_GROUP = 'rg-jarvis'
API_PATTERN = re.compile(r'20[0-9]{2}-[0-9]{2}-[0-9]{2}(?:-preview)?')


def arm_get(subscription, path):
    """Fixed-scope GET only. Never print Azure CLI stderr or provider bodies."""
    prefix = f'/subscriptions/{subscription}/'
    if not path.startswith(prefix) or any(c in path for c in '#\\\r\n'):
        raise ValueError('Invalid capacity inspection scope')
    try:
        response = subprocess.run([
            'az', 'rest', '--method', 'get', '--url', 'https://management.azure.com' + path,
            '--output', 'json', '--only-show-errors',
        ], capture_output=True, text=True, timeout=60, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return {'state': 'unavailable'}
    if response.returncode:
        return {'state': 'unavailable'}
    if len(response.stdout.encode()) > 5_000_000:
        return {'state': 'response_too_large'}
    try:
        value = json.loads(response.stdout)
    except ValueError:
        return {'state': 'invalid_response'}
    if not isinstance(value, dict):
        return {'state': 'invalid_response'}
    return {'state': 'observed', 'value': value}


def catalogue(provider):
    if provider.get('state') != 'observed':
        return {'state': provider['state']}
    value = provider['value']
    rows = value.get('resourceTypes')
    if not isinstance(rows, list):
        return {'state': 'invalid_response'}
    matches = [row for row in rows if isinstance(row, dict)
               and str(row.get('resourceType', '')).casefold() == 'sandboxgroups']
    if not matches:
        return {'state': 'not_listed', 'regionListed': False, 'apiVersions': [], 'locations': []}
    if len(matches) != 1:
        return {'state': 'ambiguous_response'}
    row = matches[0]
    versions, locations = row.get('apiVersions'), row.get('locations')
    if not isinstance(versions, list) or not isinstance(locations, list):
        return {'state': 'invalid_response'}
    versions = sorted({v for v in versions if isinstance(v, str) and API_PATTERN.fullmatch(v)}, reverse=True)
    locations = sorted({v for v in locations if isinstance(v, str)
                        and re.fullmatch(r'[A-Za-z0-9 ()-]{1,80}', v)})
    state = value.get('registrationState')
    return {
        'state': 'observed',
        'registrationState': state if state in {'Registered', 'Registering', 'NotRegistered', 'Unregistering'} else 'unknown',
        'apiVersions': versions,
        'locations': locations,
        'regionListed': any(v.replace(' ', '').casefold() == REGION for v in locations),
    }


def quota_observations(response):
    if response['state'] != 'observed':
        return {'state': response['state']}
    value = response['value']
    rows = value.get('value')
    if not isinstance(rows, list):
        return {'state': 'invalid_response'}
    quotas = []
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get('name'), dict):
            continue
        name = row['name'].get('value')
        if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_. -]{1,120}', name) or 'sandbox' not in name.casefold():
            continue
        observation = {'name': name}
        for key in ('limit', 'currentValue'):
            number = row.get(key)
            observation[key] = (number if type(number) in (int, float)
                                and math.isfinite(number) and 0 <= number <= 2**53 else None)
        quotas.append(observation)
    return {'state': 'observed' if quotas else 'not_listed', 'quotas': quotas,
            'morePages': bool(value.get('nextLink'))}


def requestable_quotas(response):
    if response['state'] != 'observed':
        return {'state': response['state']}
    rows = response['value'].get('value')
    if not isinstance(rows, list):
        return {'state': 'invalid_response'}
    names = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        properties = row.get('properties')
        name_object = properties.get('name') if isinstance(properties, dict) else None
        name = name_object.get('value') if isinstance(name_object, dict) else None
        if isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9_.-]{1,120}', name) and 'sandbox' in name.casefold():
            names.append(name)
    return {'state': 'observed' if names else 'not_listed', 'names': names,
            'morePages': bool(response['value'].get('nextLink'))}


def inspect(subscription, *, get=arm_get):
    subscription = str(uuid.UUID(subscription))
    result = {
        'observedAt': datetime.now(timezone.utc).isoformat(),
        'region': REGION,
        'targetConcurrentWorkers': 100,
        'requiredWorkspaceGiBPerWorker': 128,
        'capacityVerified': False,
        'dataPlaneAccessVerified': False,
        'workspaceVerified': False,
        'providerConcurrencyVerified': False,
        'mutationsPerformed': False,
    }
    provider = get(subscription, f'/subscriptions/{subscription}/providers/Microsoft.App?api-version=2021-04-01')
    result['sandboxGroups'] = catalogue(provider)
    catalog = result['sandboxGroups']
    versions = catalog.get('apiVersions', [])
    if catalog['state'] == 'observed' and versions:
        api = next((v for v in versions if not v.endswith('-preview')), versions[0])
        groups = get(subscription, f'/subscriptions/{subscription}/resourceGroups/{RESOURCE_GROUP}/providers/Microsoft.App/sandboxGroups?api-version={api}')
        rows = groups.get('value', {}).get('value')
        result['groupRead'] = {'state': groups['state']}
        if groups['state'] == 'observed':
            if isinstance(rows, list):
                result['groupRead'] = {'state': 'observed', 'countOnThisPage': len(rows),
                                       'morePages': bool(groups['value'].get('nextLink'))}
            else:
                result['groupRead'] = {'state': 'invalid_response'}
    usage = get(subscription, f'/subscriptions/{subscription}/providers/Microsoft.App/locations/{REGION}/usages?api-version=2024-03-01')
    result['sandboxQuota'] = quota_observations(usage)
    quota_catalogue = get(subscription, f'/subscriptions/{subscription}/providers/Microsoft.App/locations/{REGION}/providers/Microsoft.Quota/quotas?api-version=2025-09-01')
    result['quotaRequestCatalogue'] = requestable_quotas(quota_catalogue)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--subscription', required=True)
    parser.add_argument('--state', type=Path, required=True)
    args = parser.parse_args()
    result = inspect(args.subscription)
    args.state.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    return 0 if result['sandboxGroups']['state'] in {'observed', 'not_listed'} else 1


if __name__ == '__main__':
    raise SystemExit(main())
