"""Provision PI and its GPT-Live voice front end from the files in agents/pi.

Runs in the Deploy workflow with the deployment identity. It creates the Jarvis skills, a Foundry project connection
that holds the MCP secret (Foundry refuses credentials in an MCP tool's own headers), then one prompt agent version
that carries the instructions, the Jarvis MCP server (by connection) and the skill references, pins the endpoint to
that version, and gives the backend the agent name and the MCP secret. It is idempotent: when nothing changed it creates nothing.
It invokes no model and prints no definition, because the definition carries the MCP credential.

Reach: the full GitHub MCP server and the Azure MCP server (Contributor on the Jarvis resource group, scale to zero) are
attached when their inputs exist. Neither is a harness tool: listing every tool of every server in each turn cost seconds and
tokens (GitHub's alone about 13k tokens), and a server that is slow to start or to authenticate failed the whole turn. The
backend holds what it needs (the owner's fine-grained GitHub token as a Container App secret, the Azure server's URL and Entra
client ID as settings; it calls Azure with its own managed identity) and offers their tools through the Jarvis MCP door
(find_tools and call_tool), where they are searched like every other tool. A server whose input is missing is reported as not
attached.
"""
from __future__ import annotations

import argparse
import copy
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
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]
PI = ROOT / "agents" / "pi"
# The harness needs MicrosoftCopilot; skills need Skills. A skill reference in an agent definition needs both.
AGENT_FEATURES = "MicrosoftCopilot=V1Preview,Skills=V1Preview"
SKILL_FEATURES = "Skills=V1Preview"
VOICE_FEATURES = "VoiceAgents=V1Preview"
# Values that must never reach a log, even when Foundry echoes part of the request back in its error message.
REDACT: list[str] = []
SECRET_NAME = "pi-mcp-secret"
GITHUB_SECRET_NAME = "pi-github-token"
# Settings the backend only has while the owner has provided the input behind them.
MANAGED_OPTIONAL_ENV = ("JARVIS_PI_GITHUB_TOKEN", "JARVIS_PI_GITHUB_FP", "JARVIS_PI_AZURE_MCP_URL", "JARVIS_PI_AZURE_MCP_CLIENT_ID")
ARM = "https://management.azure.com"
CONNECTIONS_API = "2025-04-01-preview"
FINGERPRINT_KEY = "jarvis_pi_fingerprint"
GITHUB_TOKEN_PATTERN = re.compile(r"github_pat_[A-Za-z0-9_]{50,255}")
UUID_PATTERN = re.compile(r"[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")
VOICE_FINGERPRINT_KEY = "jarvis_pi_voice_fingerprint"
DEPLOYMENTS_API = "2024-10-01"
REPLACED_VOICE_DEPLOYMENTS = ("gpt-realtime-2.1", "gpt-realtime-2.1-mini")
PI_CONTEXT_INPUT = "pi_context"
PI_STRUCTURED_INPUTS = {
    PI_CONTEXT_INPUT: {
        "description": "Complete trusted Jarvis persona, owner preferences and current mode for this response.",
        "required": True,
        "schema": {"type": "string"},
    },
}


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
    require(spec["builtinTools"] in {"enabled", "disabled"}, "builtin_tools_invalid")
    require(spec["github"]["url"].startswith("https://") and re.fullmatch(r"[A-Z][A-Z0-9_]{0,63}", spec["github"]["tokenEnv"]) is not None, "github_spec_invalid")
    require(re.fullmatch(r"[a-z][a-z0-9_]{0,31}", spec["mcp"]["serverLabel"]) is not None, "mcp_label_invalid")
    return spec


def load_voice_spec() -> tuple[dict, str, dict]:
    spec = json.loads((PI / "voice-definition.json").read_text(encoding="utf-8"))
    require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", spec["agentName"]) is not None, "voice_agent_name_invalid")
    require(spec["model"] == "gpt-live-1", "voice_model_invalid")
    require(spec["modelVersion"] == "2026-09-10", "voice_model_version_invalid")
    require(spec["sku"] == "GlobalStandard" and spec["capacity"] == 10, "voice_deployment_sku_invalid")
    require(spec["delegation"] == {"type": "client"}, "voice_delegation_invalid")
    require(spec["store"] is False, "voice_store_invalid")
    audio = spec["audio"]
    require(audio == {
        "format": {"type": "audio/pcm", "rate": 24000},
        "output": {"voice": "marin"},
    }, "voice_audio_invalid")
    instructions_file = spec["instructionsFile"]
    require(re.fullmatch(r"[A-Za-z0-9._-]+\.md", instructions_file) is not None, "voice_instructions_file_invalid")
    instructions = (PI / instructions_file).read_text(encoding="utf-8").strip() + "\n"
    definition = {
        "kind": "voice",
        "sub_protocol": "live",
        "model_type": "self_deployed",
        "model": spec["model"],
        "instructions": instructions,
        "audio": audio,
        "delegation": spec["delegation"],
        "store": spec["store"],
    }
    return spec, instructions, definition


def instructions_text() -> str:
    """The static persona: agents/pi/instructions.md with the shared identity contract filled in."""
    contract = json.loads((ROOT / "agents" / "jarvis" / "identity-contract.json").read_text(encoding="utf-8"))
    text = (PI / "instructions.md").read_text(encoding="utf-8")
    text = text.replace("{{identity_kernel}}", contract["fixedKernel"]["en"])
    text = text.replace("{{product_identity}}", contract["productIdentity"]["en"])
    require(re.findall(r"\{\{([^{}]+)\}\}", text) == [PI_CONTEXT_INPUT],
            "instructions_placeholder_unresolved")
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


EXPERIMENTS = ("none", "builtins_off", "skills_off")


def apply_experiment(spec: dict, skills: list[dict], experiment: str) -> tuple[dict, list[dict]]:
    """A measurement variant of the agent: one thing switched off, to see what it costs per turn. Never the default.

    The next Deploy without an experiment defines the full agent again (the fingerprint differs, so a new version is made).
    """
    require(experiment in EXPERIMENTS, "experiment_unknown")
    if experiment == "builtins_off":
        return {**spec, "builtinTools": "disabled"}, skills
    if experiment == "skills_off":
        return spec, []
    return spec, skills


def build_definition(spec: dict, instructions: str, server_url: str, skills: list[dict]) -> dict:
    return {
        "kind": "prompt", "harness": {"type": "microsoft_copilot_preview"},
        "model": spec["model"], "reasoning": {"effort": spec["reasoningEffort"]},
        "instructions": instructions,
        "structured_inputs": copy.deepcopy(PI_STRUCTURED_INPUTS),
        "tools": [
            # The harness built-ins (shell, filesystem read and write, web, sub-agents) follow the spec; "enabled" turns them all on.
            {"type": "microsoft_copilot_toolset_preview", "default_config": {"enabled": spec["builtinTools"] == "enabled"}},
            {"type": "mcp", "server_label": spec["mcp"]["serverLabel"], "server_url": server_url,
             "require_approval": spec["mcp"]["requireApproval"],
             # The secret lives in this project connection and is injected as a header; the tool carries no headers.
             "project_connection_id": spec["mcp"]["connection"]},
            # GitHub and Azure are not harness tools: the backend offers their tools through this one door (find_tools, call_tool).
        ],
        "skills": [{"type": "skill_reference", "name": skill["name"], "version": skill["version"]} for skill in skills],
    }


def fingerprint(spec: dict, instructions: str, server_url: str, skills: list[dict]) -> str:
    """Everything that makes a new agent version necessary, hashed; skill versions are not part of it, their content is."""
    return sha256(canonical({
        "spec": spec, "instructions": instructions, "server_url": server_url,
        "structured_inputs": PI_STRUCTURED_INPUTS,
        "skills": [[skill["name"], skill["sha256"]] for skill in skills],
    }))


class Az:
    def __init__(self, endpoint: str):
        self.endpoint = endpoint.rstrip("/")
        self.deadline = time.monotonic() + 600

    def rest(
        self,
        method: str,
        path: str,
        body: dict | None = None,
        *,
        content_type: str = "application/json",
        features: str | None = None,
    ) -> dict:
        require(time.monotonic() < self.deadline, "provision_budget_exhausted")
        url = self.endpoint + path + ("&" if "?" in path else "?") + "api-version=v1"
        features = features or (SKILL_FEATURES if path.startswith("/skills") else AGENT_FEATURES)
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


def configure_backend(app: str, group: str, subscription: str, agent_name: str, github_token: str | None = None,
                      azure: tuple[str, str] | None = None) -> str:
    """Return the MCP secret, creating it once. The backend gets it as a Container App secret, never as plain text.

    The owner's GitHub token goes the same way, as a second secret, and is removed again when the owner withdraws it.

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
    # A fingerprint of the token (not the token) tells whether the backend already has this one.
    github_fp = sha256(github_token)[:16] if github_token else ""
    github_changed = current.get("JARVIS_PI_GITHUB_FP", "") != github_fp
    if github_changed and github_token:
        shell("az", "containerapp", "secret", "set", "--name", app, "--resource-group", group, "--subscription", subscription,
              "--secrets", f"{GITHUB_SECRET_NAME}={github_token}", "--only-show-errors", "--output", "none")
    # The settings this script owns; anything of these the owner has withdrawn is removed again.
    set_vars = {"JARVIS_PI_AGENT_NAME": agent_name, "JARVIS_PI_MCP_SECRET": f"secretref:{SECRET_NAME}"}
    if github_token:
        set_vars.update({"JARVIS_PI_GITHUB_TOKEN": f"secretref:{GITHUB_SECRET_NAME}", "JARVIS_PI_GITHUB_FP": github_fp})
    if azure:
        set_vars.update({"JARVIS_PI_AZURE_MCP_URL": azure[0], "JARVIS_PI_AZURE_MCP_CLIENT_ID": azure[1]})
    withdrawn = [key for key in MANAGED_OPTIONAL_ENV if key in current and key not in set_vars]
    current_plain = {key: (f"secretref:{value}" if key in ("JARVIS_PI_MCP_SECRET", "JARVIS_PI_GITHUB_TOKEN") and value else value) for key, value in current.items()}
    if created or github_changed or withdrawn or any(current_plain.get(key) != value for key, value in set_vars.items()):
        command = ["az", "containerapp", "update", "--name", app, "--resource-group", group, "--subscription", subscription,
                   "--set-env-vars", *[f"{key}={value}" for key, value in set_vars.items()]]
        if withdrawn:
            command += ["--remove-env-vars", *withdrawn]
        shell(*command, "--only-show-errors", "--output", "none")
        wait_ready(app, group, subscription)
        if not github_token and github_changed:
            listing = json.loads(shell("az", "containerapp", "secret", "list", "--name", app, "--resource-group", group, "--subscription",
                                       subscription, "--only-show-errors", "--output", "json"))
            if any(item.get("name") == GITHUB_SECRET_NAME for item in listing):
                shell("az", "containerapp", "secret", "remove", "--name", app, "--resource-group", group, "--subscription", subscription,
                      "--secret-names", GITHUB_SECRET_NAME, "--only-show-errors", "--output", "none")
    return secret


def wait_ready(app: str, group: str, subscription: str) -> str:
    for _ in range(40):
        state = json.loads(shell("az", "containerapp", "show", "--name", app, "--resource-group", group, "--subscription",
                                 subscription, "--query", "{latest:properties.latestRevisionName,ready:properties.latestReadyRevisionName}",
                                 "--only-show-errors", "--output", "json"))
        if state["latest"] and state["latest"] == state["ready"]:
            return state["latest"]
        time.sleep(15)
    raise Blocked("backend_not_ready")


def configure_voice_backend(app: str, group: str, subscription: str, voice_agent_name: str) -> str:
    env = json.loads(shell("az", "containerapp", "show", "--name", app, "--resource-group", group, "--subscription", subscription,
                           "--query", "properties.template.containers[0].env", "--only-show-errors", "--output", "json"))
    current = {item["name"]: item.get("value") for item in env}
    if current.get("JARVIS_VOICE_AGENT_NAME") != voice_agent_name:
        shell(
            "az", "containerapp", "update", "--name", app, "--resource-group", group, "--subscription", subscription,
            "--set-env-vars", f"JARVIS_VOICE_AGENT_NAME={voice_agent_name}", "--only-show-errors", "--output", "none",
        )
    return wait_ready(app, group, subscription)


def arm_deployment_request(method: str, account: str, name: str, group: str, subscription: str) -> dict | None:
    path = (
        f"/subscriptions/{subscription}/resourceGroups/{group}/providers/"
        f"Microsoft.CognitiveServices/accounts/{account}/deployments/{quote(name, safe='')}"
    )
    url = f"{ARM}{path}?api-version={DEPLOYMENTS_API}"
    result = subprocess.run(
        [
            "az", "rest", "--method", method, "--url", url, "--resource", ARM,
            "--only-show-errors", "--output", "json",
        ],
        capture_output=True,
        check=False,
        timeout=60,
    )
    if result.returncode != 0:
        if classify(result.stderr) == "not_found":
            return None
        raise Blocked(
            f"arm_{method.lower()}_failed:{name}:{classify(result.stderr)}" + describe_error(result.stderr),
        )
    return json.loads(result.stdout) if result.stdout.strip() else {}


def delete_replaced_voice_deployments(account: str, group: str, subscription: str) -> list[str]:
    removed: list[str] = []
    for name in REPLACED_VOICE_DEPLOYMENTS:
        if arm_deployment_request("GET", account, name, group, subscription) is None:
            continue
        arm_deployment_request("DELETE", account, name, group, subscription)
        for _ in range(60):
            if arm_deployment_request("GET", account, name, group, subscription) is None:
                removed.append(name)
                break
            time.sleep(5)
        else:
            raise Blocked(f"arm_delete_incomplete:{name}")
    return removed


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


def current_state(azure: Az, name: str, features: str | None = None) -> dict | None:
    options = {} if features is None else {"features": features}
    try:
        agent = azure.rest("GET", f"/agents/{name}", **options)
    except Blocked as error:
        if ":not_found" in str(error):
            return None
        raise
    rules = ((agent.get("agent_endpoint") or {}).get("version_selector") or {}).get("version_selection_rules") or []
    pinned = rules[0].get("agent_version") if rules and isinstance(rules[0], dict) else None
    if not pinned:
        return {"pinned": None, "metadata": {}, "skills": {}}
    version = azure.rest("GET", f"/agents/{name}/versions/{pinned}", **options)
    skills = {item["name"]: item["version"] for item in (version.get("definition") or {}).get("skills") or []
              if isinstance(item, dict) and "name" in item and "version" in item}
    return {"pinned": pinned, "metadata": version.get("metadata") or {}, "skills": skills, "status": version.get("status")}


def pin(azure: Az, name: str, version: str, features: str | None = None) -> None:
    selector = {"version_selection_rules": [{"type": "FixedRatio", "agent_version": version, "traffic_percentage": 100}]}
    options = {} if features is None else {"features": features}
    azure.rest(
        "PATCH", f"/agents/{name}", {"agent_endpoint": {"version_selector": selector}},
        content_type="application/merge-patch+json", **options,
    )


def wait_active(azure: Az, name: str, version: str, features: str | None = None) -> dict:
    options = {} if features is None else {"features": features}
    for _ in range(60):
        readback = azure.rest("GET", f"/agents/{name}/versions/{version}", **options)
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


def resolve_azure(args: argparse.Namespace) -> tuple[tuple[str, str] | None, str]:
    """The Azure MCP server's URL and Entra client ID, or None, with a plain-words status."""
    url = (getattr(args, "azure_mcp_url", "") or "").strip()
    client = (getattr(args, "azure_mcp_client_id", "") or "").strip()
    if not url or not client:
        return None, "not attached: the Azure MCP container is not deployed (needs the JARVIS_AZURE_MCP_CLIENT_ID variable and a deploy)"
    require(url.startswith("https://") and UUID_PATTERN.fullmatch(client) is not None, "azure_mcp_input_invalid")
    return (url.rstrip("/"), client), "attached"


def resolve_github(spec: dict) -> tuple[str | None, str]:
    """The owner's GitHub token, or None, with a plain-words status."""
    env = spec["github"]["tokenEnv"]
    token = os.environ.get(env, "").strip()
    if not token:
        return None, f"not attached: the owner has not provided the {env} secret"
    # Only a fine-grained token can be limited to chosen repositories and permissions; a classic token reaches everything.
    require(GITHUB_TOKEN_PATTERN.fullmatch(token) is not None, "github_token_not_fine_grained")
    REDACT.append(token)
    return token, "attached"


def remove_connection(project_id: str, name: str) -> None:
    """Delete a project connection that no longer has a purpose (its key was readable by project members). Absent is fine."""
    try:
        arm_request("DELETE", f"{project_id}/connections/{name}")
    except Blocked as error:
        if ":not_found" not in str(error):
            raise


def verify(readback: dict, spec: dict, expected: str) -> None:
    definition = readback.get("definition") or {}
    require(definition.get("harness") == {"type": "microsoft_copilot_preview"}, "readback_harness_mismatch")
    require(definition.get("model") == spec["model"], "readback_model_mismatch")
    require((definition.get("reasoning") or {}).get("effort") == spec["reasoningEffort"], "readback_reasoning_mismatch")
    require(definition.get("instructions") == expected, "readback_instructions_mismatch")
    require(definition.get("structured_inputs") == PI_STRUCTURED_INPUTS,
            "readback_structured_inputs_mismatch")
    tools = definition.get("tools") or []
    toolset = [tool for tool in tools if tool.get("type") == "microsoft_copilot_toolset_preview"]
    require(len(toolset) == 1 and (toolset[0].get("default_config") or {}).get("enabled") is (spec["builtinTools"] == "enabled"), "readback_builtins_mismatch")
    mcp = {tool.get("server_label"): tool for tool in tools if tool.get("type") == "mcp"}
    wanted = {spec["mcp"]["serverLabel"]: spec["mcp"]["connection"]}
    require(len([tool for tool in tools if tool.get("type") == "mcp"]) == len(wanted) and set(mcp) == set(wanted), "readback_mcp_mismatch")
    for label, connection in wanted.items():
        require(mcp[label].get("require_approval") == "never", "readback_mcp_mismatch")
        require(mcp[label].get("project_connection_id") == connection and not mcp[label].get("headers"), "readback_mcp_connection_mismatch")


def verify_voice_agent(readback: dict, definition: dict) -> None:
    actual = readback.get("definition") or {}
    for key in ("kind", "sub_protocol", "model_type", "model", "instructions", "audio", "delegation", "store"):
        require(actual.get(key) == definition[key], f"voice_readback_{key}_mismatch")


def verify_voice_deployment(deployment: dict | None, spec: dict) -> None:
    require(deployment is not None and deployment.get("name") == spec["model"], "voice_deployment_missing")
    properties = deployment.get("properties") or {}
    model = properties.get("model") or {}
    sku = deployment.get("sku") or {}
    require(properties.get("provisioningState") == "Succeeded", "voice_deployment_not_active")
    require(
        model.get("format") == "OpenAI"
        and model.get("name") == spec["model"]
        and model.get("version") == spec["modelVersion"],
        "voice_deployment_model_mismatch",
    )
    require(
        sku.get("name") == spec["sku"] and sku.get("capacity") == spec["capacity"],
        "voice_deployment_sku_mismatch",
    )


def provision_voice_agent(
    azure: Az,
    spec: dict,
    definition: dict,
    account: str,
    group: str,
    subscription: str,
) -> dict:
    name = spec["agentName"]
    verify_voice_deployment(
        arm_deployment_request("GET", account, spec["model"], group, subscription),
        spec,
    )
    wanted = sha256(canonical(definition))
    state = current_state(azure, name, VOICE_FEATURES)
    unchanged = bool(
        state and state["pinned"] and state["metadata"].get(VOICE_FINGERPRINT_KEY) == wanted
        and state.get("status") == "active"
    )
    if unchanged:
        verify_voice_agent(
            azure.rest("GET", f"/agents/{name}/versions/{state['pinned']}", features=VOICE_FEATURES),
            definition,
        )
        return {"agent": name, "version": state["pinned"], "created": False, "model": spec["model"]}
    version = as_version(azure.rest(
        "POST",
        f"/agents/{name}/versions",
        {"metadata": {VOICE_FINGERPRINT_KEY: wanted}, "definition": definition},
        features=VOICE_FEATURES,
    ).get("version"))
    require(
        isinstance(version, str)
        and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", version) is not None,
        "voice_agent_version_unknown",
    )
    verify_voice_agent(wait_active(azure, name, version, VOICE_FEATURES), definition)
    pin(azure, name, version, VOICE_FEATURES)
    pinned = current_state(azure, name, VOICE_FEATURES)
    require(
        bool(pinned and pinned["pinned"] == version and pinned.get("status") == "active"),
        "voice_agent_not_pinned",
    )
    return {"agent": name, "version": version, "created": True, "model": spec["model"]}


def provision(args: argparse.Namespace) -> dict:
    spec = load_spec()
    voice_spec, _voice_instructions, voice_definition = load_voice_spec()
    name = spec["agentName"]
    instructions = instructions_text()
    skills = [parse_skill(skill) for skill in spec["skills"]]
    experiment = getattr(args, "experiment", "none") or "none"
    spec, skills = apply_experiment(spec, skills, experiment)
    azure_mcp, azure_status = resolve_azure(args)
    github_token, github_status = resolve_github(spec)
    foundry = Az(args.project_endpoint)
    state = current_state(foundry, name)
    secret = configure_backend(args.backend_app, args.resource_group, args.subscription, name, github_token, azure_mcp)
    REDACT.append(secret)
    server_url = f"https://{args.backend_fqdn}{spec['mcp']['path']}"
    project_id = (f"/subscriptions/{args.subscription}/resourceGroups/{args.resource_group}/providers/"
                  f"Microsoft.CognitiveServices/accounts/{args.foundry_account}/projects/{args.foundry_project}")
    connection_written = ensure_connection(project_id, spec, server_url, secret)
    # GitHub and Azure used to be harness tools with their own connections (one held the token, the other needed the project's
    # identity); the backend reaches both now, so those connections have no purpose left.
    for legacy in (spec["github"]["legacyConnection"], spec["azure"]["legacyConnection"]):
        remove_connection(project_id, legacy)
    wanted = fingerprint(spec, instructions, server_url, skills)
    unchanged = bool(state and state["pinned"] and state["metadata"].get(FINGERPRINT_KEY) == wanted and state.get("status") == "active")
    ensure_skills(foundry, skills, unchanged, state["skills"] if state else {})
    result = {"agent": name, "connection": spec["mcp"]["connection"], "connectionWritten": connection_written,
              "skills": {s["name"]: s["version"] for s in skills}, "reach": {"github": github_status, "azure": azure_status},
              "experiment": experiment}
    if unchanged:
        version = state["pinned"]
        created = False
    else:
        definition = build_definition(spec, instructions, server_url, skills)
        metadata = {FINGERPRINT_KEY: wanted}
        # Versions-first: this creates the agent when it does not exist yet, so there is no separate POST /agents.
        version = as_version(foundry.rest("POST", f"/agents/{name}/versions", {
            "metadata": metadata, "definition": definition,
        }).get("version"))
        require(
            isinstance(version, str)
            and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", version) is not None,
            "agent_version_unknown",
        )
        verify(wait_active(foundry, name, version), spec, instructions)
        pin(foundry, name, version)
        created = True
    voice = provision_voice_agent(
        foundry,
        voice_spec,
        voice_definition,
        args.foundry_account,
        args.resource_group,
        args.subscription,
    )
    backend_revision = configure_voice_backend(
        args.backend_app,
        args.resource_group,
        args.subscription,
        voice_spec["agentName"],
    )
    removed = delete_replaced_voice_deployments(
        args.foundry_account,
        args.resource_group,
        args.subscription,
    )
    return {
        **result,
        "version": version,
        "created": created,
        "voiceAgent": voice,
        "replacedVoiceDeploymentsDeleted": removed,
        "backendRevision": backend_revision,
    }


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
    parser.add_argument("--experiment", default="none", choices=EXPERIMENTS)
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
