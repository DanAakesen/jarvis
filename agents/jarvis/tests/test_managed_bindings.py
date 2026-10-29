from types import SimpleNamespace

import httpx
import pytest

from managed_bindings import BackendNativeBindings
from managed_copilot import ManagedChatError, ManagedTurnContext

TARGET = SimpleNamespace(
    agent_name="test-agent",
    model="gpt-6.1-terra",
    reasoning_effort="high",
    agent_version="1",
    fingerprint="a" * 64,
)
CONTEXT = ManagedTurnContext("41", "42", "Synthetic instructions")
CLAIM = "23fb84c8-43e0-4658-980a-c8f18e425aab"


async def token():
    return "synthetic-agent-token"


@pytest.mark.asyncio
async def test_claim_binding_steering_and_terminal_use_same_private_capability():
    requests = []

    def handle(request):
        requests.append(request)
        assert request.headers["authorization"] == "Bearer synthetic-agent-token"
        assert request.headers["x-jarvis-message-id"] == "42"
        if request.url.path.endswith("claim"):
            return httpx.Response(200, json={"claimId": CLAIM, "nativeConversationId": None})
        return httpx.Response(204)

    async with httpx.AsyncClient(
        base_url="https://backend.test", transport=httpx.MockTransport(handle)
    ) as client:
        bindings = BackendNativeBindings(client=client, token_provider=token)
        async with bindings.lease(CONTEXT, TARGET) as binding:
            assert await binding.claim_turn("42")
            assert not await binding.claim_turn("42")
            await binding.bind("conv-synthetic")
            assert await binding.attach_source("43")
            await binding.finish_turn("42", True)
            with pytest.raises(ManagedChatError, match="managed_claim_missing"):
                await binding.bind("another-conversation")
    assert [request.url.path.rsplit("/", 1)[-1] for request in requests] == [
        "claim",
        "bind",
        "source",
        "finish",
    ]
    import json

    for request in requests[1:]:
        assert json.loads(request.content)["claimId"] == CLAIM


@pytest.mark.asyncio
async def test_unknown_claim_outcome_is_not_retried_or_released():
    requests = []

    def handle(request):
        requests.append(request)
        raise httpx.ReadTimeout("Private transport details")

    async with httpx.AsyncClient(
        base_url="https://backend.test", transport=httpx.MockTransport(handle)
    ) as client:
        async with BackendNativeBindings(client=client, token_provider=token).lease(
            CONTEXT, TARGET
        ) as binding:
            with pytest.raises(ManagedChatError, match="^managed_binding_unavailable$"):
                await binding.claim_turn("42")
            assert not await binding.claim_turn("42")
    assert len(requests) == 1


@pytest.mark.asyncio
async def test_redirect_does_not_forward_the_agent_token():
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(307, headers={"location": "https://untrusted.test/claim"})

    async with httpx.AsyncClient(
        base_url="https://backend.test",
        follow_redirects=True,
        transport=httpx.MockTransport(handle),
    ) as client:
        async with BackendNativeBindings(client=client, token_provider=token).lease(
            CONTEXT, TARGET
        ) as binding:
            with pytest.raises(ManagedChatError, match="managed_binding_unavailable"):
                await binding.claim_turn("42")
    assert len(requests) == 1


@pytest.mark.asyncio
async def test_cancelled_claim_holder_does_not_finish_implicitly():
    import asyncio

    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(
            200, json={"claimId": CLAIM, "nativeConversationId": "conv-synthetic"}
        )

    async with httpx.AsyncClient(
        base_url="https://backend.test", transport=httpx.MockTransport(handle)
    ) as client:
        with pytest.raises(asyncio.CancelledError):
            async with BackendNativeBindings(client=client, token_provider=token).lease(
                CONTEXT, TARGET
            ) as binding:
                assert await binding.claim_turn("42")
                assert binding.conversation_id == "conv-synthetic"
                raise asyncio.CancelledError
    assert len(requests) == 1
