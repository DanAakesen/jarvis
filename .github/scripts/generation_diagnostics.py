"""Fixed-scope, content-free generation diagnostics and OpenAI secret metadata."""
import json
import os
import re
import subprocess
import urllib.request
from pathlib import Path

from backend_log_preflight import Azure, PreflightBlocked, guid, require, targets
from native_push_readiness import azure, secret_metadata

EVENTS = {'proactive.failed', 'proactive.model_failed', 'image_generation.failed',
          'codex.image_cancel_failed', 'codex.image_session_cleanup_failed'}
REASONS = {'invalid_model_output', 'model_unavailable', 'internal_error', 'hook_failed',
           'job_update_failed', 'lease_lost', 'credential_unavailable', 'credential_missing',
           'transport_failed', 'provider_http_error', 'empty_response', 'invalid_image_response',
           'artifact_storage_failed', 'response_envelope', 'completion_incomplete', 'invalid_json',
           'invalid_findings', 'response_size_or_json'}


def query(app):
    require(re.fullmatch(r'ca-jarvis-backend-[a-z0-9]{13}', app) is not None, 'invalid_backend')
    events = ', '.join("'" + event + "'" for event in sorted(EVENTS))
    return f'''ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(24h)
| where ContainerAppName_s == '{app}'
| extend record = parse_json(Log_s)
| where tostring(record.msg) in ({events})
| project at = TimeGenerated, event = tostring(record.msg), reason = tostring(record.reason)
| top 50 by at desc'''


def safe_rows(payload):
    tables = payload.get('tables')
    require(isinstance(tables, list) and len(tables) == 1, 'invalid_query_result')
    table = tables[0]
    require(table.get('columns') == [{'name': 'at', 'type': 'datetime'}, {'name': 'event', 'type': 'string'},
                                     {'name': 'reason', 'type': 'string'}], 'invalid_query_columns')
    rows = table.get('rows')
    require(isinstance(rows, list) and len(rows) <= 50, 'invalid_query_rows')
    result = []
    for row in rows:
        require(isinstance(row, list) and len(row) == 3 and all(isinstance(v, str) for v in row), 'invalid_query_row')
        at, event, reason = row
        require(re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z', at) is not None, 'invalid_query_time')
        result.append({'at': at, 'event': event if event in EVENTS else 'unclassified',
                       'reason': reason if reason in REASONS else 'unclassified'})
    return result


def main():
    report = {}
    try:
        outputs = azure('deployment', 'group', 'show', '--resource-group', 'rg-jarvis',
                        '--name', os.environ['INFRA_DEPLOYMENT'], '--query', 'properties.outputs')
        metadata = secret_metadata(outputs['keyVaultName']['value'])
        report['openaiSecretNames'] = [item['name'] for item in metadata
                                      if re.fullmatch(r'[A-Za-z0-9-]{1,127}', item['name'])
                                      and re.search(r'openai', item['name'], re.IGNORECASE)]
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, subprocess.TimeoutExpired, PreflightBlocked):
        report['secretMetadata'] = 'unavailable'
    try:
        expected = targets(json.loads(Path('infra/bootstrap.output.json').read_text()),
                           json.loads(Path('apps/web/config.json').read_text()))
        workspace = Azure(expected['subscription']).get(expected['workspace_id'], '2023-09-01', 'properties.customerId')
        require(guid(workspace), 'invalid_workspace')
        token = subprocess.run(['az', 'account', 'get-access-token', '--resource', 'https://api.loganalytics.io',
                                '--query', 'accessToken', '--output', 'tsv', '--only-show-errors'],
                               capture_output=True, timeout=30, check=False)
        require(token.returncode == 0 and 0 < len(token.stdout) < 16384, 'log_token_unavailable')
        request = urllib.request.Request(f'https://api.loganalytics.azure.com/v1/workspaces/{workspace}/query',
            data=json.dumps({'query': query(expected['app_name']), 'timespan': 'PT24H'}).encode(),
            headers={'Authorization': 'Bearer ' + token.stdout.decode().strip(), 'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read(1024 * 1024 + 1)
        require(len(body) <= 1024 * 1024, 'query_size_limit')
        report['events'] = safe_rows(json.loads(body))
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, subprocess.TimeoutExpired, PreflightBlocked):
        report['logs'] = 'unavailable'
    print(json.dumps(report))


if __name__ == '__main__':
    main()
