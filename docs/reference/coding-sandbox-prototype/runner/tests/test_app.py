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
    assert (tmp_path / "s" / app.TASK_STATE_FILE).exists()


def test_session_and_task_metadata_are_persisted_without_prompt_or_result(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    state = app.TaskState("invocation", "foundry-session", "copilot", "secret prompt")
    state.result = {"response": "secret result"}
    state.event("started")
    app._persist_acp_session(state, "acp-session")

    task_metadata = json.loads((tmp_path / "foundry-session" / app.TASK_STATE_FILE).read_text())
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


def test_crash_test_is_guarded(monkeypatch):
    monkeypatch.delenv("JARVIS_ALLOW_CRASH_TEST", raising=False)
    request = Request({"type": "http", "method": "POST", "headers": [], "path": "/invocations"})
    request.state.session_id = "s"
    request.state.invocation_id = "inv"

    async def body():
        return {"mode": "crash-test"}

    request.json = body  # type: ignore[method-assign]
    response = asyncio.run(app.invoke(request))
    payload = json.loads(response.body)
    assert response.status_code == 403
    assert payload["error"] == "crash-test disabled"


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
