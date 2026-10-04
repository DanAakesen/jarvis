import asyncio
import json
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
ROOT = Path(__file__).resolve().parents[5]
# Run from the repository root after runner/ is available.
# Use the runner's Python environment; this helper never calls Azure or starts ACP.
sys.path.insert(0, str(Path(sys.argv[1] if len(sys.argv) > 1 else 'runner').resolve()))
from azure.ai.agentserver.invocations import InvocationAgentServerHost
original = InvocationAgentServerHost.__init__
def init(self, **kwargs):
    kwargs['configure_observability'] = None
    original(self, **kwargs)
InvocationAgentServerHost.__init__ = init
import app
from starlette.requests import Request

async def main(work_root):
    app.WORK_ROOT = Path(work_root)
    app.time.time = lambda: 1791038000.0
    app.tasks = {}
    app.session_clients = {}
    app.session_locks = {}
    records = {}
    gate = asyncio.Event()
    async def controlled_task(state):
        await gate.wait()
    app._run_task = controlled_task
    app._steer_then_run = controlled_task
    workspace = {'repository': 'DanAakesen/jarvis', 'defaultBranch': 'main', 'branch': 'jarvis/task-42'}
    def request(invocation, body=None):
        req = Request({'type': 'http', 'method': 'POST', 'headers': [], 'path': '/invocations',
                       'state': {'session_id': 'capture-session', 'invocation_id': invocation}})
        async def json_body():
            return body
        req.json = json_body
        return req
    async def capture(name, handler, req):
        response = await handler(req)
        records[name] = {'status_code': response.status_code, 'body': json.loads(response.body)}
        body = await req.json()
        if body is not None:
            records[name]['request'] = body
    await capture('task_start', app.invoke, request('capture-task', {**workspace, 'agent':'copilot','task':'fixture task'}))
    session_dir = app._session_dir('capture-session')
    session_dir.mkdir(parents=True, exist_ok=True)
    (session_dir / app.WORKSPACE_FILE).write_text(json.dumps(workspace), encoding='utf-8')
    app.tasks['capture-task'].started_at = 1791038000.0
    app.tasks['capture-task'].status = 'running'
    app.tasks['capture-task'].events = [{'at':1791038000.0,'kind':'started','data':{'agent':'copilot'}}]
    await capture('status_running', app.get_invocation, request('capture-task'))
    await capture('resume', app.invoke, request('capture-resume', {**workspace, 'agent':'copilot','task':'continue fixture task'}))
    app.tasks['capture-resume'].status = 'completed'
    await capture('steer', app.invoke, request('capture-steer', {'agent':'copilot','mode':'steer','message':'fixture correction'}))
    app.tasks['capture-steer'].status = 'completed'
    await capture('pause_active', app.invoke, request('capture-pause', {'mode':'pause'}))
    app.tasks['capture-task'].status = 'completed'
    app.tasks['capture-task'].finished_at = 1791038060.0
    app.tasks['capture-task'].result = {'acp_session_id':'fixture-acp', 'response':{'stopReason':'end_turn'}}
    app.tasks['capture-task'].events = [{'at': 1791038000.0, 'kind':'completed', 'data':{'result': app.tasks['capture-task'].result}}]
    await capture('status_completed', app.get_invocation, request('capture-task'))
    await capture('pause_idle', app.invoke, request('capture-idle', {'mode':'pause'}))
    app.tasks['capture-task'].status = 'running'
    await capture('cancel', app.cancel_invocation, request('capture-task'))
    await capture('status_cancelled', app.get_invocation, request('capture-task'))
    await capture('status_not_found', app.get_invocation, request('unknown'))
    Path(sys.argv[2] if len(sys.argv) > 2 else ROOT / 'jarvis-runner-captured-responses.json').write_text(json.dumps({
        'source':'Actual runner/app.py handler responses captured locally; external ACP work stubbed; not Azure envelopes',
        'runner_source_commit':subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'runner_source_modified':bool(subprocess.check_output(['git', 'status', '--porcelain', '--', 'runner/app.py'], cwd=ROOT, text=True).strip()),
        'capture_clock':1791038000.0, 'records':records}, indent=2)+'\n')
with TemporaryDirectory(prefix=".jarvis-foundry-recording-", dir=ROOT) as work_root:
    asyncio.run(main(work_root))
