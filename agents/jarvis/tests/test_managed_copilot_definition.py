"""Synthetic definition/readback checks; never contact Azure."""
import copy

import pytest

from managed_copilot import ManagedChatError, ManagedTarget
from managed_copilot_definition import managed_agent_definition, validate_managed_agent_version
from state import ModelSettings

SETTINGS = ModelSettings("gpt-6.1-terra", "high")
TARGET = ManagedTarget("synthetic-jarvis", SETTINGS.model, SETTINGS.reasoning_effort)
TOOLS = [{"type": "function", "name": "fixture_lookup", "strict": False,
          "parameters": {"type": "object", "properties": {}}}]


def version():
    return {"name": TARGET.agent_name, "version": "1", "status": "active",
            "definition": managed_agent_definition(TARGET, SETTINGS, "prepared identity", TOOLS)}


def validate(value):
    validate_managed_agent_version(
        value, expected_version="1", target=TARGET, settings=SETTINGS,
        instructions="prepared identity", function_tools=TOOLS,
    )


def test_builder_exact_target_and_disabled_extra_tools():
    result = version()
    definition = result["definition"]
    assert definition["model"] == "gpt-6.1-terra"
    assert definition["reasoning"] == {"effort": "high"}
    assert definition["harness"] == {"type": "microsoft_copilot_preview"}
    assert definition["tools"][0] == {
        "type": "microsoft_copilot_toolset_preview", "default_config": {"enabled": False},
    }
    validate(result)
    definition["tools"][1]["strict"] = True
    assert TOOLS[0]["strict"] is False  # builder owns its copy


@pytest.mark.parametrize("field,value", [
    ("model", "gpt-6-luna"), ("reasoning", {"effort": "none"}),
    ("harness", {"type": "github_copilot_preview"}), ("instructions", "different"),
    ("kind", "hosted"), ("skills", [{"name": "extra", "version": "1"}]),
    ("temperature", 1), ("tool_choice", "auto"), ("text", {"verbosity": "low"}),
])
def test_definition_mismatch_fails_closed(field, value):
    result = version()
    result["definition"][field] = value
    with pytest.raises(ManagedChatError):
        validate(result)


@pytest.mark.parametrize("toolset", [
    None, {"type": "microsoft_copilot_toolset_preview"},
    {"type": "microsoft_copilot_toolset_preview", "default_config": {"enabled": True}},
    {"type": "microsoft_copilot_toolset_preview", "default_config": {"enabled": False},
     "configs": [{"name": "shell", "enabled": True}]},
])
def test_missing_or_enabled_builtin_configuration_rejected(toolset):
    result = version()
    result["definition"]["tools"] = copy.deepcopy(TOOLS) + ([toolset] if toolset else [])
    with pytest.raises(ManagedChatError):
        validate(result)


@pytest.mark.parametrize("field,value", [
    ("name", "other-agent"), ("version", "2"), ("status", "creating"), ("draft", True),
])
def test_readback_identity_version_and_status_required(field, value):
    result = version()
    result[field] = value
    with pytest.raises(ManagedChatError, match="version_mismatch"):
        validate(result)


def test_extra_function_or_strict_schema_rejected():
    for mutation in ("extra", "strict", "schema"):
        result = version()
        tools = result["definition"]["tools"]
        if mutation == "extra":
            tools.append({"type": "web_search"})
        elif mutation == "strict":
            tools[1]["strict"] = True
        else:
            tools[1]["parameters"]["properties"]["injected"] = {"type": "string"}
        with pytest.raises(ManagedChatError):
            validate(result)


@pytest.mark.parametrize("tools", [[None], "malformed", [
    {"type": "microsoft_copilot_toolset_preview", "default_config": {"enabled": False},
     "configs": None},
]])
def test_malformed_readback_tools_fail_with_fixed_error(tools):
    result = version()
    result["definition"]["tools"] = tools
    with pytest.raises(ManagedChatError):
        validate(result)
