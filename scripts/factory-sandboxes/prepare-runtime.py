"""Import an immutable runner image and emit only non-secret qualification settings."""
import json
import os
from pathlib import Path

from azure.containerapps.sandbox import (
    RegistryCredentials,
    SandboxGroupClient,
    endpoint_for_region,
)
from azure.identity import AzureCliCredential
from image_auth import acr_credentials
from qualify import failure_details

root = Path(os.environ['RUNNER_TEMP'])
infra = json.loads((root / 'infra.json').read_text())
group_outputs = json.loads((root / 'sandbox-outputs.json').read_text())
bootstrap = json.loads(Path('infra/bootstrap.output.json').read_text())
credential = AzureCliCredential()
client = SandboxGroupClient(endpoint_for_region('swedencentral'), credential,
    subscription_id=os.environ['SUBSCRIPTION_ID'], resource_group='rg-jarvis', sandbox_group='jarvis-factory', retry_total=0)
stage = 'registry-login'
try:
    reused_path = root / 'reused-worker-image.json'
    if reused_path.exists():
        reused = json.loads(reused_path.read_text())
        stage = 'reused-image-readback'
        image = client.get_disk_image(reused['imageId'])
        worker_image = reused['image']
    else:
        worker_image = os.environ['WORKER_IMAGE']
        registry_credentials = RegistryCredentials(**acr_credentials(worker_image, os.environ['SUBSCRIPTION_ID']))
        stage = 'image-import'
        image = client.begin_create_disk_image(worker_image,
            name='factory-' + os.environ['GITHUB_SHA'][:16],
            registry_credentials=registry_credentials,
            entrypoint=['/bin/sh', '-c'], cmd=['sleep infinity'], polling_timeout=1200).result()
        registry_credentials.token = ''
    config = {'subscription': os.environ['SUBSCRIPTION_ID'], 'storage': os.environ['QA_STORAGE'],
        'imageId': image.id, 'image': worker_image, 'source': os.environ['GITHUB_SHA'],
        'identityClientId': group_outputs['identityClientId']['value'],
        'vaultUri': 'https://' + infra['keyVaultName']['value'] + '.vault.azure.net/',
        'backendUrl': 'https://' + infra['backendFqdn']['value'],
        'apiScope': bootstrap['api']['identifierUri'] + '/.default'}
    if reused_path.exists():
        config['imageOrigin'] = {'source': reused['source'], 'run': reused['run']}
    (root / 'pool-config.json').write_text(json.dumps(config, indent=2) + '\n')
except Exception as error:  # noqa: BLE001 - CLI boundary must not print credential-bearing SDK tracebacks.
    print(json.dumps(failure_details(error, stage)))
    raise SystemExit(1) from None
finally:
    credential.close()
