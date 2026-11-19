import json
import unittest
from pathlib import Path
import subprocess
import sys
import tempfile

from hermetic import setUpModule  # noqa: F401

import pi_backend_configuration as cfg


class PiBackendConfigurationTest(unittest.TestCase):
    secret = "S" * 64
    token = "github_pat_" + "A" * 60
    client = "11111111-2222-3333-4444-555555555555"

    def backends(self):
        return [{
            "name": "ca-jarvis-backend-fixture",
            "pi": [
                {"name": "JARVIS_PI_AGENT_NAME", "value": "jarvis-pi"},
                {"name": "JARVIS_PI_MCP_SECRET", "secretRef": "pi-mcp-secret"},
                {"name": "JARVIS_PI_GITHUB_TOKEN", "secretRef": "pi-github-token"},
                {"name": "JARVIS_PI_GITHUB_FP", "value": "a" * 16},
                {"name": "JARVIS_PI_AZURE_MCP_URL", "value": "https://azure-mcp.example"},
                {"name": "JARVIS_PI_AZURE_MCP_CLIENT_ID", "value": self.client},
            ],
        }]

    def secrets(self):
        return [
            {"name": "pi-mcp-secret", "value": self.secret},
            {"name": "pi-github-token", "value": self.token},
        ]

    def test_preserves_secure_and_plain_pi_inputs_without_printing_secrets(self):
        backends = self.backends()
        backends[0]["pi"].append({"name": "JARVIS_PI_MONTHLY_CAP_DKK", "value": "100"})
        result = cfg.configuration(backends, self.secrets(), "jarvis-pi")
        self.assertEqual(result, {
            "agentName": "jarvis-pi",
            "mcpSecret": self.secret,
            "githubToken": self.token,
            "githubFingerprint": "a" * 16,
            "azureMcpUrl": "https://azure-mcp.example",
            "azureMcpClientId": self.client,
            "monthlyCapDkk": "100",
        })
        self.assertNotIn(self.secret, cfg.main.__doc__ or "")

    def test_empty_existing_backend_is_the_first_provisioning_state(self):
        self.assertEqual(cfg.configuration([], [], "jarvis-pi"), {
            "agentName": "",
            "mcpSecret": "",
            "githubToken": "",
            "githubFingerprint": "",
            "azureMcpUrl": "",
            "azureMcpClientId": "",
            "monthlyCapDkk": "",
        })

    def test_a_retained_secret_recovers_an_unmanaged_env_that_was_dropped(self):
        stripped = [{
            "name": "ca-jarvis-backend-fixture",
            "pi": [{"name": "JARVIS_PI_AZURE_MCP_URL", "value": "https://azure-mcp.example"},
                   {"name": "JARVIS_PI_AZURE_MCP_CLIENT_ID", "value": self.client}],
        }]
        recovered = cfg.configuration(
            stripped,
            [{"name": "pi-mcp-secret", "value": self.secret}],
            "jarvis-pi",
        )
        self.assertEqual(recovered["agentName"], "jarvis-pi")
        self.assertEqual(recovered["mcpSecret"], self.secret)
        self.assertEqual(recovered["azureMcpClientId"], self.client)

    def test_rejects_half_present_or_unreadable_configuration(self):
        broken = self.backends()
        broken[0]["pi"] = [item for item in broken[0]["pi"] if item["name"] != "JARVIS_PI_MCP_SECRET"]
        with self.assertRaises(cfg.InvalidConfiguration):
            cfg.configuration(broken, [{"name": "pi-github-token", "value": self.token}], "jarvis-pi")
        with self.assertRaises(cfg.InvalidConfiguration):
            cfg.configuration(self.backends(), [], "jarvis-pi")

    def test_cli_writes_a_private_parameter_file_and_never_prints_secret_values(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            backends = root / "backends.json"
            secrets = root / "secrets.json"
            output = root / "parameters.json"
            backends.write_text(json.dumps(self.backends()), encoding="utf-8")
            secrets.write_text(json.dumps(self.secrets()), encoding="utf-8")
            result = subprocess.run([
                sys.executable, str(Path(__file__).parents[1] / "pi_backend_configuration.py"),
                "--backends", str(backends), "--secrets", str(secrets), "--output", str(output),
                "--agent-name", "jarvis-pi",
            ], capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn(self.secret, result.stdout + result.stderr)
            self.assertNotIn(self.token, result.stdout + result.stderr)
            self.assertEqual(json.loads(output.read_text())["parameters"]["piAgentConfiguration"]["value"]["agentName"], "jarvis-pi")
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
