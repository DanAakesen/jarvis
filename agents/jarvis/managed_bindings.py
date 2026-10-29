"""Agent-authenticated durable native bindings; no credentials or retries created here."""

from __future__ import annotations

import re
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID

import httpx

from managed_copilot import ManagedChatError, ManagedTurnContext


def _source(value: str) -> bool:
    return (
        bool(re.fullmatch(r"[1-9][0-9]{0,18}", value)) and int(value) <= 9_223_372_036_854_775_807
    )


def _target(target: Any) -> dict[str, str]:
    values = {
        "agentName": target.agent_name,
        "model": target.model,
        "effort": target.reasoning_effort,
        "version": getattr(target, "agent_version", ""),
        "fingerprint": getattr(target, "fingerprint", ""),
    }
    if not all(isinstance(value, str) and value for value in values.values()) or not re.fullmatch(
        r"[0-9a-f]{64}", values["fingerprint"]
    ):
        raise ManagedChatError("managed_target_missing")
    return values


class BackendNativeBindings:
    """Inject the existing agent token callable and an owned, no-retry HTTP client.

    The server verifies its configured target and stored owner/source/session.
    Neither browser selection nor model arguments provide binding authority.
    The caller owns HTTP lifetime and existing timeout configuration.
    """

    def __init__(self, *, client: httpx.AsyncClient, token_provider: Any) -> None:
        if not client.base_url.host or client.base_url.scheme != "https":
            raise ManagedChatError("managed_backend_endpoint_invalid")
        self._client, self._token = client, token_provider

    @asynccontextmanager
    async def lease(self, context: ManagedTurnContext, target: Any):
        if not _source(context.session_id) or not _source(context.source_message_id):
            raise ManagedChatError("managed_source_context_missing")
        binding = _BackendBinding(self, context, _target(target))
        # Claims are persistent. An unknown/cancelled outcome is never released
        # implicitly by this context manager, nor made replayable by a retry.
        yield binding


class _BackendBinding:
    def __init__(self, owner: BackendNativeBindings, context: Any, target: dict[str, str]):
        self._owner, self._context, self._target = owner, context, target
        self._attempted = False
        self._claim_id: str | None = None
        self._finished = False
        self.conversation_id: str | None = None

    async def _post(self, operation: str, body: dict[str, Any]) -> httpx.Response:
        try:
            token = await self._owner._token()
            return await self._owner._client.post(
                f"/agent/runtime-tests/{self._context.session_id}/{operation}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "X-Jarvis-Message-ID": self._context.source_message_id,
                },
                json=body,
                follow_redirects=False,
            )
        except ManagedChatError:
            raise
        except Exception:
            raise ManagedChatError("managed_binding_unavailable") from None

    def _capability(self) -> str:
        if self._claim_id is None or self._finished:
            raise ManagedChatError("managed_claim_missing")
        return self._claim_id

    async def claim_turn(self, source_message_id: str) -> bool:
        if source_message_id != self._context.source_message_id:
            raise ManagedChatError("managed_source_context_missing")
        if self._attempted:
            return False
        self._attempted = True
        response = await self._post("claim", {"target": self._target})
        if response.status_code in {404, 409}:
            return False
        if response.status_code != 200 or len(response.content) > 4096:
            raise ManagedChatError("managed_binding_unavailable")
        try:
            payload = response.json()
            claim_id = payload["claimId"]
            native_id = payload["nativeConversationId"]
            if (
                not isinstance(claim_id, str)
                or str(UUID(claim_id)) != claim_id
                or (
                    native_id is not None
                    and (
                        not isinstance(native_id, str)
                        or not 1 <= len(native_id) <= 512
                        or any(ord(char) < 32 or ord(char) == 127 for char in native_id)
                    )
                )
            ):
                raise ValueError
        except (ValueError, TypeError, KeyError):
            raise ManagedChatError("managed_binding_invalid") from None
        self._claim_id, self.conversation_id = claim_id, native_id
        return True

    async def bind(self, conversation_id: str) -> None:
        response = await self._post(
            "bind", {"claimId": self._capability(), "nativeConversationId": conversation_id}
        )
        if response.status_code != 204:
            raise ManagedChatError("managed_binding_unavailable")
        self.conversation_id = conversation_id

    async def attach_source(self, source_message_id: str) -> bool:
        capability = self._capability()
        if not _source(source_message_id):
            raise ManagedChatError("managed_source_context_missing")
        if source_message_id == self._context.source_message_id:
            return True
        response = await self._post(
            "source", {"claimId": capability, "additionalSourceMessageId": source_message_id}
        )
        if response.status_code in {404, 409}:
            return False
        if response.status_code != 204:
            raise ManagedChatError("managed_binding_unavailable")
        return True

    async def finish_turn(self, source_message_id: str, success: bool) -> None:
        if source_message_id != self._context.source_message_id:
            raise ManagedChatError("managed_source_context_missing")
        response = await self._post(
            "finish",
            {"claimId": self._capability(), "outcome": "succeeded" if success else "failed"},
        )
        if response.status_code != 204:
            raise ManagedChatError("managed_binding_unavailable")
        self._finished = True
