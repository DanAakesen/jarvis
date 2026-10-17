"""Print only fixed, non-sensitive chat acceptance reason codes."""

import argparse
import json
from pathlib import Path
import sys

MAX_REPORT_BYTES = 64 * 1024
SHARED = frozenset({"agent_error", "timeout"})
SAFE_REASONS = {
    "chat_canary": SHARED | {"acceptance_check_failed"},
    "chat_identity": SHARED | {"catalogue_unavailable", "identity_reply"},
    "chat_capabilities": SHARED | {
        "catalogue_unavailable", "capabilities_discovery_missing",
        "capabilities_discovery_wrong", "capabilities_discovery_failed",
        "capabilities_receipt_incomplete", "capabilities_reply_incomplete",
    },
    "chat_github_read": SHARED | {"catalogue_unavailable", "github_issue_unavailable"},
    "chat_jobs": SHARED | {"catalogue_unavailable", "jobs_unavailable"},
    "chat_navigation": SHARED | {"catalogue_unavailable", "navigation_refusal_missing"},
    "chat_no_timestamp": SHARED | {"catalogue_unavailable", "capture_time_invented"},
    "chat_plain_approval": SHARED | {"catalogue_unavailable", "plain_approval_failed"},
}
CHECK_IDS = frozenset(SAFE_REASONS) | {
    "google", "github_app", "vault", "foundry.embeddings", "research", "pc_bridge", "agent_contract",
}
NONBLOCKING = {"pc_bridge", "chat_identity", "chat_no_timestamp"}


def safe_report(report: object) -> dict:
    if not isinstance(report, dict) or not isinstance(report.get("entries"), list):
        raise ValueError("Invalid smoke report")
    entries = report["entries"]
    if (len(entries) != len(CHECK_IDS) or not all(
            isinstance(entry, dict) and isinstance(entry.get("id"), str) for entry in entries)
            or {entry.get("id") for entry in entries} != CHECK_IDS):
        raise ValueError("Missing or duplicate smoke checks")
    safe = []
    for entry in entries:
        check, status = entry["id"], entry.get("status")
        if not isinstance(status, str) or status not in {"ok", "down", "degraded", "unknown"}:
            raise ValueError("Invalid smoke status")
        reason = entry.get("reason")
        safe.append({
            "id": check, "status": status,
            **({"reason": reason if isinstance(reason, str)
                and reason in SAFE_REASONS.get(check, set()) else "not_reported_or_redacted"}
               if status != "ok" else {}),
        })
    return {"entries": safe}


def report_ok(report: dict) -> bool:
    return all(entry["status"] == "ok" or entry["id"] in NONBLOCKING
               for entry in safe_report(report)["entries"])


def failure_reasons(report: object) -> list[str]:
    if not isinstance(report, dict) or not isinstance(report.get("entries"), list):
        raise ValueError("Invalid smoke report")
    lines = []
    for entry in report["entries"]:
        if not isinstance(entry, dict):
            raise ValueError("Invalid smoke entry")
        check = entry.get("id")
        if not isinstance(check, str) or check not in SAFE_REASONS:
            continue
        status = entry.get("status")
        if not isinstance(status, str) or status not in {"ok", "down", "degraded", "unknown"}:
            raise ValueError("Invalid smoke status")
        if status not in {"down", "degraded"}:
            continue
        reason = entry.get("reason")
        safe = (
            reason if isinstance(reason, str) and reason in SAFE_REASONS[check]
            else "not_reported_or_redacted"
        )
        lines.append(f"smoke_reason {check}: {safe}")
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--evidence", type=Path)
    arguments = parser.parse_args()
    try:
        with arguments.report.open("rb") as stream:
            raw = stream.read(MAX_REPORT_BYTES + 1)
        if len(raw) > MAX_REPORT_BYTES:
            raise ValueError("Oversized smoke report")
        report = json.loads(raw.decode("utf-8"))
        lines = failure_reasons(report)
        if arguments.evidence:
            safe = safe_report(report)
            arguments.evidence.write_text(json.dumps(safe, indent=2), encoding="utf-8")
            for entry in safe["entries"]:
                print(f"smoke {entry['id']}: {entry['status']}")
    except (OSError, UnicodeError, ValueError):
        print("Smoke reason diagnostics unavailable: invalid or unreadable report.", file=sys.stderr)
        return 2
    for line in lines:
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
