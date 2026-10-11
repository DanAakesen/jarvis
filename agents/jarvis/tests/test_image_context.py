"""Offline image transport, fallback and byte-free history contracts."""

from __future__ import annotations

import asyncio
import base64
import json
from types import SimpleNamespace

import httpx
import pytest
from starlette.testclient import TestClient
from test_chat_runtime import AUTHORIZATION, app_with
from test_model_client import (
    FakeAnthropic,
    FakeAnthropicStream,
    FakeBackend,
    FakeItem,
    FakeStream,
    client,
    completed,
)

import chat_runtime
from jarvis_tools import current_chat_turn_id, current_message_id, current_steering_fetcher
from model_client import image_input_rejected
from state import ConversationHistory, ModelImage, ModelMessage
from visual_context import (
    MAX_JPEG_BYTES,
    current_visual_result,
    resolved_visual_image,
    visual_context,
    visual_context_text,
)

# Deterministic inline JPEG fixture; neither actual capture data nor external I/O.
JPEG = base64.b64encode(b"\xff\xd8fixture\xff\xd9").decode()
VISUAL = {
    "source": "screen", "capturedAt": "2026-10-11T20:00:00Z",
    "description": "A red control.", "frameId": "frame_1", "turnId": "legacy-turn",
}
PRIVATE = {
    "frameId": "frame_1", "imageBase64": JPEG, "mimeType": "image/jpeg", "detail": "low",
}


@pytest.mark.parametrize("detail", ["low", "auto"])
@pytest.mark.asyncio
async def test_foundry_receives_current_image_and_actual_usage(detail):
    model, transport = client([completed()], backend=FakeBackend())
    result = {"visualPath": "caption", "frameId": "frame_1"}
    token = current_visual_result.set(result)
    image = ModelImage(JPEG, detail)
    try:
        assert [
            text async for text in model.complete_chat(
                [ModelMessage("user", "What is this?", (image,))], "da"
            )
        ] == []
    finally:
        current_visual_result.reset(token)
        await model.close()
    assert transport.responses.request["input"][-1]["content"] == [
        {"type": "input_text", "text": "What is this?"},
        {"type": "input_image", "image_url": f"data:image/jpeg;base64,{JPEG}", "detail": detail},
    ]
    assert result == {
        "visualPath": "image", "frameId": "frame_1", "model": "deployment",
        "inputTokens": 100, "outputTokens": 20,
    }
    assert JPEG not in repr(image)
    assert JPEG not in repr(ModelMessage("user", "What is this?", (image,)))


@pytest.mark.asyncio
async def test_anthropic_receives_image_source_and_unmodified_caption():
    model, transport = client([], backend=FakeBackend(model_name="claude-sonnet-5-5"))
    anthropic = FakeAnthropic([FakeAnthropicStream([], SimpleNamespace(
        content=[], usage=SimpleNamespace(input_tokens=101, output_tokens=2)
    ))])
    model._anthropic_client = anthropic
    try:
        assert [text async for text in model.complete_chat(
            [ModelMessage("user", "Caption", (ModelImage(JPEG),))], "en"
        )] == []
    finally:
        await model.close()
    assert not transport.responses.requests
    assert anthropic.messages.requests[0]["messages"][-1]["content"][-2:] == [
        {"type": "text", "text": "Caption"},
        {"type": "image", "source": {
            "type": "base64", "media_type": "image/jpeg", "data": JPEG,
        }},
    ]


@pytest.mark.parametrize("claude", [False, True])
@pytest.mark.asyncio
async def test_hosted_voice_image_uses_chat_settings_and_records_chat_role(claude):
    selected = "claude-sonnet-5-5" if claude else "chat-image-deployment"
    backend = FakeBackend(model_name=selected)
    model, transport = client([completed()], backend=backend)
    if claude:
        model._anthropic_client = FakeAnthropic([FakeAnthropicStream(
            [], SimpleNamespace(content=[], usage=SimpleNamespace(input_tokens=10, output_tokens=2))
        )])
    try:
        assert [text async for text in model.complete(
            [ModelMessage("user", "Caption", (ModelImage(JPEG),))]
        )] == []
    finally:
        await model.close()
    requests = (
        model._anthropic_client.messages.requests if claude else transport.responses.requests
    )
    assert requests[0]["model"] == selected
    usages = [
        json.loads(request.content) for request in backend.requests
        if request.url.path == "/usage/foundry"
    ]
    assert len(usages) == 1
    assert usages[0]["role"] == "chat"


@pytest.mark.asyncio
async def test_oversized_image_prompt_falls_back_before_image_request():
    model, transport = client([completed()], backend=FakeBackend())
    result = {"visualPath": "caption"}
    token = current_visual_result.set(result)
    try:
        assert [text async for text in model.complete_chat(
            [ModelMessage("user", "x" * 28_001, (ModelImage(JPEG),))], "en"
        )] == []
    finally:
        current_visual_result.reset(token)
        await model.close()
    assert len(transport.responses.requests) == 1
    assert JPEG not in json.dumps(transport.responses.requests[0])
    assert result["visualReason"] == "daily_limit"


@pytest.mark.asyncio
async def test_tool_followup_does_not_resend_or_recharge_image():
    backend = FakeBackend()
    call = FakeItem(
        type="function_call", name="create_task", call_id="call1",
        arguments='{"text":"Create task"}',
    )
    model, transport = client([], backend=backend)
    transport.responses.streams = [FakeStream([completed(call)]), FakeStream([completed()])]
    result = {"visualPath": "caption"}
    token = current_visual_result.set(result)
    message_token = current_message_id.set("42")
    try:
        assert [text async for text in model.complete_chat(
            [ModelMessage("user", "Caption", (ModelImage(JPEG),))], "en"
        )] == []
    finally:
        current_message_id.reset(message_token)
        current_visual_result.reset(token)
        await model.close()
    assert len(transport.responses.requests) == 2
    assert JPEG in json.dumps(transport.responses.requests[0])
    assert JPEG not in json.dumps(transport.responses.requests[1])
    assert result["inputTokens"] == 100
    assert result["outputTokens"] == 20


@pytest.mark.asyncio
async def test_steering_after_image_only_response_never_replays_image():
    model, transport = client([], backend=FakeBackend())
    transport.responses.streams = [FakeStream([completed()]), FakeStream([completed()])]
    fetch_count = 0

    async def steering():
        nonlocal fetch_count
        fetch_count += 1
        return [("43", "Continue.", "en")] if fetch_count == 3 else []

    steering_token = current_steering_fetcher.set(steering)
    turn_token = current_chat_turn_id.set("42")
    try:
        assert [text async for text in model.complete_chat(
            [ModelMessage("user", "Caption", (ModelImage(JPEG),))], "en"
        )] == []
    finally:
        current_chat_turn_id.reset(turn_token)
        current_steering_fetcher.reset(steering_token)
        await model.close()
    assert len(transport.responses.requests) == 2
    assert JPEG in json.dumps(transport.responses.requests[0])
    assert JPEG not in json.dumps(transport.responses.requests[1])


@pytest.mark.parametrize("outcome", ["valid", "oversized", "malformed", "abort"])
@pytest.mark.asyncio
async def test_resolver_mock_transport_wipes_bytes_on_every_exit(monkeypatch, outcome):
    buffers = []

    class TrackedBuffer(bytearray):
        def __init__(self):
            super().__init__()
            buffers.append(self)

    class Chunks(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"\xff\xd8fixture"
            if outcome == "abort":
                raise asyncio.CancelledError()
            yield (
                b"x" * MAX_JPEG_BYTES if outcome == "oversized"
                else b"bad" if outcome == "malformed" else b"\xff\xd9"
            )

    def handle(request):
        assert request.url.path == "/screen/frames/resolve"
        assert json.loads(request.content) == {
            "frameId": "frame_1", "sessionId": "41", "messageId": "42",
            "turnId": "legacy-turn",
        }
        return httpx.Response(200, headers={"content-type": "image/jpeg"}, stream=Chunks())

    original_client = httpx.AsyncClient
    monkeypatch.setattr(chat_runtime, "bytearray", TrackedBuffer, raising=False)
    monkeypatch.setattr(chat_runtime, "backend_settings_from_environment", lambda: (
        "https://backend.test", "scope"
    ))
    monkeypatch.setattr(chat_runtime.httpx, "AsyncClient", lambda **kwargs: original_client(
        **kwargs, transport=httpx.MockTransport(handle)
    ))
    if outcome in {"abort", "malformed"}:
        with pytest.raises(asyncio.CancelledError if outcome == "abort" else ValueError):
            await chat_runtime.resolve_frame_image("a.b.c", VISUAL, "41", "42", 10)
    else:
        image = await chat_runtime.resolve_frame_image("a.b.c", VISUAL, "41", "42", 10)
        assert bool(image) == (outcome == "valid")
    assert buffers and all(not any(buffer) for buffer in buffers)


class ProviderRejection(Exception):
    status_code = 400
    body = {"error": {"message": "This model does not support image input"}}


@pytest.mark.parametrize("anthropic", [False, True])
@pytest.mark.asyncio
async def test_rejected_image_retries_caption_before_side_effects(anthropic):
    backend = FakeBackend(model_name="claude-sonnet-5-5" if anthropic else "gpt-5.6-luna")
    model, transport = client([completed()], backend=backend)
    requests = []
    if anthropic:
        provider = FakeAnthropic([
            FakeAnthropicStream([], None, ProviderRejection()),
            FakeAnthropicStream([], SimpleNamespace(
                content=[], usage=SimpleNamespace(input_tokens=10, output_tokens=2)
            )),
        ])
        model._anthropic_client = provider
    else:
        original = transport.responses.create

        async def create(**kwargs):
            requests.append(kwargs)
            if len(requests) == 1:
                raise ProviderRejection()
            return await original(**kwargs)

        transport.responses.create = create
    result = {"visualPath": "caption", "frameId": "frame_1"}
    token = current_visual_result.set(result)
    try:
        assert [text async for text in model.complete_chat(
            [ModelMessage("user", "Caption", (ModelImage(JPEG),))], "en"
        )] == []
    finally:
        current_visual_result.reset(token)
        await model.close()
    assert result == {
        "visualPath": "caption", "frameId": "frame_1", "visualReason": "image_rejected"
    }
    last = provider.messages.requests[-1] if anthropic else requests[-1]
    assert JPEG not in json.dumps(last)
    assert "Caption" in json.dumps(last)
    assert not any(request.url.path.startswith("/tools/") for request in backend.requests)


@pytest.mark.asyncio
async def test_anthropic_image_rejection_after_open_before_text_retries():
    model, _ = client([], backend=FakeBackend(model_name="claude-sonnet-5-5"))

    class RejectingStream(FakeAnthropicStream):
        @property
        def text_stream(self):
            async def texts():
                raise ProviderRejection()
                yield ""
            return texts()

    anthropic = FakeAnthropic([
        RejectingStream([], None),
        FakeAnthropicStream([], SimpleNamespace(
            content=[], usage=SimpleNamespace(input_tokens=10, output_tokens=2)
        )),
    ])
    model._anthropic_client = anthropic
    try:
        assert [text async for text in model.complete_chat(
            [ModelMessage("user", "Caption", (ModelImage(JPEG),))], "en"
        )] == []
    finally:
        await model.close()
    assert len(anthropic.messages.requests) == 2
    assert JPEG not in json.dumps(anthropic.messages.requests[-1])


@pytest.mark.parametrize("status", [401, 403, 429, 500])
def test_other_provider_failures_never_allow_fallback(status):
    error = ProviderRejection()
    error.status_code = status
    assert not image_input_rejected(error)


@pytest.mark.asyncio
async def test_stream_rejection_after_output_does_not_retry():
    backend = FakeBackend()
    model, transport = client([], backend=backend)

    class BrokenStream(FakeStream):
        def __aiter__(self):
            async def events():
                yield SimpleNamespace(type="response.output_text.delta", delta="Started")
                raise ProviderRejection()
            return events()

    transport.responses.streams = [BrokenStream([])]
    chunks = []
    result = {"visualPath": "caption"}
    token = current_visual_result.set(result)
    try:
        with pytest.raises(ProviderRejection):
            async for text in model.complete_chat(
                [ModelMessage("user", "Caption", (ModelImage(JPEG),))], "en"
            ):
                chunks.append(text)
    finally:
        current_visual_result.reset(token)
        await model.close()
    assert chunks == ["Started"]
    assert len(transport.responses.requests) == 1
    assert result["visualPath"] == "image"


@pytest.mark.asyncio
async def test_stream_image_rejection_before_output_retries_caption():
    backend = FakeBackend()
    model, transport = client([], backend=backend)
    transport.responses.streams = [
        FakeStream([SimpleNamespace(
            type="response.failed", response=SimpleNamespace(
                error=SimpleNamespace(code="unsupported_image")
            ),
        )]),
        FakeStream([completed()]),
    ]
    try:
        assert [text async for text in model.complete_chat(
            [ModelMessage("user", "Caption", (ModelImage(JPEG),))], "en"
        )] == []
    finally:
        await model.close()
    assert len(transport.responses.requests) == 2
    assert JPEG not in json.dumps(transport.responses.requests[-1])


@pytest.mark.asyncio
async def test_rejection_after_tool_action_does_not_retry():
    backend = FakeBackend()
    call = FakeItem(
        type="function_call", name="create_task", call_id="call1",
        arguments='{"text":"Create task"}',
    )
    model, transport = client([completed(call)], backend=backend)
    original = transport.responses.create

    async def create(**kwargs):
        if transport.responses.requests:
            raise ProviderRejection()
        return await original(**kwargs)

    transport.responses.create = create
    message_token = current_message_id.set("42")
    try:
        with pytest.raises(ProviderRejection):
            _ = [text async for text in model.complete_chat(
                [ModelMessage("user", "Caption", (ModelImage(JPEG),))], "en"
            )]
    finally:
        current_message_id.reset(message_token)
        await model.close()
    assert sum(request.url.path == "/tools/create_task" for request in backend.requests) == 1


@pytest.mark.parametrize("updates", [
    {"frameId": "other"}, {"imageBase64": "!!"},
    {"mimeType": "image/png"}, {"detail": "high"}, {"detail": {}},
    {"imageBase64": base64.b64encode(b"not-jpeg").decode()},
    {"imageBase64": base64.b64encode(b"\xff\xd8" + b"x" * MAX_JPEG_BYTES).decode()},
    {"extra": "field"},
])
def test_private_image_is_bounded_and_correlated(updates):
    with pytest.raises(ValueError, match="Invalid resolved visual context"):
        resolved_visual_image({**PRIVATE, **updates}, visual_context(VISUAL))


@pytest.mark.parametrize("frame_id", ["", "../frame", "x" * 129, None])
def test_frame_identifier_rejects_invalid_shape(frame_id):
    assert visual_context({**VISUAL, "frameId": frame_id}) is None
    assert visual_context({
        key: value for key, value in {**VISUAL, "frameId": frame_id}.items()
        if key != "turnId"
    }) is None


def test_image_invocation_preserves_handle_and_emits_metadata_once(monkeypatch):
    from jarvis_tools import current_chat_session_id

    async def context(*args):
        current_chat_session_id.set("41")
        return [ModelMessage("user", "Earlier text")]

    async def resolve(*args):
        return ModelImage(JPEG)

    monkeypatch.setattr(chat_runtime, "resolve_frame_image", resolve)
    app, model = app_with(context)
    with TestClient(app) as browser:
        response = browser.post("/invocations", json={
            "messageId": "42", "text": "What is this?", "language": "da",
            "delegatedAuthorization": AUTHORIZATION, "visualContext": VISUAL,
        })
    assert response.status_code == 200
    assert model.messages[-1].images == (ModelImage(JPEG),)
    assert all(not message.images for message in model.messages[:-1])
    assert response.text.count("event: visual\n") == 1
    assert response.text.index("event: visual") < response.text.index("event: done")
    assert '"visualPath": "caption"' in response.text  # Fake model makes no provider request.
    assert JPEG not in response.text
    assert "frame_1" not in response.text
    assert visual_context(VISUAL)["turnId"] == "legacy-turn"


def test_done_reports_accepted_image_usage_without_handle(monkeypatch):
    from jarvis_tools import current_chat_session_id

    async def context(*args):
        current_chat_session_id.set("41")
        return []

    async def resolve(*args):
        return ModelImage(JPEG)

    monkeypatch.setattr(chat_runtime, "resolve_frame_image", resolve)
    app, model = app_with(context)

    async def complete(messages, language, **kwargs):
        assert messages[-1].images
        current_visual_result.get().update({
            "visualPath": "image", "model": "gpt-6-luna",
            "inputTokens": 100, "outputTokens": 20,
        })
        yield "A red control."

    model.complete_chat = complete
    with TestClient(app) as browser:
        response = browser.post("/invocations", json={
            "messageId": "42", "sessionId": "41", "text": "What is this?", "language": "da",
            "delegatedAuthorization": AUTHORIZATION, "visualContext": VISUAL,
        })
    done = response.text.split("event: done\ndata: ", 1)[1].split("\n", 1)[0]
    assert json.loads(done) == {
        "visualPath": "image", "model": "gpt-6-luna",
        "inputTokens": 100, "outputTokens": 20,
    }
    assert "frame_1" not in response.text
    assert JPEG not in response.text


@pytest.mark.parametrize("available", [True, False])
def test_resolver_image_only_used_after_verified_message(monkeypatch, available):
    from jarvis_tools import current_chat_session_id

    async def context(*args):
        current_chat_session_id.set("41")
        return [ModelMessage("user", "Earlier text")]

    async def resolve(*args):
        return ModelImage(JPEG) if available else None

    monkeypatch.setattr(chat_runtime, "resolve_frame_image", resolve)
    app, model = app_with(context)
    with TestClient(app) as browser:
        response = browser.post("/invocations", json={
            "messageId": "42", "sessionId": "41", "text": "What is this?", "language": "da",
            "delegatedAuthorization": AUTHORIZATION, "visualContext": VISUAL,
        })
    assert response.status_code == 200
    assert bool(model.messages[-1].images) == available
    assert "event: done" in response.text
    assert "frame_1" not in response.text
    if not available:
        assert '"visualReason": "frame_unavailable"' in response.text


def test_image_request_fails_closed_when_message_is_unverified():
    async def context(*args):
        return None

    app, model = app_with(context)
    with TestClient(app) as browser:
        response = browser.post("/invocations", json={
            "messageId": "42", "text": "What is this?", "language": "da",
            "delegatedAuthorization": AUTHORIZATION, "visualContext": VISUAL,
        })
    assert response.status_code == 401
    assert not model.messages


def test_history_restores_visual_provenance_with_trusted_path_fields(monkeypatch):
    history = {"messages": [
        {"id": "1", "sessionId": "41", "role": "dan", "text": "Look",
         "metadata": {"visualContext": {
             **VISUAL, "visualPath": "image", "visualReason": "frame_unavailable",
         }}},
        {"id": "42", "sessionId": "41", "role": "dan", "text": "Follow up",
         "channel": "chat", "language": "en"},
    ]}

    def handle(request):
        return httpx.Response(200, json=history if request.url.path.endswith("/history") else {})

    async def settings_token(*args):
        return "agent-token"

    monkeypatch.setattr(chat_runtime, "agent_settings_token", settings_token)
    monkeypatch.setattr(
        chat_runtime, "backend_settings_from_environment",
        lambda: ("https://backend.example", "scope"),
    )
    original = httpx.AsyncClient
    monkeypatch.setattr(
        chat_runtime.httpx, "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs),
    )
    result = asyncio.run(chat_runtime.load_verified_history("token", "42", "Follow up", "en"))
    assert any(message.content == visual_context_text(VISUAL) for message in result)
    assert all(not message.images for message in result)
    assert all("frame_1" not in message.content for message in result)
    assert visual_context({**VISUAL, "visualPath": "image"}) is None


def test_history_never_retains_image_parts():
    history = ConversationHistory()
    history.commit("response-1", "Question with compact provenance", "Answer")
    assert all(not message.images for message in history.create_request("Follow-up"))


def test_private_image_payload_rejected_without_echo():
    async def context(*args):
        return []

    app, _ = app_with(context)
    with TestClient(app) as browser:
        response = browser.post("/invocations", json={
            "messageId": "42", "text": "What is this?", "language": "da",
            "delegatedAuthorization": AUTHORIZATION, "visualContext": VISUAL,
            "resolvedVisualContext": {**PRIVATE, "frameId": "wrong"},
        })
    assert response.status_code == 400
    assert response.json() == {"error": "Invalid request"}
    assert JPEG not in response.text
    assert chat_runtime.MAX_REQUEST_BYTES > len(JPEG)
