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

    def definition(self):
        return pi.build_definition(self.spec, self.instructions, "https://backend.example/pi/mcp", self.skills)

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
        # Foundry refuses credentials in an MCP tool's headers: the secret lives in a project connection.
        self.assertNotIn("headers", mcp[0])
        self.assertEqual(mcp[0]["project_connection_id"], "jarvis-pi-mcp")
        self.assertFalse([tool for tool in self.definition()["tools"] if tool["type"] == "function"])

    def test_persona_carries_the_identity_contract_and_leaves_no_placeholder(self):
        contract = json.loads((pi.ROOT / "agents" / "jarvis" / "identity-contract.json").read_text(encoding="utf-8"))
        self.assertIn(contract["fixedKernel"]["en"], self.instructions)
        self.assertIn(contract["productIdentity"]["en"], self.instructions)
        self.assertNotIn("{{", self.instructions)

    def test_skills_are_repository_files_pinned_by_version(self):
        self.assertEqual([skill["name"] for skill in self.skills], ["jarvis-inbox-triage", "jarvis-workers", "jarvis-brain", "jarvis-watches"])
        self.assertEqual(self.definition()["skills"], [
            {"type": "skill_reference", "name": "jarvis-inbox-triage", "version": "1"},
            {"type": "skill_reference", "name": "jarvis-workers", "version": "1"},
            {"type": "skill_reference", "name": "jarvis-brain", "version": "1"},
            {"type": "skill_reference", "name": "jarvis-watches", "version": "1"}])

    def test_fingerprint_changes_with_instructions_url_and_skill_content_only(self):
        base = pi.fingerprint(self.spec, self.instructions, "https://b/pi/mcp", self.skills)
        self.assertEqual(base, pi.fingerprint(self.spec, self.instructions, "https://b/pi/mcp", self.skills))
        self.assertNotEqual(base, pi.fingerprint(self.spec, self.instructions + "x", "https://b/pi/mcp", self.skills))
        self.assertNotEqual(base, pi.fingerprint(self.spec, self.instructions, "https://c/pi/mcp", self.skills))
        changed = [dict(self.skills[0], sha256="0" * 64)]
        self.assertNotEqual(base, pi.fingerprint(self.spec, self.instructions, "https://b/pi/mcp", changed))

    def test_connection_is_created_with_the_secret_in_an_injected_header_and_never_returned_in_output(self):
        calls = []
        project = "/subscriptions/s/resourceGroups/rg/providers/Microsoft.CognitiveServices/accounts/a/projects/p"
        stored = {}

        def fake(method, path, body=None):
            calls.append((method, path))
            if method == "GET":
                if not stored:
                    raise pi.Blocked("arm_get_failed:jarvis-pi-mcp:not_found [code=ResourceNotFound]")
                return stored
            stored.update(body)
            return {}

        with mock.patch.object(pi, "arm_request", fake):
            self.assertTrue(pi.ensure_connection(project, self.spec, "https://b/pi/mcp", "S" * 43))
            put = stored["properties"]
            self.assertEqual(put["credentials"], {"keys": {"Authorization": "Bearer jp." + "S" * 43}})
            self.assertEqual(put["target"], "https://b/pi/mcp")
            self.assertNotIn("S" * 43, json.dumps(put["metadata"]))
            # Unchanged secret and target: nothing is written again.
            self.assertFalse(pi.ensure_connection(project, self.spec, "https://b/pi/mcp", "S" * 43))
            # A rotated secret (for example after an infrastructure deploy) updates the same connection.
            self.assertTrue(pi.ensure_connection(project, self.spec, "https://b/pi/mcp", "T" * 43))
        self.assertEqual([m for m, _ in calls], ["GET", "PUT", "GET", "GET", "PUT"])
        self.assertTrue(all(path == project + "/connections/jarvis-pi-mcp" for _, path in calls))

    def test_a_real_arm_failure_other_than_not_found_is_not_swallowed(self):
        def fake(method, path, body=None):
            raise pi.Blocked("arm_get_failed:jarvis-pi-mcp:forbidden [code=AuthorizationFailed]")
        with mock.patch.object(pi, "arm_request", fake), self.assertRaises(pi.Blocked):
            pi.ensure_connection("/p", self.spec, "https://b/pi/mcp", "S" * 43)

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
                                  foundry_account="acct", foundry_project="proj",
                                  backend_app="app", resource_group="rg", subscription="sub")
        arm = []

        def fake_arm(method, path, body=None):
            arm.append((method, path))
            if method == "GET":
                raise pi.Blocked("arm_get_failed:jarvis-pi-mcp:not_found")
            return {}

        with mock.patch.object(pi, "Az", Fake), mock.patch.object(pi, "configure_backend", return_value="S" * 43), \
                mock.patch.object(pi, "arm_request", fake_arm):
            result = pi.provision(args)
        self.assertEqual([m for m, _ in arm], ["GET", "PUT"])
        self.assertTrue(arm[1][1].endswith("/accounts/acct/projects/proj/connections/jarvis-pi-mcp"))
        self.assertTrue(result["connectionWritten"])
        self.assertEqual(result["connection"], "jarvis-pi-mcp")
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
        with_headers = json.loads(json.dumps(readback))
        with_headers["definition"]["tools"][1]["headers"] = {"Authorization": "x"}
        with self.assertRaises(pi.Blocked):
            pi.verify(with_headers, self.spec, self.instructions)
        readback["definition"]["tools"][0]["default_config"]["enabled"] = True
        with self.assertRaises(pi.Blocked):
            pi.verify(readback, self.spec, self.instructions)


class ReachTest(unittest.TestCase):
    token = "github_pat_" + "A" * 60
    project = "/subscriptions/s/resourceGroups/rg/providers/Microsoft.CognitiveServices/accounts/a/projects/p"

    def setUp(self):
        self.spec = pi.load_spec()
        self.args = argparse.Namespace(azure_mcp_url="https://azure-mcp.example", azure_mcp_client_id="11111111-2222-3333-4444-555555555555")

    def tearDown(self):
        pi.REDACT.clear()

    def test_missing_inputs_leave_a_server_out_and_say_who_must_provide_what(self):
        with mock.patch.dict("os.environ", {}, clear=True):
            attached, status = pi.resolve_reach(self.spec, argparse.Namespace(azure_mcp_url="", azure_mcp_client_id=""))
        self.assertEqual(attached, [])
        self.assertIn("PI_GITHUB_READ_TOKEN", status["github"])
        self.assertIn("JARVIS_AZURE_MCP_CLIENT_ID", status["azure"])

    def test_only_a_fine_grained_github_token_is_accepted_and_it_is_redacted(self):
        with mock.patch.dict("os.environ", {"PI_GITHUB_READ_TOKEN": "ghp_" + "A" * 36}, clear=True), self.assertRaises(pi.Blocked):
            pi.resolve_reach(self.spec, self.args)
        with mock.patch.dict("os.environ", {"PI_GITHUB_READ_TOKEN": self.token}, clear=True):
            attached, _ = pi.resolve_reach(self.spec, self.args)
        self.assertEqual([server["serverLabel"] for server in attached], ["github", "azure"])
        self.assertIn(self.token, pi.REDACT)

    def test_reach_tools_are_read_only_servers_behind_connections_with_no_headers(self):
        with mock.patch.dict("os.environ", {"PI_GITHUB_READ_TOKEN": self.token}, clear=True):
            attached, _ = pi.resolve_reach(self.spec, self.args)
        instructions = pi.instructions_text()
        skills = [dict(pi.parse_skill(name), version="1") for name in self.spec["skills"]]
        definition = pi.build_definition(self.spec, instructions, "https://b/pi/mcp", skills, attached)
        tools = {tool["server_label"]: tool for tool in definition["tools"] if tool["type"] == "mcp"}
        self.assertEqual(set(tools), {"jarvis", "github", "azure"})
        self.assertEqual(tools["github"]["server_url"], "https://api.githubcopilot.com/mcp/readonly")
        self.assertEqual(tools["github"]["project_connection_id"], "jarvis-pi-github")
        self.assertEqual(tools["azure"]["server_url"], "https://azure-mcp.example")
        for tool in tools.values():
            self.assertEqual(tool["require_approval"], "never")
            self.assertNotIn("headers", tool)
        self.assertNotIn(self.token, json.dumps(definition))
        pi.verify({"definition": definition}, self.spec, instructions, attached)
        with self.assertRaises(pi.Blocked):
            pi.verify({"definition": definition}, self.spec, instructions, attached[:1])
        base = pi.fingerprint(self.spec, instructions, "https://b/pi/mcp", skills)
        self.assertNotEqual(base, pi.fingerprint(self.spec, instructions, "https://b/pi/mcp", skills, attached))

    def test_connections_hold_the_github_token_and_the_azure_audience_but_never_both_in_metadata(self):
        stored = {}

        def fake(method, path, body=None):
            if method == "GET":
                raise pi.Blocked("arm_get_failed:x:not_found")
            stored[path.rsplit("/", 1)[-1]] = body["properties"]
            return {}

        with mock.patch.dict("os.environ", {"PI_GITHUB_READ_TOKEN": self.token}, clear=True), mock.patch.object(pi, "arm_request", fake):
            attached, _ = pi.resolve_reach(self.spec, self.args)
            for server in attached:
                self.assertTrue(pi.connect_reach(self.project, server))
        github, azure = stored["jarvis-pi-github"], stored["jarvis-pi-azure"]
        self.assertEqual(github["credentials"], {"keys": {"Authorization": "Bearer " + self.token}})
        self.assertNotIn(self.token, json.dumps(github["metadata"]))
        self.assertEqual((azure["authType"], azure["audience"]), ("ProjectManagedIdentity", "api://11111111-2222-3333-4444-555555555555"))
        self.assertNotIn("credentials", azure)

    def test_a_connection_that_cannot_be_written_is_left_out_and_fails_the_job_after_the_agent_is_defined(self):
        calls = []
        stored = {}

        class Fake(pi.Az):
            def rest(self, method, path, body=None, *, content_type="application/json"):
                calls.append((method, path))
                if method == "GET" and path == "/agents/jarvis-pi":
                    raise pi.Blocked("foundry_get_failed:/agents/jarvis-pi:not_found")
                if method == "POST" and path.startswith("/skills/"):
                    return {"version": 1}
                if method == "POST" and path == "/agents/jarvis-pi/versions":
                    stored["definition"] = body["definition"]
                    return {"version": 1}
                if method == "GET" and path == "/agents/jarvis-pi/versions/1":
                    return {"status": "active", "definition": stored["definition"]}
                return {}

        def fake_arm(method, path, body=None):
            if method == "GET":
                raise pi.Blocked("arm_get_failed:x:not_found")
            if path.endswith("jarvis-pi-azure"):
                raise pi.Blocked("arm_put_failed:jarvis-pi-azure:bad_request")
            return {}

        args = argparse.Namespace(project_endpoint="https://p.example/api/projects/x", backend_fqdn="b.example", foundry_account="acct",
                                  foundry_project="proj", backend_app="app", resource_group="rg", subscription="sub",
                                  azure_mcp_url="https://azure-mcp.example", azure_mcp_client_id="11111111-2222-3333-4444-555555555555",
                                  output=None)
        with mock.patch.dict("os.environ", {"PI_GITHUB_READ_TOKEN": self.token}, clear=True), mock.patch.object(pi, "Az", Fake), \
                mock.patch.object(pi, "configure_backend", return_value="S" * 43), mock.patch.object(pi, "arm_request", fake_arm):
            result = pi.provision(args)
        labels = [tool["server_label"] for tool in stored["definition"]["tools"] if tool["type"] == "mcp"]
        self.assertEqual(labels, ["jarvis", "github"])
        self.assertEqual(result["reach"]["github"], "attached")
        self.assertIn("not attached", result["reach"]["azure"])
        self.assertEqual(len(result["problems"]), 1)
        self.assertTrue(result["created"])


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
        self.assertIn("MCP servers the harness listed tools for: none reported.", text)

    def test_render_shows_listed_servers_reach_turns_and_only_their_checks(self):
        data = {"cold": self.turn(4000), "warm": [self.turn(1900, 10000)],
                "tools": dict(self.turn(2500), toolResults=[{"tool": "list_jobs", "outcome": "ok"}]),
                "listed": [{"server": "github", "tools": 41, "failed": False}, {"server": "azure", "tools": 0, "failed": True}],
                "reach": [{"server": "github", "turn": dict(self.turn(3000), text="Issue 700", reachCalls=[{"server": "github", "name": "get_issue", "failed": False}])}],
                "cancel": {"abortToCloseMs": 120, "partialCharacters": 31, "followUpOk": True}, "totalCostDkk": 0.4,
                "checks": {"streaming": True, "tools_over_mcp": True, "cancellation": True, "warm_faster_than_cold": True, "reach_github": False, "mcp_listing": False}}
        text = report.render(data)
        self.assertIn("github: 41 tools, azure: FAILED to list", text)
        self.assertIn("| reach: github | 3000 ms |", text)
        self.assertIn("get_issue=ok", text)
        self.assertIn("read-only GitHub server answered a read and the harness reported no error | **FAIL**", text)
        self.assertNotIn("Azure server answered", text)
        self.assertIn("every MCP server the harness reported returned its tools | **FAIL**", text)
    def test_render_shows_voice_turns_and_their_checks_only_when_present(self):
        base = {"cold": self.turn(4000), "warm": [self.turn(1900, 10000)],
                "tools": dict(self.turn(2500), toolResults=[{"tool": "list_jobs", "outcome": "ok"}]),
                "cancel": {"abortToCloseMs": 120, "partialCharacters": 31, "followUpOk": True}, "totalCostDkk": 0.4}
        checks = {"streaming": True, "tools_over_mcp": True, "cancellation": True, "warm_faster_than_cold": True}
        self.assertNotIn("voice", report.render(dict(base, checks=checks)).lower())
        data = dict(base, voice={"plain": dict(self.turn(1200, 10000), text="Fido."),
                                 "tools": dict(self.turn(1300, 10000), text="Two jobs.", textBeforeTool=True)},
                    checks=dict(checks, voice_spoken_shape=True, voice_tools_over_mcp=False))
        text = report.render(data)
        self.assertIn("| voice: plain | 1200 ms |", text)
        self.assertIn("| voice: with a tool | 1300 ms |", text)
        self.assertIn("PI wrote a sentence before the tool call: yes", text)
        self.assertIn("voice-channel replies read as speech (plain words, no markdown or lists, short) | pass", text)
        self.assertIn("a voice turn ran a Jarvis tool through the MCP server and its own result was ok | **FAIL**", text)


if __name__ == "__main__":
    unittest.main()
