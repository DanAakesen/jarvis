"""Explicit-factory offline comparison; never selects credentials or provider defaults."""
from __future__ import annotations

import argparse
import asyncio
import importlib
import json
import time
from collections.abc import Callable, Sequence
from contextlib import AbstractAsyncContextManager, aclosing
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from runtime_comparison_support import ComparisonFixture, load_comparison_fixture

from jarvis_tools import current_message_id
from model_contract import AcknowledgmentBoundary, StreamingModelClient
from state import ModelMessage, ModelSettings

REQUESTED = ModelSettings("gpt-6.1-terra", "high")


class FixtureBackend:
    """Async backend boundary for one synthetic world; no HTTP or credentials."""

    def __init__(self, world: ComparisonFixture, settings: ModelSettings) -> None:
        self.world, self.settings = world, settings
        self.source_message_id: str | None = None
        self.usage: list[dict[str, Any]] = []
        self.sources: list[str | None] = []

    async def tools(self):
        return tuple(self.world.catalogue)

    async def context(self):
        return {"fixture": "synthetic-only"}

    async def model_settings(self):
        return self.settings

    async def call(self, name, arguments_json, message_id):
        self.sources.append(message_id)
        if message_id != self.source_message_id:
            raise ValueError("fixture_source_mismatch")
        return self.world.call(name, json.loads(arguments_json or "{}"))

    async def record_model_usage(self, **usage):
        # Retain numeric observations only, never caller-provided raw event data.
        self.usage.append({key: usage[key] for key in ("input_tokens", "output_tokens")
                           if isinstance(usage.get(key), int)})

    async def close(self):
        pass


@dataclass
class RuntimeUnderTest:
    client: StreamingModelClient
    evidence_kind: str
    # Factory may record observed managed usage/requests without inventing it.
    observations: dict[str, Any] = field(default_factory=dict)


RuntimeFactory = Callable[
    [str, FixtureBackend, ModelSettings], AbstractAsyncContextManager[RuntimeUnderTest]
]


async def compare_runtimes(
    factories: dict[str, RuntimeFactory], *, case_ids: Sequence[str] | None = None,
    turn_timeout_seconds: float = 30,
) -> dict[str, Any]:
    """Run both supplied clients against independent copies of identical fixtures.

    Lifecycle controls require an application-runtime wrapper beyond the streaming
    model contract. They are explicitly unexecuted here, never ordinary text turns.
    Factory lifecycle owns all injected clients and must remain fixture-only.
    """
    if set(factories) != {"current", "copilot"} or turn_timeout_seconds <= 0:
        raise ValueError("Explicit current/copilot factories and positive timeout required")
    fixture = load_comparison_fixture()
    cases = fixture["cases"]
    if case_ids is not None:
        known = {case["id"] for case in cases}
        if set(case_ids) - known:
            raise ValueError("Unknown fixture case")
        cases = [case for case in cases if case["id"] in case_ids]
    rows = []
    for case in cases:
        for runtime in ("current", "copilot"):
            world = ComparisonFixture(case["id"])
            backend = FixtureBackend(world, REQUESTED)
            row: dict[str, Any] = {
                "runtime": runtime, "case": case["id"],
                "requestedSettings": {"model": REQUESTED.model,
                                      "reasoningEffort": REQUESTED.reasoning_effort},
                "effectiveSettings": None, "turns": [], "durationMs": 0,
                "usage": None, "billedCost": None, "currency": None,
                "costUnavailableReason": "No provider billing observed; prices are not inferred.",
                "humanTextReview": {"status": "pending", "criteria": case["review"]},
                "controls": [],
            }
            started = time.monotonic()
            controls = [step["control"] for step in case["steps"] if "control" in step]
            if controls:
                row["terminalOutcome"] = "unsupported_control"
                row["evidenceKind"] = "unexecuted"
                row["controls"] = [{"name": name, "executed": False,
                                    "reason": "No detach/steering lifecycle in model contract."}
                                   for name in controls]
            else:
                row["terminalOutcome"] = "completed"
                try:
                    async with factories[runtime](runtime, backend, REQUESTED) as instance:
                        row["evidenceKind"] = instance.evidence_kind
                        effective = await instance.client.session_settings()
                        row["effectiveSettings"] = {
                            "model": effective.model, "reasoningEffort": effective.reasoning_effort,
                            "evidence": "client.session_settings; not provider availability proof",
                        }
                        if (effective.model, effective.reasoning_effort) != (
                            REQUESTED.model, REQUESTED.reasoning_effort,
                        ):
                            row["terminalOutcome"] = "settings_mismatch"
                        else:
                            messages: list[ModelMessage] = []
                            for index, _step in enumerate(case["steps"]):
                                source = str(index + 1)
                                backend.source_message_id = source
                                text = world.begin_step(index)
                                messages.append(ModelMessage(
                                    "user", text, source_message_id=source,
                                ))
                                turn = {"sourceMessageId": source, "terminalOutcome": "completed",
                                        "text": "", "acknowledgments": []}
                                row["turns"].append(turn)
                                token = current_message_id.set(source)
                                try:
                                    async with asyncio.timeout(turn_timeout_seconds):
                                        async with aclosing(instance.client.complete_chat(
                                            tuple(messages), case["language"], settings=REQUESTED,
                                        )) as stream:
                                            async for chunk in stream:
                                                if isinstance(chunk, AcknowledgmentBoundary):
                                                    turn["acknowledgments"].append(chunk.text)
                                                else:
                                                    turn["text"] += chunk
                                    messages.append(ModelMessage("assistant", turn["text"]))
                                except asyncio.CancelledError:
                                    raise
                                except Exception as error:
                                    outcome = ("timeout" if isinstance(error, TimeoutError)
                                               else "failed")
                                    turn["terminalOutcome"] = outcome
                                    row["terminalOutcome"] = outcome
                                    # Never retain raw exception content or provider diagnostics.
                                    break
                                finally:
                                    current_message_id.reset(token)
                        observed_usage = instance.observations.get("usage")
                        if backend.usage or observed_usage:
                            row["usage"] = {"backendReported": backend.usage or None,
                                            "factoryObserved": observed_usage or None}
                except asyncio.CancelledError:
                    raise
                except Exception:
                    row["terminalOutcome"] = "setup_or_cleanup_failed"
            row["durationMs"] = round((time.monotonic() - started) * 1000, 3)
            row["completionEvidence"] = world.completion_evidence()
            row["fixtureChecks"] = {
                "readRequirementsMet": not row["completionEvidence"]["missingReads"],
                "noopCountMatches": world.noop_executions == case["expectedNoopExecutions"],
                "evidence": "fixture counts only; not a runtime parity verdict",
            }
            row["actionAttempts"] = sum(call["tool"] == "get_system_health"
                                        for call in world.calls)
            row["fixtureDispatches"] = len(world.calls)
            rows.append(row)
    return {"evidence": "offline; no live parity or automatic text-quality verdict",
            "thresholds": None, "rows": rows}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--factory-module", required=True,
                        help="Explicit local module exporting current_factory and copilot_factory")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--case", action="append", dest="case_ids")
    args = parser.parse_args()
    module = importlib.import_module(args.factory_module)
    report = asyncio.run(compare_runtimes(
        {"current": module.current_factory, "copilot": module.copilot_factory},
        case_ids=args.case_ids,
    ))
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
