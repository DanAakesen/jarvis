import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


REPOSITORY = Path(__file__).resolve().parents[3]
SETUP_SCRIPT = REPOSITORY / "infra/setup-vault-mirror.ps1"


HARNESS = r"""
$ErrorActionPreference = 'Stop'
$script:inputs = [System.Collections.Queue]::new()
@(
    'n',
    'synthetic-auth-token',
    'Synthetic Vault',
    'synthetic-password',
    '{"allowedRoots":["Notes"],"allowedExtensions":[".md"],"excludedPrefixes":[],"excludedNames":[],"excludedNamePattern":"","secretPatterns":["synthetic-policy-sentinel"],"maxNoteBytes":10000}',
    '25',
    '3'
) | ForEach-Object { $script:inputs.Enqueue($_) }
$script:requestBodies = @()
$script:roleDeleted = $false

function Read-Host {
    param([string]$Prompt, [switch]$AsSecureString)
    $value = $script:inputs.Dequeue()
    if ($AsSecureString) { return ConvertTo-SecureString $value -AsPlainText -Force }
    return $value
}

function az {
    $global:LASTEXITCODE = 0
    $command = $args -join ' '
    if ($command -like 'account show*') { return '{"id":"subscription","tenantId":"tenant"}' }
    if ($command -like 'deployment group show*') { return 'kv-test' }
    if ($command -like 'keyvault show*' -and $command -like '*properties.vaultUri*') { return 'https://kv-test.vault.azure.net/' }
    if ($command -like 'keyvault show*' -and $command -like '*--query id*') {
        return '/subscriptions/subscription/resourceGroups/rg-test/providers/Microsoft.KeyVault/vaults/kv-test'
    }
    if ($command -like 'ad signed-in-user show*') { return 'owner-object-id' }
    if ($command -like 'role assignment list*') { return '[]' }
    if ($command -like 'role assignment create*') { return '{"id":"/roleAssignments/temporary"}' }
    if ($command -like 'account get-access-token*') { return 'synthetic-access-token' }
    if ($command -like 'keyvault secret list*') {
        $queryIndex = [Array]::IndexOf($args, '--query')
        $name = [regex]::Match($args[$queryIndex + 1], "name=='([^']+)'").Groups[1].Value
        return ConvertTo-Json -InputObject @("https://kv-test.vault.azure.net/secrets/$name/version-1") -Compress
    }
    if ($command -like 'role assignment delete*') { $script:roleDeleted = $true; return }
    throw 'Unexpected mocked Azure CLI command.'
}

function gh {
    $global:LASTEXITCODE = 0
}

function Invoke-RestMethod {
    param($Method, $Uri, $Headers, $ContentType, $Body, $TimeoutSec, $ErrorAction)
    if ($Headers.Authorization -ne ('Bearer ' + 'synthetic-access-token')) { throw 'Unexpected authorization header.' }
    $script:requestBodies += [string]$Body
    if ($env:FAIL_KV -eq 'true') { throw 'synthetic provider failure' }
    return @{}
}

function Start-Sleep {
    param([int]$Seconds)
}

$result = 'SCRIPT_OK'
try { . $env:SETUP_SCRIPT -ResourceGroup 'rg-test' -GitHubRepo 'owner/repo' }
catch { $result = 'SCRIPT_FAILED' }

if ($env:FAIL_KV -eq 'true') {
    if ($result -ne 'SCRIPT_FAILED' -or -not $script:roleDeleted) { exit 1 }
}
else {
    $values = @($script:requestBodies | ForEach-Object { (ConvertFrom-Json $_).value })
    if ($result -ne 'SCRIPT_OK' -or -not $script:roleDeleted -or $values.Count -ne 4 -or
        $values -notcontains 'synthetic-auth-token' -or $values -notcontains 'synthetic-password' -or
        $values -notcontains 'Synthetic Vault' -or ($values -join '') -notmatch 'synthetic-policy-sentinel') {
        $tokenFound = $values -contains 'synthetic-auth-token'
        $passwordFound = $values -contains 'synthetic-password'
        $vaultFound = $values -contains 'Synthetic Vault'
        $policyFound = ($values -join '') -match 'synthetic-policy-sentinel'
        Write-Output "setup result=$result; temporary role removed=$($script:roleDeleted); stored value count=$($values.Count); values=$tokenFound,$passwordFound,$vaultFound,$policyFound"
        exit 1
    }
}
Write-Output $result
"""


class VaultMirrorSetupTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.infra = self.root / "infra"
        self.infra.mkdir()
        self.script = self.infra / "setup-vault-mirror.ps1"
        shutil.copyfile(SETUP_SCRIPT, self.script)
        (self.infra / "bootstrap.output.json").write_text(
            json.dumps({"subscriptionId": "subscription", "tenantId": "tenant"}),
            encoding="utf-8",
        )
        self.harness = self.root / "harness.ps1"
        self.harness.write_text(HARNESS, encoding="utf-8")

    def tearDown(self):
        self.directory.cleanup()

    def run_setup(self, fail=False):
        env = os.environ.copy()
        env["SETUP_SCRIPT"] = str(self.script)
        env["FAIL_KV"] = "true" if fail else "false"
        return subprocess.run(
            ["pwsh", "-NoLogo", "-NoProfile", "-File", str(self.harness)],
            env=env,
            check=False,
            capture_output=True,
            text=True,
        )

    def test_synthetic_secret_values_are_not_printed_and_role_is_removed(self):
        result = self.run_setup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("SCRIPT_OK", result.stdout)
        for value in (
            "synthetic-auth-token",
            "synthetic-password",
            "synthetic-policy-sentinel",
            "synthetic-access-token",
        ):
            self.assertNotIn(value, result.stdout + result.stderr)
        self.assertIn("version version-1", result.stdout)

    def test_temporary_role_is_removed_after_key_vault_failure(self):
        result = self.run_setup(fail=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("SCRIPT_FAILED", result.stdout)
        self.assertNotIn("synthetic-auth-token", result.stdout + result.stderr)
        self.assertNotIn("synthetic-password", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
