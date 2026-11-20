"""Tool lookup for the Responses path: two small meta tools instead of every tool schema.

The model sees find_tools and call_tool only. find_tools ranks the backend catalogue and returns
the best matches with their schemas; call_tool then runs a tool found earlier in the same turn
through the normal dispatcher. The call is resolved back to the real tool name before any
dispatch, effect, replay or calendar logic, so those paths are unchanged. The same ranking is
implemented for voice in apps/backend/src/voice/voice-tools.ts.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from jarvis_tools import BackendTool

FIND_TOOLS = "find_tools"
CALL_TOOL = "call_tool"
MAX_FULL_RESULTS = 3
MAX_OTHER_RESULTS = 5
MAX_SHORT_DESCRIPTION = 240
_TOOL_ALIASES: dict[str, tuple[str, ...]] = {
    "kalender": ("calendar",), "calendar": ("kalender",),
    "mail": ("email", "e-mail", "post"), "email": ("mail", "e-mail", "post"),
    "e-mail": ("mail", "email", "post"), "post": ("mail", "email"),
    "opgave": ("task", "tasks"), "opgaver": ("task", "tasks"),
    "task": ("opgave", "opgaver"), "tasks": ("opgaver",),
    "påmindelse": ("reminder",), "påmindelser": ("reminders",),
    "reminder": ("påmindelse",), "reminders": ("påmindelser",),
    "note": ("notes", "noter"), "notes": ("note", "noter"), "noter": ("note", "notes"),
    "projekt": ("project", "projects"), "projekter": ("project", "projects"),
    "project": ("projekt", "projekter"), "projects": ("projekter",),
    "søg": ("search", "find"), "search": ("søg", "find"), "find": ("søg", "search"),
    "viden": ("knowledge",), "knowledge": ("viden",),
    "sundhed": ("health",), "health": ("sundhed",),
    "mad": ("food",), "food": ("mad",),
    "træning": ("workout", "gym"), "workout": ("træning",), "gym": ("træning",),
    "vejr": ("weather",), "weather": ("vejr",),
    "rejse": ("travel",), "travel": ("rejse",),
    "indbakke": ("inbox",), "inbox": ("indbakke",),
}

LOOKUP_TOOLS: tuple[dict[str, Any], ...] = (
    {
        "type": "function",
        "name": FIND_TOOLS,
        "description": (
            "Jarvis tools are not listed. Look one up by a few keywords to get its description "
            "and argument schema, then use call_tool."
        ),
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string", "minLength": 2, "maxLength": 100}},
            "required": ["query"],
            "additionalProperties": False,
        },
        "strict": False,
    },
    {
        "type": "function",
        "name": CALL_TOOL,
        "description": (
            "Run a tool that find_tools returned, with its exact name and arguments that follow "
            "its schema."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "minLength": 1, "maxLength": 64},
                "arguments": {"type": "object", "additionalProperties": True},
            },
            "required": ["name", "arguments"],
            "additionalProperties": False,
        },
        "strict": False,
    },
)

_NOT_FOUND = (
    "Unknown tool, or not looked up yet. Call find_tools first, then call_tool. "
    "Nothing was done."
)


@dataclass(frozen=True, slots=True)
class ResolvedCall:
    """A model tool call with its real tool name; ``local_result`` means no backend call runs."""

    name: str
    call_id: str
    id: str
    arguments: str
    input: dict[str, Any]
    local_result: dict[str, Any] | None = None


def short_description(text: str) -> str:
    """Keep whole leading sentences up to the limit; cut a single long sentence at a word."""
    if len(text) <= MAX_SHORT_DESCRIPTION:
        return text
    result = ""
    for sentence in re.findall(r"[^.!?]+[.!?]+(?:\s+|$)", text) or [text]:
        if result and len(result) + len(sentence) > MAX_SHORT_DESCRIPTION:
            break
        result += sentence
    result = result.strip()
    if len(result) <= MAX_SHORT_DESCRIPTION:
        return result
    cut = result[:MAX_SHORT_DESCRIPTION]
    return cut[: max(cut.rfind(" "), 1)] + "…"


def search_tools(tools: Sequence[BackendTool], query: str) -> list[BackendTool]:
    """Rank tools by query words in the name (strongest) and the description."""
    normalized_query = re.sub(r"[_-]+", " ", query.lower().strip())
    words = list(dict.fromkeys(
        word for word in re.split(r"[^\w]+", normalized_query) if len(word) >= 2
    ))[:8]
    scored: list[tuple[int, str, BackendTool]] = []
    for tool in tools:
        name = tool.name.lower()
        segments = name.split("_")
        description = tool.description.lower()
        score = 12 if name.replace("_", " ") == normalized_query else 0
        for word in words:
            variants = (word, *_TOOL_ALIASES.get(word, ()))
            score += max(
                (4 if variant in segments else 2 if variant in name else 0)
                + (1 if variant in description else 0)
                for variant in variants
            )
        if score > 0:
            scored.append((-score, tool.name, tool))
    return [tool for _, _, tool in sorted(scored, key=lambda item: item[:2])]


def _local(call: Any, result: dict[str, Any], name: str) -> ResolvedCall:
    return ResolvedCall(name, _attr(call, "call_id"), _attr(call, "id"), "{}", {}, result)


def _attr(call: Any, name: str) -> str:
    value = getattr(call, name, "")
    return value if isinstance(value, str) else ""


def _arguments(call: Any, use_anthropic: bool) -> dict[str, Any] | None:
    if use_anthropic:
        value = getattr(call, "input", None)
    else:
        try:
            value = json.loads(getattr(call, "arguments", None) or "{}")
        except ValueError:
            return None
    return value if isinstance(value, dict) else None


def resolve_lookup_calls(
    calls: Sequence[Any],
    catalogue: Sequence[BackendTool],
    discovered: set[str],
    *,
    use_anthropic: bool,
    shape_definitions: Callable[[list[dict[str, Any]]], list[dict[str, Any]]],
) -> list[Any]:
    """Answer find_tools locally and replace call_tool with the real call; others pass through."""
    known = {tool.name for tool in catalogue}
    resolved: list[Any] = []
    for call in calls:
        name = getattr(call, "name", "")
        if name not in {FIND_TOOLS, CALL_TOOL}:
            resolved.append(call)
            continue
        arguments = _arguments(call, use_anthropic)
        if name == FIND_TOOLS:
            query = arguments.get("query") if arguments is not None else None
            if (
                arguments is None or set(arguments) != {"query"} or not isinstance(query, str)
                or len(query.strip()) < 2 or len(query) > 100
            ):
                result = {"tool": name, "outcome": "refused", "result": {
                    "refused": "Invalid tool search. Give a few keywords.",
                }}
            else:
                matches = search_tools(catalogue, query)
                full = matches[:MAX_FULL_RESULTS]
                discovered.update(tool.name for tool in full)
                definitions = shape_definitions([tool.model_schema() for tool in full])
                result = {"tool": name, "outcome": "ok", "result": {
                    "tools": [
                        {"name": item["name"], "description": item["description"],
                         "parameters": item["parameters"]}
                        for item in definitions
                    ],
                    "otherMatches": [
                        {"name": tool.name, "description": short_description(tool.description)}
                        for tool in matches[MAX_FULL_RESULTS:MAX_FULL_RESULTS + MAX_OTHER_RESULTS]
                    ],
                    **({"note": "No matching tool. Say so plainly."} if not matches else {}),
                }}
            resolved.append(_local(call, result, name))
            continue
        target = arguments.get("name") if arguments is not None else None
        inner = arguments.get("arguments") if arguments is not None else None
        if (
            arguments is None or set(arguments) != {"name", "arguments"}
            or not isinstance(target, str) or not isinstance(inner, dict)
        ):
            resolved.append(_local(call, {"tool": name, "outcome": "refused", "result": {
                "refused": "Invalid tool request. Nothing was done.",
            }}, name))
        elif target not in known or target not in discovered:
            resolved.append(_local(call, {"tool": target, "outcome": "refused", "result": {
                "refused": _NOT_FOUND,
            }}, name))
        else:
            encoded = json.dumps(inner, ensure_ascii=False, separators=(",", ":"))
            resolved.append(ResolvedCall(
                target, _attr(call, "call_id"), _attr(call, "id"), encoded, inner,
            ))
    return resolved
