[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "..\acr-manifest.ps1")

$targetSubscription = "0ac7d719-89bc-4100-be87-a79d33e953a7"
$registryName = "jarvispocscacr"
$lastArguments = @()
$knownDigest = "sha256:" + ("a" * 64)

function Assert-Equal {
    param(
        [Parameter(Mandatory)]$Actual,
        [Parameter(Mandatory)]$Expected,
        [Parameter(Mandatory)][string]$Message
    )
    if ($Actual -ne $Expected) {
        throw "$Message. Expected '$Expected', got '$Actual'."
    }
}

function Assert-Contains {
    param(
        [Parameter(Mandatory)][object[]]$Actual,
        [Parameter(Mandatory)]$Expected,
        [Parameter(Mandatory)][string]$Message
    )
    if ($Actual -notcontains $Expected) {
        throw "$Message. Missing '$Expected'."
    }
}

function Assert-Throws {
    param(
        [Parameter(Mandatory)][scriptblock]$Script,
        [Parameter(Mandatory)][string]$Message
    )
    try {
        & $Script
    } catch {
        return
    }
    throw "$Message Expected an exception."
}

$fixtureAz = {
    param([string[]]$Arguments)
    $script:lastArguments = @($Arguments)
    $nameIndex = [Array]::IndexOf($Arguments, "--name")
    $manifestName = if ($nameIndex -ge 0) { $Arguments[$nameIndex + 1] } else { "" }
    if ($manifestName -eq "jarvis-runner:runner-20261002003036") {
        return [pscustomobject]@{
            ExitCode = 0
            Output = @($knownDigest)
        }
    }
    if ($manifestName -eq "jarvis-runner:missing-image-tag") {
        return [pscustomobject]@{
            ExitCode = 0
            Output = @()
        }
    }
    return [pscustomobject]@{
        ExitCode = 1
        Output = @("manifest not found")
    }
}

$digest = Assert-AcrManifest `
    -Tag "runner-20261002003036" `
    -RegistryName $registryName `
    -Subscription $targetSubscription `
    -AzInvoker $fixtureAz
Assert-Equal -Actual $digest -Expected $knownDigest `
    -Message "A known existing image tag should be accepted"
Assert-Contains -Actual $lastArguments -Expected "show-metadata" `
    -Message "The manifest metadata command must be used"
Assert-Contains -Actual $lastArguments -Expected "--query" `
    -Message "The digest field must be queried"
Assert-Contains -Actual $lastArguments -Expected "digest" `
    -Message "The manifest digest must be queried"
Assert-Contains -Actual $lastArguments -Expected "--subscription" `
    -Message "The target subscription must be explicit"
Assert-Contains -Actual $lastArguments -Expected $targetSubscription `
    -Message "The target subscription must be passed to Azure CLI"

Assert-Throws {
    Assert-AcrManifest `
        -Tag "missing-image-tag" `
        -RegistryName $registryName `
        -Subscription $targetSubscription `
        -AzInvoker $fixtureAz
} "A missing image tag must be rejected"

Assert-Throws {
    Assert-AcrManifest `
        -Tag "dt2" `
        -RegistryName $registryName `
        -Subscription $targetSubscription `
        -AzInvoker $fixtureAz
} "An ACR build run ID used as a nonexistent image tag must be rejected"

Write-Host "ACR manifest regressions passed: existing tag accepted; missing and run-ID tags rejected."
