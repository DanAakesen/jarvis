"""Short-lived ACR login for importing our immutable runner, never worker credentials."""
from __future__ import annotations

import json
import re
import subprocess


def acr_credentials(image: str, subscription: str) -> dict:
    match = re.fullmatch(r'([a-z0-9]{5,50})\.azurecr\.io/jarvis-runner-dotnet@sha256:[a-f0-9]{64}', image)
    if not match:
        raise ValueError('An immutable Jarvis runner image in Azure Container Registry is required')
    registry = match.group(1)
    result = subprocess.run(['az', 'acr', 'login', '--name', registry, '--subscription', subscription,
        '--expose-token', '--output', 'json', '--only-show-errors'], capture_output=True, text=True, timeout=60)
    if result.returncode or len(result.stdout) > 65536:
        raise RuntimeError('Deployment identity could not authenticate to the runner registry')
    try:
        value = json.loads(result.stdout)
        token = value['accessToken']
        if (value.get('loginServer') != registry + '.azurecr.io' or not isinstance(token, str)
                or not 20 <= len(token) <= 16384 or any(ord(c) < 33 or ord(c) > 126 for c in token)):
            raise ValueError('Invalid registry login')
    except (ValueError, KeyError, TypeError):
        raise RuntimeError('Registry login did not return a valid short-lived credential') from None
    # ACR's documented Entra login username. No registry admin account is enabled.
    return {'username': '00000000-0000-0000-0000-000000000000', 'token': token}
