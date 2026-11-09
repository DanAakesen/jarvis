"""Import an immutable runner image and emit only non-secret qualification settings."""
import json
import os
from pathlib import Path

from azure.containerapps.sandbox import SandboxGroupClient, endpoint_for_region
from azure.identity import AzureCliCredential
from qualify import failure_details

root = Path(os.environ['RUNNER_TEMP'])
infra = json.loads((root / 'infra.json').read_text())
group_outputs = json.loads((root / 'sandbox-outputs.json').read_text())
bootstrap = json.loads(Path('infra/bootstrap.output.json').read_text())
credential = AzureCliCredential()
client = SandboxGroupClient(endpoint_for_region('swedencentral'), credential,
    subscription_id=os.environ['SUBSCRIPTION_ID'], resource_group='rg-jarvis', sandbox_group='jarvis-factory')
try:
    image = client.begin_create_disk_image(os.environ['WORKER_IMAGE'],
        name='factory-' + os.environ['GITHUB_SHA'][:16],
        managed_identity_resource_id=group_outputs['identityResourceId']['value'],
        entrypoint=['/bin/sh', '-c'], cmd=['sleep infinity'], polling_timeout=1200).result()
    config = {'subscription': os.environ['SUBSCRIPTION_ID'], 'storage': os.environ['QA_STORAGE'],
        'imageId': image.id, 'image': os.environ['WORKER_IMAGE'], 'source': os.environ['GITHUB_SHA'],
        'identityClientId': group_outputs['identityClientId']['value'],
        'vaultUri': 'https://' + infra['keyVaultName']['value'] + '.vault.azure.net/',
        'backendUrl': 'https://' + infra['backendFqdn']['value'],
        'apiScope': bootstrap['api']['identifierUri'] + '/.default'}
    (root / 'pool-config.json').write_text(json.dumps(config, indent=2) + '\n')
except Exception as error:
    print(json.dumps(failure_details(error, 'image-import')))
    raise SystemExit(1) from None
finally:
    credential.close()
