"""Actual Current/managed loops with synthetic SDK HTTP; no inference/credentials."""
import asyncio
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace as NS

import httpx
import pytest
from openai import AsyncOpenAI
from runtime_comparison_runner import REQUESTED, RuntimeUnderTest, compare_runtimes

from managed_copilot import ManagedCopilotClient, ManagedTarget, ManagedTurnContext
from model_client import AzureOpenAIResponsesClient


class Binding:
    conversation_id = "native-fixture"

    def __init__(self):
        self.claimed = set()

    @asynccontextmanager
    async def lease(self, context, target):
        yield self

    async def claim_turn(self, source):
        if source in self.claimed:
            return False
        self.claimed.add(source)
        return True

    async def finish_turn(self, source, success):
        pass


class ActualFactories:
    def __init__(self, fail=False, hang=False):
        self.worlds, self.requests, self.closed = [], [], []
        self.fail, self.hang = fail, hang

    @asynccontextmanager
    async def factory(self, runtime, backend, settings):
        self.worlds.append(backend.world)
        observed = {"usage": []}

        async def verify(target, requested, catalogue):
            assert requested == REQUESTED and catalogue == backend.world.schemas()

        async def handle(request):
            body = json.loads(request.content)
            self.requests.append((runtime, body))
            if self.hang:
                await asyncio.Event().wait()
            if self.fail:
                events = [{"type": "response.failed", "response": {"error": {
                    "message": "SYNTHETIC_PRIVATE_ERROR"}}}]
            else:
                source = backend.source_message_id
                already_called = any(call["step"] == int(source)-1 for call in backend.world.calls)
                names = backend.world.case.get("expectedReads", []) if not already_called else []
                if backend.world._approved and not already_called:
                    names = ["get_system_health"]
                output = [{"type": "function_call", "id": f"fc-{source}-{name}",
                           "call_id": f"call-{source}-{name}", "name": name,
                           "arguments": json.dumps({"operation": "issue_get", "number": 700}
                                                   if name == "github_read" else
                                                   {"operation": "confirmation_test"}
                                                   if name == "get_system_health" else {}),
                           "status": "completed"} for name in names]
                events = [] if names else [{"type": "response.output_text.delta",
                                           "delta": "Fixture.",
                                           "item_id": "m", "output_index": 0, "content_index": 0,
                                           "sequence_number": 0}]
                usage = {"input_tokens": 5, "output_tokens": 2, "total_tokens": 7,
                         "output_tokens_details": {"reasoning_tokens": 1}}
                observed["usage"].append({"input_tokens": 5, "output_tokens": 2,
                                           "reasoning_tokens": 1})
                events.append({"type": "response.completed", "sequence_number": 1,
                               "response": {"id": "synthetic-response", "status": "completed",
                                            "output": output, "usage": usage}})
            return httpx.Response(200, text="".join(
                f"data: {json.dumps(event)}\n\n" for event in events
            ), headers={"content-type": "text/event-stream"})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
            async with AsyncOpenAI(api_key="synthetic-fixture", base_url="https://fixture.test/v1/",
                                   http_client=http, max_retries=0) as sdk:
                if runtime == "current":
                    client = AzureOpenAIResponsesClient(
                        client=sdk, credential=None, model_name=settings.model,
                        server_address="fixture.test", system_prompt="Synthetic Jarvis fixture.",
                        max_output_tokens=4096, tools=backend,
                        reasoning_effort=settings.reasoning_effort,
                    )
                else:
                    client = ManagedCopilotClient(
                        client=sdk, backend=backend,
                        target=ManagedTarget("synthetic-agent", settings.model,
                                             settings.reasoning_effort),
                        bindings=Binding(),
                        context_provider=lambda: ManagedTurnContext(
                            "synthetic-session", backend.source_message_id,
                            "Synthetic Jarvis fixture.",
                        ), settings_provider=backend.model_settings, definition_verifier=verify,
                    )
                try:
                    yield RuntimeUnderTest(client, "actual_model_loops_mock_sdk_http", observed)
                finally:
                    await client.close()
                    self.closed.append(runtime)


@pytest.mark.asyncio
async def test_actual_both_loops_read_fixture_and_preserve_selected_settings():
    factories = ActualFactories()
    report = await compare_runtimes(dict.fromkeys(("current", "copilot"), factories.factory),
                                    case_ids=["multi-step-read", "multi-turn-constraints"])
    assert len(report["rows"]) == 4
    assert len({id(world) for world in factories.worlds}) == 4
    for row in report["rows"]:
        assert row["terminalOutcome"] == "completed", row
        assert row["effectiveSettings"]["model"] == "gpt-6.1-terra"
        assert row["effectiveSettings"]["reasoningEffort"] == "high"
        assert row["humanTextReview"]["status"] == "pending"
        assert row["billedCost"] is None and row["usage"]
        assert row["completionEvidence"]["missingReads"] == []
        assert row["completionEvidence"]["noopExecutions"] == 0
    current_requests = [body for runtime, body in factories.requests if runtime == "current"]
    managed_requests = [body for runtime, body in factories.requests if runtime == "copilot"]
    assert all(body["model"] == "gpt-6.1-terra" for body in current_requests)
    assert all(body["reasoning"] == {"effort": "high"} for body in current_requests)
    assert all(body["conversation"] == "native-fixture" for body in managed_requests)
    assert all("max_output_tokens" not in body for body in managed_requests)
    assert len(factories.closed) == 4


@pytest.mark.asyncio
async def test_controls_are_unexecuted_not_disguised_as_successful_text_turns():
    factories = ActualFactories()
    report = await compare_runtimes(dict.fromkeys(("current", "copilot"), factories.factory),
                                    case_ids=["interrupt-before-action", "long-read-reconnect"])
    assert not factories.worlds and not factories.requests
    for row in report["rows"]:
        assert row["terminalOutcome"] == "unsupported_control"
        assert row["turns"] == []
        assert all(control["executed"] is False for control in row["controls"])
        assert row["completionEvidence"]["missingReads"]


@pytest.mark.asyncio
@pytest.mark.parametrize("hang,outcome", [(False, "failed"), (True, "timeout")])
async def test_actual_loop_failure_timeout_and_cleanup(hang, outcome):
    factories = ActualFactories(fail=not hang, hang=hang)
    report = await compare_runtimes(dict.fromkeys(("current", "copilot"), factories.factory),
                                    case_ids=["identity-en"], turn_timeout_seconds=0.05)
    assert [row["terminalOutcome"] for row in report["rows"]] == [outcome, outcome]
    assert "SYNTHETIC_PRIVATE_ERROR" not in json.dumps(report)
    assert factories.closed == ["current", "copilot"]


@pytest.mark.asyncio
async def test_settings_mismatch_never_requests_provider_and_cost_stays_unknown():
    @asynccontextmanager
    async def factory(runtime, backend, settings):
        async def wrong_settings():
            return NS(model="other", reasoning_effort="none")
        yield RuntimeUnderTest(NS(session_settings=wrong_settings), "scripted_comparator_plumbing")

    report = await compare_runtimes(dict.fromkeys(("current", "copilot"), factory),
                                    case_ids=["identity-en"])
    for row in report["rows"]:
        assert row["terminalOutcome"] == "settings_mismatch"
        assert row["turns"] == [] and row["usage"] is None and row["billedCost"] is None


# Explicit CLI demonstration factories: SDK HTTP is always MockTransport.
_offline = ActualFactories()
current_factory = _offline.factory
copilot_factory = _offline.factory


@pytest.mark.asyncio
async def test_both_actual_loops_dispatch_once_against_isolated_approval_fixture():
    factories = ActualFactories()
    report = await compare_runtimes(dict.fromkeys(("current", "copilot"), factories.factory),
                                    case_ids=["approval-once", "approval-decline"])
    for row in report["rows"]:
        assert row["terminalOutcome"] == "completed"
        expected = 1 if row["case"] == "approval-once" else 0
        assert row["completionEvidence"]["noopExecutions"] == expected
        assert row["actionAttempts"] == expected
        assert row["fixtureChecks"]["noopCountMatches"]
