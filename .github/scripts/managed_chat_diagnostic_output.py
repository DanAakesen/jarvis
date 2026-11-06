"""Print only closed-vocabulary managed diagnostics; never provider prose or IDs."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "agents" / "jarvis"))
from managed_provider_cause import sanitize_provider_cause

REASONS = frozenset({
    "managed_readback_forbidden", "managed_readback_unauthorized", "managed_readback_unavailable",
    "managed_readback_invalid", "managed_existing_credential_unavailable", "managed_target_invalid",
    "managed_target_missing", "managed_target_settings_mismatch", "managed_immutable_target_missing",
    "managed_endpoint_invalid", "managed_project_endpoint_mismatch",
    "managed_reviewed_fingerprint_mismatch", "managed_reviewed_definition_mismatch",
    "managed_endpoint_selector_mismatch", "managed_definition_tools_invalid",
    "managed_definition_instructions_missing", "managed_agent_version_mismatch",
    "managed_agent_definition_missing", "managed_agent_definition_mismatch", "managed_agent_extra_skills",
    "managed_agent_unsupported_setting", "managed_agent_toolset_missing",
    "managed_agent_builtin_tools_enabled", "managed_agent_function_tools_mismatch",
    "managed_probe_settings_mismatch", "managed_probe_conversation_missing", "managed_probe_incomplete",
    "managed_probe_requested_tool", "managed_probe_empty_or_unfinished", "managed_probe_timeout",
    "managed_probe_failed", "managed_probe_policy_not_applied",
    "managed_model_forbidden", "managed_model_unauthorized",
    "managed_probe_setup_failed", "managed_probe_budget_exhausted", "managed_probe_target_changed",
})
STAGES = frozenset({"settings", "target_setup", "definition_readback", "conversation_create",
                    "conversation_policy_write", "response_start", "response_stream",
                    "diagnostic_budget"})
SHAPES = ("conversation_developer_policy", "conversation_system_policy")


def known(value, allowed, fallback="not_reported"):
    return value if isinstance(value, str) and value in allowed else fallback


def failure_fields(value):
    fields = ["reason=" + known(value.get("reason"), REASONS),
              "stage=" + known(value.get("stage"), STAGES, "managed_text_canary")]
    status = value.get("httpStatus")
    if type(status) in (int, float) and 400 <= status <= 599 and int(status) == status:
        fields.append(f"http_status={int(status)}")
    fields.extend([
        "expected_model=gpt-6.1-terra actual_model=" + known(value.get("model"), {"gpt-6.1-terra", "gpt-6-luna"}),
        "expected_effort=high actual_effort=" + known(value.get("reasoningEffort"), {"none", "low", "medium", "high", "xhigh"}),
    ])
    cause = sanitize_provider_cause(value.get("providerCause"))
    for key, label in (("httpStatus", "http_status"), ("code", "code"), ("param", "param"),
                       ("exceptionType", "exception")):
        if key in cause:
            fields.append(f"provider_{label}={cause[key]}")
    for index, detail in enumerate(cause.get("details", [])):
        fields.extend(f"provider_detail_{index}_{key}={item}" for key, item in detail.items())
    return " ".join(fields)


def main():
    mode, path = sys.argv[1:]
    value = {}
    try:
        with Path(path).open("rb") as source:
            raw = source.read(2 * 1024 * 1024 + 1)
        if len(raw) <= 2 * 1024 * 1024:
            value = json.loads(raw)
    except (ValueError, OSError, RecursionError):
        pass
    if not isinstance(value, dict):
        value = {}
    if mode == "canary":
        print("managed_chat_canary_diagnostic " + failure_fields(value))
        return 0
    rows = value.get("results")
    if (mode != "diagnostics" or value.get("status") != "diagnostic"
            or not isinstance(rows, list) or len(rows) != len(SHAPES)
            or any(not isinstance(row, dict) or row.get("shape") != shape
                   or row.get("status") not in ("ok", "unavailable", "skipped")
                   for shape, row in zip(SHAPES, rows))):
        return 1
    for row in rows:
        print(f"managed_chat_request_diagnostic shape={row['shape']} status={row['status']} "
              + failure_fields(row))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
