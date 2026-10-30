# Copyright (c) Microsoft. All rights reserved.
"""Pure definition construction/readback checks; never provision or grant access.

Wire JSON follows azure-ai-projects 2.9.0 PromptAgentDefinition, Reasoning and
MicrosoftCopilotToolsetPreview models. The caller must fetch a real version;
passing locally constructed metadata does not establish provider availability.
"""
from __future__ import annotations

import copy
import json
from collections.abc import Sequence
from typing import Any

from managed_copilot import ManagedChatError, ManagedTarget
from state import ModelSettings

DISABLED_BUILTINS = {
    "type": "microsoft_copilot_toolset_preview",
    "default_config": {"enabled": False},
}


def _functions(function_tools: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    names = set()
    for tool in function_tools:
        if not isinstance(tool, dict):
            raise ManagedChatError("managed_definition_tools_invalid")
        name = tool.get("name")
        if (tool.get("type") != "function" or not isinstance(name, str) or not name
                or "___" in name or name in names or tool.get("strict") is not False):
            raise ManagedChatError("managed_definition_tools_invalid")
        names.add(name)
    return copy.deepcopy(list(function_tools))


def managed_agent_definition(
    target: ManagedTarget, settings: ModelSettings, instructions: str,
    function_tools: Sequence[dict[str, Any]],
) -> dict[str, Any]:
    """Build a new prompt-agent definition with only existing Jarvis functions."""
    target.validate(settings)
    if not instructions.strip():
        raise ManagedChatError("managed_definition_instructions_missing")
    return {
        "kind": "prompt", "harness": {"type": "microsoft_copilot_preview"},
        "model": target.model, "reasoning": {"effort": target.reasoning_effort},
        "instructions": instructions,
        "tools": [copy.deepcopy(DISABLED_BUILTINS), *_functions(function_tools)],
    }


def validate_managed_agent_version(
    readback: dict[str, Any], *, expected_version: str, target: ManagedTarget,
    settings: ModelSettings, instructions: str, function_tools: Sequence[dict[str, Any]],
) -> None:
    """Fail closed on mismatched readback; a match is not an access/region proof.

    Use agents.get_version(agent_name=..., agent_version=...) on an authorized
    project client and pass its serialized AgentVersionDetails. Also verify the
    endpoint resolves to this immutable version before runtime activation.
    """
    expected = managed_agent_definition(target, settings, instructions, function_tools)
    if (not expected_version or readback.get("name") != target.agent_name
            or readback.get("version") != expected_version or readback.get("status") != "active"
            or readback.get("draft") is True):
        raise ManagedChatError("managed_agent_version_mismatch")
    actual = readback.get("definition")
    if not isinstance(actual, dict):
        raise ManagedChatError("managed_agent_definition_missing")
    for key in ("kind", "harness", "model", "reasoning", "instructions"):
        if actual.get(key) != expected[key]:
            raise ManagedChatError("managed_agent_definition_mismatch")
    if actual.get("skills"):
        raise ManagedChatError("managed_agent_extra_skills")
    for key in ("temperature", "top_p", "tool_choice", "text", "structured_inputs"):
        if actual.get(key) is not None:
            raise ManagedChatError("managed_agent_unsupported_setting")
    tools = actual.get("tools")
    if not isinstance(tools, list) or not all(isinstance(tool, dict) for tool in tools):
        raise ManagedChatError("managed_agent_toolset_missing")
    toolsets = [tool for tool in tools if tool.get("type") == DISABLED_BUILTINS["type"]]
    if len(toolsets) != 1:
        raise ManagedChatError("managed_agent_builtin_tools_enabled")
    configs = toolsets[0].get("configs", [])
    if (toolsets[0].get("default_config") != {"enabled": False}
            or not isinstance(configs, list)
            or any(not isinstance(config, dict) or config.get("enabled") is not False
                   for config in configs)):
        raise ManagedChatError("managed_agent_builtin_tools_enabled")
    functions = [tool for tool in tools if tool.get("type") != DISABLED_BUILTINS["type"]]
    functions = _functions(functions)
    # Tool order has no permission semantics; exact schemas and names do.
    def canonical(items: Sequence[dict[str, Any]]) -> list[str]:
        return sorted(json.dumps(item, sort_keys=True) for item in items)
    if canonical(functions) != canonical(_functions(function_tools)):
        raise ManagedChatError("managed_agent_function_tools_mismatch")
