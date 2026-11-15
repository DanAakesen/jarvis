import json
import unittest

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

    def test_verify_rejects_a_readback_with_builtins_enabled(self):
        readback = {"definition": self.definition()}
        pi.verify(readback, self.spec, self.instructions)
        readback["definition"]["tools"][0]["default_config"]["enabled"] = True
        with self.assertRaises(pi.Blocked):
            pi.verify(readback, self.spec, self.instructions)


class SmokeReportTest(unittest.TestCase):
    def turn(self, first, cached=0):
        return {"firstTextMs": first, "lastTextMs": first + 500, "totalMs": first + 800, "deltas": 9, "toolCalls": 0, "characters": 40,
                "text": "ok", "usage": {"inputTokens": 11000, "cachedTokens": cached, "outputTokens": 20}, "costDkk": 0.0731, "aborted": False}

    def test_render_shows_bars_tokens_cost_and_each_check(self):
        data = {"cold": self.turn(4000), "warm": [self.turn(1900, 10000), self.turn(1800, 10000)],
                "tools": dict(self.turn(2500), toolCalls=2, text="worked"),
                "cancel": {"abortToCloseMs": 120, "partialCharacters": 31, "followUpOk": True}, "totalCostDkk": 0.4,
                "checks": {"streaming": True, "tools_over_mcp": True, "cancellation": True, "warm_faster_than_cold": False}}
        text = report.render(data)
        self.assertIn("cold, new conversation", text)
        self.assertIn("4.0 s", text)
        self.assertIn("| warm turn 2 | 1900 ms |", text)
        self.assertIn("**FAIL**", text)
        self.assertEqual(text.count("| pass |"), 3)


if __name__ == "__main__":
    unittest.main()
