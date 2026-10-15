import asyncio
import json
import os
import signal
import sys

import pytest
from starlette.requests import Request

import app


@pytest.fixture
def shutdown_client(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "_persist_task", lambda _state: None)
    monkeypatch.setattr(app, "ACP_STOP_TIMEOUT_SECONDS", 0.02, raising=False)
    monkeypatch.setattr(app, "ACP_STOP_CANCEL_TIMEOUT_SECONDS", 0.02, raising=False)
    wait_for = asyncio.wait_for

    async def short_legacy_deadline(awaitable, timeout):
        return await wait_for(awaitable, 0.02 if timeout == 10 else timeout)

    monkeypatch.setattr(asyncio, "wait_for", short_legacy_deadline)
    state = app.TaskState("shutdown", "owned-session", "copilot", "synthetic work", status="running")
    return app.ACPClient([], tmp_path, state, {})


class UnresponsiveProcess:
    def __init__(self, exits_on_kill=False):
        self.returncode = None
        self.exited = asyncio.Event()
        self.terminated = 0
        self.killed = 0
        self.exits_on_kill = exits_on_kill

    def terminate(self):
        self.terminated += 1

    def kill(self):
        self.killed += 1
        if self.exits_on_kill:
            self.returncode = -9
            self.exited.set()

    async def wait(self):
        await self.exited.wait()
        return self.returncode


def test_post_kill_exit_wait_is_bounded_and_failure_is_not_success(shutdown_client):
    async def exercise():
        client = shutdown_client
        client.process = UnresponsiveProcess()
        with pytest.raises(RuntimeError, match="process_exit"):
            await asyncio.wait_for(client.stop(), 1)
        assert client.process.terminated == 1
        assert client.process.killed == 1
        assert client.process.returncode is None

    asyncio.run(exercise())


def test_kill_exit_is_verified_before_success_and_stop_is_idempotent(shutdown_client):
    async def exercise():
        client = shutdown_client
        client.process = UnresponsiveProcess(exits_on_kill=True)
        await asyncio.wait_for(asyncio.gather(client.stop(), client.stop()), 1)
        await client.stop()
        assert client.process.returncode == -9
        assert client.process.terminated == 1
        assert client.process.killed == 1

    asyncio.run(exercise())


@pytest.mark.parametrize("stream", ["stdout", "stderr"])
@pytest.mark.parametrize("resists_cancel", [False, True])
def test_owned_reader_deadline_fails_explicitly_after_real_process_exit(
    shutdown_client, stream, resists_cancel,
):
    async def exercise():
        client = shutdown_client
        client.process = await asyncio.create_subprocess_exec(
            sys.executable, "-c", "pass",
        )
        await asyncio.wait_for(client.process.wait(), 5)
        entered = asyncio.Event()
        cancelled = asyncio.Event()
        release = asyncio.Event()

        async def blocked_reader():
            entered.set()
            try:
                await release.wait()
            except asyncio.CancelledError:
                cancelled.set()
                if resists_cancel:
                    await release.wait()
                else:
                    raise

        reader = asyncio.create_task(blocked_reader())
        setattr(client, "_reader_task" if stream == "stdout" else "_stderr_task", reader)
        stopping = None
        try:
            await entered.wait()
            stopping = asyncio.create_task(client.stop())
            done, _pending = await asyncio.wait({stopping}, timeout=1)
            assert done, "ACP stop exceeded the independent test deadline"
            with pytest.raises(RuntimeError, match="reader_shutdown"):
                stopping.result()
            assert cancelled.is_set()
            assert client.process.returncode == 0
        finally:
            release.set()
            await asyncio.wait_for(asyncio.gather(reader, return_exceptions=True), 1)
            if stopping is not None:
                await asyncio.wait_for(asyncio.gather(stopping, return_exceptions=True), 1)

    asyncio.run(exercise())


@pytest.mark.parametrize("stream", ["stdout", "stderr"])
def test_reader_exception_is_not_silently_accepted(shutdown_client, stream):
    async def exercise():
        client = shutdown_client

        async def failed_reader():
            raise ValueError("PRIVATE synthetic reader diagnostic")

        reader = asyncio.create_task(failed_reader())
        setattr(client, "_reader_task" if stream == "stdout" else "_stderr_task", reader)
        with pytest.raises(RuntimeError, match="reader_failed") as error:
            await asyncio.wait_for(client.stop(), 1)
        assert "PRIVATE" not in str(error.value)
        assert reader.done()

    asyncio.run(exercise())


def test_stop_cancellation_still_finishes_owned_teardown(shutdown_client):
    async def exercise():
        client = shutdown_client
        client.process = UnresponsiveProcess(exits_on_kill=True)
        stopping = asyncio.create_task(client.stop())
        await asyncio.sleep(0)
        stopping.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(stopping, 1)
        assert client.process.returncode == -9
        assert client.process.killed == 1

    asyncio.run(exercise())


def test_start_tracks_and_stop_joins_both_real_pipe_readers(shutdown_client, monkeypatch):
    async def exercise():
        client = shutdown_client
        client.command = [sys.executable, "-c", "import time; time.sleep(30)"]
        client.env = os.environ.copy()

        async def request(_method, _params):
            return {}

        monkeypatch.setattr(client, "request", request)
        try:
            await client.start()
            assert client._reader_task is not None
            assert client._stderr_task is not None
            await asyncio.wait_for(client.stop(), 5)
            assert client.process.returncode is not None
            assert client._reader_task.done()
            assert client._stderr_task.done()
        finally:
            if client.process is not None and client.process.returncode is None:
                client.process.kill()
                await asyncio.wait_for(client.process.wait(), 5)
            readers = [
                task for task in (client._reader_task, getattr(client, "_stderr_task", None))
                if task is not None
            ]
            for task in readers:
                if not task.done():
                    task.cancel()
            await asyncio.wait_for(asyncio.gather(*readers, return_exceptions=True), 1)

    asyncio.run(exercise())


@pytest.mark.skipif(sys.platform != "linux", reason="Production Linux process-group ownership")
@pytest.mark.parametrize("inherit_pipes", [False, True])
@pytest.mark.parametrize("parent_exits", [False, True])
def test_stop_exits_owned_group_even_after_leader_exit(
    shutdown_client, tmp_path, monkeypatch, inherit_pipes, parent_exits,
):
    monkeypatch.setattr(app, "ACP_STOP_TIMEOUT_SECONDS", 1)
    ready = tmp_path / "owned-child.json"
    child = (
        "import json,os,signal,sys,time;from pathlib import Path;"
        "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
        "p=Path(sys.argv[1]);t=p.with_suffix('.tmp');"
        "t.write_text(json.dumps({'pid':os.getpid(),'group':os.getpgrp()}));t.replace(p);"
        "time.sleep(30)"
    )
    parent = (
        "import subprocess,sys,time;"
        f"subprocess.Popen([sys.executable,'-c',{child!r},{str(ready)!r}]"
        + (");" if inherit_pipes else ",stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);")
        + ("pass" if parent_exits else "time.sleep(30)")
    )

    async def exercise():
        client = shutdown_client
        client.command = [sys.executable, "-c", parent]
        client.env = {}
        child_pid = None
        child_group = None
        stopped = False

        async def request(_method, _params):
            return {}

        monkeypatch.setattr(client, "request", request)
        try:
            await client.start()
            async with asyncio.timeout(5):
                while not ready.exists() or (parent_exits and client.process.returncode is None):
                    await asyncio.sleep(0.01)
            metadata = json.loads(ready.read_text())
            child_pid, child_group = metadata["pid"], metadata["group"]
            assert child_group == client.process.pid == client._process_group_id
            assert child_group != os.getpgrp()
            await asyncio.wait_for(client.stop(), 5)
            stopped = True
            assert client.process.returncode is not None
            assert client._reader_task.done()
            assert client._stderr_task.done()
            assert not client._owned_processes_running()
            await client.stop()
        finally:
            group = client._process_group_id
            if not stopped and group is not None:
                assert group == client.process.pid and group != os.getpgrp()
                try:
                    os.killpg(group, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if not stopped and child_pid is not None:
                try:
                    if os.getpgid(child_pid) == child_group:
                        os.kill(child_pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if client.process is not None:
                if client.process.returncode is None:
                    client.process.kill()
                readers = [task for task in (client._reader_task, client._stderr_task) if task is not None]
                for reader in readers:
                    if not reader.done():
                        reader.cancel()
                await asyncio.wait_for(asyncio.gather(*readers, return_exceptions=True), 5)
                await asyncio.wait_for(client.process.wait(), 5)

    asyncio.run(exercise())


@pytest.mark.skipif(sys.platform != "linux", reason="Production Linux procfs process states")
@pytest.mark.parametrize(
    ("state", "group", "running"),
    [("Z", 123, False), ("X", 123, False), ("S", 123, True), ("T", 123, True), ("R", 456, False)],
)
def test_owned_group_checks_live_members_not_unreaped_zombies(
    shutdown_client, tmp_path, monkeypatch, state, group, running,
):
    process = tmp_path / "789"
    process.mkdir()
    (process / "stat").write_text(f"789 (name with ) parentheses) {state} 1 {group} 0 0", encoding="utf-8")
    scandir = os.scandir
    monkeypatch.setattr(os, "scandir", lambda path: scandir(tmp_path if path == "/proc" else path))
    monkeypatch.setattr(os, "killpg", lambda _group, _signal: None)
    shutdown_client._process_group_id = 123

    assert shutdown_client._owned_processes_running() is running


@pytest.mark.skipif(sys.platform != "linux", reason="Production Linux procfs process states")
def test_unreadable_group_membership_is_a_cleanup_failure(shutdown_client, monkeypatch):
    def unavailable(_path):
        raise PermissionError("PRIVATE synthetic process diagnostic")

    shutdown_client._process_group_id = 123
    monkeypatch.setattr(os, "killpg", lambda _group, _signal: None)
    monkeypatch.setattr(os, "scandir", unavailable)

    async def exercise():
        process = UnresponsiveProcess()
        process.returncode = 0
        process.exited.set()
        shutdown_client.process = process
        with pytest.raises(app.ACPShutdownError, match="process_exit") as error:
            await shutdown_client.stop()
        assert "PRIVATE" not in str(error.value)

    asyncio.run(exercise())


@pytest.mark.parametrize("replacement", [False, True])
def test_failed_finalization_is_bounded_and_retains_only_its_owned_client(
    shutdown_client, tmp_path, monkeypatch, replacement,
):
    monkeypatch.setattr(app, "_capacity_snapshot", lambda: {})

    async def exercise():
        client = shutdown_client
        client.process = UnresponsiveProcess()
        client.state.process = client.process
        credentials = {"synthetic": "cleared"}
        other = object()
        monkeypatch.setattr(app, "session_clients", {client.state.session_id: other if replacement else client})
        await asyncio.wait_for(app._finish_task(
            client.state, client, tmp_path, credentials, False, "completed",
        ), 1)
        assert client.state.status == "failed"
        assert client.state.finished_at is not None
        assert "ACPShutdownError" in client.state.error
        assert app.session_clients[client.state.session_id] is (other if replacement else client)
        assert any(event["kind"] == "failed" for event in client.state.events)
        assert any(
            event["kind"] == "failed" and event["data"].get("cleanup_phase") == "process_exit"
            for event in client.state.events
        )
        assert credentials == {}

    asyncio.run(exercise())


def test_session_stop_failure_does_not_drop_ownership(shutdown_client, monkeypatch):
    async def exercise():
        client = shutdown_client
        client.process = UnresponsiveProcess()
        monkeypatch.setattr(app, "session_clients", {client.state.session_id: client})
        with pytest.raises(RuntimeError, match="process_exit"):
            await asyncio.wait_for(app._stop_session_client(client.state.session_id), 1)
        assert app.session_clients[client.state.session_id] is client

    asyncio.run(exercise())


@pytest.mark.parametrize("exits_on_kill", [False, True])
def test_cancel_without_worker_shares_owned_client_cleanup(
    shutdown_client, monkeypatch, exits_on_kill,
):
    async def exercise():
        client = shutdown_client
        client.process = UnresponsiveProcess(exits_on_kill)
        client.state.process = client.process
        monkeypatch.setattr(app, "session_clients", {client.state.session_id: client})
        monkeypatch.setattr(app, "tasks", {client.state.invocation_id: client.state})
        request = Request({
            "type": "http", "method": "POST", "headers": [], "path": "/invocations",
            "state": {"invocation_id": client.state.invocation_id},
        })
        response = await asyncio.wait_for(app.cancel_invocation(request), 1)
        assert response.status_code == (200 if exits_on_kill else 503)
        assert client.state.status == ("cancelled" if exits_on_kill else "failed")
        assert client.process.killed == 1
        assert app.session_clients == ({} if exits_on_kill else {client.state.session_id: client})

    asyncio.run(exercise())


def test_successful_finalization_waits_for_owned_reader_and_process(
    shutdown_client, tmp_path, monkeypatch,
):
    monkeypatch.setattr(app, "_capacity_snapshot", lambda: {})
    monkeypatch.setattr(app, "ACP_STOP_TIMEOUT_SECONDS", 5)

    async def exercise():
        client = shutdown_client
        client.process = await asyncio.create_subprocess_exec(sys.executable, "-c", "pass")
        client.state.process = client.process
        release = asyncio.Event()
        client._reader_task = asyncio.create_task(release.wait())
        monkeypatch.setattr(app, "session_clients", {client.state.session_id: client})
        finishing = asyncio.create_task(app._finish_task(
            client.state, client, tmp_path, {}, False, "completed",
        ))
        try:
            await asyncio.wait_for(client.process.wait(), 5)
            assert client.state.status == "running"
            assert client.state.finished_at is None
            assert app.session_clients[client.state.session_id] is client
            release.set()
            await asyncio.wait_for(finishing, 5)
            assert client.state.status == "completed"
            assert client._reader_task.done()
            assert app.session_clients == {}
        finally:
            release.set()
            if client.process.returncode is None:
                client.process.kill()
                await asyncio.wait_for(client.process.wait(), 5)
            await asyncio.wait_for(asyncio.gather(finishing, return_exceptions=True), 5)

    asyncio.run(exercise())


def test_stop_fails_pending_protocol_requests(shutdown_client):
    async def exercise():
        client = shutdown_client
        pending = asyncio.get_running_loop().create_future()
        client._pending[1] = pending
        await client.stop()
        with pytest.raises(RuntimeError, match="ACP client stopped"):
            await pending
        assert client._pending == {}

    asyncio.run(exercise())


@pytest.mark.skipif(os.name == "nt", reason="Windows terminate is already a forceful process stop")
def test_real_owned_process_ignoring_terminate_is_killed_and_reaped(shutdown_client):
    async def exercise():
        client = shutdown_client
        client.process = await asyncio.create_subprocess_exec(
            sys.executable, "-c",
            "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); "
            "print('ready', flush=True); time.sleep(30)",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        try:
            assert await asyncio.wait_for(client.process.stdout.readline(), 5) == b"ready\n"
            client._reader_task = asyncio.create_task(client.process.stdout.read())
            client._stderr_task = asyncio.create_task(client.process.stderr.read())
            await asyncio.wait_for(client.stop(), 5)
            assert client.process.returncode == -9
            assert client._reader_task.done()
            assert client._stderr_task.done()
        finally:
            if client.process.returncode is None:
                client.process.kill()
            await asyncio.wait_for(client.process.wait(), 5)

    asyncio.run(exercise())
