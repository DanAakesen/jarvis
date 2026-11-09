"""Inspect native push wiring without reading keys or sending notifications."""
import json
import os
import re
import subprocess


def azure(*args, timeout=60):
    result = subprocess.run(['az', *args, '--subscription', os.environ['SUBSCRIPTION_ID'],
                             '--only-show-errors', '--output', 'json'],
                            capture_output=True, text=True, check=False, timeout=timeout)
    if result.returncode:
        raise RuntimeError('Azure read unavailable: ' + args[0])
    return json.loads(result.stdout)


def summarize(app):
    properties = app['properties']
    container = next(c for c in properties['template']['containers'] if c['name'] == 'backend')
    env = {item['name']: item for item in container.get('env', [])}
    flags = ['JARVIS_APPROVAL_NOTIFICATIONS_ENABLED', 'JARVIS_PROACTIVE_ENABLED',
             'JARVIS_PROACTIVE_ALERTS_ENABLED', 'JARVIS_PUSH_ENABLED', 'JARVIS_HEALTH_ENABLED']
    required = ['APNS_TEAM_ID', 'APNS_KEY_ID', 'APNS_SIGNING_KEY', 'APNS_ENVIRONMENT']
    return {
        'readyRevision': properties.get('latestReadyRevisionName'),
        'revisionReady': bool(properties.get('latestRevisionName')) and properties.get('latestRevisionName') == properties.get('latestReadyRevisionName'),
        'enabled': {name: env.get(name, {}).get('value') == 'true' for name in flags},
        'apnsConfigured': {name: bool(env.get(name, {}).get('value') or env.get(name, {}).get('secretRef')) for name in required},
        'apnsProduction': env.get('APNS_ENVIRONMENT', {}).get('value') == 'production',
        'signingKeyUsesSecretReference': bool(env.get('APNS_SIGNING_KEY', {}).get('secretRef')),
    }


def secret_metadata(vault, reader=None):
    """Read deployment metadata through ARM; this API never returns secret values."""
    reader = reader or azure
    if not re.fullmatch(r'[A-Za-z0-9-]{3,24}', vault):
        raise RuntimeError('Invalid Key Vault name')
    base = ('https://management.azure.com/subscriptions/' + os.environ['SUBSCRIPTION_ID']
            + '/resourceGroups/rg-jarvis/providers/Microsoft.KeyVault/vaults/' + vault + '/secrets')
    url = base + '?api-version=2026-05-15'
    result = []
    for _ in range(20):
        page = reader('rest', '--method', 'get', '--url', url)
        result.extend({'name': item['name'].split('/')[-1],
                       'attributes': {'enabled': item.get('properties', {}).get('attributes', {}).get('enabled')}}
                      for item in page['value'])
        url = page.get('nextLink')
        if not url:
            return result
        if not url.startswith(base + '?'):
            raise RuntimeError('Secret metadata pagination left the expected vault')
    raise RuntimeError('Secret metadata pagination exceeded its limit')


def main():
    outputs = azure('deployment', 'group', 'show', '--resource-group', 'rg-jarvis',
                    '--name', os.environ['INFRA_DEPLOYMENT'], '--query', 'properties.outputs')
    app = azure('containerapp', 'show', '--resource-group', 'rg-jarvis',
                '--name', outputs['backendAppName']['value'])
    report = summarize(app)
    try:
        metadata = secret_metadata(outputs['keyVaultName']['value'])
        names = [item['name'] for item in metadata]
        report['candidateSecretNames'] = [name for name in names if re.search(r'apns|apple-push', name, re.I)]
        report['secretNamesReadable'] = True
    except RuntimeError:
        report['secretNamesReadable'] = False
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
