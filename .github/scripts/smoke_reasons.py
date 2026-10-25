"""Print only fixed, non-sensitive chat acceptance reason codes."""

import argparse
import json
from pathlib import Path
import sys

MAX_REPORT_BYTES = 64 * 1024
CHAT_AGENT_FAILURE_REASONS = frozenset({
    "backend_unavailable",
    "catalogue_unavailable",
    "context_unavailable",
    "usage_unavailable",
    "capability_instructions_too_large",
    "settings_not_json",
    "settings_invalid",
    "settings_timeout",
    "settings_unreachable",
    "settings_unavailable",
    "settings_http_401",
    "settings_http_403",
    "settings_http_429",
    "settings_http_500",
    "settings_http_502",
    "settings_http_503",
    "settings_http_504",
    "response_too_large",
    "error_runtimeerror",
    "error_valueerror",
    "error_typeerror",
    "error_timeouterror",
    "error_httpstatuserror",
    "error_connecterror",
    "error_readtimeout",
    "error_connecttimeout",
    "error_pooltimeout",
    "error_remoteprotocolerror",
    "error_ratelimiterror",
    "rate_limit_exceeded",
    "error_apistatuserror",
    "error_apiconnectionerror",
    "error_apitimeouterror",
    "error_authenticationerror",
    "error_permissiondeniederror",
    "error_badrequesterror",
    "error_internalservererror",
    "tool_loop_stalled",
})
CHAT_AGENT_INVOCATION_REASONS = frozenset({
    "agent_auth_unavailable",
    "agent_request_failed",
    "agent_http_400",
    "agent_http_401",
    "agent_http_403",
    "agent_http_404",
    "agent_http_408",
    "agent_http_409",
    "agent_http_424",
    "agent_http_429",
    "agent_http_500",
    "agent_http_502",
    "agent_http_503",
    "agent_http_504",
    "agent_http_other",
    "agent_response_invalid",
    "agent_stream_failed",
    "agent_stream_ended",
    "agent_error_code_missing",
    "agent_error_code_unlisted",
})
SHARED = (
    frozenset({"agent_error", "timeout"}) | CHAT_AGENT_FAILURE_REASONS | CHAT_AGENT_INVOCATION_REASONS
)
SAFE_REASONS = {
    "chat_canary": {"agent_error", "timeout", "acceptance_check_failed", "rate_limit_exceeded"},
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
