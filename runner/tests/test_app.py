import asyncio
import json
import os
import sys
from pathlib import Path

import pytest

import app
from starlette.requests import Request


def test_required_string_rejects_missing_and_blank():
    with pytest.raises(ValueError):
        app._required_string({}, "task")
    with pytest.raises(ValueError):
        app._required_string({"task": " "}, "task")


def test_key_vault_probe_accepts_deployment_payload_without_task(monkeypatch):
    async def fake_credentials(agent):
        assert agent == "copilot"
        return {"github_token": "not-a-real-token", "copilot_token": "not-a-real-token"}

    monkeypatch.setattr(app, "_credentials_for", fake_credentials)
    payload = {"agent": "copilot", "probe": "key-vault"}
    body = json.dumps(payload).encode()

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/invocations",
            "headers": [(b"content-type", b"application/json")],
            "state": {"invocation_id": "probe-invocation", "session_id": "probe-session"},
        },
        receive,
    )
    response = asyncio.run(app.invoke(request))

    assert response.status_code == 200
    body = json.loads(response.body)
    assert body["key_vault_access"] is True
    assert set(body) == {"key_vault_access", "session_id"}


def test_agent_command_is_explicit():
    assert app._agent_command("copilot") == ["copilot", "--acp", "--stdio", "--allow-all"]
    assert app._agent_command("codex") == ["codex-acp"]


def test_dockerfile_does_not_contain_secret_names():
    dockerfile = Path(__file__).parents[1].joinpath("Dockerfile").read_text()
    assert "COPILOT_GITHUB_TOKEN" not in dockerfile
    assert "auth.json" not in dockerfile
    assert "github-token" not in dockerfile


def test_state_event_is_bounded(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    state = app.TaskState("i", "s", "copilot", "task")
    for number in range(app.MAX_EVENTS + 10):
        state.event("test", number=number)
    assert len(state.events) == app.MAX_EVENTS
    assert state.events[-1]["data"]["number"] == app.MAX_EVENTS + 9
    assert app._task_state_path("s", "i").exists()


def test_session_and_task_metadata_are_persisted_without_prompt_or_result(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    state = app.TaskState("invocation", "foundry-session", "copilot", "secret prompt")
    state.result = {"response": "secret result"}
    state.event("started")
    app._persist_acp_session(state, "acp-session")

    task_metadata = json.loads(app._task_state_path("foundry-session", "invocation").read_text())
    acp_metadata = json.loads((tmp_path / "foundry-session" / app.ACP_SESSION_FILE).read_text())
    assert "secret prompt" not in json.dumps(task_metadata)
    assert "secret result" not in json.dumps(task_metadata)
    assert acp_metadata["acp_session_id"] == "acp-session"
    restored = app._load_task("invocation")
    assert restored is not None
    assert restored.session_id == "foundry-session"
    assert restored.task == ""


def test_git_credential_helper_uses_process_environment(tmp_path):
    helper = app._credential_helper(tmp_path)
    assert helper.read_text() == (
        "#!/bin/sh\n"
        "printf 'username=x-access-token\\npassword=%s\\n' \"$GH_TOKEN\"\n"
    )
    if os.name != "nt":
        assert helper.stat().st_mode & 0o777 == 0o700


def test_acp_loads_a_persisted_session_with_protocol_fixture(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    fixture = tmp_path / "fake_acp.py"
    fixture.write_text(
        "import json, sys\n"
        "for line in sys.stdin:\n"
        "    message = json.loads(line)\n"
        "    method = message.get('method')\n"
        "    if method == 'session/load' and message['params']['sessionId'] != 'persisted':\n"
        "        raise SystemExit(2)\n"
        "    if method == 'session/new':\n"
        "        result = {'sessionId': 'new'}\n"
        "    else:\n"
        "        result = {'stopReason': 'end_turn'}\n"
        "    sys.stdout.write(json.dumps({'jsonrpc': '2.0', 'id': message['id'], 'result': result}) + '\\n')\n"
        "    sys.stdout.flush()\n",
        encoding="utf-8",
    )
    state = app.TaskState("i", "s", "codex", "continue")
    client = app.ACPClient(
        [sys.executable, str(fixture)],
        tmp_path,
        state,
        os.environ.copy(),
        persisted_session_id="persisted",
    )

    async def exercise():
        await client.start()
        result = await client.run("continue")
        await client.stop()
        return result

    result = asyncio.run(exercise())
    assert result["acp_session_id"] == "persisted"
    assert any(event["kind"] == "acp_session_loaded" for event in state.events)


def test_steer_cancels_the_running_turn_with_protocol_fixture(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    fixture = tmp_path / "fake_acp_cancel.py"
    fixture.write_text(
        "import json, sys\n"
        "pending = None\n"
        "for line in sys.stdin:\n"
        "    message = json.loads(line)\n"
        "    method = message.get('method')\n"
        "    if method == 'initialize':\n"
        "        request_id, result = message['id'], {'agentCapabilities': {'loadSession': True}}\n"
        "    elif method == 'session/new':\n"
        "        request_id, result = message['id'], {'sessionId': 'acp-1'}\n"
        "    elif method == 'session/prompt':\n"
        "        pending = message['id']\n"
        "        continue\n"
        "    elif method == 'session/cancel' and pending is not None:\n"
        "        request_id, result = pending, {'stopReason': 'cancelled'}\n"
        "    else:\n"
        "        continue\n"
        "    sys.stdout.write(json.dumps({'jsonrpc': '2.0', 'id': request_id, 'result': result}) + '\\n')\n"
        "    sys.stdout.flush()\n",
        encoding="utf-8",
    )
    state = app.TaskState("i", "s", "copilot", "long task")
    state.status = "running"
    client = app.ACPClient([sys.executable, str(fixture)], tmp_path, state, os.environ.copy())
    monkeypatch.setattr(app, "tasks", {"i": state})
    monkeypatch.setattr(app, "session_clients", {"s": client})

    async def exercise():
        await client.start()

        async def turn():
            result = await client.run("long task")
            state.status = app.STOPPED_STATUS[state.stop_requested]
            return result

        running = asyncio.create_task(turn())
        await asyncio.sleep(0.5)
        stopped = await app._stop_running_turn("s", "steer")
        result = await running
        await client.stop()
        return stopped, result

    stopped, result = asyncio.run(exercise())
    assert stopped is state
    assert state.status == "interrupted"
    assert result["response"]["stopReason"] == "cancelled"
    kinds = [event["kind"] for event in state.events]
    assert "steer_requested" in kinds
    assert "acp_cancel_sent" in kinds
    assert "stop_timeout_forced" not in kinds
    assert any(e["kind"] == "acp_initialized" and e["data"]["load_session"] for e in state.events)


def test_pause_mode_without_running_turn_reports_idle():
    request = Request({"type": "http", "method": "POST", "headers": [], "path": "/invocations"})
    request.state.session_id = "no-such-session"
    request.state.invocation_id = "inv"

    async def body():
        return {"mode": "pause"}

    request.json = body  # type: ignore[method-assign]
    response = asyncio.run(app.invoke(request))
    payload = json.loads(response.body)
    assert payload["status"] == "idle"
    assert payload["paused_invocation"] is None


def test_crash_test_is_not_a_production_mode(monkeypatch):
    monkeypatch.delenv("JARVIS_ALLOW_CRASH_TEST", raising=False)
    request = Request({"type": "http", "method": "POST", "headers": [], "path": "/invocations"})
    request.state.session_id = "s"
    request.state.invocation_id = "inv"

    async def body():
        return {"mode": "crash-test"}

    request.json = body  # type: ignore[method-assign]
    response = asyncio.run(app.invoke(request))
    payload = json.loads(response.body)
    assert response.status_code == 400
    assert "crash-test" not in payload["error"]


def test_steer_does_not_stop_itself_when_no_other_turn_is_running(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    finished = app.TaskState("first", "s", "copilot", "done task")
    finished.status = "completed"
    steer = app.TaskState("steer", "s", "copilot", "correction")
    monkeypatch.setattr(app, "tasks", {"first": finished, "steer": steer})
    monkeypatch.setattr(app, "session_clients", {})

    stopped = asyncio.run(app._stop_running_turn("s", "steer", exclude="steer"))

    assert stopped is None
    assert steer.stop_requested is None
    assert steer.status == "queued"


def test_parse_last_refresh_handles_codex_precision():
    parsed = app._parse_last_refresh('{"last_refresh": "2026-09-27T17:02:08.348573400Z"}')
    assert parsed is not None
    assert app._iso(parsed) == "2026-09-27T17:02:08.348573Z"
    assert app._parse_last_refresh('{"last_refresh": "not a date"}') is None
    assert app._parse_last_refresh("not json") is None
    assert app._parse_last_refresh(None) is None


def _jwt(expires: int) -> str:
    import base64 as b64

    def part(value):
        return b64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")

    return f"{part({'alg': 'none'})}.{part({'exp': expires})}.sig"


def _login(last_refresh: str, marker: str = "x", expires: int = 4_102_444_800) -> str:
    return json.dumps(
        {
            "auth_mode": "chatgpt",
            "last_refresh": last_refresh,
            "tokens": {"access_token": _jwt(expires), "refresh_token": marker},
        }
    )


def test_access_token_expiry_reads_exp_claim():
    assert app._iso(app._access_token_expiry(_login("2026-10-02T00:00:00Z", expires=1_791_000_000))) == "2026-10-03T04:00:00.000000Z"
    assert app._access_token_expiry(json.dumps({"tokens": {"access_token": "not-a-jwt"}})) is None
    assert app._access_token_expiry("not json") is None

def test_codex_login_is_stored_only_when_newer(monkeypatch):
    vault = {"codex-login": _login("2026-10-02T11:14:39.029232900Z", "stored")}

    async def get_secret(name):
        return vault[name]

    async def set_secret(name, value):
        vault[name] = value

    monkeypatch.setattr(app, "_key_vault_secret", get_secret)
    monkeypatch.setattr(app, "_set_key_vault_secret", set_secret)

    assert asyncio.run(app._store_codex_login_if_newer(_login("2026-10-01T00:00:00Z", "older"))) is False
    assert asyncio.run(app._store_codex_login_if_newer(_login("2026-10-02T11:14:39.029232900Z", "same"))) is False
    assert json.loads(vault["codex-login"])["tokens"]["refresh_token"] == "stored"
    assert asyncio.run(app._store_codex_login_if_newer(_login("2026-10-03T08:00:00Z", "newer"))) is True
    assert json.loads(vault["codex-login"])["tokens"]["refresh_token"] == "newer"


def test_renew_codex_login_renews_writes_back_and_cleans_up(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    vault = {"codex-login": _login("2026-10-02T11:14:39.029232900Z", "old")}

    async def get_secret(name):
        return vault[name]

    async def set_secret(name, value):
        vault[name] = value

    monkeypatch.setattr(app, "_key_vault_secret", get_secret)
    monkeypatch.setattr(app, "_set_key_vault_secret", set_secret)
    fake_codex = tmp_path / "fake_codex.py"
    fake_codex.write_text(
        "import json, os, sys, datetime\n"
        "path = os.path.join(os.environ['CODEX_HOME'], 'auth.json')\n"
        "doc = json.load(open(path))\n"
        "assert doc['last_refresh'] < '2026-10-01', 'renewal must start from a stale copy'\n"
        "assert doc['tokens']['access_token'] == 'jarvis-renew-required'\n"
        "now = datetime.datetime.now(datetime.timezone.utc)\n"
        "doc['tokens']['access_token'] = 'e30.' + __import__('base64').urlsafe_b64encode(json.dumps({'exp': int(now.timestamp()) + 864000}).encode()).decode().rstrip('=') + '.sig'\n"
        "doc['last_refresh'] = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ')\n"
        "doc['tokens']['refresh_token'] = 'SECRET-RENEWED-TOKEN'\n"
        "json.dump(doc, open(path, 'w'))\n"
        "print('OK')\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(app, "_codex_renew_command", lambda: [sys.executable, str(fake_codex)])

    fresh = asyncio.run(app._renew_codex_login("s", min_days_left=3))
    assert fresh["renewed"] is False and fresh["reason"] == "fresh"

    result = asyncio.run(app._renew_codex_login("s", min_days_left=3, force=True))
    assert result["renewed"] is True, result
    assert result["stored"] is True
    assert result["reply_ok"] is True
    assert json.loads(vault["codex-login"])["tokens"]["refresh_token"] == "SECRET-RENEWED-TOKEN"
    assert not (tmp_path / "s" / ".codex" / "auth.json").exists()
    assert "SECRET-RENEWED-TOKEN" not in json.dumps(result)


def test_key_vault_probe_failure_never_exposes_provider_details(monkeypatch):
    async def denied(agent):
        raise RuntimeError("SECRET credential provider detail")

    monkeypatch.setattr(app, "_credentials_for", denied)
    request = Request({"type": "http", "method": "POST", "headers": [], "path": "/invocations",
                       "state": {"session_id": "s", "invocation_id": "i"}})

    async def body():
        return {"agent": "copilot", "probe": "key-vault"}

    request.json = body
    response = asyncio.run(app.invoke(request))
    assert response.status_code == 503
    assert json.loads(response.body) == {"key_vault_access": False, "session_id": "s"}


def test_client_redacts_credential_values_in_nested_output(tmp_path):
    client = app.ACPClient(["unused"], tmp_path, app.TaskState("i", "s", "copilot", "task"),
                           {"GH_TOKEN": "PRIVATE-github", "COPILOT_GITHUB_TOKEN": "PRIVATE-copilot"})
    assert client._redact({"content": ["token=PRIVATE-github", {"text": "PRIVATE-copilot"}]}) == {
        "content": ["token=[redacted]", {"text": "[redacted]"}]}


def test_failed_acp_initialize_stops_the_spawned_process(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "session_clients", {})
    monkeypatch.setattr(app, "session_locks", {})
    fixture = tmp_path / "failed_initialize.py"
    fixture.write_text(
        "import json, sys\n"
        "for line in sys.stdin:\n"
        "    message = json.loads(line)\n"
        "    print(json.dumps({'jsonrpc': '2.0', 'id': message['id'],"
        " 'error': {'code': -32603, 'message': 'initialization failed'}}), flush=True)\n"
    )

    async def credentials(agent):
        return {"github_token": "not-a-real-token", "copilot_token": "not-a-real-seat-token"}

    monkeypatch.setattr(app, "_credentials_for", credentials)
    monkeypatch.setattr(app, "_agent_command", lambda agent: [sys.executable, str(fixture)])
    state = app.TaskState("failed-init", "s", "copilot", "task")

    async def exercise():
        try:
            await app._run_task(state)
            assert state.status == "failed"
            assert state.process is not None and state.process.returncode is not None
            assert app.session_clients == {}
        finally:
            # Preserve test isolation even if a future regression leaks the fixture.
            if state.process is not None and state.process.returncode is None:
                state.process.kill()
                await state.process.wait()

    asyncio.run(exercise())


def test_cancel_during_credential_fetch_never_starts_provider(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "session_clients", {})
    monkeypatch.setattr(app, "session_locks", {})
    state = app.TaskState("cancel-fetch", "s", "copilot", "task")
    monkeypatch.setattr(app, "tasks", {state.invocation_id: state})
    provider_started = []
    monkeypatch.setattr(app, "_agent_command", lambda agent: provider_started.append(agent))

    async def exercise():
        fetching = asyncio.Event()
        never_finish = asyncio.Event()

        async def credentials(agent):
            fetching.set()
            await never_finish.wait()
            return {"github_token": "not-a-real-token", "copilot_token": "not-a-real-seat-token"}

        monkeypatch.setattr(app, "_credentials_for", credentials)
        state.worker = asyncio.create_task(app._run_task(state))
        await fetching.wait()
        request = Request({"type": "http", "method": "POST", "headers": [], "path": "/invocations",
                           "state": {"invocation_id": state.invocation_id}})
        response = await app.cancel_invocation(request)
        assert json.loads(response.body)["status"] == "cancelled"
        assert state.worker.done()
        assert state.status == "cancelled"
        assert provider_started == []
        assert app.session_clients == {}

    asyncio.run(exercise())


def test_cancel_queued_turn_prevents_work_after_session_lock(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "session_clients", {})
    state = app.TaskState("cancel-queued", "s", "copilot", "task")
    monkeypatch.setattr(app, "tasks", {state.invocation_id: state})
    provider_started = []
    monkeypatch.setattr(app, "_agent_command", lambda agent: provider_started.append(agent))

    async def exercise():
        lock = asyncio.Lock()
        monkeypatch.setattr(app, "session_locks", {"s": lock})
        async with lock:
            state.worker = asyncio.create_task(app._run_task(state))
            await asyncio.sleep(0)
            request = Request({"type": "http", "method": "POST", "headers": [], "path": "/invocations",
                               "state": {"invocation_id": state.invocation_id}})
            response = await app.cancel_invocation(request)
            assert json.loads(response.body)["status"] == "cancelled"
        assert state.status == "cancelled"
        assert provider_started == []

    asyncio.run(exercise())


def test_next_turn_waits_for_provider_cleanup(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "session_clients", {})
    monkeypatch.setattr(app, "session_locks", {})

    async def exercise():
        cleaning = asyncio.Event()
        release_cleanup = asyncio.Event()
        started = []

        class Client:
            def __init__(self, command, cwd, state, env, persisted_session_id=None):
                self.state = state

            async def start(self):
                started.append(self.state.invocation_id)

            async def run(self, prompt):
                return {"response": {"stopReason": "end_turn"}}

            async def stop(self):
                if self.state.invocation_id == "first":
                    cleaning.set()
                    await release_cleanup.wait()

        async def credentials(agent):
            return {"github_token": "not-a-real-token", "copilot_token": "not-a-real-seat-token"}

        monkeypatch.setattr(app, "ACPClient", Client)
        monkeypatch.setattr(app, "_credentials_for", credentials)
        first = asyncio.create_task(app._run_task(app.TaskState("first", "s", "copilot", "task")))
        await cleaning.wait()
        second = asyncio.create_task(app._run_task(app.TaskState("second", "s", "copilot", "task")))
        await asyncio.sleep(0)
        assert started == ["first"]
        release_cleanup.set()
        await asyncio.gather(first, second)
        assert started == ["first", "second"]
        assert app.session_clients == {}

    asyncio.run(exercise())


def test_every_invocation_reloads_after_session_idle_recreation(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    first = app.TaskState("first-turn", "shared-session", "copilot", "private prompt",
                          status="completed", started_at=100, finished_at=110)
    second = app.TaskState("second-turn", "shared-session", "copilot", "private correction",
                           status="interrupted", started_at=120, finished_at=130)
    app._persist_task(first)
    app._persist_task(second)
    monkeypatch.setattr(app, "tasks", {})

    async def poll():
        for state in (first, second):
            request = Request({"type": "http", "method": "GET", "headers": [], "path": "/invocations",
                               "state": {"invocation_id": state.invocation_id}})
            response = await app.get_invocation(request)
            assert response.status_code == 200
            payload = json.loads(response.body)
            assert payload["invocation_id"] == state.invocation_id
            assert payload["session_id"] == state.session_id
            assert payload["status"] == state.status
            assert payload["started_at"] == state.started_at
            assert payload["finished_at"] == state.finished_at

    asyncio.run(poll())
    saved_files = list((tmp_path / "shared-session" / "invocations").glob("*.json"))
    assert len(saved_files) == 2
    assert all("private" not in path.read_text() for path in saved_files)
    if os.name != "nt":
        assert all(path.stat().st_mode & 0o777 == 0o600 for path in saved_files)


def test_task_rehydration_reads_legacy_metadata_without_overriding_new_record(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    legacy = {"invocation_id": "old-turn", "session_id": "s", "agent": "copilot", "status": "paused",
              "started_at": 10, "finished_at": 20}
    app._write_json(tmp_path / "s" / "task-state.json", legacy)
    loaded = app._load_task("old-turn")
    assert loaded is not None and loaded.status == "paused"
    loaded.status = "completed"
    app._persist_task(loaded)
    assert app._load_task("old-turn").status == "completed"


def test_untrusted_invocation_identifier_cannot_escape_metadata_directory(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    state = app.TaskState("../../outside/turn", "s", "copilot", "private prompt", status="completed")
    app._persist_task(state)
    saved_files = list(tmp_path.rglob("*.json"))
    assert len(saved_files) == 1
    assert saved_files[0].parent == tmp_path / "s" / "invocations"
    assert len(saved_files[0].stem) == 64
    assert app._load_task(state.invocation_id).status == "completed"
