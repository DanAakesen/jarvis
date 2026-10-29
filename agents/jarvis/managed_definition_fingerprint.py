"""Canonical reviewed managed definition fingerprints; Python standard library only."""
from __future__ import annotations

import copy
import hashlib
import json
from typing import Any


def normalized_managed_definition(definition: dict[str, Any]) -> dict[str, Any]:
    """Ignore benign omitted/null defaults, never parameter data or enabled extras."""
    required = {"kind", "harness", "model", "reasoning", "instructions", "tools"}
    benign = {"skills": [], "structured_inputs": {}}
    if not isinstance(definition, dict) or not required <= definition.keys():
        raise ValueError("managed_definition_invalid")
    for key, value in definition.items():
        if key not in required and value is not None and not (
            key in benign and value == benign[key]
        ):
            raise ValueError("managed_definition_extra_setting")
    result = copy.deepcopy({key: definition[key] for key in required})
    if (result["kind"] != "prompt" or result["harness"] != {"type": "microsoft_copilot_preview"}
            or not isinstance(result["model"], str) or not result["model"]
            or not isinstance(result["instructions"], str) or not result["instructions"]):
        raise ValueError("managed_definition_invalid")
    reasoning = result["reasoning"]
    if not isinstance(reasoning, dict) or not isinstance(reasoning.get("effort"), str):
        raise ValueError("managed_definition_invalid")
    if any(value is not None for key, value in reasoning.items() if key != "effort"):
        raise ValueError("managed_definition_reasoning_extra")
    result["reasoning"] = {"effort": reasoning["effort"]}
    tools, functions, builtins, names = result["tools"], [], [], set()
    if not isinstance(tools, list):
        raise ValueError("managed_definition_tools_invalid")
    for tool in tools:
        if not isinstance(tool, dict):
            raise ValueError("managed_definition_tools_invalid")
        if tool.get("type") == "microsoft_copilot_toolset_preview":
            if (tool.get("default_config") != {"enabled": False}
                    or tool.get("configs") not in (None, [])
                    or any(value is not None for key, value in tool.items()
                           if key not in {"type", "default_config", "configs"})):
                raise ValueError("managed_definition_builtin_enabled_or_extra")
            builtins.append({"type": "microsoft_copilot_toolset_preview",
                             "default_config": {"enabled": False}})
        elif tool.get("type") == "function":
            name = tool.get("name")
            if (not isinstance(name, str) or not name or name in names or "___" in name
                    or tool.get("strict") is not False
                    or not isinstance(tool.get("parameters"), dict)
                    or any(value is not None for key, value in tool.items()
                           if key not in {"type", "name", "parameters", "description", "strict"})):
                raise ValueError("managed_definition_function_invalid")
            names.add(name)
            functions.append({key: value for key, value in tool.items() if value is not None})
        else:
            raise ValueError("managed_definition_extra_tool")
    if len(builtins) != 1:
        raise ValueError("managed_definition_builtin_missing")
    result["tools"] = [*builtins, *sorted(functions, key=lambda tool: tool["name"])]
    # Reject NaN/non-JSON objects without silently rewriting source schema data.
    json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return result


def managed_definition_fingerprint(
    project_endpoint: str, agent_name: str, version: str, definition: dict[str, Any],
) -> str:
    payload = {"projectEndpoint": project_endpoint.rstrip("/"), "agentName": agent_name,
               "version": version, "definition": normalized_managed_definition(definition)}
    return hashlib.sha256(json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")).hexdigest()
