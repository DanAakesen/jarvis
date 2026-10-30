"""Production managed wrapper with stateful synthetic claims and SDK HTTP.

No provider credentials, real inference, SQL writes or external actions. Unlike
the protocol fixture, this ledger rejects active sessions and consumed sources.
"""
import json
from contextlib import asynccontextmanager
from uuid import UUID

import httpx
import pytest
from test_managed_runtime_factory import Fixture

from jarvis_tools import current_chat_input_start, current_chat_session_id, current_message_id
from managed_copilot import ManagedChatError
from state import ModelMessage


class StatefulFixture(Fixture):
    def __init__(self, mode="text"):
        super().__init__()
        self.mode = mode
        self.ledger = {}
        self.active = None
        self.context_failure = False
        self.provider_attempts = 0
        if mode == "action_then_timeout":
            self.backend.catalogue = [{
                "name": "fixture_action", "description": "Execute one synthetic no-op.",
                "inputSchema": {"type": "object", "properties": {}},
                "execution": {"defaultEffect": "action"},
            }]

    async def handle(self, request):
        path = request.url.path
        if path.startswith("/agent/runtime-tests/7/"):
            self.requests.append(request)
            source = request.headers["x-jarvis-message-id"]
            operation = path.rsplit("/", 1)[-1]
            body = json.loads(request.content)
            if operation == "claim":
                code = ("managed_source_already_claimed" if source in self.ledger
                        else "managed_session_busy" if self.active else None)
                if code:
                    return httpx.Response(409, json={"code": code})
                self.active = source
                claim = str(UUID(int=int(source)))
                self.ledger[source] = {"claimId": claim, "status": "active"}
                return httpx.Response(200, json={
                    "claimId": claim, "nativeConversationId": self.native,
                })
            assert self.active == source
            assert body["claimId"] == self.ledger[source]["claimId"]
            if operation == "bind":
                assert self.native is None
                self.native = body["nativeConversationId"]
            elif operation == "finish":
                self.ledger[source]["status"] = body["outcome"]
                self.active = None
            else:
                raise AssertionError("Unexpected ledger operation")
            return httpx.Response(204)
        if path.endswith("/responses"):
            self.provider_attempts += 1
            if self.mode == "timeout" or (
                self.mode in {"tool_then_timeout", "action_then_timeout"}
                and self.provider_attempts > 1
            ):
                self.requests.append(request)
                raise httpx.ReadTimeout("PRIVATE_PROVIDER_DETAIL")
            if self.mode == "failed":
                self.requests.append(request)
                event = {"type": "response.failed", "sequence_number": 1, "response": {
                    "id": "synthetic-failed", "status": "failed", "output": [],
                    "error": {"code": "server_error", "message": "PRIVATE_PROVIDER_DETAIL"},
                }}
                return httpx.Response(200, text="data: " + json.dumps(event) + "\n\n",
                                      headers={"content-type": "text/event-stream"})
            if self.mode == "text":
                self.responses = max(1, self.responses)
        response = await super().handle(request)
        if path.endswith("/responses") and self.mode in {"omitted_status", "action_then_timeout"}:
            frames = []
            for line in response.text.splitlines():
                if not line.startswith("data: "):
                    continue
                event = json.loads(line[6:])
                for item in event.get("response", {}).get("output", []):
                    if item.get("type") == "function_call":
                        if self.mode == "omitted_status":
                            item.pop("status", None)
                        else:
                            item["name"] = "fixture_action"
                frames.append("data: " + json.dumps(event) + "\n\n")
            return httpx.Response(200, text="".join(frames),
                                  headers={"content-type": "text/event-stream"})
        return response

    @asynccontextmanager
    async def runtime(self):
        async with super().runtime() as (runtime, current):
            context = current._tools.context

            async def load_context():
                if self.context_failure:
                    raise RuntimeError("PRIVATE_CONTEXT_DETAIL")
                return await context()

            current._tools.context = load_context
            yield runtime, current

    async def turn(self, runtime, source, text="hi"):
        tokens = [(current_chat_session_id, current_chat_session_id.set("7")),
                  (current_message_id, current_message_id.set(source)),
                  (current_chat_input_start, current_chat_input_start.set(0))]
        try:
            return [chunk async for chunk in runtime.complete_chat([
                ModelMessage("user", text, source_message_id=source),
            ], "en")]
        finally:
            for variable, token in reversed(tokens):
                variable.reset(token)


@pytest.mark.asyncio
@pytest.mark.parametrize("text", ["hi", "What is your role, and what can you do for me?"])
@pytest.mark.parametrize("mode", ["text", "omitted_status"])
async def test_fresh_real_wrapper_and_followup_complete_stateful_claims(text, mode):
    fixture = StatefulFixture(mode)
    async with fixture.runtime() as (runtime, _):
        assert "Fixture done." in await fixture.turn(runtime, "42", text)
        assert "Fixture done." in await fixture.turn(runtime, "43", "Follow-up fixture.")
        attempts = fixture.provider_attempts
        with pytest.raises(ManagedChatError, match="^managed_source_already_claimed$"):
            await fixture.turn(runtime, "42", text)
        assert fixture.provider_attempts == attempts
    assert fixture.active is None
    assert [row["status"] for row in fixture.ledger.values()] == ["succeeded", "succeeded"]
    assert sum(request.url.path.endswith("/conversations") for request in fixture.requests) == 1
    assert sum(request.url.path == "/tools/list_jobs" for request in fixture.backend.requests) == (
        1 if mode == "omitted_status" else 0
    )


@pytest.mark.asyncio
async def test_known_failure_before_inference_allows_new_source_but_never_replays_old_one():
    fixture = StatefulFixture()
    fixture.context_failure = True
    async with fixture.runtime() as (runtime, _):
        with pytest.raises(ManagedChatError, match="^managed_policy_setup_failed$"):
            await fixture.turn(runtime, "42")
        assert fixture.provider_attempts == 0 and fixture.active is None
        assert fixture.ledger["42"]["status"] == "failed"
        assert not any(request.url.path.endswith("/conversations") for request in fixture.requests)
        fixture.context_failure = False
        with pytest.raises(ManagedChatError, match="^managed_source_already_claimed$"):
            await fixture.turn(runtime, "42")
        assert "Fixture done." in await fixture.turn(runtime, "43")
    assert fixture.ledger["43"]["status"] == "succeeded"


@pytest.mark.asyncio
async def test_known_terminal_provider_failure_allows_followup_without_replaying_source():
    fixture = StatefulFixture("failed")
    async with fixture.runtime() as (runtime, _):
        with pytest.raises(ManagedChatError, match="^managed_response_failed$"):
            await fixture.turn(runtime, "42")
        assert fixture.active is None and fixture.ledger["42"]["status"] == "failed"
        fixture.mode = "text"
        with pytest.raises(ManagedChatError, match="^managed_source_already_claimed$"):
            await fixture.turn(runtime, "42")
        assert "Fixture done." in await fixture.turn(runtime, "43")


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["timeout", "tool_then_timeout", "action_then_timeout"])
async def test_uncertain_inference_keeps_session_blocked_and_never_repeats_provider_or_tool(mode):
    fixture = StatefulFixture(mode)
    async with fixture.runtime() as (runtime, _):
        with pytest.raises(ManagedChatError, match="^managed_policy_turn_failed$") as caught:
            await fixture.turn(runtime, "42")
        assert "PRIVATE" not in str(caught.value)
        assert fixture.active == "42" and fixture.ledger["42"]["status"] == "active"
        attempts = fixture.provider_attempts
        calls = sum(request.url.path.startswith("/tools/") for request in fixture.backend.requests)
        with pytest.raises(ManagedChatError, match="^managed_session_busy$"):
            await fixture.turn(runtime, "43")
        with pytest.raises(ManagedChatError, match="^managed_source_already_claimed$"):
            await fixture.turn(runtime, "42")
        assert fixture.provider_attempts == attempts
        assert sum(request.url.path.startswith("/tools/")
                   for request in fixture.backend.requests) == calls
        assert not any(request.url.path.endswith("/finish") for request in fixture.requests)
    assert sum(request.url.path == "/tools/list_jobs" for request in fixture.backend.requests) == (
        1 if mode == "tool_then_timeout" else 0
    )
    assert sum(request.url.path == "/tools/fixture_action"
               for request in fixture.backend.requests) == (
        1 if mode == "action_then_timeout" else 0
    )
