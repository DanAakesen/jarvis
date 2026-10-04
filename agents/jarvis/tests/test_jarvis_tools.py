"""Tests for the backend tool-registry client (P4-02 contract)."""

from __future__ import annotations

import json
from collections.abc import Callable
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from jarvis_tools import (
    CATALOGUE_TTL_SECONDS,
    MAX_RESPONSE_BYTES,
    MAX_TOOLS,
    BackendToolClient,
    BackendUnavailable,
    api_scope,
    backend_base_url,
    backend_settings_from_environment,
    current_turn,
    model_tools,
)

TOKEN = "agent-token-secret"
CREATE_TASK = {
    "name": "create_task",
    "description": "Start a new coding task.",
    "inputSchema": {
        "type": "object",
        "properties": {"project": {"type": "string"}, "text": {"type": "string"}},
        "required": ["project", "text"],
        "additionalProperties": False,
    },
}
MEMORY_SEARCH = {
    "name": "memory_search",
    "description": "Find relevant source-linked memories.",
    "inputSchema": {
        "type": "object",
        "properties": {"query": {"type": "string"}},
        "required": ["query"],
        "additionalProperties": False,
    },
}


class Backend:
    """Records requests and answers like the backend's tool routes."""

    def __init__(
        self,
        catalogue: Any = None,
        call: Callable[[httpx.Request], httpx.Response] | None = None,
        settings: Any = None,
    ) -> None:
        self.catalogue = [CREATE_TASK] if catalogue is None else catalogue
        self.settings = (
            {"model": "gpt-5.6-luna", "reasoningEffort": "none"}
            if settings is None
            else settings
        )
        self.call = call or (
            lambda request: httpx.Response(
                200,
                json={
                    "tool": "create_task",
                    "outcome": "ok",
                    "result": {"id": 7, "state": "Ready"},
                    "confirmation": "Done: create_task succeeded.",
                },
            )
        )
        self.requests: list[httpx.Request] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.method == "GET" and request.url.path == "/tools":
            if isinstance(self.catalogue, httpx.Response):
                return self.catalogue
            return httpx.Response(200, json=self.catalogue)
        if request.method == "GET" and request.url.path == "/agent/settings":
            if isinstance(self.settings, httpx.Response):
                return self.settings
            return httpx.Response(200, json=self.settings)
        return self.call(request)


def make_client(
    backend: Backend, clock: Callable[[], float] = lambda: 0.0, token: Any = None
) -> BackendToolClient:
    async def default_token() -> str:
        return TOKEN

    return BackendToolClient(
        base_url="https://backend.example",
        token_provider=token or default_token,
        http=httpx.AsyncClient(transport=httpx.MockTransport(backend.handle)),
        clock=clock,
    )


async def test_lists_backend_tools_with_the_agent_token_and_maps_them_for_the_model() -> None:
    backend = Backend()
    client = make_client(backend)

    tools = await client.tools()

    (request,) = backend.requests
    assert request.method == "GET" and str(request.url) == "https://backend.example/tools"
    assert request.headers["authorization"] == "Bearer " + TOKEN
    assert model_tools(tools) == [
        {
            "type": "function",
            "name": "create_task",
            "description": "Start a new coding task.",
            "parameters": CREATE_TASK["inputSchema"],
            "strict": False,
        }
    ]
    await client.close()


async def test_new_backend_tools_appear_after_the_cache_expires() -> None:
    now = [0.0]
    backend = Backend()
    client = make_client(backend, clock=lambda: now[0])

    assert [tool.name for tool in await client.tools()] == ["create_task"]
    backend.catalogue = [
        CREATE_TASK,
        {"name": "pause_task", "description": "Pause.", "inputSchema": {"type": "object"}},
    ]
    now[0] = CATALOGUE_TTL_SECONDS - 1
    assert [tool.name for tool in await client.tools()] == ["create_task"]
    now[0] = CATALOGUE_TTL_SECONDS
    assert [tool.name for tool in await client.tools()] == ["create_task", "pause_task"]
    assert len(backend.requests) == 2


async def test_loads_effective_model_settings_for_a_new_session() -> None:
    backend = Backend(settings={"model": "gpt-5.6-luna", "reasoningEffort": "high"})
    client = make_client(backend)

    settings = await client.model_settings()

    request = backend.requests[0]
    assert request.method == "GET"
    assert str(request.url) == "https://backend.example/agent/settings"
    assert request.headers["authorization"] == "Bearer " + TOKEN
    assert (settings.model, settings.reasoning_effort) == ("gpt-5.6-luna", "high")


@pytest.mark.parametrize(
    "settings",
    [
        httpx.Response(503, json={"error": "unavailable"}),
        httpx.Response(200, content=b"not json"),
        {},
        {"model": "", "reasoningEffort": "none"},
        {"model": "x" * 101, "reasoningEffort": "none"},
        {"model": "deployment", "reasoningEffort": "unsupported"},
    ],
)
async def test_invalid_or_unavailable_model_settings_fail_session_start(settings: Any) -> None:
    client = make_client(Backend(settings=settings))

    with pytest.raises(BackendUnavailable):
        await client.model_settings()


@pytest.mark.parametrize(
    "catalogue",
    [
        httpx.Response(401, json={"error": "Unauthorized"}),
        httpx.Response(503, json={"error": "unavailable"}),
        httpx.Response(200, content=b"not json"),
        httpx.Response(200, content=b"x" * (MAX_RESPONSE_BYTES + 1)),
        {"tools": []},
        ["create_task"],
        [{**CREATE_TASK, "name": "../health"}],
        [{**CREATE_TASK, "description": " "}],
        [{**CREATE_TASK, "inputSchema": {"type": "array"}}],
        [CREATE_TASK, CREATE_TASK],
        [{**CREATE_TASK, "name": f"tool_{index}"} for index in range(MAX_TOOLS + 1)],
    ],
)
async def test_an_unusable_catalogue_fails_the_turn_visibly(catalogue: Any) -> None:
    client = make_client(Backend(catalogue))

    with pytest.raises(BackendUnavailable):
        await client.tools()

    assert client.diagnostics().startswith("backend tools: catalogue=not loaded")
    assert TOKEN not in client.diagnostics()


async def test_identity_failure_makes_the_catalogue_unavailable() -> None:
    async def failing_token() -> str:
        raise RuntimeError("credential secret detail")

    backend = Backend()
    client = make_client(backend, token=failing_token)

    with pytest.raises(BackendUnavailable):
        await client.tools()
    assert backend.requests == []
    assert "secret" not in client.diagnostics()


async def test_calls_a_tool_with_identity_and_message_id_and_relays_the_backend_result() -> None:
    backend = Backend()
    client = make_client(backend)
    await client.tools()

    result = await client.call("create_task", '{"project": "Jarvis", "text": "Dark mode"}', "42")

    request = backend.requests[-1]
    assert request.method == "POST"
    assert str(request.url) == "https://backend.example/tools/create_task"
    assert request.headers["authorization"] == "Bearer " + TOKEN
    assert request.headers["x-jarvis-message-id"] == "42"
    assert json.loads(request.content) == {"project": "Jarvis", "text": "Dark mode"}
    assert result == {
        "tool": "create_task",
        "outcome": "ok",
        "result": {"id": 7, "state": "Ready"},
        "confirmation": "Done: create_task succeeded.",
    }


async def test_voice_turn_passes_its_stored_transcript_item_id_to_tools() -> None:
    backend = Backend()
    client = make_client(backend)
    await client.tools()
    token = current_turn.set("item_abc123")
    try:
        await client.call("create_task", "{}", None)
    finally:
        current_turn.reset(token)

    request = backend.requests[-1]
    assert request.headers["x-jarvis-voice-item-id"] == "item_abc123"
    assert "x-jarvis-message-id" not in request.headers


async def test_voice_can_search_memory_without_a_persisted_source_message() -> None:
    backend = Backend(catalogue=[CREATE_TASK, MEMORY_SEARCH])
    client = make_client(backend)
    await client.tools()

    await client.call("memory_search", '{"query": "earlier decision"}', None)

    request = backend.requests[-1]
    assert request.url.path == "/tools/memory_search"
    assert "x-jarvis-message-id" not in request.headers
    assert "x-jarvis-voice-item-id" not in request.headers


async def test_relays_a_refused_backend_outcome_unchanged() -> None:
    refused = {
        "tool": "create_task",
        "outcome": "refused",
        "result": {"refused": "Project is archived."},
        "confirmation": "Not done: create_task was refused. Project is archived.",
    }
    client = make_client(Backend(call=lambda request: httpx.Response(200, json=refused)))
    await client.tools()

    assert await client.call("create_task", "{}", "42") == refused
    assert client.last_error == "create_task: refused"


@pytest.mark.parametrize(
    ("name", "arguments", "message_id", "expected"),
    [
        ("delete_everything", "{}", "42", "Unknown tool"),
        ("create_task", "{not json", "42", "not valid JSON"),
        ("create_task", "[]", "42", "must be an object"),
        ("create_task", "{}", None, "no stored conversation message"),
        ("create_task", "{}", "0", "no stored conversation message"),
        ("create_task", "{}", "9223372036854775808", "no stored conversation message"),
        ("create_task", "{}", "42; drop", "no stored conversation message"),
    ],
)
async def test_refuses_calls_the_backend_could_not_accept_without_sending_them(
    name: str, arguments: str, message_id: str | None, expected: str
) -> None:
    backend = Backend()
    client = make_client(backend)
    await client.tools()

    result = await client.call(name, arguments, message_id)

    assert result["outcome"] == "error" and expected in result["error"]
    assert "nothing was done" in result["error"]
    assert [request.method for request in backend.requests] == ["GET"]


async def test_call_before_a_loaded_catalogue_reports_it_unavailable() -> None:
    backend = Backend(catalogue=httpx.Response(403, json={"error": "Forbidden"}))
    client = make_client(backend)
    with pytest.raises(BackendUnavailable):
        await client.tools()

    result = await client.call("create_task", "{}", "42")

    assert result["outcome"] == "error"
    assert result["error"] == "The backend tool catalogue is unavailable; nothing was done."
    assert [request.method for request in backend.requests] == ["GET"]


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (400, "rejected the arguments"),
        (401, "refused Jarvis's identity"),
        (403, "refused Jarvis's identity"),
        (404, "does not have this tool"),
        (503, "cannot execute tools right now"),
        (500, "HTTP 500"),
        (302, "HTTP 302"),
    ],
)
async def test_backend_refusals_are_reported_as_errors(status: int, expected: str) -> None:
    backend = Backend(
        call=lambda request: httpx.Response(
            status, headers={"location": "https://elsewhere.example/steal"}, json={}
        )
    )
    client = make_client(backend)
    await client.tools()

    result = await client.call("create_task", "{}", "42")

    assert result == {"tool": "create_task", "outcome": "error", "error": result["error"]}
    assert expected in result["error"]
    assert all(request.url.host == "backend.example" for request in backend.requests)


@pytest.mark.parametrize(
    ("failure", "expected"),
    [
        (httpx.ReadTimeout("slow"), "may or may not have happened"),
        (httpx.WriteTimeout("slow"), "may or may not have happened"),
        (httpx.RemoteProtocolError("disconnected"), "may or may not have happened"),
        (httpx.ReadError("reset"), "may or may not have happened"),
        (httpx.ConnectError("down"), "could not be reached; nothing was done"),
        (httpx.ConnectTimeout("down"), "could not be reached; nothing was done"),
        (httpx.PoolTimeout("busy"), "could not be reached; nothing was done"),
    ],
)
async def test_transport_failures_are_reported_honestly(
    failure: Exception, expected: str
) -> None:
    def fail(request: httpx.Request) -> httpx.Response:
        raise failure

    client = make_client(Backend(call=fail))
    await client.tools()

    result = await client.call("create_task", "{}", "42")

    assert result["outcome"] == "error" and expected in result["error"]


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, content=b"not json"),
        httpx.Response(200, json=["ok"]),
        httpx.Response(200, json={"result": "done"}),
        httpx.Response(200, content=b"x" * (MAX_RESPONSE_BYTES + 1)),
    ],
)
async def test_unreadable_success_responses_are_not_reported_as_success(
    response: httpx.Response,
) -> None:
    client = make_client(Backend(call=lambda request: response))
    await client.tools()

    result = await client.call("create_task", "{}", "42")

    assert result["outcome"] == "error"
    assert "nothing was done" not in result["error"]


async def test_identity_failure_during_a_call_sends_nothing() -> None:
    calls = [0]

    async def token() -> str:
        calls[0] += 1
        if calls[0] > 1:
            raise RuntimeError("credential secret detail")
        return TOKEN

    backend = Backend()
    client = make_client(backend, token=token)
    await client.tools()

    result = await client.call("create_task", "{}", "42")

    assert "could not authenticate" in result["error"]
    assert [request.method for request in backend.requests] == ["GET"]


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("https://backend.example", "https://backend.example"),
        ("https://backend.example/", "https://backend.example"),
        ("http://localhost:3000", "http://localhost:3000"),
        ("http://127.0.0.1:3000/", "http://127.0.0.1:3000"),
    ],
)
def test_accepts_https_backend_origins_and_local_http(value: str, expected: str) -> None:
    assert backend_base_url(value) == expected


@pytest.mark.parametrize(
    "value",
    [
        "http://backend.example",
        "https://user:" + "pass@backend.example",
        "https://backend.example/api",
        "https://backend.example?x=1",
        "https://backend.example#fragment",
        "ftp://backend.example",
        "backend.example",
    ],
)
def test_rejects_unsafe_backend_urls(value: str) -> None:
    with pytest.raises(ValueError, match="JARVIS_BACKEND_URL"):
        backend_base_url(value)


def test_requests_an_app_only_token_for_the_jarvis_api() -> None:
    assert (
        api_scope("9F751B64-EA0F-484F-BF09-F08276A69E2F")
        == "api://9f751b64-ea0f-484f-bf09-f08276a69e2f/.default"
    )
    with pytest.raises(ValueError, match="JARVIS_API_CLIENT_ID"):
        api_scope("jarvis-api")


def test_settings_require_a_backend_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("JARVIS_BACKEND_URL", raising=False)
    monkeypatch.delenv("JARVIS_API_CLIENT_ID", raising=False)
    with pytest.raises(ValueError, match="JARVIS_BACKEND_URL is required"):
        backend_settings_from_environment()
    monkeypatch.setenv("JARVIS_BACKEND_URL", "https://backend.example/")
    assert backend_settings_from_environment() == (
        "https://backend.example",
        "api://9f751b64-ea0f-484f-bf09-f08276a69e2f/.default",
    )


async def test_identity_client_requests_the_api_scope() -> None:
    scopes: list[str] = []

    class Credential:
        async def get_token(self, scope: str) -> SimpleNamespace:
            scopes.append(scope)
            return SimpleNamespace(token=TOKEN)

    client = BackendToolClient.for_identity(
        Credential(), "https://backend.example", "api://id/.default"
    )
    assert await client._token() == TOKEN
    assert scopes == ["api://id/.default"]
    await client.close()
