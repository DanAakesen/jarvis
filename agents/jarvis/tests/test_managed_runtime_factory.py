"""Actual lazy managed assembly over synthetic HTTP; no credentials or inference."""
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace as NS

import httpx
import pytest
from test_model_client import LIST_JOBS, FakeBackend

from jarvis_tools import (
    current_chat_input_start,
    current_chat_session_id,
    current_message_id,
    model_tools,
)
from managed_copilot import ManagedChatError
from managed_copilot_definition import managed_agent_definition
from managed_definition_fingerprint import managed_definition_fingerprint
from managed_policy_client import ManagedPolicyTarget
from managed_runtime_factory import LazyManagedRuntime
from model_client import AzureOpenAIResponsesClient, chat_model_tools, responses_base_url
from state import ModelMessage, ModelSettings

ENDPOINT = "https://fixture.services.ai.azure.com/api/projects/synthetic"
SETTINGS = ModelSettings("gpt-6.1-terra", "high")
TARGET = ManagedPolicyTarget("fixture-managed", SETTINGS.model, "high", "1", "a"*64)


class Credential:
    def __init__(self):
        self.scopes = []

    async def get_token(self, scope):
        self.scopes.append(scope)
        return NS(token="synthetic-provider-token")


class Fixture:
    def __init__(self):
        self.backend = FakeBackend(
            catalogue=[{**LIST_JOBS, "execution": {"defaultEffect": "read"}}],
                                   model_name=SETTINGS.model, reasoning_effort="high")
        self.credential = Credential()
        self.requests, self.native, self.responses = [], None, 0
        self.definition = None
        self.dto_mutation, self.readback_mutation = lambda x: None, lambda x: None
        self.selector = [{"agent_version": "1", "traffic_percentage": 100, "type": "FixedRatio"}]

    async def handle(self, request):
        self.requests.append(request)
        path = request.url.path
        if path == "/agent/runtime-tests/target":
            assert request.headers["Authorization"] == "Bearer agent-token"
            payload = {"projectEndpoint": ENDPOINT, "target": {"agentName": TARGET.agent_name,
                "model": TARGET.model, "effort": "high", "version": "1",
                "fingerprint": managed_definition_fingerprint(ENDPOINT, TARGET.agent_name,
                                                               "1", self.definition)},
                "definition": self.definition}
            self.dto_mutation(payload)
            return httpx.Response(200, json=payload)
        if path.startswith("/agent/runtime-tests/7/"):
            operation = path.rsplit("/", 1)[-1]
            if operation == "claim":
                return httpx.Response(200, json={"claimId": "11111111-1111-4111-8111-111111111111",
                                                "nativeConversationId": self.native})
            if operation == "bind":
                self.native = json.loads(request.content)["nativeConversationId"]
            return httpx.Response(204)
        assert request.headers["Authorization"] == "Bearer synthetic-provider-token"
        if path.endswith("/versions/1"):
            payload = {"name": TARGET.agent_name, "version": "1", "status": "active",
                       "definition": self.definition}
            self.readback_mutation(payload)
            return httpx.Response(200, json=payload)
        if path.endswith("/agents/fixture-managed"):
            return httpx.Response(200, json={"name": TARGET.agent_name, "state": "enabled",
                "configuration_state": "enabled", "agent_endpoint": {"version_selector": {
                    "version_selection_rules": self.selector}}})
        if path.endswith("/conversations"):
            return httpx.Response(200, json={"id": "native-one", "object": "conversation",
                                             "created_at": 1, "metadata": {}})
        assert path.endswith("/responses")
        self.responses += 1
        calls = [{"type": "function_call", "id": "fc1", "call_id": "call1", "name": "list_jobs",
                  "arguments": "{}", "status": "completed"}] if self.responses == 1 else []
        events = [] if calls else [{"type": "response.output_text.delta", "delta": "Fixture done.",
                                   "item_id": "m", "output_index": 0, "content_index": 0,
                                   "sequence_number": 0}]
        events.append({"type": "response.completed", "sequence_number": 1, "response": {
            "id": f"r{self.responses}", "status": "completed", "output": calls,
            "usage": {"input_tokens": 3, "output_tokens": 2, "total_tokens": 5}}})
        return httpx.Response(200, text="".join(f"data: {json.dumps(e)}\n\n" for e in events),
                              headers={"content-type": "text/event-stream"})

    @asynccontextmanager
    async def runtime(self):
        backend = self.backend.tools()
        self.definition = managed_agent_definition(
            TARGET, SETTINGS, "Reviewed baseline identity.", chat_model_tools(model_tools(
                await backend.tools())),
        )
        current = AzureOpenAIResponsesClient(
            client=NS(base_url=responses_base_url(ENDPOINT), timeout=httpx.Timeout(600)),
            credential=self.credential,
            model_name=SETTINGS.model, server_address="fixture.services.ai.azure.com",
            system_prompt="", max_output_tokens=4096, tools=backend, reasoning_effort="high",
        )
        try:
            yield LazyManagedRuntime(current, transport=httpx.MockTransport(self.handle)), current
        finally:
            await backend.close()

    async def run(self, runtime, *, source="42"):
        tokens = [(current_chat_session_id, current_chat_session_id.set("7")),
                  (current_message_id, current_message_id.set(source)),
                  (current_chat_input_start, current_chat_input_start.set(2))]
        try:
            return [chunk async for chunk in runtime.complete_chat([
                ModelMessage("user", "Verified rolling reference JSON: fixture"),
                ModelMessage("assistant", "Previous verified answer."),
                ModelMessage("user", "List jobs", source_message_id=source),
            ], "en")]
        finally:
            for variable, token in reversed(tokens):
                variable.reset(token)


@pytest.mark.asyncio
async def test_lazy_actual_factory_text_tools_and_seed_only_new_native():
    f = Fixture()
    async with f.runtime() as (runtime, current):
        assert not f.requests and not f.credential.scopes
        assert "Fixture done." in await f.run(runtime)
        assert "Fixture done." in await f.run(runtime, source="43")
        await runtime.close()
        assert await current.session_settings()
        assert not current._tools._http.is_closed
    native_requests = [json.loads(r.content) for r in f.requests
                       if r.url.path.endswith("/responses")]
    assert "Verified rolling reference JSON" in str(native_requests[0]["input"])
    assert "Previous verified answer" in str(native_requests[0]["input"])
    assert all(item["type"] == "function_call_output" for item in native_requests[1]["input"])
    assert "Previous verified answer" not in str(native_requests[2]["input"])
    assert all(set(r) == {"conversation", "input", "instructions", "stream"}
               for r in native_requests)
    assert sum(r.url.path.endswith("/conversations") for r in f.requests) == 1
    assert len([r for r in f.backend.requests if r.url.path == "/tools/list_jobs"]) == 1
    assert set(f.credential.scopes) == {"https://ai.azure.com/.default"}
    assert sum(r.url.path.endswith("/versions/1") for r in f.requests) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["model", "project", "selector", "definition"])
async def test_failed_live_readback_or_target_cannot_claim_or_infer(failure):
    f = Fixture()
    if failure == "model":
        f.dto_mutation = lambda dto: dto["target"].update(model="other")
    elif failure == "project":
        f.dto_mutation = lambda dto: dto.update(projectEndpoint="https://other.test/api/projects/p")
    elif failure == "selector":
        f.selector = [{"agent_version": "2", "traffic_percentage": 100, "type": "FixedRatio"}]
    else:
        f.readback_mutation = lambda dto: dto.update(definition={"kind": "hosted"})
    async with f.runtime() as (runtime, _):
        with pytest.raises(ManagedChatError):
            await f.run(runtime)
    assert not any(r.url.path.endswith(("/claim", "/responses", "/conversations"))
                   for r in f.requests)


@pytest.mark.asyncio
async def test_main_injects_lazy_chat_only_and_preserves_current_instance(monkeypatch):
    import main

    f = Fixture()
    captured = {}

    def host(current, **options):
        captured.update(current=current, options=options)
        return captured

    monkeypatch.setattr(main, "create_voice_app", host)
    async with f.runtime() as (_, current):
        main.create_app(current)
        assert captured["current"] is current
        assert isinstance(captured["options"]["copilot_chat_client"], LazyManagedRuntime)
        assert not f.requests and not f.credential.scopes


class CanaryFixture(Fixture):
    def __init__(self, fault=None):
        super().__init__()
        self.responses = 1  # Normal synthetic completed text, no function request.
        self.fault = fault

    async def handle(self, request):
        if request.method == "DELETE":
            self.requests.append(request)
            assert request.url.path.endswith("/conversations/native-one")
            return httpx.Response(200, json={"id": "native-one", "deleted": True,
                                             "object": "conversation.deleted"})
        if request.url.path.endswith("/responses"):
            if self.fault == "tool":
                self.responses = 0
            elif self.fault in {"forbidden", "timeout", "empty", "failed"}:
                self.requests.append(request)
                if self.fault == "forbidden":
                    return httpx.Response(403, json={"error": {"message": "PRIVATE_RAW_ERROR"}})
                if self.fault == "timeout":
                    raise httpx.ReadTimeout("PRIVATE_RAW_ERROR")
                kind = "response.failed" if self.fault == "failed" else "response.completed"
                return httpx.Response(200, text="data: " + json.dumps({
                    "type": kind, "sequence_number": 1, "response": {
                        "id": "r", "status": "completed", "output": []},
                }) + "\n\n", headers={"content-type": "text/event-stream"})
        if request.url.path.endswith("/versions/1") and self.fault == "metadata403":
            self.requests.append(request)
            return httpx.Response(403, json={"error": "PRIVATE_RAW_ERROR"})
        return await super().handle(request)


@pytest.mark.asyncio
async def test_canary_uses_bridge_credential_without_user_context_claim_or_tool_dispatch():
    f = CanaryFixture()
    async with f.runtime() as (runtime, current):
        result = await runtime.probe_target()
        assert result == {"status": "ok", "model": "gpt-6.1-terra", "reasoningEffort": "high"}
        assert not current._tools._http.is_closed
    response_request = next(r for r in f.requests if r.url.path.endswith("/responses"))
    assert json.loads(response_request.content) == {
        "conversation": "native-one", "input": "Reply with the single word OK. Do not call tools.",
        "stream": True,
    }
    assert response_request.headers["Authorization"] == "Bearer synthetic-provider-token"
    assert response_request.extensions["timeout"]["read"] == 600
    assert all(r.extensions["timeout"]["read"] == SETTINGS.backend_http_timeout_seconds
               for r in f.requests if r.method == "GET")
    assert not any("/claim" in r.url.path for r in f.requests)
    assert not any(r.url.path.startswith("/tools/") or r.url.path == "/factory/context"
                   for r in f.backend.requests)
    assert [r.url.path for r in f.requests if r.method == "DELETE"] == [
        "/api/projects/synthetic/agents/fixture-managed/endpoint/protocols/openai/"
        "conversations/native-one"]


@pytest.mark.asyncio
@pytest.mark.parametrize("fault,reason", [
    ("tool", "managed_probe_requested_tool"), ("empty", "managed_probe_empty_or_unfinished"),
    ("failed", "managed_probe_incomplete"), ("timeout", "managed_probe_timeout"),
    ("forbidden", "managed_model_forbidden"), ("metadata403", "managed_readback_forbidden"),
])
async def test_canary_failures_are_fixed_cleanup_only_known_synthetic_id(fault, reason):
    f = CanaryFixture(fault)
    async with f.runtime() as (runtime, _):
        result = await runtime.probe_target()
    assert result["status"] == "unavailable" and result["reason"] == reason
    assert "PRIVATE_RAW_ERROR" not in json.dumps(result)
    assert not any(r.url.path.startswith("/tools/") for r in f.backend.requests)
    assert not any("/claim" in r.url.path for r in f.requests)
    deleted = [r for r in f.requests if r.method == "DELETE"]
    assert len(deleted) == (0 if fault == "metadata403" else 1)
    if fault in {"forbidden", "metadata403"}:
        assert result["httpStatus"] == 403
