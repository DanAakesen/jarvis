"""Inspect native push wiring without reading keys or sending notifications."""
import json
import os
import re
import subprocess


def azure(*args):
    result = subprocess.run(['az', *args, '--subscription', os.environ['SUBSCRIPTION_ID'],
                             '--only-show-errors', '--output', 'json'],
                            capture_output=True, text=True, check=False, timeout=60)
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
        'revisionReady': properties.get('latestRevisionName') == properties.get('latestReadyRevisionName'),
        'enabled': {name: env.get(name, {}).get('value') == 'true' for name in flags},
        'apnsConfigured': {name: bool(env.get(name, {}).get('value') or env.get(name, {}).get('secretRef')) for name in required},
        'apnsProduction': env.get('APNS_ENVIRONMENT', {}).get('value') == 'production',
        'signingKeyUsesSecretReference': bool(env.get('APNS_SIGNING_KEY', {}).get('secretRef')),
    }


def main():
    outputs = azure('deployment', 'group', 'show', '--resource-group', 'rg-jarvis',
                    '--name', os.environ['INFRA_DEPLOYMENT'], '--query', 'properties.outputs')
    app = azure('containerapp', 'show', '--resource-group', 'rg-jarvis',
                '--name', outputs['backendAppName']['value'])
    report = summarize(app)
    try:
        names = azure('keyvault', 'secret', 'list', '--vault-name', outputs['keyVaultName']['value'],
                      '--query', '[].name')
        report['candidateSecretNames'] = [name for name in names if re.search(r'apns|apple-push', name, re.I)]
        report['secretNamesReadable'] = True
    except RuntimeError:
        report['secretNamesReadable'] = False
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
