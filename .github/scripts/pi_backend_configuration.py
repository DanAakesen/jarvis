#!/usr/bin/env python3
"""Build the secure PI backend parameter retained by ordinary Bicep deployments."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import sys

AGENT_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
SECRET_PATTERN = re.compile(r"[A-Za-z0-9_-]{43,128}")
GITHUB_PATTERN = re.compile(r"github_pat_[A-Za-z0-9_]{50,255}")
UUID_PATTERN = re.compile(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")
PI_ENV = {
    "JARVIS_PI_AGENT_NAME",
    "JARVIS_PI_MCP_SECRET",
    "JARVIS_PI_MONTHLY_CAP_DKK",
    "JARVIS_PI_GITHUB_TOKEN",
    "JARVIS_PI_GITHUB_FP",
    "JARVIS_PI_AZURE_MCP_URL",
    "JARVIS_PI_AZURE_MCP_CLIENT_ID",
}


class InvalidConfiguration(ValueError):
    pass


def one(items: list[dict], name: str) -> str | None:
    matches = [item for item in items if item.get("name") == name]
    if len(matches) > 1:
        raise InvalidConfiguration("pi_configuration_duplicate")
    value = matches[0].get("value") or matches[0].get("secretRef") if matches else None
    return value if isinstance(value, str) and value else None


def secret(secrets: list[dict], name: str) -> str | None:
    matches = [item for item in secrets if item.get("name") == name]
    if len(matches) > 1:
        raise InvalidConfiguration("pi_secret_duplicate")
    value = matches[0].get("value") if matches else None
    return value if isinstance(value, str) and value else None


def configuration(backends: object, secrets: object, fallback_agent: str) -> dict[str, str]:
    if not isinstance(backends, list) or len(backends) > 1:
        raise InvalidConfiguration("backend_identity_invalid")
    if not isinstance(secrets, list):
        raise InvalidConfiguration("pi_secrets_invalid")
    env_items = []
    if backends:
        candidate = backends[0].get("pi") if isinstance(backends[0], dict) else None
        if not isinstance(candidate, list):
            raise InvalidConfiguration("pi_environment_invalid")
        env_items = candidate
    if any(not isinstance(item, dict) or item.get("name") not in PI_ENV for item in env_items):
        raise InvalidConfiguration("pi_environment_invalid")
    mcp_secret = secret(secrets, "pi-mcp-secret") or ""
    agent_name = one(env_items, "JARVIS_PI_AGENT_NAME") or (fallback_agent if mcp_secret else "")
    github_token = secret(secrets, "pi-github-token") or ""
    github_fingerprint = one(env_items, "JARVIS_PI_GITHUB_FP") or (
        hashlib.sha256(github_token.encode("utf-8")).hexdigest()[:16] if github_token else ""
    )
    values = {
        "agentName": agent_name,
        "mcpSecret": mcp_secret,
        "githubToken": github_token,
        "githubFingerprint": github_fingerprint,
        "azureMcpUrl": one(env_items, "JARVIS_PI_AZURE_MCP_URL") or "",
        "azureMcpClientId": one(env_items, "JARVIS_PI_AZURE_MCP_CLIENT_ID") or "",
        "monthlyCapDkk": one(env_items, "JARVIS_PI_MONTHLY_CAP_DKK") or "",
    }
    if bool(values["agentName"]) != bool(values["mcpSecret"]):
        raise InvalidConfiguration("pi_core_configuration_incomplete")
    if values["agentName"] and not AGENT_PATTERN.fullmatch(values["agentName"]):
        raise InvalidConfiguration("pi_agent_name_invalid")
    if values["mcpSecret"] and not SECRET_PATTERN.fullmatch(values["mcpSecret"]):
        raise InvalidConfiguration("pi_secret_invalid")
    if bool(values["githubToken"]) != bool(values["githubFingerprint"]):
        raise InvalidConfiguration("pi_github_configuration_incomplete")
    if values["githubToken"] and (
        not GITHUB_PATTERN.fullmatch(values["githubToken"])
        or not re.fullmatch(r"[0-9a-f]{16}", values["githubFingerprint"])
    ):
        raise InvalidConfiguration("pi_github_configuration_invalid")
    if bool(values["azureMcpUrl"]) != bool(values["azureMcpClientId"]):
        raise InvalidConfiguration("pi_azure_configuration_incomplete")
    if values["azureMcpUrl"] and (
        not values["azureMcpUrl"].startswith("https://")
        or values["azureMcpUrl"].endswith("/")
        or not UUID_PATTERN.fullmatch(values["azureMcpClientId"])
    ):
        raise InvalidConfiguration("pi_azure_configuration_invalid")
    if values["monthlyCapDkk"] and (
        not values["monthlyCapDkk"].isdigit()
        or not 1 <= int(values["monthlyCapDkk"]) <= 100000
    ):
        raise InvalidConfiguration("pi_monthly_cap_invalid")
    return values


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backends", type=Path, required=True)
    parser.add_argument("--secrets", type=Path, required=True)
    parser.add_argument("--agent-name", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        values = configuration(
            json.loads(args.backends.read_text(encoding="utf-8")),
            json.loads(args.secrets.read_text(encoding="utf-8")),
            args.agent_name,
        )
    except (InvalidConfiguration, OSError, ValueError, KeyError, TypeError):
        print("::error::Existing PI backend configuration is incomplete or invalid.", file=sys.stderr)
        return 1
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump({"parameters": {"piAgentConfiguration": {"value": values}}}, stream)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
