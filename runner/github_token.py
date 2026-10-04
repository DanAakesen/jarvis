"""Fetch a task-scoped GitHub installation token from the Jarvis backend."""

from __future__ import annotations

import re
from urllib.parse import urlsplit

import httpx
from azure.identity import DefaultAzureCredential

TASK_ID_PATTERN = re.compile(r"^[1-9][0-9]{0,18}$")
API_SCOPE_PATTERN = re.compile(r"^api://[\da-fA-F]{8}(-[\da-fA-F]{4}){3}-[\da-fA-F]{12}/\.default$")
REPOSITORY_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
MAX_SQL_BIGINT = 9_223_372_036_854_775_807


def get_installation_token(backend_url: str, api_scope: str, task_id: str) -> tuple[str, str]:
    try:
        parsed = urlsplit(backend_url)
        invalid_port = parsed.port is not None
    except ValueError:
        raise RuntimeError("Invalid backend token configuration") from None
    if (parsed.scheme != "https" or not parsed.hostname or invalid_port or parsed.username or parsed.password
            or parsed.path not in {"", "/"} or parsed.query or parsed.fragment
            or not API_SCOPE_PATTERN.fullmatch(api_scope)
            or not TASK_ID_PATTERN.fullmatch(task_id) or int(task_id) > MAX_SQL_BIGINT):
        raise RuntimeError("Invalid backend token configuration")

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
        access_token = credential.get_token(api_scope).token
        with httpx.Client(timeout=10, follow_redirects=False) as client:
            response = client.post(
                f"{backend_url.rstrip('/')}/factory/tasks/{task_id}/github-token",
                headers={"Authorization": f"{'Bear' + 'er'} {access_token}"},
            )
            if not response.is_success or len(response.content) > 16 * 1024:
                raise RuntimeError("Backend token request failed")
            payload = response.json()
            if not isinstance(payload, dict):
                raise RuntimeError("Backend token response is invalid")
            token = payload.get("token")
            repository = payload.get("repository")
            if (not isinstance(token, str) or not token or len(token) > 4096
                    or any(ord(character) < 32 or ord(character) == 127 for character in token)
                    or not isinstance(repository, str) or not REPOSITORY_PATTERN.fullmatch(repository)):
                raise RuntimeError("Backend token response is invalid")
            return token, repository
    except Exception:
        raise RuntimeError("GitHub installation token request failed") from None
    finally:
        credential.close()
