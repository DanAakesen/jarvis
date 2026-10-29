"""Print only fixed, non-sensitive chat acceptance reason codes."""

import argparse
import json
from pathlib import Path
import sys

MAX_REPORT_BYTES = 64 * 1024
RESEARCH_FAILURE_REASONS = frozenset({
    "research_settings_unavailable",
    "research_runner_auth",
    "research_runner_timeout",
    "research_runner_aborted",
    "research_runner_transport",
    "research_runner_protocol",
    "research_runner_http_400",
    "research_runner_http_401",
    "research_runner_http_403",
    "research_runner_http_404",
    "research_runner_http_429",
    "research_runner_http_500",
    "research_runner_http_502",
    "research_runner_http_503",
    "research_runner_http_504",
    "research_usage_limit",
    "research_runner_failed",
    "research_result_missing",
    "research_result_invalid",
    "research_unavailable",
})
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
    "model_bad_request_model",
    "model_bad_request_instructions",
    "model_bad_request_input",
    "model_bad_request_output_limit",
    "model_bad_request_storage",
    "model_bad_request_streaming",
    "model_bad_request_tools",
    "model_bad_request_reasoning",
    "model_bad_request_include",
    "model_reasoning_parameter_unsupported",
    "model_reasoning_effort_unsupported",
    "model_reasoning_value_unsupported",
    "model_reasoning_effort_value_unsupported",
    "model_reasoning_value_invalid",
    "model_reasoning_effort_value_invalid",
    "model_reasoning_request_invalid",
    "model_reasoning_effort_request_invalid",
    "error_internalservererror",
    "tool_loop_stalled",
    # Fixed internal managed failures, matching the backend's exact vocabulary.
    "managed_session_busy",
    "managed_source_already_claimed",
    "managed_target_mismatch",
    "managed_unavailable",
    "managed_agent_builtin_tools_enabled",
    "managed_agent_definition_mismatch",
    "managed_agent_definition_missing",
    "managed_agent_extra_skills",
    "managed_agent_function_tools_mismatch",
    "managed_agent_toolset_missing",
    "managed_agent_unsupported_setting",
    "managed_agent_version_mismatch",
    "managed_backend_endpoint_invalid",
    "managed_binding_invalid",
    "managed_binding_unavailable",
    "managed_claim_missing",
    "managed_client_retries_enabled",
    "managed_conversation_missing",
    "managed_definition_instructions_missing",
    "managed_definition_tools_invalid",
    "managed_endpoint_invalid",
    "managed_endpoint_selector_mismatch",
    "managed_existing_credential_unavailable",
    "managed_final_only_tool_call",
    "managed_immutable_target_missing",
    "managed_input_boundary_invalid",
    "managed_input_cursor_rewound",
    "managed_input_empty",
    "managed_input_item_unsupported",
    "managed_input_unsupported",
    "managed_limits_invalid",
    "managed_model_forbidden",
    "managed_model_unauthorized",
    "managed_policy_catalogue_changed",
    "managed_policy_image_unverified",
    "managed_policy_smoke_unavailable",
    "managed_policy_setup_failed",
    "managed_policy_turn_failed",
    "managed_probe_conversation_missing",
    "managed_probe_empty_or_unfinished",
    "managed_probe_failed",
    "managed_probe_incomplete",
    "managed_probe_requested_tool",
    "managed_probe_settings_mismatch",
    "managed_probe_timeout",
    "managed_project_endpoint_mismatch",
    "managed_provider_failure",
    "managed_readback_forbidden",
    "managed_readback_invalid",
    "managed_readback_unauthorized",
    "managed_readback_unavailable",
    "managed_response_empty",
    "managed_response_failed",
    "managed_response_item_unsupported",
    "managed_response_unfinished",
    "managed_reviewed_definition_mismatch",
    "managed_reviewed_fingerprint_mismatch",
    "managed_seed_input_invalid",
    "managed_source_context_missing",
    "managed_steering_source_unclaimed",
    "managed_summary_history_policy_pending",
    "managed_target_invalid",
    "managed_target_missing",
    "managed_target_settings_mismatch",
    "managed_tool_arguments_invalid",
    "managed_tool_call_invalid",
    "managed_tool_call_unfinished",
    "managed_tool_repeated",
    "managed_tool_round_limit",
    "managed_tool_schema_unsupported",
    "managed_turn_already_claimed",
    "managed_voice_requires_backend_relay",
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
    "research": RESEARCH_FAILURE_REASONS,
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
