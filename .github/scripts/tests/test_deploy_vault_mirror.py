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
  elif [[ "$*" == *properties.outputs* ]]; then
    echo '{"containerRegistryName":{"value":"crjarvis"},"keyVaultName":{"value":"kv-jarvis-test"},"storageAccountName":{"value":"stjarvistest"}}'
  else
    echo '{}'
  fi
elif [[ "$1 $2" == "containerapp list" ]]; then
  if [[ "${FAKE_COPILOT_CONFIG:-}" == valid ]]; then
    echo '[{"name":"ca-jarvis-backend-test","image":"backend:existing","copilot":[{"name":"FOUNDRY_COPILOT_AGENT_NAME","value":"jarvis-main-copilot-preview"},{"name":"FOUNDRY_COPILOT_AGENT_VERSION","value":"1"},{"name":"FOUNDRY_COPILOT_DEFINITION_SHA256","value":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}]'
  elif [[ "${FAKE_COPILOT_CONFIG:-}" == partial ]]; then
    echo '[{"name":"ca-jarvis-backend-test","image":"backend:existing","copilot":[{"name":"FOUNDRY_COPILOT_AGENT_NAME","value":"jarvis-main-copilot-preview"}]}]'
  else
    echo '[]'
  fi
elif [[ "$1 $2 $3" == "containerapp job list" ]]; then
  if [[ "${FAKE_MIRROR_PRESENT:-false}" == true ]]; then echo 'job-jarvis-vault-mirror'; fi
elif [[ "$1 $2" == "identity list" ]]; then
  if [[ "${FAKE_MIRROR_PRESENT:-false}" == true ]]; then
    echo '[{"name":"id-jarvis-vault-mirror-test","principalId":"principal"}]'
  else
    echo '[]'
  fi
elif [[ "$1 $2 $3" == "role assignment list" ]]; then
  [[ "$*" != *" --all "* ]] || exit 91
  [[ "$*" == *" --scope "* ]] || exit 92
  [[ "${FAKE_ROLE_LIST_FAIL:-false}" != true ]] || exit 93
  scope=''
  for ((i=1; i<=$#; i++)); do
    if [[ "${!i}" == --scope ]]; then
      j=$((i + 1))
      scope="${!j}"
      break
    fi
  done
  if [[ "${FAKE_MIRROR_PRESENT:-false}" == true && "$scope" != */resourceGroups/rg-test ]]; then
    echo "/subscriptions/test/roleAssignments/${scope##*/}"
  fi
elif [[ "$1 $2" == "acr show" ]]; then
  echo '/subscriptions/test/resourceGroups/rg-test/providers/Microsoft.ContainerRegistry/registries/crjarvis'
elif [[ "$1 $2" == "keyvault show" ]]; then
  echo '/subscriptions/test/resourceGroups/rg-test/providers/Microsoft.KeyVault/vaults/kv-jarvis-test'
elif [[ "$1 $2 $3" == "storage account show" ]]; then
  echo '/subscriptions/test/resourceGroups/rg-test/providers/Microsoft.Storage/storageAccounts/stjarvistest'
elif [[ "$1 $2" == "group show" ]]; then
  echo '/subscriptions/test/resourceGroups/rg-test'
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
        self.assertNotIn("foundryCopilotAgentName=", log)

    def test_existing_copilot_target_is_preserved_in_bicep_parameters(self):
        result, log = self.deploy(FAKE_COPILOT_CONFIG="valid")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("foundryCopilotAgentName=jarvis-main-copilot-preview", log)
        self.assertIn("foundryCopilotAgentVersion=1", log)
        self.assertIn("foundryCopilotDefinitionSha256=" + "a" * 64, log)

    def test_incomplete_copilot_target_fails_before_deployment(self):
        result, log = self.deploy(FAKE_COPILOT_CONFIG="partial")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Existing Copilot target configuration is invalid.", result.stdout)
        self.assertNotIn("deployment group create", log)

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
        self.assertIn("retained private state/status containers", result.stdout)
        role_listing_calls = [line for line in log.splitlines() if line.startswith("role assignment list")]
        self.assertEqual(len(role_listing_calls), 5)
        for call in role_listing_calls:
            self.assertIn("--scope", call)
            self.assertIn("--fill-principal-name false", call)
            self.assertNotIn("--all", call)
        self.assertNotIn("storage container delete", log)

    def test_workflow_dispatch_with_unset_or_empty_switch_does_not_teardown(self):
        for value in (None, ""):
            with self.subTest(value=value):
                self.log.unlink(missing_ok=True)
                environment = {"GITHUB_EVENT_NAME": "workflow_dispatch", "FAKE_MIRROR_PRESENT": "true"}
                if value is not None:
                    environment["JARVIS_VAULT_MIRROR_ENABLED"] = value
                result, log = self.deploy(**environment)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn("containerapp job delete", log)
                self.assertNotIn("identity delete", log)

    def test_push_with_explicit_false_tears_down(self):
        result, log = self.deploy(
            FAKE_MIRROR_PRESENT="true",
            JARVIS_VAULT_MIRROR_ENABLED="false",
            GITHUB_EVENT_NAME="push",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("containerapp job delete", log)
        self.assertIn("identity delete", log)

    def test_push_teardown_failure_warns_and_does_not_block_deployment(self):
        result, log = self.deploy(
            FAKE_MIRROR_PRESENT="true",
            JARVIS_VAULT_MIRROR_ENABLED="false",
            GITHUB_EVENT_NAME="push",
            FAKE_ROLE_LIST_FAIL="true",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("::warning title=Vault mirror::Teardown is incomplete", result.stdout)
        self.assertIn("deployment group create", log)

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
        self.assertIn("::warning title=Vault mirror::The image build failed", result.stdout)
        self.assertIn("vaultMirrorEnabled=false", log)

    def test_invalid_mirror_configuration_disables_mirror_with_warning(self):
        invalid_settings = (
            {"GITHUB_APP_ID": "not-an-id"},
            {"JARVIS_VAULT_MIRROR_WRITE_BACK": "sometimes"},
            {"JARVIS_VAULT_MIRROR_MAX_CHANGED": "101"},
            {"JARVIS_VAULT_MIRROR_MAX_DELETES": "11"},
            {"JARVIS_VAULT_MIRROR_MAX_CHANGED": "9" * 100},
        )
        for settings in invalid_settings:
            with self.subTest(settings=settings):
                self.log.unlink(missing_ok=True)
                environment = {
                    "JARVIS_VAULT_MIRROR_ENABLED": "true",
                    "GITHUB_APP_ID": "123",
                }
                environment.update(settings)
                result, log = self.deploy(**environment)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("::warning title=Vault mirror::", result.stdout)
                self.assertIn("vaultMirrorEnabled=false", log)
                self.assertNotIn("acr build", log)


if __name__ == "__main__":
    unittest.main()
