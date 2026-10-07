import asyncio
from io import BytesIO
import json
import os
import shlex
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

import app
from starlette.requests import Request


def encoded_image(format_name="PNG"):
    output = BytesIO()
    Image.new("RGB", (2, 2), color=(20, 40, 60)).save(output, format=format_name)
    return output.getvalue()


def test_required_string_rejects_missing_and_blank():
    with pytest.raises(ValueError):
        app._required_string({}, "task")
    with pytest.raises(ValueError):
        app._required_string({"task": " "}, "task")


@pytest.mark.parametrize(("format_name", "content_type"), [
    ("PNG", "image/png"),
    ("JPEG", "image/jpeg"),
])
def test_generated_image_validation_decodes_only_bounded_png_and_jpeg(format_name, content_type):
    image = encoded_image(format_name)
    assert app._validate_generated_image(image) == content_type
    with pytest.raises(ValueError):
        app._validate_generated_image(image[:-5])
    with pytest.raises(ValueError):
        app._validate_generated_image(b"not an image")
    with pytest.raises(ValueError):
        app._validate_generated_image(b"x" * (app.MAX_GENERATED_IMAGE_BYTES + 1))


def test_codex_tool_runs_without_repository_and_uploads_only_validated_image(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path / "runner-state")
    monkeypatch.setenv("JARVIS_BACKEND_URL", "https://backend.example")
    monkeypatch.setenv("JARVIS_API_SCOPE", "api://00000000-0000-4000-8000-000000000000/.default")
    image = encoded_image()
    captured = {}
    artifact_id = "8b92c4e7-48a4-4c8f-8df1-ef699d2c05d9"

    class Input:
        def write(self, value):
            captured["prompt"] = value.decode("utf-8")

        async def drain(self):
            pass

        def close(self):
            pass

    class Process:
        returncode = 0

        def __init__(self):
            self.stdin = Input()
            self.stdout = asyncio.StreamReader()
            self.stderr = asyncio.StreamReader()
            self.stdout.feed_eof()
            self.stderr.feed_eof()

        async def wait(self):
            return self.returncode

        def kill(self):
            self.returncode = -9
            self.stdout.feed_eof()
            self.stderr.feed_eof()

    class Publisher:
        async def upload_image(self, key, content_type, value):
            captured["upload"] = (key, content_type, value)
            return artifact_id

        async def close(self):
            captured["closed"] = True

    async def create_process(*args, **kwargs):
        captured["command"] = args
        captured["cwd"] = Path(kwargs["cwd"])
        captured["codex_home"] = Path(kwargs["env"]["CODEX_HOME"])
        assert not list(captured["cwd"].iterdir())
        auth_file = captured["codex_home"] / "auth.json"
        assert auth_file.stat().st_mode & 0o777 == 0o600
        (captured["cwd"] / "generated-image.png").write_bytes(image)
        return Process()

    async def credentials(agent, *, include_github_token=True):
        assert agent == "codex"
        assert not include_github_token
        return {"codex_login": '{"tokens":{"access_token":"fixture"}}'}

    publisher = Publisher()
    monkeypatch.setattr(app, "RunnerEventPublisher", lambda *_args: publisher)
    monkeypatch.setattr(app, "_credentials_for", credentials)
    monkeypatch.setattr(app.asyncio, "create_subprocess_exec", create_process)
    prompt = "A quiet sea at sunrise"
    upload_key = "a" * 43
    state = app.TaskState("image-invocation", "image-session", "codex", "", mode="codex-tool", model="gpt-5.5")

    asyncio.run(app._run_codex_image_tool(state, prompt, upload_key))

    assert state.status == "completed"
    assert state.result == {
        "artifact_id": artifact_id, "content_type": "image/png", "size_bytes": len(image),
    }
    assert captured["command"][:7] == (
        "codex", "exec", "--skip-git-repo-check", "-s", "workspace-write", "--model", "gpt-5.5",
    )
    assert captured["command"][-1] == "-"
    assert json.dumps(prompt) in captured["prompt"]
    assert captured["upload"] == (upload_key, "image/png", image)
    assert captured["closed"] is True
    assert not captured["cwd"].exists()
    saved = app._task_state_path(state.session_id, state.invocation_id).read_text()
    assert prompt not in saved
    assert upload_key not in saved
    assert state.result["artifact_id"] in saved


def test_codex_tool_reports_usage_limit_without_upload(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setenv("JARVIS_BACKEND_URL", "https://backend.example")
    monkeypatch.setenv("JARVIS_API_SCOPE", "api://00000000-0000-4000-8000-000000000000/.default")
    uploads = []

    class Stream:
        def __init__(self, value=b""):
            self.reader = asyncio.StreamReader()
            if value:
                self.reader.feed_data(value)
            self.reader.feed_eof()

        async def read(self, size=-1):
            return await self.reader.read(size)

    class Process:
        def __init__(self):
            self.returncode = 1
            self.stdin = SimpleNamespace(
                write=lambda _value: None,
                drain=lambda: asyncio.sleep(0),
                close=lambda: None,
            )
            self.stdout = Stream()
            self.stderr = Stream(b"Codex usage limit reached")

        async def wait(self):
            return self.returncode

        def kill(self):
            self.returncode = -9

    class Publisher:
        async def upload_image(self, *_args):
            uploads.append(True)

        async def close(self):
            pass

    async def credentials(_agent, *, include_github_token=True):
        return {"codex_login": "{}"}

    async def create_process(*_args, **_kwargs):
        return Process()

    monkeypatch.setattr(app, "RunnerEventPublisher", lambda *_args: Publisher())
    monkeypatch.setattr(app, "_credentials_for", credentials)
    monkeypatch.setattr(app.asyncio, "create_subprocess_exec", create_process)
    state = app.TaskState("usage-limit", "session", "codex", "", mode="codex-tool")

    asyncio.run(app._run_codex_image_tool(state, "draw something", "b" * 43))

    assert state.status == "failed"
    assert state.error == "Codex usage limit reached"
    assert uploads == []


def test_codex_tool_cancellation_terminates_process_and_cleans_workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path / "state")
    monkeypatch.setenv("JARVIS_BACKEND_URL", "https://backend.example")
    monkeypatch.setenv("JARVIS_API_SCOPE", "api://00000000-0000-4000-8000-000000000000/.default")
    running = asyncio.Event()
    captured = {}

    class Input:
        def write(self, _value):
            pass

        async def drain(self):
            pass

        def close(self):
            pass

    class Process:
        returncode = None

        def __init__(self):
            self.stdin = Input()
            self.stdout = asyncio.StreamReader()
            self.stderr = asyncio.StreamReader()

        async def wait(self):
            running.set()
            while self.returncode is None:
                await asyncio.sleep(0.001)
            return self.returncode

        def kill(self):
            self.returncode = -9
            self.stdout.feed_eof()
            self.stderr.feed_eof()

    class Publisher:
        async def upload_image(self, *_args):
            pytest.fail("Cancelled generation must not upload an artifact")

        async def close(self):
            pass

    async def credentials(_agent, *, include_github_token=True):
        return {"codex_login": "{}"}

    async def create_process(*_args, **kwargs):
        captured["cwd"] = Path(kwargs["cwd"])
        return Process()

    async def cancel():
        task = asyncio.create_task(app._run_codex_image_tool(
            app.TaskState("cancelled-image", "session", "codex", "", mode="codex-tool"),
            "draw something",
            "c" * 43,
        ))
        await running.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        return task

    monkeypatch.setattr(app, "RunnerEventPublisher", lambda *_args: Publisher())
    monkeypatch.setattr(app, "_credentials_for", credentials)
    monkeypatch.setattr(app.asyncio, "create_subprocess_exec", create_process)
    task = asyncio.run(cancel())

    assert task.cancelled()
    assert captured["cwd"] is not None
    assert not captured["cwd"].exists()


def test_needs_attention_marker_is_bounded_and_requires_a_question():
    question = "Which license should this project use?"
    text = f"Working\n{app.NEEDS_ATTENTION_MARKER} {question}\n"
    assert app._needs_attention_question(text) == question
    assert app._needs_attention_question(f"{app.NEEDS_ATTENTION_MARKER} ") is None
    assert app._needs_attention_question("The task is complete.") is None
    assert app._needs_attention_question(f"{app.NEEDS_ATTENTION_MARKER} {'x' * 700}") == "x" * 500


def test_runner_reports_agent_question_as_needs_attention(tmp_path, monkeypatch, local_workspace):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "session_clients", {})
    monkeypatch.setattr(app, "session_locks", {})
    monkeypatch.setenv("JARVIS_DISK_LOW_THRESHOLD_BYTES", "1000")
    monkeypatch.setattr(app, "_disk_snapshot", lambda: {
        "disk_total_bytes": 10_000,
        "disk_used_bytes": 1_000,
        "disk_free_bytes": 9_000,
    })
    monkeypatch.setenv("JARVIS_BACKEND_URL", "https://backend.example")
    monkeypatch.setenv("JARVIS_API_SCOPE", "api://00000000-0000-4000-8000-000000000000/.default")
    question = "Which license should this project use?"

    class Publisher:
        def __init__(self, *_args):
            self.events = []

        async def publish(self, _task_id, _invocation_id, _event_index, event):
            self.events.append((event["kind"], event["data"]))

        async def close(self):
            pass

    class Client:
        def __init__(self, _command, _cwd, _state, _env, persisted_session_id=None):
            pass

        async def start(self):
            pass

        async def run(self, _task):
            return {"jarvis_needs_attention": question}

        async def stop(self):
            pass

    async def credentials(_agent):
        return {"github_token": "not-a-real-token", "copilot_token": "not-a-real-seat-token"}

    publisher = Publisher()
    monkeypatch.setattr(app, "RunnerEventPublisher", lambda *_args: publisher)
    monkeypatch.setattr(app, "ACPClient", Client)
    monkeypatch.setattr(app, "_credentials_for", credentials)
    state = app.TaskState("attention", "session", "copilot", "scaffold", task_id="42")

    asyncio.run(app._run_task(state))

    assert state.status == "needs_attention"
    assert state.error == question
    assert ("needs_attention", {"question": question}) in publisher.events
    assert not any(kind == "completed" for kind, _data in publisher.events)


def test_assistant_text_chunks_are_extracted_only_from_text_messages():
    assert app._assistant_message_chunk({
        "method": "session/update",
        "params": {
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": "JARVIS_NEEDS_ATTENTION: "},
            },
        },
    }) == "JARVIS_NEEDS_ATTENTION: "
    assert app._assistant_message_chunk({
        "method": "session/update",
        "params": {"update": {"sessionUpdate": "tool_call", "content": {"type": "text", "text": "ignored"}}},
    }) is None


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


def test_agent_command_passes_copilot_model_and_reasoning_without_changing_codex_command():
    assert app._agent_command("copilot") == ["copilot", "--acp", "--stdio", "--allow-all"]
    assert app._agent_command("copilot", "gpt-5.4", "none") == [
        "copilot", "--acp", "--stdio", "--allow-all", "--model", "gpt-5.4",
    ]
    assert app._agent_command("copilot", "gpt-5.4") == [
        "copilot", "--acp", "--stdio", "--allow-all", "--model", "gpt-5.4",
    ]
    assert app._agent_command("copilot", "gpt-5.4", "high") == [
        "copilot", "--acp", "--stdio", "--allow-all", "--model", "gpt-5.4",
        "--reasoning-effort", "high",
    ]
    assert app._agent_command("codex") == ["codex-acp"]


def test_dockerfile_does_not_contain_secret_names():
    dockerfile = Path(__file__).parents[1].joinpath("Dockerfile").read_text()
    assert "COPILOT_GITHUB_TOKEN" not in dockerfile
    assert "auth.json" not in dockerfile
    assert "jarvis-github" not in dockerfile


def test_state_event_is_bounded(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    state = app.TaskState("i", "s", "copilot", "task")
    for number in range(app.MAX_EVENTS + 10):
        state.event("test", number=number)
    assert len(state.events) == app.MAX_EVENTS
    assert state.events[-1]["data"]["number"] == app.MAX_EVENTS + 9
    assert app._task_state_path("s", "i").exists()


def test_disk_low_threshold_is_configurable(monkeypatch):
    monkeypatch.delenv("JARVIS_DISK_LOW_THRESHOLD_BYTES", raising=False)
    assert app._disk_low_threshold_bytes() == 1024**3
    monkeypatch.setenv("JARVIS_DISK_LOW_THRESHOLD_BYTES", "2048")
    assert app._disk_low_threshold_bytes() == 2048
    monkeypatch.setenv("JARVIS_DISK_LOW_THRESHOLD_BYTES", "0")
    with pytest.raises(RuntimeError, match="positive integer"):
        app._disk_low_threshold_bytes()


def test_low_disk_emits_snapshot_and_stops_the_turn(tmp_path, monkeypatch, local_workspace):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "session_clients", {})
    monkeypatch.setattr(app, "session_locks", {})
    monkeypatch.setattr(app, "DISK_CHECK_INTERVAL_SECONDS", 0)
    monkeypatch.setenv("JARVIS_BACKEND_URL", "https://backend.example")
    monkeypatch.setenv("JARVIS_API_SCOPE", "api://00000000-0000-4000-8000-000000000000/.default")
    gib = 1024**3
    readings = iter([
        SimpleNamespace(total=6 * gib, used=4 * gib, free=2 * gib),
        SimpleNamespace(total=6 * gib, used=6 * gib - gib // 2, free=gib // 2),
    ])
    monkeypatch.setattr(
        app.shutil,
        "disk_usage",
        lambda _path: next(readings, SimpleNamespace(total=6 * gib, used=6 * gib - gib // 2, free=gib // 2)),
    )

    class Publisher:
        def __init__(self):
            self.events = []

        async def publish(self, _task_id, _invocation_id, _event_index, event):
            self.events.append((event["kind"], event["data"]))

        async def close(self):
            pass

    publisher = Publisher()

    class Client:
        def __init__(self, _command, _cwd, _state, _env, persisted_session_id=None):
            self.cancelled = asyncio.Event()

        async def start(self):
            pass

        async def run(self, _task):
            await self.cancelled.wait()
            return {}

        async def cancel_turn(self):
            self.cancelled.set()
            return True

        async def stop(self):
            pass

    async def credentials(_agent):
        return {"github_token": "not-a-real-token", "copilot_token": "not-a-real-seat-token"}

    monkeypatch.setattr(app, "RunnerEventPublisher", lambda *_args: publisher)
    monkeypatch.setattr(app, "ACPClient", Client)
    monkeypatch.setattr(app, "_credentials_for", credentials)
    state = app.TaskState("low-disk", "session", "copilot", "work", task_id="42")

    asyncio.run(app._run_task(state))

    assert state.status == "cancelled"
    events = dict(publisher.events)
    assert events["disk_snapshot"] == {
        "disk_total_bytes": 6 * gib,
        "disk_used_bytes": 4 * gib,
        "disk_free_bytes": 2 * gib,
        "threshold_bytes": gib,
    }
    assert events["disk_low"]["disk_free_bytes"] == gib // 2
    assert events["disk_low"]["threshold_bytes"] == gib
    assert "completed" not in dict(publisher.events)
    assert "failed" not in dict(publisher.events)


def test_task_events_are_pushed_in_order_with_task_and_invocation_identity(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    class Publisher:
        def __init__(self):
            self.events = []

        async def publish(self, task_id, invocation_id, event_index, event):
            self.events.append((task_id, invocation_id, event_index, event["kind"]))

        async def close(self):
            pass

    publisher = Publisher()
    state = app.TaskState("invocation", "session", "copilot", "work", task_id="42")
    state.event_publisher = publisher

    async def exercise():
        state.event("started", agent="copilot")
        state.event("agent_output", text="Updating tests")
        await app._flush_event_delivery(state)

    asyncio.run(exercise())
    assert publisher.events == [
        ("42", "invocation", 0, "started"),
        ("42", "invocation", 1, "agent_output"),
    ]


def test_steer_after_event_is_delivered_before_the_new_turn(tmp_path, monkeypatch, local_workspace):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "session_clients", {})
    monkeypatch.setattr(app, "session_locks", {})
    monkeypatch.setenv("JARVIS_BACKEND_URL", "https://backend.example")
    monkeypatch.setenv("JARVIS_API_SCOPE", "api://00000000-0000-4000-8000-000000000000/.default")

    class Publisher:
        def __init__(self, *_args):
            self.events = []

        async def publish(self, _task_id, _invocation_id, event_index, event):
            self.events.append((event_index, event["kind"], event["data"]))

        async def close(self):
            pass

    class Client:
        def __init__(self, *_args, **_kwargs):
            pass

        async def start(self):
            pass

        async def run(self, _task):
            return {"text": "done"}

        async def stop(self):
            pass

    async def credentials(_agent):
        return {"github_token": "token", "copilot_token": "token"}

    monkeypatch.setattr(app, "RunnerEventPublisher", Publisher)
    monkeypatch.setattr(app, "ACPClient", Client)
    monkeypatch.setattr(app, "_credentials_for", credentials)
    state = app.TaskState("invocation", "session", "copilot", "work", task_id="42")

    asyncio.run(app._run_task(state, stopped_invocation="previous", emit_steer_after=True))

    assert state.status == "completed"
    assert [(index, kind) for index, kind, _data in state.event_publisher.events[:2]] == [
        (0, "steer_after"),
        (1, "started"),
    ]
    assert state.event_publisher.events[0][2] == {"stopped_invocation": "previous"}


def test_event_delivery_failure_is_reported_in_runner_status(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    class Publisher:
        def __init__(self):
            self.calls = 0

        async def publish(self, *_args):
            self.calls += 1
            raise RuntimeError("network failure")

        async def close(self):
            pass

    state = app.TaskState("invocation", "session", "copilot", "work", task_id="42")
    publisher = Publisher()
    state.event_publisher = publisher

    async def exercise():
        state.event("started")
        state.event("completed")
        await app._flush_event_delivery(state)

    asyncio.run(exercise())
    assert publisher.calls == 2
    assert state.status == "failed"
    assert state.error == "Runner event delivery failed"


def test_runner_event_publisher_uses_identity_and_bounds_event_payload(monkeypatch):
    sent = []

    class Credential:
        def __init__(self, **options):
            self.options = options

        async def get_token(self, scope):
            assert scope == "api://00000000-0000-4000-8000-000000000000/.default"
            return type("Token", (), {"token": "fixture-token"})()

        async def close(self):
            pass

    class Response:
        def raise_for_status(self):
            pass

    class Client:
        def __init__(self, **options):
            assert options == {"timeout": 10, "follow_redirects": False}

        async def post(self, url, **options):
            sent.append((url, options))
            return Response()

        async def aclose(self):
            pass

    monkeypatch.setattr(app, "DefaultAzureCredential", Credential)
    monkeypatch.setattr(app.httpx, "AsyncClient", Client)
    publisher = app.RunnerEventPublisher(
        "https://backend.example",
        "api://00000000-0000-4000-8000-000000000000/.default",
    )

    async def exercise():
        await publisher.publish(
            "42",
            "invocation",
            3,
            {"at": 1.0, "kind": "agent_output", "data": {"text": "x" * (app.MAX_EVENT_PAYLOAD_BYTES + 1)}},
        )
        await publisher.publish(
            "42", "invocation", 4,
            {"at": 2.0, "kind": "session_question", "data": {
                "question": "Which behaviour do you want?",
                "result": {"response": {"usage": {"input_tokens": 123, "premium_requests": 1}}},
            }},
        )
        await publisher.close()

    asyncio.run(exercise())
    url, request_options = sent[0]
    assert url == "https://backend.example/factory/sandbox-events"
    assert request_options["headers"]["Authorization"] == " ".join(("Bearer", "fixture-token"))
    assert request_options["json"]["taskId"] == "42"
    assert request_options["json"]["type"] == "agent_output"
    assert len(request_options["json"]["summary"]) == 2000
    assert request_options["json"]["payload"] == {
        "invocationId": "invocation", "eventIndex": 3, "truncated": True,
    }
    assert sent[1][1]["json"]["summary"] == "Which behaviour do you want?"
    assert sent[1][1]["json"]["payload"]["data"]["question"] == "Which behaviour do you want?"
    assert sent[1][1]["json"]["payload"]["data"]["result"]["response"]["usage"] == {
        "input_tokens": 123, "premium_requests": 1,
    }


def test_session_and_task_metadata_are_persisted_without_prompt_or_result(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    state = app.TaskState("invocation", "foundry-session", "codex", "secret prompt", task_id="42")
    state.result = {"response": "secret result"}
    state.event("started")
    state.model = "gpt-5.4"
    state.reasoning = "high"
    app._persist_acp_session(state, "acp-session")

    task_metadata = json.loads(app._task_state_path("foundry-session", "invocation").read_text())
    acp_metadata = json.loads((tmp_path / "foundry-session" / app.ACP_SESSION_FILE).read_text())
    assert "secret prompt" not in json.dumps(task_metadata)
    assert "secret result" not in json.dumps(task_metadata)
    assert task_metadata["task_id"] == "42"
    assert acp_metadata["acp_session_id"] == "acp-session"
    assert app._load_acp_session("foundry-session", "codex") == {
        "acp_session_id": "acp-session", "model": "gpt-5.4", "reasoning": "high",
    }
    restored = app._load_task("invocation")
    assert restored is not None
    assert restored.session_id == "foundry-session"
    assert restored.task_id == "42"
    assert restored.task == ""


def test_codex_options_are_applied_and_confirmed_over_acp(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    state = app.TaskState("i", "s", "codex", "task", model="gpt-5.4", reasoning="high")
    client = app.ACPClient([], tmp_path, state, {})
    requests = []

    async def request(method, params):
        requests.append((method, params))
        if method == "session/new":
            return {"sessionId": "new-session"}
        if method == "session/set_config_option":
            return {"configOptions": [{"id": params["configId"], "currentValue": params["value"]}]}
        return {"stopReason": "end_turn"}

    client.request = request
    result = asyncio.run(client.run("task"))

    assert result["acp_session_id"] == "new-session"
    assert requests[1:3] == [
        ("session/set_config_option", {
            "sessionId": "new-session", "configId": "model", "value": "gpt-5.4",
        }),
        ("session/set_config_option", {
            "sessionId": "new-session", "configId": "reasoning_effort", "value": "high",
        }),
    ]
    assert requests[-1][0] == "session/prompt"
    assert state.events[-1]["kind"] == "agent_turn"
    assert state.events[-1]["data"] == {"agent": "codex"}


def test_codex_option_mismatch_fails_instead_of_reporting_success(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    state = app.TaskState("i", "s", "codex", "task", model="unsupported")
    client = app.ACPClient([], tmp_path, state, {})

    async def request(method, params):
        if method == "session/new":
            return {"sessionId": "new-session"}
        if method == "session/set_config_option":
            return {"configOptions": [{"id": "model", "currentValue": "default"}]}
        raise AssertionError(f"Unexpected ACP method {method}")

    client.request = request
    with pytest.raises(RuntimeError, match="did not apply"):
        asyncio.run(client.run("task"))


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({}, None),
        ({"model": "default"}, None),
        ({"model": "gpt-5.4"}, "gpt-5.4"),
    ],
)
def test_optional_model_config(payload, expected):
    assert app._optional_config(payload, "model", 100) == expected


@pytest.mark.parametrize(
    "payload",
    [
        {"model": " "},
        {"model": "--not-an-option"},
        {"model": "x" * 101},
        {"model": "gpt-5.4\n--allow-all"},
    ],
)
def test_optional_model_config_rejects_invalid_values(payload):
    with pytest.raises(ValueError):
        app._optional_config(payload, "model", 100)


@pytest.mark.parametrize(
    ("agent", "effort", "expected"),
    [
        ("codex", "xhigh", "xhigh"),
        ("copilot", "high", "high"),
        ("copilot", "none", "none"),
        ("copilot", "default", None),
    ],
)
def test_optional_reasoning_config(agent, effort, expected):
    assert app._optional_reasoning({"reasoning": effort}, agent) == expected


@pytest.mark.parametrize(("agent", "effort"), [("codex", "bogus"), ("copilot", "xhigh")])
def test_optional_reasoning_config_rejects_unsupported_choices(agent, effort):
    with pytest.raises(ValueError):
        app._optional_reasoning({"reasoning": effort}, agent)


@pytest.mark.parametrize(
    ("agent", "model", "reasoning"),
    [("codex", "gpt-5.4", "high"), ("copilot", "claude-sonnet-4.6", "high")],
)
def test_invoke_accepts_effective_provider_options(tmp_path, monkeypatch, agent, model, reasoning):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "tasks", {})
    monkeypatch.setattr(app, "tasks_lock", asyncio.Lock())
    monkeypatch.setattr(app.asyncio, "create_task", lambda coroutine: coroutine.close())
    payload = {
        "agent": agent, "task": "Work", "task_id": "42", "model": model, "reasoning": reasoning,
        "repository": "owner/project", "defaultBranch": "main", "branch": "jarvis/task-42",
    }
    body = json.dumps(payload).encode()

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/invocations",
            "headers": [(b"content-type", b"application/json")],
            "state": {"invocation_id": "inv", "session_id": "session"},
        },
        receive,
    )
    response = asyncio.run(app.invoke(request))

    assert response.status_code == 200
    assert app.tasks["inv"].model == model
    assert app.tasks["inv"].reasoning == reasoning
    assert app.tasks["inv"].task_id == "42"


def test_codex_tool_mode_validates_request_and_uses_codex_without_a_workspace(monkeypatch):
    async def run_tool(state, tool, query):
        state.status = "completed"
        calls.append((state, tool, query))

    calls = []
    monkeypatch.setattr(app, "tasks", {})
    monkeypatch.setattr(app, "_run_codex_tool", run_tool)
    payload = {
        "agent": "codex", "mode": "codex-tool", "tool": "web_research",
        "query": "latest public transport changes", "model": "gpt-5.5", "reasoning": "high",
    }
    request = Request({"type": "http", "method": "POST", "headers": [], "path": "/invocations",
                       "state": {"invocation_id": "research", "session_id": "fresh-session"}})
    async def body():
        return payload
    request.json = body  # type: ignore[method-assign]

    async def invoke():
        response = await app.invoke(request)
        await app.tasks["research"].worker
        return response

    response = asyncio.run(invoke())
    assert response.status_code == 200
    assert calls[0][0].mode == "codex-tool"
    assert calls[0][0].tool == "web_research"
    assert calls[0][0].model == "gpt-5.5"
    assert calls[0][0].reasoning == "high"
    assert calls[0][1:] == ("web_research", payload["query"])


def test_codex_html_report_mode_accepts_a_bounded_json_request(monkeypatch):
    async def run_tool(state, tool, query):
        state.status = "completed"
        calls.append((state, tool, query))

    calls = []
    query = json.dumps({"topic": "Example", "findings": [{"answer": "Evidence"}]})
    monkeypatch.setattr(app, "tasks", {})
    monkeypatch.setattr(app, "_run_codex_tool", run_tool)
    request = Request({"type": "http", "method": "POST", "headers": [], "path": "/invocations",
                       "state": {"invocation_id": "report", "session_id": "fresh-session"}})

    async def body():
        return {
            "agent": "codex", "mode": "codex-tool", "tool": "html_report",
            "query": query, "model": "gpt-5.5",
        }

    request.json = body  # type: ignore[method-assign]

    async def invoke():
        response = await app.invoke(request)
        await app.tasks["report"].worker
        return response

    response = asyncio.run(invoke())

    assert response.status_code == 200
    assert calls[0][0].tool == "html_report"
    assert calls[0][1:] == ("html_report", query)


@pytest.mark.parametrize(
    "payload",
    [
        {"agent": "copilot", "tool": "web_research", "query": "research"},
        {"agent": "codex", "tool": "shell", "query": "research"},
        {"agent": "codex", "tool": "web_research", "query": "x" * 2001},
        {"agent": "codex", "tool": "html_report", "query": "x" * (app.MAX_CODEX_REPORT_QUERY_LENGTH + 1)},
        {"agent": "codex", "tool": "web_research", "query": "research", "model": "gpt-6.1-sol"},
        {"agent": "codex", "tool": "web_research", "query": "research", "reasoning": "unsupported"},
    ],
)
def test_codex_tool_mode_rejects_unsupported_inputs(payload, monkeypatch):
    monkeypatch.setattr(app, "tasks", {})
    request = Request({"type": "http", "method": "POST", "headers": [], "path": "/invocations",
                       "state": {"invocation_id": "invalid", "session_id": "session"}})
    async def body():
        return {"mode": "codex-tool", **payload}
    request.json = body  # type: ignore[method-assign]

    response = asyncio.run(app.invoke(request))

    assert response.status_code == 400
    assert app.tasks == {}


def test_codex_tool_runs_in_a_deleted_empty_workspace_and_preserves_partial_sources(tmp_path, monkeypatch):
    state_root = tmp_path / "state"
    scratch_root = tmp_path / "scratch"
    scratch_root.mkdir()
    monkeypatch.setattr(app, "WORK_ROOT", state_root)
    monkeypatch.setattr(app.tempfile, "tempdir", str(scratch_root))
    result = {
        "answer": "The latest notice is from the agency. A second page was inaccessible.",
        "sources": [{"title": "Agency notice", "url": "https://agency.example/notice"}],
    }
    captured = {}

    class Process:
        returncode = 0

        def __init__(self):
            self.stdout = asyncio.StreamReader()
            self.stderr = asyncio.StreamReader()
            self.stdout.feed_eof()
            self.stderr.feed_eof()

        async def wait(self):
            return self.returncode

        def kill(self):
            self.returncode = -9
            self.stdout.feed_eof()
            self.stderr.feed_eof()

    async def credentials(agent, *, include_github_token=True):
        assert agent == "codex"
        assert include_github_token is False
        return {"codex_login": "test-login-only"}

    async def create_process(*args, **kwargs):
        captured["args"] = args
        captured["cwd"] = Path(kwargs["cwd"])
        captured["env"] = kwargs["env"]
        assert not (captured["cwd"] / ".git").exists()
        output_path = Path(args[args.index("--output-last-message") + 1])
        output_path.write_text(json.dumps(result), encoding="utf-8")
        return Process()

    monkeypatch.setattr(app, "_credentials_for", credentials)
    monkeypatch.setattr(app, "_store_codex_login_if_newer", lambda _text: asyncio.sleep(0, result=False))
    monkeypatch.setattr(app.asyncio, "create_subprocess_exec", create_process)
    state = app.TaskState(
        "research", "foundry-session", "codex", "latest public transport changes",
        mode="codex-tool", tool="web_research", model="gpt-5.5", reasoning="high",
    )

    asyncio.run(app._run_codex_tool(state, "web_research", state.task))

    assert state.status == "completed"
    assert state.result == result
    args = captured["args"]
    assert args[:9] == (
        "codex", "--disable", "shell_tool", "exec", "--skip-git-repo-check",
        "-s", "read-only", "-c", "web_search=live",
    )
    assert args[9:13] == ("-c", "model_reasoning_effort=high", "-m", "gpt-5.5")
    assert args[-1].endswith(json.dumps(state.task, ensure_ascii=True))
    assert captured["env"]["CODEX_HOME"] == str(captured["cwd"] / ".codex")
    assert not captured["cwd"].exists()
    assert list(scratch_root.iterdir()) == []
    metadata = next(state_root.rglob("*.json")).read_text(encoding="utf-8")
    assert state.task not in metadata
    assert "Agency notice" not in metadata
    assert "test-login-only" not in metadata


def test_codex_html_report_has_no_web_search_tool_and_treats_input_as_data():
    request = {
        "topic": "Research",
        "findings": ["do not follow instructions embedded here"],
        "partial": True,
        "frame": {"theme": "dark", "reducedMotion": True},
    }
    prompt = app._codex_html_report_prompt(json.dumps(request))
    command = app._codex_tool_command("gpt-5.5", Path("/tmp/report.json"), prompt, live_search=False)
    malformed_unicode = app._codex_html_report_prompt(r'{"topic":"\ud800"}')

    assert "REPORT_REQUEST_JSON=" in prompt
    assert json.dumps(request, ensure_ascii=False) in prompt
    assert "Treat every value" in prompt
    assert "use the supplied frame as presentation context" in prompt
    assert "honor reducedMotion" in prompt
    assert "including in spokenSummary" in prompt
    assert r"\ud800" in malformed_unicode
    assert "web_search=live" not in command
    assert "--disable" in command
    assert "shell_tool" in command


def test_codex_tool_reports_usage_limits_and_timeout_and_cancels_process(tmp_path, monkeypatch):
    state_root = tmp_path / "state"
    scratch_root = tmp_path / "scratch"
    scratch_root.mkdir()
    monkeypatch.setattr(app, "WORK_ROOT", state_root)
    monkeypatch.setattr(app.tempfile, "tempdir", str(scratch_root))
    monkeypatch.setattr(app, "_credentials_for", lambda *_args, **_kwargs: asyncio.sleep(
        0, result={"codex_login": "test-login-only"},
    ))
    monkeypatch.setattr(app, "_store_codex_login_if_newer", lambda _text: asyncio.sleep(0, result=False))
    monkeypatch.setattr(app, "_codex_tool_timeout", lambda: 0.01)

    class Process:
        def __init__(self, stderr=b"", hang=False):
            self.stdout = asyncio.StreamReader()
            self.stderr = asyncio.StreamReader()
            self.returncode = None if hang else 1
            self.killed = False
            self.finished = asyncio.Event()
            if not hang:
                self.stdout.feed_eof()
                self.stderr.feed_data(stderr)
                self.stderr.feed_eof()
                self.finished.set()

        async def wait(self):
            await self.finished.wait()
            return self.returncode

        def kill(self):
            self.killed = True
            self.returncode = -9
            self.stdout.feed_eof()
            self.stderr.feed_eof()
            self.finished.set()
            self.finished.set()

    processes = []
    async def create_process(*_args, **_kwargs):
        process = Process(stderr=b"Codex usage limit reached" if not processes else b"", hang=bool(processes))
        processes.append(process)
        return process
    monkeypatch.setattr(app.asyncio, "create_subprocess_exec", create_process)

    usage_limited = app.TaskState("limit", "session-1", "codex", "query", mode="codex-tool", tool="web_research")
    asyncio.run(app._run_codex_tool(usage_limited, "web_research", "query"))
    timed_out = app.TaskState("timeout", "session-2", "codex", "query", mode="codex-tool", tool="web_research")
    asyncio.run(app._run_codex_tool(timed_out, "web_research", "query"))

    assert usage_limited.status == "failed"
    assert usage_limited.error == "Codex usage limit reached"
    assert timed_out.status == "failed"
    assert timed_out.error == "Codex web research timed out"
    assert processes[1].killed
    assert list(scratch_root.iterdir()) == []


def test_codex_tool_cancellation_kills_child_and_removes_auth_file(tmp_path, monkeypatch):
    state_root = tmp_path / "state"
    scratch_root = tmp_path / "scratch"
    scratch_root.mkdir()
    monkeypatch.setattr(app, "WORK_ROOT", state_root)
    monkeypatch.setattr(app.tempfile, "tempdir", str(scratch_root))
    monkeypatch.setattr(app, "_credentials_for", lambda *_args, **_kwargs: asyncio.sleep(
        0, result={"codex_login": "test-login-only"},
    ))
    started = asyncio.Event()

    class Process:
        returncode = None

        def __init__(self):
            self.stdout = asyncio.StreamReader()
            self.stderr = asyncio.StreamReader()
            self.killed = False
            self.finished = asyncio.Event()

        async def wait(self):
            await self.finished.wait()
            return self.returncode

        def kill(self):
            self.killed = True
            self.returncode = -9
            self.stdout.feed_eof()
            self.stderr.feed_eof()
            self.finished.set()

    processes = []
    async def create_process(*_args, **_kwargs):
        process = Process()
        processes.append(process)
        started.set()
        return process
    monkeypatch.setattr(app.asyncio, "create_subprocess_exec", create_process)
    state = app.TaskState("cancel", "session", "codex", "query", mode="codex-tool", tool="web_research")

    async def cancel():
        worker = asyncio.create_task(app._run_codex_tool(state, "web_research", "query"))
        await started.wait()
        worker.cancel()
        with pytest.raises(asyncio.CancelledError):
            await worker

    asyncio.run(cancel())

    assert state.status == "cancelled"
    assert processes[0].killed
    assert list(scratch_root.iterdir()) == []


@pytest.mark.parametrize("task_id", [None, 0, "0", "9223372036854775808", "42 "])
def test_configured_live_events_require_valid_task_ids(tmp_path, monkeypatch, task_id):
    monkeypatch.setenv("JARVIS_BACKEND_URL", "https://backend.example")
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "tasks", {})
    payload = {"agent": "copilot", "task": "Work"}
    if task_id is not None:
        payload["task_id"] = task_id
    body = json.dumps(payload).encode()

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/invocations",
            "headers": [(b"content-type", b"application/json")],
            "state": {"invocation_id": "inv", "session_id": "session"},
        },
        receive,
    )
    response = asyncio.run(app.invoke(request))
    assert response.status_code == 400
    assert app.tasks == {}


def test_git_credential_helper_uses_process_environment(tmp_path):
    helper = app._credential_helper(tmp_path)
    content = helper.read_text()
    assert content.startswith("#!/bin/sh\nexec ")
    assert str(Path(app.__file__).with_name("git_credential_helper.py")) in content
    assert content.endswith(' "$@"\n')
    if os.name != "nt":
        assert helper.stat().st_mode & 0o777 == 0o700


def test_app_token_tasks_do_not_read_the_legacy_github_secret(monkeypatch):
    requested = []

    async def read_secret(name):
        requested.append(name)
        return f"not-a-real-{name}"

    monkeypatch.setattr(app, "_key_vault_secret", read_secret)
    credentials = asyncio.run(app._credentials_for("copilot", include_github_token=False))
    assert credentials == {"copilot_token": "not-a-real-jarvis-copilot"}
    assert requested == ["jarvis-copilot"]


def test_task_uses_an_app_token_and_configures_per_push_credentials(tmp_path, monkeypatch, local_workspace):
    work_root = tmp_path / "work root"
    monkeypatch.setattr(app, "WORK_ROOT", work_root)
    monkeypatch.setattr(app, "session_clients", {})
    monkeypatch.setattr(app, "session_locks", {})
    monkeypatch.setenv("JARVIS_BACKEND_URL", "https://backend.example")
    monkeypatch.setenv("JARVIS_API_SCOPE", "api://00000000-0000-4000-8000-000000000000/.default")
    monkeypatch.setenv("JARVIS_GITHUB_APP_TOKEN_ENABLED", "true")
    token_requests = []
    monkeypatch.setattr(
        app, "get_installation_token",
        lambda *args: (token_requests.append(args) or "ghs_app-token", "DanAakesen/jarvis-test-target"),
    )
    captured_env = {}

    class Publisher:
        async def publish(self, *_args):
            pass

        async def close(self):
            pass

    class Client:
        def __init__(self, _command, _cwd, _state, env, **_kwargs):
            captured_env.update(env)

        async def start(self):
            pass

        async def run(self, _task):
            return {"text": "done"}

        async def stop(self):
            pass

    async def credentials(agent, *, include_github_token=True):
        assert agent == "copilot"
        assert include_github_token is False
        return {"copilot_token": "not-a-real-seat-token"}

    monkeypatch.setattr(app, "RunnerEventPublisher", lambda *_args: Publisher())
    monkeypatch.setattr(app, "ACPClient", Client)
    monkeypatch.setattr(app, "_credentials_for", credentials)
    state = app.TaskState("app-token-task", "app-token-session", "copilot", "Work", task_id="42")

    asyncio.run(app._run_task(state))

    assert state.status == "completed"
    assert token_requests == [(
        "https://backend.example",
        "api://00000000-0000-4000-8000-000000000000/.default",
        "42",
        "app-token-session",
    )]
    assert captured_env["GH_TOKEN"] == "ghs_app-token"
    assert captured_env["GIT_CONFIG_COUNT"] == "2"
    assert captured_env["GIT_CONFIG_VALUE_0"] == (
        f"!{shlex.quote(str(work_root / 'app-token-session' / '.git-credential-helper'))}"
    )
    assert captured_env["GIT_CONFIG_KEY_1"] == "credential.useHttpPath"
    assert captured_env["GIT_CONFIG_VALUE_1"] == "true"
    assert captured_env["JARVIS_TASK_ID"] == "42"
    assert captured_env["JARVIS_SESSION_ID"] == "app-token-session"


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


@pytest.mark.parametrize(
    ("persisted_session_id", "prompt"),
    [
        (None, "new task"),
        ("persisted", "resumed task"),
        (None, "recovered task with history"),
    ],
    ids=["new", "resumed", "recovered"],
)
def test_delivery_instructions_are_added_to_every_agent_prompt(
    tmp_path, monkeypatch, persisted_session_id, prompt
):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    state = app.TaskState("i", "s", "copilot", prompt)
    client = app.ACPClient([], tmp_path, state, {}, persisted_session_id=persisted_session_id)
    requests = []

    async def request(method, params):
        requests.append((method, params))
        return {"sessionId": "new-session"} if method == "session/new" else {"stopReason": "end_turn"}

    monkeypatch.setattr(client, "request", request)

    result = asyncio.run(client.run(prompt))

    sent = next(params["prompt"][0]["text"] for method, params in requests if method == "session/prompt")
    assert result["response"]["stopReason"] == "end_turn"
    assert sent.startswith(app.TASK_DELIVERY_INSTRUCTIONS + "\n\n")
    assert prompt in sent
    assert "after each meaningful work step create a small commit and push it" in sent
    assert "Never force-push or push to main" in sent


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


def test_codex_renewal_invocation_returns_pollable_status(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    invocation_id = "renew-invocation"
    session_id = "renew-session"

    async def renew(session, min_days_left, force):
        assert (session, min_days_left, force) == (session_id, 3, False)
        return {"renewed": False, "reason": "fresh", "expires": "2030-01-01T00:00:00Z"}

    monkeypatch.setattr(app, "_renew_codex_login", renew)
    async def key_vault_details(name):
        assert name == app.COPILOT_TOKEN_SECRET
        return "hidden-token-value", "2030-01-01T00:00:00.000000Z", "2026-10-03T00:00:00.000000Z"

    monkeypatch.setattr(app, "_key_vault_secret_details", key_vault_details)

    async def exercise():
        body = json.dumps({"agent": "codex", "mode": "renew-codex", "min_days_left": 3}).encode()

        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}

        request = Request({"type": "http", "method": "POST", "headers": [], "path": "/invocations"}, receive)
        request.state.session_id = session_id
        request.state.invocation_id = invocation_id
        accepted = await app.invoke(request)
        await app.tasks[invocation_id].worker

        status_request = Request({"type": "http", "method": "GET", "headers": [], "path": "/invocations"})
        status_request.state.invocation_id = invocation_id
        status = await app.get_invocation(status_request)
        return json.loads(accepted.body), json.loads(status.body)

    try:
        accepted, status = asyncio.run(exercise())
        assert accepted == {
            "invocation_id": invocation_id,
            "session_id": session_id,
            "status": "queued",
            "agent": "codex",
            "mode": "renew-codex",
        }
        assert status["status"] == "completed"
        assert status["result"]["reason"] == "fresh"
        assert status["result"]["copilot"] == {
            "expires": "2030-01-01T00:00:00.000000Z",
            "last_renewed": "2026-10-03T00:00:00.000000Z",
        }
        assert status["error"] is None
    finally:
        app.tasks.pop(invocation_id, None)


def test_codex_renewal_survives_unavailable_copilot_metadata(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    state = app.TaskState(
        invocation_id="renew-without-copilot-metadata",
        session_id="renew-session",
        agent="codex",
        task="",
        mode="renew-codex",
    )

    async def renew(session, min_days_left, force):
        return {"renewed": False, "reason": "fresh", "expires": "2030-01-01T00:00:00Z"}

    async def unavailable(name):
        raise RuntimeError("Key Vault unavailable")

    monkeypatch.setattr(app, "_renew_codex_login", renew)
    monkeypatch.setattr(app, "_key_vault_secret_details", unavailable)

    asyncio.run(app._run_codex_renewal(state, min_days_left=3, force=False))

    assert state.status == "completed"
    assert state.result["reason"] == "fresh"
    assert "copilot" not in state.result


def test_renewal_status_persists_only_allowlisted_metadata(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    state = app.TaskState(
        invocation_id="renew-persisted",
        session_id="renew-session",
        agent="codex",
        task="",
        mode="renew-codex",
        status="completed",
        result={
            "renewed": True,
            "stored": True,
            "last_refresh_after": "2026-10-03T12:00:00.000000Z",
            "expires_after": "2026-10-13T12:00:00.000000Z",
            "refresh_token": "must-not-persist",
            "copilot": {
                "expires": "2026-11-01T00:00:00.000000Z",
                "last_renewed": "2026-10-01T00:00:00.000000Z",
                "secret": "must-not-persist-either",
            },
        },
    )

    app._persist_task(state)
    loaded = app._load_task("renew-persisted")

    assert loaded is not None
    assert loaded.result == {
        "renewed": True,
        "stored": True,
        "last_refresh_after": "2026-10-03T12:00:00.000000Z",
        "expires_after": "2026-10-13T12:00:00.000000Z",
        "copilot": {
            "expires": "2026-11-01T00:00:00.000000Z",
            "last_renewed": "2026-10-01T00:00:00.000000Z",
        },
    }
    state_path = app._task_state_path("renew-session", "renew-persisted")
    assert state_path.stat().st_mode & 0o777 == 0o600
    assert not state_path.with_suffix(".json.tmp").exists()
    assert "must-not-persist" not in state_path.read_text()
    assert "must-not-persist-either" not in state_path.read_text()


def test_codex_auth_file_is_private_when_written(tmp_path, monkeypatch):
    codex_home = tmp_path / ".codex"
    auth_path = codex_home / "auth.json"
    auth_text = '{"tokens":{"refresh_token":"fixture"}}'
    original_open = os.open
    modes = []

    def private_open(path, flags, mode=0o777):
        if Path(path) == auth_path:
            modes.append(mode)
        return original_open(path, flags, mode)

    monkeypatch.setattr(app.os, "open", private_open)
    app._write_codex_home(codex_home, auth_text)
    assert modes == [0o600]
    assert auth_path.read_text(encoding="utf-8") == auth_text
    assert auth_path.stat().st_mode & 0o777 == 0o600

    auth_path.chmod(0o644)
    app._write_codex_home(codex_home, auth_text)
    assert modes == [0o600, 0o600]
    assert auth_path.stat().st_mode & 0o777 == 0o600


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


def test_failed_acp_initialize_stops_the_spawned_process(tmp_path, monkeypatch, local_workspace):
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
    monkeypatch.setattr(app, "_agent_command", lambda agent, model=None, reasoning=None: [sys.executable, str(fixture)])
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


@pytest.mark.parametrize(
    ("codex_error_info", "expected_error", "expected_reason"),
    [
        ("usageLimitExceeded", "Codex usage limit reached", "codex_usage_limit"),
        ("serverOverloaded", "Runner task failed: RuntimeError", None),
    ],
)
def test_codex_usage_limit_failure_is_reported_distinctly(
    tmp_path, monkeypatch, local_workspace, codex_error_info, expected_error, expected_reason
):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "session_clients", {})
    monkeypatch.setattr(app, "session_locks", {})
    fixture = tmp_path / "codex_limit.py"
    fixture.write_text(
        "import json, sys\n"
        "for line in sys.stdin:\n"
        "    message = json.loads(line)\n"
        "    method = message.get('method')\n"
        "    if method == 'session/prompt':\n"
        "        reply = {'error': {'code': -32603, 'message': 'Internal error', 'data': {\n"
        "            'message': 'Provider limit text', 'codexErrorInfo': "
        f"{codex_error_info!r}"
        "}}}\n"
        "    elif method == 'session/new':\n"
        "        reply = {'result': {'sessionId': 'codex-session'}}\n"
        "    else:\n"
        "        reply = {'result': {}}\n"
        "    print(json.dumps({'jsonrpc': '2.0', 'id': message['id'], **reply}), flush=True)\n"
    )

    async def credentials(agent):
        assert agent == "codex"
        return {"github_token": "not-a-real-token", "codex_login": "{}"}

    monkeypatch.setattr(app, "_credentials_for", credentials)
    monkeypatch.setattr(app, "_agent_command", lambda agent, model=None, reasoning=None: [sys.executable, str(fixture)])
    state = app.TaskState("codex-limit", "s", "codex", "task")

    asyncio.run(app._run_task(state))

    assert state.status == "failed"
    assert state.error == expected_error
    failed = [event["data"] for event in state.events if event["kind"] == "failed"]
    assert failed[-1].get("reason") == expected_reason
    assert "Provider limit text" not in json.dumps(failed)


def test_cancel_during_credential_fetch_never_starts_provider(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "session_clients", {})
    monkeypatch.setattr(app, "session_locks", {})
    state = app.TaskState("cancel-fetch", "s", "copilot", "task")
    monkeypatch.setattr(app, "tasks", {state.invocation_id: state})
    provider_started = []
    monkeypatch.setattr(app, "_agent_command", lambda agent, model=None, reasoning=None: provider_started.append(agent))

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
    monkeypatch.setattr(app, "_agent_command", lambda agent, model=None, reasoning=None: provider_started.append(agent))

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


def test_next_turn_waits_for_provider_cleanup(tmp_path, monkeypatch, local_workspace):
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
