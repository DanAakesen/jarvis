"""Deploy already-built runner images. Executed only by the main-branch workflow."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import time
from pathlib import Path
from urllib.parse import quote, urlparse

import httpx

READ_SECRET_ROLE = "4633458b-17de-408a-b874-0445c86b69e6"
WRITE_SECRET_ROLE = "b86a8fe4-44ce-4948-aee5-eccb2c155cd7"
METRICS_ROLE = "3913510d-42f4-4e42-8a64-420c390055eb"
TIERS = {"1x2": ("1", "2Gi"), "2x4": ("2", "4Gi")}
DEFAULT_DISK_LOW_THRESHOLD_BYTES = 1024**3


def _disk_low_threshold_bytes(configured: str | None = None) -> int:
    if configured is None:
        configured = os.environ.get("JARVIS_DISK_LOW_THRESHOLD_BYTES")
    if configured is None:
        return DEFAULT_DISK_LOW_THRESHOLD_BYTES
    if not re.fullmatch(r"[0-9]+", configured) or int(configured) < 1:
        raise ValueError("JARVIS_DISK_LOW_THRESHOLD_BYTES must be a positive integer")
    return int(configured)


def _github_app_tokens_enabled(app_id: str, configured: str | None = None) -> bool:
    if configured is None:
        configured = os.environ.get("JARVIS_GITHUB_APP_TOKEN_ENABLED", "false")
    if configured not in {"true", "false"}:
        raise ValueError("JARVIS_GITHUB_APP_TOKEN_ENABLED must be true or false")
    if configured == "true" and not app_id:
        raise ValueError("GITHUB_APP_ID is required when GitHub App tokens are enabled")
    return configured == "true"


def az(subscription: str, *arguments: str):
    result = subprocess.run(
        ["az", *arguments, "--subscription", subscription, "--only-show-errors", "--output", "json"],
        capture_output=True, text=True, timeout=180,
    )
    if result.returncode:
        # CLI output can contain provider details; never include it in an exception.
        raise RuntimeError(f"Azure CLI {arguments[0]} command failed")
    return json.loads(result.stdout) if result.stdout.strip() else None


def definition(
    image: str,
    tier: str,
    vault_uri: str,
    backend_url: str,
    api_scope: str,
    disk_low_threshold_bytes: int = DEFAULT_DISK_LOW_THRESHOLD_BYTES,
    github_app_tokens_enabled: bool = False,
) -> dict:
    if type(disk_low_threshold_bytes) is not int or disk_low_threshold_bytes < 1:
        raise ValueError("JARVIS_DISK_LOW_THRESHOLD_BYTES must be a positive integer")
    cpu, memory = TIERS[tier]
    return {
        "kind": "hosted", "cpu": cpu, "memory": memory,
        "container_configuration": {"image": image},
        "protocol_versions": [{"protocol": "invocations", "version": "2.0.0"}],
        "environment_variables": {
            "KEY_VAULT_URI": vault_uri,
            "JARVIS_WORK_ROOT": "/files/jarvis",
            "JARVIS_BACKEND_URL": backend_url,
            "JARVIS_API_SCOPE": api_scope,
            "JARVIS_DISK_LOW_THRESHOLD_BYTES": str(disk_low_threshold_bytes),
            **({"JARVIS_GITHUB_APP_TOKEN_ENABLED": "true"} if github_app_tokens_enabled else {}),
        },
        "session_configuration": {"idle_timeout_seconds": 120},
    }


def backend_settings(outputs: dict, bootstrap: dict) -> tuple[str, str]:
    hostname = outputs["backendFqdn"]["value"]
    backend_url = f"https://{hostname}"
    parsed = urlparse(backend_url)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.port is not None
            or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment):
        raise ValueError("Invalid backend URL")
    identifier_uri = bootstrap["api"]["identifierUri"]
    if not re.fullmatch(r"api://[\da-fA-F]{8}(-[\da-fA-F]{4}){3}-[\da-fA-F]{12}", identifier_uri):
        raise ValueError("Invalid Jarvis API identifier URI")
    return backend_url, f"{identifier_uri}/.default"


class Foundry:
    def __init__(self, subscription: str):
        self.subscription = subscription
        self.client = httpx.Client(timeout=60)

    def request(self, method: str, url: str, body: dict | None = None, merge: bool = False) -> dict:
        token = az(self.subscription, "account", "get-access-token", "--resource", "https://ai.azure.com/")
        response = self.client.request(
            method, url, json=body,
            headers={"Authorization": f"Bearer {token['accessToken']}",
                     "Content-Type": "application/merge-patch+json" if merge else "application/json"},
        )
        if not response.is_success:
            raise httpx.HTTPStatusError(
                f"Foundry request failed with HTTP {response.status_code}",
                request=response.request, response=response,
            )
        return response.json() if response.content else {}

    def wait_for_route(self, url: str) -> None:
        deadline = time.monotonic() + 1800
        authorization_deadline = time.monotonic() + 300
        while True:
            try:
                self.request("GET", url)
                return
            except httpx.HTTPStatusError as exc:
                transient = exc.response.status_code == 404 or (
                    exc.response.status_code == 403 and time.monotonic() < authorization_deadline)
                if not transient or time.monotonic() >= deadline:
                    raise
                time.sleep(15)


def probe(foundry: Foundry, runtime_endpoint: str, agent: str) -> None:
    root = f"{runtime_endpoint}/agents/{agent}/endpoint"
    # Explicitly create the session so cleanup can run even if invocation fails.
    session = foundry.request("POST", f"{root}/sessions?api-version=v1", {})
    # Foundry returns the platform session as agent_session_id (L59).
    session_id = session.get("agent_session_id") or session.get("session_id") or session.get("id")
    if not isinstance(session_id, str) or not session_id:
        raise RuntimeError("Probe session response has no session identifier")
    escaped = quote(session_id, safe="")
    try:
        for provider in ("copilot", "codex"):
            result = foundry.request(
                "POST", f"{root}/protocols/invocations?api-version=v1&agent_session_id={escaped}",
                {"agent": provider, "probe": "key-vault"},
            )
            if result.get("key_vault_access") is not True:
                raise RuntimeError(f"{provider} Key Vault identity probe failed")
    finally:
        foundry.request("DELETE", f"{root}/sessions/{escaped}?api-version=v1")


def grant(subscription: str, principal: str, role: str, scope: str) -> None:
    existing = az(subscription, "role", "assignment", "list", "--scope", scope,
                  "--fill-principal-name", "false")
    if any(row.get("principalId") == principal and row.get("roleDefinitionId", "").endswith(role)
           and row.get("scope", "").lower() == scope.lower()
           for row in existing):
        return
    az(subscription, "role", "assignment", "create", "--assignee-object-id", principal,
       "--assignee-principal-type", "ServicePrincipal", "--role", role, "--scope", scope)


def grant_named(subscription: str, principal: str, role: str, scope: str) -> None:
    definitions = az(subscription, "role", "definition", "list", "--name", role)
    if len(definitions) != 1:
        raise RuntimeError(f"Could not resolve required role {role}")
    grant(subscription, principal, definitions[0]["name"], scope)


def deploy(
    foundry: Foundry,
    subscription: str,
    outputs: dict,
    image: str,
    name: str,
    tier: str,
    backend_url: str,
    api_scope: str,
    disk_low_threshold_bytes: int = DEFAULT_DISK_LOW_THRESHOLD_BYTES,
    github_app_tokens_enabled: bool = False,
) -> dict:
    admin = outputs["foundryAdminEndpoint"]["value"]
    runtime = outputs["foundryRuntimeEndpoint"]["value"]
    vault_name = outputs["keyVaultName"]["value"]
    vault = az(subscription, "keyvault", "show", "--name", vault_name)
    insights = az(subscription, "resource", "list", "--resource-group", "rg-jarvis",
                  "--resource-type", "Microsoft.Insights/components")
    if len(insights) != 1:
        raise RuntimeError("Expected exactly one Application Insights resource in rg-jarvis")
    ai = insights[0]
    foundry.wait_for_route(f"{admin}/connections?api-version=v1")
    versions = f"{admin}/agents/{name}/versions"
    version = foundry.request("POST", f"{versions}?api-version=v1",
                              {"definition": definition(
                                  image, tier, vault["properties"]["vaultUri"], backend_url, api_scope,
                                  disk_low_threshold_bytes,
                                  github_app_tokens_enabled,
                              )})
    version_number = version.get("version")
    if version_number is None:
        raise RuntimeError("Foundry did not return an agent version")
    version_url = f"{versions}/{quote(str(version_number), safe='')}?api-version=v1"
    deadline = time.monotonic() + 900
    while True:
        current = foundry.request("GET", version_url)
        if current.get("status") == "active":
            break
        if current.get("status") == "failed" or time.monotonic() >= deadline:
            raise RuntimeError(f"Agent {name} version failed or timed out")
        time.sleep(10)
    if current.get("definition", {}).get("session_configuration", {}).get("idle_timeout_seconds") != 120:
        raise RuntimeError("Agent version did not retain the 120-second idle timeout")
    foundry.request("PATCH", f"{admin}/agents/{name}?api-version=v1", {
        "agent_endpoint": {
            "version_selector": {"version_selection_rules": [
                {"agent_version": str(version_number), "traffic_percentage": 100, "type": "FixedRatio"}]},
            "protocol_configuration": {"invocations": {}},
        },
    }, merge=True)
    record = foundry.request("GET", f"{admin}/agents/{name}?api-version=v1")
    principal = (record.get("instance_identity") or current.get("instance_identity") or {}).get("principal_id")
    if not principal:
        raise RuntimeError("Agent has no dedicated Entra identity")
    for secret in ("jarvis-github", "jarvis-copilot", "codex-login"):
        grant(subscription, principal, READ_SECRET_ROLE, f"{vault['id']}/secrets/{secret}")
    grant(subscription, principal, WRITE_SECRET_ROLE, f"{vault['id']}/secrets/codex-login")
    grant(subscription, principal, METRICS_ROLE, ai["id"])
    foundry.wait_for_route(f"{runtime}/agents/{name}/endpoint/sessions?api-version=v1")
    # RBAC propagation can be delayed. Repeat only the read-only credential probe;
    # each attempt owns and deletes its session, and deployment/version writes never retry.
    deadline = time.monotonic() + 300
    while True:
        try:
            probe(foundry, runtime, name)
            break
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 503 or time.monotonic() >= deadline:
                raise
            time.sleep(15)
    return {"agent": name, "version": str(version_number), "image": image,
            "tier": tier, "principal_id": principal, "key_vault_probe": True}


def main() -> None:
    if os.environ.get("GITHUB_REF") != "refs/heads/main":
        raise RuntimeError("Runner deployment is allowed only from main")
    parser = argparse.ArgumentParser()
    parser.add_argument("--subscription", required=True)
    parser.add_argument("--outputs", type=Path, required=True)
    parser.add_argument("--registry", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--state", type=Path, required=True)
    args = parser.parse_args()
    outputs = json.loads(args.outputs.read_text())
    bootstrap = json.loads(Path("infra/bootstrap.output.json").read_text())
    backend_url, api_scope = backend_settings(outputs, bootstrap)
    disk_low_threshold_bytes = _disk_low_threshold_bytes()
    github_app_id = os.environ.get("GITHUB_APP_ID", "")
    if github_app_id and not re.fullmatch(r"[1-9][0-9]{0,19}", github_app_id):
        raise ValueError("GITHUB_APP_ID must be a positive decimal identifier")
    github_app_tokens_enabled = _github_app_tokens_enabled(github_app_id)
    for key, suffix in (("foundryAdminEndpoint", ".services.ai.azure.com"),
                        ("foundryRuntimeEndpoint", ".cognitiveservices.azure.com")):
        endpoint = urlparse(outputs[key]["value"])
        if endpoint.scheme != "https" or not (endpoint.hostname or "").endswith(suffix):
            raise ValueError(f"Invalid {key}")
    # Bootstrap grants ARM Contributor and RBAC Administrator, not Foundry data-plane access.
    scope = (f"/subscriptions/{args.subscription}/resourceGroups/rg-jarvis/providers/"
             f"Microsoft.CognitiveServices/accounts/{outputs['foundryAccountName']['value']}")
    project = f"{scope}/projects/{outputs['foundryProjectName']['value']}"
    principal = bootstrap["deploy"]["servicePrincipalId"]
    for role in ("Foundry Project Manager", "Foundry User"):
        grant_named(args.subscription, principal, role, project)
    account = az(args.subscription, "resource", "show", "--ids", project,
                 "--api-version", "2025-04-01-preview")
    grant_named(args.subscription, account["identity"]["principalId"], "Foundry User", scope)
    foundry = Foundry(args.subscription)
    results = []
    try:
        for tech in ("base", "dotnet"):
            reference = f"jarvis-runner-{tech}:{args.tag}"
            manifest = az(args.subscription, "acr", "manifest", "show-metadata", "--registry",
                          args.registry, "--name", reference)
            digest = manifest.get("digest", "")
            if not digest.startswith("sha256:"):
                raise RuntimeError("ACR image has no manifest digest")
            image = f"{outputs['containerRegistryLoginServer']['value']}/jarvis-runner-{tech}@{digest}"
            for tier in TIERS:
                result = deploy(
                    foundry, args.subscription, outputs, image, f"jarvis-runner-{tech}-{tier}",
                    tier, backend_url, api_scope, disk_low_threshold_bytes,
                    github_app_tokens_enabled,
                )
                results.append(result)
                args.state.write_text(json.dumps(results, indent=2) + "\n")
    finally:
        foundry.client.close()


if __name__ == "__main__":
    main()
