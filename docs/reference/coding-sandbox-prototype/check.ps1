[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$root = $PSScriptRoot

Push-Location (Join-Path $root "driver")
try {
    if (-not (Test-Path "node_modules")) { npm install --no-audit --no-fund }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Driver type-check failed" }
} finally {
    Pop-Location
}

$runner = Join-Path $root "runner"
if (-not (Test-Path (Join-Path $runner ".venv"))) {
    uv venv (Join-Path $runner ".venv")
}
$pythonArgs = @("--python", (Join-Path $runner ".venv/Scripts/python.exe"), "-r", (Join-Path $runner "requirements.txt"))
uv pip install @pythonArgs
if ($LASTEXITCODE -ne 0) { throw "Runner dependency installation failed" }
$previousPythonPath = $env:PYTHONPATH
$env:PYTHONPATH = $runner
Push-Location $runner
try {
    & (Join-Path $runner ".venv/Scripts/python.exe") -m pytest -q tests
} finally {
    Pop-Location
    $env:PYTHONPATH = $previousPythonPath
}
if ($LASTEXITCODE -ne 0) { throw "Runner tests failed" }

$manifestTests = Join-Path $root "infra/tests/Assert-AcrManifest.Tests.ps1"
& $manifestTests
if ($LASTEXITCODE -ne 0) { throw "ACR manifest regression tests failed" }

$managedWorkspaceTests = Join-Path $root "infra/tests/Assert-ManagedWorkspace.Tests.ps1"
& $managedWorkspaceTests
if ($LASTEXITCODE -ne 0) { throw "Managed workspace regression tests failed" }

Get-ChildItem -LiteralPath $root -Filter "*.ps1" -File -Recurse | ForEach-Object {
    $tokens = $null
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tokens, [ref]$errors) | Out-Null
    if ($errors.Count -gt 0) {
        throw "PowerShell syntax errors in $($_.FullName): $($errors -join '; ')"
    }
}
Write-Host "Quality gate passed: driver, runner, and PowerShell syntax."
