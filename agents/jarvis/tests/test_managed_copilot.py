"""Synthetic managed protocol fixtures; no provider or backend traffic."""
import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace as NS

import pytest

from managed_copilot import (
    AGENT_PREVIEW_HEADER,
    ManagedChatError,
    ManagedCopilotClient,
    ManagedTarget,
    ManagedTurnContext,
    agent_client_options,
)
from model_contract import AcknowledgmentBoundary
from state import ModelMessage, ModelSettings

SETTINGS = ModelSettings("ChatTerraHigh", "high")
TARGET = ManagedTarget("fixture-chat", SETTINGS.model, SETTINGS.reasoning_effort)


def completed(*calls):
    return NS(type="response.completed", response=NS(status="completed", output=list(calls)))


def call(identifier="call1", arguments='{"query":"fixture"}'):
    return NS(type="function_call", name="lookup", call_id=identifier, arguments=arguments)


def delta(text):
    return NS(type="response.output_text.delta", delta=text)


class Stream:
    def __init__(self, events):
        self.events, self.closed = events, False

    async def __aiter__(self):
        for event in self.events:
            if isinstance(event, BaseException):
                raise event
            yield event

    async def close(self):
        self.closed = True


class Fixture:
    conversation_id = None

    def __init__(self, rounds):
        self.rounds = [Stream(events) for events in rounds]
        self.requests, self.calls, self.claims, self.finishes = [], [], set(), []
        self.creates = 0
        self.client = NS(responses=NS(create=self.respond), conversations=NS(create=self.create),
                         max_retries=0)
        self.adapter = ManagedCopilotClient(
            client=self.client, backend=self, target=TARGET, bindings=self,
            context_provider=lambda: ManagedTurnContext("session", "42", "prepared identity"),
            settings_provider=self.settings,
        )

    async def settings(self):
        return SETTINGS

    async def create(self):
        self.creates += 1
        return NS(id="native-1")

    async def respond(self, **request):
        self.requests.append(request)
        return self.rounds[len(self.requests)-1]

    @asynccontextmanager
    async def lease(self, context, target):
        assert context.source_message_id == "42" and target == TARGET
        yield self

    async def bind(self, identifier):
        self.conversation_id = identifier

    async def claim_turn(self, source):
        if source in self.claims:
            return False
        self.claims.add(source)
        return True

    async def finish_turn(self, source, success):
        self.finishes.append((source, success))

    async def tools(self):
        return (NS(model_schema=lambda: {
            "type": "function", "name": "lookup", "strict": False,
            "parameters": {"type": "object", "properties": {}},
        }),)

    async def call(self, name, args, source):
        self.calls.append((name, args, source))
        return {"outcome": "ok", "fixture": True}

    async def run(self, **kwargs):
        return [chunk async for chunk in self.adapter.complete_chat(
            [ModelMessage("user", "fixture", source_message_id="42")], "en", **kwargs,
        )]


def test_agent_scoped_sdk_options():
    options = agent_client_options("https://fixture.ai.azure.com/api/projects/test", "fixture")
    assert options["base_url"].endswith("/agents/fixture/endpoint/protocols/openai")
    assert options["default_query"] == {"api-version": "v1"}
    assert options["default_headers"] == {"Foundry-Features": AGENT_PREVIEW_HEADER}
    assert options["max_retries"] == 0
    with pytest.raises(ManagedChatError):
        agent_client_options("http://fixture", "../agent")


@pytest.mark.asyncio
async def test_repeated_rounds_native_conversation_and_source_binding():
    f = Fixture([[delta("Checking."), completed(call())],
                 [completed(call("call2", '{"query":"next"}'))],
                 [delta("Done."), completed()]])
    assert await f.run() == ["Checking.", AcknowledgmentBoundary("Checking."), "Done."]
    assert f.creates == 1
    assert len(f.calls) == 2 and all(c[2] == "42" for c in f.calls)
    assert all(r["conversation"] == "native-1" for r in f.requests)
    assert f.requests[1]["input"][0]["type"] == "function_call_output"
    for request in f.requests:
        assert set(request) == {"conversation", "input", "instructions", "tools", "stream"}
        assert request["tools"][0]["strict"] is False
    assert all(s.closed for s in f.rounds)
    assert f.finishes == [("42", True)]
    with pytest.raises(ManagedChatError, match="already_claimed"):
        await f.run()
    assert len(f.calls) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("events", [
    [delta("Partial"), NS(type="response.failed")],
    [NS(type="response.incomplete")], [delta("Partial")],
    [NS(type="error", message="PRIVATE_ERROR")], [completed()],
    [ValueError("PRIVATE_ERROR")],
])
async def test_partial_failed_and_transport_errors_never_report_success(events):
    f = Fixture([events])
    with pytest.raises(ManagedChatError) as error:
        await f.run()
    assert "PRIVATE_ERROR" not in str(error.value)
    assert f.finishes == [("42", False)]
    assert f.rounds[0].closed
    assert not f.calls


@pytest.mark.asyncio
async def test_cancelled_stream_is_closed_and_turn_cannot_be_replayed():
    f = Fixture([[delta("Partial"), asyncio.CancelledError()]])
    with pytest.raises(asyncio.CancelledError):
        await f.run()
    assert f.rounds[0].closed and f.finishes == [("42", False)]
    with pytest.raises(ManagedChatError, match="already_claimed"):
        await f.run()


@pytest.mark.asyncio
async def test_duplicate_action_rejected_without_reexecution():
    f = Fixture([[completed(call())], [completed(call("different-call-id"))]])
    with pytest.raises(ManagedChatError, match="tool_repeated"):
        await f.run()
    assert len(f.calls) == 1
    assert f.finishes == [("42", False)]


@pytest.mark.asyncio
async def test_settings_and_source_rejected_before_inference():
    f = Fixture([])
    with pytest.raises(ManagedChatError, match="settings_mismatch"):
        await f.run(settings=ModelSettings("other", "none"))
    with pytest.raises(ManagedChatError, match="source_context_missing"):
        _ = [c async for c in f.adapter.complete_chat([ModelMessage("user", "fixture")], "en")]
    assert not f.requests and not f.claims and not f.creates


@pytest.mark.asyncio
async def test_strict_schema_and_malformed_calls_fail_without_actions():
    f = Fixture([[completed(call(arguments='["bad"]'))]])
    with pytest.raises(ManagedChatError, match="arguments_invalid"):
        await f.run()
    assert not f.calls


@pytest.mark.asyncio
async def test_generator_close_marks_interrupted_turn():
    f = Fixture([[delta("Partial"), completed()]])
    stream = f.adapter.complete_chat(
        [ModelMessage("user", "fixture", source_message_id="42")], "en",
    )
    assert await anext(stream) == "Partial"
    await stream.aclose()
    assert f.finishes == [("42", False)]
    assert f.rounds[0].closed


@pytest.mark.asyncio
async def test_strict_schema_rejected_before_response_request():
    f = Fixture([])

    async def strict_tools():
        return (NS(model_schema=lambda: {"name": "lookup", "strict": True}),)

    f.tools = strict_tools
    with pytest.raises(ManagedChatError, match="schema_unsupported"):
        await f.run()
    assert not f.requests and not f.calls


@pytest.mark.asyncio
async def test_failure_after_action_does_not_retry_action_or_provider():
    f = Fixture([[completed(call())], [ValueError("PRIVATE_ERROR")]])
    with pytest.raises(ManagedChatError, match="provider_failure"):
        await f.run()
    assert len(f.requests) == 2 and len(f.calls) == 1
    assert f.finishes == [("42", False)]


@pytest.mark.asyncio
async def test_real_openai_sdk_agent_scope_and_streamed_protocol():
    import json

    import httpx
    from openai import AsyncOpenAI

    requests = []

    async def handle(request):
        requests.append(request)
        if request.url.path.endswith("/conversations"):
            return httpx.Response(200, json={"id": "native-sdk", "object": "conversation",
                                             "created_at": 1, "metadata": {}})
        events = [
            {"type": "response.output_text.delta", "delta": "SDK fixture", "item_id": "m1",
             "output_index": 0, "content_index": 0, "sequence_number": 0},
            {"type": "response.completed", "sequence_number": 1,
             "response": {"id": "r1", "status": "completed", "output": []}},
        ]
        body = "".join(f"data: {json.dumps(event)}\n\n" for event in events)
        return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
        async with AsyncOpenAI(
            api_key="synthetic-fixture", http_client=http,
            **agent_client_options(
                "https://fixture.ai.azure.com/api/projects/test", "fixture-chat",
            ),
        ) as client:
            f = Fixture([])
            f.adapter._client = client
            assert await f.run() == ["SDK fixture"]
    assert len(requests) == 2
    for request in requests:
        assert "/agents/fixture-chat/endpoint/protocols/openai/" in request.url.path
        assert request.url.params["api-version"] == "v1"
        assert request.headers["Foundry-Features"] == AGENT_PREVIEW_HEADER
    assert json.loads(requests[1].content)["conversation"] == "native-sdk"
