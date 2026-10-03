[CmdletBinding()]
param(
    [string]$Subscription = "0ac7d719-89bc-4100-be87-a79d33e953a7",
    [string]$Tenant = "802efa29-17f2-4a79-8f5f-38f087aed96a",
    [string]$ResourceGroup = "rg-jarvis-voice-poc",
    [switch]$KeepAudioCache
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$Root = Split-Path -Parent $PSScriptRoot
$StatePath = Join-Path $PSScriptRoot ".deployment-state.json"

$tenantOfSubscription = & az account show --subscription $Subscription --query tenantId -o tsv --only-show-errors 2>$null
if ($tenantOfSubscription -ne $Tenant) { throw "Azure CLI is not signed in to subscription $Subscription in tenant $Tenant." }

$deleted = [System.Collections.Generic.List[string]]::new()
$exists = (& az group exists --name $ResourceGroup --subscription $Subscription --only-show-errors) -eq "true"
if ($exists) {
    $resources = & az resource list --resource-group $ResourceGroup --subscription $Subscription --query "[].{n:name,t:type}" -o tsv --only-show-errors
    foreach ($line in $resources) {
        $name, $type = $line -split "`t", 2
        $deleted.Add("resource: $name ($type)")
    }
    Write-Host "Deleting resource group $ResourceGroup ($(@($resources).Count) resources). This takes a few minutes."
    & az group delete --name $ResourceGroup --subscription $Subscription --yes --only-show-errors
    if ($LASTEXITCODE -ne 0) { throw "Resource group deletion failed." }
    $deleted.Add("resource group: $ResourceGroup")
} else {
    Write-Host "Resource group $ResourceGroup does not exist."
}

# Foundry (AIServices) accounts are soft-deleted for 48 hours; purge them so nothing is retained or billed.
$softDeleted = @(& az cognitiveservices account list-deleted --subscription $Subscription -o json --only-show-errors | ConvertFrom-Json |
    Where-Object { $_.id -match "/resourceGroups/$ResourceGroup/" })
foreach ($account in $softDeleted) {
    Write-Host "Purging soft-deleted Foundry account $($account.name)"
    & az cognitiveservices account purge --name $account.name --resource-group $ResourceGroup --location $account.location `
        --subscription $Subscription --only-show-errors
    if ($LASTEXITCODE -ne 0) { throw "Purging $($account.name) failed." }
    $deleted.Add("purged Foundry account: $($account.name)")
}

# Verify.
$problems = @()
if ((& az group exists --name $ResourceGroup --subscription $Subscription --only-show-errors) -eq "true") { $problems += "resource group still exists" }
$left = @(& az cognitiveservices account list-deleted --subscription $Subscription -o json --only-show-errors | ConvertFrom-Json |
    Where-Object { $_.id -match "/resourceGroups/$ResourceGroup/" })
if ($left.Count -gt 0) { $problems += "soft-deleted Foundry accounts remain: $($left.name -join ', ')" }

if (Test-Path $StatePath) { Remove-Item $StatePath -Force; $deleted.Add("local deployment state") }
if (-not $KeepAudioCache -and (Test-Path (Join-Path $Root "results\audio"))) {
    Remove-Item (Join-Path $Root "results\audio") -Recurse -Force
    $deleted.Add("local synthetic audio cache")
}

Write-Host "`nDeleted:"
$deleted | ForEach-Object { Write-Host "  - $_" }
if ($problems) { throw "Teardown incomplete: $($problems -join '; ')" }
Write-Host "`nVerified: $ResourceGroup is gone and no soft-deleted Foundry account remains. Results in results\ are kept."
