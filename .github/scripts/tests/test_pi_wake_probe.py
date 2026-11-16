import argparse
import unittest
from unittest import mock

from hermetic import setUpModule  # noqa: F401
import probe_pi_wake as probe
import provision_pi_agent as pi


class Fake(probe.Probe):
    """A Foundry stand-in: `rejects` are path prefixes that fail with a Foundry-style error."""
    calls: list = []
    rejects: tuple = ()
    woke = False

    def rest(self, method, path, body=None, *, content_type="application/json"):
        Fake.calls.append((method, path))
        if any(path.startswith(prefix) and method in ("POST", "PUT") for prefix in Fake.rejects):
            raise pi.Blocked(f"foundry_{method.lower()}_failed:{path}:bad_request [code=unsupported_tool]")
        if path.endswith("/versions"):
            return {"version": 1}
        if path.endswith("/versions/1"):
            return {"status": "active", "definition": {"tools": body_tools(Fake.calls)}}
        if path.endswith("/conversations"):
            return {"id": "conv_1"}
        if path.endswith("/responses"):
            return {"status": "completed", "output": [{"type": "reminder_call"}, {"type": "message", "role": "assistant"}]}
        if path.endswith("/items"):
            return {"data": [{"type": "message", "role": "assistant"}, {"type": "message", "role": "assistant"}] if Fake.woke else [{"type": "message", "role": "assistant"}]}
        return {}


def body_tools(_calls):
    return [{"type": "microsoft_copilot_toolset_preview"}, {"type": "reminder_preview"}]


class WakeProbeTest(unittest.TestCase):
    def run_probe(self, rejects=(), woke=False):
        Fake.calls, Fake.rejects, Fake.woke = [], rejects, woke
        args = argparse.Namespace(project_endpoint="https://p.example/api/projects/x")
        with mock.patch.object(probe, "Probe", Fake), mock.patch.object(probe.time, "sleep"), mock.patch.object(probe, "WAIT_SECONDS", 0):
            return probe.run_probe(args)

    def test_a_rejected_feature_is_a_result_and_everything_is_cleaned_up(self):
        steps = self.run_probe(rejects=("/agents/jarvis-pi-probe/versions",))
        self.assertEqual(steps[0]["status"], "failed")
        self.assertIn("unsupported_tool", steps[0]["error"])
        self.assertIn(("DELETE", "/routines/jarvis-pi-probe-routine"), Fake.calls)
        # No agent was created, so none is deleted and no routine is attempted.
        self.assertNotIn(("DELETE", "/agents/jarvis-pi-probe"), Fake.calls)
        self.assertFalse([call for call in Fake.calls if call[0] == "PUT"])

    def test_the_whole_flow_records_each_observation_and_deletes_the_agent_and_routine(self):
        steps = self.run_probe(woke=True)
        names = [step["step"] for step in steps]
        self.assertIn("agent used the reminder tool", names)
        woke = [step for step in steps if step["step"].startswith("same conversation")][0]
        self.assertTrue(woke["observed"]["woke"])
        self.assertIn(("PUT", "/routines/jarvis-pi-probe-routine"), Fake.calls)
        self.assertEqual(Fake.calls[-1], ("DELETE", "/agents/jarvis-pi-probe"))
        text = probe.render(steps)
        self.assertIn("| reminder_preview accepted on a harness prompt agent | ok |", text)
        self.assertNotIn("Bearer", text)

    def test_a_reminder_that_never_re_invokes_is_reported_as_not_woken(self):
        steps = self.run_probe(woke=False)
        woke = [step for step in steps if step["step"].startswith("same conversation")][0]
        self.assertFalse(woke["observed"]["woke"])

    def test_the_probe_agent_has_no_mcp_tools_and_no_builtins(self):
        spec = pi.load_spec()
        tools = probe.definition(spec, True)["tools"]
        self.assertEqual([tool["type"] for tool in tools], ["microsoft_copilot_toolset_preview", "reminder_preview"])
        self.assertEqual(tools[0]["default_config"], {"enabled": False})
        self.assertNotIn("reminder_preview", [tool["type"] for tool in probe.definition(spec, False)["tools"]])


if __name__ == "__main__":
    unittest.main()
