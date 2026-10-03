[CmdletBinding()]
param(
    [string]$Subscription = "0ac7d719-89bc-4100-be87-a79d33e953a7",
    [string]$Tenant = "802efa29-17f2-4a79-8f5f-38f087aed96a",
    [string]$ResourceGroup = "rg-jarvis-poc",
    [string]$Location = "swedencentral",
    [string]$KeyVaultName = "jarvis-poc-sc-kv",
    [string]$WorkspaceName = "jarvis-poc-law",
    [string]$AppInsightsName = "jarvis-poc-appins",
    [string]$TestRepository = "DanAakesen/jarvis-poc-target",
    [switch]$DeleteTestRepo,
    [switch]$DeleteLocalSecrets
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$AgentName = "jarvis-runner"
$StatePath = Join-Path $PSScriptRoot ".deployment-state.json"
. (Join-Path $PSScriptRoot "managed-workspace.ps1")

function Invoke-AzJson {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $output = & az @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Azure CLI failed: $($output -join "`n")" }
    if (-not $output) { return $null }
    return ($output -join "`n" | ConvertFrom-Json)
}

function Invoke-AzQuiet {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $output = & az @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Azure CLI failed: $($output -join "`n")" }
}

$AzInvoker = {
    param([string[]]$Arguments)
    $output = & az @Arguments 2>&1
    [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output = @($output)
    }
}

function Invoke-FoundryDataPlane {
    param(
        [Parameter(Mandatory)][ValidateSet("get", "delete")][string]$Method,
        [Parameter(Mandatory)][string]$Url
    )
    $accessToken = & az account get-access-token `
        --resource "https://ai.azure.com/" --subscription $Subscription `
        --query accessToken --output tsv --only-show-errors 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($accessToken)) {
        throw "Could not acquire a Foundry token for tenant $Tenant and subscription $Subscription."
    }
    $headers = @{ Authorization = "Bearer $accessToken" }
    try {
        return Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers -ErrorAction Stop
    } catch {
        $statusCode = $null
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        if ($statusCode) {
            throw "Foundry session request failed with HTTP ${statusCode}: $($_.Exception.Message)"
        }
        throw "Foundry session request failed: $($_.Exception.Message)"
    } finally {
        $accessToken = $null
        $headers = $null
    }
}

function Assert-TargetSubscription {
    $accountTenant = & az account show --subscription $Subscription `
        --query tenantId --output tsv --only-show-errors 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]$accountTenant -ne $Tenant) {
        throw "Azure CLI subscription $Subscription is not currently selected in target tenant $Tenant."
    }
}

Assert-TargetSubscription

$groupAtStart = Invoke-AzJson @(
    "group", "exists", "--name", $ResourceGroup,
    "--subscription", $Subscription, "--only-show-errors"
)
$groupPresent = $groupAtStart -eq $true -or [string]$groupAtStart -eq "true"
# Account and project names are never reused, so the group can hold more than
# one Foundry account. Discover them all; each is purged after the group delete.
$foundryAccounts = @()
if ($groupPresent) {
    $foundryAccounts = @(Invoke-AzJson @(
        "cognitiveservices", "account", "list", "--resource-group", $ResourceGroup,
        "--subscription", $Subscription, "--query", "[].{name:name, endpoint:properties.endpoint}",
        "--only-show-errors"
    ))
} else {
    Write-Host "Resource group $ResourceGroup is already absent; skipping session cleanup."
}
$sessionTargets = @()
foreach ($account in $foundryAccounts) {
    $projectNames = @(Invoke-AzJson @(
        "rest", "--method", "get",
        "--url", "https://management.azure.com/subscriptions/$Subscription/resourceGroups/$ResourceGroup/providers/Microsoft.CognitiveServices/accounts/$($account.name)/projects?api-version=2025-06-01",
        "--subscription", $Subscription, "--query", "value[].name", "--only-show-errors"
    ) | ForEach-Object { ([string]$_).Split('/')[-1] })
    foreach ($projectName in $projectNames) {
        $sessionTargets += [pscustomobject]@{
            Project = "$($account.name)/$projectName"
            Endpoint = "$(([string]$account.endpoint).TrimEnd('/'))/api/projects/$projectName"
        }
    }
}
$legacyManagedBy = "/subscriptions/$Subscription/resourceGroups/$ResourceGroup/providers/Microsoft.Insights/components/$AppInsightsName"
$legacyGroupExists = Invoke-AzJson @(
    "group", "exists", "--name", $PrototypeLegacyManagedWorkspaceResourceGroup,
    "--subscription", $Subscription, "--only-show-errors"
)
$legacyWorkspace = if (
    $legacyGroupExists -eq $true -or [string]$legacyGroupExists -eq "true"
) {
    Get-PrototypeLegacyManagedWorkspace -Subscription $Subscription -AzInvoker $AzInvoker
} else {
    $null
}
$legacyResourceGroup = if (
    $legacyGroupExists -eq $true -or [string]$legacyGroupExists -eq "true"
) {
    Get-PrototypeLegacyManagedResourceGroup `
        -Subscription $Subscription -ExpectedManagedBy $legacyManagedBy -AzInvoker $AzInvoker
} else {
    $null
}
if ($legacyWorkspace) {
    Write-Warning "Found the exact legacy App Insights-managed workspace '$($legacyWorkspace.Name)' in its recorded managed resource group. Teardown will attempt only that exact resource and group."
}
if ($legacyResourceGroup) {
    Write-Warning "Found the exact legacy managed resource group '$($legacyResourceGroup.ResourceId)' managed by '$($legacyResourceGroup.ManagedBy)'. Teardown will attempt only that exact resource group."
}
# Deleting sessions first is a courtesy that stops work promptly. Deleting and
# purging the Foundry account below is what guarantees no session survives, so a
# project whose sessions cannot be listed does not block teardown.
foreach ($target in $sessionTargets) {
    $projectName = $target.Project
    $endpoint = $target.Endpoint
    try {
        $sessions = Invoke-FoundryDataPlane -Method get `
            -Url "$endpoint/agents/$AgentName/endpoint/sessions?api-version=v1&limit=100"
    } catch {
        Write-Warning "Could not list sessions in project ${projectName}: $($_.Exception.Message). The account purge below stops any remaining sessions."
        continue
    }
    $sessionItems = if ($sessions) { @($sessions.data) } else { @() }
    if (-not $sessionItems -and $sessions -and $sessions.sessions) { $sessionItems = @($sessions.sessions) }
    Write-Host "Project ${projectName}: $($sessionItems.Count) session record(s)."
    foreach ($session in $sessionItems) {
        $sessionId = $session.agent_session_id
        if (-not $sessionId) { $sessionId = $session.id }
        if ($sessionId) {
            Write-Host "Deleting hosted-agent session $sessionId"
            Invoke-FoundryDataPlane -Method delete `
                -Url "$endpoint/agents/$AgentName/endpoint/sessions/$sessionId`?api-version=v1"
        }
    }
}

$groupExists = Invoke-AzJson @("group", "exists", "--name", $ResourceGroup, "--subscription", $Subscription, "--only-show-errors")
if ($groupExists -eq $true -or [string]$groupExists -eq "true") {
    Write-Host "Deleting resource group $ResourceGroup"
    Invoke-AzQuiet @("group", "delete", "--name", $ResourceGroup, "--yes", "--subscription", $Subscription, "--only-show-errors")
    for ($attempt = 1; $attempt -le 60; $attempt++) {
        $groupStillExists = Invoke-AzJson @("group", "exists", "--name", $ResourceGroup, "--subscription", $Subscription, "--only-show-errors")
        if ($groupStillExists -ne $true -and [string]$groupStillExists -ne "true") { break }
        Start-Sleep -Seconds 10
    }
    if ($groupStillExists -eq $true -or [string]$groupStillExists -eq "true") {
        throw "Timed out waiting for resource group deletion."
    }
}

# Application Insights owns the legacy managed workspace.  Azure may deny a
# direct delete while the component exists, but normally removes the exact
# workspace and its exact managed resource group as part of deleting the
# approved resource group.  Check that automatic cleanup first, then attempt
# only the recorded identities if Azure left either item behind.
$legacyGroupAfterGroupDelete = Invoke-AzJson @(
    "group", "exists", "--name", $PrototypeLegacyManagedWorkspaceResourceGroup,
    "--subscription", $Subscription, "--only-show-errors"
)
$legacyWorkspaceAfterGroupDelete = if (
    $legacyGroupAfterGroupDelete -eq $true -or
    [string]$legacyGroupAfterGroupDelete -eq "true"
) {
    Get-PrototypeLegacyManagedWorkspace -Subscription $Subscription -AzInvoker $AzInvoker
} else {
    $null
}
if ($legacyWorkspaceAfterGroupDelete) {
    Write-Host "Deleting exact legacy managed workspace $($legacyWorkspaceAfterGroupDelete.ResourceId)"
    Remove-PrototypeLegacyManagedResource `
        -Subscription $Subscription -ResourceKind workspace -AzInvoker $AzInvoker | Out-Null
}
if ($legacyGroupAfterGroupDelete -eq $true -or [string]$legacyGroupAfterGroupDelete -eq "true") {
    Write-Host "Deleting exact legacy managed resource group $($legacyResourceGroup.ResourceId)"
    Remove-PrototypeLegacyManagedResource `
        -Subscription $Subscription -ResourceKind resourceGroup -AzInvoker $AzInvoker | Out-Null
}
$legacyGroupAfterCleanup = Invoke-AzJson @(
    "group", "exists", "--name", $PrototypeLegacyManagedWorkspaceResourceGroup,
    "--subscription", $Subscription, "--only-show-errors"
)
$legacyWorkspaceAfterCleanup = if (
    $legacyGroupAfterCleanup -eq $true -or
    [string]$legacyGroupAfterCleanup -eq "true"
) {
    Get-PrototypeLegacyManagedWorkspace -Subscription $Subscription -AzInvoker $AzInvoker
} else {
    $null
}
if (
    $legacyWorkspaceAfterCleanup -or
    $legacyGroupAfterCleanup -eq $true -or
    [string]$legacyGroupAfterCleanup -eq "true"
) {
    throw "Exact prototype-managed legacy workspace or resource group remains after cleanup."
}

Write-Host "Purging soft-deleted Key Vault $KeyVaultName"
$purgeResult = & az keyvault purge --name $KeyVaultName --location $Location --subscription $Subscription --only-show-errors 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Key Vault purge failed: $($purgeResult -join "`n")"
}

function Get-PrototypeDeletedFoundryAccounts {
    $all = Invoke-AzJson @(
        "cognitiveservices", "account", "list-deleted", "--subscription", $Subscription,
        "--only-show-errors"
    )
    $discovered = @($foundryAccounts | ForEach-Object { [string]$_.name })
    return @($all | Where-Object {
        $_.location -eq $Location -and (
            ([string]$_.id) -match "/resourceGroups/$([regex]::Escape($ResourceGroup))/deletedAccounts/" -or
            $discovered -contains [string]$_.name
        )
    })
}

foreach ($account in @(Get-PrototypeDeletedFoundryAccounts)) {
    Write-Host "Purging soft-deleted Foundry account $($account.name)"
    Invoke-AzQuiet @(
        "cognitiveservices", "account", "purge", "--location", $Location,
        "--resource-group", $ResourceGroup, "--name", $account.name,
        "--subscription", $Subscription, "--only-show-errors"
    )
}

$remainingGroup = Invoke-AzJson @("group", "exists", "--name", $ResourceGroup, "--subscription", $Subscription, "--only-show-errors")
$workspaceStillExists = & az resource show `
    --ids "/subscriptions/$Subscription/resourceGroups/$ResourceGroup/providers/Microsoft.OperationalInsights/workspaces/$WorkspaceName" `
    --subscription $Subscription --only-show-errors 2>$null
$workspaceExists = $LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace(($workspaceStillExists -join "`n"))
$remainingVault = Invoke-AzJson @(
    "keyvault", "list-deleted", "--query", "[?name=='$KeyVaultName']",
    "--subscription", $Subscription, "--only-show-errors"
)
$foundryStillDeleted = @(Get-PrototypeDeletedFoundryAccounts)
if ($remainingGroup -eq $true -or $workspaceExists -or @($remainingVault).Count -gt 0 -or $foundryStillDeleted.Count -gt 0) {
    throw "Teardown verification failed: resource group, RG-scoped workspace, Key Vault, or Foundry account remains."
}
Write-Host "Verified: both prototype resource groups, the RG-scoped Log Analytics workspace, soft-deleted Key Vault, and every soft-deleted Foundry account ($(@($foundryAccounts | ForEach-Object { $_.name }) -join ', ')) are gone."

if ($DeleteTestRepo) {
    Write-Host "Deleting test repository $TestRepository"
    & gh repo delete $TestRepository --yes
    if ($LASTEXITCODE -ne 0) { throw "gh repo delete failed; check that the login has delete_repo scope." }
}
if ($DeleteLocalSecrets) {
    $secretsPath = "C:\Repo\Jarvis\.secrets"
    if (Test-Path $secretsPath) { Remove-Item -LiteralPath $secretsPath -Recurse -Force }
    Write-Host "Deleted local secrets directory $secretsPath"
}

Write-Warning "Revoke the Copilot and GitHub fine-grained tokens in GitHub settings."
if (Test-Path $StatePath) { Remove-Item -LiteralPath $StatePath -Force }
