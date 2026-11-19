import json
import unittest
from datetime import UTC, datetime
from unittest.mock import patch

from hermetic import setUpModule  # noqa: F401
from vault_mirror_probe import job_summary, latest_execution, parse_runner_log, probe

NOW = datetime(2026, 11, 19, 2, 0, tzinfo=UTC)
JOB = {
    "name": "job-jarvis-vault-mirror",
    "identity": {
        "type": "UserAssigned",
        "userAssignedIdentities": {
            "/subscriptions/sub/resourceGroups/group/providers/Microsoft.ManagedIdentity/"
            "userAssignedIdentities/id-jarvis-vault-mirror-fixture": {},
        },
    },
    "properties": {
        "provisioningState": "Succeeded",
        "configuration": {
            "triggerType": "Schedule",
            "replicaTimeout": 480,
            "replicaRetryLimit": 0,
            "registries": [{
                "server": "fixture.azurecr.io",
                "identity": "/subscriptions/sub/resourceGroups/group/providers/Microsoft.ManagedIdentity/"
                            "userAssignedIdentities/id-jarvis-vault-mirror-fixture",
            }],
            "scheduleTriggerConfig": {
                "cronExpression": "*/10 * * * *",
                "parallelism": 1,
                "replicaCompletionCount": 1,
            },
        },
        "template": {
            "containers": [{
                "name": "vault-mirror",
                "image": "fixture.azurecr.io/jarvis-vault-mirror@sha256:" + "a" * 64,
                "env": [
                    {"name": "KEY_VAULT_URI", "value": "https://fixture.vault.azure.net/"},
                    {"name": "AZURE_CLIENT_ID", "value": "client-fixture"},
                    {"name": "GITHUB_APP_ID", "value": "123"},
                    {"name": "VAULT_MIRROR_STORAGE_URL", "value": "https://fixture.blob.core.windows.net"},
                    {"name": "VAULT_MIRROR_WRITE_BACK", "value": "on"},
                    {"name": "VAULT_MIRROR_MAX_CHANGED", "value": "25"},
                    {"name": "VAULT_MIRROR_MAX_DELETES", "value": "3"},
                ],
            }],
        },
    },
}
EXPECTED = {
    "name": "job-jarvis-vault-mirror",
    "provisioningState": "Succeeded",
    "triggerType": "Schedule",
    "cronExpression": "*/10 * * * *",
    "parallelism": 1,
    "replicaCompletionCount": 1,
    "replicaTimeout": 480,
    "replicaRetryLimit": 0,
    "writeBack": "on",
    "maxChanged": "25",
    "maxDeletes": "3",
}


class VaultMirrorProbeTests(unittest.TestCase):
    def test_job_summary_verifies_schedule_image_and_nonsecret_settings(self):
        result = job_summary(JOB, EXPECTED)
        self.assertEqual(result["cronExpression"], "*/10 * * * *")
        self.assertEqual(result["writeBack"], "on")
        broken = json.loads(json.dumps(JOB))
        broken["properties"]["configuration"]["scheduleTriggerConfig"]["cronExpression"] = "*/20 * * * *"
        with self.assertRaisesRegex(RuntimeError, "configuration_mismatch"):
            job_summary(broken, EXPECTED)
        broken = json.loads(json.dumps(JOB))
        broken["identity"]["userAssignedIdentities"] = {}
        with self.assertRaisesRegex(RuntimeError, "identity_configuration"):
            job_summary(broken, EXPECTED)

    def test_latest_execution_uses_only_fresh_runs(self):
        executions = [
            {"name": "old", "properties": {"startTime": "2026-11-19T01:30:00Z"}},
            {"name": "new", "properties": {"startTime": "2026-11-19T01:58:00Z"}},
        ]
        self.assertEqual(latest_execution(executions, NOW, 600)["name"], "new")
        self.assertIsNone(latest_execution(executions[:1], NOW, 600))

    def test_runner_log_parser_keeps_only_bounded_summary(self):
        output = (
            "2026-11-19T02:00:00Z starting\n"
            '{"runId":"private","outcome":"needs-attention","reason":"conflict","guardReasons":["max-changed-G"],'
            '"durationMs":1200,"approved":4,"pushed":0,"writtenBack":0,"deleted":0,"conflicts":1,'
            '"skipped":0,"credentialMatches":0,"pendingWriteBack":1,"changedOnGitHub":26}'
        )
        parsed = parse_runner_log(output)
        self.assertEqual(parsed["outcome"], "needs-attention")
        self.assertEqual(parsed["reason"], "conflict")
        self.assertNotIn("runId", parsed)
        self.assertEqual(parsed["guardReasons"], ["max-changed-G"])
        self.assertEqual(parsed["changedOnGitHub"], 26)
        unsafe = parse_runner_log('{"outcome":"failed","reason":"private detail","approved":"secret"}')
        self.assertEqual(unsafe, {"outcome": "failed", "reason": None})

    def test_probe_distinguishes_attention_from_runner_failure(self):
        execution = {
            "name": "run-1",
            "properties": {
                "status": "Failed",
                "startTime": "2026-11-19T01:58:00Z",
                "endTime": "2026-11-19T01:58:10Z",
            },
        }
        attention = (
            '{"outcome":"needs-attention","reason":"conflict","durationMs":1,'
            '"conflicts":1}'
        )
        with (
            patch("vault_mirror_probe.az", side_effect=[JOB, {"clientId": "client-fixture"}, [execution]]),
            patch("vault_mirror_probe.read_logs", return_value=attention),
        ):
            self.assertEqual(probe("sub", "group", "on", 25, 3, 600, 0, now=NOW)["verdict"], "attention")
        failed = '{"outcome":"failed","reason":"auth","durationMs":1}'
        with (
            patch("vault_mirror_probe.az", side_effect=[JOB, {"clientId": "client-fixture"}, [execution]]),
            patch("vault_mirror_probe.read_logs", return_value=failed),
            self.assertRaisesRegex(RuntimeError, "run_failed:auth"),
        ):
            probe("sub", "group", "on", 25, 3, 600, 0, now=NOW)
        guarded = (
            '{"outcome":"needs-attention","reason":"guard-tripped","durationMs":1,'
            '"guardReasons":["max-changed-G"],"changedOnGitHub":26}'
        )
        with (
            patch("vault_mirror_probe.az", side_effect=[JOB, {"clientId": "client-fixture"}, [execution]]),
            patch("vault_mirror_probe.read_logs", return_value=guarded),
            self.assertRaisesRegex(RuntimeError, 'guard_tripped:.*changedOnGitHub.*26.*max-changed-G'),
        ):
            probe("sub", "group", "on", 25, 3, 600, 0, now=NOW)


if __name__ == "__main__":
    unittest.main()
