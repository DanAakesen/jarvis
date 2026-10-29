"""Offline fixtures shared by future current and managed runtime comparison adapters.

This module has no network, credentials, provider defaults or cutover decision.
The three tool definitions describe a synthetic subset, not the full live catalogue.
Its owner-decision controls are test data, not proof of production authorization.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

from jarvis_tools import BackendTool, ToolExecutionMetadata, model_tools

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "chat_runtime_comparison.json"


def load_comparison_fixture() -> dict[str, Any]:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def request_settings_evidence(
    current: dict[str, Any], copilot: dict[str, Any],
    supported_efforts: dict[str, set[str]] | None = None,
) -> dict[str, Any]:
    """Record local test controls, not prompts/headers or an inferred substitute setting."""
    def controls(request: dict[str, Any]) -> dict[str, Any]:
        return {
            "model": request.get("model"),
            "reasoningEffort": (request.get("reasoning") or {}).get("effort"),
            "maxOutputTokens": request.get("max_output_tokens"),
        }

    selected = {"current": controls(current), "copilot": controls(copilot)}
    unsupported = []
    unverified = []
    for runtime, settings in selected.items():
        available = (supported_efforts or {}).get(settings["model"])
        if available is None or settings["reasoningEffort"] is None:
            unverified.append(runtime)
        elif settings["reasoningEffort"] not in available:
            unsupported.append(runtime)
    return {
        "effectiveSettings": selected,
        "differences": [key for key in selected["current"]
                        if selected["current"][key] != selected["copilot"][key]],
        "unsupported": unsupported,
        "capabilityUnverified": unverified,
    }


class ComparisonFixture:
    """One isolated fixture world for exactly one runtime and scenario."""

    def __init__(self, case_id: str) -> None:
        fixture = load_comparison_fixture()
        self.case = next(case for case in fixture["cases"] if case["id"] == case_id)
        self.seed = fixture["seed"]
        self.catalogue = [
            BackendTool(
                tool["name"], tool["description"], tool["inputSchema"],
                ToolExecutionMetadata(tool["effect"]),
            )
            for tool in fixture["tools"]
        ]
        self.calls: list[dict[str, Any]] = []
        self.noop_executions = 0
        self._step = -1
        self._approved = False

    def schemas(self) -> list[dict[str, Any]]:
        return copy.deepcopy(model_tools(self.catalogue))

    def begin_step(self, index: int) -> str:
        if index != self._step + 1:
            raise ValueError("Fixture steps must advance exactly once in order")
        self._step = index
        step = self.case["steps"][index]
        self._approved = step.get("ownerDecision") == "approved"
        return step["text"]

    def call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if self._step < 0:
            raise ValueError("A fixture source step is required")
        if name == "list_jobs" and arguments == {}:
            result = copy.deepcopy(self.seed["jobs"])
        elif name == "github_read" and arguments == {"operation": "issue_get", "number": 700}:
            result = copy.deepcopy(self.seed["issue"])
            if "longIssueParagraphs" in self.case:
                result["body"] = "\n\n".join(
                    f"Synthetic section {index}: {result['body']}"
                    for index in range(self.case["longIssueParagraphs"])
                )
        elif name == "get_system_health" and arguments == {"operation": "confirmation_test"}:
            if not self._approved:
                return self._receipt(name, arguments, "refused", {"executed": False})
            self._approved = False
            self.noop_executions += 1
            result = {"executed": True, "confirmation": "Synthetic no-op completed."}
        else:
            return self._receipt(name, arguments, "refused", {"executed": False})
        return self._receipt(name, arguments, "ok", result)

    def _receipt(
        self, name: str, arguments: dict[str, Any], outcome: str, result: dict[str, Any],
    ) -> dict[str, Any]:
        receipt = {"tool": name, "outcome": outcome, "result": result}
        self.calls.append({"step": self._step, "arguments": copy.deepcopy(arguments), **receipt})
        return copy.deepcopy(receipt)

    def completion_evidence(self) -> dict[str, Any]:
        successful_reads = {
            call["tool"] for call in self.calls
            if call["outcome"] == "ok" and call["tool"] in {"list_jobs", "github_read"}
        }
        return {
            "noopExecutions": self.noop_executions,
            "expectedNoopExecutions": self.case["expectedNoopExecutions"],
            "missingReads": sorted(set(self.case.get("expectedReads", ())) - successful_reads),
            "textReview": copy.deepcopy(self.case["review"]),
            "billedCost": None,
            "costUnavailableReason": "The fixture dispatcher does not observe provider billing.",
        }
