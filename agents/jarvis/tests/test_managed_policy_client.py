"""Shared application loop through native SDK HTTP; all evidence is synthetic."""
import asyncio
import json
from contextlib import asynccontextmanager
from dataclasses import replace

import httpx
import pytest
from openai import AsyncOpenAI
from test_model_client import LIST_JOBS, FakeBackend

from jarvis_tools import current_message_id, current_steering_fetcher
from managed_copilot import ManagedChatError
from managed_policy_client import (
    ManagedPolicyClient,
    ManagedPolicyTarget,
    ManagedPolicyTurnContext,
    NativeInputCursor,
)
from model_contract import AcknowledgmentBoundary
from state import ModelImage, ModelMessage, ModelSettings

SETTINGS = ModelSettings("gpt-6.1-terra", "high")
TARGET = ManagedPolicyTarget("fixture", SETTINGS.model, SETTINGS.reasoning_effort, "1", "a"*64)


def function(name="list_jobs", call_id="call1", arguments="{}"):
    return {"type": "function_call", "id": call_id, "call_id": call_id,
            "name": name, "arguments": arguments, "status": "completed"}


def final(text="Done.", calls=(), kind="response.completed"):
    events = [] if not text else [{"type": "response.output_text.delta", "delta": text,
                                  "item_id": "m1", "output_index": 0, "content_index": 0,
                                  "sequence_number": 0}]
    events.append({"type": kind, "sequence_number": 1, "response": {
        "id": "response", "status": "completed" if kind == "response.completed" else "failed",
        "output": list(calls), "usage": {"input_tokens": 4, "output_tokens": 2,
                                           "total_tokens": 6},
    }})
    return events


class Binding:
    conversation_id = "native-one"

    def __init__(self):
        self.claims, self.finishes, self.attached = [], [], []

    @asynccontextmanager
    async def lease(self, context, target):
        assert target.agent_version == "1" and target.fingerprint == "a"*64
        yield self

    async def claim_turn(self, source):
        if source in self.claims:
            return False
        self.claims.append(source)
        return True

    async def attach_source(self, source):
        self.attached.append(source)
        return True

    async def finish_turn(self, source, success):
        self.finishes.append((source, success))


class Fixture:
    def __init__(self, rounds, backend=None):
        self.rounds, self.requests = rounds, []
        self.backend = backend or FakeBackend(
            catalogue=[{**LIST_JOBS, "execution": {"defaultEffect": "read"}}],
            model_name=SETTINGS.model, reasoning_effort=SETTINGS.reasoning_effort,
        )
        self.bindings = Binding()
        self.source, self.start = "42", 0
        self.verified = []

    @asynccontextmanager
    async def client(self):
        async def handle(request):
            self.requests.append(json.loads(request.content))
            events = self.rounds[len(self.requests)-1]
            if isinstance(events, BaseException):
                raise events
            return httpx.Response(200, text="".join(
                f"data: {json.dumps(event)}\n\n" for event in events
            ), headers={"content-type": "text/event-stream"})

        async def verify(target, settings, tools):
            assert (settings.model, settings.reasoning_effort) == (
                TARGET.model, TARGET.reasoning_effort,
            )
            self.verified.append(tools)

        tools = self.backend.tools()
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
            async with AsyncOpenAI(api_key="synthetic", base_url="https://fixture.test/v1/",
                                   http_client=http, max_retries=0) as sdk:
                model = ManagedPolicyClient(
                    client=sdk, backend=tools, target=TARGET, bindings=self.bindings,
                    context_provider=lambda: ManagedPolicyTurnContext("session", self.source,
                                                                     self.start),
                    definition_verifier=verify,
                )
                try:
                    yield model
                finally:
                    await tools.close()

    async def run(self, model, messages=None, **kwargs):
        return [chunk async for chunk in model.complete_chat(
            messages or [ModelMessage("user", "List jobs", source_message_id=self.source)],
            "en", **kwargs,
        )]


def test_cursor_skips_native_history_and_provider_outputs_but_keeps_supplements():
    cursor = NativeInputCursor(3, 1)
    context = {"role": "user", "content": "reference"}
    history = {"role": "assistant", "content": "old"}
    attachment = {"role": "user", "content": "attachment"}
    source = {"role": "user", "content": "current"}
    inputs = [context, history, attachment, source]
    assert cursor.take(inputs) == [context, attachment, source]
    inputs += [{"type": "reasoning", "id": "private"}, function(),
               {"type": "function_call_output", "call_id": "call1", "output": "receipt"},
               {"role": "user", "content": "trusted steering"}]
    assert cursor.take(inputs) == inputs[-2:]
    with pytest.raises(ManagedChatError, match="rewound"):
        cursor.take([])


@pytest.mark.asyncio
async def test_existing_policy_prompt_usage_and_native_delta_continuations():
    f = Fixture([final("Checking.", [function()]), final()])
    f.start = 2
    messages = [ModelMessage("user", "old"), ModelMessage("assistant", "old reply"),
                ModelMessage("user", "untrusted attachment reference"),
                ModelMessage("user", "current", source_message_id="42")]
    async with f.client() as model:
        chunks = await f.run(model, messages, reflex_note="A trusted synthetic receipt.")
    assert AcknowledgmentBoundary("Checking.") in chunks
    first, second = f.requests
    assert set(first) == {"conversation", "input", "instructions", "stream"}
    assert first["conversation"] == second["conversation"] == "native-one"
    assert [item["content"] for item in first["input"][1:]] == [
        "untrusted attachment reference", "current"]
    assert "old reply" not in json.dumps(first)
    assert all(item["type"] == "function_call_output" for item in second["input"])
    for expected in ["I am Jarvis", "Shared backend capability block", "health_food_review",
                     "list_capabilities", "A trusted synthetic receipt"]:
        assert expected in first["instructions"]
    calls = [request for request in f.backend.requests if request.url.path == "/tools/list_jobs"]
    assert len(calls) == 1
    assert calls[0].headers["X-Jarvis-Message-ID"] == "42"
    assert sum(request.url.path == "/usage/foundry" for request in f.backend.requests) == 2
    assert f.bindings.finishes == [("42", True)]


@pytest.mark.asyncio
async def test_steering_is_attached_before_provider_and_new_source_tool_call():
    f = Fixture([final("", [function()]), final("", [function(call_id="call2")]), final()])
    sent = False

    async def fetch():
        nonlocal sent
        if f.requests and not sent:
            sent = True
            return [("43", "List jobs again; use English", "en")]
        return []

    token = current_steering_fetcher.set(fetch)
    original = current_message_id.set("original")
    try:
        async with f.client() as model:
            await f.run(model)
        assert current_message_id.get() == "original"
    finally:
        current_message_id.reset(original)
        current_steering_fetcher.reset(token)
    assert f.bindings.attached == ["43"]
    calls = [r for r in f.backend.requests if r.url.path == "/tools/list_jobs"]
    assert [r.headers["X-Jarvis-Message-ID"] for r in calls] == ["42", "43"]
    assert any("List jobs again" in str(item) for item in f.requests[1]["input"])


@pytest.mark.asyncio
async def test_unknown_provider_failure_keeps_durable_claim_uncertain():
    f = Fixture([ValueError("PRIVATE_PROVIDER_CONTENT")])
    async with f.client() as model:
        with pytest.raises(ManagedChatError, match="turn_failed") as error:
            await f.run(model)
    assert "PRIVATE" not in str(error.value)
    assert f.bindings.claims == ["42"] and not f.bindings.finishes


@pytest.mark.asyncio
async def test_generator_close_keeps_claim_active_and_resets_source():
    f = Fixture([final()])
    async with f.client() as model:
        stream = model.complete_chat(
            [ModelMessage("user", "fixture", source_message_id="42")], "en",
        )
        assert await anext(stream) == "Done."
        await stream.aclose()
    assert f.bindings.claims == ["42"] and not f.bindings.finishes


@pytest.mark.asyncio
async def test_images_are_explicit_activation_gate_before_any_claim_or_provider():
    f = Fixture([])
    async with f.client() as model:
        with pytest.raises(ManagedChatError, match="image_unverified"):
            await f.run(model, [ModelMessage("user", "fixture", (ModelImage("synthetic"),),
                                            source_message_id="42")])
    assert not f.requests and not f.bindings.claims


@pytest.mark.asyncio
async def test_model_mismatch_and_missing_immutable_target_never_infer():
    f = Fixture([])
    async with f.client() as model:
        with pytest.raises(ManagedChatError, match="settings_mismatch"):
            await f.run(model, settings=replace(SETTINGS, reasoning_effort="none"))
        model._target = replace(TARGET, fingerprint="")
        with pytest.raises(ManagedChatError, match="immutable_target_missing"):
            await f.run(model)
    assert not f.requests and not f.bindings.claims


@pytest.mark.asyncio
async def test_shared_normal_tool_schema_is_registered_after_operation_filter():
    backend = FakeBackend(catalogue=[{
        "name": "get_system_health", "description": "Fixture health.",
        "inputSchema": {"type": "object", "properties": {
            "operation": {"type": "string"}, "detail": {"type": "boolean"},
        }},
    }], model_name=SETTINGS.model, reasoning_effort=SETTINGS.reasoning_effort)
    f = Fixture([final()], backend)
    async with f.client() as model:
        await f.run(model)
    assert f.verified[0][0]["parameters"]["properties"] == {"detail": {"type": "boolean"}}
    assert "tools" not in f.requests[0]


@pytest.mark.asyncio
async def test_calendar_stage_renders_backend_receipt_not_provider_success_claim():
    class CalendarBackend(FakeBackend):
        def handle(self, request):
            if request.url.path == "/tools/calendar_create_event":
                self.requests.append(request)
                return httpx.Response(200, json={"outcome": "ok", "result": {
                    "status": "awaiting_confirmation", "confirmationCode": "12345678",
                    "summary": "Create the synthetic event.",
                }})
            return super().handle(request)

    backend = CalendarBackend(catalogue=[{
        "name": "calendar_get_pending_change", "description": "Fixture pending state.",
        "inputSchema": {"type": "object", "properties": {}},
    }, {
        "name": "calendar_create_event", "description": "Stage fixture event.",
        "inputSchema": {"type": "object", "properties": {}},
    }], model_name=SETTINGS.model, reasoning_effort=SETTINGS.reasoning_effort)
    f = Fixture([final("I created your event.", [function("calendar_create_event")])], backend)
    async with f.client() as model:
        chunks = await f.run(model, [ModelMessage("user", "Create a calendar event tomorrow",
                                                source_message_id="42")])
    text = "".join(chunk for chunk in chunks if isinstance(chunk, str))
    assert "I created your event" not in text
    assert "synthetic event" in text
    assert len(f.requests) == 1
    assert f.bindings.finishes == [("42", True)]


@pytest.mark.asyncio
async def test_mode_refresh_keeps_existing_prompt_policy_in_native_continuation():
    class ModeBackend(FakeBackend):
        mode = "present"

        def handle(self, request):
            if request.url.path == "/agent/settings":
                self.requests.append(request)
                return httpx.Response(200, json={"model": SETTINGS.model,
                                                 "reasoningEffort": SETTINGS.reasoning_effort,
                                                 "mode": self.mode})
            if request.url.path == "/tools/set_presence_mode":
                self.requests.append(request)
                self.mode = "on_the_move"
                return httpx.Response(200, json={"outcome": "ok", "result": {"mode": self.mode}})
            return super().handle(request)

    backend = ModeBackend(catalogue=[{
        "name": "set_presence_mode", "description": "Fixture mode switch.",
        "inputSchema": {"type": "object", "properties": {"mode": {"type": "string"}}},
    }])
    f = Fixture([final("", [function("set_presence_mode", arguments='{"mode":"on_the_move"}')]),
                 final()], backend)
    async with f.client() as model:
        await f.run(model)
    assert "Dan's current mode: Present" in f.requests[0]["instructions"]
    assert "Dan's current mode: On the move" in f.requests[1]["instructions"]
    assert all(item["type"] == "function_call_output" for item in f.requests[1]["input"])


@pytest.mark.asyncio
@pytest.mark.parametrize("arguments", ["{}", '{"different":true}'])
@pytest.mark.parametrize("announce_call", [False, True])
@pytest.mark.parametrize("call_status", ["completed", "omitted", None])
async def test_final_only_boundary_rejects_repeated_and_new_native_actions(
    arguments, announce_call, call_status,
):
    backend = FakeBackend(catalogue=[{
        "name": "fixture_action", "description": "Synthetic action only.",
        "inputSchema": {"type": "object", "properties": {}},
        "execution": {"defaultEffect": "action"},
    }], model_name=SETTINGS.model, reasoning_effort=SETTINGS.reasoning_effort)
    last_call = function("fixture_action", call_id="new-call", arguments=arguments)
    if call_status == "omitted":
        del last_call["status"]
    else:
        last_call["status"] = call_status
    last_events = final("", [last_call])
    if announce_call:
        last_events.insert(0, {"type": "response.output_item.added", "output_index": 0,
                               "sequence_number": 0, "item": last_call})
    f = Fixture([final("", [function("fixture_action")]),
                 final("", [function("fixture_action")]), last_events], backend)
    async with f.client() as model:
        with pytest.raises(ManagedChatError, match="final_only_tool_call"):
            await f.run(model)
    calls = [r for r in backend.requests if r.url.path == "/tools/fixture_action"]
    assert len(calls) == 1
    assert len(f.requests) == 3
    assert any("already completed" in str(item) for item in f.requests[-1]["input"])
    assert not f.bindings.finishes


@pytest.mark.asyncio
async def test_final_only_boundary_accepts_text_without_another_action():
    backend = FakeBackend(catalogue=[{
        "name": "fixture_action", "description": "Synthetic action only.",
        "inputSchema": {"type": "object", "properties": {}},
        "execution": {"defaultEffect": "action"},
    }], model_name=SETTINGS.model, reasoning_effort=SETTINGS.reasoning_effort)
    f = Fixture([final("", [function("fixture_action")]),
                 final("", [function("fixture_action")]), final("Finished once.")], backend)
    async with f.client() as model:
        chunks = await f.run(model)
    assert "Finished once." in chunks
    assert len([r for r in backend.requests if r.url.path == "/tools/fixture_action"]) == 1
    assert f.bindings.finishes == [("42", True)]


@pytest.mark.asyncio
async def test_steering_requires_durable_source_attachment_before_new_inference():
    f = Fixture([final()])
    f.bindings.attach_source = None

    async def fetch():
        return [("43", "New verified steering", "en")]

    token = current_steering_fetcher.set(fetch)
    try:
        async with f.client() as model:
            with pytest.raises(ManagedChatError, match="source_unclaimed"):
                await f.run(model)
    finally:
        current_steering_fetcher.reset(token)
    assert not f.requests
    assert not any(r.url.path == "/tools/list_jobs" for r in f.backend.requests)


@pytest.mark.asyncio
@pytest.mark.parametrize("kind,expected_finish", [
    ("response.failed", [("42", False)]), ("response.incomplete", []),
])
async def test_explicit_terminal_failure_vs_uncertain_incomplete_ledger(kind, expected_finish):
    f = Fixture([final("Partial", kind=kind)])
    async with f.client() as model:
        with pytest.raises(ManagedChatError):
            await f.run(model)
    assert f.bindings.finishes == expected_finish


@pytest.mark.asyncio
async def test_provider_failure_after_backend_tool_keeps_claim_active():
    f = Fixture([final("", [function()]), final("Partial", kind="response.failed")])
    async with f.client() as model:
        with pytest.raises(ManagedChatError, match="response_failed"):
            await f.run(model)
    assert len([r for r in f.backend.requests if r.url.path == "/tools/list_jobs"]) == 1
    assert not f.bindings.finishes


@pytest.mark.asyncio
async def test_cancelled_inference_keeps_claim_active_without_retry():
    f = Fixture([asyncio.CancelledError()])
    async with f.client() as model:
        with pytest.raises(asyncio.CancelledError):
            await f.run(model)
    assert len(f.requests) == 1
    assert f.bindings.claims == ["42"] and not f.bindings.finishes


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["omitted", None, "completed"])
async def test_completed_parent_accepts_optional_sdk_function_status(status):
    # Public/pinned OpenAI ResponseFunctionToolCall.status is Optional[...] = None.
    item = function()
    if status == "omitted":
        del item["status"]
    else:
        item["status"] = status
    f = Fixture([final("", [item]), final()])
    async with f.client() as model:
        assert "Done." in await f.run(model)
    assert len([r for r in f.backend.requests if r.url.path == "/tools/list_jobs"]) == 1
    assert f.bindings.finishes == [("42", True)]


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["in_progress", "incomplete", "unknown", "", False, 1, [], {}])
async def test_explicit_unfinished_or_malformed_function_status_cannot_dispatch(status):
    item = function()
    item["status"] = status
    f = Fixture([final("", [item])])
    async with f.client() as model:
        with pytest.raises(ManagedChatError, match="tool_call_unfinished"):
            await f.run(model)
    assert not any(r.url.path.startswith("/tools/") for r in f.backend.requests)
    assert not f.bindings.finishes


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [None, "in_progress", "incomplete", "failed", "unknown"])
async def test_optional_function_status_never_overrides_unfinished_parent(status):
    item = function()
    del item["status"]
    events = final("", [item])
    events[-1]["response"]["status"] = status
    f = Fixture([events])
    async with f.client() as model:
        with pytest.raises(ManagedChatError, match="response_unfinished"):
            await f.run(model)
    assert not any(r.url.path.startswith("/tools/") for r in f.backend.requests)
    assert not f.bindings.finishes


@pytest.mark.asyncio
@pytest.mark.parametrize("error,code", [
    (ManagedChatError("managed_input_boundary_invalid"), "managed_input_boundary_invalid"),
    (ValueError("PRIVATE_PRE_INFERENCE_ERROR"), "managed_policy_setup_failed"),
])
async def test_ordinary_failure_before_inference_and_backend_dispatch_completes_failed(error, code):
    f = Fixture([])
    async with f.client() as model:
        async def fail_before_request(request):
            raise error
        model._create_response = fail_before_request
        with pytest.raises(ManagedChatError, match="^" + code + "$"):
            await f.run(model)
    assert not f.requests
    assert f.bindings.finishes == [("42", False)]
    assert not any(r.url.path.startswith("/tools/") for r in f.backend.requests)


@pytest.mark.asyncio
async def test_pre_inference_failure_after_calendar_preflight_keeps_claim_active():
    backend = FakeBackend(catalogue=[{
        "name": "calendar_get_pending_change", "description": "Synthetic pending read.",
        "inputSchema": {"type": "object", "properties": {}},
    }], model_name=SETTINGS.model, reasoning_effort=SETTINGS.reasoning_effort)
    f = Fixture([], backend)
    async with f.client() as model:
        async def fail_before_request(request):
            raise ManagedChatError("managed_input_boundary_invalid")
        model._create_response = fail_before_request
        with pytest.raises(ManagedChatError):
            await f.run(model, [ModelMessage("user", "Create a calendar event tomorrow",
                                            source_message_id="42")])
    assert not f.requests
    assert any(r.url.path == "/tools/calendar_get_pending_change" for r in backend.requests)
    assert not f.bindings.finishes


@pytest.mark.asyncio
async def test_pre_inference_cancellation_keeps_claim_active():
    f = Fixture([])
    async with f.client() as model:
        async def cancel_before_request(request):
            raise asyncio.CancelledError()
        model._create_response = cancel_before_request
        with pytest.raises(asyncio.CancelledError):
            await f.run(model)
    assert not f.requests and not f.bindings.finishes


@pytest.mark.asyncio
async def test_inference_attempt_marker_stays_set_across_later_round_validation_failure():
    f = Fixture([final()])
    sent = False

    async def fetch():
        nonlocal sent
        if f.requests and not sent:
            sent = True
            return [("43", "Continue with the verified follow-up", "en")]
        return []

    token = current_steering_fetcher.set(fetch)
    try:
        async with f.client() as model:
            create_response = model._create_response

            async def fail_only_later(request):
                if f.requests:
                    raise ManagedChatError("managed_input_boundary_invalid")
                return await create_response(request)

            model._create_response = fail_only_later
            with pytest.raises(ManagedChatError, match="input_boundary_invalid"):
                await f.run(model)
    finally:
        current_steering_fetcher.reset(token)
    assert len(f.requests) == 1
    assert not any(r.url.path.startswith("/tools/") for r in f.backend.requests)
    assert not f.bindings.finishes


@pytest.mark.asyncio
async def test_context_failure_before_inference_does_not_create_or_bind_empty_native():
    backend = FakeBackend(
        catalogue=[LIST_JOBS], context_status=503,
        model_name=SETTINGS.model, reasoning_effort=SETTINGS.reasoning_effort,
    )
    f = Fixture([], backend)
    f.bindings.conversation_id = None
    async with f.client() as model:
        with pytest.raises(ManagedChatError, match="setup_failed"):
            await f.run(model)
    assert not f.requests
    assert f.bindings.conversation_id is None
    assert f.bindings.finishes == [("42", False)]
