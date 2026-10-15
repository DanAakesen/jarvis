import asyncio
import json
import sys

import pytest
from starlette.requests import Request

import app


@pytest.fixture
def finalization_fixture(tmp_path, monkeypatch, git_repository):
    source, _env, git = git_repository
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "tasks", {})
    monkeypatch.setattr(app, "session_clients", {})
    monkeypatch.setattr(app, "session_locks", {})
    monkeypatch.setenv("JARVIS_BACKEND_URL", "https://backend.example")
    monkeypatch.setenv("JARVIS_API_SCOPE", "api://00000000-0000-4000-8000-000000000000/.default")
    saved = {}
    # Model the metadata boundary, not POSIX file permissions, in these ordering tests.
    monkeypatch.setattr(app, "_write_json", lambda path, value: saved.update({path: json.loads(json.dumps(value))}))

    async def prepare(state, root, env):
        project = root / "project"
        git(root, "clone", "--", str(source), str(project))
        git(project, "checkout", "-b", state.branch)
        return project, git(project, "rev-parse", "HEAD")

    async def credentials(agent):
        return {"github_token": "fixture-token", "copilot_token": "fixture-seat-token"}

    monkeypatch.setattr(app, "_prepare_workspace", prepare)
    monkeypatch.setattr(app, "_credentials_for", credentials)

    def create(stage, fail=False):
        entered = asyncio.Event()
        release = asyncio.Event()
        processes = []
        delivered = []
        closed = []
        state = app.TaskState(
            "finalization", "session", "copilot", "synthetic work", task_id="42",
            repository="owner/project", default_branch="main", branch="jarvis/task-42",
        )
        app.tasks[state.invocation_id] = state

        async def gate(current):
            if stage == current:
                entered.set()
                await release.wait()
                if fail:
                    raise RuntimeError("PRIVATE provider diagnostic")

        class Client:
            def __init__(self, command, cwd, task_state, env, persisted_session_id=None):
                self.cwd = cwd
                self.state = task_state

            async def start(self):
                self.state.process = await asyncio.create_subprocess_exec(
                    sys.executable, "-c", "import time; time.sleep(30)",
                )
                processes.append(self.state.process)

            async def run(self, prompt):
                (self.cwd / "receipt.txt").write_text("Synthetic local commit\n", encoding="utf-8")
                git(self.cwd, "add", "receipt.txt")
                git(self.cwd, "commit", "-m", "Synthetic receipt")
                return {"response": {"stopReason": "end_turn"}}

            async def stop(self):
                await gate("provider")
                if self.state.process.returncode is None:
                    self.state.process.terminate()
                    await asyncio.wait_for(self.state.process.wait(), 5)

        class Publisher:
            def __init__(self, *_args):
                pass

            async def publish(self, task_id, invocation_id, event_index, event):
                delivered.append(event["kind"])
                if event["kind"] == "capacity":
                    await gate("delivery")

            async def close(self):
                await gate("publisher")
                closed.append(True)

        monkeypatch.setattr(app, "ACPClient", Client)
        monkeypatch.setattr(app, "RunnerEventPublisher", Publisher)
        state.worker = asyncio.create_task(app._run_task(state))
        return state, entered, release, processes, delivered, closed, saved

    return create


async def stop_fixture(state, release, processes):
    release.set()
    try:
        await asyncio.wait_for(asyncio.gather(state.worker, return_exceptions=True), 5)
    finally:
        for process in processes:
            if process.returncode is None:
                process.kill()
                await asyncio.wait_for(process.wait(), 5)


@pytest.mark.parametrize("stage", ["provider", "delivery", "publisher"])
@pytest.mark.parametrize("fail", [False, True])
def test_completion_waits_for_cleanup_and_final_event_delivery(finalization_fixture, stage, fail):
    async def exercise():
        state, entered, release, processes, delivered, closed, saved = finalization_fixture(stage, fail)
        try:
            await asyncio.wait_for(entered.wait(), 5)
            request = Request({
                "type": "http", "method": "GET", "headers": [], "path": "/invocations",
                "state": {"invocation_id": state.invocation_id},
            })
            response = json.loads((await app.get_invocation(request)).body)
            assert response["status"] == "running"
            assert response["finished_at"] is None
            metadata = saved[app._task_state_path(state.session_id, state.invocation_id)]
            assert metadata["status"] == "running"
            assert metadata["finished_at"] is None
            assert not state.worker.done()
            release.set()
            await asyncio.wait_for(state.worker, 5)
            assert state.status == ("failed" if fail else "completed")
            assert state.finished_at is not None
            assert saved[app._task_state_path(state.session_id, state.invocation_id)]["status"] == state.status
            assert "PRIVATE" not in json.dumps(state.events)
            assert all(process.returncode is not None for process in processes)
            if fail and stage == "provider":
                assert set(app.session_clients) == {state.session_id}
                assert app.session_clients[state.session_id].state is state
            else:
                assert app.session_clients == {}
            assert not app.session_locks[state.session_id].locked()
            assert "capacity" in delivered
            assert closed == ([] if fail and stage == "publisher" else [True])
        finally:
            await stop_fixture(state, release, processes)

    asyncio.run(exercise())


@pytest.mark.parametrize("stage", ["provider", "delivery", "publisher"])
@pytest.mark.parametrize("fail", [False, True])
def test_cancel_during_finalization_waits_for_owned_cleanup(finalization_fixture, stage, fail):
    async def exercise():
        state, entered, release, processes, delivered, closed, saved = finalization_fixture(stage, fail)
        cancelling = None
        try:
            await asyncio.wait_for(entered.wait(), 5)
            request = Request({
                "type": "http", "method": "POST", "headers": [], "path": "/invocations",
                "state": {"invocation_id": state.invocation_id},
            })
            cancelling = asyncio.create_task(app.cancel_invocation(request))
            await asyncio.sleep(0)
            assert not cancelling.done()
            assert state.status == "cancelling"
            release.set()
            response = await asyncio.wait_for(cancelling, 5)
            assert response.status_code == (503 if fail else 200)
            assert json.loads(response.body) == (
                {"error": "Runner cancellation cleanup failed"} if fail else
                {"invocation_id": state.invocation_id, "status": "cancelled"}
            )
            assert state.worker.done()
            assert state.finished_at is not None
            assert saved[app._task_state_path(state.session_id, state.invocation_id)]["status"] == (
                "failed" if fail else "cancelled"
            )
            assert all(process.returncode is not None for process in processes)
            assert "capacity" in delivered
            assert closed == ([] if fail and stage == "publisher" else [True])
            if fail and stage == "provider":
                assert set(app.session_clients) == {state.session_id}
                assert app.session_clients[state.session_id].state is state
            else:
                assert app.session_clients == {}
            assert not app.session_locks[state.session_id].locked()
        finally:
            await stop_fixture(state, release, processes)
            if cancelling is not None:
                await asyncio.wait_for(asyncio.gather(cancelling, return_exceptions=True), 5)

    asyncio.run(exercise())


@pytest.mark.parametrize("stage", ["provider", "delivery", "publisher"])
def test_pause_during_finalization_keeps_the_paused_outcome(finalization_fixture, stage):
    async def exercise():
        state, entered, release, processes, _delivered, _closed, saved = finalization_fixture(stage)
        pausing = None
        try:
            await asyncio.wait_for(entered.wait(), 5)
            pausing = asyncio.create_task(app._stop_running_turn(state.session_id, "pause"))
            await asyncio.sleep(0)
            assert state.stop_requested == "pause"
            assert state.status == "running"
            release.set()
            await asyncio.wait_for(pausing, 5)
            await asyncio.wait_for(state.worker, 5)
            assert state.status == "paused"
            assert saved[app._task_state_path(state.session_id, state.invocation_id)]["status"] == "paused"
            assert all(process.returncode is not None for process in processes)
        finally:
            await stop_fixture(state, release, processes)
            if pausing is not None:
                await asyncio.wait_for(asyncio.gather(pausing, return_exceptions=True), 5)

    asyncio.run(exercise())


def test_event_flush_drains_events_appended_during_delivery(monkeypatch):
    monkeypatch.setattr(app, "_persist_task", lambda _state: None)

    async def exercise():
        first_entered = asyncio.Event()
        second_entered = asyncio.Event()
        release_first = asyncio.Event()
        release_second = asyncio.Event()
        delivered = []
        closed = []

        class Publisher:
            async def publish(self, _task_id, _invocation_id, _event_index, event):
                if event["kind"] == "first":
                    first_entered.set()
                    await release_first.wait()
                else:
                    second_entered.set()
                    await release_second.wait()
                delivered.append(event["kind"])

            async def close(self):
                closed.append(True)

        state = app.TaskState("tail", "session", "copilot", "work", task_id="42")
        state.event_publisher = Publisher()
        state.event("first")
        flushing = asyncio.create_task(app._flush_event_delivery(state))
        try:
            await asyncio.wait_for(first_entered.wait(), 5)
            state.event("second")
            release_first.set()
            await asyncio.wait_for(second_entered.wait(), 5)
            await asyncio.sleep(0)
            assert not flushing.done()
            assert closed == []
            release_second.set()
            await asyncio.wait_for(flushing, 5)
            assert delivered == ["first", "second"]
            assert closed == [True]
        finally:
            release_first.set()
            release_second.set()
            await asyncio.wait_for(asyncio.gather(flushing, state.event_delivery, return_exceptions=True), 5)

    asyncio.run(exercise())


@pytest.mark.parametrize("cancel", [False, True])
def test_failed_terminal_checkpoint_never_reports_success(finalization_fixture, monkeypatch, cancel):
    async def exercise():
        state, entered, release, processes, _delivered, _closed, saved = finalization_fixture("provider")
        write_json = app._write_json

        def fail_terminal_checkpoint(path, value):
            if value.get("finished_at") is not None and value.get("status") in {"completed", "cancelled"}:
                raise OSError("PRIVATE filesystem diagnostic")
            write_json(path, value)

        monkeypatch.setattr(app, "_write_json", fail_terminal_checkpoint)
        cancelling = None
        try:
            await asyncio.wait_for(entered.wait(), 5)
            if cancel:
                request = Request({
                    "type": "http", "method": "POST", "headers": [], "path": "/invocations",
                    "state": {"invocation_id": state.invocation_id},
                })
                cancelling = asyncio.create_task(app.cancel_invocation(request))
                await asyncio.sleep(0)
            release.set()
            if cancelling is not None:
                response = await asyncio.wait_for(cancelling, 5)
                assert response.status_code == 503
            else:
                result = await asyncio.wait_for(asyncio.gather(state.worker, return_exceptions=True), 5)
                assert isinstance(result[0], OSError)
            assert state.status == "failed"
            assert state.error == "Runner cleanup failed: OSError"
            assert saved[app._task_state_path(state.session_id, state.invocation_id)]["status"] == "failed"
            assert all(process.returncode is not None for process in processes)
            assert not app.session_locks[state.session_id].locked()
        finally:
            await stop_fixture(state, release, processes)
            if cancelling is not None:
                await asyncio.wait_for(asyncio.gather(cancelling, return_exceptions=True), 5)

    asyncio.run(exercise())


@pytest.mark.parametrize("stage", ["provider", "delivery", "publisher"])
@pytest.mark.parametrize("fail", [False, True])
@pytest.mark.parametrize("repeated_cancels", [0, 2])
def test_cancel_request_disconnect_keeps_owned_cleanup(
    finalization_fixture, stage, fail, repeated_cancels,
):
    async def exercise():
        state, entered, release, processes, _delivered, _closed, saved = finalization_fixture(stage, fail)
        cancelling = retry = None
        try:
            await asyncio.wait_for(entered.wait(), 5)
            request = Request({
                "type": "http", "method": "POST", "headers": [], "path": "/invocations",
                "state": {"invocation_id": state.invocation_id},
            })
            cancelling = asyncio.create_task(app.cancel_invocation(request))
            for _ in range(8):
                await asyncio.sleep(0)
            assert state.worker.cancelling() == 1
            cancelling.cancel()
            for _ in range(8):
                await asyncio.sleep(0)
            assert cancelling.cancelled()
            assert state.worker.cancelling() == 1
            for _ in range(repeated_cancels):
                state.worker.cancel()
                for _ in range(8):
                    await asyncio.sleep(0)
                assert not state.worker.done()
                assert app.session_locks[state.session_id].locked()
            assert not state.worker.done()
            assert app.session_locks[state.session_id].locked()
            assert state.status == "cancelling"
            assert state.finished_at is None
            if stage == "provider":
                assert all(process.returncode is None for process in processes)
            retry = asyncio.create_task(app.cancel_invocation(request))
            await asyncio.sleep(0)
            assert not retry.done()
            assert state.worker.cancelling() == 1 + repeated_cancels
            release.set()
            response = await asyncio.wait_for(retry, 5)
            assert response.status_code == (503 if fail else 200)
            assert json.loads(response.body) == (
                {"error": "Runner cancellation cleanup failed"} if fail else
                {"invocation_id": state.invocation_id, "status": "cancelled"}
            )
            assert state.worker.done()
            assert state.status == ("failed" if fail else "cancelled")
            assert saved[app._task_state_path(state.session_id, state.invocation_id)]["status"] == state.status
            assert all(process.returncode is not None for process in processes)
            if fail and stage == "provider":
                assert set(app.session_clients) == {state.session_id}
                assert app.session_clients[state.session_id].state is state
            else:
                assert app.session_clients == {}
            assert not app.session_locks[state.session_id].locked()
        finally:
            await stop_fixture(state, release, processes)
            await asyncio.wait_for(asyncio.gather(
                *(task for task in (cancelling, retry) if task is not None), return_exceptions=True,
            ), 5)

    asyncio.run(exercise())


@pytest.mark.parametrize("reason", ["pause", "steer"])
@pytest.mark.parametrize("fail", [False, True])
def test_late_stop_timeout_cannot_append_to_closing_publisher(
    finalization_fixture, monkeypatch, reason, fail,
):
    async def exercise():
        state, entered, release, processes, _delivered, _closed, saved = finalization_fixture("publisher", fail)
        original_publisher = app.RunnerEventPublisher
        late_attempts = []

        class ClosingPublisher(original_publisher):
            closing = False

            async def close(self):
                self.closing = True
                await super().close()

            async def publish(self, *args):
                if self.closing:
                    late_attempts.append(args[-1]["kind"])
                    raise RuntimeError("Synthetic publisher is closing")
                await super().publish(*args)

        monkeypatch.setattr(app, "RunnerEventPublisher", ClosingPublisher)
        monkeypatch.setattr(app, "STOP_WAIT_SECONDS", 0)
        stopping = None
        try:
            await asyncio.wait_for(entered.wait(), 5)
            stopping = asyncio.create_task(app._stop_running_turn(state.session_id, reason))
            for _ in range(8):
                await asyncio.sleep(0)
            assert state.stop_requested == reason
            assert late_attempts == []
            assert not state.worker.done()
            assert app.session_locks[state.session_id].locked()
            release.set()
            await asyncio.wait_for(state.worker, 5)
            await asyncio.wait_for(stopping, 5)
            assert state.status == ("failed" if fail else app.STOPPED_STATUS[reason])
            assert saved[app._task_state_path(state.session_id, state.invocation_id)]["status"] == state.status
            assert not state.event_delivery_failed
            assert state.event_delivery.done()
            assert all(process.returncode is not None for process in processes)
            assert not app.session_locks[state.session_id].locked()
        finally:
            await stop_fixture(state, release, processes)
            if stopping is not None:
                await asyncio.wait_for(asyncio.gather(stopping, return_exceptions=True), 5)
            if state.event_delivery is not None:
                await asyncio.wait_for(asyncio.gather(state.event_delivery, return_exceptions=True), 5)

    asyncio.run(exercise())


@pytest.mark.parametrize("reason", ["pause", "steer"])
def test_stop_deadline_still_terminates_owned_finalizing_provider(
    finalization_fixture, monkeypatch, reason,
):
    monkeypatch.setattr(app, "STOP_WAIT_SECONDS", 0)

    async def exercise():
        state, entered, release, processes, _delivered, _closed, _saved = finalization_fixture("provider")
        stopping = None
        try:
            await asyncio.wait_for(entered.wait(), 5)
            stopping = asyncio.create_task(app._stop_running_turn(state.session_id, reason))
            await asyncio.wait_for(processes[0].wait(), 5)
            assert state.stop_requested == reason
            assert state.status == "running"
            assert not state.worker.done()
            assert app.session_locks[state.session_id].locked()
            release.set()
            await asyncio.wait_for(state.worker, 5)
            await asyncio.wait_for(stopping, 5)
            assert state.status == app.STOPPED_STATUS[reason]
        finally:
            await stop_fixture(state, release, processes)
            if stopping is not None:
                await asyncio.wait_for(asyncio.gather(stopping, return_exceptions=True), 5)

    asyncio.run(exercise())


def test_acp_cancel_ack_after_finalization_does_not_append_event(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "_persist_task", lambda _state: None)

    async def exercise():
        drain_entered = asyncio.Event()
        release_drain = asyncio.Event()
        close_entered = asyncio.Event()
        release_close = asyncio.Event()
        late_attempts = []
        state = app.TaskState("cancel-ack", "session", "copilot", "work", task_id="42")
        client = app.ACPClient([], tmp_path, state, {}, persisted_session_id="synthetic-acp")
        client.process = await asyncio.create_subprocess_exec(
            sys.executable, "-c", "import time; time.sleep(30)", stdin=asyncio.subprocess.PIPE,
        )
        assert client.process.stdin is not None

        async def drain():
            drain_entered.set()
            await release_drain.wait()

        class ClosingPublisher:
            async def publish(self, _task_id, _invocation_id, _event_index, event):
                late_attempts.append(event["kind"])
                raise RuntimeError("Synthetic publisher is closing")

            async def close(self):
                close_entered.set()
                await release_close.wait()

        monkeypatch.setattr(client.process.stdin, "drain", drain)
        state.event_publisher = ClosingPublisher()
        cancelling = asyncio.create_task(client.cancel_turn())
        flushing = None
        try:
            await asyncio.wait_for(drain_entered.wait(), 5)
            state.finalizing = True
            flushing = asyncio.create_task(app._flush_event_delivery(state))
            await asyncio.wait_for(close_entered.wait(), 5)
            release_drain.set()
            assert await asyncio.wait_for(cancelling, 5)
            assert state.events == []
            assert late_attempts == []
            release_close.set()
            await asyncio.wait_for(flushing, 5)
            assert state.event_delivery is None
        finally:
            release_drain.set()
            release_close.set()
            await asyncio.wait_for(asyncio.gather(
                *(task for task in (cancelling, flushing, state.event_delivery) if task is not None),
                return_exceptions=True,
            ), 5)
            await asyncio.wait_for(client.stop(), 5)

    asyncio.run(exercise())


@pytest.mark.parametrize("reason", ["pause", "steer"])
def test_active_stop_deadline_keeps_forced_timeout_event(monkeypatch, reason):
    monkeypatch.setattr(app, "_persist_task", lambda _state: None)
    monkeypatch.setattr(app, "STOP_WAIT_SECONDS", 0)
    monkeypatch.setattr(app, "session_clients", {})
    state = app.TaskState("forced-stop", "session", "copilot", "work", status="running")
    monkeypatch.setattr(app, "tasks", {state.invocation_id: state})

    async def exercise():
        state.process = await asyncio.create_subprocess_exec(
            sys.executable, "-c", "import time; time.sleep(30)",
        )

        async def worker():
            await state.process.wait()
            state.status = app.STOPPED_STATUS[state.stop_requested]

        state.worker = asyncio.create_task(worker())
        try:
            assert await asyncio.wait_for(app._stop_running_turn(state.session_id, reason), 5) is state
            await asyncio.wait_for(state.worker, 5)
            assert state.status == app.STOPPED_STATUS[reason]
            assert [event["kind"] for event in state.events] == [f"{reason}_requested", "stop_timeout_forced"]
            assert state.process.returncode is not None
        finally:
            if state.process.returncode is None:
                state.process.kill()
            await asyncio.wait_for(asyncio.gather(state.worker, return_exceptions=True), 5)

    asyncio.run(exercise())
