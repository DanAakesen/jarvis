import json
import unittest
from datetime import UTC, datetime, timedelta
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
        self.assertIsNone(latest_execution(executions, NOW, 600, NOW - timedelta(seconds=30)))

    def test_runner_log_parser_keeps_only_bounded_summary(self):
        output = (
            "2026-11-19T02:00:00Z starting\n"
            '{"runId":"private","outcome":"needs-attention","reason":"conflict","guardReasons":["max-changed-G"],'
            '"durationMs":1200,"approved":4,"pushed":0,"writtenBack":0,"deleted":0,"conflicts":1,'
            '"skipped":0,"credentialMatches":0,"pendingWriteBack":1,"changedOnGitHub":26,'
            '"deferredOnGitHub":1}'
        )
        parsed = parse_runner_log(output)
        self.assertEqual(parsed["outcome"], "needs-attention")
        self.assertEqual(parsed["reason"], "conflict")
        self.assertNotIn("runId", parsed)
        self.assertEqual(parsed["guardReasons"], ["max-changed-G"])
        self.assertEqual(parsed["changedOnGitHub"], 26)
        self.assertEqual(parsed["deferredOnGitHub"], 1)
        unsafe = parse_runner_log('{"outcome":"failed","reason":"private detail","approved":"secret"}')
        self.assertEqual(unsafe, {"outcome": "failed", "reason": None})

    def test_probe_distinguishes_attention_from_runner_failure(self):
        execution = {
            "name": "run-1",
            "properties": {
                "status": "Failed",
                "startTime": "2026-11-19T02:00:00Z",
                "endTime": "2026-11-19T02:00:10Z",
                "template": {"containers": [{"image": JOB["properties"]["template"]["containers"][0]["image"]}]},
            },
        }
        attention = (
            '{"outcome":"needs-attention","reason":"conflict","durationMs":1,'
            '"conflicts":1}'
        )
        with (
            patch(
                "vault_mirror_probe.az",
                side_effect=[JOB, {"clientId": "client-fixture"}, [execution], execution],
            ),
            patch("vault_mirror_probe.read_logs", return_value=attention),
        ):
            self.assertEqual(probe("sub", "group", "on", 25, 3, 600, 0, clock=lambda: NOW)["verdict"], "attention")
        healthy = (
            '{"outcome":"ok","durationMs":1,"changedOnGitHub":26,'
            '"deferredOnGitHub":1}'
        )
        with (
            patch(
                "vault_mirror_probe.az",
                side_effect=[JOB, {"clientId": "client-fixture"}, [execution], execution],
            ),
            patch("vault_mirror_probe.read_logs", return_value=healthy),
        ):
            self.assertEqual(probe("sub", "group", "on", 25, 3, 600, 0, clock=lambda: NOW)["verdict"], "healthy")
        failed = '{"outcome":"failed","reason":"auth","durationMs":1}'
        with (
            patch(
                "vault_mirror_probe.az",
                side_effect=[JOB, {"clientId": "client-fixture"}, [execution], execution],
            ),
            patch("vault_mirror_probe.read_logs", return_value=failed),
            self.assertRaisesRegex(RuntimeError, "run_failed:auth"),
        ):
            probe("sub", "group", "on", 25, 3, 600, 0, clock=lambda: NOW)
        unsafe = '{"outcome":"needs-attention","reason":"state-corrupt","durationMs":1}'
        with (
            patch(
                "vault_mirror_probe.az",
                side_effect=[JOB, {"clientId": "client-fixture"}, [execution], execution],
            ),
            patch("vault_mirror_probe.read_logs", return_value=unsafe),
            self.assertRaisesRegex(RuntimeError, "needs_attention:state-corrupt"),
        ):
            probe("sub", "group", "on", 25, 3, 600, 0, clock=lambda: NOW)
        guarded = (
            '{"outcome":"needs-attention","reason":"guard-tripped","durationMs":1,'
            '"guardReasons":["max-changed-G"],"changedOnGitHub":26}'
        )
        with (
            patch(
                "vault_mirror_probe.az",
                side_effect=[JOB, {"clientId": "client-fixture"}, [execution], execution],
            ),
            patch("vault_mirror_probe.read_logs", return_value=guarded),
            self.assertRaisesRegex(RuntimeError, 'guard_tripped:.*changedOnGitHub.*26.*max-changed-G'),
        ):
            probe("sub", "group", "on", 25, 3, 600, 0, clock=lambda: NOW)
        wrong_image = json.loads(json.dumps(execution))
        wrong_image["properties"]["template"]["containers"][0]["image"] = "fixture.azurecr.io/old@sha256:" + "b" * 64
        with (
            patch(
                "vault_mirror_probe.az",
                side_effect=[JOB, {"clientId": "client-fixture"}, [execution], wrong_image],
            ),
            self.assertRaisesRegex(RuntimeError, "execution_image_mismatch"),
        ):
            probe("sub", "group", "on", 25, 3, 600, 0, clock=lambda: NOW)
        with (
            patch(
                "vault_mirror_probe.az",
                side_effect=[JOB, {"clientId": "client-fixture"}, [execution], execution],
            ),
            patch(
                "vault_mirror_probe.read_logs",
                return_value='{"outcome":"skipped-busy","durationMs":1}',
            ),
            self.assertRaisesRegex(RuntimeError, "execution_skipped_busy"),
        ):
            probe("sub", "group", "on", 25, 3, 600, 0, clock=lambda: NOW)

    def test_poll_recomputes_time_for_an_execution_that_starts_during_the_wait(self):
        future = {
            "name": "run-2",
            "properties": {
                "status": "Succeeded",
                "startTime": (NOW + timedelta(minutes=2)).isoformat(),
                "endTime": (NOW + timedelta(minutes=2, seconds=10)).isoformat(),
                "template": {"containers": [{"image": JOB["properties"]["template"]["containers"][0]["image"]}]},
            },
        }
        times = iter([NOW, NOW + timedelta(minutes=2, seconds=1)])
        final_time = NOW + timedelta(minutes=2, seconds=1)
        with (
            patch(
                "vault_mirror_probe.az",
                side_effect=[JOB, {"clientId": "client-fixture"}, [], [future], future],
            ),
            patch(
                "vault_mirror_probe.read_logs",
                return_value='{"outcome":"ok-noop","durationMs":1}',
            ),
        ):
            result = probe(
                "sub", "group", "on", 25, 3, 600, 1200,
                clock=lambda: next(times, final_time), sleep=lambda _seconds: None,
            )
        self.assertEqual(result["execution"]["name"], "run-2")

    def test_wait_budget_covers_the_next_schedule_execution_and_log_read(self):
        with self.assertRaisesRegex(RuntimeError, "wait_seconds_too_short"):
            probe("sub", "group", "on", 25, 3, 1200, 720)

        running = {
            "name": "run-boundary",
            "properties": {
                "status": "Running",
                "startTime": (NOW + timedelta(seconds=600)).isoformat(),
                "template": {"containers": [{"image": JOB["properties"]["template"]["containers"][0]["image"]}]},
            },
        }
        completed = {
            "name": "run-boundary",
            "properties": {
                "status": "Succeeded",
                "startTime": (NOW + timedelta(seconds=600)).isoformat(),
                "endTime": (NOW + timedelta(seconds=1080)).isoformat(),
                "template": {"containers": [{"image": JOB["properties"]["template"]["containers"][0]["image"]}]},
            },
        }
        times = iter([NOW, NOW + timedelta(seconds=720), NOW + timedelta(seconds=1080)])
        with (
            patch(
                "vault_mirror_probe.az",
                side_effect=[JOB, {"clientId": "client-fixture"}, [running], [completed], completed],
            ),
            patch(
                "vault_mirror_probe.read_logs",
                return_value='{"outcome":"ok","durationMs":480000}',
            ),
            patch("vault_mirror_probe.time.monotonic", side_effect=[0, 720]),
        ):
            result = probe(
                "sub", "group", "on", 25, 3, 1200, 1200,
                clock=lambda: next(times), sleep=lambda _seconds: None,
            )
        self.assertEqual(result["execution"]["name"], "run-boundary")
        self.assertEqual(result["verdict"], "healthy")


if __name__ == "__main__":
    unittest.main()
