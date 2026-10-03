# Jarvis voice prototype: fake Jarvis backend functions exposed as model tools.

"""Fake Jarvis tools, their model schemas, and the tool-call log."""

from __future__ import annotations

import contextvars
import copy
import json
import logging
import os
import socket
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("jarvis_tools")

PROJECTS = ["Jarvis", "Daily", "Banking"]
AGENTS = ["codex", "copilot"]
TASK_STATES = ["running", "paused", "needs_attention", "done", "cancelled"]

INITIAL_TASKS: dict[str, dict[str, Any]] = {
    "T-101": {
        "id": "T-101",
        "project": "Jarvis",
        "agent": "codex",
        "text": "Tilføj dark mode til boardet",
        "state": "running",
        "activity": "Kører testene efter ændringer i 6 filer",
        "started_minutes_ago": 12,
        "pull_request": None,
    },
    "T-102": {
        "id": "T-102",
        "project": "Daily",
        "agent": "copilot",
        "text": "Ret login-fejlen på mobil",
        "state": "paused",
        "activity": "Sat på pause af Dan efter at have fundet fejlen i sessionshåndteringen",
        "started_minutes_ago": 47,
        "pull_request": None,
    },
    "T-103": {
        "id": "T-103",
        "project": "Banking",
        "agent": "codex",
        "text": "Opdater afhængighederne",
        "state": "done",
        "activity": "Færdig; alle tests består",
        "started_minutes_ago": 95,
        "pull_request": "#42",
    },
}

INSTRUCTIONS = """You are Jarvis, Dan's voice assistant for his software factory.
Dan speaks Danish. Always answer in short, natural spoken Danish: one or two sentences,
no markdown, no lists, no emojis, no task-id letters spelled out unless asked.

You control coding tasks through the tools. Coding agents are Codex and Copilot.
Never invent projects, tasks, or status; use the tools. If you do not know the task id,
call list_tasks first, then act on the matching task.

Speech recognition can mishear names: "Jarvis" may arrive as "Jarvi" or "Javis",
"Codex" as "kodeks" or "Kodex", "Copilot" as "co-pilot" or "kopilot", "Daily" as "Deili",
"Banking" as "bænking". Map to the closest project or agent.
Task ids are spoken as numbers, for example "opgave hundrede og et" is T-101.

Rules:
- New work: create_task with the project, the agent, and Dan's request in Danish as the text.
  If Dan does not name an agent, use codex.
- Corrections or extra instructions for a running task: steer_task.
- "Pause" or "stop" means pause_task. Only "annuller", "afbryd" or "drop" means cancel_task.
- "Fortsæt" or "genoptag" means resume_task.
- Status questions: answer from task_status or list_tasks in plain Danish.
- After an action, say briefly what you did.
- If Dan only thanks you or says goodbye, answer briefly without tools.

Action rules (strict):
- Only say that you did something if the tool for it was called in this turn and returned no error.
  Never describe an action you have not called.
- Commands about an existing task: call list_tasks if needed, then call the action tool in the same turn.
  If exactly one task matches the project or agent Dan names, act on it without asking.
"""

INSTRUCTIONS_EN = """You are Jarvis, Dan's personal AI butler, running his software factory.
Speak British English as a well-educated Englishman would: courteous, composed, precise, with a dry,
understated wit used sparingly. Address Dan as "sir" exactly once in most replies, at a natural point; never twice in one reply.
Prefer British phrasing: "Shall I…", "I'm afraid…", "Right away, sir.", "Very good, sir.", "I've taken the liberty of…",
"Might I suggest…". British spelling and vocabulary. No Americanisms, no exclamation marks, no filler enthusiasm.
Sound like a real person talking: short spoken sentences, contractions, no lists, no markdown, at most two or three sentences.
Never quote films; speak in your own words.

You control coding tasks through the tools. Coding agents are Codex and Copilot.
Never invent projects, tasks, or status; use the tools. If you do not know the task id, call list_tasks first.
Task data may be written in Danish; translate it naturally when you speak.

Rules:
- New work: create_task with the project, the agent, and Dan's request as the text. If no agent is named, use codex.
- Corrections or extra instructions for a running task: steer_task.
- "Pause", "hold" or "stop" means pause_task. Only "cancel", "abort" or "drop" means cancel_task.
- "Continue" or "resume" means resume_task.
- Status questions: answer from task_status or list_tasks.
- Do not announce routine actions ("One moment") — just act and report. Vary your acknowledgements; never repeat the same opener twice in a row.
- Only say you did something if its tool was called in this turn and returned no error.
- If exactly one task matches the project or agent Dan names, act on it without asking.
"""

_TASK_ID = {"type": "string", "description": "Task id, for example T-101."}
_NO_PARAMETERS = {"type": "object", "properties": {}, "required": [], "additionalProperties": False}

TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "list_projects",
        "description": "List Dan's projects.",
        "parameters": _NO_PARAMETERS,
        "strict": True,
    },
    {
        "type": "function",
        "name": "list_tasks",
        "description": "List coding tasks with project, agent, state, and current activity.",
        "parameters": _NO_PARAMETERS,
        "strict": True,
    },
    {
        "type": "function",
        "name": "task_status",
        "description": "Get the detailed status of one task.",
        "parameters": {
            "type": "object",
            "properties": {"task_id": _TASK_ID},
            "required": ["task_id"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "create_task",
        "description": "Start a new coding task that delivers a pull request.",
        "parameters": {
            "type": "object",
            "properties": {
                "project": {"type": "string", "enum": PROJECTS},
                "agent": {"type": "string", "enum": AGENTS},
                "text": {"type": "string", "description": "What the agent must do, in Danish."},
            },
            "required": ["project", "agent", "text"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "steer_task",
        "description": "Send a correction or extra instruction to a running or paused task.",
        "parameters": {
            "type": "object",
            "properties": {"task_id": _TASK_ID, "text": {"type": "string"}},
            "required": ["task_id", "text"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "pause_task",
        "description": "Pause a running task. Reversible.",
        "parameters": {
            "type": "object",
            "properties": {"task_id": _TASK_ID},
            "required": ["task_id"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "resume_task",
        "description": "Resume a paused task.",
        "parameters": {
            "type": "object",
            "properties": {"task_id": _TASK_ID},
            "required": ["task_id"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "cancel_task",
        "description": "Cancel a task permanently and close its sandbox.",
        "parameters": {
            "type": "object",
            "properties": {"task_id": _TASK_ID},
            "required": ["task_id"],
            "additionalProperties": False,
        },
        "strict": True,
    },
]

TOOL_NAMES = {schema["name"] for schema in TOOL_SCHEMAS}

current_conversation: contextvars.ContextVar[str] = contextvars.ContextVar(
    "jarvis_conversation", default="local"
)
current_turn: contextvars.ContextVar[str] = contextvars.ContextVar("jarvis_turn", default="")


@dataclass
class FakeBackend:
    """In-memory task store for one container."""

    tasks: dict[str, dict[str, Any]] = field(
        default_factory=lambda: copy.deepcopy(INITIAL_TASKS)
    )
    next_number: int = 104

    def execute(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if name not in TOOL_NAMES:
            return {"error": f"unknown tool {name}"}
        if name == "list_projects":
            return {"projects": PROJECTS}
        if name == "list_tasks":
            return {"tasks": [self._summary(task) for task in self.tasks.values()]}
        if name == "create_task":
            task_id = f"T-{self.next_number}"
            self.next_number += 1
            task = {
                "id": task_id,
                "project": arguments.get("project"),
                "agent": arguments.get("agent"),
                "text": arguments.get("text"),
                "state": "running",
                "activity": "Starter sandkassen",
                "started_minutes_ago": 0,
                "pull_request": None,
            }
            self.tasks[task_id] = task
            return {"created": self._summary(task)}

        task = self.tasks.get(str(arguments.get("task_id", "")).upper())
        if task is None:
            return {"error": "task not found", "known_task_ids": sorted(self.tasks)}
        if name == "task_status":
            return {"task": dict(task)}
        if name == "steer_task":
            if task["state"] not in {"running", "paused"}:
                return {"error": f"task is {task['state']}"}
            task["activity"] = f"Retter kursen: {arguments.get('text')}"
            return {"steered": self._summary(task)}
        if name == "pause_task":
            if task["state"] != "running":
                return {"error": f"task is {task['state']}"}
            task["state"] = "paused"
            return {"paused": self._summary(task)}
        if name == "resume_task":
            if task["state"] not in {"paused", "needs_attention"}:
                return {"error": f"task is {task['state']}"}
            task["state"] = "running"
            return {"resumed": self._summary(task)}
        if task["state"] in {"done", "cancelled"}:
            return {"error": f"task is {task['state']}"}
        task["state"] = "cancelled"
        return {"cancelled": self._summary(task)}

    @staticmethod
    def _summary(task: dict[str, Any]) -> dict[str, Any]:
        return {key: task[key] for key in ("id", "project", "agent", "text", "state", "activity")}


class ToolLog:
    """Records tool calls and model usage locally and, when configured, in Azure Table storage."""

    def __init__(self) -> None:
        self.entries: list[dict[str, Any]] = []
        self.instance = socket.gethostname()
        self.writes = 0
        self.last_error = ""
        account = os.getenv("JARVIS_TOOL_LOG_ACCOUNT", "").strip()
        table = os.getenv("JARVIS_TOOL_LOG_TABLE", "toolcalls").strip()
        self._client = None
        self._credential = None
        if account:
            from azure.data.tables.aio import TableClient
            from azure.identity.aio import DefaultAzureCredential

            self._credential = DefaultAzureCredential()
            self._client = TableClient(
                endpoint=f"https://{account}.table.core.windows.net",
                table_name=table,
                credential=self._credential,
            )

    async def record(self, kind: str, **fields: Any) -> None:
        entry = {
            "kind": kind,
            "instance": self.instance,
            "conversation": current_conversation.get(),
            "turn": current_turn.get(),
            "at_ms": int(time.time() * 1000),
            **fields,
        }
        self.entries.append(entry)
        if self._client is None:
            return
        row = {
            "PartitionKey": "calls",
            "RowKey": f"{time.time_ns():020d}-{uuid.uuid4().hex[:8]}",
            **{key: _table_value(value) for key, value in entry.items()},
        }
        try:
            await self._client.create_entity(row)
            self.writes += 1
        except Exception as exc:
            self.last_error = f"{type(exc).__name__}: {str(exc)[:300]}"
            logger.warning("Could not write the tool log entry", exc_info=True)

    def diagnostics(self) -> str:
        return (
            f"tool log: table={'on' if self._client else 'off'}, entries={len(self.entries)}, "
            f"writes={self.writes}, last_error={self.last_error or 'none'}"
        )

    async def close(self) -> None:
        if self._client is not None:
            await self._client.close()
        if self._credential is not None:
            await self._credential.close()


def _table_value(value: Any) -> Any:
    if isinstance(value, bool) or value is None or isinstance(value, float):
        return value
    if isinstance(value, int):
        if -(2**31) <= value < 2**31:
            return value
        from azure.data.tables import EdmType, EntityProperty

        return EntityProperty(value, EdmType.INT64)
    if isinstance(value, str):
        return value[:30_000]
    return json.dumps(value, ensure_ascii=False)[:30_000]
