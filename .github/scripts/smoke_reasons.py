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
    arguments = parser.parse_args()
    try:
        with arguments.report.open("rb") as stream:
            raw = stream.read(MAX_REPORT_BYTES + 1)
        if len(raw) > MAX_REPORT_BYTES:
            raise ValueError("Oversized smoke report")
        lines = failure_reasons(json.loads(raw.decode("utf-8")))
    except (OSError, UnicodeError, ValueError):
        print("Smoke reason diagnostics unavailable: invalid or unreadable report.", file=sys.stderr)
        return 2
    for line in lines:
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
