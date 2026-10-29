# Copyright (c) Microsoft. All rights reserved.
"""Lazy managed text runtime using the retained bridge's existing resources."""
from __future__ import annotations

import asyncio
import copy
import json
from collections.abc import AsyncIterator
from contextlib import aclosing, asynccontextmanager
from urllib.parse import quote

import httpx
from openai import APITimeoutError, AsyncOpenAI

from jarvis_tools import (
    MAX_RESPONSE_BYTES,
    current_chat_input_start,
    current_chat_session_id,
    current_message_id,
    model_tools,
)
from managed_bindings import BackendNativeBindings
from managed_copilot import (
    AGENT_PREVIEW_HEADER,
    TOKEN_SCOPE,
    ManagedChatError,
    agent_client_options,
)
from managed_copilot_definition import validate_managed_agent_version
from managed_definition_fingerprint import (
    managed_definition_fingerprint,
    normalized_managed_definition,
)
from managed_policy_client import (
    ManagedPolicyClient,
    ManagedPolicyTarget,
    ManagedPolicyTurnContext,
    NativeInputCursor,
)
from model_client import AzureOpenAIResponsesClient, chat_model_tools, responses_base_url
from model_contract import ModelStreamChunk
from state import ModelSettings


@asynccontextmanager
async def _owned(client, cleanup_seconds):
    try:
        yield client
    finally:
        async with asyncio.timeout(cleanup_seconds):
            if isinstance(client, httpx.AsyncClient):
                await client.aclose()
            else:
                await client.close()


class _SeedBinding:
    """Record only whether this claim created and durably bound a new native ID."""

    def __init__(self, binding):
        self._binding, self.new_native = binding, False

    def __getattr__(self, name):
        return getattr(self._binding, name)

    async def bind(self, conversation_id):
        await self._binding.bind(conversation_id)
        self.new_native = True


class _SeedBindings:
    def __init__(self, bindings):
        self._bindings = bindings

    @asynccontextmanager
    async def lease(self, context, target):
        async with self._bindings.lease(context, target) as binding:
            yield _SeedBinding(binding)


class _FirstSeedCursor(NativeInputCursor):
    def take(self, inputs):
        if self.sent_count is None:
            if (len(inputs) < self.initial_message_count + 1
                    or any(item.get("role") not in {"user", "assistant"} for item in inputs)):
                raise ManagedChatError("managed_seed_input_invalid")
            self.sent_count = len(inputs)
            return copy.deepcopy(inputs)
        return super().take(inputs)


class _SeededPolicyClient(ManagedPolicyClient):
    async def _create_response(self, request):
        turn = self._native_turn.get()
        if turn.cursor.sent_count is None and turn.binding.new_native:
            # Initial native context includes the same verified SQL rolling/history
            # reference inputs Current receives. Never repeat them on resumed natives.
            turn.cursor = _FirstSeedCursor(turn.cursor.initial_message_count, 0)
        return await super()._create_response(request)


class LazyManagedRuntime:
    """No network or credentials touched until the selected managed text turn.

    Injected Current owns credential/backend lifetime. Every managed turn owns and
    closes its additional HTTP/SDK clients. No agents/roles are created here.
    """

    def __init__(self, current: AzureOpenAIResponsesClient, *, transport=None):
        self._current, self._transport = current, transport
        self.model_name, self.server_address = current.model_name, current.server_address

    async def session_settings(self) -> ModelSettings:
        return await self._current.session_settings()

    async def close(self):
        """Current resources are retained and owned by the normal application."""

    async def complete(self, messages, *, settings=None) -> AsyncIterator[ModelStreamChunk]:
        raise ManagedChatError("managed_voice_requires_backend_relay")
        yield ""  # pragma: no cover

    @staticmethod
    def _context():
        context = ManagedPolicyTurnContext(
            current_chat_session_id.get(), current_message_id.get(), current_chat_input_start.get(),
        )
        if (not context.session_id or not context.source_message_id
                or type(context.current_input_start) is not int):
            raise ManagedChatError("managed_source_context_missing")
        return context

    @staticmethod
    async def _json(client, url, headers, *, params=None, timeout_seconds):
        try:
            async with client.stream("GET", url, headers=headers, params=params,
                                     follow_redirects=False, timeout=timeout_seconds) as response:
                if response.status_code in {401, 403}:
                    error = ManagedChatError(
                        "managed_readback_forbidden" if response.status_code == 403
                        else "managed_readback_unauthorized",
                    )
                    error.status_code = response.status_code
                    raise error
                if response.status_code != 200:
                    raise ManagedChatError("managed_readback_unavailable")
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_RESPONSE_BYTES:
                        raise ManagedChatError("managed_readback_invalid")
            result = json.loads(body)
            if not isinstance(result, dict):
                raise ValueError
            return result
        except ManagedChatError:
            raise
        except Exception:
            raise ManagedChatError("managed_readback_unavailable") from None

    @asynccontextmanager
    async def _prepared(self, settings):
        backend = self._current._tools
        credential = self._current._credential
        if credential is None:
            raise ManagedChatError("managed_existing_credential_unavailable")
        timeout = settings.backend_http_timeout_seconds
        async with _owned(httpx.AsyncClient(
            base_url=backend._base_url, timeout=timeout, follow_redirects=False,
            transport=self._transport,
        ), timeout) as backend_http:
            dto = await self._json(backend_http, "/agent/runtime-tests/target", {
                "Authorization": "Bearer " + await backend._token(),
            }, timeout_seconds=timeout)
            try:
                endpoint, fields = dto["projectEndpoint"], dto["target"]
                definition = normalized_managed_definition(dto["definition"])
                target = ManagedPolicyTarget(fields["agentName"], fields["model"], fields["effort"],
                                             fields["version"], fields["fingerprint"])
                target.validate(settings)
                if responses_base_url(endpoint).rstrip("/") != str(
                    self._current._client.base_url
                ).rstrip("/"):
                    raise ManagedChatError("managed_project_endpoint_mismatch")
                if managed_definition_fingerprint(
                    endpoint, target.agent_name, target.agent_version, definition,
                ) != target.fingerprint:
                    raise ManagedChatError("managed_reviewed_fingerprint_mismatch")
            except ManagedChatError:
                raise
            except Exception:
                raise ManagedChatError("managed_target_invalid") from None

            async def token():
                return (await credential.get_token(TOKEN_SCOPE)).token

            bindings = _SeedBindings(BackendNativeBindings(client=backend_http,
                                                           token_provider=backend._token))
            async with _owned(httpx.AsyncClient(
                timeout=self._current._client.timeout, follow_redirects=False,
                transport=self._transport,
            ), timeout) as provider_http:
                async def verify(verified_target, requested, tools):
                    try:
                        headers = {"Authorization": "Bearer " + await token(),
                                   "Foundry-Features": AGENT_PREVIEW_HEADER}
                        path = endpoint.rstrip("/") + "/agents/" + quote(target.agent_name, safe="")
                        readback = await self._json(
                            provider_http, path + "/versions/"
                            + quote(target.agent_version, safe=""),
                            headers, params={"api-version": "v1"}, timeout_seconds=timeout,
                        )
                        actual_definition = normalized_managed_definition(readback["definition"])
                        validate_managed_agent_version(
                            {**readback, "definition": actual_definition},
                            expected_version=target.agent_version, target=verified_target,
                            settings=requested, instructions=definition.get("instructions", ""),
                            function_tools=tools,
                        )
                        if actual_definition != definition:
                            raise ManagedChatError("managed_reviewed_definition_mismatch")
                        if managed_definition_fingerprint(
                            endpoint, target.agent_name, readback["version"], actual_definition,
                        ) != target.fingerprint:
                            raise ManagedChatError("managed_reviewed_fingerprint_mismatch")
                        agent = await self._json(provider_http, path, headers,
                                                 params={"api-version": "v1"},
                                                 timeout_seconds=timeout)
                        rules = agent.get("agent_endpoint", {}).get("version_selector", {}).get(
                            "version_selection_rules")
                        if (agent.get("name") != target.agent_name
                                or agent.get("state") != "enabled"
                                or agent.get("configuration_state") != "enabled" or rules != [{
                                    "agent_version": target.agent_version,
                                    "traffic_percentage": 100,
                                    "type": "FixedRatio",
                                }]):
                            raise ManagedChatError("managed_endpoint_selector_mismatch")
                    except ManagedChatError:
                        raise
                    except Exception:
                        raise ManagedChatError("managed_readback_invalid") from None

                async with _owned(AsyncOpenAI(
                    api_key=token, http_client=provider_http, timeout=self._current._client.timeout,
                    **agent_client_options(endpoint, target.agent_name),
                ), timeout) as sdk:
                    yield sdk, target, bindings, verify

    async def complete_chat(
        self, messages, language, *, settings=None, reflex_note=None, smoke=False,
    ) -> AsyncIterator[ModelStreamChunk]:
        if smoke:
            raise ManagedChatError("managed_policy_smoke_unavailable")
        context = self._context()
        settings = settings or await self.session_settings()
        async with self._prepared(settings) as (sdk, target, bindings, verify):
            model = _SeededPolicyClient(
                client=sdk, backend=self._current._tools, target=target, bindings=bindings,
                context_provider=lambda: context, definition_verifier=verify,
            )
            async with aclosing(model.complete_chat(
                messages, language, settings=settings, reflex_note=reflex_note,
            )) as stream:
                async for chunk in stream:
                    yield chunk

    async def probe_target(self):
        """Fixed synthetic text canary, never a user turn or a function executor.

        Caller owns the existing 210-second invocation deadline. Only the freshly
        created canary conversation may be deleted; cleanup is bounded/best effort.
        """
        try:
            settings = await self.session_settings()
            if (settings.model, settings.reasoning_effort) != ("gpt-6.1-terra", "high"):
                raise ManagedChatError("managed_probe_settings_mismatch")
            async with self._prepared(settings) as (sdk, target, _bindings, verify):
                await verify(target, settings, chat_model_tools(model_tools(
                    await self._current._tools.tools(),
                )))
                native_id = None
                try:
                    native = await sdk.conversations.create()
                    if not isinstance(native.id, str) or not native.id:
                        raise ManagedChatError("managed_probe_conversation_missing")
                    native_id = native.id
                    stream = await sdk.responses.create(
                        conversation=native_id,
                        input="Reply with the single word OK. Do not call tools.", stream=True,
                    )
                    seen_text, completed = False, False
                    try:
                        async for event in stream:
                            if event.type == "response.output_text.delta":
                                seen_text = seen_text or bool(event.delta.strip())
                            elif event.type == "response.completed":
                                if event.response.status != "completed":
                                    raise ManagedChatError("managed_probe_incomplete")
                                if any(item.type not in {"message", "reasoning"}
                                       for item in event.response.output):
                                    raise ManagedChatError("managed_probe_requested_tool")
                                completed = True
                            elif event.type in {"error", "response.failed", "response.incomplete"}:
                                raise ManagedChatError("managed_probe_incomplete")
                    finally:
                        async with asyncio.timeout(settings.backend_http_timeout_seconds):
                            await stream.close()
                    if not completed or not seen_text:
                        raise ManagedChatError("managed_probe_empty_or_unfinished")
                    return {"status": "ok", "model": target.model,
                            "reasoningEffort": target.reasoning_effort}
                finally:
                    if native_id is not None:
                        try:
                            async with asyncio.timeout(settings.backend_http_timeout_seconds):
                                await sdk.conversations.delete(native_id)
                        except Exception:
                            pass  # Best effort; never delete another or guessed conversation.
        except asyncio.CancelledError:
            raise
        except Exception as error:
            status = getattr(error, "status_code", None)
            if isinstance(error, ManagedChatError):
                result = {"status": "unavailable", "reason": error.code}
                if status in {401, 403}:
                    result["httpStatus"] = status
                return result
            if status in {401, 403}:
                return {"status": "unavailable", "reason": (
                    "managed_model_forbidden" if status == 403 else "managed_model_unauthorized"
                ), "httpStatus": status}
            if isinstance(error, (TimeoutError, httpx.TimeoutException, APITimeoutError)):
                return {"status": "unavailable", "reason": "managed_probe_timeout"}
            return {"status": "unavailable", "reason": "managed_probe_failed"}
