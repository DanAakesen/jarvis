"""Read-only production evidence for the scheduled vault mirror job."""

import argparse
import json
import re
import subprocess
import sys
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

JOB_NAME = "job-jarvis-vault-mirror"
CONTAINER_NAME = "vault-mirror"
TERMINAL = {"Succeeded", "Failed"}
RUN_OUTCOMES = {"ok", "ok-noop", "skipped-busy", "needs-attention", "failed"}
RUN_REASONS = {
    "auth", "policy-missing", "repo-not-private", "pull-failed", "guard-tripped",
    "conflict", "secret-match", "push-rejected", "upload-failed", "state-corrupt",
    "timeout", "unexpected",
}
GUARD_REASONS = {
    "invalid-input", "max-changed-G", "max-changed-O", "max-deletes-G",
    "max-deletes-O", "base-deletion-ratio", "empty-side", "missing-base-O",
    "missing-base-G",
}
REQUIRED_ENV = {
    "KEY_VAULT_URI", "AZURE_CLIENT_ID", "GITHUB_APP_ID",
    "VAULT_MIRROR_STORAGE_URL", "VAULT_MIRROR_WRITE_BACK",
    "VAULT_MIRROR_MAX_CHANGED", "VAULT_MIRROR_MAX_DELETES",
}


class ProbeError(RuntimeError):
    pass


def az(subscription: str, *arguments: str):
    command = [
        "az", *arguments, "--subscription", subscription, "--only-show-errors", "--output", "json",
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=120)
    if result.returncode != 0:
        raise ProbeError("az_command_failed:" + " ".join(arguments[:3]))
    try:
        return json.loads(result.stdout) if result.stdout.strip() else None
    except json.JSONDecodeError as error:
        raise ProbeError("az_output_invalid") from error


def job_identity(job: dict) -> tuple[str, str]:
    identity = job.get("identity") or {}
    assigned = identity.get("userAssignedIdentities") or {}
    resource_ids = list(assigned) if isinstance(assigned, dict) else []
    properties = job.get("properties") or {}
    configuration = properties.get("configuration") or {}
    registries = configuration.get("registries") or []
    containers = (properties.get("template") or {}).get("containers") or []
    container = containers[0] if len(containers) == 1 else {}
    env = {
        item.get("name"): item.get("value")
        for item in container.get("env") or []
        if isinstance(item, dict)
    }
    if (
        identity.get("type") != "UserAssigned"
        or len(resource_ids) != 1
        or not resource_ids[0].rsplit("/", 1)[-1].startswith("id-jarvis-vault-mirror-")
        or len(registries) != 1
        or registries[0].get("identity") != resource_ids[0]
        or not REQUIRED_ENV.issubset(env)
        or any(not isinstance(env.get(key), str) or not env[key] for key in REQUIRED_ENV)
    ):
        raise ProbeError("vault_mirror_identity_configuration_mismatch")
    return resource_ids[0], env["AZURE_CLIENT_ID"]


def job_summary(job: dict, expected: dict[str, object]) -> dict[str, object]:
    properties = job.get("properties") or {}
    configuration = properties.get("configuration") or {}
    schedule = configuration.get("scheduleTriggerConfig") or {}
    containers = (properties.get("template") or {}).get("containers") or []
    container = containers[0] if len(containers) == 1 else {}
    env = {
        item.get("name"): item.get("value")
        for item in container.get("env") or []
        if isinstance(item, dict)
    }
    summary = {
        "name": job.get("name"),
        "provisioningState": properties.get("provisioningState"),
        "triggerType": configuration.get("triggerType"),
        "cronExpression": schedule.get("cronExpression"),
        "parallelism": schedule.get("parallelism"),
        "replicaCompletionCount": schedule.get("replicaCompletionCount"),
        "replicaTimeout": configuration.get("replicaTimeout"),
        "replicaRetryLimit": configuration.get("replicaRetryLimit"),
        "image": container.get("image"),
        "writeBack": env.get("VAULT_MIRROR_WRITE_BACK"),
        "maxChanged": env.get("VAULT_MIRROR_MAX_CHANGED"),
        "maxDeletes": env.get("VAULT_MIRROR_MAX_DELETES"),
    }
    mismatches = [
        key for key, expected_value in expected.items()
        if summary.get(key) != expected_value
    ]
    if mismatches:
        raise ProbeError("vault_mirror_configuration_mismatch:" + ",".join(mismatches))
    job_identity(job)
    image = summary["image"]
    if not isinstance(image, str) or re.fullmatch(
        r"[^/\s]+/jarvis-vault-mirror@sha256:[0-9a-f]{64}", image
    ) is None:
        raise ProbeError("vault_mirror_image_not_digest_pinned")
    return summary


def execution_summary(execution: dict) -> dict[str, object]:
    properties = execution.get("properties") or {}
    return {
        "name": execution.get("name"),
        "status": properties.get("status"),
        "startTime": properties.get("startTime"),
        "endTime": properties.get("endTime"),
    }


def instant(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
        return parsed if parsed.tzinfo is not None else None
    except ValueError:
        return None


def latest_execution(
    items: list[dict],
    now: datetime,
    max_age_seconds: int,
    not_before: datetime | None = None,
) -> dict | None:
    candidates = []
    for item in items:
        started = instant((item.get("properties") or {}).get("startTime"))
        age = (now - started).total_seconds() if started is not None else None
        after_start = not_before is None or started >= not_before - timedelta(seconds=5)
        if age is not None and -60 <= age <= max_age_seconds and after_start:
            candidates.append((started, item))
    return max(candidates, default=(None, None), key=lambda pair: pair[0] or datetime.min.replace(tzinfo=UTC))[1]


def parse_runner_log(output: str) -> dict[str, object] | None:
    summary = None
    for line in output.splitlines():
        if len(line) > 64 * 1024:
            continue
        start = line.find("{")
        if start < 0:
            continue
        try:
            value = json.loads(line[start:])
        except json.JSONDecodeError:
            continue
        if not isinstance(value, dict) or value.get("outcome") not in RUN_OUTCOMES:
            continue
        counts = {
            key: value.get(key)
            for key in (
                "durationMs", "approved", "pushed", "writtenBack", "deleted",
                "conflicts", "skipped", "credentialMatches", "pendingWriteBack",
                "changedOnGitHub", "changedOnObsidian", "deletedOnGitHub",
                "deletedOnObsidian", "deferredOnGitHub", "deferredOnObsidian",
            )
            if type(value.get(key)) is int and 0 <= value[key] <= 1_000_000_000
        }
        reason = value.get("reason")
        guard_reasons = value.get("guardReasons")
        if isinstance(guard_reasons, list) and 0 < len(guard_reasons) <= len(GUARD_REASONS) and all(
            isinstance(item, str) and item in GUARD_REASONS for item in guard_reasons
        ):
            counts["guardReasons"] = guard_reasons
        summary = {
            "outcome": value.get("outcome"),
            "reason": reason if isinstance(reason, str) and reason in RUN_REASONS else None,
            **counts,
        }
    return summary


def read_logs(subscription: str, group: str, execution: str) -> str:
    result = subprocess.run([
        "az", "containerapp", "job", "logs", "show",
        "--name", JOB_NAME, "--resource-group", group, "--execution", execution,
        "--container", CONTAINER_NAME, "--tail", "200", "--format", "text",
        "--subscription", subscription, "--only-show-errors",
    ], capture_output=True, text=True, check=False, timeout=120)
    if result.returncode != 0:
        raise ProbeError("vault_mirror_logs_unavailable")
    return result.stdout


def probe(
    subscription: str,
    group: str,
    write_back: str,
    max_changed: int,
    max_deletes: int,
    max_age_seconds: int,
    wait_seconds: int,
    clock: Callable[[], datetime] | None = None,
    sleep=time.sleep,
) -> dict[str, object]:
    clock = clock or (lambda: datetime.now(UTC))
    probe_started_at = clock()
    expected = {
        "name": JOB_NAME,
        "provisioningState": "Succeeded",
        "triggerType": "Schedule",
        "cronExpression": "*/10 * * * *",
        "parallelism": 1,
        "replicaCompletionCount": 1,
        "replicaTimeout": 480,
        "replicaRetryLimit": 0,
        "writeBack": write_back,
        "maxChanged": str(max_changed),
        "maxDeletes": str(max_deletes),
    }
    job = az(subscription, "containerapp", "job", "show",
             "--name", JOB_NAME, "--resource-group", group)
    if not isinstance(job, dict):
        raise ProbeError("vault_mirror_job_unavailable")
    job_result = job_summary(job, expected)
    identity_resource_id, configured_client_id = job_identity(job)
    identity = az(subscription, "identity", "show", "--ids", identity_resource_id)
    if not isinstance(identity, dict) or identity.get("clientId") != configured_client_id:
        raise ProbeError("vault_mirror_identity_client_mismatch")
    deadline = time.monotonic() + wait_seconds
    execution = None
    while True:
        items = az(subscription, "containerapp", "job", "execution", "list",
                   "--name", JOB_NAME, "--resource-group", group)
        if not isinstance(items, list):
            raise ProbeError("vault_mirror_executions_invalid")
        execution = latest_execution(items, clock(), max_age_seconds, probe_started_at)
        if execution and (execution.get("properties") or {}).get("status") in TERMINAL:
            break
        if time.monotonic() >= deadline:
            raise ProbeError("vault_mirror_execution_missing_or_running")
        sleep(15)
    current_execution = az(
        subscription,
        "containerapp", "job", "execution", "show",
        "--name", JOB_NAME, "--resource-group", group,
        "--job-execution-name", str(execution.get("name") or ""),
    )
    if not isinstance(current_execution, dict):
        raise ProbeError("vault_mirror_execution_unavailable")
    execution = current_execution
    execution_result = execution_summary(execution)
    template = (execution.get("properties") or {}).get("template") or {}
    containers = template.get("containers") or []
    execution_image = containers[0].get("image") if len(containers) == 1 else None
    if execution_image != job_result["image"]:
        raise ProbeError("vault_mirror_execution_image_mismatch")
    runner = None
    while True:
        try:
            runner = parse_runner_log(read_logs(subscription, group, str(execution_result["name"])))
        except ProbeError:
            runner = None
        if runner is not None:
            break
        if time.monotonic() >= deadline:
            raise ProbeError("vault_mirror_runner_summary_missing")
        sleep(10)
    outcome = runner["outcome"]
    if outcome == "skipped-busy":
        raise ProbeError("vault_mirror_execution_skipped_busy")
    verdict = "healthy" if outcome in {"ok", "ok-noop"} else \
        "attention" if outcome == "needs-attention" else "failed"
    if outcome == "needs-attention" and runner.get("reason") == "guard-tripped":
        guards = runner.get("guardReasons") or []
        evidence = {
            "guardReasons": guards if isinstance(guards, list) else ["unknown"],
            **{
                key: runner[key]
                for key in (
                    "changedOnGitHub", "changedOnObsidian",
                    "deletedOnGitHub", "deletedOnObsidian",
                    "deferredOnGitHub", "deferredOnObsidian",
                )
                if key in runner
            },
        }
        raise ProbeError("vault_mirror_guard_tripped:" + json.dumps(evidence, sort_keys=True))
    if outcome == "needs-attention" and runner.get("reason") not in {"conflict", "secret-match"}:
        raise ProbeError(f"vault_mirror_needs_attention:{runner.get('reason') or 'unknown'}")
    if verdict == "failed":
        raise ProbeError(f"vault_mirror_run_failed:{runner.get('reason') or 'unknown'}")
    return {
        "job": job_result,
        "execution": execution_result,
        "runner": runner,
        "verdict": verdict,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--subscription", required=True)
    parser.add_argument("--resource-group", required=True)
    parser.add_argument("--write-back", choices=("dry-run", "on"), required=True)
    parser.add_argument("--max-changed", type=int, required=True)
    parser.add_argument("--max-deletes", type=int, required=True)
    parser.add_argument("--max-age-seconds", type=int, default=1200)
    parser.add_argument("--wait-seconds", type=int, default=0)
    args = parser.parse_args()
    try:
        result = probe(
            args.subscription,
            args.resource_group,
            args.write_back,
            args.max_changed,
            args.max_deletes,
            args.max_age_seconds,
            args.wait_seconds,
        )
        print(json.dumps(result, sort_keys=True))
        if result["verdict"] == "attention":
            print("::warning title=Vault mirror::The latest scheduled run needs attention.", file=sys.stderr)
    except ProbeError as error:
        print(f"::error title=Vault mirror::Production probe failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
