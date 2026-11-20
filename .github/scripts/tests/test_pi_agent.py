import argparse
import json
import pathlib
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

    def test_reasoning_effort_is_in_the_definition_and_builtins_are_on(self):
        definition = self.definition()
        self.assertEqual(definition["reasoning"], {"effort": "low"})
        self.assertEqual(definition["harness"], {"type": "microsoft_copilot_preview"})
        toolset = [tool for tool in definition["tools"] if tool["type"] == "microsoft_copilot_toolset_preview"]
        self.assertEqual(self.spec["builtinTools"], "enabled")
        self.assertEqual(toolset, [{"type": "microsoft_copilot_toolset_preview", "default_config": {"enabled": True}}])

    def test_an_experiment_switches_one_thing_off_and_changes_the_fingerprint_but_never_the_default(self):
        full = pi.fingerprint(self.spec, "https://b/pi/mcp", self.skills)
        spec, skills = pi.apply_experiment(self.spec, self.skills, "builtins_off")
        self.assertEqual((spec["builtinTools"], skills), ("disabled", self.skills))
        toolset = [tool for tool in pi.build_definition(spec, self.instructions, "https://b/pi/mcp", skills)["tools"] if tool["type"] == "microsoft_copilot_toolset_preview"]
        self.assertEqual(toolset[0]["default_config"], {"enabled": False})
        self.assertNotEqual(full, pi.fingerprint(spec, "https://b/pi/mcp", skills))
        spec, skills = pi.apply_experiment(self.spec, self.skills, "skills_off")
        self.assertEqual((spec["builtinTools"], skills), ("enabled", []))
        self.assertNotEqual(full, pi.fingerprint(spec, "https://b/pi/mcp", skills))
        self.assertEqual(pi.apply_experiment(self.spec, self.skills, "none"), (self.spec, self.skills))
        self.assertEqual(self.spec["builtinTools"], "enabled")
        with self.assertRaises(pi.Blocked):
            pi.apply_experiment(self.spec, self.skills, "everything_off")

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

    def test_the_seed_keeps_the_marked_tool_contract_and_drops_its_editor_note(self):
        start, end = "KEEP THIS BLOCK: backend tool contract (start)", "KEEP THIS BLOCK: backend tool contract (end)"
        self.assertEqual((self.instructions.count(start), self.instructions.count(end)), (1, 1))
        block = self.instructions[self.instructions.index(start):self.instructions.index(end)]
        for needle in ("[Turn jt-", "`find_tools`", "`call_tool`"):
            self.assertIn(needle, block)
        self.assertNotIn("Bootstrap seed only", self.instructions)
        self.assertFalse(self.instructions.lstrip().startswith("<!--"))

    def test_skills_are_repository_files_pinned_by_version(self):
        self.assertEqual([skill["name"] for skill in self.skills], ["jarvis-inbox-triage", "jarvis-workers", "jarvis-brain", "jarvis-watches", "jarvis-situational-context"])
        self.assertEqual(self.definition()["skills"], [
            {"type": "skill_reference", "name": "jarvis-inbox-triage", "version": "1"},
            {"type": "skill_reference", "name": "jarvis-workers", "version": "1"},
            {"type": "skill_reference", "name": "jarvis-brain", "version": "1"},
            {"type": "skill_reference", "name": "jarvis-watches", "version": "1"},
            {"type": "skill_reference", "name": "jarvis-situational-context", "version": "1"}])

    def test_fingerprint_changes_with_spec_url_and_skill_content_only_never_with_instructions(self):
        base = pi.fingerprint(self.spec, "https://b/pi/mcp", self.skills)
        self.assertEqual(base, pi.fingerprint(self.spec, "https://b/pi/mcp", self.skills))
        self.assertNotEqual(base, pi.fingerprint({**self.spec, "reasoningEffort": "high"}, "https://b/pi/mcp", self.skills))
        self.assertNotEqual(base, pi.fingerprint(self.spec, "https://c/pi/mcp", self.skills))
        changed = [dict(self.skills[0], sha256="0" * 64)]
        self.assertNotEqual(base, pi.fingerprint(self.spec, "https://b/pi/mcp", changed))

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
                    if "definition" not in stored:
                        raise pi.Blocked("foundry_get_failed:/agents/jarvis-pi:not_found [code=NotFound]")
                    return {"versions": {"latest": {"version": 1}}}
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
                mock.patch.object(pi, "wait_ready", return_value="ca-jarvis--revision-1"), \
                mock.patch.object(pi, "provision_voice_agent", return_value={
                    "agent": "jarvis-pi-live", "version": "2", "created": True, "model": "gpt-live-1",
                }), mock.patch.object(pi, "configure_voice_backend", return_value="ca-jarvis--revision-1"), \
                mock.patch.object(pi, "delete_replaced_voice_deployments", return_value=[]), \
                mock.patch.object(pi, "arm_request", fake_arm):
            result = pi.provision(args)
        # The Jarvis connection is written, and the two old harness connections (GitHub with the token, Azure) are removed.
        self.assertEqual([m for m, _ in arm], ["GET", "PUT", "DELETE", "DELETE"])
        self.assertTrue(arm[1][1].endswith("/accounts/acct/projects/proj/connections/jarvis-pi-mcp"))
        self.assertTrue(arm[2][1].endswith("/connections/jarvis-pi-github"))
        self.assertTrue(arm[3][1].endswith("/connections/jarvis-pi-azure"))
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

    def test_verify_rejects_a_readback_whose_builtins_differ_from_the_spec(self):
        readback = {"definition": self.definition()}
        pi.verify(readback, self.spec)
        with_headers = json.loads(json.dumps(readback))
        with_headers["definition"]["tools"][1]["headers"] = {"Authorization": "x"}
        with self.assertRaises(pi.Blocked):
            pi.verify(with_headers, self.spec)
        readback["definition"]["tools"][0]["default_config"]["enabled"] = False
        with self.assertRaises(pi.Blocked):
            pi.verify(readback, self.spec)


class MainAgentInstructionsTest(unittest.TestCase):
    """Foundry owns the instructions of jarvis-pi; Deploy seeds them once and carries them forward, never compares them."""

    live = "Rewritten in the Foundry portal by Dan."

    def setUp(self):
        self.spec = pi.load_spec()
        self.seed = pi.instructions_text()
        self.skills = [dict(pi.parse_skill(name), version="1") for name in self.spec["skills"]]
        self.url = "https://b.example/pi/mcp"
        self.args = argparse.Namespace(project_endpoint="https://p.example/api/projects/x", backend_fqdn="b.example",
                                       foundry_account="acct", foundry_project="proj",
                                       backend_app="app", resource_group="rg", subscription="sub")

    def version(self, instructions=None, fingerprint="current", skills=None, status="active", **changes):
        definition = pi.build_definition(self.spec, self.live if instructions is None else instructions, self.url, skills or self.skills)
        definition.update(changes)
        metadata = {pi.FINGERPRINT_KEY: pi.fingerprint(self.spec, self.url, self.skills) if fingerprint == "current" else fingerprint}
        return {"status": status, "definition": definition, "metadata": metadata}

    def pinned(self, version, latest=None):
        rule = {"type": "FixedRatio", "agent_version": version, "traffic_percentage": 100}
        agent = {"agent_endpoint": {"version_selector": {"version_selection_rules": [rule]}}}
        return {**agent, "versions": {"latest": {"version": latest}}} if latest else agent

    def run_provision(self, agent, versions, hook=None):
        """hook(method, path, live) runs before each Foundry call and may change `live["agent"]` or `versions`, like a portal save."""
        calls, posted = [], []
        live = {"agent": agent}

        class Fake(pi.Az):
            def rest(_self, method, path, body=None, *, content_type="application/json"):
                calls.append((method, path))
                if hook:
                    hook(method, path, live)
                if method == "GET" and path == "/agents/jarvis-pi":
                    if live["agent"] is None:
                        raise pi.Blocked("foundry_get_failed:/agents/jarvis-pi:not_found [code=NotFound]")
                    return live["agent"]
                if method == "GET" and path.startswith("/agents/jarvis-pi/versions/"):
                    return versions[path.rsplit("/", 1)[-1]]
                if method == "POST" and path == "/agents/jarvis-pi/versions":
                    posted.append(body)
                    versions["9"] = {"status": "active", "definition": body["definition"], "metadata": body["metadata"]}
                    if live["agent"] is None or not live["agent"].get("agent_endpoint"):
                        live["agent"] = {"versions": {"latest": {"version": 9}}}
                    return {"version": 9}
                if method == "POST" and path.startswith("/skills/"):
                    return {"version": 2}
                return {}

        def fake_arm(method, path, body=None):
            if method == "GET":
                raise pi.Blocked("arm_get_failed:jarvis-pi-mcp:not_found")
            return {}

        with mock.patch.object(pi, "Az", Fake), mock.patch.object(pi, "configure_backend", return_value="S" * 43), \
                mock.patch.object(pi, "arm_request", fake_arm), \
                mock.patch.object(pi, "provision_voice_agent", return_value={"agent": "jarvis-pi-live", "version": "1", "created": False, "model": "gpt-live-1"}), \
                mock.patch.object(pi, "configure_voice_backend", return_value="rev-1"), \
                mock.patch.object(pi, "delete_replaced_voice_deployments", return_value=[]), \
                mock.patch.dict("os.environ", {}, clear=True):
            result = pi.provision(self.args)
        return result, calls, posted

    def test_an_existing_agent_with_edited_instructions_and_a_newer_version_passes_without_any_write(self):
        versions = {"1": self.version(self.seed), "2": self.version(), "3": self.version("A newer, unpinned edit.")}
        result, calls, _posted = self.run_provision(self.pinned("2", latest="3"), versions)
        self.assertEqual((result["version"], result["created"]), ("2", False))
        self.assertFalse([call for call in calls if call[0] in {"POST", "PATCH"} and not call[1].startswith("/skills")])
        self.assertNotIn(("PATCH", "/agents/jarvis-pi"), calls)
        self.assertNotIn(("POST", "/agents/jarvis-pi/versions"), calls)

    def test_without_a_pin_rule_the_verified_latest_version_is_pinned_without_a_new_version(self):
        versions = {"3": self.version()}
        result, calls, posted = self.run_provision({"versions": {"latest": {"version": "3"}}}, versions)
        self.assertEqual((result["version"], result["created"]), ("3", False))
        self.assertIn(("GET", "/agents/jarvis-pi/versions/3"), calls)
        self.assertEqual(posted, [])
        self.assertEqual([call for call in calls if call[0] != "GET"], [("PATCH", "/agents/jarvis-pi")])

    def test_an_unpinned_latest_version_with_a_matching_fingerprint_is_still_verified_before_it_is_pinned(self):
        # An earlier run can have died after the POST (which stores the fingerprint) and before verify and pin.
        versions = {"3": self.version(model="another-model")}
        with self.assertRaisesRegex(pi.Blocked, "readback_model_mismatch"):
            self.run_provision({"versions": {"latest": {"version": "3"}}}, versions)

    def test_an_instructions_only_edit_never_creates_a_version(self):
        for text in (self.live, "", self.seed + "\nand one more line"):
            _result, calls, posted = self.run_provision(self.pinned("2"), {"2": self.version(text)})
            self.assertEqual(posted, [])
            self.assertNotIn(("PATCH", "/agents/jarvis-pi"), calls)

    def test_a_code_owned_change_publishes_a_version_with_the_live_text_and_pins_it(self):
        stale = [dict(skill, sha256="0" * 64) for skill in self.skills]
        previous = self.version(skills=stale, fingerprint=pi.fingerprint(self.spec, self.url, stale))
        result, calls, posted = self.run_provision(self.pinned("2", latest="3"), {"2": previous, "3": self.version("Unpinned edit.")})
        self.assertEqual((result["version"], result["created"]), ("9", True))
        self.assertEqual(len(posted), 1)
        self.assertEqual(posted[0]["definition"]["instructions"], self.live)
        self.assertNotEqual(posted[0]["definition"]["instructions"], self.seed)
        self.assertEqual(posted[0]["metadata"], {pi.FINGERPRINT_KEY: pi.fingerprint(self.spec, self.url, self.skills)})
        self.assertLess(calls.index(("POST", "/agents/jarvis-pi/versions")), calls.index(("PATCH", "/agents/jarvis-pi")))
        self.assertEqual(calls[-1], ("PATCH", "/agents/jarvis-pi"))

    def test_a_changed_mcp_url_also_carries_the_live_text_forward(self):
        self.args.backend_fqdn = "other.example"
        _result, _calls, posted = self.run_provision(self.pinned("2"), {"2": self.version()})
        self.assertEqual(posted[0]["definition"]["instructions"], self.live)
        self.assertEqual(posted[0]["definition"]["tools"][1]["server_url"], "https://other.example/pi/mcp")

    def test_a_changed_setting_also_carries_the_live_text_forward(self):
        changed = {**self.spec, "reasoningEffort": "high"}
        with mock.patch.object(pi, "load_spec", return_value=changed):
            _result, _calls, posted = self.run_provision(self.pinned("2"), {"2": self.version()})
        self.assertEqual(posted[0]["definition"]["instructions"], self.live)
        self.assertEqual(posted[0]["definition"]["reasoning"], {"effort": "high"})

    def test_a_missing_agent_is_seeded_from_the_repo_text_and_pinned_once(self):
        result, calls, posted = self.run_provision(None, {})
        self.assertEqual((result["version"], result["created"]), ("9", True))
        self.assertEqual([call for call in calls if call == ("POST", "/agents/jarvis-pi/versions")], [("POST", "/agents/jarvis-pi/versions")])
        self.assertEqual(posted[0]["definition"]["instructions"], self.seed)
        self.assertEqual([call for call in calls if call[0] == "PATCH"], [("PATCH", "/agents/jarvis-pi")])

    def stale_skills(self):
        stale = [dict(skill, sha256="0" * 64) for skill in self.skills]
        return self.version(skills=stale, fingerprint=pi.fingerprint(self.spec, self.url, stale))

    def test_a_portal_edit_saved_before_the_version_is_posted_aborts_the_deploy_without_any_write(self):
        def edit(method, path, live):
            if (method, path) == ("POST", "/skills/jarvis-inbox-triage/versions"):
                versions["3"] = self.version("Dan saved this while Deploy ran.")
                live["agent"] = self.pinned("3")

        versions = {"2": self.stale_skills()}
        with self.assertRaisesRegex(pi.Blocked, "agent_changed_during_deploy"):
            self.run_provision(self.pinned("2"), versions, edit)
        self.assertNotIn("9", versions)

    def test_a_portal_edit_saved_while_the_new_version_activates_is_never_overwritten_by_the_pin(self):
        calls_seen = []

        def edit(method, path, live):
            calls_seen.append((method, path))
            if (method, path) == ("GET", "/agents/jarvis-pi/versions/9"):
                versions["3"] = self.version("Dan saved this while Deploy ran.")
                live["agent"] = self.pinned("3")

        versions = {"2": self.stale_skills()}
        with self.assertRaisesRegex(pi.Blocked, "agent_changed_during_deploy"):
            self.run_provision(self.pinned("2"), versions, edit)
        self.assertNotIn(("PATCH", "/agents/jarvis-pi"), calls_seen)

    def test_without_a_pin_rule_a_newer_portal_version_also_stops_the_pin(self):
        calls_seen = []

        def edit(method, path, live):
            calls_seen.append((method, path))
            if (method, path) == ("GET", "/agents/jarvis-pi/versions/9"):
                versions["10"] = self.version("Dan saved this while Deploy ran.")
                live["agent"] = {"versions": {"latest": {"version": 10}}}

        versions = {"3": self.stale_skills()}
        with self.assertRaisesRegex(pi.Blocked, "agent_changed_during_deploy"):
            self.run_provision({"versions": {"latest": {"version": "3"}}}, versions, edit)
        self.assertNotIn(("PATCH", "/agents/jarvis-pi"), calls_seen)

    def test_an_agent_created_by_someone_else_while_seeding_aborts_instead_of_posting_the_seed(self):
        def create(method, path, live):
            if (method, path) == ("POST", "/skills/jarvis-inbox-triage/versions"):
                live["agent"] = self.pinned("1")

        with self.assertRaisesRegex(pi.Blocked, "agent_changed_during_deploy"):
            self.run_provision(None, {"1": self.version()}, create)

    def test_an_existing_agent_without_a_usable_version_or_text_fails_instead_of_being_reseeded(self):
        with self.assertRaisesRegex(pi.Blocked, "agent_version_unknown"):
            self.run_provision({"versions": {}}, {})
        stale = self.version(fingerprint="old")
        del stale["definition"]["instructions"]
        with self.assertRaisesRegex(pi.Blocked, "agent_instructions_unreadable"):
            self.run_provision(self.pinned("2"), {"2": stale})

    def test_drift_in_a_code_owned_field_of_a_new_version_still_fails_with_its_reason(self):
        drift = {
            "readback_model_mismatch": {"model": "another-model"},
            "readback_reasoning_mismatch": {"reasoning": {"effort": "high"}},
            "readback_harness_mismatch": {"harness": {"type": "other"}},
        }
        for code, change in drift.items():
            readback = self.version(**change)
            with self.assertRaisesRegex(pi.Blocked, code):
                pi.verify(readback, self.spec)
        readback = self.version()
        readback["definition"]["tools"][1]["project_connection_id"] = "other-connection"
        with self.assertRaisesRegex(pi.Blocked, "readback_mcp_connection_mismatch"):
            pi.verify(readback, self.spec)

    def test_verify_does_not_read_the_instructions(self):
        pi.verify(self.version("anything at all"), self.spec)
        pi.verify(self.version(""), self.spec)


class VoiceAgentTest(unittest.TestCase):
    def setUp(self):
        self.spec, _instructions, self.seed = pi.load_voice_spec()

    def foundry(self, agent, versions):
        calls = []

        class Fake:
            def rest(_self, method, path, body=None, **options):
                calls.append((method, path))
                if method == "GET" and path == "/agents/jarvis-pi-live":
                    if agent is None:
                        raise pi.Blocked("foundry_get_failed:/agents/jarvis-pi-live:not_found [code=NotFound]")
                    return agent
                if method == "GET" and path.startswith("/agents/jarvis-pi-live/versions/"):
                    return versions[path.rsplit("/", 1)[-1]]
                if method == "POST":
                    versions["1"] = {"status": "active", "definition": body["definition"]}
                    return {"version": "1"}
                return {}

        return Fake(), calls

    def edited(self, **changes):
        definition = json.loads(json.dumps(self.seed))
        definition["instructions"] = "Edited in the Foundry portal."
        definition["audio"]["output"]["voice"] = "cedar"
        definition["greeting"] = "Evening, Dan."
        definition.update(changes)
        return {"status": "active", "definition": definition}

    def provision(self, agent, versions):
        foundry, calls = self.foundry(agent, versions)
        with mock.patch.object(pi, "arm_deployment_request", return_value={
            "name": "gpt-live-1", "sku": {"name": "GlobalStandard", "capacity": 10},
            "properties": {"provisioningState": "Succeeded", "model": {"format": "OpenAI", "name": "gpt-live-1", "version": "2026-09-10"}},
        }):
            return pi.provision_voice_agent(foundry, self.spec, self.seed, "acct", "rg", "sub"), calls

    def pinned(self, version):
        rule = {"type": "FixedRatio", "agent_version": version, "traffic_percentage": 100}
        return {"agent_endpoint": {"version_selector": {"version_selection_rules": [rule]}}}

    def test_the_voice_is_no_longer_required_to_be_marin(self):
        spec = json.loads((pi.PI / "voice-definition.json").read_text(encoding="utf-8"))
        spec["audio"]["output"]["voice"] = "cedar"
        with mock.patch.object(pathlib.Path, "read_text", side_effect=[json.dumps(spec), (pi.PI / "voice-instructions.md").read_text(encoding="utf-8")]):
            self.assertEqual(pi.load_voice_spec()[2]["audio"]["output"]["voice"], "cedar")

    def test_an_existing_agent_edited_in_foundry_passes_without_any_write(self):
        versions = {"1": {"status": "active", "definition": self.seed}, "2": self.edited()}
        agent = {**self.pinned("2"), "versions": {"latest": {"version": "3"}}}
        result, calls = self.provision(agent, versions)
        self.assertEqual((result["version"], result["created"]), ("2", False))
        self.assertEqual({method for method, _ in calls}, {"GET"})

    def test_without_a_pin_rule_the_latest_version_is_verified(self):
        versions = {"1": {"status": "active", "definition": self.seed}, "3": self.edited(delegation={"type": "server"})}
        for latest in ({"version": "3"}, 3):
            with self.assertRaisesRegex(pi.Blocked, "voice_readback_delegation_mismatch"):
                self.provision({"versions": {"latest": latest}}, versions)
        versions["3"] = self.edited()
        result, calls = self.provision({"versions": {"latest": {"version": "3"}}}, versions)
        self.assertEqual(result["version"], "3")
        self.assertIn(("GET", "/agents/jarvis-pi-live/versions/3"), calls)
        self.assertEqual({method for method, _ in calls}, {"GET"})

    def test_drift_in_the_technical_contract_fails_with_its_reason_and_fixes_nothing(self):
        drift = {
            "voice_readback_delegation_mismatch": {"delegation": {"type": "server"}},
            "voice_readback_audio_format_mismatch": {"audio": {"format": {"type": "audio/pcm", "rate": 16000}}},
            "voice_readback_model_mismatch": {"model": "gpt-live-2"},
            "voice_readback_store_mismatch": {"store": True},
            "voice_readback_kind_mismatch": {"kind": "prompt"},
        }
        for code, change in drift.items():
            foundry, calls = self.foundry(self.pinned("2"), {"2": self.edited(**change)})
            with mock.patch.object(pi, "arm_deployment_request", return_value={
                "name": "gpt-live-1", "sku": {"name": "GlobalStandard", "capacity": 10},
                "properties": {"provisioningState": "Succeeded", "model": {"format": "OpenAI", "name": "gpt-live-1", "version": "2026-09-10"}},
            }), self.assertRaisesRegex(pi.Blocked, code):
                pi.provision_voice_agent(foundry, self.spec, self.seed, "acct", "rg", "sub")
            self.assertEqual({method for method, _ in calls}, {"GET"}, code)

    def test_an_existing_agent_without_a_usable_version_fails_instead_of_being_reseeded(self):
        with self.assertRaisesRegex(pi.Blocked, "voice_agent_version_unknown"):
            self.provision({"versions": {}}, {})

    def test_a_missing_agent_is_created_from_the_seed_and_pinned_once(self):
        versions = {}
        foundry, calls = self.foundry(None, versions)
        patched = []
        with mock.patch.object(pi, "arm_deployment_request", return_value={
            "name": "gpt-live-1", "sku": {"name": "GlobalStandard", "capacity": 10},
            "properties": {"provisioningState": "Succeeded", "model": {"format": "OpenAI", "name": "gpt-live-1", "version": "2026-09-10"}},
        }), mock.patch.object(pi, "pin", side_effect=lambda *args: patched.append(args[2])), \
                mock.patch.object(pi, "current_state", return_value={"pinned": "1", "status": "active"}):
            result = pi.provision_voice_agent(foundry, self.spec, self.seed, "acct", "rg", "sub")
        self.assertEqual((result["version"], result["created"]), ("1", True))
        self.assertEqual([call for call in calls if call[0] == "POST"], [("POST", "/agents/jarvis-pi-live/versions")])
        self.assertEqual(patched, ["1"])
        self.assertEqual(versions["1"]["definition"]["audio"]["output"]["voice"], "marin")


class ReachTest(unittest.TestCase):
    token = "github_pat_" + "A" * 60
    client = "11111111-2222-3333-4444-555555555555"
    project = "/subscriptions/s/resourceGroups/rg/providers/Microsoft.CognitiveServices/accounts/a/projects/p"

    def setUp(self):
        self.spec = pi.load_spec()
        self.args = argparse.Namespace(azure_mcp_url="https://azure-mcp.example/", azure_mcp_client_id=self.client)

    def tearDown(self):
        pi.REDACT.clear()

    def test_missing_inputs_say_who_must_provide_what(self):
        with mock.patch.dict("os.environ", {}, clear=True):
            azure, azure_status = pi.resolve_azure(argparse.Namespace(azure_mcp_url="", azure_mcp_client_id=""))
            token, github_status = pi.resolve_github(self.spec)
        self.assertIsNone(token)
        self.assertEqual(github_status, "not attached: the owner has not provided the PI_GITHUB_TOKEN secret")
        self.assertIsNone(azure)
        self.assertIn("JARVIS_AZURE_MCP_CLIENT_ID", azure_status)

    def test_azure_inputs_are_checked_and_the_url_has_no_trailing_slash(self):
        self.assertEqual(pi.resolve_azure(self.args), (("https://azure-mcp.example", self.client), "attached"))
        with self.assertRaises(pi.Blocked):
            pi.resolve_azure(argparse.Namespace(azure_mcp_url="http://x", azure_mcp_client_id=self.client))
        with self.assertRaises(pi.Blocked):
            pi.resolve_azure(argparse.Namespace(azure_mcp_url="https://x", azure_mcp_client_id="not-a-guid"))

    def test_only_a_fine_grained_github_token_is_accepted_and_it_is_redacted(self):
        with mock.patch.dict("os.environ", {"PI_GITHUB_TOKEN": "ghp_" + "A" * 36}, clear=True), self.assertRaises(pi.Blocked):
            pi.resolve_github(self.spec)
        with mock.patch.dict("os.environ", {"PI_GITHUB_TOKEN": self.token}, clear=True):
            token, status = pi.resolve_github(self.spec)
        self.assertEqual((token, status), (self.token, "attached"))
        self.assertIn(self.token, pi.REDACT)

    def test_the_harness_lists_only_the_jarvis_door_so_neither_server_costs_a_turn_anything(self):
        instructions = pi.instructions_text()
        skills = [dict(pi.parse_skill(name), version="1") for name in self.spec["skills"]]
        definition = pi.build_definition(self.spec, instructions, "https://b/pi/mcp", skills)
        tools = {tool["server_label"]: tool for tool in definition["tools"] if tool["type"] == "mcp"}
        self.assertEqual(set(tools), {"jarvis"})
        self.assertEqual(tools["jarvis"]["require_approval"], "never")
        self.assertNotIn("headers", tools["jarvis"])
        self.assertNotIn("read-only", instructions.lower())
        for skill in skills:
            self.assertNotIn("read-only", json.dumps(skill).lower())
        for forbidden in ("githubcopilot", "azure-mcp", self.token):
            self.assertNotIn(forbidden, json.dumps(definition))
        pi.verify({"definition": definition}, self.spec)
        extra = json.loads(json.dumps(definition))
        extra["tools"].append({"type": "mcp", "server_label": "azure", "server_url": "https://x", "require_approval": "never", "project_connection_id": "c"})
        with self.assertRaises(pi.Blocked):
            pi.verify({"definition": extra}, self.spec)
        self.assertEqual(self.spec["github"]["url"], "https://api.githubcopilot.com/mcp/x/all")

    def test_both_old_harness_connections_are_deleted_and_a_missing_one_is_fine(self):
        calls = []

        def fake(method, path, body=None):
            calls.append((method, path.rsplit("/", 1)[-1]))
            raise pi.Blocked("arm_delete_failed:x:not_found")

        with mock.patch.object(pi, "arm_request", fake):
            pi.remove_connection(self.project, "jarvis-pi-github")
            pi.remove_connection(self.project, "jarvis-pi-azure")
        self.assertEqual(calls, [("DELETE", "jarvis-pi-github"), ("DELETE", "jarvis-pi-azure")])
        with mock.patch.object(pi, "arm_request", side_effect=pi.Blocked("arm_delete_failed:x:forbidden")), self.assertRaises(pi.Blocked):
            pi.remove_connection(self.project, "jarvis-pi-github")

    def test_provision_gives_the_backend_both_inputs_and_reports_each_server(self):
        stored = {}
        deleted = []

        class Fake(pi.Az):
            def rest(self, method, path, body=None, *, content_type="application/json"):
                if method == "GET" and path == "/agents/jarvis-pi":
                    if "definition" not in stored:
                        raise pi.Blocked("foundry_get_failed:/agents/jarvis-pi:not_found")
                    return {"versions": {"latest": {"version": 1}}}
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
            if method == "DELETE":
                deleted.append(path.rsplit("/", 1)[-1])
            return {}

        args = argparse.Namespace(project_endpoint="https://p.example/api/projects/x", backend_fqdn="b.example", foundry_account="acct",
                                  foundry_project="proj", backend_app="app", resource_group="rg", subscription="sub",
                                  azure_mcp_url="https://azure-mcp.example", azure_mcp_client_id=self.client, output=None)
        configure = mock.Mock(return_value="S" * 43)
        with mock.patch.dict("os.environ", {"PI_GITHUB_TOKEN": self.token}, clear=True), mock.patch.object(pi, "Az", Fake), \
                mock.patch.object(pi, "configure_backend", configure), \
                mock.patch.object(pi, "wait_ready", return_value="ca-jarvis--revision-2"), \
                mock.patch.object(pi, "provision_voice_agent", return_value={
                    "agent": "jarvis-pi-live", "version": "2", "created": True, "model": "gpt-live-1",
                }), mock.patch.object(pi, "configure_voice_backend", return_value="ca-jarvis--revision-2"), \
                mock.patch.object(pi, "delete_replaced_voice_deployments", return_value=[]), \
                mock.patch.object(pi, "arm_request", fake_arm):
            result = pi.provision(args)
        self.assertEqual([tool["server_label"] for tool in stored["definition"]["tools"] if tool["type"] == "mcp"], ["jarvis"])
        self.assertEqual(result["reach"], {"github": "attached", "azure": "attached"})
        self.assertEqual(configure.call_args.args[-2:], (self.token, ("https://azure-mcp.example", self.client)))
        self.assertEqual(sorted(deleted), ["jarvis-pi-azure", "jarvis-pi-github"])
        self.assertTrue(result["created"])
        self.assertEqual(result["backendRevision"], "ca-jarvis--revision-2")


class BackendTokenTest(unittest.TestCase):
    token = "github_pat_" + "B" * 60
    azure = ("https://azure-mcp.example", "11111111-2222-3333-4444-555555555555")
    base_env = {"JARVIS_PI_AGENT_NAME": "jarvis-pi", "JARVIS_PI_MCP_SECRET": "pi-mcp-secret"}

    def run_configure(self, token, env, azure=None, secrets_listed=()):
        commands = []

        def fake_shell(*command):
            commands.append(command)
            if command[:3] == ("az", "containerapp", "secret") and command[3] == "list":
                return json.dumps([{"name": "pi-mcp-secret", "value": "S" * 43}, *[{"name": name} for name in secrets_listed]])
            if command[:3] == ("az", "containerapp", "show"):
                return json.dumps([{"name": key, "value": value} for key, value in env.items()])
            return ""

        with mock.patch.object(pi, "shell", fake_shell), mock.patch.object(pi, "wait_ready"):
            pi.configure_backend("app", "rg", "sub", "jarvis-pi", token, azure)
        return commands

    def updates(self, commands):
        return [c for c in commands if c[:4] == ("az", "containerapp", "update", "--name")]

    def test_the_token_becomes_a_backend_secret_and_a_secret_reference_never_a_plain_value(self):
        commands = self.run_configure(self.token, dict(self.base_env))
        self.assertTrue(any(f"pi-github-token={self.token}" in c for c in commands if "set" in c))
        update = self.updates(commands)[-1]
        self.assertIn("JARVIS_PI_GITHUB_TOKEN=secretref:pi-github-token", update)
        self.assertTrue(any(part.startswith("JARVIS_PI_GITHUB_FP=") and self.token not in part for part in update))

    def test_the_azure_server_is_given_to_the_backend_as_plain_settings(self):
        update = self.updates(self.run_configure(None, dict(self.base_env), self.azure))[-1]
        self.assertIn("JARVIS_PI_AZURE_MCP_URL=https://azure-mcp.example", update)
        self.assertIn("JARVIS_PI_AZURE_MCP_CLIENT_ID=11111111-2222-3333-4444-555555555555", update)
        self.assertNotIn("--remove-env-vars", update)

    def test_unchanged_inputs_change_nothing_and_withdrawn_ones_are_removed(self):
        fp = pi.sha256(self.token)[:16]
        env = {**self.base_env, "JARVIS_PI_GITHUB_TOKEN": "pi-github-token", "JARVIS_PI_GITHUB_FP": fp,
               "JARVIS_PI_AZURE_MCP_URL": self.azure[0], "JARVIS_PI_AZURE_MCP_CLIENT_ID": self.azure[1]}
        self.assertFalse(self.updates(self.run_configure(self.token, env, self.azure)))
        gone = self.run_configure(None, env, None, secrets_listed=["pi-github-token"])
        update = self.updates(gone)[-1]
        removed = update[update.index("--remove-env-vars") + 1:]
        for name in ("JARVIS_PI_GITHUB_TOKEN", "JARVIS_PI_GITHUB_FP", "JARVIS_PI_AZURE_MCP_URL", "JARVIS_PI_AZURE_MCP_CLIENT_ID"):
            self.assertIn(name, [part for part in removed if not part.startswith("--")])
        self.assertTrue(any("remove" in c and "pi-github-token" in c for c in gone))


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

    def test_main_runs_the_three_parts_as_separate_requests_and_merges_what_they_observed(self):
        import io
        import pathlib
        import tempfile
        parts = []
        turn = self.turn(1000)
        answers = {
            "core": {"baseline": turn, "cold": turn, "warm": [turn], "tools": dict(turn, toolCalls=1, toolResults=[]),
                     "cancel": {"abortToCloseMs": 1, "partialCharacters": 1, "followUpOk": True}, "totalCostDkk": 0.5,
                     "checks": {"streaming": True, "tools_over_mcp": True, "cancellation": True, "warm_faster_than_cold": True}},
            "voice": {"voice": {"plain": turn, "tools": turn}, "totalCostDkk": 0.25,
                      "checks": {"voice_spoken_shape": True, "voice_tools_over_mcp": True}},
            "reach": {"listed": [{"server": "azure", "tools": 17, "failed": False}], "reach": [], "choices": [], "totalCostDkk": 0.25,
                      "checks": {"mcp_listing": True}},
        }

        class Opener:
            def open(self, request, timeout):
                part = json.loads(request.data)["part"]
                parts.append((part, timeout))
                return io.BytesIO(json.dumps(dict(answers[part], part=part)).encode())

        summary = pathlib.Path(tempfile.mkdtemp()) / "summary.md"
        with mock.patch.object(report.subprocess, "run", return_value=mock.Mock(stdout="token\n")), \
                mock.patch.object(report.urllib.request, "build_opener", return_value=Opener()):
            status = report.main(["--backend-fqdn", "backend.example", "--summary", str(summary)])
        self.assertEqual(status, 0)
        self.assertEqual([part for part, _ in parts], ["core", "voice", "reach"])
        self.assertTrue(all(timeout < 240 for _, timeout in parts))
        text = summary.read_text(encoding="utf-8")
        self.assertIn("Smoke cost: 1.0000 DKK", text)
        self.assertIn("azure: 17 tools", text)
        self.assertIn("voice-channel replies read as speech", text)

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
        self.assertIn("Remote servers whose tools were listed: none reported.", text)

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
        self.assertIn("GitHub tool answered a read through the Jarvis door | **FAIL**", text)
        self.assertNotIn("Azure server answered", text)
        self.assertIn("every remote server (GitHub, Azure) listed its tools | **FAIL**", text)
    def test_render_lists_what_each_natural_prompt_called(self):
        data = {"cold": self.turn(4000), "warm": [self.turn(1900, 10000)],
                "tools": dict(self.turn(2500), toolResults=[{"tool": "list_jobs", "outcome": "ok"}]),
                "choices": [{"label": "Azure question", "called": ["az_group_resource_list"], "turn": dict(self.turn(2000), text="Three apps")},
                            {"label": "PC request", "called": [], "turn": self.turn(1500)}],
                "cancel": {"abortToCloseMs": 120, "partialCharacters": 31, "followUpOk": True}, "totalCostDkk": 0.4,
                "checks": {"streaming": True, "tools_over_mcp": True, "cancellation": True, "warm_faster_than_cold": True}}
        text = report.render(data)
        self.assertIn("- Azure question: called az_group_resource_list; reply: 'Three apps'", text)
        self.assertIn("- PC request: called no Jarvis, GitHub or Azure tool", text)

    def test_render_shows_the_fixed_prompt_row_when_the_report_has_one(self):
        base = {"cold": self.turn(4000), "warm": [self.turn(1900, 10000)],
                "tools": dict(self.turn(2500), toolResults=[{"tool": "list_jobs", "outcome": "ok"}]),
                "cancel": {"abortToCloseMs": 120, "partialCharacters": 31, "followUpOk": True}, "totalCostDkk": 0.4,
                "checks": {"streaming": True, "tools_over_mcp": True, "cancellation": True, "warm_faster_than_cold": True}}
        self.assertNotIn("fixed prompt", report.render(base))
        self.assertIn("| fixed prompt, new conversation | 1000 ms |", report.render(dict(base, baseline=self.turn(1000, 0))))

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
