"""Foundry Invocations adapter for Copilot CLI and Codex ACP.

The container intentionally receives only the Key Vault URI as an agent-version
setting.  At task start it uses the hosted agent's Entra identity to retrieve
the per-task credentials, writes the Codex login file with restrictive
permissions, and starts the selected ACP server over stdio.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import math
import os
import re
import shutil
import socket
import time
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass, field
from hashlib import sha256
from itertools import chain
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from azure.identity.aio import DefaultAzureCredential
from azure.keyvault.secrets.aio import SecretClient
from azure.ai.agentserver.invocations import InvocationAgentServerHost
import httpx
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


APP_VERSION = "0.2.0"
WORK_ROOT = Path(os.environ.get("JARVIS_WORK_ROOT", "/files/jarvis"))
MAX_EVENTS = 500
MAX_EVENT_PAYLOAD_BYTES = 256 * 1024
DEFAULT_DISK_LOW_THRESHOLD_BYTES = 1024**3
DISK_CHECK_INTERVAL_SECONDS = 15
TASK_STATE_FILE = "task-state.json"
TASK_STATE_DIR = "invocations"
ACP_SESSION_FILE = "acp-session.json"
WORKSPACE_FILE = "workspace.json"
GIT_TIMEOUT_SECONDS = 120
LOGGER = logging.getLogger("jarvis.runner")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
# Identifies this container instance; a resume after idle deprovisioning shows a new value.
RUNNER_INSTANCE = {"host": socket.gethostname(), "pid": os.getpid(), "started_at": time.time()}
ACTIVE_STATUSES = {"queued", "running"}
STOP_WAIT_SECONDS = 90
STOPPED_STATUS = {"steer": "interrupted", "pause": "paused"}
CODEX_LOGIN_SECRET = "codex-login"
# Key Vault secret names match the GitHub token names (L62).
COPILOT_TOKEN_SECRET = "jarvis-copilot"
GITHUB_TOKEN_SECRET = "jarvis-github"
# Codex renews its login itself only when the access token (valid 10 days) is
# within 5 minutes of expiry, and each renewal invalidates every other copy.
# Jarvis renews earlier, in one sandbox at a time, so tasks never renew mid-run.
CODEX_RENEW_MIN_DAYS_LEFT = 3.0
# An unreadable access token plus an old last_refresh makes Codex renew at once,
# through its own client (codex-rs login/src/auth/manager.rs).
CODEX_RENEW_ACCESS_TOKEN_MARKER = "jarvis-renew-required"
CODEX_CONFIG = 'cli_auth_credentials_store = "file"\n'
TASK_ID_PATTERN = re.compile(r"^[1-9][0-9]{0,18}$")
MAX_SQL_BIGINT = 9_223_372_036_854_775_807
TASK_DELIVERY_INSTRUCTIONS = (
    "Keep your work on the existing task branch. To limit work lost in a sandbox crash, "
    "after each meaningful work step create a small commit and push it to that branch, "
    "small enough for another agent to resume from. Never force-push or push to main. "
    "Use the runner's configured Git credentials without exposing or persisting them. "
    "Before finishing, push remaining commits and report their commit IDs; explicitly "
    "report any commit or push failure."
)
_LAST_REFRESH = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$")


class RunnerEventPublisher:
    def __init__(self, backend_url: str, api_scope: str):
        try:
            parsed = urlsplit(backend_url)
            invalid_port = parsed.port is not None
        except ValueError:
            raise RuntimeError("JARVIS_BACKEND_URL must be an HTTPS origin") from None
        if (parsed.scheme != "https" or not parsed.hostname or invalid_port or parsed.username or parsed.password
                or parsed.path not in {"", "/"} or parsed.query or parsed.fragment):
            raise RuntimeError("JARVIS_BACKEND_URL must be an HTTPS origin")
        if not re.fullmatch(r"api://[\da-fA-F]{8}(-[\da-fA-F]{4}){3}-[\da-fA-F]{12}/\.default", api_scope):
            raise RuntimeError("JARVIS_API_SCOPE must be the Jarvis API application scope")
        self.url = f"{backend_url.rstrip('/')}/factory/sandbox-events"
        self.api_scope = api_scope
        self.credential = DefaultAzureCredential(
            exclude_interactive_browser_credential=True,
            exclude_environment_credential=True,
            exclude_shared_token_cache_credential=True,
            exclude_visual_studio_code_credential=True,
            exclude_cli_credential=True,
            exclude_powershell_credential=True,
            exclude_developer_cli_credential=True,
            exclude_broker_credential=True,
        )
        self.client = httpx.AsyncClient(timeout=10, follow_redirects=False)

    async def publish(self, task_id: str, invocation_id: str, event_index: int, event: dict[str, Any]) -> None:
        token = await self.credential.get_token(self.api_scope)
        data = event["data"]
        summary = next(
            (data[key] for key in ("summary", "text", "error", "message", "question")
             if isinstance(data.get(key), str) and data[key].strip()),
            event["kind"].replace("_", " "),
        )
        payload = {
            "invocationId": invocation_id,
            "eventIndex": event_index,
            "runnerAt": event["at"],
            "data": data,
        }
        if len(json.dumps(payload, ensure_ascii=True).encode("utf-8")) > MAX_EVENT_PAYLOAD_BYTES:
            payload = {"invocationId": invocation_id, "eventIndex": event_index, "truncated": True}
        response = await self.client.post(
            self.url,
            json={
                "taskId": task_id,
                "type": event["kind"],
                "summary": summary[:2000],
                "payload": payload,
            },
            headers={"Authorization": " ".join(("Bearer", token.token))},
        )
        response.raise_for_status()

    async def close(self) -> None:
        try:
            await self.client.aclose()
        finally:
            await self.credential.close()


async def _publish_after(
    previous: asyncio.Task[None] | None,
    publisher: RunnerEventPublisher,
    state: "TaskState",
    task_id: str,
    invocation_id: str,
    event_index: int,
    event: dict[str, Any],
) -> None:
    if previous is not None:
        try:
            await previous
        except Exception:
            pass
    try:
        await publisher.publish(task_id, invocation_id, event_index, event)
    except Exception:
        state.event_delivery_failed = True
        raise


async def _flush_event_delivery(state: "TaskState") -> None:
    delivery_exception: Exception | None = None
    try:
        if state.event_delivery is not None:
            await state.event_delivery
    except Exception as exc:
        delivery_exception = exc
    finally:
        if state.event_delivery_failed:
            state.status = "failed"
            state.error = "Runner event delivery failed"
            LOGGER.error(
                "task event delivery failed (%s)",
                type(delivery_exception).__name__ if delivery_exception is not None else "earlier event",
            )
        if state.event_publisher is not None:
            try:
                await state.event_publisher.close()
            except Exception as exc:
                state.status = "failed"
                state.error = "Runner event delivery failed"
                LOGGER.error("task event delivery cleanup failed (%s)", type(exc).__name__)


@dataclass
class TaskState:
    invocation_id: str
    session_id: str
    agent: str
    task: str
    task_id: str | None = None
    mode: str = "task"
    model: str | None = None
    reasoning: str | None = None
    repository: str | None = None
    default_branch: str | None = None
    branch: str | None = None
    last_agent_message: str = ""
    status: str = "queued"
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    events: list[dict[str, Any]] = field(default_factory=list)
    result: dict[str, Any] | None = None
    error: str | None = None
    process: asyncio.subprocess.Process | None = None
    worker: asyncio.Task[None] | None = None
    cancel_requested: bool = False
    # Set to "steer" or "pause" when the current turn is stopped on purpose.
    stop_requested: str | None = None
    event_count: int = 0
    event_delivery_failed: bool = False
    event_publisher: RunnerEventPublisher | None = field(default=None, repr=False)
    event_delivery: asyncio.Task[None] | None = field(default=None, repr=False)

    def event(self, kind: str, **data: Any) -> None:
        event = {"at": time.time(), "kind": kind, "data": data}
        self.events.append(event)
        if len(self.events) > MAX_EVENTS:
            del self.events[: len(self.events) - MAX_EVENTS]
        event_index = self.event_count
        self.event_count += 1
        _persist_task(self)
        if self.event_publisher is not None and self.task_id is not None:
            self.event_delivery = asyncio.create_task(
                _publish_after(
                    self.event_delivery,
                    self.event_publisher,
                    self,
                    self.task_id,
                    self.invocation_id,
                    event_index,
                    event,
                )
            )


class DiskLowExceeded(Exception):
    pass


class CodexUsageLimitReached(RuntimeError):
    """codex-acp rejected the prompt because the ChatGPT plan's Codex usage limit is reached."""


class WorkspaceError(RuntimeError):
    """A safe, credential-free workspace failure."""


def _is_codex_usage_limit(error: Any) -> bool:
    data = error.get("data") if isinstance(error, dict) else None
    return isinstance(data, dict) and data.get("codexErrorInfo") == "usageLimitExceeded"


tasks: dict[str, TaskState] = {}
session_clients: dict[str, ACPClient] = {}
session_locks: dict[str, asyncio.Lock] = {}
tasks_lock = asyncio.Lock()


def _session_dir(session_id: str) -> Path:
    return WORK_ROOT / session_id


def _session_metadata_path(session_id: str) -> Path:
    return _session_dir(session_id) / ACP_SESSION_FILE


def _task_state_path(session_id: str, invocation_id: str) -> Path:
    filename = sha256(invocation_id.encode("utf-8")).hexdigest() + ".json"
    return _session_dir(session_id) / TASK_STATE_DIR / filename


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as output:
        os.fchmod(output.fileno(), 0o600)
        json.dump(value, output, separators=(",", ":"))
    temporary.replace(path)


def _disk_snapshot() -> dict[str, int | None]:
    try:
        usage = shutil.disk_usage(WORK_ROOT)
        return {
            "disk_total_bytes": usage.total,
            "disk_used_bytes": usage.used,
            "disk_free_bytes": usage.free,
        }
    except OSError:
        return {
            "disk_total_bytes": None,
            "disk_used_bytes": None,
            "disk_free_bytes": None,
        }


def _disk_low_threshold_bytes() -> int:
    configured = os.environ.get("JARVIS_DISK_LOW_THRESHOLD_BYTES")
    if configured is None:
        return DEFAULT_DISK_LOW_THRESHOLD_BYTES
    if not re.fullmatch(r"[0-9]+", configured) or int(configured) < 1:
        raise RuntimeError("JARVIS_DISK_LOW_THRESHOLD_BYTES must be a positive integer")
    return int(configured)


def _capacity_snapshot() -> dict[str, Any]:
    """Return non-secret process and session-disk capacity evidence."""
    snapshot: dict[str, Any] = {"cpu_count": os.cpu_count() or 0, **_disk_snapshot()}
    try:
        status = Path("/proc/self/status").read_text(encoding="utf-8")
        for line in status.splitlines():
            if line.startswith("VmHWM:"):
                snapshot["peak_memory_kib"] = int(line.split()[1])
                break
    except (OSError, ValueError, IndexError):
        snapshot["peak_memory_kib"] = None
    return snapshot


async def _watch_disk(state: TaskState, threshold_bytes: int) -> None:
    while True:
        await asyncio.sleep(DISK_CHECK_INTERVAL_SECONDS)
        snapshot = _disk_snapshot()
        free_bytes = snapshot["disk_free_bytes"]
        if free_bytes is not None and free_bytes < threshold_bytes:
            state.event("disk_low", **snapshot, threshold_bytes=threshold_bytes)
            return


async def _run_with_disk_watch(state: TaskState, client: "ACPClient", threshold_bytes: int) -> dict[str, Any]:
    watcher = asyncio.create_task(_watch_disk(state, threshold_bytes))
    turn = asyncio.create_task(client.run(state.task))
    try:
        done, _ = await asyncio.wait({watcher, turn}, return_when=asyncio.FIRST_COMPLETED)
        if watcher in done:
            await watcher
            if not turn.done():
                try:
                    if not await client.cancel_turn():
                        await client.stop()
                    else:
                        try:
                            await asyncio.wait_for(turn, timeout=STOP_WAIT_SECONDS)
                        except asyncio.TimeoutError:
                            await client.stop()
                            turn.cancel()
                    await asyncio.gather(turn, return_exceptions=True)
                except Exception:
                    await client.stop()
                    if not turn.done():
                        turn.cancel()
                    await asyncio.gather(turn, return_exceptions=True)
            raise DiskLowExceeded
        return await turn
    finally:
        if not watcher.done():
            watcher.cancel()
        await asyncio.gather(watcher, return_exceptions=True)


def _persist_task(state: TaskState) -> None:
    """Persist safe invocation metadata and only allowlisted Codex renewal results."""
    saved: dict[str, Any] = {
        "invocation_id": state.invocation_id,
        "session_id": state.session_id,
        "agent": state.agent,
        "task_id": state.task_id,
        "status": state.status,
        "started_at": state.started_at,
        "finished_at": state.finished_at,
    }
    if state.mode == "renew-codex":
        saved["mode"] = state.mode
        if isinstance(state.result, dict):
            for key in ("renewed", "stored", "reply_ok"):
                if isinstance(state.result.get(key), bool):
                    saved.setdefault("result", {})[key] = state.result[key]
            for key in ("last_refresh_before", "last_refresh_after", "expires_before", "expires_after", "expires"):
                value = state.result.get(key)
                if isinstance(value, str) and _LAST_REFRESH.match(value):
                    saved.setdefault("result", {})[key] = value
            if state.result.get("reason") == "fresh":
                saved.setdefault("result", {})["reason"] = "fresh"
            copilot = state.result.get("copilot")
            if isinstance(copilot, dict):
                saved["result"] = saved.get("result", {})
                saved["result"]["copilot"] = {
                    key: value
                    for key, value in copilot.items()
                    if key in {"expires", "last_renewed"}
                    and (value is None or isinstance(value, str) and _LAST_REFRESH.match(value))
                }
    _write_json(
        _task_state_path(state.session_id, state.invocation_id),
        saved,
    )


def _load_task(invocation_id: str) -> TaskState | None:
    if not WORK_ROOT.exists():
        return None
    # Prefer the per-invocation records; retain reads of older images' metadata.
    state_paths = chain(WORK_ROOT.glob(f"*/{TASK_STATE_DIR}/*.json"),
                        WORK_ROOT.glob(f"*/{TASK_STATE_FILE}"))
    for state_path in state_paths:
        try:
            saved = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if saved.get("invocation_id") != invocation_id:
            continue
        state = TaskState(
            invocation_id=invocation_id,
            session_id=str(saved["session_id"]),
            agent=str(saved["agent"]),
            task="",
            task_id=saved.get("task_id") if _valid_task_id(saved.get("task_id")) else None,
            mode=str(saved.get("mode", "task")),
            status=str(saved.get("status", "unknown")),
            started_at=float(saved.get("started_at", time.time())),
            finished_at=saved.get("finished_at"),
        )
        if state.mode == "renew-codex" and isinstance(saved.get("result"), dict):
            state.result = saved["result"]
        return state
    return None


def _load_acp_session(session_id: str, agent: str) -> dict[str, str | None] | None:
    path = _session_metadata_path(session_id)
    if not path.exists():
        return None
    try:
        saved = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise RuntimeError("Persisted ACP session metadata is unreadable")
    if saved.get("agent") != agent:
        raise RuntimeError("Persisted ACP session belongs to a different provider")
    session_id_value = saved.get("acp_session_id")
    if not isinstance(session_id_value, str) or not session_id_value:
        raise RuntimeError("Persisted ACP session metadata has no session id")
    model = saved.get("model")
    reasoning = saved.get("reasoning")
    if model is not None and not isinstance(model, str):
        raise RuntimeError("Persisted ACP session metadata has an invalid model")
    if reasoning is not None and not isinstance(reasoning, str):
        raise RuntimeError("Persisted ACP session metadata has invalid reasoning")
    return {"acp_session_id": session_id_value, "model": model, "reasoning": reasoning}


def _persist_acp_session(state: TaskState, acp_session_id: str) -> None:
    _write_json(
        _session_metadata_path(state.session_id),
        {
            "agent": state.agent,
            "foundry_session_id": state.session_id,
            "acp_session_id": acp_session_id,
            "model": state.model,
            "reasoning": state.reasoning,
        },
    )


def _required_string(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"'{key}' must be a non-empty string")
    return value.strip()


def _valid_task_id(value: Any) -> bool:
    return (isinstance(value, str) and TASK_ID_PATTERN.fullmatch(value) is not None
            and int(value) <= MAX_SQL_BIGINT)


def _optional_task_id(payload: dict[str, Any]) -> str | None:
    value = payload.get("task_id")
    if value is None:
        return None
    if not _valid_task_id(value):
        raise ValueError("'task_id' must be a valid task identifier")
    return value


def _optional_config(payload: dict[str, Any], key: str, max_length: int) -> str | None:
    value = payload.get(key)
    if value is None:
        return None
    if (not isinstance(value, str) or not value.strip() or value.lstrip().startswith("-")
            or len(value) > max_length
            or any(ord(character) < 32 or ord(character) == 127 for character in value)):
        raise ValueError(f"'{key}' must be a valid option of at most {max_length} characters")
    value = value.strip()
    return None if value == "default" else value


def _workspace_config(payload: dict[str, Any]) -> dict[str, str]:
    if not isinstance(payload, dict):
        raise ValueError("Workspace configuration must be an object")
    repository = _required_string(payload, "repository")
    if (repository != payload["repository"] or len(repository) > 140
            or not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9_.-]{1,100}", repository)
            or repository.split("/")[1] in {".", ".."}):
        raise ValueError("'repository' must be a GitHub owner/name")
    result = {"repository": repository}
    for key in ("defaultBranch", "branch"):
        value = _required_string(payload, key)
        if (value != payload[key] or len(value) > 255
                or value.startswith(("-", "/"))
                or any(character.isspace() or ord(character) < 32 or ord(character) == 127
                       or character in "~^:?*[\\" for character in value)
                or ".." in value or "//" in value or value.endswith(("/", "."))
                or "@{" in value
                or any(part.startswith(".") or part.endswith(".lock") for part in value.split("/"))
                or value == "HEAD"):
            raise ValueError(f"'{key}' must be a valid Git branch")
        result[key] = value
    if result["branch"] in {result["defaultBranch"], "main", "master"}:
        raise ValueError("'branch' must be a separate task branch")
    return result


def _session_workspace(session_id: str, payload: dict[str, Any]) -> dict[str, str]:
    path = _session_dir(session_id) / WORKSPACE_FILE
    if not path.exists():
        return _workspace_config(payload)
    try:
        saved = _workspace_config(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError, TypeError):
        raise ValueError("Persisted workspace metadata is unreadable") from None
    if any(key in payload and payload[key] != value for key, value in saved.items()):
        raise ValueError("Workspace configuration cannot change within a session")
    return saved


async def _key_vault_secret(name: str) -> str:
    value, _, _ = await _key_vault_secret_details(name)
    return value


async def _key_vault_secret_details(name: str) -> tuple[str, str | None, str | None]:
    vault_uri = os.environ.get("KEY_VAULT_URI")
    if not vault_uri:
        raise RuntimeError("KEY_VAULT_URI is not configured")
    # Hosted-agent managed identities are issued in the Foundry project
    # tenant.  The current azure-identity runtime does not accept a
    # ``tenant_id`` keyword on DefaultAzureCredential, and the managed
    # identity itself already provides the correct tenant boundary.
    credential = DefaultAzureCredential(
        exclude_interactive_browser_credential=True,
        exclude_environment_credential=True,
        exclude_shared_token_cache_credential=True,
        exclude_visual_studio_code_credential=True,
        exclude_cli_credential=True,
        exclude_powershell_credential=True,
        exclude_developer_cli_credential=True,
        exclude_broker_credential=True,
    )
    try:
        client = SecretClient(vault_url=vault_uri, credential=credential)
        try:
            secret = await client.get_secret(name)
            if not secret.value:
                raise RuntimeError(f"Key Vault secret '{name}' is empty")
            properties = secret.properties
            return secret.value, _iso(properties.expires_on), _iso(properties.updated_on)
        finally:
            await client.close()
    finally:
        await credential.close()


async def _set_key_vault_secret(name: str, value: str) -> None:
    vault_uri = os.environ.get("KEY_VAULT_URI")
    if not vault_uri:
        raise RuntimeError("KEY_VAULT_URI is not configured")
    credential = DefaultAzureCredential(
        exclude_interactive_browser_credential=True,
        exclude_environment_credential=True,
        exclude_shared_token_cache_credential=True,
        exclude_visual_studio_code_credential=True,
        exclude_cli_credential=True,
        exclude_powershell_credential=True,
        exclude_developer_cli_credential=True,
        exclude_broker_credential=True,
    )
    try:
        client = SecretClient(vault_url=vault_uri, credential=credential)
        try:
            await client.set_secret(name, value)
        finally:
            await client.close()
    finally:
        await credential.close()


def _parse_last_refresh(auth_text: str | None) -> datetime | None:
    """Read Codex's `last_refresh` timestamp from an auth.json document."""
    if not auth_text:
        return None
    try:
        value = json.loads(auth_text).get("last_refresh")
    except (json.JSONDecodeError, AttributeError):
        return None
    match = _LAST_REFRESH.match(value) if isinstance(value, str) else None
    if not match:
        return None
    base, fraction, zone = match.groups()
    micro = (fraction or "0")[:6].ljust(6, "0")
    offset = "+00:00" if zone == "Z" else zone
    return datetime.fromisoformat(f"{base}.{micro}{offset}").astimezone(timezone.utc)


def _iso(moment: datetime | None) -> str | None:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ") if moment else None


def _access_token_expiry(auth_text: str | None) -> datetime | None:
    """Read the `exp` claim of the Codex access token without verifying it."""
    try:
        token = json.loads(auth_text or "")["tokens"]["access_token"]
        parts = token.split(".")
        if len(parts) != 3:
            return None
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        expires = json.loads(base64.urlsafe_b64decode(payload))["exp"]
        return datetime.fromtimestamp(int(expires), timezone.utc)
    except (ValueError, KeyError, TypeError, AttributeError):
        return None


def _write_codex_home(codex_home: Path, auth_text: str) -> Path:
    codex_home.mkdir(parents=True, exist_ok=True)
    (codex_home / "config.toml").write_text(CODEX_CONFIG, encoding="utf-8")
    auth_path = codex_home / "auth.json"
    with os.fdopen(os.open(auth_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as auth_file:
        os.fchmod(auth_file.fileno(), 0o600)
        auth_file.write(auth_text)
    return auth_path


async def _store_codex_login_if_newer(auth_text: str | None) -> bool:
    """Write a renewed login back to Key Vault unless the stored copy is as new or newer."""
    candidate = _parse_last_refresh(auth_text)
    if candidate is None or not auth_text:
        return False
    stored = _parse_last_refresh(await _key_vault_secret(CODEX_LOGIN_SECRET))
    if stored is not None and candidate <= stored:
        return False
    await _set_key_vault_secret(CODEX_LOGIN_SECRET, auth_text)
    LOGGER.info("codex login stored last_refresh=%s", _iso(candidate))
    return True


def _codex_renew_command() -> list[str]:
    return ["codex", "exec", "--skip-git-repo-check", "Reply with the single word OK."]


async def _renew_codex_login(session_id: str, min_days_left: float, force: bool = False) -> dict[str, Any]:
    """Renew the stored Codex login in this sandbox only, then write it back.

    Skips the renewal while the access token has more than `min_days_left` days
    left. Otherwise marks this sandbox's private copy as needing renewal, so
    Codex renews it through its own client on the next request.
    """
    worktree = WORK_ROOT / session_id
    worktree.mkdir(parents=True, exist_ok=True)
    stored_text = await _key_vault_secret(CODEX_LOGIN_SECRET)
    before = _parse_last_refresh(stored_text)
    expires_before = _access_token_expiry(stored_text)
    now = datetime.now(timezone.utc)
    days_left = (expires_before - now).total_seconds() / 86400 if expires_before else None
    if not force and days_left is not None and days_left > min_days_left:
        return {
            "renewed": False,
            "reason": "fresh",
            "expires": _iso(expires_before),
            "days_left": round(days_left, 2),
        }
    document = json.loads(stored_text)
    document["tokens"]["access_token"] = CODEX_RENEW_ACCESS_TOKEN_MARKER
    document["last_refresh"] = _iso(now - timedelta(days=30))
    auth_path = _write_codex_home(worktree / ".codex", json.dumps(document))
    stored_text = None
    document = None
    env = os.environ.copy()
    env["HOME"] = str(worktree)
    env["CODEX_HOME"] = str(worktree / ".codex")
    process = None
    try:
        process = await asyncio.create_subprocess_exec(
            *_codex_renew_command(),
            cwd=str(worktree),
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=300)
        renewed_text = auth_path.read_text(encoding="utf-8")
        after = _parse_last_refresh(renewed_text)
        expires_after = _access_token_expiry(renewed_text)
        renewed = after is not None and after > now - timedelta(minutes=5) and expires_after is not None
        stored = await _store_codex_login_if_newer(renewed_text) if renewed else False
        renewed_text = None
        result: dict[str, Any] = {
            "renewed": renewed,
            "stored": stored,
            "exit_code": process.returncode,
            "reply_ok": b"OK" in stdout,
            "last_refresh_before": _iso(before),
            "last_refresh_after": _iso(after),
            "expires_before": _iso(expires_before),
            "expires_after": _iso(expires_after),
        }
        if process.returncode != 0:
            result["error"] = "Codex renewal command failed"
        return result
    finally:
        if process is not None and process.returncode is None:
            process.kill()
            await process.wait()
        auth_path.unlink(missing_ok=True)


async def _credentials_for(agent: str) -> dict[str, str]:
    github_token = await _key_vault_secret(GITHUB_TOKEN_SECRET)
    if agent == "copilot":
        return {
            "github_token": github_token,
            "copilot_token": await _key_vault_secret(COPILOT_TOKEN_SECRET),
        }
    if agent == "codex":
        return {
            "github_token": github_token,
            "codex_login": await _key_vault_secret("codex-login"),
        }
    raise ValueError("agent must be 'copilot' or 'codex'")


class ACPClient:
    """Small JSON-RPC stdio client for ACP servers.

    Keeping this transport local avoids coupling the hosted image to a specific
    generated schema revision while still using the public ACP wire protocol.
    The official Python SDK remains installed for schema compatibility and
    future richer event handling.
    """

    def __init__(
        self,
        command: list[str],
        cwd: Path,
        state: TaskState,
        env: dict[str, str],
        persisted_session_id: str | None = None,
    ):
        self.command = command
        self.cwd = cwd
        self.state = state
        self.env = env
        self.process: asyncio.subprocess.Process | None = None
        self._next_id = 1
        self._pending: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self._reader_task: asyncio.Task[None] | None = None
        self.acp_session_id: str | None = persisted_session_id
        self._agent_message_active = False
        self._secrets = [env[key] for key in ("GH_TOKEN", "COPILOT_GITHUB_TOKEN") if env.get(key)]
        if env.get("CODEX_HOME"):
            auth_path = Path(env["CODEX_HOME"]) / "auth.json"
            if auth_path.exists():
                document = json.loads(auth_path.read_text(encoding="utf-8"))
                self._secrets.extend(value for value in document.get("tokens", {}).values()
                                     if isinstance(value, str) and value)

    def _redact(self, value: Any) -> Any:
        if isinstance(value, str):
            for secret in self._secrets:
                value = value.replace(secret, "[redacted]")
            return value
        if isinstance(value, dict):
            return {key: self._redact(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self._redact(item) for item in value]
        return value

    async def start(self) -> None:
        self.process = await asyncio.create_subprocess_exec(
            *self.command,
            cwd=str(self.cwd),
            env=self.env,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self.state.process = self.process
        self._reader_task = asyncio.create_task(self._read_stdout())
        asyncio.create_task(self._read_stderr())
        initialized = await self.request(
            "initialize",
            {
                "protocolVersion": 1,
                "clientInfo": {"name": "jarvis-foundry-runner", "version": APP_VERSION},
                "clientCapabilities": {},
            },
        )
        capabilities = initialized.get("agentCapabilities") or {}
        self.state.event("acp_initialized", load_session=bool(capabilities.get("loadSession")))
        if self.acp_session_id is not None:
            await self.request(
                "session/load",
                {
                    "sessionId": self.acp_session_id,
                    "cwd": str(self.cwd),
                    "mcpServers": [],
                },
            )
            self.state.event("acp_session_loaded", session_id=self.acp_session_id)

    async def _read_stdout(self) -> None:
        assert self.process and self.process.stdout
        while True:
            line = await self.process.stdout.readline()
            if not line:
                break
            try:
                message = self._redact(json.loads(line))
            except json.JSONDecodeError:
                self.state.event("agent_output", text=self._redact(line.decode(errors="replace").strip()))
                continue
            if "id" in message and "method" not in message:
                request_id = message.get("id")
                future = self._pending.pop(request_id, None)
                if future and not future.done():
                    future.set_result(message)
            elif message.get("method") == "session/request_permission":
                options = message.get("params", {}).get("options", [])
                approved = next((option for option in options
                                 if option.get("kind") in {"allow_always", "allow_once"}), None)
                outcome = ({"outcome": "selected", "optionId": approved["optionId"]}
                           if approved and approved.get("optionId") else {"outcome": "cancelled"})
                await self._respond(message.get("id"), {"outcome": outcome})
            elif "method" in message:
                params = message.get("params", {})
                if message.get("method") == "session/update" and isinstance(params, dict):
                    update = params.get("update", {})
                    if isinstance(update, dict) and update.get("sessionUpdate") == "agent_message_chunk":
                        content = update.get("content", {})
                        if isinstance(content, dict) and content.get("type") == "text":
                            text = content.get("text")
                            if isinstance(text, str):
                                if not self._agent_message_active:
                                    self.state.last_agent_message = ""
                                self.state.last_agent_message = self._redact(
                                    self.state.last_agent_message + text
                                )[-2000:]
                                self._agent_message_active = True
                    else:
                        self._agent_message_active = False
                self.state.event(
                    "acp_notification",
                    method=message.get("method"),
                    params=message.get("params", {}),
                )

        for future in self._pending.values():
            if not future.done():
                future.set_exception(RuntimeError("ACP process closed stdout"))
        self._pending.clear()

    async def _read_stderr(self) -> None:
        assert self.process and self.process.stderr
        while True:
            line = await self.process.stderr.readline()
            if not line:
                return
            self.state.event("agent_stderr", text=self._redact(line.decode(errors="replace").strip()))

    async def _respond(self, request_id: Any, result: dict[str, Any]) -> None:
        if self.process and self.process.stdin and request_id is not None:
            self.process.stdin.write(
                (json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}) + "\n").encode()
            )
            await self.process.stdin.drain()

    async def request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        if not self.process or not self.process.stdin:
            raise RuntimeError("ACP process is not running")
        request_id = self._next_id
        self._next_id += 1
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        self.process.stdin.write(
            (
                json.dumps(
                    {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
                )
                + "\n"
            ).encode()
        )
        await self.process.stdin.drain()
        timeout_seconds = 120 if method == "initialize" else int(
            os.environ.get("ACP_REQUEST_TIMEOUT_SECONDS", "3600")
        )
        response = await asyncio.wait_for(future, timeout=timeout_seconds)
        if "error" in response:
            if _is_codex_usage_limit(response["error"]):
                raise CodexUsageLimitReached(f"ACP {method} failed: Codex usage limit reached")
            raise RuntimeError(f"ACP {method} failed: {response['error']}")
        return response.get("result", {})

    async def run(self, prompt: str) -> dict[str, Any]:
        if self.acp_session_id is None:
            session = await self.request(
                "session/new",
                {"cwd": str(self.cwd), "mcpServers": []},
            )
            self.acp_session_id = session.get("sessionId") or session.get("session_id")
            if not self.acp_session_id:
                raise RuntimeError("ACP server did not return a session id")
            _persist_acp_session(self.state, self.acp_session_id)
            self.state.event("acp_session", session_id=self.acp_session_id)
        if self.state.agent == "codex":
            for config_id, value in (("model", self.state.model), ("reasoning_effort", self.state.reasoning)):
                if value is None:
                    continue
                configured = await self.request(
                    "session/set_config_option",
                    {"sessionId": self.acp_session_id, "configId": config_id, "value": value},
                )
                config_options = configured.get("configOptions")
                selected = next(
                    (
                        option for option in config_options
                        if isinstance(option, dict) and option.get("id") == config_id
                    ) if isinstance(config_options, list) else (),
                    None,
                )
                if selected is None or selected.get("currentValue") != value:
                    raise RuntimeError(f"Codex did not apply the requested {config_id} option")
        self.state.event("agent_turn", agent=self.state.agent)
        self.state.last_agent_message = ""
        self._agent_message_active = False
        result = await self.request(
            "session/prompt",
            {
                "sessionId": self.acp_session_id,
                "prompt": [
                    {
                        "type": "text",
                        "text": f"{TASK_DELIVERY_INSTRUCTIONS}\n\n{prompt}",
                    }
                ],
            },
        )
        return {"acp_session_id": self.acp_session_id, "response": self._redact(result)}

    async def cancel_turn(self) -> bool:
        """Send ACP session/cancel; the in-flight session/prompt then returns stopReason 'cancelled'."""
        if not self.acp_session_id or not self.process or not self.process.stdin:
            return False
        if self.process.returncode is not None:
            return False
        self.process.stdin.write(
            (
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "method": "session/cancel",
                        "params": {"sessionId": self.acp_session_id},
                    }
                )
                + "\n"
            ).encode()
        )
        await self.process.stdin.drain()
        self.state.event("acp_cancel_sent", session_id=self.acp_session_id)
        return True

    async def stop(self) -> None:
        if not self.process:
            return
        if self.process.returncode is None:
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=10)
            except asyncio.TimeoutError:
                self.process.kill()
                await self.process.wait()
        if self._reader_task:
            await asyncio.gather(self._reader_task, return_exceptions=True)


def _agent_command(agent: str, model: str | None = None) -> list[str]:
    command = ["copilot", "--acp", "--stdio", "--allow-all"] if agent == "copilot" else ["codex-acp"]
    if agent == "copilot" and model is not None:
        command.extend(["--model", model])
    return command


def _credential_helper(worktree: Path) -> Path:
    helper = worktree / ".git-credential-helper"
    helper.write_text(
        "#!/bin/sh\n"
        "printf 'username=x-access-token\\npassword=%s\\n' \"$GH_TOKEN\"\n",
        encoding="utf-8",
    )
    helper.chmod(0o700)
    return helper


def _repository_url(repository: str) -> str:
    return f"https://github.com/{repository}.git"


async def _git(cwd: Path, env: dict[str, str], *args: str, allow_missing: bool = False) -> str | None:
    process = None
    try:
        process = await asyncio.create_subprocess_exec(
            "git", *args, cwd=str(cwd), env=env,
            stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        output, _ = await asyncio.wait_for(process.communicate(), timeout=GIT_TIMEOUT_SECONDS)
        if process.returncode == 1 and allow_missing:
            return None
        if process.returncode != 0:
            raise WorkspaceError("Task repository Git operation failed")
        return output.decode("utf-8").strip()
    except (OSError, UnicodeError, asyncio.TimeoutError):
        raise WorkspaceError("Task repository Git operation failed or timed out") from None
    finally:
        if process is not None and process.returncode is None:
            process.kill()
            await process.wait()


async def _workspace_head(state: TaskState, project: Path, env: dict[str, str]) -> str:
    branch = await _git(project, env, "symbolic-ref", "--quiet", "--short", "HEAD")
    if branch != state.branch:
        raise WorkspaceError("Task repository is not on the task branch")
    head = await _git(project, env, "rev-parse", "--verify", "HEAD")
    if not head or not re.fullmatch(r"[0-9a-f]{40,64}", head):
        raise WorkspaceError("Task repository has no valid commit")
    return head


async def _configure_git_identity(project: Path, env: dict[str, str]) -> None:
    # Reuse the repository's automation identity, never a person's credentials.
    for key, value in (
        ("user.name", "github-actions[bot]"),
        ("user.email", "41898282+github-actions[bot]@users.noreply.github.com"),
    ):
        if not await _git(project, env, "config", "--local", "--get", key, allow_missing=True):
            await _git(project, env, "config", "--local", key, value)


async def _prepare_workspace(state: TaskState, root: Path, env: dict[str, str]) -> tuple[Path, str]:
    try:
        config = _session_workspace(state.session_id, {
            "repository": state.repository, "defaultBranch": state.default_branch, "branch": state.branch,
        })
    except ValueError:
        raise WorkspaceError("Task repository configuration is invalid") from None
    project = root / "project"
    remote = _repository_url(config["repository"])
    if not project.exists():
        _write_json(root / WORKSPACE_FILE, config)
        try:
            await _git(root, env, "clone", "--no-checkout", "--", remote, str(project))
        except BaseException as exc:
            # Git owns this newly created directory; a failed clone must not
            # leave a partial checkout that could be mistaken for a resumed task.
            if project.exists():
                shutil.rmtree(project)
            if isinstance(exc, WorkspaceError):
                raise WorkspaceError("Task repository clone failed; verify repository access") from None
            raise
        try:
            existing = await _git(
                project, env, "show-ref", "--verify", "--quiet",
                f"refs/remotes/origin/{config['branch']}", allow_missing=True,
            )
            source = config["branch"] if existing is not None else config["defaultBranch"]
            await _git(project, env, "checkout", "-b", config["branch"], f"refs/remotes/origin/{source}", "--")
            # Never inherit the default branch as the task branch's push target.
            await _git(project, env, "config", f"branch.{config['branch']}.merge", f"refs/heads/{config['branch']}")
            await _configure_git_identity(project, env)
            return project, await _workspace_head(state, project, env)
        except BaseException:
            shutil.rmtree(project)
            raise
    else:
        if not (root / WORKSPACE_FILE).exists():
            raise WorkspaceError("Task repository has no persisted workspace configuration")
        origin = await _git(project, env, "remote", "get-url", "origin")
        if origin != remote:
            raise WorkspaceError("Task repository origin does not match the session")
        await _configure_git_identity(project, env)
    return project, await _workspace_head(state, project, env)


async def _turn_has_commit(state: TaskState, project: Path, env: dict[str, str], before: str) -> bool:
    after = await _workspace_head(state, project, env)
    if after == before:
        return False
    if await _git(project, env, "merge-base", "--is-ancestor", before, after, allow_missing=True) is None:
        raise WorkspaceError("Task branch no longer contains the turn's starting commit")
    return True


async def _stop_session_client(session_id: str) -> None:
    client = session_clients.pop(session_id, None)
    if client is not None:
        await client.stop()


async def _run_task(
    state: TaskState,
    *,
    stopped_invocation: str | None = None,
    emit_steer_after: bool = False,
) -> None:
    if state.cancel_requested:
        return
    state.status = "running"
    worktree = WORK_ROOT / state.session_id
    worktree.mkdir(parents=True, exist_ok=True)
    credentials: dict[str, str] = {}
    client: ACPClient | None = None
    session_lock = session_locks.setdefault(state.session_id, asyncio.Lock())
    lock_acquired = False
    try:
        if state.task_id is not None:
            backend_url = os.environ.get("JARVIS_BACKEND_URL")
            api_scope = os.environ.get("JARVIS_API_SCOPE")
            if not backend_url or not api_scope:
                raise RuntimeError("Runner event delivery is not configured")
            state.event_publisher = RunnerEventPublisher(backend_url, api_scope)
        if emit_steer_after:
            state.event("steer_after", stopped_invocation=stopped_invocation)
        state.event("started", agent=state.agent)
        state.event("runner_instance", **RUNNER_INSTANCE)
        threshold_bytes = _disk_low_threshold_bytes()
        disk = _disk_snapshot()
        state.event("disk_snapshot", **disk, threshold_bytes=threshold_bytes)
        free_bytes = disk["disk_free_bytes"]
        if free_bytes is not None and free_bytes < threshold_bytes:
            state.event("disk_low", **disk, threshold_bytes=threshold_bytes)
            raise DiskLowExceeded
        await session_lock.acquire()
        lock_acquired = True
        if state.cancel_requested:
            return
        if state.session_id in session_clients:
            raise WorkspaceError("Task session still has an active provider")
        if client is None:
            credentials = await _credentials_for(state.agent)
            if state.cancel_requested:
                return
            env = os.environ.copy()
            env["GIT_TERMINAL_PROMPT"] = "0"
            # Foundry may provide a read-only /home/session mount.  Keep
            # CLI caches and ACP metadata on the session's persistent,
            # runner-owned filesystem instead.
            env["HOME"] = str(worktree)
            env["XDG_CACHE_HOME"] = str(worktree / ".cache")
            env["GH_TOKEN"] = credentials["github_token"]
            env["GIT_CONFIG_NOSYSTEM"] = "1"
            env["GIT_CONFIG_COUNT"] = "1"
            env["GIT_CONFIG_KEY_0"] = "credential.helper"
            env["GIT_CONFIG_VALUE_0"] = f"!{_credential_helper(worktree)}"
            project, starting_commit = await _prepare_workspace(state, worktree, env)
            if state.agent == "copilot":
                env["COPILOT_GITHUB_TOKEN"] = credentials["copilot_token"]
            else:
                codex_home = worktree / ".codex"
                _write_codex_home(codex_home, credentials["codex_login"])
                env["CODEX_HOME"] = str(codex_home)
            # Do not retain secret strings in state or event payloads.
            credentials.clear()
            persisted_session = _load_acp_session(state.session_id, state.agent)
            if persisted_session is not None:
                state.model = persisted_session["model"]
                state.reasoning = persisted_session["reasoning"]
            client = ACPClient(
                _agent_command(state.agent, state.model),
                project,
                state,
                env,
                persisted_session_id=(
                    persisted_session["acp_session_id"] if persisted_session is not None else None
                ),
            )
            await client.start()
            session_clients[state.session_id] = client
        if state.cancel_requested:
            return
        state.result = await _run_with_disk_watch(state, client, threshold_bytes)
        if state.stop_requested:
            state.status = STOPPED_STATUS[state.stop_requested]
            state.event(state.status, result=state.result)
        else:
            has_commit = await _turn_has_commit(state, project, env, starting_commit)
            state.status = "completed"
            response = state.result.get("response", {})
            if isinstance(response, dict) and response.get("stopReason") == "end_turn" and not has_commit:
                state.event(
                    "session_question",
                    question=state.last_agent_message or "The agent ended without a new commit.",
                    result=state.result,
                )
            else:
                state.event("completed", result=state.result)
    except asyncio.CancelledError:
        state.status = "cancelled"
        state.event("cancelled")
        raise
    except DiskLowExceeded:
        state.status = "cancelled"
    except Exception as exc:  # sanitized: exception text never includes credentials
        if state.stop_requested:
            # A forced stop after the cancel timeout closes the ACP stream.
            state.status = STOPPED_STATUS[state.stop_requested]
            state.event(state.status, forced=True, error=type(exc).__name__)
        elif state.status != "cancelled" and isinstance(exc, CodexUsageLimitReached):
            state.status = "failed"
            state.error = "Codex usage limit reached"
            state.event("failed", error=state.error, reason="codex_usage_limit")
        elif state.status != "cancelled":
            state.status = "failed"
            state.error = str(exc) if isinstance(exc, WorkspaceError) else f"Runner task failed: {type(exc).__name__}"
            state.event("failed", error=state.error)
    finally:
        try:
            # Keep the Foundry session's filesystem and ACP session id, but do not
            # retain a provider process between turns.  A subsequent steer or
            # resume creates a fresh ACP process and uses session/load, so events
            # are attributed to the new invocation and the process cannot hang on
            # a stale request stream.
            # start() can fail after spawning but before registration. Dispose the
            # locally owned client even in that case, and never stop a newer turn's
            # client belonging to a different invocation.
            if client is not None:
                if session_clients.get(state.session_id) is client:
                    session_clients.pop(state.session_id)
                await client.stop()
            if lock_acquired and state.agent == "codex":
                # Codex may have renewed its login during the turn (for example after
                # a 401). Keep the newest copy in Key Vault so other sandboxes stay valid.
                auth_path = worktree / ".codex" / "auth.json"
                try:
                    if auth_path.exists() and await _store_codex_login_if_newer(auth_path.read_text(encoding="utf-8")):
                        state.event("codex_login_stored")
                except Exception as exc:  # sanitized: names the error type only
                    state.event("codex_login_store_failed", error=type(exc).__name__)
                finally:
                    auth_path.unlink(missing_ok=True)
            capacity = _capacity_snapshot()
            state.event("capacity", **capacity)
            LOGGER.info("capacity %s", json.dumps(capacity, sort_keys=True))
            credentials.clear()
            await _flush_event_delivery(state)
            state.finished_at = time.time()
            _persist_task(state)

        finally:
            if lock_acquired:
                session_lock.release()

async def _stop_running_turn(session_id: str, reason: str, exclude: str | None = None) -> TaskState | None:
    """Stop the session's active turn at a safe point (ACP cancel), forcing it after a timeout."""
    running = next(
        (
            t
            for t in tasks.values()
            if t.session_id == session_id and t.status in ACTIVE_STATUSES and t.invocation_id != exclude
        ),
        None,
    )
    if running is None:
        return None
    running.stop_requested = reason
    running.event(f"{reason}_requested")
    client = session_clients.get(session_id)
    if client is not None:
        await client.cancel_turn()
    deadline = time.monotonic() + STOP_WAIT_SECONDS
    while running.status in ACTIVE_STATUSES and time.monotonic() < deadline:
        await asyncio.sleep(1)
    if running.status in ACTIVE_STATUSES:
        running.event("stop_timeout_forced", seconds=STOP_WAIT_SECONDS)
        if running.process and running.process.returncode is None:
            running.process.terminate()
        deadline = time.monotonic() + 30
        while running.status in ACTIVE_STATUSES and time.monotonic() < deadline:
            await asyncio.sleep(1)
    return running


async def _steer_then_run(state: TaskState) -> None:
    stopped = await _stop_running_turn(state.session_id, "steer", exclude=state.invocation_id)
    await _run_task(
        state,
        stopped_invocation=stopped.invocation_id if stopped else None,
        emit_steer_after=True,
    )


async def _run_codex_renewal(state: TaskState, min_days_left: float, force: bool) -> None:
    session_lock = session_locks.setdefault(state.session_id, asyncio.Lock())
    lock_acquired = False
    try:
        await session_lock.acquire()
        lock_acquired = True
        if state.cancel_requested:
            return
        state.status = "running"
        state.event("started", agent="codex", mode="renew-codex")
        state.result = await _renew_codex_login(state.session_id, min_days_left, force)
        try:
            _, expires, updated = await _key_vault_secret_details(COPILOT_TOKEN_SECRET)
            state.result["copilot"] = {"expires": expires, "last_renewed": updated}
        except Exception:
            pass
        state.status = "completed"
        state.event("completed", result=state.result)
    except asyncio.CancelledError:
        state.status = "cancelled"
        state.event("cancelled")
        raise
    except Exception as exc:  # sanitized: exception text never includes credentials
        state.status = "failed"
        state.error = f"Codex renewal failed: {type(exc).__name__}"
        state.event("failed", error=state.error)
    finally:
        state.finished_at = time.time()
        _persist_task(state)
        if lock_acquired:
            session_lock.release()


def _steering_prompt(message: str) -> str:
    return (
        "Correction from the user while you were working:\n"
        f"{message}\n\n"
        "Apply this correction to the task you were working on. Update anything you already "
        "did that conflicts with it, then continue and finish the task."
    )


app = InvocationAgentServerHost(
    openapi_spec={
        "openapi": "3.0.3",
        "info": {"title": "Jarvis Foundry runner", "version": APP_VERSION},
        "paths": {"/invocations": {"post": {"responses": {"200": {"description": "started"}}}}},
    }
)


@app.invoke_handler
async def invoke(request: Request) -> Response:
    try:
        payload = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JSONResponse({"error": "Valid JSON required"}, status_code=400)
    if not isinstance(payload, dict):
        return JSONResponse({"error": "JSON object required"}, status_code=400)
    mode = str(payload.get("mode") or "task").lower()
    if mode not in {"task", "steer", "pause", "renew-codex"}:
        return JSONResponse(
            {"error": "mode must be 'task', 'steer', 'pause', or 'renew-codex'"},
            status_code=400,
        )
    if mode == "pause":
        session_id = request.state.session_id
        running = next(
            (t for t in tasks.values() if t.session_id == session_id and t.status in ACTIVE_STATUSES),
            None,
        )
        if running is not None:
            asyncio.create_task(_stop_running_turn(session_id, "pause"))
        return JSONResponse(
            {
                "session_id": session_id,
                "status": "pausing" if running else "idle",
                "paused_invocation": running.invocation_id if running else None,
            }
        )
    try:
        agent = _required_string(payload, "agent").lower()
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    if agent not in {"copilot", "codex"}:
        return JSONResponse({"error": "agent must be 'copilot' or 'codex'"}, status_code=400)

    invocation_id = request.state.invocation_id
    session_id = request.state.session_id
    if mode == "renew-codex":
        if agent != "codex":
            return JSONResponse({"error": "Codex renewal requires the codex agent"}, status_code=400)
        try:
            min_days_left = float(payload.get("min_days_left", CODEX_RENEW_MIN_DAYS_LEFT))
        except (TypeError, ValueError):
            return JSONResponse({"error": "min_days_left must be between 0 and 30"}, status_code=400)
        if not math.isfinite(min_days_left) or not 0 <= min_days_left <= 30:
            return JSONResponse({"error": "min_days_left must be between 0 and 30"}, status_code=400)
        state = TaskState(
            invocation_id=invocation_id, session_id=session_id, agent=agent, task="", mode=mode,
        )
        async with tasks_lock:
            tasks[invocation_id] = state
        state.worker = asyncio.create_task(
            _run_codex_renewal(state, min_days_left, force=payload.get("force") is True)
        )
        return JSONResponse({
            "invocation_id": invocation_id,
            "session_id": session_id,
            "status": state.status,
            "agent": agent,
            "mode": mode,
        })
    if payload.get("probe") == "key-vault":
        credentials: dict[str, str] = {}
        try:
            credentials = await _credentials_for(agent)
            return JSONResponse({"key_vault_access": True, "session_id": session_id})
        except Exception:
            # Keep probe responses Boolean-only so an exception cannot expose
            # credential-provider details through the deployment gate.
            return JSONResponse({"key_vault_access": False, "session_id": session_id}, status_code=503)
        finally:
            credentials.clear()
    try:
        task_id = _optional_task_id(payload)
        if os.environ.get("JARVIS_BACKEND_URL") and task_id is None:
            raise ValueError("'task_id' is required")
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    try:
        task = (
            _steering_prompt(_required_string(payload, "message"))
            if mode == "steer"
            else _required_string(payload, "task")
        )
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    try:
        model = _optional_config(payload, "model", 100)
        reasoning = _optional_config(payload, "reasoning", 32)
        if agent == "copilot" and reasoning is not None:
            raise ValueError("'reasoning' is only supported for Codex")
        workspace = _session_workspace(session_id, payload)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    state = TaskState(
        invocation_id=invocation_id,
        session_id=session_id,
        agent=agent,
        task=task,
        task_id=task_id,
        model=model,
        reasoning=reasoning,
        repository=workspace["repository"],
        default_branch=workspace["defaultBranch"],
        branch=workspace["branch"],
    )
    async with tasks_lock:
        tasks[invocation_id] = state
    state.worker = asyncio.create_task(_steer_then_run(state) if mode == "steer" else _run_task(state))
    return JSONResponse(
        {
            "invocation_id": invocation_id,
            "session_id": session_id,
            "status": state.status,
            "agent": agent,
            "mode": mode,
        }
    )


@app.get_invocation_handler
async def get_invocation(request: Request) -> Response:
    invocation_id = request.state.invocation_id
    state = tasks.get(invocation_id)
    if not state:
        state = _load_task(invocation_id)
        if state:
            tasks[invocation_id] = state
    if not state:
        return JSONResponse({"error": "invocation not found"}, status_code=404)
    return JSONResponse(
        {
            "invocation_id": state.invocation_id,
            "session_id": state.session_id,
            "agent": state.agent,
            "status": state.status,
            "started_at": state.started_at,
            "finished_at": state.finished_at,
            "events": state.events,
            "result": state.result,
            "error": state.error,
        }
    )


@app.cancel_invocation_handler
async def cancel_invocation(request: Request) -> Response:
    invocation_id = request.state.invocation_id
    state = tasks.get(invocation_id)
    if not state:
        return JSONResponse({"error": "invocation not found"}, status_code=404)
    if state.status in {"completed", "failed", "cancelled", "paused", "interrupted"}:
        return JSONResponse({"invocation_id": invocation_id, "status": state.status})
    first_cancel = not state.cancel_requested
    state.cancel_requested = True
    state.status = "cancelling"
    state.event("cancel_requested")
    if state.worker is not None:
        if first_cancel:
            state.worker.cancel()
        await asyncio.gather(state.worker, return_exceptions=True)
    elif state.process and state.process.returncode is None:
        state.process.terminate()
        await state.process.wait()
    # Never dispose a later turn when cancelling an older invocation.
    client = session_clients.get(state.session_id)
    if client is not None and client.state is state:
        await _stop_session_client(state.session_id)
    state.status = "cancelled"
    state.finished_at = time.time()
    _persist_task(state)
    return JSONResponse({"invocation_id": invocation_id, "status": state.status})


if __name__ == "__main__":
    app.run()
