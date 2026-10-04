# Copyright (c) Microsoft. All rights reserved.

"""Tests for Foundry model configuration and stream handling."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from jarvis_tools import BackendToolClient, BackendUnavailable, current_message_id
from model_client import (
    AzureOpenAIResponsesClient,
    parse_max_output_tokens,
    responses_base_url,
)
from state import ModelMessage, ModelSettings


class FakeStream:
    def __init__(self, events: list[Any]) -> None:
        self._events = events
        self.exited = False

    async def __aenter__(self) -> "FakeStream":
        return self

    async def __aexit__(self, *args: Any) -> None:
        self.exited = True

    def __aiter__(self) -> AsyncIterator[Any]:
        async def iterate() -> AsyncIterator[Any]:
            for event in self._events:
                yield event

        return iterate()


class FakeItem(SimpleNamespace):
    def model_dump(self, **_: Any) -> dict[str, Any]:
        return dict(vars(self))


def completed(*output: Any) -> SimpleNamespace:
    usage = SimpleNamespace(
        input_tokens=100, output_tokens=20, input_tokens_details=SimpleNamespace(cached_tokens=0)
    )
    return SimpleNamespace(
        type="response.completed", response=SimpleNamespace(output=list(output), usage=usage)
    )


class FakeResponses:
    def __init__(self, rounds: list[list[Any]]) -> None:
        self.streams = [FakeStream(events) for events in rounds]
        self.requests: list[dict[str, Any]] = []

    @property
    def stream(self) -> FakeStream:
        return self.streams[0]

    @property
    def request(self) -> dict[str, Any] | None:
        return self.requests[0] if self.requests else None

    async def create(self, **kwargs: Any) -> FakeStream:
        self.requests.append({**kwargs, "input": list(kwargs["input"])})
        return self.streams[len(self.requests) - 1]


class FakeOpenAI:
    def __init__(
        self, events: list[Any], close_error: BaseException | None = None, rounds=None
    ) -> None:
        self.responses = FakeResponses(rounds if rounds is not None else [events])
        self.closed = False
        self.close_error = close_error

    async def close(self) -> None:
        self.closed = True
        if self.close_error is not None:
            raise self.close_error


class FakeCredential:
    def __init__(self) -> None:
        self.closed = False

    async def close(self) -> None:
        self.closed = True


CREATE_TASK = {
    "name": "create_task",
    "description": "Start a new coding task.",
    "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}},
}


class FakeBackend:
    """Answers the agent context, tool catalogue, and tool calls like the Jarvis backend."""

    def __init__(
        self,
        catalogue: list[dict[str, Any]] | None = None,
        status: int = 200,
        context: dict[str, Any] | None = None,
        context_status: int = 200,
    ) -> None:
        self.catalogue = [CREATE_TASK] if catalogue is None else catalogue
        self.status = status
        self.context_status = context_status
        self.context_snapshot = context or {"runningTasks": [], "truncated": False}
        self.requests: list[httpx.Request] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.method == "GET":
            if request.url.path == "/factory/context":
                return httpx.Response(
                    self.context_status,
                    json=self.context_snapshot
                    if self.context_status == 200
                    else {"error": "Unavailable"},
                )
            if self.status != 200:
                return httpx.Response(self.status, json={"error": "Forbidden"})
            return httpx.Response(200, json=self.catalogue)
        name = request.url.path.rsplit("/", 1)[-1]
        return httpx.Response(
            200, json={"tool": name, "outcome": "ok", "result": {"id": 7, "state": "Ready"}}
        )

    def tools(self) -> BackendToolClient:
        async def token() -> str:
            return "agent-token"

        return BackendToolClient(
            base_url="https://backend.example",
            token_provider=token,
            http=httpx.AsyncClient(transport=httpx.MockTransport(self.handle)),
        )


def client(
    events: list[Any], rounds=None, backend: FakeBackend | None = None
) -> tuple[AzureOpenAIResponsesClient, FakeOpenAI]:
    transport = FakeOpenAI(events, rounds=rounds)
    model = AzureOpenAIResponsesClient(
        client=transport,  # type: ignore[arg-type]
        credential=None,
        model_name="deployment",
        server_address="example.test",
        system_prompt="system",
        max_output_tokens=32,
        tools=(backend or FakeBackend()).tools(),
    )
    return model, transport

def test_builds_responses_base_url_from_project_endpoint() -> None:
    assert (
        responses_base_url("https://example.test/api/projects/demo")
        == "https://example.test/api/projects/demo/openai/v1/"
    )


@pytest.mark.parametrize(
    "value",
    [
        "http://example.test/api/projects/demo",
        "https://example.test/not-a-project",
        "https://user:secret@example.test/api/projects/demo",
        "https://example.test/api/projects/demo?secret=value",
        "https://example.test/prefix/api/projects/demo",
        "https://example.test/api/projects/demo/extra",
    ],
)
def test_rejects_invalid_project_endpoint(value: str) -> None:
    with pytest.raises(ValueError, match="FOUNDRY_PROJECT_ENDPOINT"):
        responses_base_url(value)


@pytest.mark.parametrize(
    ("value", "expected"),
    [(None, 512), ("", 512), ("1", 1), ("4096", 4096)],
)
def test_parses_output_tokens(value: str | None, expected: int) -> None:
    assert parse_max_output_tokens(value) == expected


@pytest.mark.asyncio
async def test_streams_text_and_disables_remote_storage() -> None:
    model, transport = client(
        [
            SimpleNamespace(type="response.output_text.delta", delta="Hello"),
            completed(),
            SimpleNamespace(type="response.output_text.delta", delta="late"),
        ]
    )

    chunks = [chunk async for chunk in model.complete([ModelMessage("user", "Question")])]

    assert chunks == ["Hello"]
    assert transport.responses.request is not None
    assert transport.responses.request["store"] is False
    assert transport.responses.stream.exited
    await model.close()
    assert transport.closed


@pytest.mark.asyncio
async def test_adds_running_tasks_and_recent_events_before_the_current_message() -> None:
    snapshot = {
        "runningTasks": [{
            "id": "42",
            "projectId": "7",
            "projectName": "Jarvis",
            "title": "Fix the bug",
            "agent": "codex",
            "state": "Running",
            "activity": "Updating tests",
            "startedAt": "2026-10-03T12:00:00.000Z",
            "recentEvents": [{
                "type": "progress",
                "summary": "Tests are being updated",
                "summaryTruncated": False,
                "source": "runner",
                "at": "2026-10-03T12:01:00.000Z",
            }],
        }],
        "truncated": False,
    }
    backend = FakeBackend(context=snapshot)
    model, transport = client(
        [SimpleNamespace(type="response.output_text.delta", delta="It is running."), completed()],
        backend=backend,
    )

    chunks = [chunk async for chunk in model.complete([
        ModelMessage("assistant", "Previous answer"),
        ModelMessage("user", "What is running?"),
    ])]

    assert chunks == ["It is running."]
    assert len(transport.responses.requests) == 1
    request_input = transport.responses.request["input"]
    context = json.loads(request_input[-2]["content"].split("\n", 1)[1])
    assert context == snapshot
    assert request_input[-1] == {"role": "user", "content": "What is running?"}
    assert [(request.method, request.url.path) for request in backend.requests] == [
        ("GET", "/tools"),
        ("GET", "/factory/context"),
    ]


@pytest.mark.asyncio
async def test_unavailable_context_fails_before_asking_the_model() -> None:
    backend = FakeBackend(context_status=503)
    model, transport = client([completed()], backend=backend)

    with pytest.raises(BackendUnavailable, match="turn context"):
        _ = [chunk async for chunk in model.complete([ModelMessage("user", "What is running?")])]

    assert transport.responses.requests == []


@pytest.mark.asyncio
@pytest.mark.parametrize("terminal", ["error", "response.failed", "response.incomplete"])
async def test_non_success_terminal_fails(terminal: str) -> None:
    model, _ = client(
        [
            SimpleNamespace(type="response.output_text.delta", delta="partial"),
            SimpleNamespace(type=terminal),
        ]
    )

    with pytest.raises(RuntimeError, match="did not complete"):
        _ = [chunk async for chunk in model.complete([ModelMessage("user", "private")])]


@pytest.mark.asyncio
async def test_close_attempts_credential_after_transport_failure() -> None:
    transport = FakeOpenAI([], close_error=RuntimeError("transport close failed"))
    credential = FakeCredential()
    model = AzureOpenAIResponsesClient(
        client=transport,  # type: ignore[arg-type]
        credential=credential,  # type: ignore[arg-type]
        model_name="deployment",
        server_address="example.test",
        system_prompt="system",
        max_output_tokens=32,
        tools=FakeBackend().tools(),
    )

    with pytest.raises(RuntimeError, match="transport close failed"):
        await model.close()

    assert transport.closed
    assert credential.closed

@pytest.mark.asyncio
async def test_tool_loop_calls_the_backend_tool_and_streams_answer() -> None:
    call = FakeItem(
        type="function_call",
        call_id="call_1",
        name="create_task",
        arguments='{"text": "Tilføj dark mode"}',
    )
    backend = FakeBackend()
    model, transport = client(
        [],
        rounds=[
            [completed(call)],
            [
                SimpleNamespace(type="response.output_text.delta", delta="Jeg har startet "),
                SimpleNamespace(type="response.output_text.delta", delta="opgaven."),
                completed(),
            ],
        ],
        backend=backend,
    )

    token = current_message_id.set("42")
    try:
        chunks = [chunk async for chunk in model.complete([ModelMessage("user", "Start")])]
    finally:
        current_message_id.reset(token)

    assert "".join(chunks) == "Jeg har startet opgaven."
    first, second = transport.responses.requests
    assert first["tools"] == [
        {
            "type": "function",
            "name": "create_task",
            "description": "Start a new coding task.",
            "parameters": CREATE_TASK["inputSchema"],
            "strict": False,
        }
    ]
    assert first["store"] is False
    outputs = [item for item in second["input"] if item.get("type") == "function_call_output"]
    assert len(outputs) == 1 and outputs[0]["call_id"] == "call_1"
    assert json.loads(outputs[0]["output"]) == {
        "tool": "create_task",
        "outcome": "ok",
        "result": {"id": 7, "state": "Ready"},
    }
    tools, context, post = backend.requests
    assert (tools.method, tools.url.path) == ("GET", "/tools")
    assert (context.method, context.url.path) == ("GET", "/factory/context")
    assert (post.method, post.url.path) == ("POST", "/tools/create_task")
    assert post.headers["x-jarvis-message-id"] == "42"
    assert json.loads(post.content) == {"text": "Tilføj dark mode"}
    await model.close()


@pytest.mark.asyncio
async def test_tool_call_without_a_stored_message_is_reported_as_not_done() -> None:
    call = FakeItem(type="function_call", call_id="call_1", name="create_task", arguments="{}")
    backend = FakeBackend()
    model, transport = client(
        [],
        rounds=[
            [completed(call)],
            [SimpleNamespace(type="response.output_text.delta", delta="Nej"), completed()],
        ],
        backend=backend,
    )

    _ = [chunk async for chunk in model.complete([ModelMessage("user", "Start")])]

    output = json.loads(transport.responses.requests[1]["input"][-1]["output"])
    assert output["outcome"] == "error" and "nothing was done" in output["error"]
    assert [request.url.path for request in backend.requests] == ["/tools", "/factory/context"]


@pytest.mark.asyncio
async def test_unavailable_catalogue_fails_before_asking_the_model() -> None:
    model, transport = client([completed()], backend=FakeBackend(status=403))

    with pytest.raises(BackendUnavailable):
        _ = [chunk async for chunk in model.complete([ModelMessage("user", "Hej")])]

    assert transport.responses.requests == []


@pytest.mark.asyncio
async def test_empty_catalogue_sends_no_tools() -> None:
    model, transport = client([completed()], backend=FakeBackend(catalogue=[]))

    _ = [chunk async for chunk in model.complete([ModelMessage("user", "Hej")])]

    assert "tools" not in transport.responses.request
    assert model.diagnostics() == "backend tools: catalogue=0, calls=0, last_error=none"


@pytest.mark.asyncio
async def test_reasoning_effort_requests_encrypted_reasoning() -> None:
    transport = FakeOpenAI([completed()])
    model = AzureOpenAIResponsesClient(
        client=transport,  # type: ignore[arg-type]
        credential=None,
        model_name="deployment",
        server_address="example.test",
        system_prompt="system",
        max_output_tokens=32,
        reasoning_effort="low",
        tools=FakeBackend().tools(),
    )

    _ = [chunk async for chunk in model.complete([ModelMessage("user", "Hej")])]

    request = transport.responses.request
    assert request is not None
    assert request["reasoning"] == {"effort": "low"}
    assert request["include"] == ["reasoning.encrypted_content"]


@pytest.mark.asyncio
async def test_model_requests_use_the_settings_captured_for_each_session() -> None:
    transport = FakeOpenAI([], rounds=[[completed()], [completed()]])
    model = AzureOpenAIResponsesClient(
        client=transport,  # type: ignore[arg-type]
        credential=None,
        model_name="deployment-default",
        server_address="example.test",
        system_prompt="system",
        max_output_tokens=32,
        tools=FakeBackend().tools(),
    )

    for settings in (
        ModelSettings("gpt-5.6-luna", "none"),
        ModelSettings("gpt-5.4-mini", "high"),
    ):
        _ = [
            chunk
            async for chunk in model.complete(
                [ModelMessage("user", "Hej")], settings=settings
            )
        ]

    first, second = transport.responses.requests
    assert first["model"] == "gpt-5.6-luna"
    assert "reasoning" not in first
    assert second["model"] == "gpt-5.4-mini"
    assert second["reasoning"] == {"effort": "high"}
    await model.close()
