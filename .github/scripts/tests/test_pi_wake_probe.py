import argparse
import unittest
from unittest import mock

from hermetic import setUpModule  # noqa: F401
import probe_pi_wake as probe
import provision_pi_agent as pi


class Fake(probe.Probe):
    """A Foundry stand-in: `rejects` are path prefixes whose writes fail with a Foundry-style error."""
    calls: list = []
    rejects: tuple = ()

    def rest(self, method, path, body=None, *, content_type="application/json"):
        Fake.calls.append((method, path))
        if any(path.startswith(prefix) and method in ("POST", "PUT") for prefix in Fake.rejects):
            raise pi.Blocked(f"foundry_{method.lower()}_failed:{path}:bad_request [code=unsupported]")
        if path.endswith("/versions"):
            return {"version": 1}
        if path.endswith("/versions/1"):
            return {"status": "active"}
        return {}


class WakeProbeTest(unittest.TestCase):
    def run_probe(self, rejects=()):
        Fake.calls, Fake.rejects = [], rejects
        args = argparse.Namespace(project_endpoint="https://p.example/api/projects/x")
        with mock.patch.object(probe, "Probe", Fake), mock.patch.object(probe.time, "sleep"):
            return probe.run_probe(args)

    def test_a_rejected_agent_is_a_result_and_no_routine_is_attempted(self):
        steps = self.run_probe(rejects=("/agents/jarvis-pi-probe/versions",))
        self.assertEqual(steps[0]["status"], "failed")
        self.assertIn("unsupported", steps[0]["error"])
        self.assertFalse([call for call in Fake.calls if call[0] == "PUT"])
        self.assertNotIn(("DELETE", "/agents/jarvis-pi-probe"), Fake.calls)
        self.assertIn(("DELETE", "/routines/jarvis-pi-probe-routine"), Fake.calls)

    def test_the_routine_is_created_observed_and_everything_is_deleted(self):
        steps = self.run_probe()
        self.assertIn(("PUT", "/routines/jarvis-pi-probe-routine"), Fake.calls)
        self.assertEqual(Fake.calls[-1], ("DELETE", "/agents/jarvis-pi-probe"))
        text = probe.render(steps)
        self.assertIn("| throwaway harness prompt agent created | ok |", text)
        self.assertNotIn("reminder", text)

    def test_the_probe_agent_has_no_mcp_tools_and_no_builtins(self):
        tools = probe.definition(pi.load_spec())["tools"]
        self.assertEqual([tool["type"] for tool in tools], ["microsoft_copilot_toolset_preview"])
        self.assertEqual(tools[0]["default_config"], {"enabled": False})


if __name__ == "__main__":
    unittest.main()
