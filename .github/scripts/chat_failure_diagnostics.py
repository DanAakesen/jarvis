"""Read recent Jarvis backend failure classifications; never emit raw logs or replay work."""
from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

from backend_log_preflight import Azure, PreflightBlocked, guid, require, targets

MAX_BYTES = 1024 * 1024


def allowed_codes() -> set[str]:
    source = Path('apps/backend/src/system-status.ts').read_text()
    section = source.split('export const chatAgentFailureReasons:', 1)[1].split(']);', 1)[0]
    return set(re.findall(r"'([a-z0-9_]+)'", section))


def query(app_name: str) -> str:
    require(re.fullmatch(r'ca-jarvis-backend-[a-z0-9]{13}', app_name) is not None, 'invalid_backend')
    return f'''ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(12h)
| where ContainerAppName_s == '{app_name}'
| where Log_s has 'conversation.reply_failed'
| extend record = parse_json(Log_s)
| project at = TimeGenerated, failure = tostring(record.failure)
| top 50 by at desc'''


def safe_rows(payload: object, codes: set[str]) -> list[dict]:
    require(isinstance(payload, dict) and isinstance(payload.get('tables'), list), 'invalid_query_result')
    tables = payload['tables']
    require(len(tables) == 1 and isinstance(tables[0], dict), 'invalid_query_result')
    table = tables[0]
    require(table.get('columns') == [{'name': 'at', 'type': 'datetime'}, {'name': 'failure', 'type': 'string'}], 'invalid_query_columns')
    rows = table.get('rows')
    require(isinstance(rows, list) and len(rows) <= 50, 'invalid_query_rows')
    safe = []
    for row in rows:
        require(isinstance(row, list) and len(row) == 2 and all(isinstance(v, str) for v in row), 'invalid_query_row')
        at, failure = row
        require(re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z', at) is not None, 'invalid_query_time')
        match = re.fullmatch(r'Chat agent failed \(([a-z0-9_]{1,64})\)', failure)
        code = match[1] if match and match[1] in codes else 'unclassified'
        safe.append({'at': at, 'code': code})
    return safe


def main() -> int:
    try:
        expected = targets(json.loads(Path('infra/bootstrap.output.json').read_text()),
                           json.loads(Path('apps/web/config.json').read_text()))
        workspace = Azure(expected['subscription']).get(expected['workspace_id'], '2023-09-01', 'properties.customerId')
        require(guid(workspace), 'invalid_workspace')
        token = subprocess.run(['az', 'account', 'get-access-token', '--resource', 'https://api.loganalytics.io',
                                '--query', 'accessToken', '--output', 'tsv', '--only-show-errors'],
                               capture_output=True, timeout=30, check=False)
        require(token.returncode == 0 and 0 < len(token.stdout) < 16384, 'log_token_unavailable')
        request = urllib.request.Request(
            f'https://api.loganalytics.azure.com/v1/workspaces/{workspace}/query',
            data=json.dumps({'query': query(expected['app_name']), 'timespan': 'PT12H'}).encode(),
            headers={'Authorization': 'Bearer ' + token.stdout.decode().strip(), 'Content-Type': 'application/json'})
        # Fixed destination and fixed query; no owner-supplied URL, KQL or time range.
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read(MAX_BYTES + 1)
        require(len(body) <= MAX_BYTES, 'query_size_limit')
        rows = safe_rows(json.loads(body), allowed_codes())
        print(json.dumps({'source': 'backend', 'windowHours': 12, 'failures': rows}))
        return 0
    except urllib.error.HTTPError as error:
        print(json.dumps({'blocked': 'log_query_http_' + str(error.code)}))
    except PreflightBlocked as error:
        print(json.dumps({'blocked': str(error)}))
    except (OSError, ValueError, KeyError, TypeError, IndexError, subprocess.TimeoutExpired):
        print(json.dumps({'blocked': 'diagnostic_unavailable'}))
    return 1


if __name__ == '__main__':
    sys.exit(main())
