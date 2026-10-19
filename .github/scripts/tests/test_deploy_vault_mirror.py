import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


REPOSITORY = Path(__file__).resolve().parents[3]
DEPLOY_SCRIPT = REPOSITORY / ".github/scripts/deploy_bicep.sh"


class VaultMirrorDeployTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        (self.root / ".github/scripts").mkdir(parents=True)
        (self.root / "infra").mkdir()
        (self.root / "infra/main.bicep").write_text("", encoding="utf-8")
        (self.root / "infra/bootstrap.output.json").write_text(
            json.dumps(
                {
                    "backendIdentity": {"resourceId": "/identities/backend"},
                    "sqlAdminGroup": {"objectId": "00000000-0000-0000-0000-000000000001"},
                }
            ),
            encoding="utf-8",
        )
        target_script = self.root / ".github/scripts/deploy_bicep.sh"
        target_script.write_text(DEPLOY_SCRIPT.read_text(encoding="utf-8"), encoding="utf-8")
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "az.log"
        (self.bin / "az").write_text(
            """#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$AZ_LOG"
if [[ "$1 $2 $3" == "deployment group show" ]]; then
  if [[ "$*" == *containerRegistryName.value* ]]; then
    echo '{"name":"crjarvis","host":"crjarvis.azurecr.io"}'
  else
    echo '{}'
  fi
elif [[ "$1 $2 $3" == "containerapp job list" && "${FAKE_MIRROR_PRESENT:-false}" == true ]]; then
  echo 'job-jarvis-vault-mirror'
elif [[ "$1 $2" == "identity list" ]]; then
  if [[ "${FAKE_MIRROR_PRESENT:-false}" == true ]]; then
    echo '[{"name":"id-jarvis-vault-mirror-test","principalId":"principal"}]'
  else
    echo '[]'
  fi
elif [[ "$1 $2 $3" == "role assignment list" && "${FAKE_MIRROR_PRESENT:-false}" == true ]]; then
  echo '/subscriptions/test/roleAssignments/assignment'
elif [[ "$1 $2" == "acr build" && "${FAKE_ACR_FAIL:-false}" == true ]]; then
  exit 42
elif [[ "$1 $2 $3" == "acr manifest show-metadata" ]]; then
  echo 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
fi
""",
            encoding="utf-8",
        )
        (self.bin / "az").chmod(0o755)

    def tearDown(self):
        self.directory.cleanup()

    def deploy(self, **environment):
        env = os.environ.copy()
        env.update(
            {
                "PATH": f"{self.bin}{os.pathsep}{env['PATH']}",
                "AZ_LOG": str(self.log),
                "RESOURCE_GROUP": "rg-test",
                "SUBSCRIPTION_ID": "subscription",
                "INFRA_DEPLOYMENT": "jarvis-infra",
                "JARVIS_BUDGET_CONTACT_EMAILS": "owner@example.test",
            }
        )
        env.update(environment)
        output = self.root / "outputs.json"
        result = subprocess.run(
            ["bash", str(self.root / ".github/scripts/deploy_bicep.sh"), str(output), "backend:existing"],
            cwd=self.root,
            env=env,
            check=False,
            capture_output=True,
            text=True,
        )
        return result, self.log.read_text(encoding="utf-8")

    def test_switch_defaults_off_and_skips_image_build(self):
        result, log = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("acr build", log)
        self.assertIn("vaultMirrorEnabled=false", log)

    def test_disabling_removes_job_identity_and_grants_but_retains_data_containers(self):
        result, log = self.deploy(
            FAKE_MIRROR_PRESENT="true",
            JARVIS_VAULT_MIRROR_ENABLED="false",
            GITHUB_EVENT_NAME="workflow_dispatch",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("containerapp job delete", log)
        self.assertIn("role assignment delete", log)
        self.assertIn("identity delete", log)
        self.assertNotIn("vault-mirror-state", log)
        self.assertIn("retained private state/status containers", result.stdout)

    def test_missing_dockerfile_is_visible_and_does_not_block_deployment(self):
        result, log = self.deploy(
            JARVIS_VAULT_MIRROR_ENABLED="true",
            GITHUB_APP_ID="123",
            GITHUB_SHA="a" * 40,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Dockerfile is absent", result.stdout)
        self.assertNotIn("acr build", log)
        self.assertIn("vaultMirrorEnabled=false", log)

    def test_built_image_is_digest_pinned_when_enabled(self):
        (self.root / "apps/vault-mirror").mkdir(parents=True)
        (self.root / "apps/vault-mirror/Dockerfile").write_text("FROM scratch\n", encoding="utf-8")
        result, log = self.deploy(
            JARVIS_VAULT_MIRROR_ENABLED="true",
            GITHUB_APP_ID="123",
            GITHUB_SHA="a" * 40,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("acr build", log)
        self.assertIn("vaultMirrorEnabled=true", log)
        self.assertIn("vaultMirrorImage=crjarvis.azurecr.io/jarvis-vault-mirror@sha256:", log)

    def test_image_build_failure_skips_mirror_without_failing_infrastructure(self):
        (self.root / "apps/vault-mirror").mkdir(parents=True)
        (self.root / "apps/vault-mirror/Dockerfile").write_text("FROM scratch\n", encoding="utf-8")
        result, log = self.deploy(
            JARVIS_VAULT_MIRROR_ENABLED="true",
            GITHUB_APP_ID="123",
            GITHUB_SHA="a" * 40,
            FAKE_ACR_FAIL="true",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("image build failed", result.stdout)
        self.assertIn("vaultMirrorEnabled=false", log)


if __name__ == "__main__":
    unittest.main()
