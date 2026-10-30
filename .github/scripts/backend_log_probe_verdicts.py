"""Emit fixed authorization observations, never Azure IDs, provider text or log rows."""
import json
import re
import sys
from pathlib import Path

CHECKS = {"unfiltered_table", "other_app", "other_table", "foreign_workspace", "foundry_resource", "foundry_permissions"}
VERDICTS = {"denied", "no_visible_rows", "backend_only", "other_app_visible", "query_allowed",
            "not_configured", "unavailable", "bad_request", "unauthenticated", "not_found",
            "throttled", "timeout", "invalid_response", "rows_visible", "metadata_missing", "metadata_invalid",
            "resource_not_listed", "no_data_sources", "data_sources_not_listed", "resource_table_denied",
            "data_source_table_denied", "table_not_explicitly_denied"}


def lines(report: object) -> list[str]:
    if not isinstance(report, dict):
        raise TypeError("invalid_report")
    value = report.get("backendLogAuthorization")
    if value is None:
        return ["Backend log authorization: not_configured; no isolation proof or activation."]
    if (not isinstance(value, dict) or set(value) != {"stage", "checkedAt", "identity", "checks"}
            or value["stage"] != "authorization_observations"
            or value["identity"] not in {"matched", "mismatch", "unavailable"}
            or not isinstance(value["checkedAt"], str)
            or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", value["checkedAt"])
            or not isinstance(value["checks"], dict) or set(value["checks"]) != CHECKS
            or any(not isinstance(item, str) or item not in VERDICTS for item in value["checks"].values())):
        raise ValueError("invalid_observations")
    return ["Backend log authorization identity: " + value["identity"],
            *["Backend log authorization " + key + ": " + value["checks"][key] for key in sorted(CHECKS)],
            "Backend log authorization: observations only; empty negatives are not isolation proof; no activation is performed here."]


def main() -> int:
    try:
        with Path(sys.argv[1]).open("rb") as source:
            raw = source.read(65537)
        if len(raw) > 65536:
            raise ValueError("report_limit")
        for line in lines(json.loads(raw)):
            print(line)
        return 0
    except (OSError, ValueError, TypeError, KeyError, IndexError):
        print("Backend log authorization: observations_unavailable; no isolation proof or activation.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
