import json
import unittest

from deploy_smoke import admin_ready, endpoint, runtime_ready, wait


class DeploySmokeTests(unittest.TestCase):
    def test_admin_requires_both_bicep_connections(self):
        body = json.dumps({"value": [{"name": "container-registry"}, {"name": "application-insights"}]})
        self.assertTrue(admin_ready(200, body))
        with self.assertRaisesRegex(RuntimeError, "application-insights"):
            admin_ready(200, json.dumps({"value": [{"name": "container-registry"}]}))

    def test_admin_retries_transient_and_fails_otherwise(self):
        for status in (401, 403, 404, 429, 503):
            self.assertFalse(admin_ready(status, ""))
        with self.assertRaises(RuntimeError):
            admin_ready(400, "")

    def test_runtime_waits_while_project_is_unknown(self):
        self.assertFalse(runtime_ready(404, '{"error":{"message":"Project not found"}}'))
        self.assertTrue(runtime_ready(404, '{"error":{"message":"Agent jarvis-deploy-smoke not found"}}'))
        self.assertTrue(runtime_ready(200, "{}"))
        self.assertFalse(runtime_ready(403, ""))
        with self.assertRaises(RuntimeError):
            runtime_ready(400, "")

    def test_wait_times_out_visibly(self):
        now = [0.0]
        responses = iter([(404, "Project not found"), (503, ""), (200, "{}")])
        calls = []
        wait("host", runtime_ready, lambda: calls.append(1) or next(responses), 100, clock=lambda: now[0],
             sleep=lambda seconds: now.__setitem__(0, now[0] + seconds))
        self.assertEqual(len(calls), 3)
        now[0] = 0.0
        with self.assertRaisesRegex(RuntimeError, "not ready"):
            wait("host", runtime_ready, lambda: (503, ""), 30, interval=15, clock=lambda: now[0],
                 sleep=lambda seconds: now.__setitem__(0, now[0] + seconds))

    def test_endpoint_must_use_the_expected_https_host(self):
        good = {"x": {"value": "https://a.services.ai.azure.com/api/projects/p"}}
        self.assertEqual(endpoint(good, "x", ".services.ai.azure.com"), "https://a.services.ai.azure.com/api/projects/p")
        with self.assertRaises(ValueError):
            endpoint(good, "x", ".cognitiveservices.azure.com")
        with self.assertRaises(ValueError):
            endpoint({"x": {"value": "http://a.services.ai.azure.com/p"}}, "x", ".services.ai.azure.com")


if __name__ == "__main__":
    unittest.main()
