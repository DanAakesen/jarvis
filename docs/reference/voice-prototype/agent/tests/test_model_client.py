# Copyright (c) Microsoft. All rights reserved.

"""Tests for Foundry model configuration and stream handling."""

from __future__ import annotations

from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any

import pytest

from jarvis_tools import TOOL_SCHEMAS, FakeBackend, ToolLog
from model_client import (
    AzureOpenAIResponsesClient,
    parse_max_output_tokens,
    responses_base_url,
)
from state import ModelMessage


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


def client(events: list[Any], rounds=None) -> tuple[AzureOpenAIResponsesClient, FakeOpenAI]:
    transport = FakeOpenAI(events, rounds=rounds)
    model = AzureOpenAIResponsesClient(
        client=transport,  # type: ignore[arg-type]
        credential=None,
        model_name="deployment",
        server_address="example.test",
        system_prompt="system",
        max_output_tokens=32,
        tool_log=ToolLog(),
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
    )

    with pytest.raises(RuntimeError, match="transport close failed"):
        await model.close()

    assert transport.closed
    assert credential.closed

@pytest.mark.asyncio
async def test_tool_loop_executes_tool_and_streams_answer() -> None:
    call = FakeItem(
        type="function_call",
        call_id="call_1",
        name="create_task",
        arguments='{"project": "Jarvis", "agent": "codex", "text": "Tilføj dark mode"}',
    )
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
    )

    chunks = [chunk async for chunk in model.complete([ModelMessage("user", "Start en opgave")])]

    assert "".join(chunks) == "Jeg har startet opgaven."
    first, second = transport.responses.requests
    assert first["tools"] == TOOL_SCHEMAS
    assert first["store"] is False
    outputs = [item for item in second["input"] if item.get("type") == "function_call_output"]
    assert len(outputs) == 1 and outputs[0]["call_id"] == "call_1"
    assert '"T-104"' in outputs[0]["output"]
    tools = [entry for entry in model._log.entries if entry["kind"] == "tool"]
    assert tools[0]["name"] == "create_task"
    assert tools[0]["arguments"]["project"] == "Jarvis"
    assert [entry["round"] for entry in model._log.entries if entry["kind"] == "model"] == [1, 2]


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
        tool_log=ToolLog(),
    )

    _ = [chunk async for chunk in model.complete([ModelMessage("user", "Hej")])]

    request = transport.responses.request
    assert request is not None
    assert request["reasoning"] == {"effort": "low"}
    assert request["include"] == ["reasoning.encrypted_content"]


def test_fake_backend_state_changes() -> None:
    backend = FakeBackend()
    assert backend.execute("pause_task", {"task_id": "t-101"})["paused"]["state"] == "paused"
    assert backend.execute("resume_task", {"task_id": "T-101"})["resumed"]["state"] == "running"
    assert backend.execute("cancel_task", {"task_id": "T-103"}) == {"error": "task is done"}
    assert "error" in backend.execute("task_status", {"task_id": "T-999"})
    assert backend.execute("create_task", {"project": "Daily", "agent": "copilot", "text": "x"})[
        "created"
    ]["id"] == "T-104"