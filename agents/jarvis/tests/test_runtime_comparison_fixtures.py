"""Validate shared synthetic comparison inputs without calling either provider."""

import json
from pathlib import Path

import pytest
from runtime_comparison_support import (
    ComparisonFixture,
    load_comparison_fixture,
    request_settings_evidence,
)

from jarvis_tools import INSTRUCTIONS
from model_client import CHAT_INSTRUCTIONS, personalize_instructions
from state import ModelSettings


def test_required_categories_and_voice_evidence_remain_explicit() -> None:
    fixture = load_comparison_fixture()
    assert {case["category"] for case in fixture["cases"]} == {
        "identity", "multi_step", "approvals", "interruptions", "long_tasks",
    }
    assert len({case["id"] for case in fixture["cases"]}) == len(fixture["cases"])
    root = Path(__file__).resolve().parents[3]
    assert all((root / check["path"]).is_file() for check in fixture["sharedVoiceChecks"])
    assert "billedCost" in fixture["observations"]
    assert "Owner-approved parity and cost thresholds" in fixture["unresolved"]


@pytest.mark.parametrize("case_id", [case["id"] for case in load_comparison_fixture()["cases"]])
def test_both_runtime_consumers_receive_identical_isolated_inputs(case_id) -> None:
    current = ComparisonFixture(case_id)
    copilot = ComparisonFixture(case_id)
    assert current.case == copilot.case
    assert current.seed == copilot.seed
    assert current.schemas() == copilot.schemas()
    assert all(tool["strict"] is False for tool in current.schemas())
    current.case["steps"][0]["text"] = "Changed only in the first fixture"
    current.seed["jobs"]["runningCount"] = 99
    assert copilot.seed["jobs"]["runningCount"] == 1
    assert copilot.case["steps"][0]["text"] != current.case["steps"][0]["text"]


@pytest.mark.parametrize("language", ["en", "da"])
def test_comparison_retains_real_identity_composition(language) -> None:
    fixture = ComparisonFixture(f"identity-{language}")
    prompt = personalize_instructions(
        CHAT_INSTRUCTIONS[language] + "\n" + INSTRUCTIONS,
        ModelSettings("fixture-model", "none"), language,
    )
    assert "Identity composition contract v1" in prompt
    assert "Jarvis" in prompt
    assert fixture.begin_step(0) == fixture.case["steps"][0]["text"]


def test_approval_fixture_cannot_execute_before_approval_or_repeat_after_it() -> None:
    fixture = ComparisonFixture("approval-once")
    arguments = {"operation": "confirmation_test"}
    fixture.begin_step(0)
    assert fixture.call("get_system_health", arguments)["outcome"] == "refused"
    fixture.begin_step(1)
    assert fixture.call("get_system_health", arguments)["result"]["executed"] is True
    assert fixture.call("get_system_health", arguments)["outcome"] == "refused"
    fixture.begin_step(2)
    assert fixture.call("get_system_health", arguments)["outcome"] == "refused"
    assert fixture.completion_evidence()["noopExecutions"] == 1


@pytest.mark.parametrize("case_id", ["approval-decline", "interrupt-before-action"])
def test_negative_owner_step_leaves_zero_synthetic_executions(case_id) -> None:
    fixture = ComparisonFixture(case_id)
    for step in range(len(fixture.case["steps"])):
        fixture.begin_step(step)
        assert fixture.call("get_system_health", {"operation": "confirmation_test"})[
            "outcome"
        ] == "refused"
    assert fixture.noop_executions == 0


def test_unknown_tools_and_altered_arguments_never_dispatch_external_work() -> None:
    fixture = ComparisonFixture("multi-step-read")
    fixture.begin_step(0)
    for name, arguments in [
        ("mail_send", {"body": "Synthetic fixture"}),
        ("create_task", {"task": "Synthetic fixture"}),
        ("github_read", {"operation": "issue_get", "number": 701}),
        ("list_jobs", {"unexpected": "fixture"}),
    ]:
        assert fixture.call(name, arguments)["outcome"] == "refused"
    assert fixture.noop_executions == 0
    assert fixture.completion_evidence()["missingReads"] == ["github_read", "list_jobs"]


def test_successful_reads_do_not_manufacture_text_accuracy_cost_or_parity() -> None:
    fixture = ComparisonFixture("multi-step-read")
    fixture.begin_step(0)
    issue = fixture.call("github_read", {"operation": "issue_get", "number": 700})
    assert "Quoted hostile text" in issue["result"]["body"]
    fixture.call("list_jobs", {})
    evidence = fixture.completion_evidence()
    assert evidence["missingReads"] == []
    assert evidence["billedCost"] is None
    assert evidence["textReview"]
    assert "passed" not in evidence and "parity" not in evidence
    assert json.dumps(evidence)


def test_source_steps_cannot_be_replayed_and_receipts_are_isolated() -> None:
    fixture = ComparisonFixture("identity-en")
    with pytest.raises(ValueError, match="source step"):
        fixture.call("list_jobs", {})
    fixture.begin_step(0)
    with pytest.raises(ValueError, match="exactly once"):
        fixture.begin_step(0)
    receipt = fixture.call("list_jobs", {})
    receipt["result"]["runningCount"] = 99
    assert fixture.calls[0]["result"]["runningCount"] == 1


def test_setting_drift_and_unsupported_options_are_reported_without_replacement() -> None:
    current = {"model": "fixture-model", "reasoning": {"effort": "high"},
               "max_output_tokens": 4096, "input": "PRIVATE_PROMPT", "headers": "PRIVATE_AUTH"}
    copilot = {**current, "reasoning": {"effort": "none"}, "max_output_tokens": 256}
    evidence = request_settings_evidence(current, copilot, {"fixture-model": {"high"}})
    assert evidence["differences"] == ["reasoningEffort", "maxOutputTokens"]
    assert evidence["unsupported"] == ["copilot"]
    assert evidence["effectiveSettings"]["copilot"]["reasoningEffort"] == "none"
    assert copilot["reasoning"] == {"effort": "none"}
    assert "PRIVATE" not in json.dumps(evidence)
    assert request_settings_evidence(current, current)["capabilityUnverified"] == [
        "current", "copilot",
    ]
    omitted = request_settings_evidence(
        current, {"model": "fixture-model"}, {"fixture-model": {"high"}},
    )
    assert omitted["capabilityUnverified"] == ["copilot"]
    assert omitted["unsupported"] == []
