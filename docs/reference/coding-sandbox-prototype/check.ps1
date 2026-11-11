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

Get-ChildItem -LiteralPath $root -Filter "*.ps1" -File -Recurse | ForEach-Object {
    $tokens = $null
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tokens, [ref]$errors) | Out-Null
    if ($errors.Count -gt 0) {
        throw "PowerShell syntax errors in $($_.FullName): $($errors -join '; ')"
    }
}
Write-Host "Quality gate passed: driver and PowerShell syntax."
