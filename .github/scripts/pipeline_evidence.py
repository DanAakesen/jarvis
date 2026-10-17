"""Content-free CI qualification receipts. Never copy logs or event text."""

import json
import os
from pathlib import Path
import re
import subprocess

from pipeline_impact import CHECKS, git, require_results


def identity() -> dict:
    sha = os.environ["GITHUB_SHA"]
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Invalid source identity")
    return {
        "schema": 1,
        "source": sha,
        "head": os.environ.get("CANDIDATE_SHA", sha),
        "tree": git("rev-parse", "HEAD^{tree}"),
        "run": int(os.environ["GITHUB_RUN_ID"]),
        "attempt": int(os.environ["GITHUB_RUN_ATTEMPT"]),
    }


def ownership(event: dict) -> dict:
    pull = event.get("pull_request") or {}
    body = pull.get("body") or ""
    issues = sorted({int(value) for value in re.findall(
        r"\b(?:fixes|closes|resolves|refs)\s+#([0-9]{1,8})\b", body, re.IGNORECASE,
    )})[:20]
    number = pull.get("number")
    return {"pull_request": number if isinstance(number, int) else None, "issues": issues}


def dispatched_pull(number: str, sha: str) -> dict:
    if not re.fullmatch(r"[1-9][0-9]{0,7}", number):
        raise ValueError("Invalid dispatched PR identity")
    result = subprocess.run(
        ["gh", "api", f"repos/{os.environ['GITHUB_REPOSITORY']}/pulls/{number}"],
        capture_output=True, text=True, check=False, timeout=30,
    )
    if result.returncode or len(result.stdout) > 1024 * 1024:
        raise RuntimeError("Dispatched PR metadata unavailable")
    pull = json.loads(result.stdout)
    if (pull["number"] != int(number) or pull["head"]["sha"] != sha
            or pull["base"]["ref"] != "main" or pull["draft"] or pull["state"] != "open"):
        raise ValueError("Dispatched PR source mismatch")
    return pull


def ci_evidence(results: dict, selected: dict, context: dict, owner: dict) -> dict:
    expected = {"plan", *CHECKS}
    valid = (
        set(selected) == set(CHECKS)
        and all(type(value) is bool for value in selected.values())
        and set(results) == expected
        and results["plan"].get("result") == "success"
        and require_results({key: results[key] for key in CHECKS}, selected)
    )
    statuses = {"success", "failure", "cancelled", "skipped"}
    return {
        **context, **owner, "kind": "qualification", "qualified": valid,
        "selected": {key: value for key, value in selected.items()
                     if key in CHECKS and type(value) is bool},
        "checks": {key: results.get(key, {}).get("result")
                   if results.get(key, {}).get("result") in statuses else "unknown"
                   for key in sorted(expected)},
    }


def main() -> int:
    results = json.loads(os.environ["RESULTS"])
    selected = json.loads(os.environ.get("SELECTION") or "{}")
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    failure = None
    if os.environ.get("PULL_REQUEST") and "pull_request" not in event:
        try:
            event["pull_request"] = dispatched_pull(
                os.environ["PULL_REQUEST"], os.environ["GITHUB_SHA"],
            )
        except (OSError, ValueError, KeyError, RuntimeError, subprocess.TimeoutExpired):
            failure = "dispatched_pr_unavailable_or_mismatched"
    receipt = ci_evidence(results, selected, identity(), ownership(event))
    if failure:
        receipt.update({"qualified": False, "failure_code": failure})
    Path("ci-evidence.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
        summary.write("### Qualification evidence\n\n")
        summary.write(f"Source `{receipt['source']}`, tested tree `{receipt['tree']}`, "
                      f"run `{receipt['run']}` attempt `{receipt['attempt']}`.\n\n")
        summary.write(f"Builder owner: PR #{receipt['pull_request']}; "
                      f"issues {receipt['issues']}. Route failures to that existing builder.\n\n")
        for key, status in receipt["checks"].items():
            summary.write(f"- `{key}`: **{status}**\n")
    return 0 if receipt["qualified"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
