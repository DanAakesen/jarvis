# Copyright (c) Microsoft. All rights reserved.
"""Retain Jarvis application policy while using the managed native protocol.

This adapter shares _complete rather than copying its authorization-adjacent
calendar, identity, receipt, source, steering, mode and usage behavior.
"""
from __future__ import annotations

import asyncio
import copy
import re
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from contextlib import aclosing
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

from jarvis_tools import BackendToolClient, current_message_id, model_tools
from managed_copilot import ManagedChatError, ManagedTarget, NativeConversationBindings
from model_client import MAX_OUTPUT_TOKENS, AzureOpenAIResponsesClient, chat_model_tools
from model_contract import ModelStreamChunk
from state import ModelMessage, ModelSettings


@dataclass(frozen=True)
class ManagedPolicyTarget(ManagedTarget):
    agent_version: str
    fingerprint: str

    def validate(self, settings: ModelSettings) -> None:
        super().validate(settings)
        if not self.agent_version or not re.fullmatch(r"[0-9a-f]{64}", self.fingerprint):
            raise ManagedChatError("managed_immutable_target_missing")


@dataclass(frozen=True)
class ManagedPolicyTurnContext:
    """Verified runtime boundary; supplemental inputs are part of the current turn.

    current_input_start indexes messages before adding this turn's visual,
    attachment and caption reference messages. Earlier messages are native history.
    """

    session_id: str
    source_message_id: str
    current_input_start: int


@dataclass
class NativeInputCursor:
    initial_message_count: int
    current_input_start: int
    sent_count: int | None = None

    def take(self, inputs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if self.sent_count is None:
            # Shared _complete prepends exactly one trusted backend context item.
            if len(inputs) < self.initial_message_count + 1:
                raise ManagedChatError("managed_input_boundary_invalid")
            selected = [inputs[0], *inputs[self.current_input_start + 1:]]
        else:
            if len(inputs) < self.sent_count:
                raise ManagedChatError("managed_input_cursor_rewound")
            selected = inputs[self.sent_count:]
        self.sent_count = len(inputs)
        result = []
        for item in selected:
            if item.get("type") == "function_call_output" or item.get("role") == "user":
                result.append(copy.deepcopy(item))
            elif item.get("type") not in {"message", "reasoning", "function_call"}:
                raise ManagedChatError("managed_input_item_unsupported")
        if not result:
            raise ManagedChatError("managed_input_empty")
        return result


@dataclass
class _Turn:
    binding: Any
    cursor: NativeInputCursor
    settings: ModelSettings
    registered_tools: list[dict[str, Any]]
    sources: list[str] = field(default_factory=list)


class _CheckedStream:
    """Retain real SDK stream lifecycle with stricter native terminal validation."""

    def __init__(self, stream: Any, cleanup_seconds: int, *, allow_function_calls: bool = True):
        self.stream, self.cleanup_seconds = stream, cleanup_seconds
        self.allow_function_calls = allow_function_calls

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        async with asyncio.timeout(self.cleanup_seconds):
            await self.stream.close()

    async def __aiter__(self):
        completed = False
        seen_text = False
        async for event in self.stream:
            if (not self.allow_function_calls
                    and event.type in {"response.output_item.added", "response.output_item.done"}
                    and getattr(getattr(event, "item", None), "type", None) == "function_call"):
                raise ManagedChatError("managed_final_only_tool_call")
            if event.type == "response.output_text.delta" and event.delta:
                seen_text = True
            if event.type == "response.completed":
                final = event.response
                if final.status != "completed":
                    raise ManagedChatError("managed_response_unfinished")
                for item in final.output:
                    if item.type == "function_call" and not self.allow_function_calls:
                        raise ManagedChatError("managed_final_only_tool_call")
                    if item.type not in {"message", "reasoning", "function_call"}:
                        raise ManagedChatError("managed_response_item_unsupported")
                    if (item.type == "function_call"
                            and getattr(item, "status", None) != "completed"):
                        raise ManagedChatError("managed_tool_call_unfinished")
                if not seen_text and not any(item.type == "function_call" for item in final.output):
                    raise ManagedChatError("managed_response_empty")
                completed = True
            elif event.type == "response.failed":
                raise ManagedChatError("managed_response_failed")
            elif event.type in {"error", "response.incomplete"}:
                raise ManagedChatError("managed_response_unfinished")
            yield event
        if not completed:
            raise ManagedChatError("managed_response_unfinished")


class ManagedPolicyClient(AzureOpenAIResponsesClient):
    """Managed transport under the exact existing Jarvis application loop.

    No environment factory, agent provisioning, defaults switch or private voice
    route. Application owns injected clients, durable leases and overall deadline.
    """

    def __init__(
        self, *, client: Any, backend: BackendToolClient, target: ManagedPolicyTarget,
        bindings: NativeConversationBindings,
        context_provider: Callable[[], ManagedPolicyTurnContext],
        definition_verifier: Callable[
            [ManagedPolicyTarget, ModelSettings, Sequence[dict[str, Any]]], Awaitable[None]
        ],
    ):
        if getattr(client, "max_retries", None) != 0:
            raise ManagedChatError("managed_client_retries_enabled")
        self._target, self._bindings = target, bindings
        self._context_provider, self._definition_verifier = context_provider, definition_verifier
        self._native_turn: ContextVar[_Turn] = ContextVar("managed_policy_turn")
        super().__init__(
            client=client, credential=None, model_name=target.model,
            server_address=str(getattr(client, "base_url", "")),
            system_prompt="", max_output_tokens=MAX_OUTPUT_TOKENS, tools=backend,
            reasoning_effort=target.reasoning_effort,
        )

    async def session_settings(self) -> ModelSettings:
        settings = await super().session_settings()
        self._target.validate(settings)
        return settings

    async def close(self) -> None:
        """The application owns all injected clients and their resource lifetime."""

    async def summarize_conversation(self, instructions: str, prompt: str):
        raise ManagedChatError("managed_summary_history_policy_pending")

    async def complete(self, messages, *, settings=None) -> AsyncIterator[ModelStreamChunk]:
        raise ManagedChatError("managed_voice_requires_backend_relay")
        yield ""  # pragma: no cover

    async def complete_chat(
        self, messages: Sequence[ModelMessage], language: str, *,
        settings: ModelSettings | None = None, reflex_note: str | None = None,
        smoke: bool = False,
    ) -> AsyncIterator[ModelStreamChunk]:
        if smoke:
            raise ManagedChatError("managed_policy_smoke_unavailable")
        settings = settings or await self.session_settings()
        self._target.validate(settings)
        context = self._context_provider()
        if (not context.session_id or not context.source_message_id or not messages
                or messages[-1].role != "user"
                or messages[-1].source_message_id != context.source_message_id
                or type(context.current_input_start) is not int
                or not 0 <= context.current_input_start < len(messages)):
            raise ManagedChatError("managed_source_context_missing")
        if any(message.images for message in messages):
            # No caption replay after a potentially accepted native request.
            raise ManagedChatError("managed_policy_image_unverified")
        catalogue = chat_model_tools(model_tools(await self._tools.tools()))
        await self._definition_verifier(self._target, settings, catalogue)
        async with self._bindings.lease(context, self._target) as binding:
            if not await binding.claim_turn(context.source_message_id):
                raise ManagedChatError("managed_turn_already_claimed")
            turn = _Turn(binding, NativeInputCursor(len(messages), context.current_input_start),
                         settings, copy.deepcopy(catalogue), [context.source_message_id])
            success: bool | None = None
            calls_before = self._tools.calls
            native_token = self._native_turn.set(turn)
            source_token = current_message_id.set(context.source_message_id)
            try:
                if not binding.conversation_id:
                    native = await self._client.conversations.create()
                    if not native.id:
                        raise ManagedChatError("managed_conversation_missing")
                    await binding.bind(native.id)
                async with aclosing(super().complete_chat(
                    messages, language, settings=settings, reflex_note=reflex_note,
                )) as stream:
                    async for chunk in stream:
                        yield chunk
                success = True
            except (asyncio.CancelledError, GeneratorExit):
                raise
            except ManagedChatError as error:
                if error.code == "managed_response_failed" and self._tools.calls == calls_before:
                    success = False
                raise
            except Exception:
                raise ManagedChatError("managed_policy_turn_failed") from None
            finally:
                current_message_id.reset(source_token)
                self._native_turn.reset(native_token)
                if success is not None:
                    async with asyncio.timeout(settings.backend_http_timeout_seconds):
                        await binding.finish_turn(context.source_message_id, success)

    async def _create_response(self, request: dict[str, Any]) -> Any:
        turn = self._native_turn.get()
        self._target.validate(ModelSettings(request["model"],
                                            request.get("reasoning", {}).get("effort", "")))
        if "tools" in request and request["tools"] != turn.registered_tools:
            raise ManagedChatError("managed_policy_catalogue_changed")
        source = current_message_id.get()
        if not source:
            raise ManagedChatError("managed_source_context_missing")
        if source not in turn.sources:
            attach = getattr(turn.binding, "attach_source", None)
            if attach is None or not await attach(source):
                raise ManagedChatError("managed_steering_source_unclaimed")
            turn.sources.append(source)
        native_request = {
            "conversation": turn.binding.conversation_id,
            "input": turn.cursor.take(request["input"]),
            "instructions": request["instructions"], "stream": True,
        }
        stream = await self._client.responses.create(**native_request)
        return _CheckedStream(
            stream, turn.settings.backend_http_timeout_seconds,
            allow_function_calls=bool(request.get("tools")),
        )
