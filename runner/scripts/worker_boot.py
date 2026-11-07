"""VM host launcher: managed-identity ACR pull, then a single worker container."""
import json
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path


def request(url, data=None, headers=None):
    with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers or {}), timeout=20) as response:
        return json.load(response)


def main():
    config = json.loads(Path('/etc/jarvis-worker.json').read_text())
    registry = config['image'].split('/')[0]
    identity = request('http://169.254.169.254/metadata/identity/oauth2/token?' + urllib.parse.urlencode({
        'api-version': '2018-02-01', 'resource': 'https://management.azure.com/'}), headers={'Metadata': 'true'})
    token = request(f'https://{registry}/oauth2/exchange', urllib.parse.urlencode({
        'grant_type': 'access_token', 'service': registry, 'access_token': identity['access_token']}).encode())
    subprocess.run(['docker', 'login', registry, '-u', '00000000-0000-0000-0000-000000000000', '--password-stdin'],
                   input=token['refresh_token'], text=True, check=True, capture_output=True)
    try:
        subprocess.run(['docker', 'pull', config['image']], check=True, capture_output=True)
    finally:
        subprocess.run(['docker', 'logout', registry], check=False, capture_output=True)
    subprocess.run(['docker', 'rm', '-f', 'jarvis-factory'], check=False, capture_output=True)
    command = ['docker', 'run', '--rm', '--name', 'jarvis-factory', '--network', 'host',
               '--init', '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3',
               '-v', '/mnt/jarvis-workspace:/files', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges']
    for name, value in config['environment'].items():
        command.extend(['-e', f'{name}={value}'])
    subprocess.run(command + [config['image'], 'python', 'worker.py'], check=True)


if __name__ == '__main__':
    main()
