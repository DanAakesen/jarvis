import asyncio
import json
import time
from types import SimpleNamespace
from uuid import uuid4

import pytest
from starlette.responses import JSONResponse
import app
from worker import Worker, validate_command


class Mailbox:
    def __init__(self):
        self.data = {}
        self.fail_response_once = False

    def get(self, key):
        return self.data.get(key)

    def put(self, key, value, create=False):
        if key.startswith('responses/') and self.fail_response_once:
            self.fail_response_once = False
            raise OSError('transient')
        if create and key in self.data:
            raise OSError('already claimed')
        self.data[key] = value

    def delete(self, key):
        self.data.pop(key, None)

    def list(self, prefix):
        return sorted(k for k in self.data if k.startswith(prefix))


def command():
    return {'operation': 'start', 'sessionId': 'vm128-' + str(uuid4()),
            'invocationId': 'vm128-' + str(uuid4()), 'body': {}}


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(app, 'tasks', {})
    monkeypatch.setattr(app, 'WORK_ROOT', tmp_path)
    monkeypatch.setattr(app, '_disk_snapshot', lambda: {'disk_total_bytes': 128 * 1024**3})


def test_lost_response_write_does_not_dispatch_twice(monkeypatch):
    calls = []

    async def invoke(request):
        calls.append(request.state.invocation_id)
        return JSONResponse({'status': 'running'})

    monkeypatch.setattr(app, 'invoke', invoke)
    mailbox = Mailbox()
    mailbox.fail_response_once = True
    worker = Worker(mailbox)
    item = command()
    mailbox.data['commands/1.json'] = item

    async def run():
        with pytest.raises(OSError):
            await worker.process('commands/1.json', item)
        await worker.process('commands/1.json', item)
        await worker.process('commands/1.json', item)
    asyncio.run(run())
    assert calls == [item['invocationId']]
    assert mailbox.data['responses/1.json']['status'] == 'running'


def test_old_claim_becomes_interrupted_without_replay(monkeypatch):
    async def fail(_):
        pytest.fail('Uncertain command must not replay')
    monkeypatch.setattr(app, 'invoke', fail)
    mailbox = Mailbox()
    item = command()
    mailbox.data['commands/1.json'] = item
    mailbox.data['claims/1.json'] = {'instance': 'old-process', 'at': time.time() - 200}
    mailbox.data[f"invocations/{item['invocationId']}.json"] = {'status': 'running'}
    asyncio.run(Worker(mailbox).process('commands/1.json', item))
    assert mailbox.data[f"invocations/{item['invocationId']}.json"]['status'] == 'interrupted'
    assert 'commands/1.json' not in mailbox.data


def test_active_worker_heartbeat_preserves_its_claim():
    mailbox = Mailbox()
    item = command()
    mailbox.data['claims/1.json'] = {'instance': 'old-process', 'at': time.time() - 500}
    mailbox.data['health.json'] = {'instance': 'old-process', 'at': time.time()}
    asyncio.run(Worker(mailbox).process('commands/1.json', item))
    assert 'responses/1.json' not in mailbox.data


def test_idle_deallocation_requires_no_work_or_queue(monkeypatch):
    async def run():
        mailbox = Mailbox()
        worker = Worker(mailbox)
        worker.last_busy -= 121
        assert await worker.tick()
        task = asyncio.create_task(asyncio.sleep(60))
        app.tasks['test'] = SimpleNamespace(invocation_id='test', worker=task)
        monkeypatch.setattr(worker, 'snapshot', lambda _: asyncio.sleep(0))
        assert not await worker.tick()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    asyncio.run(run())


def test_restart_recovers_status_without_starting_provider(tmp_path):
    item = command()
    path = tmp_path / item['sessionId'] / app.TASK_STATE_DIR / 'task.json'
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({'invocation_id': item['invocationId'], 'session_id': item['sessionId'],
        'agent': 'codex', 'status': 'running'}))
    mailbox = Mailbox()
    asyncio.run(Worker(mailbox).tick())
    assert mailbox.data[f"invocations/{item['invocationId']}.json"]['status'] == 'interrupted'
    assert app.tasks[item['invocationId']].worker is None


def test_probe_rejects_small_disk(monkeypatch):
    mailbox = Mailbox()
    item = command()
    item['operation'] = 'probe'
    monkeypatch.setattr(app, '_disk_snapshot', lambda: {'disk_total_bytes': 20 * 1024**3})
    asyncio.run(Worker(mailbox).process('commands/1.json', item))
    assert mailbox.data['responses/1.json']['status'] == 'failed'


@pytest.mark.parametrize('value', [{}, {'operation': 'renew-codex'},
    {'operation': 'start', 'sessionId': '../../root', 'invocationId': 'x'}])
def test_rejects_commands_outside_factory_contract(value):
    with pytest.raises(ValueError):
        validate_command(value)


def test_owned_claim_without_result_is_interrupted_not_replayed():
    mailbox = Mailbox()
    item = command()
    mailbox.data['claims/1.json'] = {'instance': 'same-process', 'at': time.time()}
    mailbox.data[f"invocations/{item['invocationId']}.json"] = {'status': 'queued'}
    asyncio.run(Worker(mailbox, instance_id='same-process').process('commands/1.json', item))
    assert mailbox.data[f"invocations/{item['invocationId']}.json"]['status'] == 'interrupted'


@pytest.mark.parametrize('operation', ['pause', 'cancel', 'delete-session'])
def test_controls_remove_queued_work_before_it_can_start(operation, monkeypatch):
    async def run():
        mailbox = Mailbox()
        worker = Worker(mailbox)
        queued = command()
        other = command()
        for key, item in [('commands/1.json', queued), ('commands/2.json', other)]:
            mailbox.data[key] = item
            mailbox.data[f"invocations/{item['invocationId']}.json"] = {'status': 'queued'}
        control = dict(queued, operation=operation)
        if operation != 'cancel':
            control['invocationId'] = command()['invocationId']

        async def invoke(request):
            assert request.state.invocation_id == control['invocationId']
            return JSONResponse({'session_id': queued['sessionId'], 'status': 'idle', 'paused_invocation': None})

        monkeypatch.setattr(app, 'invoke', invoke)
        monkeypatch.setattr(app, '_stop_running_turn', lambda *args: asyncio.sleep(0))
        monkeypatch.setattr(app, '_stop_session_client', lambda *args: asyncio.sleep(0))
        await worker.process('commands/3.json', control)
        assert 'commands/1.json' not in mailbox.data
        assert 'commands/2.json' in mailbox.data
        expected = 'paused' if operation == 'pause' else 'cancelled'
        assert mailbox.data[f"invocations/{queued['invocationId']}.json"]['status'] == expected
        assert mailbox.data['responses/1.json']['status'] == expected
    asyncio.run(run())


def test_steering_a_queued_session_waits_for_the_active_session(monkeypatch):
    async def run():
        task = asyncio.create_task(asyncio.sleep(60))
        app.tasks['other'] = SimpleNamespace(session_id='other', worker=task)
        item = dict(command(), operation='steer')
        mailbox = Mailbox()
        await Worker(mailbox).process('commands/1.json', item)
        assert 'claims/1.json' not in mailbox.data
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    asyncio.run(run())
