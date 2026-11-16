"""Provision the PI agent (managed Microsoft Copilot harness) from the files in agents/pi.

Runs in the Deploy workflow with the deployment identity. It creates the Jarvis skills, a Foundry project connection
that holds the MCP secret (Foundry refuses credentials in an MCP tool's own headers), then one prompt agent version
that carries the instructions, the Jarvis MCP server (by connection) and the skill references, pins the endpoint to
that version, and gives the backend the agent name and the MCP secret. It is idempotent: when nothing changed it creates nothing.
It invokes no model and prints no definition, because the definition carries the MCP credential.

Reach: the read-only GitHub MCP server (a fine-grained token the owner creates) and the Azure MCP server (Reader, scale to
zero) are attached when their inputs exist. A server whose input is missing is left out and reported as not attached; a
server whose connection cannot be written is left out and fails the job after the agent is defined, so nothing is hidden.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PI = ROOT / "agents" / "pi"
# The harness needs MicrosoftCopilot; skills need Skills. A skill reference in an agent definition needs both.
AGENT_FEATURES = "MicrosoftCopilot=V1Preview,Skills=V1Preview"
SKILL_FEATURES = "Skills=V1Preview"
# Values that must never reach a log, even when Foundry echoes part of the request back in its error message.
REDACT: list[str] = []
SECRET_NAME = "pi-mcp-secret"
ARM = "https://management.azure.com"
CONNECTIONS_API = "2025-04-01-preview"
FINGERPRINT_KEY = "jarvis_pi_fingerprint"
GITHUB_TOKEN_PATTERN = re.compile(r"github_pat_[A-Za-z0-9_]{50,255}")
UUID_PATTERN = re.compile(r"[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")


class Blocked(Exception):
    """A fixed, content-free failure code."""


def require(condition: bool, code: str) -> None:
    if not condition:
        raise Blocked(code)


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_spec() -> dict:
    spec = json.loads((PI / "definition.json").read_text(encoding="utf-8"))
    require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", spec["agentName"]) is not None, "agent_name_invalid")
    require(spec["reasoningEffort"] in {"none", "low", "medium", "high"}, "reasoning_effort_invalid")
    require(spec["mcp"]["requireApproval"] == "never", "approval_policy_unsupported")
    labels = [spec["mcp"]["serverLabel"]] + [server["serverLabel"] for server in spec.get("reach", [])]
    require(len(labels) == len(set(labels)) and all(re.fullmatch(r"[a-z][a-z0-9_]{0,31}", label) for label in labels), "reach_label_invalid")
    return spec


def instructions_text() -> str:
    """The static persona: agents/pi/instructions.md with the shared identity contract filled in."""
    contract = json.loads((ROOT / "agents" / "jarvis" / "identity-contract.json").read_text(encoding="utf-8"))
    text = (PI / "instructions.md").read_text(encoding="utf-8")
    text = text.replace("{{identity_kernel}}", contract["fixedKernel"]["en"])
    text = text.replace("{{product_identity}}", contract["productIdentity"]["en"])
    # A leftover placeholder would be read by Foundry as a structured input.
    require("{{" not in text, "instructions_placeholder_unresolved")
    return text


def parse_skill(name: str) -> dict:
    raw = (PI / "skills" / name / "SKILL.md").read_text(encoding="utf-8")
    match = re.fullmatch(r"---\n(.*?)\n---\n(.*)", raw, flags=re.DOTALL)
    require(match is not None, "skill_format_invalid")
    fields = dict(re.findall(r"^([a-z-]+): (.*)$", match[1], flags=re.MULTILINE))
    require(fields.get("name") == name and 0 < len(fields.get("description", "")) <= 1024, "skill_metadata_invalid")
    require(re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", name) is not None, "skill_name_invalid")
    return {"name": name, "description": fields["description"], "instructions": match[2].strip() + "\n",
            "sha256": sha256(raw)}


def build_definition(spec: dict, instructions: str, server_url: str, skills: list[dict], reach: list[dict] | None = None) -> dict:
    return {
        "kind": "prompt", "harness": {"type": "microsoft_copilot_preview"},
        "model": spec["model"], "reasoning": {"effort": spec["reasoningEffort"]},
        "instructions": instructions,
        "tools": [
            # Built-in shell, files and web stay off: everything goes through Jarvis tools and its guards.
            {"type": "microsoft_copilot_toolset_preview", "default_config": {"enabled": False}},
            {"type": "mcp", "server_label": spec["mcp"]["serverLabel"], "server_url": server_url,
             "require_approval": spec["mcp"]["requireApproval"],
             # The secret lives in this project connection and is injected as a header; the tool carries no headers.
             "project_connection_id": spec["mcp"]["connection"]},
            # Reach servers are read-only by construction (a read-only URL and token for GitHub, the Reader role and the
            # server's own read-only mode for Azure), so the harness is not asked to approve their calls.
            *[{"type": "mcp", "server_label": server["serverLabel"], "server_url": server["url"], "require_approval": "never",
               "project_connection_id": server["connection"]} for server in reach or []],
        ],
        "skills": [{"type": "skill_reference", "name": skill["name"], "version": skill["version"]} for skill in skills],
    }


def fingerprint(spec: dict, instructions: str, server_url: str, skills: list[dict], reach: list[dict] | None = None) -> str:
    """Everything that makes a new agent version necessary, hashed; skill versions are not part of it, their content is."""
    return sha256(canonical({
        "spec": spec, "instructions": instructions, "server_url": server_url,
        "reach": [[server["serverLabel"], server["url"], server["connection"]] for server in reach or []],
        "skills": [[skill["name"], skill["sha256"]] for skill in skills],
    }))


class Az:
    def __init__(self, endpoint: str):
        self.endpoint = endpoint.rstrip("/")
        self.deadline = time.monotonic() + 600

    def rest(self, method: str, path: str, body: dict | None = None, *, content_type: str = "application/json") -> dict:
        require(time.monotonic() < self.deadline, "provision_budget_exhausted")
        url = self.endpoint + path + ("&" if "?" in path else "?") + "api-version=v1"
        features = SKILL_FEATURES if path.startswith("/skills") else AGENT_FEATURES
        command = ["az", "rest", "--method", method, "--url", url, "--resource", "https://ai.azure.com",
                   "--only-show-errors", "--output", "json", "--headers", "Foundry-Features=" + features]
        with tempfile.TemporaryDirectory(prefix="jarvis-pi-") as directory:
            if body is not None:
                file = Path(directory) / "body.json"
                file.write_text(canonical(body), encoding="utf-8")
                file.chmod(0o600)
                command += ["Content-Type=" + content_type, "--body", "@" + str(file)]
            result = subprocess.run(command, capture_output=True, check=False, timeout=60)
        if result.returncode != 0:
            # Never echo stderr as is: it can quote the request body, which holds the MCP credential.
            raise Blocked(f"foundry_{method.lower()}_failed:{path.split('?')[0]}:{classify(result.stderr)}"
                          + describe_error(result.stderr))
        return json.loads(result.stdout) if result.stdout.strip() else {}


def arm_request(method: str, path: str, body: dict | None = None) -> dict:
    """An Azure Resource Manager call as the deployment identity (project connections live there)."""
    url = f"{ARM}{path}?api-version={CONNECTIONS_API}"
    command = ["az", "rest", "--method", method, "--url", url, "--resource", ARM, "--only-show-errors", "--output", "json"]
    if body is not None:
        # The body carries the MCP secret, so it goes on the command line of this short-lived call rather than into a file
        # (the job's runner is ephemeral and single-tenant, and the secret is also given to `az containerapp secret set`).
        command += ["--headers", "Content-Type=application/json", "--body", canonical(body)]
    result = subprocess.run(command, capture_output=True, check=False, timeout=60)
    if result.returncode != 0:
        raise Blocked(f"arm_{method.lower()}_failed:{path.rsplit('/', 1)[-1]}:{classify(result.stderr)}" + describe_error(result.stderr))
    return json.loads(result.stdout) if result.stdout.strip() else {}


def classify(stderr: bytes) -> str:
    text = stderr[:4096].decode("utf-8", "replace")
    if "ResourceNotFound" in text or "NotFound" in text:
        return "not_found"
    for label in ("Bad Request", "Unauthorized", "Forbidden", "Not Found", "Conflict", "Too Many Requests"):
        if label in text:
            return label.lower().replace(" ", "_")
    return "error"


def sanitize(text: str, limit: int = 300) -> str:
    """Make provider text safe to print: no credentials, identifiers, long opaque values or quoted payloads."""
    for secret in REDACT:
        if secret:
            text = text.replace(secret, "[redacted]")
    text = re.sub(r"(?i)bearer\s+\S+", "[redacted]", text)
    text = re.sub(r"\bjp\.[A-Za-z0-9_-]+", "[redacted]", text)
    text = re.sub(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_.-]+", "[redacted]", text)
    text = re.sub(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", "[id]", text)
    text = re.sub(r"https://[^\s\"']+", "[url]", text)
    text = re.sub(r"[A-Za-z0-9+/_=-]{32,}", "[redacted]", text)
    # A long quoted string is most likely the request body or instructions echoed back.
    text = re.sub(r"(['\"])[^'\"]{60,}\1", "[quoted text omitted]", text)
    text = " ".join(text.split())
    return text[:limit]


def describe_error(stderr: bytes) -> str:
    """Foundry's error code, param and message from an az rest failure, sanitized; empty when it has none."""
    text = stderr[:16384].decode("utf-8", "replace")
    fields: dict[str, str] = {}
    start, end = text.find("{"), text.rfind("}")
    if 0 <= start < end:
        try:
            payload = json.loads(text[start:end + 1])
            error = payload.get("error", payload) if isinstance(payload, dict) else {}
            if isinstance(error, dict):
                fields = {key: error[key] for key in ("code", "param", "type", "message") if isinstance(error.get(key), (str, int))}
        except ValueError:
            pass
    if not fields:
        for key in ("code", "param", "message"):
            match = re.search(r'"%s"\s*:\s*"([^"]{1,300})"' % key, text)
            if match:
                fields[key] = match[1]
    parts = []
    for key, limit in (("code", 64), ("type", 64), ("param", 100), ("message", 300)):
        if key in fields:
            parts.append(f"{key}={sanitize(str(fields[key]), limit)}")
    return (" [" + "; ".join(parts) + "]") if parts else ""


def shell(*command: str) -> str:
    result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=180)
    require(result.returncode == 0, "az_command_failed:" + " ".join(command[:3]))
    return result.stdout


def backend_secret(app: str, group: str, subscription: str) -> str | None:
    listing = json.loads(shell("az", "containerapp", "secret", "list", "--name", app, "--resource-group", group,
                               "--subscription", subscription, "--show-values", "--only-show-errors", "--output", "json"))
    for item in listing:
        if item.get("name") == SECRET_NAME and isinstance(item.get("value"), str):
            return item["value"]
    return None


def configure_backend(app: str, group: str, subscription: str, agent_name: str) -> str:
    """Return the MCP secret, creating it once. The backend gets it as a Container App secret, never as plain text.

    The value is never printed: az output and errors are not echoed anywhere in this script.
    """
    secret = backend_secret(app, group, subscription)
    created = secret is None
    if secret is None:
        # An infrastructure deployment drops the Container App secret. A fresh one is generated and the project connection
        # below is updated to match; the agent version does not change because it only names the connection.
        secret = secrets.token_urlsafe(48)
    env = json.loads(shell("az", "containerapp", "show", "--name", app, "--resource-group", group, "--subscription", subscription,
                           "--query", "properties.template.containers[0].env", "--only-show-errors", "--output", "json"))
    current = {item["name"]: item.get("secretRef") or item.get("value") for item in env}
    if created:
        shell("az", "containerapp", "secret", "set", "--name", app, "--resource-group", group, "--subscription", subscription,
              "--secrets", f"{SECRET_NAME}={secret}", "--only-show-errors", "--output", "none")
    wanted = {"JARVIS_PI_AGENT_NAME": agent_name, "JARVIS_PI_MCP_SECRET": SECRET_NAME}
    if created or any(current.get(key) != value for key, value in wanted.items()):
        shell("az", "containerapp", "update", "--name", app, "--resource-group", group, "--subscription", subscription,
              "--set-env-vars", f"JARVIS_PI_AGENT_NAME={agent_name}", f"JARVIS_PI_MCP_SECRET=secretref:{SECRET_NAME}",
              "--only-show-errors", "--output", "none")
        wait_ready(app, group, subscription)
    return secret


def wait_ready(app: str, group: str, subscription: str) -> None:
    for _ in range(40):
        state = json.loads(shell("az", "containerapp", "show", "--name", app, "--resource-group", group, "--subscription",
                                 subscription, "--query", "{latest:properties.latestRevisionName,ready:properties.latestReadyRevisionName}",
                                 "--only-show-errors", "--output", "json"))
        if state["latest"] and state["latest"] == state["ready"]:
            return
        time.sleep(15)
    raise Blocked("backend_not_ready")


def ensure_skills(azure: Az, skills: list[dict], existing_fingerprint_matches: bool, versions: dict[str, str]) -> None:
    for skill in skills:
        if existing_fingerprint_matches and skill["name"] in versions:
            skill["version"] = versions[skill["name"]]
            continue
        created = azure.rest("POST", f"/skills/{skill['name']}/versions", {
            "inline_content": {"description": skill["description"], "instructions": skill["instructions"]},
        })
        version = as_version(created.get("version"))
        require(isinstance(version, str) and re.fullmatch(r"[A-Za-z0-9._-]{1,64}", version) is not None, "skill_version_invalid")
        skill["version"] = version


def as_version(value: object) -> object:
    """Foundry returns versions as strings or integers."""
    return str(value) if isinstance(value, int) and not isinstance(value, bool) else value


def current_state(azure: Az, name: str) -> dict | None:
    try:
        agent = azure.rest("GET", f"/agents/{name}")
    except Blocked as error:
        if ":not_found" in str(error):
            return None
        raise
    rules = ((agent.get("agent_endpoint") or {}).get("version_selector") or {}).get("version_selection_rules") or []
    pinned = rules[0].get("agent_version") if rules and isinstance(rules[0], dict) else None
    if not pinned:
        return {"pinned": None, "metadata": {}, "skills": {}}
    version = azure.rest("GET", f"/agents/{name}/versions/{pinned}")
    skills = {item["name"]: item["version"] for item in (version.get("definition") or {}).get("skills") or []
              if isinstance(item, dict) and "name" in item and "version" in item}
    return {"pinned": pinned, "metadata": version.get("metadata") or {}, "skills": skills, "status": version.get("status")}


def pin(azure: Az, name: str, version: str) -> None:
    selector = {"version_selection_rules": [{"type": "FixedRatio", "agent_version": version, "traffic_percentage": 100}]}
    azure.rest("PATCH", f"/agents/{name}", {"agent_endpoint": {"version_selector": selector}}, content_type="application/merge-patch+json")


def wait_active(azure: Az, name: str, version: str) -> dict:
    for _ in range(60):
        readback = azure.rest("GET", f"/agents/{name}/versions/{version}")
        if readback.get("status") == "active":
            return readback
        require(readback.get("status") == "creating", "agent_version_not_active")
        time.sleep(5)
    raise Blocked("agent_activation_timeout")


def upsert_connection(project_id: str, name: str, properties: dict, marker: dict, compare: list[str]) -> bool:
    """Create or update a project connection. True when it was written; an identical one is left alone."""
    path = f"{project_id}/connections/{name}"
    try:
        current = arm_request("GET", path).get("properties") or {}
        if all(current.get(key) == properties[key] for key in compare) and \
                all((current.get("metadata") or {}).get(k) == v for k, v in marker.items()):
            return False
    except Blocked as error:
        if ":not_found" not in str(error):
            raise
    arm_request("PUT", path, {"properties": {**properties, "metadata": marker}})
    return True


def ensure_connection(project_id: str, spec: dict, server_url: str, secret: str) -> bool:
    """Create or update the project connection that injects the Jarvis MCP secret. True when it was written."""
    return upsert_connection(project_id, spec["mcp"]["connection"], {
        "category": "CustomKeys", "authType": "CustomKeys", "target": server_url, "isSharedToAll": False,
        "credentials": {"keys": {"Authorization": f"Bearer jp.{secret}"}}},
        {"jarvis_secret_sha256": sha256(secret), "jarvis_purpose": "pi-mcp"}, ["target"])


def resolve_reach(spec: dict, args: argparse.Namespace) -> tuple[list[dict], dict[str, str]]:
    """The reach servers whose inputs exist, and a plain-words status for every declared one."""
    attached: list[dict] = []
    status: dict[str, str] = {}
    for server in spec.get("reach", []):
        label = server["serverLabel"]
        if server["kind"] == "github":
            token = os.environ.get(server["tokenEnv"], "").strip()
            if not token:
                status[label] = f"not attached: the owner has not provided the {server['tokenEnv']} secret"
                continue
            # Only a fine-grained token can be limited to chosen repositories and to read permissions.
            require(GITHUB_TOKEN_PATTERN.fullmatch(token) is not None, "github_token_not_fine_grained")
            REDACT.append(token)
            attached.append({**server, "secret": token})
        elif server["kind"] == "azure":
            url = (getattr(args, "azure_mcp_url", "") or "").strip()
            client = (getattr(args, "azure_mcp_client_id", "") or "").strip()
            if not url or not client:
                status[label] = "not attached: the Azure MCP container is not deployed (needs the JARVIS_AZURE_MCP_CLIENT_ID variable and a deploy)"
                continue
            require(url.startswith("https://") and UUID_PATTERN.fullmatch(client) is not None, "azure_mcp_input_invalid")
            attached.append({**server, "url": url, "audience": f"api://{client}"})
        else:
            raise Blocked("reach_kind_unknown")
    return attached, status


def connect_reach(project_id: str, server: dict) -> bool:
    """Write the connection one reach server needs. GitHub gets a read-only token header; Azure uses the project's identity."""
    if server["kind"] == "github":
        return upsert_connection(project_id, server["connection"], {
            "category": "CustomKeys", "authType": "CustomKeys", "target": server["url"], "isSharedToAll": False,
            "credentials": {"keys": {"Authorization": f"Bearer {server['secret']}"}}},
            {"jarvis_secret_sha256": sha256(server["secret"]), "jarvis_purpose": "pi-github-mcp"}, ["target"])
    return upsert_connection(project_id, server["connection"], {
        "category": "RemoteTool", "authType": "ProjectManagedIdentity", "target": server["url"],
        "audience": server["audience"], "isSharedToAll": False},
        {"jarvis_audience": server["audience"], "jarvis_purpose": "pi-azure-mcp"}, ["target", "audience"])


def verify(readback: dict, spec: dict, expected: str, reach: list[dict] | None = None) -> None:
    definition = readback.get("definition") or {}
    require(definition.get("harness") == {"type": "microsoft_copilot_preview"}, "readback_harness_mismatch")
    require(definition.get("model") == spec["model"], "readback_model_mismatch")
    require((definition.get("reasoning") or {}).get("effort") == spec["reasoningEffort"], "readback_reasoning_mismatch")
    require(definition.get("instructions") == expected, "readback_instructions_mismatch")
    tools = definition.get("tools") or []
    toolset = [tool for tool in tools if tool.get("type") == "microsoft_copilot_toolset_preview"]
    require(len(toolset) == 1 and (toolset[0].get("default_config") or {}).get("enabled") is False, "readback_builtins_enabled")
    mcp = {tool.get("server_label"): tool for tool in tools if tool.get("type") == "mcp"}
    wanted = {spec["mcp"]["serverLabel"]: spec["mcp"]["connection"], **{s["serverLabel"]: s["connection"] for s in reach or []}}
    require(len([tool for tool in tools if tool.get("type") == "mcp"]) == len(wanted) and set(mcp) == set(wanted), "readback_mcp_mismatch")
    for label, connection in wanted.items():
        require(mcp[label].get("require_approval") == "never", "readback_mcp_mismatch")
        require(mcp[label].get("project_connection_id") == connection and not mcp[label].get("headers"), "readback_mcp_connection_mismatch")


def provision(args: argparse.Namespace) -> dict:
    spec = load_spec()
    name = spec["agentName"]
    instructions = instructions_text()
    skills = [parse_skill(skill) for skill in spec["skills"]]
    candidates, reach_status = resolve_reach(spec, args)
    azure = Az(args.project_endpoint)
    state = current_state(azure, name)
    secret = configure_backend(args.backend_app, args.resource_group, args.subscription, name)
    REDACT.append(secret)
    server_url = f"https://{args.backend_fqdn}{spec['mcp']['path']}"
    project_id = (f"/subscriptions/{args.subscription}/resourceGroups/{args.resource_group}/providers/"
                  f"Microsoft.CognitiveServices/accounts/{args.foundry_account}/projects/{args.foundry_project}")
    connection_written = ensure_connection(project_id, spec, server_url, secret)
    reach: list[dict] = []
    problems: list[str] = []
    for server in candidates:
        try:
            connect_reach(project_id, server)
            reach.append(server)
            reach_status[server["serverLabel"]] = "attached"
        except Blocked as error:
            # Left out of the agent and reported; the job fails after the agent is defined, so it cannot go unnoticed.
            reach_status[server["serverLabel"]] = f"not attached: the connection could not be written ({error})"
            problems.append(f"{server['serverLabel']}: {error}")
    wanted = fingerprint(spec, instructions, server_url, skills, reach)
    unchanged = bool(state and state["pinned"] and state["metadata"].get(FINGERPRINT_KEY) == wanted and state.get("status") == "active")
    ensure_skills(azure, skills, unchanged, state["skills"] if state else {})
    result = {"agent": name, "connection": spec["mcp"]["connection"], "connectionWritten": connection_written,
              "skills": {s["name"]: s["version"] for s in skills}, "reach": reach_status, "problems": problems}
    if unchanged:
        return {**result, "version": state["pinned"], "created": False}
    definition = build_definition(spec, instructions, server_url, skills, reach)
    metadata = {FINGERPRINT_KEY: wanted}
    # Versions-first: this creates the agent when it does not exist yet, so there is no separate POST /agents.
    version = as_version(azure.rest("POST", f"/agents/{name}/versions", {"metadata": metadata, "definition": definition}).get("version"))
    require(isinstance(version, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", version) is not None, "agent_version_unknown")
    verify(wait_active(azure, name, version), spec, instructions, reach)
    pin(azure, name, version)
    return {**result, "version": version, "created": True}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-endpoint", required=True)
    parser.add_argument("--foundry-account", required=True)
    parser.add_argument("--foundry-project", required=True)
    parser.add_argument("--backend-fqdn", required=True)
    parser.add_argument("--backend-app", required=True)
    parser.add_argument("--resource-group", required=True)
    parser.add_argument("--subscription", required=True)
    parser.add_argument("--azure-mcp-url", default="")
    parser.add_argument("--azure-mcp-client-id", default="")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        result = provision(args)
    except Blocked as error:
        print(f"::error::PI provisioning stopped: {error}", file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired):
        print("::error::PI provisioning stopped: unexpected_failure", file=sys.stderr)
        return 1
    args.output.write_text(json.dumps(result) + "\n", encoding="utf-8")
    print("pi_agent_ready " + json.dumps(result))
    for problem in result["problems"]:
        print(f"::error::PI reach server left out: {problem}", file=sys.stderr)
    return 1 if result["problems"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
