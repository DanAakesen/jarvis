"""Provision the PI agent (managed Microsoft Copilot harness) from the files in agents/pi.

Runs in the Deploy workflow with the deployment identity. It creates the Jarvis skills, then one prompt agent version
that carries the instructions, the Jarvis MCP server and the skill references, pins the endpoint to that version, and
gives the backend the agent name and the MCP secret. It is idempotent: when nothing changed it creates nothing.
It invokes no model and prints no definition, because the definition carries the MCP credential.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import secrets
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PI = ROOT / "agents" / "pi"
FEATURES = ",".join((
    "WorkflowAgents=V1Preview", "ExternalAgents=V1Preview", "DraftAgents=V1Preview", "VoiceAgents=V1Preview",
    "DigitalWorker=V1Preview", "GitHubCopilot=V1Preview", "Skills=V1Preview", "MicrosoftCopilot=V1Preview",
    "ModelRouterControls=V1Preview",
))
SECRET_NAME = "pi-mcp-secret"
FINGERPRINT_KEY = "jarvis_pi_fingerprint"


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


def build_definition(spec: dict, instructions: str, server_url: str, secret: str, skills: list[dict]) -> dict:
    return {
        "kind": "prompt", "harness": {"type": "microsoft_copilot_preview"},
        "model": spec["model"], "reasoning": {"effort": spec["reasoningEffort"]},
        "instructions": instructions,
        "tools": [
            # Built-in shell, files and web stay off: everything goes through Jarvis tools and its guards.
            {"type": "microsoft_copilot_toolset_preview", "default_config": {"enabled": False}},
            {"type": "mcp", "server_label": spec["mcp"]["serverLabel"], "server_url": server_url,
             "require_approval": spec["mcp"]["requireApproval"], "headers": {"Authorization": f"Bearer jp.{secret}"}},
        ],
        "skills": [{"type": "skill_reference", "name": skill["name"], "version": skill["version"]} for skill in skills],
    }


def fingerprint(spec: dict, instructions: str, server_url: str, secret: str, skills: list[dict]) -> str:
    """Everything that makes a new agent version necessary, hashed; skill versions are not part of it, their content is."""
    return sha256(canonical({
        "spec": spec, "instructions": instructions, "server_url": server_url, "secret": sha256(secret),
        "skills": [[skill["name"], skill["sha256"]] for skill in skills],
    }))


class Az:
    def __init__(self, endpoint: str):
        self.endpoint = endpoint.rstrip("/")
        self.deadline = time.monotonic() + 600

    def rest(self, method: str, path: str, body: dict | None = None, *, content_type: str = "application/json") -> dict:
        require(time.monotonic() < self.deadline, "provision_budget_exhausted")
        url = self.endpoint + path + ("&" if "?" in path else "?") + "api-version=v1"
        command = ["az", "rest", "--method", method, "--url", url, "--resource", "https://ai.azure.com",
                   "--only-show-errors", "--output", "json", "--headers", "Foundry-Features=" + FEATURES]
        with tempfile.TemporaryDirectory(prefix="jarvis-pi-") as directory:
            if body is not None:
                file = Path(directory) / "body.json"
                file.write_text(canonical(body), encoding="utf-8")
                file.chmod(0o600)
                command += ["Content-Type=" + content_type, "--body", "@" + str(file)]
            result = subprocess.run(command, capture_output=True, check=False, timeout=60)
        if result.returncode != 0:
            # Never echo stderr: it can quote the request body, which holds the MCP credential.
            raise Blocked(f"foundry_{method.lower()}_failed:{path.split('?')[0]}:{classify(result.stderr)}")
        return json.loads(result.stdout) if result.stdout.strip() else {}


def classify(stderr: bytes) -> str:
    text = stderr[:4096].decode("utf-8", "replace")
    for label in ("Bad Request", "Unauthorized", "Forbidden", "Not Found", "Conflict", "Too Many Requests"):
        if label in text:
            return label.lower().replace(" ", "_")
    return "error"


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
    """Return the MCP secret, creating it once. The backend gets it as a Container App secret, never as plain text."""
    secret = backend_secret(app, group, subscription)
    created = secret is None
    if secret is None:
        secret = secrets.token_urlsafe(48)
    print(f"::add-mask::{secret}")
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
        version = created.get("version")
        require(isinstance(version, str) and re.fullmatch(r"[A-Za-z0-9._-]{1,64}", version) is not None, "skill_version_invalid")
        skill["version"] = version


def current_state(azure: Az, name: str) -> dict | None:
    try:
        agent = azure.rest("GET", f"/agents/{name}")
    except Blocked as error:
        if str(error).endswith(":not_found"):
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


def verify(readback: dict, spec: dict, expected: str) -> None:
    definition = readback.get("definition") or {}
    require(definition.get("harness") == {"type": "microsoft_copilot_preview"}, "readback_harness_mismatch")
    require(definition.get("model") == spec["model"], "readback_model_mismatch")
    require((definition.get("reasoning") or {}).get("effort") == spec["reasoningEffort"], "readback_reasoning_mismatch")
    require(definition.get("instructions") == expected, "readback_instructions_mismatch")
    tools = definition.get("tools") or []
    toolset = [tool for tool in tools if tool.get("type") == "microsoft_copilot_toolset_preview"]
    require(len(toolset) == 1 and (toolset[0].get("default_config") or {}).get("enabled") is False, "readback_builtins_enabled")
    mcp = [tool for tool in tools if tool.get("type") == "mcp"]
    require(len(mcp) == 1 and mcp[0].get("require_approval") == "never", "readback_mcp_mismatch")


def provision(args: argparse.Namespace) -> dict:
    spec = load_spec()
    name = spec["agentName"]
    instructions = instructions_text()
    skills = [parse_skill(skill) for skill in spec["skills"]]
    secret = configure_backend(args.backend_app, args.resource_group, args.subscription, name)
    server_url = f"https://{args.backend_fqdn}{spec['mcp']['path']}"
    azure = Az(args.project_endpoint)
    wanted = fingerprint(spec, instructions, server_url, secret, skills)
    state = current_state(azure, name)
    unchanged = bool(state and state["pinned"] and state["metadata"].get(FINGERPRINT_KEY) == wanted and state.get("status") == "active")
    ensure_skills(azure, skills, unchanged, state["skills"] if state else {})
    if unchanged:
        return {"agent": name, "version": state["pinned"], "created": False, "skills": {s["name"]: s["version"] for s in skills}}
    definition = build_definition(spec, instructions, server_url, secret, skills)
    metadata = {FINGERPRINT_KEY: wanted}
    if state is None:
        created = azure.rest("POST", "/agents", {"name": name, "metadata": metadata, "definition": definition})
        version = (created.get("versions") or {}).get("latest", {}).get("version") or created.get("version")
        if not version:
            version = azure.rest("GET", f"/agents/{name}").get("versions", {}).get("latest", {}).get("version")
    else:
        version = azure.rest("POST", f"/agents/{name}/versions", {"metadata": metadata, "definition": definition}).get("version")
    require(isinstance(version, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", version) is not None, "agent_version_unknown")
    verify(wait_active(azure, name, version), spec, instructions)
    pin(azure, name, version)
    return {"agent": name, "version": version, "created": True, "skills": {s["name"]: s["version"] for s in skills}}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-endpoint", required=True)
    parser.add_argument("--backend-fqdn", required=True)
    parser.add_argument("--backend-app", required=True)
    parser.add_argument("--resource-group", required=True)
    parser.add_argument("--subscription", required=True)
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
