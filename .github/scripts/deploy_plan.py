"""Decide which production parts the Deploy workflow updates (P0-11).

The diff base is the head commit of the last successful Deploy run, not the
push's "before" commit, so a failed or cancelled deploy is retried by the next
run. A run whose commit is already contained in the last successful deploy is
superseded and deploys nothing, so an older run can never overwrite newer code.
"""

import argparse
import fnmatch
import os
import subprocess

PARTS = ("infra", "backend", "web")

# Inputs shared by every part: a change deploys everything.
SHARED = (
    "package.json",
    "package-lock.json",
    "tsconfig.base.json",
    ".nvmrc",
    ".github/workflows/*",
    ".github/scripts/deploy_*",
)

PART_PATHS = (
    ("infra/*", {"infra"}),
    ("apps/backend/*", {"backend"}),
    ("db/*", {"backend"}),
    (".dockerignore", {"backend"}),
    ("apps/web/*", {"web"}),
)


def _matches(path: str, pattern: str) -> bool:
    return fnmatch.fnmatchcase(path, pattern)


def is_documentation(path: str) -> bool:
    return path.endswith(".md") or path.startswith("docs/")


def parts_for(path: str) -> set[str]:
    if is_documentation(path):
        return set()
    if any(_matches(path, pattern) for pattern in SHARED):
        return set(PARTS)
    parts: set[str] = set()
    for pattern, targets in PART_PATHS:
        if _matches(path, pattern):
            parts |= targets
    # The web build reads the public bootstrap IDs.
    if path == "infra/bootstrap.output.json":
        parts.add("web")
    return parts


def plan(event: str, changed: list[str] | None, superseded: bool = False) -> dict:
    """Return {"infra", "backend", "web": bool, "reason": str}.

    ``changed`` is None when no usable diff base exists (first deploy or
    rewritten history); everything is then deployed.
    """
    if event == "workflow_dispatch":
        selected, reason = set(PARTS), "manual run: redeploy everything"
    elif superseded:
        selected, reason = set(), "superseded: a newer commit is already deployed"
    elif changed is None:
        selected, reason = set(PARTS), "no earlier successful deploy to compare with: deploy everything"
    else:
        selected = set()
        for path in changed:
            selected |= parts_for(path)
        if not changed:
            reason = "no changes since the last successful deploy"
        elif not selected:
            reason = "no deployable changes (documentation or other components only)"
        else:
            reason = "changed: " + ", ".join(part for part in PARTS if part in selected)
    return {**{part: part in selected for part in PARTS}, "reason": reason}


def _git(*arguments: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *arguments], capture_output=True, text=True, check=False)


def changed_files(base: str, head: str) -> tuple[list[str] | None, bool]:
    """Return (changed paths or None if base is unusable, superseded)."""
    if not base or _git("cat-file", "-e", f"{base}^{{commit}}").returncode != 0:
        return None, False
    if base != head and _git("merge-base", "--is-ancestor", head, base).returncode == 0:
        return [], True
    if _git("merge-base", "--is-ancestor", base, head).returncode != 0:
        return None, False
    diff = _git("diff", "--name-only", "--no-renames", base, head)
    if diff.returncode != 0:
        raise RuntimeError("git diff failed")
    return [line for line in diff.stdout.splitlines() if line], False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--event", required=True)
    parser.add_argument("--base", default="", help="head SHA of the last successful deploy")
    parser.add_argument("--head", required=True)
    args = parser.parse_args()
    changed, superseded = changed_files(args.base, args.head)
    result = plan(args.event, changed, superseded)
    lines = [f"{part}={'true' if result[part] else 'false'}" for part in PARTS]
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write("\n".join(lines) + "\n")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("### Deploy plan\n\n")
            handle.write(f"Base `{args.base or 'none'}`, head `{args.head}`: {result['reason']}.\n\n")
            handle.write("| Part | Deploy |\n| --- | --- |\n")
            for part in PARTS:
                handle.write(f"| {part} | {'yes' if result[part] else 'no'} |\n")
    print(result["reason"])
    print("\n".join(lines))


if __name__ == "__main__":
    main()
