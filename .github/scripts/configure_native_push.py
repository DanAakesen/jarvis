"""Activate the owner's APNs keys by reference; private key material stays in Key Vault."""
import os
import time

from native_push_readiness import azure, summarize
from release_state import qualify

SECRET_NAMES = ('apns-team-id', 'apns-key-id', 'apns-signing-key')


def require_secrets(metadata):
    names = {item['name'] for item in metadata
             if item.get('attributes', {}).get('enabled') is True}
    missing = sorted(set(SECRET_NAMES) - names)
    if missing:
        raise RuntimeError('Create enabled Key Vault secrets first: ' + ', '.join(missing))


def settings():
    return ['JARVIS_APPROVAL_NOTIFICATIONS_ENABLED=true', 'APNS_ENVIRONMENT=production',
            'APNS_TEAM_ID=secretref:apns-team-id', 'APNS_KEY_ID=secretref:apns-key-id',
            'APNS_SIGNING_KEY=secretref:apns-signing-key']


def main():
    qualify(os.environ['GITHUB_SHA'])
    outputs = azure('deployment', 'group', 'show', '--resource-group', 'rg-jarvis',
                    '--name', os.environ['INFRA_DEPLOYMENT'], '--query', 'properties.outputs')
    vault = outputs['keyVaultName']['value']
    name = outputs['backendAppName']['value']
    metadata = azure('keyvault', 'secret', 'list', '--vault-name', vault)
    require_secrets(metadata)
    app = azure('containerapp', 'show', '--resource-group', 'rg-jarvis', '--name', name)
    identities = list(app['identity'].get('userAssignedIdentities', {}))
    if len(identities) != 1:
        raise RuntimeError('Expected the existing dedicated backend managed identity')
    identity = identities[0]
    # No secret show/get call: Container Apps resolves these protected references.
    references = [f'{secret}=keyvaultref:https://{vault}.vault.azure.net/secrets/{secret},identityref:{identity}'
                  for secret in SECRET_NAMES]
    azure('containerapp', 'secret', 'set', '--resource-group', 'rg-jarvis', '--name', name,
          '--secrets', *references, timeout=300)
    azure('containerapp', 'update', '--resource-group', 'rg-jarvis', '--name', name,
          '--set-env-vars', *settings(), timeout=600)
    for _ in range(36):
        actual = summarize(azure('containerapp', 'show', '--resource-group', 'rg-jarvis', '--name', name))
        if (actual['revisionReady'] and actual['enabled']['JARVIS_APPROVAL_NOTIFICATIONS_ENABLED']
                and all(actual['apnsConfigured'].values()) and actual['apnsProduction']
                and actual['signingKeyUsesSecretReference']):
            print('Native APNs configuration is active on the ready backend revision. Device receipt remains unverified.')
            return
        time.sleep(10)
    raise RuntimeError('The APNs-enabled backend revision did not become ready; inspect key configuration before retrying')


if __name__ == '__main__':
    main()
