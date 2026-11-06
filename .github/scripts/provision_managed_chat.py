"""Provision only the separate #1350 managed comparison agent; never invoke models.

An authenticated, authorized deployment identity and a private complete current
Jarvis function manifest are inputs. No login, token export, grant or deletion.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit

AGENT_NAME = "jarvis-main-copilot-preview"
MARKER = {"jarvis_migration": "managed-chat-1350"}
MODEL = "gpt-6.1-terra"
PROJECT_ID = ("/subscriptions/0ac7d719-89bc-4100-be87-a79d33e953a7/resourceGroups/rg-jarvis/providers/"
              "Microsoft.CognitiveServices/accounts/jarvis-20261003200000-rmw7kae3bza6a/projects/jarvis-20261003200000")
PROJECT_ENDPOINT = "https://jarvis-20261003200000-rmw7kae3bza6a.services.ai.azure.com/api/projects/jarvis-20261003200000"
MAX_BYTES = 2 * 1024 * 1024
FEATURE = "MicrosoftCopilot=V1Preview"
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "agents" / "jarvis"))


class Blocked(Exception):
    """A fixed content-free failure; never use provider details as its message."""

    def __init__(self, code: str, diagnostic: str | None = None):
        super().__init__(code)
        self.diagnostic = diagnostic


def require(condition: bool, code: str) -> None:
    if not condition:
        raise Blocked(code)


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def definition(manifest: dict) -> dict:
    require(isinstance(manifest, dict) and set(manifest) == {"instructions", "tools"}, "manifest_invalid")
    instructions, tools = manifest["instructions"], manifest["tools"]
    require(isinstance(instructions, str) and bool(instructions.strip()) and len(instructions) <= 100_000,
            "manifest_invalid")
    require(isinstance(tools, list) and 0 < len(tools) <= 256, "manifest_invalid")
    names = set()
    for tool in tools:
        require(isinstance(tool, dict), "manifest_tools_invalid")
        name = tool.get("name")
        require(tool.get("type") == "function" and tool.get("strict") is False
                and isinstance(name, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", name) is not None
                and "___" not in name and name not in names
                and isinstance(tool.get("parameters"), dict)
                and tool["parameters"].get("type") == "object"
                and set(tool) <= {"type", "name", "strict", "description", "parameters"}, "manifest_tools_invalid")
        names.add(name)
    return {"kind": "prompt", "harness": {"type": "microsoft_copilot_preview"},
            "model": MODEL, "reasoning": {"effort": "high"}, "instructions": instructions,
            "tools": [{"type": "microsoft_copilot_toolset_preview", "default_config": {"enabled": False}},
                      *sorted(copy.deepcopy(tools), key=lambda tool: tool["name"])]}


def private_write(path: Path, value: object) -> None:
    # New files only: never follow a symlink or leave stale success from a failed run.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        stream.write(canonical(value) + "\n")


def azure_error_metadata(stderr: bytes) -> dict:
    """Keep known CLI status labels/error codes, never its free-text message."""
    if len(stderr) > 64 * 1024:
        return {}
    try:
        value = stderr.decode("utf-8").strip()
    except UnicodeError:
        return {}
    if value.startswith("ERROR: "):
        value = value.removeprefix("ERROR: ")
    metadata = {}
    for label, status in {"Bad Request": 400, "Unauthorized": 401, "Forbidden": 403,
                          "Not Found": 404, "Conflict": 409, "Too Many Requests": 429,
                          "Internal Server Error": 500, "Bad Gateway": 502,
                          "Service Unavailable": 503, "Gateway Timeout": 504}.items():
        if value == label or value.startswith(label + "("):
            metadata["http_status"] = status
            value = value[len(label):]
            if value.startswith("(") and value.endswith(")"):
                value = value[1:-1]
            break
    code = None
    try:
        parsed = json.loads(value)
        error = parsed.get("error", parsed) if isinstance(parsed, dict) else None
        if isinstance(error, dict):
            code = error.get("code")
    except (ValueError, TypeError):
        # Some CLI versions use '(Code) message' instead of the REST JSON wrapper.
        match = re.match(r"^\(([A-Za-z][A-Za-z0-9_]{0,63})\)(?: |$)", value)
        if match:
            code = match[1]
    allowed = {"AuthorizationFailed", "AuthenticationFailed", "InvalidAuthenticationToken",
               "Forbidden", "Unauthorized", "ResourceNotFound", "NotFound", "BadRequest",
               "InvalidRequest", "InvalidArgument", "InvalidPayload", "InvalidApiVersionParameter",
               "NoRegisteredProviderFound", "UnsupportedApiVersion", "Conflict", "TooManyRequests",
               "QuotaExceeded", "InsufficientQuota", "OperationNotAllowed", "RequestDisallowedByPolicy",
               "InternalServerError", "ServiceUnavailable", "invalid_request_error",
               "invalid_request", "invalid_argument", "permission_denied", "not_found"}
    if isinstance(code, str) and code in allowed:
        metadata["azure_code"] = code
    return metadata


class Azure:
    def __init__(self, endpoint: str, project_id: str, *, read_only: bool = False):
        self.endpoint = endpoint
        self.project_id = project_id
        self.deadline = time.monotonic() + 300
        self.read_only = read_only
        self.mutation_attempted = False

    def operation(self, method: str, url: str) -> str:
        path = urlsplit(url).path
        account = self.project_id.rsplit("/projects/", 1)[0]
        if method == "GET":
            arm = {account: "account_read", self.project_id: "project_read",
                   account + "/deployments/" + MODEL: "model_deployment_read"}
            if path in arm:
                return arm[path]
        base = urlsplit(self.endpoint).path + "/agents"
        agent = base + "/" + AGENT_NAME
        operation = {("GET", base): "agent_inventory", ("GET", agent): "agent_read",
                     ("GET", agent + "/versions"): "version_inventory",
                     ("POST", base): "agent_create", ("POST", agent + "/versions"): "agent_version_create",
                     ("PATCH", agent): "endpoint_pin"}
        if method == "GET" and path.startswith(agent + "/versions/"):
            return "version_read"
        return operation.get((method, path), "other")

    def blocked_request(self, code: str, method: str, url: str, stderr: bytes = b"") -> Blocked:
        fields = {"operation": self.operation(method, url), "method": method,
                  "mutation_attempted": str(self.mutation_attempted).lower(), **azure_error_metadata(stderr)}
        diagnostic = "managed_chat_azure_diagnostic " + " ".join(f"{key}={value}" for key, value in fields.items())
        return Blocked(code, diagnostic)

    def request(self, method: str, url: str, body: dict | None = None) -> dict:
        require(time.monotonic() < self.deadline, "provision_budget_exhausted")
        require(method in {"GET", "POST", "PATCH"}, "unexpected_request_method")
        require(not self.read_only or method == "GET", "inspection_write_forbidden")
        data_api = url.startswith(self.endpoint + "/")
        arm_api = url.startswith("https://management.azure.com" + self.project_id.rsplit("/projects/", 1)[0])
        require(data_api or arm_api, "unexpected_request_target")
        command = ["az", "rest", "--method", method, "--url", url, "--resource",
                   "https://ai.azure.com" if data_api else "https://management.azure.com/",
                   "--only-show-errors", "--output", "json"]
        headers = ["Foundry-Features=" + FEATURE] if data_api else []
        if body is not None:
            headers.append("Content-Type=" + ("application/merge-patch+json" if method == "PATCH" else "application/json"))
        if headers:
            command.extend(["--headers", *headers])
        # Bodies contain private instructions/schemas: pass a restricted file, never argv or logs.
        with tempfile.TemporaryDirectory(prefix="jarvis-managed-") as directory:
            if body is not None:
                path = Path(directory) / "body.json"
                private_write(path, body)
                command.extend(["--body", "@" + str(path)])
            try:
                self.mutation_attempted = self.mutation_attempted or method != "GET"
                result = subprocess.run(command, capture_output=True, check=False, timeout=30)
            except (OSError, subprocess.TimeoutExpired):
                raise self.blocked_request("azure_request_unavailable", method, url) from None
        if result.returncode != 0:
            raise self.blocked_request("azure_request_failed", method, url, result.stderr)
        if len(result.stdout) > MAX_BYTES:
            raise self.blocked_request("azure_response_invalid", method, url)
        try:
            parsed = json.loads(result.stdout)
        except (ValueError, UnicodeError):
            raise self.blocked_request("azure_response_invalid", method, url) from None
        if not isinstance(parsed, dict):
            raise self.blocked_request("azure_response_invalid", method, url)
        return parsed

    def data(self, path: str, method: str = "GET", body: dict | None = None) -> dict:
        return self.request(method, self.endpoint + path + ("&" if "?" in path else "?") + "api-version=v1", body)

    def inventory(self, path: str) -> list[dict]:
        url = self.endpoint + path + ("&" if "?" in path else "?") + "api-version=v1"
        records = []
        for _ in range(10):
            page = self.request("GET", url)
            items = page.get("data", page.get("value"))
            require(isinstance(items, list) and all(isinstance(item, dict) for item in items), "inventory_invalid")
            records.extend(items)
            require(len(records) <= 1000, "inventory_incomplete")
            next_url = page.get("nextLink", page.get("next_link"))
            if not next_url:
                return records
            require(isinstance(next_url, str) and next_url.startswith(self.endpoint + path.split("?")[0]),
                    "inventory_invalid")
            url = next_url
        raise Blocked("inventory_incomplete")


def validate_target(endpoint: str, project_id: str) -> str:
    require(project_id == PROJECT_ID and endpoint.rstrip("/") == PROJECT_ENDPOINT, "project_target_invalid")
    parsed = urlsplit(endpoint)
    require(parsed.scheme == "https" and parsed.port is None and parsed.username is None
            and parsed.password is None and not parsed.query and not parsed.fragment, "project_target_invalid")
    match = re.fullmatch(r"/subscriptions/[0-9a-fA-F-]{36}/resourceGroups/([A-Za-z0-9_-]+)/providers/"
                         r"Microsoft.CognitiveServices/accounts/([A-Za-z0-9_-]+)/projects/([A-Za-z0-9_-]+)", project_id)
    require(match is not None, "project_target_invalid")
    require(parsed.netloc == match[2] + ".services.ai.azure.com"
            and parsed.path.rstrip("/") == "/api/projects/" + match[3], "project_target_invalid")
    return endpoint.rstrip("/")


def preflight(azure: Azure) -> None:
    account_id = azure.project_id.rsplit("/projects/", 1)[0]
    account = azure.request("GET", "https://management.azure.com" + account_id + "?api-version=2025-06-01")
    project = azure.request("GET", "https://management.azure.com" + azure.project_id + "?api-version=2025-04-01-preview")
    require(account.get("id", "").lower() == account_id.lower()
            and project.get("id", "").lower() == azure.project_id.lower()
            and account.get("location", "").lower() == "swedencentral"
            and project.get("location", "").lower() == "swedencentral", "project_region_mismatch")
    deployment = azure.request("GET", "https://management.azure.com" + account_id
                               + "/deployments/" + MODEL + "?api-version=2024-10-01")
    properties = deployment.get("properties", {})
    require(properties.get("provisioningState") == "Succeeded"
            and properties.get("model", {}).get("name") == MODEL, "model_deployment_unverified")


def validate_version(value: dict, expected: dict, version: str) -> dict:
    from managed_definition_fingerprint import normalized_managed_definition
    require(value.get("name") == AGENT_NAME and value.get("version") == version
            and value.get("status") == "active" and value.get("draft") is not True
            and value.get("metadata") == MARKER, "agent_version_unverified")
    try:
        actual = normalized_managed_definition(value.get("definition"))
        require(canonical(actual) == canonical(normalized_managed_definition(expected)), "agent_definition_mismatch")
    except (TypeError, ValueError, KeyError):
        raise Blocked("agent_definition_mismatch") from None
    return actual


def agent_principal(agent: dict) -> str:
    require(agent.get("name") == AGENT_NAME, "existing_agent_ambiguous")
    require(agent.get("state") == "enabled", "agent_state_not_enabled")
    identity = agent.get("instance_identity")
    require(isinstance(identity, dict), "agent_identity_unverified")
    # Foundry omits this optional Entra status when unset; state is effective enablement.
    status = identity.get("status")
    require(status is None or status == "active", "agent_identity_not_active")
    principal = identity.get("principal_id")
    require(isinstance(principal, str)
            and re.fullmatch(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", principal) is not None,
            "agent_principal_unverified")
    return principal


def read_active_version(azure: Azure, version: str) -> dict:
    require(isinstance(version, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", version) is not None,
            "agent_version_unverified")
    for attempt in range(12):
        readback = azure.data("/agents/" + AGENT_NAME + "/versions/" + version)
        if readback.get("status") == "active":
            return readback
        require(readback.get("status") == "creating", "agent_version_unverified")
        require(attempt < 11, "agent_activation_incomplete")
        time.sleep(2)
    raise Blocked("agent_activation_incomplete")


def matching_versions(azure: Azure, expected: dict, versions: list[dict]) -> list[tuple[str, dict]]:
    # Unique exact matches make a later reviewed retry reusable, including an
    # accepted create whose response was lost. Never automatically retry a write.
    identifiers = [item.get("version") for item in versions]
    require(all(isinstance(value, str) for value in identifiers)
            and len(set(identifiers)) == len(identifiers) and bool(identifiers), "existing_agent_ambiguous")
    matches = []
    for version in identifiers:
        readback = read_active_version(azure, version)
        try:
            actual = validate_version(readback, expected, version)
            matches.append((version, actual))
        except Blocked as error:
            # Only a definition change is refreshable. Unowned, draft or inactive
            # versions are not evidence that this is our comparison resource.
            if str(error) != "agent_definition_mismatch":
                raise
    require(len(matches) <= 1, "existing_agent_ambiguous")
    return matches


def inspect_comparison(azure: Azure, expected: dict) -> dict:
    """Read existing state without creating, pinning or producing activation output."""
    preflight(azure)
    records = [item for item in azure.inventory("/agents") if item.get("name") == AGENT_NAME]
    require(len(records) <= 1, "existing_agent_ambiguous")
    if not records:
        return {"state": "missing", "version_count": 0, "matching_version_count": 0, "pin": "absent"}
    agent = azure.data("/agents/" + AGENT_NAME)
    agent_principal(agent)
    versions = azure.inventory("/agents/" + AGENT_NAME + "/versions?include_drafts=true")
    matches = matching_versions(azure, expected, versions)
    selector = (agent.get("agent_endpoint") or {}).get("version_selector")
    rules = selector.get("version_selection_rules") if isinstance(selector, dict) else None
    require(isinstance(rules, list) and len(rules) == 1 and isinstance(rules[0], dict)
            and rules[0].get("type") == "FixedRatio" and rules[0].get("traffic_percentage") == 100
            and rules[0].get("agent_version") in [item["version"] for item in versions], "agent_endpoint_unverified")
    return {"state": "present", "version_count": len(versions), "matching_version_count": len(matches),
            "pin": "matching" if matches and rules[0]["agent_version"] == matches[0][0] else "other_version"}


def comparison_version(azure: Azure, expected: dict, versions: list[dict], *, refresh: bool) -> tuple[str, dict]:
    matches = matching_versions(azure, expected, versions)
    if matches:
        return matches[0]
    require(refresh, "agent_definition_mismatch")
    identifiers = [item["version"] for item in versions]
    agent = azure.data("/agents/" + AGENT_NAME)
    principal = agent_principal(agent)
    selector = (agent.get("agent_endpoint") or {}).get("version_selector")
    rules = selector.get("version_selection_rules") if isinstance(selector, dict) else None
    require(isinstance(rules, list) and len(rules) == 1 and isinstance(rules[0], dict)
            and rules[0].get("type") == "FixedRatio" and rules[0].get("traffic_percentage") == 100
            and rules[0].get("agent_version") in identifiers, "agent_endpoint_unverified")
    azure.data("/agents/" + AGENT_NAME + "/versions", "POST", {"metadata": MARKER, "definition": expected})
    after = azure.inventory("/agents/" + AGENT_NAME + "/versions?include_drafts=true")
    after_ids = [item.get("version") for item in after]
    require(all(isinstance(value, str) for value in after_ids)
            and len(set(after_ids)) == len(after_ids)
            and set(identifiers) < set(after_ids) and len(after_ids) == len(identifiers) + 1,
            "existing_agent_ambiguous")
    version = next(iter(set(after_ids) - set(identifiers)))
    actual = validate_version(read_active_version(azure, version), expected, version)
    require(agent_principal(azure.data("/agents/" + AGENT_NAME)) == principal, "agent_endpoint_unverified")
    return version, actual


def provision(azure: Azure, expected: dict, *, refresh_definition: bool = False) -> dict:
    preflight(azure)
    records = azure.inventory("/agents")
    matches = [item for item in records if item.get("name") == AGENT_NAME]
    require(len(matches) <= 1, "existing_agent_ambiguous")
    if not matches:
        # No mutation retry: POST can create another version after an uncertain outcome.
        azure.data("/agents", "POST", {"name": AGENT_NAME, "metadata": MARKER, "definition": expected})
    agent = azure.data("/agents/" + AGENT_NAME)
    require(agent.get("name") == AGENT_NAME, "existing_agent_ambiguous")
    versions = azure.inventory("/agents/" + AGENT_NAME + "/versions?include_drafts=true")
    version, actual = comparison_version(azure, expected, versions, refresh=refresh_definition)
    agent = azure.data("/agents/" + AGENT_NAME)
    principal = agent_principal(agent)
    selector = {"version_selection_rules": [{"type": "FixedRatio", "agent_version": version, "traffic_percentage": 100}]}
    if (agent.get("agent_endpoint") or {}).get("version_selector") != selector:
        azure.data("/agents/" + AGENT_NAME, "PATCH", {"agent_endpoint": {"version_selector": selector}})
    agent = azure.data("/agents/" + AGENT_NAME)
    require((agent.get("agent_endpoint") or {}).get("version_selector") == selector
            and agent_principal(agent) == principal, "agent_endpoint_unverified")
    actual = validate_version(azure.data("/agents/" + AGENT_NAME + "/versions/" + version), expected, version)
    from managed_definition_fingerprint import managed_definition_fingerprint
    return {"projectEndpoint": azure.endpoint, "agentName": AGENT_NAME, "version": version,
            "fingerprint": managed_definition_fingerprint(azure.endpoint, AGENT_NAME, version, actual)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--project-endpoint", required=True)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--inspect", action="store_true")
    parser.add_argument("--refresh-definition", action="store_true")
    args = parser.parse_args(argv)
    try:
        require(not args.output.exists() and not args.output.is_symlink(), "activation_output_exists")
        endpoint = validate_target(args.project_endpoint, args.project_id)
        require(args.manifest.stat().st_size <= MAX_BYTES, "manifest_invalid")
        expected = definition(json.loads(args.manifest.read_text(encoding="utf-8")))
        require(not args.refresh_definition or args.apply, "refresh_requires_apply")
        if args.inspect:
            report = inspect_comparison(Azure(endpoint, args.project_id, read_only=True), expected)
            print("managed_chat_inspection_ok " + canonical(report))
            return 0
        if not args.apply:
            print("managed_chat_manifest_validated")
            return 0
        activation = provision(Azure(endpoint, args.project_id), expected, refresh_definition=args.refresh_definition)
        private_write(args.output, activation)
        print("managed_chat_provisioned")
        return 0
    except Blocked as error:
        if error.diagnostic:
            print(error.diagnostic, file=sys.stderr)
        print(str(error), file=sys.stderr)
    except (OSError, ValueError, TypeError, KeyError, RuntimeError, ImportError, AttributeError, IndexError):
        print("managed_chat_provisioning_unavailable", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
