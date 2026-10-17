"""Main-only qualification, compatible applied-state reuse and release evidence."""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request
import zipfile

from pipeline_evidence import identity
from pipeline_impact import PARTS, fingerprints, git

MAX_BYTES = 1024 * 1024
SHA = re.compile(r"[0-9a-f]{40}")
DIGEST = re.compile(r"[0-9a-f]{64}")
UPLOAD = "release-evidence"


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        if not newurl.startswith("https://"):
            raise ValueError("Unsafe artifact redirect")
        redirected = super().redirect_request(request, fp, code, msg, headers, newurl)
        if redirected is not None:
            redirected.remove_header("Authorization")
        return redirected


def api(path: str, binary: bool = False):
    root = os.environ["GITHUB_API_URL"].rstrip("/")
    request = urllib.request.Request(root + "/repos/" + os.environ["GITHUB_REPOSITORY"] + path,
                                    headers={"Authorization": "Bearer " + os.environ["GH_TOKEN"],
                                             "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.build_opener(SafeRedirect).open(request, timeout=30) as response:
            body = response.read(MAX_BYTES + 1)
    except (urllib.error.URLError, TimeoutError) as error:
        raise RuntimeError("GitHub release evidence request failed") from error
    if len(body) > MAX_BYTES:
        raise ValueError("Oversized release evidence")
    return body if binary else json.loads(body)


def artifact(run: dict, prefix: str, filename: str) -> dict | None:
    listing = api(f"/actions/runs/{run['id']}/artifacts?per_page=100")
    matches = [item for item in listing["artifacts"]
               if item["name"] == f"{prefix}-{run['run_attempt']}" and not item["expired"]]
    if not matches:
        return None
    if len(matches) != 1 or matches[0]["size_in_bytes"] > MAX_BYTES:
        raise ValueError("Invalid release artifact identity")
    item = matches[0]
    raw = api(f"/actions/artifacts/{item['id']}/zip", binary=True)
    # Actions v4+ immutable artifacts expose the SHA-256 of their archive.
    if item.get("digest") != "sha256:" + hashlib.sha256(raw).hexdigest():
        raise ValueError("Release artifact digest mismatch")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        files = archive.infolist()
        if len(files) != 1 or files[0].filename != filename or files[0].file_size > MAX_BYTES:
            raise ValueError("Invalid release artifact contents")
        receipt = json.loads(archive.read(files[0]))
    if (receipt.get("schema") != 1 or receipt.get("run") != run["id"]
            or receipt.get("attempt") != run["run_attempt"]
            or not SHA.fullmatch(receipt.get("source", ""))
            or not SHA.fullmatch(receipt.get("tree", ""))):
        raise ValueError("Release receipt provenance mismatch")
    receipt["evidence_artifact"] = {"id": item["id"], "digest": item["digest"]}
    return receipt


def qualify(head: str) -> dict:
    tree = git("rev-parse", f"{head}^{{tree}}")
    pulls = api(f"/commits/{head}/pulls?per_page=10")
    for pull in pulls:
        if not pull["merged_at"] or pull["base"]["ref"] != "main":
            continue
        candidate = pull["head"]["sha"]
        runs = api("/actions/workflows/ci.yml/runs?status=success"
                   f"&head_sha={candidate}&per_page=10")["workflow_runs"]
        for run in runs:
            if (run["head_sha"] != candidate or run["conclusion"] != "success"
                    or run["event"] not in {"pull_request", "workflow_dispatch"}):
                continue
            receipt = artifact(run, "ci-evidence", "ci-evidence.json")
            if (receipt and receipt.get("kind") == "qualification"
                    and receipt.get("qualified") is True and receipt["tree"] == tree
                    and receipt.get("pull_request") == pull["number"]
                    and receipt.get("head") == candidate):
                return {"run": run["id"], "attempt": run["run_attempt"],
                        "artifact": receipt["evidence_artifact"], "pull_request": pull["number"],
                        "issues": receipt.get("issues", [])}
    raise RuntimeError("No successful exact-tree CI qualification receipt; release is blocked")


def previous_release(current: int) -> tuple[dict | None, dict | None]:
    attempt = int(os.environ.get("GITHUB_RUN_ATTEMPT", "1"))
    if attempt > 1:
        run = api(f"/actions/runs/{current}/attempts/{attempt - 1}")
        if run["status"] == "completed" and run["head_branch"] == "main":
            receipt = artifact(run, UPLOAD, "release-evidence.json")
            validate_previous(run, receipt)
            return run, receipt
    runs = api("/actions/workflows/deploy.yml/runs?branch=main&per_page=20")["workflow_runs"]
    for run in runs:
        if run["id"] == current or run["status"] != "completed":
            continue
        if run["event"] not in {"push", "workflow_dispatch"} or run["head_branch"] != "main":
            continue
        # Never look behind a newer failed/partial/missing receipt to find a
        # convenient old success. Unknown applied state invalidates reuse.
        receipt = artifact(run, UPLOAD, "release-evidence.json")
        validate_previous(run, receipt)
        return run, receipt
    return None, None


def validate_previous(run: dict, receipt: dict | None) -> None:
    if receipt and (receipt["source"] != run["head_sha"]
                    or receipt.get("kind") != "deployment"
                    or not SHA.fullmatch(receipt.get("applied_head", ""))):
        raise ValueError("Deployment receipt source mismatch")


def valid_origin(value: object) -> bool:
    return (
        isinstance(value, dict) and type(value.get("run")) is int and value["run"] > 0
        and type(value.get("attempt")) is int and value["attempt"] > 0
        and isinstance(value.get("source"), str) and bool(SHA.fullmatch(value["source"]))
    )


def component_selection(inputs: dict, previous: dict | None, compatible: bool) -> dict:
    components = (previous or {}).get("components", {})
    selected = {}
    for part in PARTS:
        prior = components.get(part, {})
        selected[part] = not (
            compatible and prior.get("state") in {"applied", "reused"}
            and prior.get("fingerprint") == inputs[part]
            and valid_version(part, prior.get("version"))
            and valid_origin(prior.get("origin"))
            and (part != "backend" or valid_origin(prior.get("revision_origin")))
        )
    # Reapplying Bicep can overwrite app configuration; agent activation can
    # mutate backend identity. Re-prove all downstream application state.
    if selected["infra"]:
        selected = dict.fromkeys(PARTS, True)
    return selected


def valid_version(part: str, value: object) -> bool:
    if not isinstance(value, dict):
        return False
    required = {
        "infra": {"deployment"}, "backend": {"image", "revision"},
        "web": {"source", "bundle"}, "agent": {"image", "version"},
    }[part]
    if set(value) != required or not all(isinstance(v, str) for v in value.values()):
        return False
    if part in {"backend", "agent"}:
        if not re.fullmatch(r"[a-z0-9.-]+/jarvis-(?:backend|agent)@sha256:[0-9a-f]{64}",
                            value["image"]):
            return False
    if part == "web" and (not SHA.fullmatch(value["source"])
                          or not DIGEST.fullmatch(value["bundle"])):
        return False
    if part == "agent" and not re.fullmatch(r"[0-9]{1,12}", value["version"]):
        return False
    return all(re.fullmatch(r"[A-Za-z0-9_.:@/-]{1,256}", v) for v in value.values())


def prepare() -> None:
    context = identity()
    head = context["source"]
    run, previous = previous_release(context["run"])
    superseded = False
    compatible = False
    applied_head = head
    if run:
        horizon = (previous or {}).get("applied_head", run["head_sha"])
        if not SHA.fullmatch(horizon):
            raise ValueError("Invalid previous source")
        # A reverse ancestor is superseded even for a manual dispatch.
        superseded = horizon != head and is_ancestor(head, horizon)
        compatible = is_ancestor(horizon, head)
        if superseded:
            applied_head = horizon
    configuration = os.environ["RELEASE_CONFIGURATION"]
    inputs = fingerprints(head, configuration)
    selected = dict.fromkeys(PARTS, False) if superseded else component_selection(
        inputs, previous, compatible,
    )
    qualification = None if superseded else qualify(head)
    plan = {**context, "inputs": inputs, "selected": selected, "superseded": superseded,
            "applied_head": applied_head, "qualification": qualification, "previous": previous}
    Path("release-plan.json").write_text(json.dumps(plan), encoding="utf-8")
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        for part in PARTS:
            output.write(f"{part}={str(selected[part]).lower()}\n")
        output.write(f"superseded={str(superseded).lower()}\n")
    print("Release superseded" if superseded else
          "Apply: " + (", ".join(part for part in PARTS if selected[part]) or
                       "none; compatible applied versions retained"))


def is_ancestor(base: str, head: str) -> bool:
    result = subprocess.run(["git", "merge-base", "--is-ancestor", base, head],
                            capture_output=True, check=False, timeout=60)
    if result.returncode not in {0, 1}:
        raise RuntimeError("Cannot establish deployment ancestry")
    return result.returncode == 0


def budget_contacts_match() -> bool:
    """Compare sensitive configuration in memory; never persist even a hash."""
    configured = os.environ.get("JARVIS_BUDGET_CONTACT_EMAILS", "")
    expected = [email.strip() for email in configured.split(",")]
    if not all(re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) for email in expected):
        raise ValueError("Budget contact configuration unavailable")
    result = subprocess.run(
        ["az", "monitor", "action-group", "show", "--name", "jarvis-alerts",
         "--resource-group", os.environ["RESOURCE_GROUP"],
         "--subscription", os.environ["SUBSCRIPTION_ID"],
         "--query", "emailReceivers[].emailAddress", "--output", "json", "--only-show-errors"],
        capture_output=True, text=True, check=False, timeout=30,
    )
    if result.returncode or len(result.stdout) > 65536:
        raise RuntimeError("Budget contact readback unavailable")
    actual = json.loads(result.stdout)
    if not isinstance(actual, list) or not all(isinstance(email, str) for email in actual):
        raise ValueError("Budget contact readback unavailable")
    return actual == expected


def select() -> None:
    path = Path("release-plan.json")
    plan = json.loads(path.read_text(encoding="utf-8"))
    context = identity()
    if any(plan.get(key) != context[key] for key in ("source", "tree", "run", "attempt")):
        raise ValueError("Deployment plan provenance mismatch")
    if not plan["superseded"] and not plan["selected"]["infra"]:
        if not budget_contacts_match():
            plan["selected"] = dict.fromkeys(PARTS, True)
            print("Sensitive infrastructure configuration changed; re-prove downstream state.")
        else:
            print("Sensitive infrastructure configuration matches; no value or hash retained.")
    path.write_text(json.dumps(plan), encoding="utf-8")
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        for part in PARTS:
            output.write(f"{part}={str(plan['selected'][part]).lower()}\n")
        output.write(f"superseded={str(plan['superseded']).lower()}\n")


def record() -> int:
    context = identity()
    results = json.loads(os.environ["RESULTS"])
    path = Path("release-plan.json")
    plan = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
    if plan and any(plan.get(key) != context[key] for key in ("source", "tree", "run")):
        raise ValueError("Deployment plan provenance mismatch")
    versions = json.loads(os.environ.get("VERSIONS", "{}"))
    attempts = json.loads(os.environ.get("APPLY_ATTEMPTS", "{}"))
    components = {}
    for part in PARTS:
        if not plan:
            components[part] = {"state": "unknown"}
        elif plan["superseded"]:
            components[part] = ((plan.get("previous") or {}).get("components", {}).get(part)
                                or {"state": "unknown"})
        elif plan["selected"][part]:
            attempt = attempts.get(part, "")
            applied = (results.get(part, {}).get("result") == "success"
                       and str(attempt).isdigit() and 1 <= int(attempt) <= context["attempt"])
            version = versions.get(part)
            components[part] = {
                "state": "applied" if applied and valid_version(part, version) else "unknown",
                "fingerprint": plan["inputs"][part],
                "version": version if valid_version(part, version) else None,
                "origin": {"run": context["run"], "attempt": int(attempt) if applied else None,
                           "source": context["source"]},
            }
            if part == "backend":
                components[part]["revision_origin"] = components[part]["origin"].copy()
        else:
            components[part] = {**plan["previous"]["components"][part], "state": "reused"}
    if (plan and plan["selected"]["agent"]
            and results.get("agent", {}).get("result") != "success"):
        # Activation may already have modified backend identity before failing.
        components["backend"]["state"] = "unknown"
    backend_revision = os.environ.get("AGENT_BACKEND_REVISION", "")
    if backend_revision and components["backend"].get("version"):
        agent_attempt = attempts.get("agent", "")
        if (not re.fullmatch(r"[A-Za-z0-9-]{1,256}", backend_revision)
                or not str(agent_attempt).isdigit()
                or not 1 <= int(agent_attempt) <= context["attempt"]):
            raise ValueError("Invalid backend revision")
        components["backend"]["version"] = {
            **components["backend"]["version"], "revision": backend_revision,
        }
        components["backend"]["revision_origin"] = {
            "run": context["run"], "attempt": int(agent_attempt), "source": context["source"],
        }
        if results.get("agent", {}).get("result") == "success":
            components["backend"]["state"] = "applied"
    expected = {"plan", *PARTS, "smoke", "acceptance"}
    superseded = bool(plan and plan["superseded"])
    accepted = (
        set(results) == expected and results["plan"]["result"] == "success" and not superseded
        and all(item.get("state") in {"applied", "reused"} for item in components.values())
        and all(results[key]["result"] == ("success" if plan["selected"][key] else "skipped")
                for key in PARTS)
        and all(results[key]["result"] == "success" for key in ("smoke", "acceptance"))
    )
    statuses = {"success", "failure", "cancelled", "skipped"}
    receipt = {
        **context, "kind": "deployment", "accepted": accepted, "superseded": superseded,
        "applied_head": plan["applied_head"] if plan else context["source"],
        "qualification": plan["qualification"] if plan else None,
        "components": components,
        "previous_evidence": (
            {key: plan["previous"].get(key)
             for key in ("source", "run", "attempt", "evidence_artifact")}
            if plan and plan.get("previous") else None
        ),
        "checks": {key: results.get(key, {}).get("result")
                   if results.get(key, {}).get("result") in statuses else "unknown"
                   for key in sorted(expected)},
    }
    # The acceptance job uploads only fixed ID/status/reason triples, not its raw response.
    smoke = Path("acceptance-evidence.json")
    if smoke.exists() and smoke.stat().st_size <= 65536:
        from smoke_reasons import report_ok, safe_report
        receipt["acceptance"] = safe_report(json.loads(smoke.read_text(encoding="utf-8")))
    if accepted and ("acceptance" not in receipt or not report_ok(receipt["acceptance"])):
        receipt["accepted"] = accepted = False
    receipt["acceptance_evidence"] = (
        "retained" if "acceptance" in receipt else "unavailable; inspect failing pipeline step ID"
    )
    Path("release-evidence.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
        summary.write("### Release evidence\n\n")
        summary.write(f"Source `{context['source']}`, tree `{context['tree']}`, "
                      f"run `{context['run']}` attempt `{context['attempt']}`.\n\n")
        summary.write(f"Accepted: **{accepted}**. Superseded: **{superseded}**.\n\n")
        summary.write("Route failed check IDs and this artifact to the qualification PR's "
                      "existing builder; no coordinator reproduction is needed.\n\n")
        for part, value in components.items():
            summary.write(f"- `{part}`: **{value['state']}**\n")
        for key, status in receipt["checks"].items():
            summary.write(f"- `{key}`: **{status}**\n")
    return 0 if accepted or superseded else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=("plan", "select", "record"))
    args = parser.parse_args()
    try:
        if args.operation == "plan":
            prepare()
            return 0
        if args.operation == "select":
            select()
            return 0
        return record()
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, zipfile.BadZipFile,
            subprocess.TimeoutExpired) as error:
        code = {
            "No successful exact-tree CI qualification receipt; release is blocked":
                "exact_qualification_missing",
            "GitHub release evidence request failed": "github_evidence_request_failed",
            "Release artifact digest mismatch": "artifact_digest_mismatch",
            "Release receipt provenance mismatch": "artifact_provenance_mismatch",
            "Deployment receipt source mismatch": "prior_source_mismatch",
            "Deployment plan provenance mismatch": "plan_provenance_mismatch",
            "Cannot establish deployment ancestry": "ancestry_unavailable",
            "Budget contact configuration unavailable": "budget_configuration_unavailable",
            "Budget contact readback unavailable": "budget_readback_unavailable",
        }.get(str(error), "invalid_or_missing_evidence")
        if args.operation == "record":
            # A failed evidence producer is a failed release, never a cache hit.
            Path("release-evidence.json").write_text(json.dumps({
                **identity(), "kind": "deployment", "accepted": False,
                "applied_head": os.environ["GITHUB_SHA"], "failure_code": code,
                "components": {part: {"state": "unknown"} for part in PARTS},
            }), encoding="utf-8")
        print(f"::error::Release evidence failed: {code}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
