# Copyright (c) Microsoft. All rights reserved.
"""HTTP Responses bridge for an explicitly configured managed Copilot prompt agent.

Persistence, source verification and serialization are supplied by the application;
this module neither creates an agent nor grants permission to a requested tool.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from contextlib import AbstractAsyncContextManager, aclosing
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlsplit

from jarvis_tools import BackendToolClient, model_tools
from model_contract import AcknowledgmentBoundary, ModelStreamChunk
from state import ModelMessage, ModelSettings

# Exact agent-scoped default from azure-ai-projects 2.9.0 _patch helpers.
AGENT_PREVIEW_HEADER = ",".join((
    "WorkflowAgents=V1Preview", "ExternalAgents=V1Preview", "DraftAgents=V1Preview",
    "VoiceAgents=V1Preview", "DigitalWorker=V1Preview", "GitHubCopilot=V1Preview",
    "Skills=V1Preview", "MicrosoftCopilot=V1Preview", "ModelRouterControls=V1Preview",
))
TOKEN_SCOPE = "https://ai.azure.com/.default"


class ManagedChatError(RuntimeError):
    """Fixed safe diagnostics; never include provider payloads or exceptions."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class ManagedTarget:
    agent_name: str
    model: str
    reasoning_effort: str

    def validate(self, settings: ModelSettings) -> None:
        if not all((self.agent_name, self.model, self.reasoning_effort)):
            raise ManagedChatError("managed_target_missing")
        if (settings.model, settings.reasoning_effort) != (self.model, self.reasoning_effort):
            raise ManagedChatError("managed_target_settings_mismatch")


@dataclass(frozen=True)
class ManagedTurnContext:
    """Application-verified context, never inferred from provider output."""

    session_id: str
    source_message_id: str
    instructions: str


class NativeConversationBinding(Protocol):
    """Durable state within an exclusive session lease.

    claim_turn must atomically reject any previously claimed source, including an
    interrupted turn. bind must persist before inference. finish_turn records a
    terminal result; false requires explicit recovery, never automatic replay.
    Lease ownership must survive/deny competing workers for its full lifetime.
    """

    conversation_id: str | None

    async def bind(self, conversation_id: str) -> None: ...
    async def claim_turn(self, source_message_id: str) -> bool: ...
    async def finish_turn(self, source_message_id: str, success: bool) -> None: ...


class NativeConversationBindings(Protocol):
    def lease(
        self, context: ManagedTurnContext, target: ManagedTarget,
    ) -> AbstractAsyncContextManager[NativeConversationBinding]: ...


def agent_client_options(project_endpoint: str, agent_name: str) -> dict[str, Any]:
    """Configure existing AsyncOpenAI with the existing credential token callable.

    Authentication callable uses TOKEN_SCOPE. No azure-ai-projects dependency is
    necessary. Disable SDK retries because action outcome may be uncertain.
    """
    endpoint = urlsplit(project_endpoint)
    if (endpoint.scheme != "https" or not endpoint.hostname or endpoint.query
            or endpoint.fragment or endpoint.username or endpoint.password
            or not re.fullmatch(r"[A-Za-z0-9_-]+", agent_name)):
        raise ManagedChatError("managed_endpoint_invalid")
    return {
        "base_url": (project_endpoint.rstrip("/")
                     + f"/agents/{agent_name}/endpoint/protocols/openai"),
        "default_query": {"api-version": "v1"},
        "default_headers": {"Foundry-Features": AGENT_PREVIEW_HEADER},
        "max_retries": 0,
    }


def _get(value: Any, name: str, default: Any = None) -> Any:
    return value.get(name, default) if isinstance(value, dict) else getattr(value, name, default)


class ManagedCopilotClient:
    """Existing streaming contract with durable, application-owned continuity.

    Inject an agent-scoped AsyncOpenAI (max_retries=0); its lifecycle belongs to
    the caller. context_provider must capture the actual authorized current turn.
    """

    def __init__(
        self, *, client: Any, backend: BackendToolClient, target: ManagedTarget,
        bindings: NativeConversationBindings,
        context_provider: Callable[[], ManagedTurnContext],
        settings_provider: Callable[[], Awaitable[ModelSettings]],
        definition_verifier: Callable[
            [ManagedTarget, ModelSettings, Sequence[dict[str, Any]]], Awaitable[None]
        ],
        turn_timeout_seconds: float = 360, cleanup_timeout_seconds: float = 5,
        max_tool_rounds: int = 12,
    ) -> None:
        if turn_timeout_seconds <= 0 or cleanup_timeout_seconds <= 0 or max_tool_rounds < 1:
            raise ManagedChatError("managed_limits_invalid")
        if getattr(client, "max_retries", None) != 0:
            raise ManagedChatError("managed_client_retries_enabled")
        self._client, self._backend, self._target = client, backend, target
        self._bindings, self._context = bindings, context_provider
        self._settings = settings_provider
        self._verify_definition = definition_verifier
        self._timeout, self._cleanup_timeout = turn_timeout_seconds, cleanup_timeout_seconds
        self._max_rounds = max_tool_rounds
        self.model_name = target.model
        self.server_address = str(getattr(client, "base_url", ""))

    async def session_settings(self) -> ModelSettings:
        settings = await self._settings()
        self._target.validate(settings)
        return settings

    async def close(self) -> None:
        """Injected HTTP/backend clients remain owned by their application."""

    async def complete(
        self, messages: Sequence[ModelMessage], *, settings: ModelSettings | None = None,
    ) -> AsyncIterator[ModelStreamChunk]:
        raise ManagedChatError("managed_voice_requires_backend_relay")
        yield ""  # pragma: no cover

    async def complete_chat(
        self, messages: Sequence[ModelMessage], language: str, *,
        settings: ModelSettings | None = None, reflex_note: str | None = None,
    ) -> AsyncIterator[ModelStreamChunk]:
        settings = settings or await self.session_settings()
        self._target.validate(settings)
        context = self._context()
        if (not context.session_id or not context.source_message_id or not context.instructions
                or not messages or messages[-1].role != "user"
                or messages[-1].source_message_id != context.source_message_id):
            raise ManagedChatError("managed_source_context_missing")
        # Refuse unsupported modalities rather than silently dropping content.
        if messages[-1].images or reflex_note:
            raise ManagedChatError("managed_input_unsupported")
        async with asyncio.timeout(self._timeout):
            tools = model_tools(await self._backend.tools())
            for tool in tools:
                if tool.get("strict") is True or "___" in tool.get("name", ""):
                    raise ManagedChatError("managed_tool_schema_unsupported")
            await self._verify_definition(self._target, settings, tools)
            async with self._bindings.lease(context, self._target) as binding:
                if not await binding.claim_turn(context.source_message_id):
                    raise ManagedChatError("managed_turn_already_claimed")
                success = False
                try:
                    if not binding.conversation_id:
                        conversation = await self._client.conversations.create()
                        conversation_id = _get(conversation, "id")
                        if not conversation_id:
                            raise ManagedChatError("managed_conversation_missing")
                        await binding.bind(conversation_id)
                    async with aclosing(self._run(
                        messages[-1], context, binding.conversation_id, tools,
                    )) as chunks:
                        async for chunk in chunks:
                            yield chunk
                    success = True
                except (asyncio.CancelledError, GeneratorExit):
                    raise
                except ManagedChatError:
                    raise
                except Exception:
                    raise ManagedChatError("managed_provider_failure") from None
                finally:
                    # Do not allow a failed/cancelled action turn to become replayable.
                    async with asyncio.timeout(self._cleanup_timeout):
                        await binding.finish_turn(context.source_message_id, success)

    async def _run(
        self, message: ModelMessage, context: ManagedTurnContext, conversation_id: str,
        tools: Sequence[dict[str, Any]],
    ) -> AsyncIterator[ModelStreamChunk]:
        allowed = {tool["name"] for tool in tools}
        inputs: list[dict[str, Any]] = [{"role": "user", "content": message.content}]
        seen_ids: set[str] = set()
        seen_actions: set[str] = set()
        for _ in range(self._max_rounds + 1):
            stream = await self._client.responses.create(
                conversation=conversation_id, input=inputs, instructions=context.instructions,
                stream=True,
            )
            final = None
            text = ""
            try:
                async for event in stream:
                    kind = _get(event, "type")
                    if kind == "response.output_text.delta":
                        delta = _get(event, "delta", "")
                        text += delta
                        yield delta
                    elif kind == "response.completed":
                        final = _get(event, "response")
                    elif kind in {"error", "response.failed", "response.incomplete"}:
                        raise ManagedChatError("managed_response_failed")
            finally:
                async with asyncio.timeout(self._cleanup_timeout):
                    await stream.close()
            if final is None or _get(final, "status") != "completed":
                raise ManagedChatError("managed_response_unfinished")
            calls = [item for item in _get(final, "output", [])
                     if _get(item, "type") == "function_call"]
            if not calls:
                if not text:
                    raise ManagedChatError("managed_response_empty")
                return
            if _ == self._max_rounds:
                raise ManagedChatError("managed_tool_round_limit")
            # Mark pre-tool speech as interim using the established runtime contract.
            if text:
                yield AcknowledgmentBoundary(text)
            inputs = []
            for call in calls:
                name, call_id, args = (_get(call, key) for key in ("name", "call_id", "arguments"))
                if (_get(call, "status", "completed") != "completed"
                        or name not in allowed or not isinstance(call_id, str)
                        or not call_id or not isinstance(args, str)):
                    raise ManagedChatError("managed_tool_call_invalid")
                try:
                    parsed = json.loads(args)
                except (ValueError, TypeError):
                    raise ManagedChatError("managed_tool_arguments_invalid") from None
                if not isinstance(parsed, dict):
                    raise ManagedChatError("managed_tool_arguments_invalid")
                fingerprint = hashlib.sha256(
                    (name + json.dumps(parsed, sort_keys=True)).encode()
                ).hexdigest()
                if call_id in seen_ids or fingerprint in seen_actions:
                    raise ManagedChatError("managed_tool_repeated")
                seen_ids.add(call_id)
                seen_actions.add(fingerprint)
                result = await self._backend.call(name, args, context.source_message_id)
                inputs.append({"type": "function_call_output", "call_id": call_id,
                               "output": json.dumps(result)})
