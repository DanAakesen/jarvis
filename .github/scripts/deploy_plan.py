"""Conservative diff preview; Deploy uses release_state.py's verified receipts."""

import argparse
import os
import subprocess

from pipeline_impact import PARTS, deploy_parts


def parts_for(path: str) -> set[str]:
    parts = deploy_parts(path)
    # Bicep outputs are runtime inputs for every application.
    if "infra" in parts:
        return set(PARTS)
    if path == ".github/workflows/deploy.yml":
        return set(PARTS)
    return parts


def plan(event: str, changed: list[str] | None, superseded: bool = False) -> dict:
    """Return component booleans and a bounded preview reason.

    ``changed`` is None when no usable diff base exists (first deploy or
    rewritten history); everything is then deployed.
    """
    if superseded:
        selected, reason = set(), "superseded: a newer commit is already deployed"
    elif event == "workflow_dispatch":
        selected, reason = set(PARTS), "manual diff preview: no verified receipts"
    elif changed is None:
        selected, reason = set(PARTS), "no usable diff base: deploy everything"
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
            handle.writelines(f"| {part} | {'yes' if result[part] else 'no'} |\n" for part in PARTS)
    print(result["reason"])
    print("\n".join(lines))


if __name__ == "__main__":
    main()
