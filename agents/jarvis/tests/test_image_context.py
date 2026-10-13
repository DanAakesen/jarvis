"""Offline image transport, fallback and byte-free history contracts."""

from __future__ import annotations

import asyncio
import base64
import json
from datetime import datetime, timezone
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
    current_image_reservation,
    current_visual_fallback,
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
HANDLE_VISUAL = {key: value for key, value in VISUAL.items() if key != "description"}


def test_handle_only_context_requires_valid_frame_and_legacy_description():
    assert visual_context(HANDLE_VISUAL) == HANDLE_VISUAL
    assert visual_context({key: value for key, value in HANDLE_VISUAL.items()
                           if key != "frameId"}) is None
    assert visual_context({**HANDLE_VISUAL, "description": None}) is None
    assert visual_context({**HANDLE_VISUAL, "description": ""}) is None


def test_handle_only_chat_attaches_image_without_caption_call(monkeypatch):
    async def resolve(*args):
        return ModelImage(JPEG)

    async def caption(*args):
        pytest.fail("The image happy path must not run the caption model")

    monkeypatch.setattr(chat_runtime, "resolve_frame_image", resolve)
    monkeypatch.setattr(chat_runtime, "resolve_frame_caption", caption)
    app, model = app_with(lambda *_args: _empty_context())
    visual = {**HANDLE_VISUAL, "capturedAt": datetime.now(timezone.utc).isoformat()}
    with TestClient(app) as browser:
        response = browser.post("/invocations", json={
            "messageId": "42", "sessionId": "41", "text": "What is this?", "language": "en",
            "delegatedAuthorization": AUTHORIZATION, "visualContext": visual,
        })
    assert response.status_code == 200
    assert model.messages[-1] == ModelMessage("user", "What is this?", (ModelImage(JPEG),))
    assert "This turn's original image is attached" in model.messages[0].content
    assert (
        "Inspect it and answer Dan's current question naturally and directly"
        in model.messages[0].content
    )
    assert "visualPath=image" in model.messages[0].content
    assert "Do not mention a capture time, UTC timestamp" in model.messages[0].content
    assert JPEG not in response.text
    assert current_visual_fallback.get() is None


def test_handle_only_turn_captions_after_provider_rejection_in_same_invocation(monkeypatch):
    from voice_runtime import create_app

    model, provider = client([
        SimpleNamespace(type="response.output_text.delta", delta="A blue cup."), completed(),
    ], backend=FakeBackend())
    model_requests = []
    backend_requests = []
    original_create = provider.responses.create
    original_client = httpx.AsyncClient

    async def create(**kwargs):
        model_requests.append(kwargs)
        if len(model_requests) == 1:
            raise ProviderRejection()
        return await original_create(**kwargs)

    def backend(request):
        backend_requests.append(request)
        if request.url.path == "/screen/frames/resolve":
            assert not model_requests
            return httpx.Response(200, content=base64.b64decode(JPEG),
                                  headers={"content-type": "image/jpeg"})
        if request.url.path == "/screen/frames/caption":
            assert len(model_requests) == 1
            return httpx.Response(200, json={"description": "A real blue cup.", "captionMs": 47})
        if request.url.path.endswith("/steering"):
            return httpx.Response(200, json={"messages": []})
        if request.url.path.endswith("/phase"):
            return httpx.Response(204)
        return httpx.Response(200, json={})

    provider.responses.create = create
    monkeypatch.setattr(chat_runtime, "backend_settings_from_environment", lambda: (
        "https://backend.test", "scope",
    ))
    monkeypatch.setattr(chat_runtime.httpx, "AsyncClient", lambda **kwargs: original_client(
        **kwargs, transport=httpx.MockTransport(backend),
    ))
    app = create_app(model, configure_observability=None,
                     chat_context_loader=lambda *_args: _empty_context())
    with TestClient(app) as browser:
        response = browser.post("/invocations", json={
            "messageId": "42", "sessionId": "41", "text": "What is this?", "language": "en",
            "delegatedAuthorization": AUTHORIZATION, "visualContext": HANDLE_VISUAL,
        })
    assert len(model_requests) == 2
    assert JPEG in json.dumps(model_requests[0])
    assert JPEG not in json.dumps(model_requests[1])
    assert "A real blue cup." in json.dumps(model_requests[1])
    assert model_requests[1]["input"][-1]["content"] == "What is this?"
    captions = [request for request in backend_requests
                if request.url.path == "/screen/frames/caption"]
    assert len(captions) == 1
    assert json.loads(captions[0].content) == {
        "frameId": "frame_1", "sessionId": "41", "messageId": "42", "turnId": "legacy-turn",
    }
    assert response.text.count("event: done") == 1
    assert response.text.count("event: visual") == 1
    assert '"text": "A blue cup."' in response.text
    done = json.loads(response.text.split("event: done\ndata: ", 1)[1].split("\n", 1)[0])
    assert all(value >= 0 for value in done.pop("agentTimings").values())
    assert done == {"visualPath": "caption", "visualReason": "image_rejected",
                    "description": "A real blue cup.", "captionMs": 47}
    assert JPEG not in response.text


async def _empty_context():
    from jarvis_tools import current_chat_session_id

    current_chat_session_id.set("41")
    return []


@pytest.mark.parametrize("reason", [
    "frame_unavailable", "budget_exhausted", "budget_unavailable",
])
@pytest.mark.parametrize("caption_available", [True, False])
def test_handle_only_resolver_failure_uses_real_caption_or_explicit_absence(
    monkeypatch, reason, caption_available,
):
    calls = []

    async def resolve(*args):
        current_visual_result.get()["visualReason"] = reason
        return None

    async def caption(*args):
        calls.append(args)
        return {"description": "A real blue cup.", "captionMs": 123} if caption_available else None

    monkeypatch.setattr(chat_runtime, "resolve_frame_image", resolve)
    monkeypatch.setattr(chat_runtime, "resolve_frame_caption", caption)
    app, model = app_with(lambda *_args: _empty_context())
    with TestClient(app) as browser:
        response = browser.post("/invocations", json={
            "messageId": "42", "sessionId": "41", "text": "What is this?", "language": "en",
            "delegatedAuthorization": AUTHORIZATION, "visualContext": HANDLE_VISUAL,
        })
    assert len(calls) == 1
    assert calls[0][1:4] == (HANDLE_VISUAL, "41", "42")
    assert not model.messages[-1].images
    evidence = "\n".join(message.content for message in model.messages)
    assert ("A real blue cup." in evidence) == caption_available
    if not caption_available:
        assert "No usable image or real visual description is available" in evidence
    done = json.loads(response.text.split("event: done\ndata: ", 1)[1].split("\n", 1)[0])
    assert done["visualPath"] == "caption"
    assert done["visualReason"] == reason
    assert "captionMs" in done
    assert ("description" in done) == caption_available
    assert JPEG not in response.text


@pytest.mark.parametrize("reason", ["image_rejected", "image_context_limit"])
@pytest.mark.asyncio
async def test_handle_only_model_failure_requests_caption_before_single_text_retry(reason):
    backend = FakeBackend()
    model, transport = client([completed()], backend=backend)
    requests = []
    calls = []
    original = transport.responses.create

    async def create(**kwargs):
        requests.append(kwargs)
        if len(requests) == 1 and reason == "image_rejected":
            raise ProviderRejection()
        return await original(**kwargs)

    async def fallback(actual_reason):
        release = [json.loads(request.content) for request in backend.requests
                   if request.url.path == "/usage/foundry"]
        assert len(release) == 1
        assert release[0]["inputTokens"] == release[0]["outputTokens"] == 0
        assert release[0]["imageReservation"] == {"sessionId": "41", "itemId": "frame_1"}
        assert release[0]["model"] == "deployment"
        assert current_image_reservation.get() is None
        calls.append(actual_reason)
        return "Real fallback caption: a blue cup."

    transport.responses.create = create
    token = current_visual_fallback.set(fallback)
    reservation_token = current_image_reservation.set({"sessionId": "41", "itemId": "frame_1"})
    try:
        text = "x" * 400_001 if reason == "image_context_limit" else "What is this?"
        assert [delta async for delta in model.complete_chat(
            [ModelMessage("user", text, (ModelImage(JPEG),))], "en",
        )] == []
    finally:
        current_visual_fallback.reset(token)
        current_image_reservation.reset(reservation_token)
        await model.close()
    assert calls == [reason]
    assert len(requests) == (2 if reason == "image_rejected" else 1)
    assert "Real fallback caption: a blue cup." in json.dumps(requests[-1])
    assert JPEG not in json.dumps(requests[-1])
    assert requests[-1]["input"][-1]["content"] == text


@pytest.mark.asyncio
async def test_unknown_provider_failure_keeps_image_hold_without_caption_retry():
    backend = FakeBackend()
    model, transport = client([], backend=backend)
    error = ProviderRejection()
    error.status_code = 500

    async def create(**kwargs):
        raise error

    async def fallback(reason):
        pytest.fail("Unknown provider failures must not release holds or run caption retry")

    reservation = {"sessionId": "41", "itemId": "frame_1"}
    transport.responses.create = create
    token = current_visual_fallback.set(fallback)
    reservation_token = current_image_reservation.set(reservation)
    try:
        with pytest.raises(ProviderRejection):
            _ = [delta async for delta in model.complete_chat(
                [ModelMessage("user", "What is this?", (ModelImage(JPEG),))], "en",
            )]
        assert current_image_reservation.get() == reservation
    finally:
        current_visual_fallback.reset(token)
        current_image_reservation.reset(reservation_token)
        await model.close()
    assert not any(request.url.path == "/usage/foundry" for request in backend.requests)


@pytest.mark.parametrize("response", [
    {"description": "", "captionMs": 1},
    {"description": "x" * 5_001, "captionMs": 1},
    {"description": "A cup.", "captionMs": -1},
    {"description": "A cup.", "captionMs": True},
    {"description": "A cup.", "captionMs": float("nan")},
    {"description": "A cup."},
])
@pytest.mark.asyncio
async def test_caption_resolver_rejects_invalid_backend_result(monkeypatch, response):
    original = httpx.AsyncClient
    monkeypatch.setattr(chat_runtime, "backend_settings_from_environment", lambda: (
        "https://backend.test", "scope",
    ))
    monkeypatch.setattr(chat_runtime.httpx, "AsyncClient", lambda **kwargs: original(
        **kwargs, transport=httpx.MockTransport(
            lambda request: httpx.Response(200, content=json.dumps(response),
                                          headers={"content-type": "application/json"})
        ),
    ))
    assert await chat_runtime.resolve_frame_caption(
        "a.b.c", HANDLE_VISUAL, "41", "42", 10,
    ) is None


@pytest.mark.asyncio
async def test_caption_resolver_sends_only_correlated_handle(monkeypatch):
    requests = []
    original = httpx.AsyncClient

    def handle(request):
        requests.append(request)
        return httpx.Response(200, json={"description": "A real cup.", "captionMs": 12})

    monkeypatch.setattr(chat_runtime, "backend_settings_from_environment", lambda: (
        "https://backend.test", "scope",
    ))
    monkeypatch.setattr(chat_runtime.httpx, "AsyncClient", lambda **kwargs: original(
        **kwargs, transport=httpx.MockTransport(handle),
    ))
    assert await chat_runtime.resolve_frame_caption(
        "a.b.c", HANDLE_VISUAL, "41", "42", 10,
    ) == {"description": "A real cup.", "captionMs": 12}
    assert requests[0].url.path == "/screen/frames/caption"
    assert json.loads(requests[0].content) == {
        "frameId": "frame_1", "sessionId": "41", "messageId": "42", "turnId": "legacy-turn",
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
            [ModelMessage("user", "x" * 400_001, (ModelImage(JPEG),))], "en"
        )] == []
    finally:
        current_visual_result.reset(token)
        await model.close()
    assert len(transport.responses.requests) == 1
    assert JPEG not in json.dumps(transport.responses.requests[0])
    assert result["visualReason"] == "image_context_limit"


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
    reservation_token = current_image_reservation.set({
        "sessionId": "41", "itemId": "frame_item",
    })
    try:
        assert [text async for text in model.complete_chat(
            [ModelMessage("user", "Caption", (ModelImage(JPEG),))], "en"
        )] == []
    finally:
        current_message_id.reset(message_token)
        current_image_reservation.reset(reservation_token)
        current_visual_result.reset(token)
        await model.close()
    assert len(transport.responses.requests) == 2
    assert JPEG in json.dumps(transport.responses.requests[0])
    assert JPEG not in json.dumps(transport.responses.requests[1])
    assert result["inputTokens"] == 100
    assert result["outputTokens"] == 20
    usages = [
        json.loads(request.content) for request in backend.requests
        if request.url.path == "/usage/foundry"
    ]
    assert usages[0]["imageReservation"] == {"sessionId": "41", "itemId": "frame_item"}
    assert "imageReservation" not in usages[1]


@pytest.mark.asyncio
async def test_unknown_image_usage_keeps_reservation_pending_without_a_fabricated_report():
    backend = FakeBackend()
    event = completed()
    event.response.usage = SimpleNamespace(input_tokens=None, output_tokens=None)
    model, _ = client([event], backend=backend)
    reservation_token = current_image_reservation.set({"sessionId": "41", "itemId": "frame_item"})
    try:
        assert [text async for text in model.complete_chat(
            [ModelMessage("user", "Caption", (ModelImage(JPEG),))], "en"
        )] == []
    finally:
        current_image_reservation.reset(reservation_token)
        await model.close()
    assert not [request for request in backend.requests if request.url.path == "/usage/foundry"]


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


@pytest.mark.parametrize("status,reason", [
    (429, "budget_exhausted"), (503, "budget_unavailable"),
])
def test_budget_denial_survives_image_resolution_into_chat_done(monkeypatch, status, reason):
    from jarvis_tools import current_chat_session_id

    async def context(*args):
        current_chat_session_id.set("41")
        return []

    def handle(request):
        assert json.loads(request.content)["turnId"] == "legacy-turn"
        return httpx.Response(status, json={
            "error": "private provider text", "code": reason, "turnId": "legacy-turn",
        })

    original_client = httpx.AsyncClient
    monkeypatch.setattr(chat_runtime, "backend_settings_from_environment", lambda: (
        "https://backend.test", "scope"
    ))
    monkeypatch.setattr(chat_runtime.httpx, "AsyncClient", lambda **kwargs: original_client(
        **kwargs, transport=httpx.MockTransport(handle)
    ))
    app, model = app_with(context)
    with TestClient(app) as browser:
        response = browser.post("/invocations", json={
            "messageId": "42", "sessionId": "41", "text": "What is this?", "language": "en",
            "delegatedAuthorization": AUTHORIZATION, "visualContext": VISUAL,
        })
    done = json.loads(response.text.split("event: done\ndata: ", 1)[1].split("\n", 1)[0])
    assert done.pop("agentTimings")["agent_first_delta"] >= 0
    assert done == {"visualPath": "caption", "visualReason": reason}
    assert not model.messages[-1].images
    assert "private provider text" not in response.text
    assert "frame_1" not in response.text


@pytest.mark.parametrize("body", [
    b"not JSON", json.dumps({"code": "unexpected_private_code"}).encode(),
    json.dumps({"code": []}).encode(),
    json.dumps({"code": "budget_exhausted", "error": "x" * 1_024}).encode(),
])
@pytest.mark.asyncio
async def test_resolver_ignores_untyped_or_oversized_budget_denials(monkeypatch, body):
    original_client = httpx.AsyncClient
    monkeypatch.setattr(chat_runtime, "backend_settings_from_environment", lambda: (
        "https://backend.test", "scope"
    ))
    monkeypatch.setattr(chat_runtime.httpx, "AsyncClient", lambda **kwargs: original_client(
        **kwargs, transport=httpx.MockTransport(lambda request: httpx.Response(
            429, headers={"content-type": "application/json"}, content=body,
        ))
    ))
    result = {"visualPath": "caption", "visualReason": "frame_unavailable"}
    token = current_visual_result.set(result)
    try:
        assert await chat_runtime.resolve_frame_image("a.b.c", VISUAL, "41", "42", 10) is None
    finally:
        current_visual_result.reset(token)
    assert result["visualReason"] == "frame_unavailable"


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
        assert current_image_reservation.get() == {"sessionId": "41", "itemId": "frame_1"}
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
    result = json.loads(done)
    assert result.pop("agentTimings")["agent_first_delta"] >= 0
    assert result == {
        "visualPath": "image", "model": "gpt-6-luna",
        "inputTokens": 100, "outputTokens": 20,
    }
    assert "frame_1" not in response.text
    assert JPEG not in response.text
    assert current_image_reservation.get() is None


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
    expected = visual_context_text({**VISUAL, "visualPath": "image"})
    assert any(message.content == expected for message in result)
    assert all(not message.images for message in result)
    assert all("frame_1" not in message.content for message in result)
    assert visual_context({**VISUAL, "visualPath": "image"})["visualPath"] == "image"
    assert visual_context({**VISUAL, "visualPath": []}) is None


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
