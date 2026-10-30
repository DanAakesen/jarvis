"""Shared, conservative impact selection for qualification and production inputs."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

PARTS = ("infra", "backend", "web", "agent")
CHECKS = ("web", "backend", "vault-mirror", "database", "foundry", "runner", "jarvis-agent",
          "infra", "python", "ios")
NODE_CHECKS = {"web", "backend", "vault-mirror", "database", "foundry"}
CHECK_ONLY_WORKFLOWS = {
    "backend-ci.yml", "ci.yml", "codeql.yml", "copilot-ready.yml", "copilot-setup-steps.yml",
    "database-ci.yml", "foundry-contract.yml", "jarvis-agent-ci.yml", "plan-status.yml",
    "pr-title.yml", "project-board.yml", "runner-ci.yml", "runner-deploy.yml", "web-ci.yml",
    "worker-label.yml", "voice-probe.yml", "danish-voice-agent.yml", "vault-mirror-ci.yml",
    "ios-ci.yml", "ios-testflight.yml",
}
CHECK_ONLY_SCRIPTS = {
    "deploy_plan.py", "deploy_smoke.py", "smoke_reasons.py", "pipeline_impact.py",
    "pipeline_evidence.py", "release_state.py", "project_board.py", "plan_status.py",
    "worker_label.py", "python-ci.sh", "normalize-pr-title.sh", "validate-pr-title.sh",
}


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], capture_output=True, check=False, timeout=60)
    if result.returncode:
        raise RuntimeError("Git input lookup failed")
    return result.stdout.decode("utf-8").strip()


def deploy_parts(path: str) -> set[str]:
    if path.startswith("apps/ios/"):
        return set()
    # These Markdown/JSON files really enter the backend image.
    if path in {"docs/features.md", "agents/jarvis/presence-instructions.json"}:
        return {"backend"} | ({"agent"} if path.startswith("agents/") else set())
    if path.endswith(".md") or path.startswith("docs/"):
        return set()
    if path.startswith("infra/"):
        return {"infra"}
    # The mirror image is built during infrastructure deployment.
    if path.startswith("apps/vault-mirror/"):
        return {"infra"}
    if path == "apps/backend/package.json":
        return {"backend", "infra"}
    if path == "apps/web/package.json":
        return {"web", "backend", "infra"}
    if path == ".dockerignore":
        return {"backend", "infra"}
    if path.startswith("apps/backend/") or path.startswith("db/"):
        return {"backend"}
    if path.startswith("packages/contracts/"):
        return {"backend", "web", "infra"}
    if path in {"package.json", "package-lock.json", "tsconfig.base.json"}:
        return {"backend", "web", "infra"}
    if path == ".nvmrc":
        return {"backend", "web"}
    if path.startswith("apps/web/"):
        return {"web"}
    if path.startswith("agents/jarvis/"):
        return {"agent"}
    if path in {".github/scripts/backend_log_preflight.py", ".github/scripts/backend_log_probe_parameters.py",
                ".github/scripts/backend_log_sources.py"}:
        return {"infra"}
    if path == ".github/scripts/deploy_bicep.sh":
        return {"infra", "backend"}
    if (path == ".github/workflows/deploy.yml"
            or path.removeprefix(".github/workflows/") in CHECK_ONLY_WORKFLOWS
            or path.removeprefix(".github/scripts/") in CHECK_ONLY_SCRIPTS
            or path.startswith(".github/scripts/tests/")
            or path in {".github/dependabot.yml", ".github/copilot-instructions.md"}):
        return set()
    if path.startswith(("runner/", "scripts/", "pc-bridge/", "templates/")):
        return set()
    if path in {".gitignore", ".gitattributes", ".editorconfig", ".python-version"}:
        return set()
    return set(PARTS)


def checks_for(path: str) -> set[str]:
    if path.startswith("apps/ios/"):
        return {"ios"}
    if path == "docs/features.md":
        return {"backend"}
    if path.startswith("docs/reference/"):
        return {"jarvis-agent", "python"}
    if path.endswith(".md") or path.startswith("docs/"):
        return set()
    if path.startswith("apps/web/"):
        return {"web", "backend"} if path.endswith("/package.json") else {"web"}
    if path.startswith("apps/vault-mirror/"):
        return {"vault-mirror"}
    if path.startswith(("apps/backend/", "db/")):
        return {"backend", "database", "foundry", "web", "jarvis-agent", "runner", "python"}
    if path.startswith("packages/contracts/") or path in {
        "package.json", "package-lock.json", "tsconfig.base.json", ".nvmrc", ".dockerignore",
    }:
        return NODE_CHECKS | {"jarvis-agent"}
    if path.startswith("agents/jarvis/"):
        return {"jarvis-agent", "python", "backend", "foundry"}
    if path.startswith("runner/"):
        return {"runner", "python", "backend", "database"}
    if path.startswith("pc-bridge/"):
        return {"backend"}
    # Workflow/planner/shared/unknown changes qualify all consumers. They do
    # not become application build inputs merely by living under .github.
    return set(CHECKS)


def selection(changed: list[str] | None) -> dict[str, bool]:
    selected = set(CHECKS) if changed is None else {"python"}
    for path in changed or []:
        selected |= checks_for(path)
    return {check: check in selected for check in CHECKS}


def require_results(results: dict, selected: dict[str, bool]) -> bool:
    return set(results) == set(selected) and all(
        results[key].get("result") == ("success" if needed else "skipped")
        for key, needed in selected.items()
    )


def workflow_recipe(source: str, part: str) -> str:
    """Hash shared configuration and this component's job, not smoke/other jobs."""
    prefix, separator, jobs = source.partition("\njobs:\n")
    if not separator:
        raise ValueError("Deployment workflow has no jobs")
    sections = {}
    current = None
    for line in jobs.splitlines():
        if line.startswith("  ") and not line.startswith("   ") and line.endswith(":"):
            current = line.strip()[:-1]
            sections[current] = []
        if current is not None:
            sections[current].append(line)
    if part not in sections:
        raise ValueError("Deployment workflow is missing a component")
    return prefix + "\n" + "\n".join(sections[part])


def fingerprints(head: str, configuration: str) -> dict[str, str]:
    records = git("ls-tree", "-r", head).splitlines()
    recipe = git("show", f"{head}:.github/workflows/deploy.yml")
    direct = {}
    for part in PARTS:
        inputs = [record for record in records if part in deploy_parts(record.split("\t", 1)[1])]
        direct[part] = hashlib.sha256(
            ("\n".join(inputs) + workflow_recipe(recipe, part) + configuration).encode()
        ).hexdigest()
    # Infrastructure can change URLs, identities and application configuration.
    return {part: hashlib.sha256((direct[part] + direct["infra"]).encode()).hexdigest()
            for part in PARTS}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="")
    args = parser.parse_args()
    changed = None
    if args.base:
        # Missing or rewritten bases retain full coverage.
        result = subprocess.run(["git", "merge-base", "--is-ancestor", args.base, "HEAD"],
                                capture_output=True, check=False, timeout=60)
        if result.returncode == 0:
            changed = git("diff", "--name-only", "--no-renames", args.base, "HEAD").splitlines()
    selected = selection(changed)
    Path("ci-selection.json").write_text(json.dumps(selected), encoding="utf-8")
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        for key, value in selected.items():
            output.write(f"{key}={str(value).lower()}\n")
        output.write("selection=" + json.dumps(selected) + "\n")
    print("Required checks: " + ", ".join(key for key, value in selected.items() if value))


if __name__ == "__main__":
    main()
