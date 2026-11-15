import argparse
import json
import unittest
from unittest import mock

from hermetic import setUpModule  # noqa: F401
import provision_pi_agent as pi
import pi_smoke_report as report


class DefinitionTest(unittest.TestCase):
    def setUp(self):
        self.spec = pi.load_spec()
        self.instructions = pi.instructions_text()
        self.skills = [pi.parse_skill(name) for name in self.spec["skills"]]
        for skill in self.skills:
            skill["version"] = "1"

    def definition(self, secret="S" * 43):
        return pi.build_definition(self.spec, self.instructions, "https://backend.example/pi/mcp", secret, self.skills)

    def test_reasoning_effort_is_in_the_definition_and_builtins_are_off(self):
        definition = self.definition()
        self.assertEqual(definition["reasoning"], {"effort": "low"})
        self.assertEqual(definition["harness"], {"type": "microsoft_copilot_preview"})
        toolset = [tool for tool in definition["tools"] if tool["type"] == "microsoft_copilot_toolset_preview"]
        self.assertEqual(toolset, [{"type": "microsoft_copilot_toolset_preview", "default_config": {"enabled": False}}])

    def test_jarvis_tools_arrive_only_over_mcp_without_harness_approval(self):
        mcp = [tool for tool in self.definition()["tools"] if tool["type"] == "mcp"]
        self.assertEqual(len(mcp), 1)
        self.assertEqual(mcp[0]["require_approval"], "never")
        self.assertEqual(mcp[0]["server_url"], "https://backend.example/pi/mcp")
        self.assertEqual(mcp[0]["headers"], {"Authorization": "Bearer jp." + "S" * 43})
        self.assertFalse([tool for tool in self.definition()["tools"] if tool["type"] == "function"])

    def test_persona_carries_the_identity_contract_and_leaves_no_placeholder(self):
        contract = json.loads((pi.ROOT / "agents" / "jarvis" / "identity-contract.json").read_text(encoding="utf-8"))
        self.assertIn(contract["fixedKernel"]["en"], self.instructions)
        self.assertIn(contract["productIdentity"]["en"], self.instructions)
        self.assertNotIn("{{", self.instructions)

    def test_skills_are_repository_files_pinned_by_version(self):
        self.assertEqual([skill["name"] for skill in self.skills], ["jarvis-inbox-triage"])
        self.assertEqual(self.definition()["skills"], [{"type": "skill_reference", "name": "jarvis-inbox-triage", "version": "1"}])

    def test_fingerprint_changes_with_instructions_secret_and_skill_content_only(self):
        base = pi.fingerprint(self.spec, self.instructions, "https://b/pi/mcp", "a" * 43, self.skills)
        self.assertEqual(base, pi.fingerprint(self.spec, self.instructions, "https://b/pi/mcp", "a" * 43, self.skills))
        self.assertNotEqual(base, pi.fingerprint(self.spec, self.instructions + "x", "https://b/pi/mcp", "a" * 43, self.skills))
        self.assertNotEqual(base, pi.fingerprint(self.spec, self.instructions, "https://b/pi/mcp", "b" * 43, self.skills))
        changed = [dict(self.skills[0], sha256="0" * 64)]
        self.assertNotEqual(base, pi.fingerprint(self.spec, self.instructions, "https://b/pi/mcp", "a" * 43, changed))

    def test_secret_is_recovered_from_the_agent_definition_after_an_infrastructure_deploy(self):
        self.assertEqual(pi.recover_secret(self.definition("R" * 43)), "R" * 43)
        self.assertIsNone(pi.recover_secret({"tools": [{"type": "mcp", "headers": {"Authorization": "Bearer ***"}}]}))
        self.assertIsNone(pi.recover_secret({}))

    def test_agent_is_created_versions_first_with_no_separate_agent_post(self):
        calls = []

        class Fake(pi.Az):
            def __init__(self):
                super().__init__("https://p.example/api/projects/x")

            def rest(self, method, path, body=None, *, content_type="application/json"):
                calls.append((method, path))
                if method == "GET" and path == "/agents/jarvis-pi":
                    raise pi.Blocked("foundry_get_failed:/agents/jarvis-pi:not_found [code=NotFound]")
                if method == "POST" and path.startswith("/skills/"):
                    return {"version": 1}
                if method == "POST":
                    return {"version": 3}
                if method == "GET":
                    return {"status": "active", "definition": pi.build_definition(
                        spec, instructions, "https://b/pi/mcp", "S" * 43, [dict(s, version="1") for s in skills])}
                return {}

        spec, instructions, skills = self.spec, self.instructions, self.skills
        azure = Fake()
        self.assertIsNone(pi.current_state(azure, "jarvis-pi"))
        pi.ensure_skills(azure, skills, False, {})
        self.assertEqual(skills[0]["version"], "1")
        self.assertEqual(pi.as_version(3), "3")
        self.assertEqual(pi.as_version("4"), "4")
        self.assertNotIn(("POST", "/agents"), calls)

    def test_provision_first_run_posts_only_versions_then_pins(self):
        calls = []
        spec, instructions = self.spec, self.instructions
        stored = {}

        class Fake(pi.Az):
            def rest(self, method, path, body=None, *, content_type="application/json"):
                calls.append((method, path))
                if method == "GET" and path == "/agents/jarvis-pi":
                    raise pi.Blocked("foundry_get_failed:/agents/jarvis-pi:not_found [code=NotFound]")
                if method == "POST" and path.startswith("/skills/"):
                    return {"version": 1}
                if method == "POST" and path == "/agents/jarvis-pi/versions":
                    stored["definition"] = body["definition"]
                    return {"version": 1}
                if method == "GET" and path == "/agents/jarvis-pi/versions/1":
                    return {"status": "active", "definition": stored["definition"]}
                return {}

        args = argparse.Namespace(project_endpoint="https://p.example/api/projects/x", backend_fqdn="b.example",
                                  backend_app="app", resource_group="rg", subscription="sub")
        with mock.patch.object(pi, "Az", Fake), mock.patch.object(pi, "configure_backend", return_value="S" * 43):
            result = pi.provision(args)
        self.assertEqual(result["version"], "1")
        self.assertTrue(result["created"])
        self.assertNotIn(("POST", "/agents"), calls)
        self.assertIn(("POST", "/agents/jarvis-pi/versions"), calls)
        self.assertEqual(calls[-1], ("PATCH", "/agents/jarvis-pi"))

    def test_agent_and_skill_calls_use_the_documented_feature_headers(self):
        self.assertEqual(pi.SKILL_FEATURES, "Skills=V1Preview")
        self.assertIn("MicrosoftCopilot=V1Preview", pi.AGENT_FEATURES)

    def test_verify_rejects_a_readback_with_builtins_enabled(self):
        readback = {"definition": self.definition()}
        pi.verify(readback, self.spec, self.instructions)
        readback["definition"]["tools"][0]["default_config"]["enabled"] = True
        with self.assertRaises(pi.Blocked):
            pi.verify(readback, self.spec, self.instructions)


class ErrorReportTest(unittest.TestCase):
    secret = "Q" * 43

    def setUp(self):
        pi.REDACT[:] = [self.secret]

    def tearDown(self):
        pi.REDACT.clear()

    def test_shows_foundry_code_param_and_message(self):
        stderr = (b'ERROR: Bad Request({"error":{"code":"invalid_payload","param":"definition.skills[0].version",'
                  b'"type":"invalid_request_error","message":"Unknown field skills version."}})')
        text = pi.describe_error(stderr)
        self.assertIn("code=invalid_payload", text)
        self.assertIn("param=definition.skills[0].version", text)
        self.assertIn("message=Unknown field skills version.", text)

    def test_never_prints_credentials_ids_urls_or_echoed_payloads(self):
        message = ("Bad header Bearer jp." + self.secret + " for 802efa29-17f2-4a79-8f5f-38f087aed96a at https://x.example/pi/mcp "
                   "token eyJhbGciOi.eyJzdWIiOiIxIn0.sig and the key " + self.secret + " and 'I am Jarvis and this is a very long quoted instruction text that was echoed back'")
        stderr = ('ERROR: Bad Request({"error":{"code":"invalid","message":' + json.dumps(message) + '}})').encode()
        text = pi.describe_error(stderr)
        for leaked in (self.secret, "802efa29", "x.example", "eyJhbGci", "very long quoted"):
            self.assertNotIn(leaked, text)
        self.assertIn("code=invalid", text)

    def test_blocked_message_carries_the_detail_and_still_classifies(self):
        self.assertEqual(pi.classify(b"ERROR: Not Found(...)"), "not_found")
        self.assertEqual(pi.describe_error(b"ERROR: timeout"), "")
        self.assertIn(":not_found", "foundry_get_failed:/agents/x:not_found [code=NotFound]")


class SmokeReportTest(unittest.TestCase):
    def turn(self, first, cached=0):
        return {"firstTextMs": first, "lastTextMs": first + 500, "totalMs": first + 800, "deltas": 9, "toolCalls": 0, "characters": 40,
                "text": "ok", "usage": {"inputTokens": 11000, "cachedTokens": cached, "outputTokens": 20}, "costDkk": 0.0731, "aborted": False}

    def test_render_shows_bars_tokens_cost_and_each_check(self):
        data = {"cold": self.turn(4000), "warm": [self.turn(1900, 10000), self.turn(1800, 10000)],
                "tools": dict(self.turn(2500), toolCalls=2, text="worked", toolResults=[{"tool": "list_jobs", "outcome": "ok"}]),
                "cancel": {"abortToCloseMs": 120, "partialCharacters": 31, "followUpOk": True}, "totalCostDkk": 0.4,
                "checks": {"streaming": True, "tools_over_mcp": True, "cancellation": True, "warm_faster_than_cold": False}}
        text = report.render(data)
        self.assertIn("cold, new conversation", text)
        self.assertIn("4.0 s", text)
        self.assertIn("| warm turn 2 | 1900 ms |", text)
        self.assertIn("list_jobs=ok", text)
        self.assertIn("**FAIL**", text)
        self.assertEqual(text.count("| pass |"), 3)


if __name__ == "__main__":
    unittest.main()
