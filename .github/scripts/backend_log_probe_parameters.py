"""Consume the same job's private preflight report; configure only fixed read probes."""
import json
import os
import re
import stat
import sys
import time
from pathlib import Path

from backend_log_preflight import (
    PreflightBlocked,
    guid,
    private_write,
    require,
    same_id,
    targets,
)


def parameters(report: dict, expected: dict) -> dict:
    require(report.get("schema") == 1 and report.get("stage") == "metadata_only"
            and report.get("targets") == expected and report.get("grant_applied") is False
            and report.get("reader_enabled") is False, "invalid_preflight_report")
    required = {"live_identity_matches", "runtime_identity_matches", "live_workspace_matches",
                "console_schema_matches", "builtin_role_matches", "role_inventory_read"}
    checks = report.get("checks")
    require(isinstance(checks, list) and all(isinstance(item, str) for item in checks)
            and required.issubset(checks), "incomplete_preflight_report")
    workspace = report.get("workspace", {})
    require(same_id(workspace.get("id"), expected["workspace_id"])
            and guid(workspace.get("customerId")), "invalid_probe_workspace")
    candidates = report.get("negative_workspace_candidates")
    require(isinstance(candidates, list), "invalid_probe_controls")
    foreign = ""
    for candidate in candidates:
        require(isinstance(candidate, dict) and isinstance(candidate.get("id"), str)
                and re.fullmatch(r"/subscriptions/" + re.escape(expected["subscription"])
                                 + r"/resourceGroups/[a-z0-9._()-]+/providers/Microsoft\.OperationalInsights/workspaces/[a-z0-9-]+",
                                 candidate["id"], re.IGNORECASE)
                and not same_id(candidate["id"], expected["workspace_id"]), "invalid_probe_controls")
        customer = candidate.get("properties", {}).get("customerId")
        require(guid(customer) and not same_id(customer, workspace["customerId"]), "invalid_probe_controls")
        if not foreign:
            foreign = customer
    # Findings remain unresolved. These parameters neither grant access nor enable the reader.
    values = {"backendLogProbeWorkspaceId": workspace["customerId"],
              "backendLogProbePrincipalId": expected["principal_id"], "backendLogProbeAppName": expected["app_name"],
              "backendLogProbeForeignWorkspaceId": foreign}
    return {"parameters": {key: {"value": value} for key, value in values.items()}}


def read_private(path: Path, now: float) -> dict:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as source:
        metadata = os.fstat(source.fileno())
        require(stat.S_ISREG(metadata.st_mode) and stat.S_IMODE(metadata.st_mode) == 0o600
                and metadata.st_uid == os.geteuid() and -5 <= now - metadata.st_mtime <= 300
                and metadata.st_size <= 2 * 1024 * 1024, "invalid_private_preflight")
        value = json.load(source)
    require(isinstance(value, dict), "invalid_private_preflight")
    return value


def main() -> int:
    try:
        require(os.environ.get("GITHUB_REF") == "refs/heads/main"
                and os.environ.get("GITHUB_ACTIONS") == "true", "main_oidc_required")
        root = Path(os.environ["RUNNER_TEMP"]).resolve()
        expected = targets(json.loads(Path("infra/bootstrap.output.json").read_text()),
                           json.loads(Path("apps/web/config.json").read_text()))
        require(same_id(os.environ.get("SUBSCRIPTION_ID"), expected["subscription"]), "subscription_mismatch")
        value = parameters(read_private(root / "backend-log-preflight.private.json", time.time()), expected)
        private_write(root / "backend-log-probe.params.json", value)
        print("Backend log authorization: private probe parameters prepared; no grant or reader enablement performed.")
        return 0
    except PreflightBlocked as error:
        print("Backend log authorization blocked: " + str(error), file=sys.stderr)
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        print("Backend log authorization blocked: private_parameters_unavailable", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
