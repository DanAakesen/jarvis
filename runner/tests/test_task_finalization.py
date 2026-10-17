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
                self.process = self.state.process
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


@pytest.fixture
def lifecycle_fixture(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "tasks", {})
    monkeypatch.setattr(app, "session_clients", {})
    monkeypatch.setattr(app, "_capacity_snapshot", lambda: {})
    monkeypatch.setattr(app, "ACP_STOP_TIMEOUT_SECONDS", 0.02)
    monkeypatch.setattr(app, "ACP_STOP_CANCEL_TIMEOUT_SECONDS", 0.02)
    saved = {}
    monkeypatch.setattr(
        app, "_write_json", lambda path, value: saved.update({path: json.loads(json.dumps(value))}),
    )

    class OwnedProcess:
        def __init__(self):
            self.returncode = None
            self.exited = asyncio.Event()
            self.signals = 0
            self.exits_on_signal = True

        def terminate(self):
            self.signals += 1
            if self.exits_on_signal:
                self.returncode = -15
                self.exited.set()

        def kill(self):
            self.terminate()

        async def wait(self):
            await self.exited.wait()
            return self.returncode

    def create(agent="copilot", error=None):
        state = app.TaskState(
            "lifecycle", "session", agent, "PRIVATE work", task_id="42", status="running", error=error,
        )
        client = app.ACPClient([], tmp_path, state, {})
        client.process = state.process = OwnedProcess()
        for name in ("_reader_task", "_stderr_task"):
            reader = asyncio.get_running_loop().create_future()
            reader.set_result(None)
            setattr(client, name, reader)
        app.tasks[state.invocation_id] = state
        app.session_clients[state.session_id] = client
        return state, client, saved

    return create


@pytest.mark.parametrize("failures", [
    ("credential_persist",), ("event_delivery",), ("publisher_close",),
    ("credential_persist", "event_delivery", "publisher_close"),
])
def test_verified_work_and_stop_survive_later_cleanup_failure_and_reload(
    lifecycle_fixture, tmp_path, monkeypatch, failures,
):
    async def exercise():
        state, client, saved = lifecycle_fixture("codex")
        assert state.work_completed is False and state.provider_stopped is False
        assert state.work_commit_sha is None
        auth = tmp_path / ".codex" / "auth.json"
        auth.parent.mkdir()
        auth.write_text("PRIVATE credential", encoding="utf-8")

        async def store(_auth):
            assert state.work_completed is True and state.provider_stopped is True
            if "credential_persist" in failures:
                raise RuntimeError("PRIVATE credential error")
            return False

        class Publisher:
            async def publish(self, _task_id, _invocation_id, _index, event):
                if event["kind"] == "capacity" and "event_delivery" in failures:
                    assert state.provider_stopped is True
                    raise RuntimeError("PRIVATE delivery error")

            async def close(self):
                assert state.provider_stopped is True
                if "publisher_close" in failures:
                    raise RuntimeError("PRIVATE publisher error")

        monkeypatch.setattr(app, "_store_codex_login_if_newer", store)
        state.event_publisher = Publisher()
        credentials = {"token": "PRIVATE"}
        await asyncio.wait_for(app._finish_task(
            state, client, tmp_path, credentials, True, "completed", delivery_work_completed=True,
            work_commit_sha="b" * 40,
        ), 2)
        assert state.status == "failed" and state.finished_at is not None
        assert state.work_completed is True and state.provider_stopped is True
        assert client.process.returncode is not None
        assert client._reader_task.done() and client._stderr_task.done()
        assert app.session_clients == {}
        assert [entry["phase"] for entry in state.cleanup_failures] == list(failures)
        assert state.error == (
            "Runner credential persistence failed: RuntimeError"
            if failures[0] == "credential_persist" else "Runner event delivery failed"
        )
        assert credentials == {} and not auth.exists()
        path = app._task_state_path(state.session_id, state.invocation_id)
        metadata = saved[path]
        assert metadata["status"] == "failed"
        assert metadata["work_completed"] is True and metadata["provider_stopped"] is True
        assert metadata["work_commit_sha"] == "b" * 40
        assert "PRIVATE" not in json.dumps(metadata)
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps(metadata), encoding="utf-8")
        monkeypatch.setattr(app, "tasks", {})
        response = json.loads((await app.get_invocation(Request({
            "type": "http", "method": "GET", "headers": [], "path": "/invocations",
            "state": {"invocation_id": state.invocation_id},
        }))).body)
        assert response["status"] == "failed"
        assert response["work_completed"] is True and response["provider_stopped"] is True
        assert response["work_commit_sha"] == "b" * 40
        assert response["error"] == state.error
        assert response["cleanup_failures"] == state.cleanup_failures

    asyncio.run(exercise())


@pytest.mark.parametrize(("outcome", "error", "cancel", "stop", "mode", "expected"), [
    ("completed", None, False, None, "task", True),
    ("failed", "Runner task failed: ValueError", False, None, "task", False),
    ("completed", "Runner event delivery failed", False, None, "task", False),
    ("cancelled", None, True, None, "task", False),
    ("completed", None, True, None, "task", False),
    ("paused", None, False, "pause", "task", False),
    ("completed", None, False, "steer", "task", False),
    ("needs_attention", "Which branch?", False, None, "task", False),
    ("completed", None, False, None, "codex-tool", False),
])
def test_work_proof_requires_successful_task_at_finalization_entry(
    lifecycle_fixture, tmp_path, outcome, error, cancel, stop, mode, expected,
):
    async def exercise():
        state, client, saved = lifecycle_fixture(error=error)
        state.mode = mode
        state.cancel_requested = cancel
        state.stop_requested = stop
        state.result = {"response": {"stopReason": "end_turn"}, "text": "Synthetic PR result text"}
        await app._finish_task(
            state, client, tmp_path, {}, False, outcome, delivery_work_completed=True, work_commit_sha="b" * 40,
        )
        assert state.work_completed is expected
        assert state.work_commit_sha == ("b" * 40 if expected else None)
        assert state.provider_stopped is True
        assert saved[app._task_state_path(state.session_id, state.invocation_id)]["work_completed"] is expected
        if outcome == "failed":
            assert state.status == "failed"
            assert state.error == error
        if cancel:
            assert state.status == "cancelled"

    asyncio.run(exercise())


@pytest.mark.parametrize("phase", ["process_exit", "reader_shutdown", "reader_failed"])
def test_failed_verified_stop_cannot_attest_provider_stopped(lifecycle_fixture, tmp_path, phase):
    async def exercise():
        state, client, saved = lifecycle_fixture()
        pending = None
        if phase == "process_exit":
            client.process.exits_on_signal = False
        else:
            pending = asyncio.get_running_loop().create_future()
            client._reader_task = pending
            if phase == "reader_failed":
                pending.set_exception(RuntimeError("PRIVATE reader error"))
        await asyncio.wait_for(app._finish_task(
            state, client, tmp_path, {}, False, "completed", delivery_work_completed=True,
            work_commit_sha="b" * 40,
        ), 1)
        assert state.status == "failed"
        assert state.work_completed is True and state.provider_stopped is False
        assert state.error == f"Runner cleanup failed: ACPShutdownError: {phase}"
        assert state.cleanup_failures[0]["phase"] == phase
        assert app.session_clients[state.session_id] is client
        metadata = saved[app._task_state_path(state.session_id, state.invocation_id)]
        assert metadata["provider_stopped"] is False and metadata["work_completed"] is True
        assert "PRIVATE" not in json.dumps(metadata)

    asyncio.run(exercise())


def test_timed_out_cancellation_resistant_stop_never_gains_late_proof(
    lifecycle_fixture, tmp_path, monkeypatch,
):
    monkeypatch.setattr(app, "FINALIZATION_TIMEOUT_SECONDS", 0.02)
    monkeypatch.setattr(app, "FINALIZATION_CANCEL_TIMEOUT_SECONDS", 0.02)

    async def exercise():
        state, client, saved = lifecycle_fixture()
        monkeypatch.setattr(app, "ACP_STOP_TIMEOUT_SECONDS", 5)
        release = asyncio.Event()
        client._reader_task = asyncio.create_task(release.wait())
        try:
            await asyncio.wait_for(app._finish_task(
                state, client, tmp_path, {}, False, "completed", delivery_work_completed=True,
                work_commit_sha="b" * 40,
            ), 1)
            assert client.process.returncode is not None
            assert state.status == "failed"
            assert state.work_completed is True and state.provider_stopped is False
            assert state.error == "Runner finalization timed out: provider_shutdown"
            assert any(not task.done() for task in state.finalization_tasks)
            next_state = app.TaskState("next", state.session_id, "copilot", "work")
            assert app._has_pending_finalization(next_state)
        finally:
            release.set()
            await asyncio.wait_for(asyncio.gather(*state.finalization_tasks, return_exceptions=True), 1)
        assert state.provider_stopped is False
        assert app.session_clients[state.session_id] is client
        assert not app._has_pending_finalization(next_state)
        assert saved[app._task_state_path(state.session_id, state.invocation_id)]["provider_stopped"] is False

    asyncio.run(exercise())


def test_exhausted_deadline_cannot_start_stop_or_attest_provider_stopped(
    lifecycle_fixture, tmp_path, monkeypatch,
):
    await_finalization = app._await_finalization

    async def expired(state, awaitable, phase, deadline, timeout):
        return await await_finalization(
            state, awaitable, phase, asyncio.get_running_loop().time() - 1, timeout,
        )

    monkeypatch.setattr(app, "_await_finalization", expired)

    async def exercise():
        state, client, _saved = lifecycle_fixture()
        await app._finish_task(
            state, client, tmp_path, {}, False, "completed", delivery_work_completed=True, work_commit_sha="b" * 40,
        )
        assert state.status == "failed"
        assert state.work_completed is True and state.provider_stopped is False
        assert client._stop_task is None
        assert client.process.signals == 1
        assert state.error == "Runner finalization timed out: provider_shutdown"
        assert app.session_clients[state.session_id] is client

    asyncio.run(exercise())


@pytest.mark.parametrize("ownership", ["no-client", "no-process", "different-state"])
def test_missing_owned_provider_is_not_stopped_proof(lifecycle_fixture, tmp_path, ownership):
    async def exercise():
        state, client, _saved = lifecycle_fixture()
        if ownership == "no-client":
            state.process = None
            client = None
            app.session_clients.clear()
        elif ownership == "no-process":
            client.process = state.process = None
        else:
            client.state = app.TaskState("other", state.session_id, "copilot", "other work")
        await app._finish_task(
            state, client, tmp_path, {}, False, "completed", delivery_work_completed=True, work_commit_sha="b" * 40,
        )
        assert state.work_completed is True and state.provider_stopped is False

    asyncio.run(exercise())


def test_exited_leader_does_not_attest_stop_before_owned_readers_finish(
    lifecycle_fixture, tmp_path, monkeypatch,
):
    async def exercise():
        state, client, _saved = lifecycle_fixture()
        monkeypatch.setattr(app, "ACP_STOP_TIMEOUT_SECONDS", 5)
        client.process = state.process = await asyncio.create_subprocess_exec(sys.executable, "-c", "pass")
        await asyncio.wait_for(client.process.wait(), 5)
        release = asyncio.Event()
        client._reader_task = asyncio.create_task(release.wait())
        finishing = asyncio.create_task(app._finish_task(
            state, client, tmp_path, {}, False, "completed", delivery_work_completed=True,
            work_commit_sha="b" * 40,
        ))
        try:
            await asyncio.sleep(0)
            assert state.status == "running"
            assert state.work_completed is True and state.provider_stopped is False
            assert not finishing.done()
            release.set()
            await asyncio.wait_for(finishing, 5)
            assert state.status == "completed"
            assert state.work_completed is True and state.provider_stopped is True
        finally:
            release.set()
            await asyncio.wait_for(asyncio.gather(finishing, return_exceptions=True), 5)

    asyncio.run(exercise())


@pytest.mark.parametrize("flag", ["work_completed", "provider_stopped"])
@pytest.mark.parametrize("value", [True, False, None, "true", "false", 1, 0, [], {}, ["true"]])
def test_persisted_lifecycle_flags_accept_only_literal_booleans(tmp_path, monkeypatch, flag, value):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "tasks", {})
    state = app.TaskState("strict-flags", "session", "copilot", "work", status="failed", finished_at=2)
    saved = {
        "invocation_id": state.invocation_id, "session_id": state.session_id, "agent": state.agent,
        "status": state.status, "started_at": 1, "finished_at": 2, flag: value,
    }
    path = app._task_state_path(state.session_id, state.invocation_id)
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(saved), encoding="utf-8")

    async def exercise():
        response = json.loads((await app.get_invocation(Request({
            "type": "http", "method": "GET", "headers": [], "path": "/invocations",
            "state": {"invocation_id": state.invocation_id},
        }))).body)
        assert response[flag] is (value is True)
        other = "provider_stopped" if flag == "work_completed" else "work_completed"
        assert response[other] is False
        fresh = app.TaskState("fresh", state.session_id, state.agent, "next work")
        assert fresh.work_completed is False and fresh.provider_stopped is False
        assert fresh.work_commit_sha is None and response["work_commit_sha"] is None

    asyncio.run(exercise())


@pytest.mark.parametrize("status", ["failed", "completed", "cancelled", "idle_expired"])
def test_legacy_status_and_result_text_do_not_supply_lifecycle_proof(tmp_path, monkeypatch, status):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    saved = {
        "invocation_id": "legacy", "session_id": "session", "agent": "copilot",
        "status": status, "started_at": 1, "finished_at": 2,
        "result": {
            "pr": "Synthetic PR result text", "provider_stopped": True, "work_completed": True,
            "work_commit_sha": "b" * 40,
        },
    }
    path = tmp_path / "session" / "task-state.json"
    path.parent.mkdir()
    path.write_text(json.dumps(saved), encoding="utf-8")
    loaded = app._load_task("legacy")
    assert loaded.work_completed is False and loaded.provider_stopped is False
    assert loaded.work_commit_sha is None
    assert loaded.result is None


def test_lifecycle_flags_serialize_without_truthiness(lifecycle_fixture):
    async def exercise():
        state, _client, saved = lifecycle_fixture()
        state.work_completed = "true"
        state.provider_stopped = 1
        app._persist_task(state)
        metadata = saved[app._task_state_path(state.session_id, state.invocation_id)]
        assert metadata["work_completed"] is False and metadata["provider_stopped"] is False
        response = json.loads((await app.get_invocation(Request({
            "type": "http", "method": "GET", "headers": [], "path": "/invocations",
            "state": {"invocation_id": state.invocation_id},
        }))).body)
        assert response["work_completed"] is False and response["provider_stopped"] is False

    asyncio.run(exercise())


@pytest.mark.parametrize("proof", ["omitted", False, None, "true", 1])
def test_completed_turn_alone_is_not_successful_delivery_work(lifecycle_fixture, tmp_path, proof):
    async def exercise():
        state, client, _saved = lifecycle_fixture()
        kwargs = {} if proof == "omitted" else {"delivery_work_completed": proof}
        await app._finish_task(state, client, tmp_path, {}, False, "completed", work_commit_sha="b" * 40, **kwargs)
        assert state.status == "completed"
        assert state.work_completed is False and state.provider_stopped is True
        assert state.work_commit_sha is None

    asyncio.run(exercise())


async def _exercise_actual_delivery_turn(
    lifecycle_fixture, tmp_path, monkeypatch, scenario, terminal_received, failure_phase="event_delivery",
    *, move_head_during_check=False, ancestor_valid=True,
):
    state, client, saved = lifecycle_fixture()
    state.branch = "jarvis/task-42"
    app.session_clients.clear()
    monkeypatch.setattr(app, "session_locks", {})
    monkeypatch.setenv("JARVIS_BACKEND_URL", "https://backend.example")
    monkeypatch.setenv("JARVIS_API_SCOPE", "api://00000000-0000-4000-8000-000000000000/.default")
    monkeypatch.delenv("JARVIS_GITHUB_APP_TOKEN_ENABLED", raising=False)
    monkeypatch.setattr(app, "_disk_low_threshold_bytes", lambda: 0)
    monkeypatch.setattr(app, "_disk_snapshot", lambda: {"disk_free_bytes": 1})
    before = "a" * 40
    after = "b" * 40 if scenario == "committed" else before
    checks = []
    observed_heads = []
    received = []
    stopped = asyncio.Event()

    async def prepare(_state, root, _env):
        project = root / "project"
        project.mkdir()
        return project, before

    async def git(_project, _env, *args, **_kwargs):
        checks.append(list(args))
        if args[0] == "symbolic-ref":
            return state.branch
        if args[0] == "rev-parse":
            head = "c" * 40 if move_head_during_check and observed_heads else after
            observed_heads.append(head)
            return head
        if args[0] == "merge-base":
            return "" if ancestor_valid else None
        raise AssertionError("Unexpected synthetic workspace operation")

    async def credentials(_agent):
        return {"copilot_token": "PRIVATE synthetic seat"}

    async def start():
        pass

    async def run(_prompt):
        result = {
            "response": {"stopReason": "end_turn"},
            "text": "Synthetic existing green PR; not delivery proof",
            "work_commit_sha": "d" * 40,
        }
        if scenario == "non_end_turn":
            result["response"]["stopReason"] = "other"
        elif scenario == "empty_attention":
            result["jarvis_needs_attention"] = ""
        return result

    def capacity():
        assert state.provider_stopped is True
        assert client._stop_task.done() and client._stop_task.exception() is None
        stopped.set()
        return {}

    class Publisher:
        def __init__(self, *_args):
            pass

        async def publish(self, _task_id, _invocation_id, _index, event):
            if event["kind"] in {"session_question", "completed"}:
                await stopped.wait()
                if terminal_received:
                    received.append(event["kind"])
                if failure_phase == "event_delivery":
                    raise RuntimeError("PRIVATE delayed terminal publication error")
            else:
                received.append(event["kind"])

        async def close(self):
            assert state.provider_stopped is True
            if failure_phase == "publisher_close":
                raise RuntimeError("PRIVATE publisher close error")

    monkeypatch.setattr(app, "_prepare_workspace", prepare)
    monkeypatch.setattr(app, "_git", git)
    monkeypatch.setattr(app, "_credentials_for", credentials)
    monkeypatch.setattr(app, "_capacity_snapshot", capacity)
    monkeypatch.setattr(client, "start", start)
    monkeypatch.setattr(client, "run", run)
    monkeypatch.setattr(app, "ACPClient", lambda *_args, **_kwargs: client)
    monkeypatch.setattr(app, "RunnerEventPublisher", Publisher)
    state.worker = asyncio.create_task(app._run_task(state))
    await asyncio.wait_for(state.worker, 2)
    request = Request({
        "type": "http", "method": "GET", "headers": [], "path": "/invocations",
        "state": {"invocation_id": state.invocation_id},
    })
    snapshot = json.loads((await app.get_invocation(request)).body)
    path = app._task_state_path(state.session_id, state.invocation_id)
    metadata = saved[path]
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(metadata), encoding="utf-8")
    monkeypatch.setattr(app, "tasks", {})
    rehydrated = json.loads((await app.get_invocation(request)).body)
    return {
        "snapshot": snapshot, "rehydrated": rehydrated, "metadata": metadata,
        "received": received, "workspace_checks": checks,
        "local_work_commit": after, "unpublished_remote_head": before, "observed_heads": observed_heads,
        "actual_stop_succeeded": client._stop_task.done() and client._stop_task.exception() is None,
    }


@pytest.mark.parametrize("terminal_received", [False, True])
def test_actual_no_commit_question_failure_never_attests_delivery_work(
    lifecycle_fixture, tmp_path, monkeypatch, terminal_received,
):
    async def exercise():
        result = await _exercise_actual_delivery_turn(
            lifecycle_fixture, tmp_path, monkeypatch, "question", terminal_received,
        )
        assert result["actual_stop_succeeded"] is True
        assert ("session_question" in result["received"]) is terminal_received
        assert any(event["kind"] == "session_question" for event in result["snapshot"]["events"])
        assert not any(check[0] == "merge-base" for check in result["workspace_checks"])
        for snapshot in (result["snapshot"], result["rehydrated"], result["metadata"]):
            assert snapshot["status"] == "failed"
            assert snapshot["finished_at"] is not None
            assert snapshot["work_completed"] is False and snapshot["provider_stopped"] is True
            assert snapshot["work_commit_sha"] is None
            assert snapshot["error"] == "Runner event delivery failed"
            assert snapshot["cleanup_failures"] == [
                {"phase": "event_delivery", "error": "Runner event delivery failed"},
            ]
        assert result["rehydrated"]["events"] == []

    asyncio.run(exercise())


@pytest.mark.parametrize("failure_phase", ["none", "event_delivery", "publisher_close"])
def test_actual_committed_completion_keeps_delivery_proof_after_cleanup_failure(
    lifecycle_fixture, tmp_path, monkeypatch, failure_phase,
):
    async def exercise():
        result = await _exercise_actual_delivery_turn(
            lifecycle_fixture, tmp_path, monkeypatch, "committed", True, failure_phase,
        )
        assert result["actual_stop_succeeded"] is True
        assert "completed" in result["received"]
        assert any(check[0] == "merge-base" for check in result["workspace_checks"])
        assert not any(event["kind"] == "session_question" for event in result["snapshot"]["events"])
        for snapshot in (result["snapshot"], result["rehydrated"], result["metadata"]):
            assert snapshot["status"] == ("completed" if failure_phase == "none" else "failed")
            assert snapshot["work_completed"] is True and snapshot["provider_stopped"] is True
            assert snapshot["work_commit_sha"] == result["local_work_commit"] == "b" * 40
            assert snapshot["work_commit_sha"] != result["unpublished_remote_head"]
            assert snapshot.get("cleanup_failures", []) == ([] if failure_phase == "none" else [
                {"phase": failure_phase, "error": "Runner event delivery failed"},
            ])

    asyncio.run(exercise())


@pytest.mark.parametrize("scenario", ["non_end_turn", "empty_attention"])
def test_other_completed_turn_branches_without_verified_commit_cannot_attest_work(
    lifecycle_fixture, tmp_path, monkeypatch, scenario,
):
    async def exercise():
        result = await _exercise_actual_delivery_turn(lifecycle_fixture, tmp_path, monkeypatch, scenario, True)
        assert "completed" in result["received"]
        assert not any(check[0] == "merge-base" for check in result["workspace_checks"])
        assert result["snapshot"]["status"] == "failed"
        assert result["snapshot"]["work_completed"] is False
        assert result["snapshot"]["work_commit_sha"] is None
        assert result["snapshot"]["provider_stopped"] is True

    asyncio.run(exercise())


def test_actual_worker_attests_the_commit_it_checked_not_a_later_head(lifecycle_fixture, tmp_path, monkeypatch):
    async def exercise():
        result = await _exercise_actual_delivery_turn(
            lifecycle_fixture, tmp_path, monkeypatch, "committed", True, move_head_during_check=True,
        )
        assert result["observed_heads"] == ["b" * 40]
        assert ["merge-base", "--is-ancestor", "a" * 40, "b" * 40] in result["workspace_checks"]
        for snapshot in (result["snapshot"], result["rehydrated"], result["metadata"]):
            assert snapshot["status"] == "failed"
            assert snapshot["work_completed"] is True and snapshot["provider_stopped"] is True
            assert snapshot["work_commit_sha"] == "b" * 40
            assert snapshot["work_commit_sha"] != "c" * 40

    asyncio.run(exercise())


def test_actual_worker_rewritten_history_cannot_attest_a_work_commit(lifecycle_fixture, tmp_path, monkeypatch):
    async def exercise():
        result = await _exercise_actual_delivery_turn(
            lifecycle_fixture, tmp_path, monkeypatch, "committed", True, ancestor_valid=False,
        )
        assert result["actual_stop_succeeded"] is True
        assert result["snapshot"]["error"] == "Task branch no longer contains the turn's starting commit"
        for snapshot in (result["snapshot"], result["rehydrated"], result["metadata"]):
            assert snapshot["status"] == "failed"
            assert snapshot["work_completed"] is False and snapshot["provider_stopped"] is True
            assert snapshot["work_commit_sha"] is None

    asyncio.run(exercise())


@pytest.mark.parametrize("stage", ["none", "delivery", "publisher"])
def test_actual_local_git_commit_binding_survives_cleanup_and_reload(
    finalization_fixture, git_repository, tmp_path, monkeypatch, stage,
):
    source, _env, git = git_repository

    async def exercise():
        state, entered, release, processes, _delivered, _closed, saved = finalization_fixture(stage, fail=True)
        try:
            if stage != "none":
                await asyncio.wait_for(entered.wait(), 5)
                release.set()
            await asyncio.wait_for(state.worker, 5)
            project = tmp_path / state.session_id / "project"
            actual_commit = git(project, "rev-parse", "HEAD")
            remote_commit = git(source, "rev-parse", "HEAD")
            assert len(actual_commit) == 40 and actual_commit != remote_commit
            assert git(project, "rev-parse", "origin/main") == remote_commit
            assert state.work_completed is True and state.provider_stopped is True
            assert state.work_commit_sha == actual_commit
            path = app._task_state_path(state.session_id, state.invocation_id)
            metadata = saved[path]
            assert metadata["work_commit_sha"] == actual_commit
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps(metadata), encoding="utf-8")
            request = Request({
                "type": "http", "method": "GET", "headers": [], "path": "/invocations",
                "state": {"invocation_id": state.invocation_id},
            })
            snapshot = json.loads((await app.get_invocation(request)).body)
            monkeypatch.setattr(app, "tasks", {})
            rehydrated = json.loads((await app.get_invocation(request)).body)
            for response in (snapshot, rehydrated, metadata):
                assert response["status"] == ("completed" if stage == "none" else "failed")
                assert response["work_completed"] is True and response["provider_stopped"] is True
                assert response["work_commit_sha"] == actual_commit
        finally:
            await stop_fixture(state, release, processes)

    asyncio.run(exercise())


@pytest.mark.parametrize("value", [
    None, "", True, 1, 0, [], {}, ["b" * 40], "b" * 39, "b" * 41, "b" * 64,
    "g" * 40, " " + "b" * 40, "b" * 40 + "\n", "omitted", "b" * 40, "B" * 40,
])
@pytest.mark.parametrize("status", ["completed", "failed"])
def test_work_commit_metadata_and_polling_are_strict_and_legacy_readable(tmp_path, monkeypatch, value, status):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "tasks", {})
    state = app.TaskState("commit-binding", "session", "copilot", "work")
    metadata = {
        "invocation_id": state.invocation_id, "session_id": state.session_id, "agent": state.agent,
        "status": status, "started_at": 1, "finished_at": 2,
        "work_completed": True, "provider_stopped": True,
        "result": {"work_commit_sha": "d" * 40},
    }
    if value != "omitted":
        metadata["work_commit_sha"] = value
    path = app._task_state_path(state.session_id, state.invocation_id)
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(metadata), encoding="utf-8")
    expected = "b" * 40 if value in ("b" * 40, "B" * 40) else None

    async def exercise():
        response = json.loads((await app.get_invocation(Request({
            "type": "http", "method": "GET", "headers": [], "path": "/invocations",
            "state": {"invocation_id": state.invocation_id},
        }))).body)
        assert response["status"] == status
        assert response["work_completed"] is True and response["provider_stopped"] is True
        assert response["work_commit_sha"] == expected
        assert app._load_task(state.invocation_id).work_commit_sha == expected

    asyncio.run(exercise())


@pytest.mark.parametrize("value", [None, True, 1, [], {}, "b" * 39, "b" * 64, "b" * 40 + "\n", "B" * 40])
def test_commit_binding_persistence_and_memory_readback_are_sanitized(lifecycle_fixture, value):
    async def exercise():
        state, _client, saved = lifecycle_fixture()
        state.work_commit_sha = value
        app._persist_task(state)
        expected = "b" * 40 if value == "B" * 40 else None
        assert saved[app._task_state_path(state.session_id, state.invocation_id)]["work_commit_sha"] == expected
        response = json.loads((await app.get_invocation(Request({
            "type": "http", "method": "GET", "headers": [], "path": "/invocations",
            "state": {"invocation_id": state.invocation_id},
        }))).body)
        assert response["work_commit_sha"] == expected

    asyncio.run(exercise())


@pytest.mark.parametrize("value", [None, True, 1, {}, "b" * 39, "b" * 64, "b" * 40 + "\n"])
def test_missing_or_malformed_commit_cannot_supply_work_proof(lifecycle_fixture, tmp_path, value):
    async def exercise():
        state, client, saved = lifecycle_fixture()
        state.work_commit_sha = "d" * 40
        await app._finish_task(
            state, client, tmp_path, {}, False, "completed", delivery_work_completed=True, work_commit_sha=value,
        )
        assert state.status == "completed" and state.provider_stopped is True
        assert state.work_completed is False and state.work_commit_sha is None
        metadata = saved[app._task_state_path(state.session_id, state.invocation_id)]
        assert metadata["work_completed"] is False and metadata["work_commit_sha"] is None

    asyncio.run(exercise())


@pytest.mark.parametrize("phase", ["event_delivery", "publisher_close", "credential_persist"])
@pytest.mark.parametrize("resists_cancel", [False, True])
def test_finalization_deadlines_fail_visibly_and_fence_unsettled_owners(
    tmp_path, monkeypatch, phase, resists_cancel,
):
    monkeypatch.setattr(app, "_persist_task", lambda _state: None)
    monkeypatch.setattr(app, "_capacity_snapshot", lambda: {})
    monkeypatch.setattr(app, "FINALIZATION_IO_TIMEOUT_SECONDS", 0.02)
    monkeypatch.setattr(app, "FINALIZATION_CANCEL_TIMEOUT_SECONDS", 0.02)

    async def exercise():
        entered = asyncio.Event()
        cancelled = asyncio.Event()
        release = asyncio.Event()
        agent = "codex" if phase == "credential_persist" else "copilot"
        state = app.TaskState("bounded-finalization", "owned-session", agent, "synthetic", task_id="42", status="running")
        state.finalizing = True
        monkeypatch.setattr(app, "tasks", {state.invocation_id: state})

        async def gate():
            entered.set()
            try:
                await release.wait()
            except asyncio.CancelledError:
                cancelled.set()
                if resists_cancel:
                    await release.wait()
                else:
                    raise

        class Publisher:
            async def publish(self, *_args):
                if phase == "event_delivery":
                    await gate()

            async def close(self):
                if phase == "publisher_close":
                    await gate()

        async def store(_auth):
            await gate()
            return False

        if agent == "codex":
            auth = tmp_path / ".codex" / "auth.json"
            auth.parent.mkdir()
            auth.write_text("PRIVATE synthetic credential", encoding="utf-8")
            monkeypatch.setattr(app, "_store_codex_login_if_newer", store)
        state.event_publisher = Publisher()
        state.event("completed")
        credentials = {"synthetic": "PRIVATE"}
        finishing = asyncio.create_task(app._finish_task(state, None, tmp_path, credentials, True, "completed"))
        try:
            await asyncio.wait_for(entered.wait(), 1)
            await asyncio.wait_for(finishing, 1)
            assert state.status == "failed"
            assert state.finished_at is not None
            assert phase in state.error
            assert cancelled.is_set()
            assert credentials == {}
            assert "PRIVATE" not in json.dumps(state.events)
            assert any(not task.done() for task in state.finalization_tasks) is resists_cancel
            if agent == "codex":
                assert not auth.exists()
            if resists_cancel:
                next_state = app.TaskState(
                    "next-invocation", "other-session" if agent == "codex" else state.session_id, agent, "synthetic",
                )
                app.tasks[next_state.invocation_id] = next_state
                await app._run_task(next_state)
                assert next_state.status == "failed"
                assert "cleanup is still active" in next_state.error
                assert next_state.finished_at is not None
        finally:
            release.set()
            pending = list(state.finalization_tasks)
            if pending:
                await asyncio.wait_for(asyncio.gather(*pending, return_exceptions=True), 1)
            await asyncio.wait_for(asyncio.gather(finishing, return_exceptions=True), 1)

    asyncio.run(exercise())


def test_exhausted_finalization_budget_does_not_start_a_new_write(monkeypatch):
    async def exercise():
        state = app.TaskState("expired-budget", "owned-session", "codex", "synthetic")
        began = []

        async def write():
            began.append(True)

        with pytest.raises(app.FinalizationTimeout, match="credential_persist"):
            await app._await_finalization(
                state, write(), "credential_persist", asyncio.get_running_loop().time() - 1, 10,
            )
        assert began == []
        assert not any(not task.done() for task in state.finalization_tasks)

    asyncio.run(exercise())


def test_shared_finalization_deadline_caps_a_longer_phase(monkeypatch):
    monkeypatch.setattr(app, "FINALIZATION_CANCEL_TIMEOUT_SECONDS", 0.02)

    async def exercise():
        state = app.TaskState("shared-budget", "owned-session", "copilot", "synthetic")
        entered = asyncio.Event()
        cancelled = asyncio.Event()

        async def operation():
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        with pytest.raises(app.FinalizationTimeout, match="provider_shutdown"):
            await asyncio.wait_for(app._await_finalization(
                state, operation(), "provider_shutdown", asyncio.get_running_loop().time() + 0.02, 60,
            ), 1)
        assert entered.is_set()
        assert cancelled.is_set()
        assert not any(not task.done() for task in state.finalization_tasks)

    asyncio.run(exercise())


@pytest.mark.parametrize("business_error", [
    None, "Runner task failed: ValueError", "Codex usage limit reached",
    "Task repository clone failed; verify repository access",
])
@pytest.mark.parametrize("delivery_timeout", [False, True])
def test_combined_cleanup_failures_preserve_first_cause_and_safe_terminal_readback(
    tmp_path, monkeypatch, business_error, delivery_timeout,
):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "_capacity_snapshot", lambda: {})
    monkeypatch.setattr(app, "session_clients", {})
    monkeypatch.setattr(app, "FINALIZATION_IO_TIMEOUT_SECONDS", 0.02)
    snapshots = {}
    monkeypatch.setattr(app, "_write_json", lambda path, value: snapshots.update({path: value}))

    async def exercise():
        state = app.TaskState(
            "combined", "session", "codex", "PRIVATE prompt", task_id="42",
            status="running", error=business_error,
        )
        monkeypatch.setattr(app, "tasks", {state.invocation_id: state})
        auth = tmp_path / ".codex" / "auth.json"
        auth.parent.mkdir()
        auth.write_text("PRIVATE credential", encoding="utf-8")
        attempts = []

        class Client:
            async def stop(self):
                attempts.append("provider")
                raise app.ACPShutdownError("reader_shutdown")

        async def store(_auth):
            attempts.append("credential")
            raise RuntimeError("PRIVATE credential diagnostic")

        class Publisher:
            async def publish(self, _task_id, _invocation_id, _index, event):
                if event["kind"] == "capacity":
                    attempts.append("delivery")
                    if delivery_timeout:
                        await asyncio.Event().wait()
                    raise RuntimeError("PRIVATE delivery diagnostic")

            async def close(self):
                attempts.append("publisher")
                raise OSError("PRIVATE publisher diagnostic")

        monkeypatch.setattr(app, "_store_codex_login_if_newer", store)
        state.event_publisher = Publisher()
        credentials = {"token": "PRIVATE"}
        await asyncio.wait_for(app._finish_task(
            state, Client(), tmp_path, credentials, True, "failed" if business_error else "completed",
        ), 2)
        provider_error = "Runner cleanup failed: ACPShutdownError: reader_shutdown"
        assert state.error == (business_error or provider_error)
        assert state.status == "failed" and state.finished_at is not None
        assert attempts == ["provider", "credential", "delivery", "publisher"]
        assert state.cleanup_failures == [
            {"phase": "reader_shutdown", "error": provider_error},
            {"phase": "credential_persist", "error": "Runner credential persistence failed: RuntimeError"},
            {"phase": "event_delivery", "error": (
                "Runner finalization timed out: event_delivery" if delivery_timeout else "Runner event delivery failed"
            )},
            {"phase": "publisher_close", "error": "Runner event delivery failed"},
        ]
        assert credentials == {} and not auth.exists()
        assert "PRIVATE" not in json.dumps(state.events)
        saved = snapshots[app._task_state_path(state.session_id, state.invocation_id)]
        assert "PRIVATE" not in json.dumps(saved)
        assert saved["cleanup_failures"] == state.cleanup_failures
        expected_persisted_error = (
            business_error if business_error in {"Runner task failed: ValueError", "Codex usage limit reached"}
            else "Runner task failed" if business_error else provider_error
        )
        assert saved["error"] == expected_persisted_error
        path = app._task_state_path(state.session_id, state.invocation_id)
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps(saved), encoding="utf-8")
        monkeypatch.setattr(app, "tasks", {})
        request = Request({
            "type": "http", "method": "GET", "headers": [], "path": "/invocations",
            "state": {"invocation_id": state.invocation_id},
        })
        response = json.loads((await app.get_invocation(request)).body)
        assert response["status"] == "failed"
        assert response["error"] == expected_persisted_error
        assert response["cleanup_failures"] == state.cleanup_failures
        assert response["events"] == [] and response["result"] is None

    asyncio.run(exercise())


def test_combined_cleanup_timeouts_keep_business_failure_and_unsettled_owners(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "_persist_task", lambda _state: None)
    monkeypatch.setattr(app, "_capacity_snapshot", lambda: {})
    monkeypatch.setattr(app, "session_clients", {})
    monkeypatch.setattr(app, "FINALIZATION_IO_TIMEOUT_SECONDS", 0.02)
    monkeypatch.setattr(app, "FINALIZATION_CANCEL_TIMEOUT_SECONDS", 0.02)

    async def exercise():
        release = asyncio.Event()
        cancelled = set()
        state = app.TaskState(
            "combined-resistant", "session", "codex", "work", status="running",
            task_id="42", error="Runner task failed: ValueError",
        )
        monkeypatch.setattr(app, "tasks", {state.invocation_id: state})
        auth = tmp_path / ".codex" / "auth.json"
        auth.parent.mkdir()
        auth.write_text("PRIVATE credential", encoding="utf-8")

        async def gate(phase):
            try:
                await release.wait()
            except asyncio.CancelledError:
                cancelled.add(phase)
                await release.wait()

        class Client:
            async def stop(self):
                raise app.ACPShutdownError("reader_shutdown")

        async def store(_auth):
            await gate("credential_persist")
            return False

        class Publisher:
            async def publish(self, _task_id, _invocation_id, _index, event):
                if event["kind"] == "capacity":
                    await gate("event_delivery")

            async def close(self):
                await gate("publisher_close")

        monkeypatch.setattr(app, "_store_codex_login_if_newer", store)
        state.event_publisher = Publisher()
        try:
            await asyncio.wait_for(app._finish_task(state, Client(), tmp_path, {}, True, "failed"), 2)
            assert state.status == "failed"
            assert state.error == "Runner task failed: ValueError"
            assert cancelled == {"credential_persist", "event_delivery", "publisher_close"}
            assert {phase for task, phase in state.finalization_tasks.items() if not task.done()} == cancelled
            assert [item["phase"] for item in state.cleanup_failures] == [
                "reader_shutdown", "credential_persist", "event_delivery", "publisher_close",
            ]
            other_session = app.TaskState("next", "other-session", "codex", "work")
            assert app._has_pending_finalization(other_session)
            assert not auth.exists()
        finally:
            release.set()
            await asyncio.wait_for(asyncio.gather(*state.finalization_tasks, return_exceptions=True), 1)
        assert not app._has_pending_finalization(other_session)

    asyncio.run(exercise())


@pytest.mark.parametrize("expired", [False, True])
def test_cancellation_resistant_future_remains_owned_without_replacing_primary_error(monkeypatch, expired):
    monkeypatch.setattr(app, "FINALIZATION_IO_TIMEOUT_SECONDS", 0.02)
    monkeypatch.setattr(app, "FINALIZATION_CANCEL_TIMEOUT_SECONDS", 0.02)

    async def exercise():
        class ResistantFuture(asyncio.Future):
            def cancel(self, msg=None):
                return False

        state = app.TaskState("future-owner", "session", "copilot", "work", status="running")
        app._record_cleanup_failure(
            state, "reader_shutdown", "Runner cleanup failed: ACPShutdownError: reader_shutdown",
        )
        monkeypatch.setattr(app, "tasks", {state.invocation_id: state})
        pending = ResistantFuture()
        state.event_delivery = pending
        try:
            await asyncio.wait_for(app._flush_event_delivery(
                state, asyncio.get_running_loop().time() - 1 if expired else None,
            ), 1)
            assert state.status == "failed"
            assert state.error == "Runner cleanup failed: ACPShutdownError: reader_shutdown"
            assert state.finalization_tasks == {pending: "event_delivery"}
            assert [item["phase"] for item in state.cleanup_failures] == ["reader_shutdown", "event_delivery"]
            next_state = app.TaskState("next", state.session_id, "copilot", "work")
            assert app._has_pending_finalization(next_state)
        finally:
            pending.set_result(None)
            await asyncio.sleep(0)
        assert state.finalization_tasks == {}
        assert not app._has_pending_finalization(next_state)

    asyncio.run(exercise())


def test_exhausted_combined_cleanup_budget_preserves_provider_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "_persist_task", lambda _state: None)
    monkeypatch.setattr(app, "_capacity_snapshot", lambda: {})
    monkeypatch.setattr(app, "session_clients", {})
    original_await = app._await_finalization

    async def expired_after_provider(state, awaitable, phase, deadline, timeout):
        return await original_await(
            state, awaitable, phase,
            deadline if phase == "provider_shutdown" else asyncio.get_running_loop().time() - 1, timeout,
        )

    monkeypatch.setattr(app, "_await_finalization", expired_after_provider)

    async def exercise():
        state = app.TaskState("expired-combined", "session", "codex", "work", status="running")
        auth = tmp_path / ".codex" / "auth.json"
        auth.parent.mkdir()
        auth.write_text("PRIVATE credential", encoding="utf-8")
        began = []

        class Client:
            async def stop(self):
                raise app.ACPShutdownError("reader_shutdown")

        async def store(_auth):
            began.append("credential")

        class Publisher:
            async def close(self):
                began.append("publisher")

        monkeypatch.setattr(app, "_store_codex_login_if_newer", store)
        state.event_publisher = Publisher()
        await asyncio.wait_for(app._finish_task(state, Client(), tmp_path, {}, True, "completed"), 2)
        assert state.status == "failed"
        assert state.error == "Runner cleanup failed: ACPShutdownError: reader_shutdown"
        assert [item["phase"] for item in state.cleanup_failures] == [
            "reader_shutdown", "credential_persist", "publisher_close",
        ]
        assert began == [] and not auth.exists()
        assert not state.finalization_tasks

    asyncio.run(exercise())


def test_earlier_event_delivery_failure_is_not_replaced_by_provider_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "_persist_task", lambda _state: None)
    monkeypatch.setattr(app, "_capacity_snapshot", lambda: {})
    monkeypatch.setattr(app, "session_clients", {})

    async def exercise():
        state = app.TaskState("delivery-first", "session", "copilot", "work", status="running", task_id="42")

        class Publisher:
            async def publish(self, *_args):
                raise RuntimeError("PRIVATE earlier delivery error")

            async def close(self):
                pass

        class Client:
            async def stop(self):
                raise app.ACPShutdownError("process_exit")

        publisher = Publisher()
        with pytest.raises(RuntimeError):
            await app._publish_after(None, publisher, state, "42", state.invocation_id, 0, {})
        assert state.status == "running"
        state.event_publisher = publisher
        await app._finish_task(state, Client(), tmp_path, {}, False, "completed")
        assert state.status == "failed"
        assert state.error == "Runner event delivery failed"
        assert [item["phase"] for item in state.cleanup_failures] == ["event_delivery", "process_exit"]
        assert "PRIVATE" not in json.dumps(state.cleanup_failures)

    asyncio.run(exercise())


def test_work_failure_precedes_provider_failure_in_actual_worker(finalization_fixture, monkeypatch):
    async def exercise():
        state, entered, release, processes, _delivered, _closed, saved = finalization_fixture("provider", True)
        original_client = app.ACPClient

        class Client(original_client):
            async def run(self, _prompt):
                raise ValueError("PRIVATE work diagnostic")

        monkeypatch.setattr(app, "ACPClient", Client)
        try:
            await asyncio.wait_for(entered.wait(), 5)
            assert state.error == "Runner task failed: ValueError"
            assert state.status == "running"
            release.set()
            await asyncio.wait_for(state.worker, 5)
            assert state.status == "failed"
            assert state.error == "Runner task failed: ValueError"
            assert state.cleanup_failures == [
                {"phase": "provider_shutdown", "error": "Runner cleanup failed: RuntimeError"},
            ]
            metadata = saved[app._task_state_path(state.session_id, state.invocation_id)]
            assert metadata["error"] == state.error
            assert "PRIVATE" not in json.dumps(metadata)
        finally:
            await stop_fixture(state, release, processes)

    asyncio.run(exercise())


def test_earlier_delivery_failure_precedes_work_failure_in_actual_worker(finalization_fixture, monkeypatch):
    async def exercise():
        state, _entered, release, processes, _delivered, _closed, _saved = finalization_fixture("provider")
        observed = asyncio.Event()
        original_publisher = app.RunnerEventPublisher

        class Publisher(original_publisher):
            async def publish(self, *_args):
                observed.set()
                raise RuntimeError("PRIVATE delivery diagnostic")

        async def credentials(_agent):
            await observed.wait()
            raise ValueError("PRIVATE work diagnostic")

        monkeypatch.setattr(app, "RunnerEventPublisher", Publisher)
        monkeypatch.setattr(app, "_credentials_for", credentials)
        try:
            await asyncio.wait_for(state.worker, 5)
            assert state.status == "failed"
            assert state.error == "Runner event delivery failed"
            assert state.cleanup_failures == [
                {"phase": "event_delivery", "error": "Runner event delivery failed"},
            ]
            assert processes == []
            assert "PRIVATE" not in json.dumps(state.events)
        finally:
            await stop_fixture(state, release, processes)

    asyncio.run(exercise())


def test_cleanup_metadata_filters_unknown_phases_raw_errors_and_extra_fields(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    snapshots = {}
    monkeypatch.setattr(app, "_write_json", lambda path, value: snapshots.update({path: value}))
    safe = {"phase": "reader_shutdown", "error": "Runner cleanup failed: ACPShutdownError: reader_shutdown"}
    unsafe = [
        {"phase": "PRIVATE", "error": "Runner event delivery failed"},
        {"phase": "reader_failed", "error": "PRIVATE output"},
        {"phase": "provider_shutdown", "error": "Runner cleanup failed: PRIVATE"},
        {"phase": "event_delivery", "error": "Runner finalization timed out: event_delivery PRIVATE"},
        {"phase": ["PRIVATE"], "error": "Runner event delivery failed"},
        "PRIVATE", None,
    ]
    state = app.TaskState(
        "safe-metadata", "session", "copilot", "PRIVATE prompt", status="failed", error="PRIVATE work error",
        cleanup_failures=[{**safe, "provider_output": "PRIVATE"}, *unsafe, safe],
    )
    app._persist_task(state)
    path = app._task_state_path(state.session_id, state.invocation_id)
    saved = snapshots[path]
    assert saved["cleanup_failures"] == [safe]
    assert saved["error"] == "Runner task failed"
    assert "PRIVATE" not in json.dumps(saved)
    saved["cleanup_failures"].extend(unsafe)
    saved["error"] = "Runner cleanup failed: ACPShutdownError: reader_shutdown PRIVATE"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(saved), encoding="utf-8")
    loaded = app._load_task(state.invocation_id)
    assert loaded.cleanup_failures == [safe]
    assert loaded.error is None


@pytest.mark.parametrize("fail", [False, True])
def test_attention_question_is_not_mistaken_for_a_work_failure(tmp_path, monkeypatch, fail):
    monkeypatch.setattr(app, "_persist_task", lambda _state: None)
    monkeypatch.setattr(app, "_capacity_snapshot", lambda: {})
    monkeypatch.setattr(app, "session_clients", {})

    async def exercise():
        state = app.TaskState(
            "attention", "session", "copilot", "work", status="running", error="Which branch should I use?",
        )

        class Client:
            async def stop(self):
                if fail:
                    raise app.ACPShutdownError("reader_shutdown")

        await app._finish_task(state, Client(), tmp_path, {}, False, "needs_attention")
        assert state.status == ("failed" if fail else "needs_attention")
        assert state.error == (
            "Runner cleanup failed: ACPShutdownError: reader_shutdown" if fail else "Which branch should I use?"
        )

    asyncio.run(exercise())


def test_queued_turn_rechecks_unsettled_cleanup_after_acquiring_session_lock(
    tmp_path, monkeypatch,
):
    monkeypatch.setattr(app, "_persist_task", lambda _state: None)
    monkeypatch.setattr(app, "_capacity_snapshot", lambda: {})
    monkeypatch.setattr(app, "_disk_low_threshold_bytes", lambda: 0)
    monkeypatch.setattr(app, "_disk_snapshot", lambda: {"disk_free_bytes": 1})
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "session_clients", {})

    async def exercise():
        previous = app.TaskState("previous", "owned-session", "copilot", "synthetic", status="failed")
        state = app.TaskState("queued", previous.session_id, "copilot", "synthetic")
        lock = asyncio.Lock()
        await lock.acquire()
        monkeypatch.setattr(app, "session_locks", {state.session_id: lock})
        monkeypatch.setattr(app, "tasks", {previous.invocation_id: previous, state.invocation_id: state})
        release = asyncio.Event()
        entered = []

        async def credentials(_agent):
            entered.append(True)
            raise AssertionError("An unsettled owner must be checked before credentials")

        monkeypatch.setattr(app, "_credentials_for", credentials)
        queued = asyncio.create_task(app._run_task(state))
        pending = None
        try:
            await asyncio.sleep(0)
            assert state.status == "running"
            assert not queued.done()
            pending = asyncio.create_task(release.wait())
            previous.finalization_tasks[pending] = "event_delivery"
            lock.release()
            await asyncio.wait_for(queued, 1)
            assert state.status == "failed"
            assert state.finished_at is not None
            assert "cleanup is still active" in state.error
            assert entered == []
            assert not lock.locked()
        finally:
            release.set()
            if pending is not None:
                await asyncio.wait_for(pending, 1)
            if lock.locked():
                lock.release()
            await asyncio.wait_for(asyncio.gather(queued, return_exceptions=True), 1)

    asyncio.run(exercise())


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


def test_failed_checkpoint_does_not_replace_earlier_cleanup_failure(finalization_fixture, monkeypatch):
    async def exercise():
        state, entered, release, processes, _delivered, _closed, saved = finalization_fixture("provider", True)
        write_json = app._write_json
        failed_writes = []

        def fail_first_terminal_checkpoint(path, value):
            if value.get("finished_at") is not None and not failed_writes:
                failed_writes.append(True)
                raise OSError("PRIVATE checkpoint diagnostic")
            write_json(path, value)

        monkeypatch.setattr(app, "_write_json", fail_first_terminal_checkpoint)
        try:
            await asyncio.wait_for(entered.wait(), 5)
            release.set()
            result = await asyncio.wait_for(asyncio.gather(state.worker, return_exceptions=True), 5)
            assert isinstance(result[0], OSError)
            assert state.status == "failed"
            assert state.error == "Runner cleanup failed: RuntimeError"
            metadata = saved[app._task_state_path(state.session_id, state.invocation_id)]
            assert metadata["error"] == state.error
            assert metadata["cleanup_failures"] == state.cleanup_failures
            assert "PRIVATE" not in json.dumps(metadata)
        finally:
            await stop_fixture(state, release, processes)

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
