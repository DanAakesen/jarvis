[CmdletBinding()]
param(
    [string]$Subscription = "0ac7d719-89bc-4100-be87-a79d33e953a7",
    [string]$Tenant = "802efa29-17f2-4a79-8f5f-38f087aed96a",
    [string]$ResourceGroup = "rg-jarvis-poc",
    [string]$Location = "swedencentral",
    [string]$CopilotTokenPath = "C:\Repo\Jarvis\.secrets\copilot-token.txt",
    [string]$GithubTokenPath = "C:\Repo\Jarvis\.secrets\github-token.txt",
    # Jarvis-only Codex login, created with `codex login` and CODEX_HOME set to
    # this folder. Never Dan's own ~/.codex login: copies of one login sign each
    # other out when Codex renews it.
    [string]$CodexLoginPath = "C:\Repo\Jarvis\.secrets\codex-jarvis\auth.json",
    # Replace the stored Codex login. Without it, an existing (possibly renewed)
    # copy in Key Vault is kept.
    [switch]$ReseedCodexLogin,
    [string]$ImageTagOverride,
    # Leave empty to reuse the resource group's single Foundry account or create
    # a new timestamped one. Never reuse a purged account name: the recreated
    # account's runtime host answered "Project not found" for over an hour, while
    # a freshly named account worked immediately (2 October 2026).
    [string]$FoundryAccount,
    # Leave empty to reuse the account's single existing project or create a new
    # timestamped one. Never recreate a deleted project name: Agent Service keeps
    # stale state for reused names (observed 2 October 2026).
    [string]$ProjectName,
    [switch]$AllowHostedAgentFailure,
    [switch]$SkipImageBuild
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$AgentName = "jarvis-runner"
$RegistryName = "jarvispocscacr"
$KeyVaultName = "jarvis-poc-sc-kv"
$WorkspaceName = "jarvis-poc-law"
$AppInsightsName = "jarvis-poc-appins"
$BudgetName = "jarvis-poc-budget"
$ImageTag = if (-not [string]::IsNullOrWhiteSpace($ImageTagOverride)) { $ImageTagOverride.Trim() } else { "runner-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))" }
$AcrBuildRunId = $null
$ImageDigest = $null
$StatePath = Join-Path $PSScriptRoot ".deployment-state.json"
$Root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "acr-manifest.ps1")
# Agent administration is exposed by the Foundry service hostname while
# hosted-agent sessions use the account endpoint returned by ARM.  Keep both
# explicit because manually provisioned AIServices resources can expose these
# on different hostnames. Project-specific values are set once the project name
# is resolved after the account exists.
$ProjectEndpoint = $null
$RuntimeProjectEndpoint = $null
$FoundryResourceId = $null
$ProjectResourceId = $null
$RegistryResourceId = "/subscriptions/$Subscription/resourceGroups/$ResourceGroup/providers/Microsoft.ContainerRegistry/registries/$RegistryName"
$KeyVaultResourceId = "/subscriptions/$Subscription/resourceGroups/$ResourceGroup/providers/Microsoft.KeyVault/vaults/$KeyVaultName"
$WorkspaceResourceId = "/subscriptions/$Subscription/resourceGroups/$ResourceGroup/providers/Microsoft.OperationalInsights/workspaces/$WorkspaceName"
$AppInsightsResourceId = "/subscriptions/$Subscription/resourceGroups/$ResourceGroup/providers/Microsoft.Insights/components/$AppInsightsName"

function Invoke-AzJson {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $output = & az @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI failed: $($output -join "`n")"
    }
    if (-not $output) { return $null }
    return ($output -join "`n" | ConvertFrom-Json)
}

function Invoke-AzQuiet {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $output = & az @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI failed: $($output -join "`n")"
    }
}

function Invoke-FoundryDataPlane {
    param(
        [Parameter(Mandatory)][ValidateSet("get", "post", "patch", "delete")][string]$Method,
        [Parameter(Mandatory)][string]$Url,
        [string]$Body,
        [switch]$MergePatch
    )
    $accessToken = & az account get-access-token `
        --resource "https://ai.azure.com/" --subscription $Subscription `
        --query accessToken --output tsv --only-show-errors 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($accessToken)) {
        throw "Could not acquire a Foundry token for tenant $Tenant and subscription $Subscription."
    }
    $headers = @{ Authorization = "Bearer $accessToken" }
    try {
        $invokeParameters = @{
            Method = $Method
            Uri = $Url
            Headers = $headers
            ErrorAction = "Stop"
        }
        if ($Body) {
            $invokeParameters.ContentType = if ($MergePatch) {
                "application/merge-patch+json"
            } else {
                "application/json"
            }
            $invokeParameters.Body = $Body
        }
        return Invoke-RestMethod @invokeParameters
    } catch {
        $statusCode = $null
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        $message = $_.Exception.Message
        if ($statusCode) {
            throw "Foundry data-plane request failed with HTTP ${statusCode}: $message"
        }
        throw "Foundry data-plane request failed: $message"
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

function Ensure-File {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Description)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Description is missing: $Path"
    }
}

function New-ArmResource {
    param(
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][hashtable]$Body,
        [string]$ApiVersion = "2025-06-01"
    )
    $json = $Body | ConvertTo-Json -Depth 20 -Compress
    $bodyPath = Join-Path $env:TEMP ("jarvis-arm-" + [Guid]::NewGuid().ToString("N") + ".json")
    $json | Set-Content -LiteralPath $bodyPath -Encoding utf8
    try {
        return Invoke-AzJson @(
            "rest", "--method", "put", "--url", "$Url`?api-version=$ApiVersion",
            "--subscription", $Subscription, "--body", "@$bodyPath", "--only-show-errors"
        )
    } finally {
        Remove-Item -LiteralPath $bodyPath -Force -ErrorAction SilentlyContinue
    }
}

function Get-ArmResource {
    param([Parameter(Mandatory)][string]$ResourceId)
    $output = & az resource show --ids $ResourceId --api-version 2025-06-01 --subscription $Subscription --only-show-errors 2>&1
    if ($LASTEXITCODE -ne 0) { return $null }
    return ($output -join "`n" | ConvertFrom-Json)
}

function Wait-ArmResource {
    param([Parameter(Mandatory)][string]$ResourceId, [int]$Attempts = 60)
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        $resource = Get-ArmResource -ResourceId $ResourceId
        if (-not $resource) { throw "ARM resource disappeared while waiting: $ResourceId" }
        $state = if (
            $resource.properties -and
            $resource.properties.PSObject.Properties.Name -contains "provisioningState"
        ) {
            [string]$resource.properties.provisioningState
        } else {
            "Succeeded"
        }
        Write-Host "ARM resource $($ResourceId.Split('/')[-1]) state: $state (attempt $attempt/$Attempts)"
        if ($state -notin @("Creating", "Updating", "Deleting", "Accepted")) {
            return $resource
        }
        Start-Sleep -Seconds 10
    }
    throw "Timed out waiting for ARM resource: $ResourceId"
}

function Remove-ArmResourceIfExists {
    param([Parameter(Mandatory)][string]$ResourceId)
    if (Get-ArmResource -ResourceId $ResourceId) {
        Invoke-AzQuiet @(
            "rest", "--method", "delete",
            "--url", "https://management.azure.com$ResourceId`?api-version=2025-06-01",
            "--subscription", $Subscription, "--only-show-errors"
        )
        for ($attempt = 1; $attempt -le 30; $attempt++) {
            if (-not (Get-ArmResource -ResourceId $ResourceId)) { return }
            Start-Sleep -Seconds 5
        }
        throw "Timed out deleting ARM resource: $ResourceId"
    }
}

function Test-AzResource {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $null = & az @Arguments 2>&1
    return $LASTEXITCODE -eq 0
}

function Ensure-RoleAssignment {
    param(
        [Parameter(Mandatory)][string]$AssigneeObjectId,
        [Parameter(Mandatory)][string]$Role,
        [Parameter(Mandatory)][string]$Scope,
        [string]$PrincipalType = "ServicePrincipal"
    )
    $definition = Invoke-AzJson @(
        "role", "definition", "list", "--name", $Role,
        "--subscription", $Subscription, "--only-show-errors"
    )
    $roleDefinitionId = @($definition)[0].id
    if (-not $roleDefinitionId) { throw "Could not resolve role definition '$Role'" }
    $assignmentList = Invoke-AzJson @(
        "rest", "--method", "get",
        "--url", "$Scope/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01",
        "--subscription", $Subscription, "--only-show-errors"
    )
    $matching = @($assignmentList.value | Where-Object {
        $_.properties.principalId -eq $AssigneeObjectId -and
        $_.properties.roleDefinitionId -eq $roleDefinitionId
    })
    if ($matching.Count -eq 0) {
        $assignmentId = [Guid]::NewGuid().ToString()
        $roleBody = @{
            properties = @{
                roleDefinitionId = $roleDefinitionId
                principalId = $AssigneeObjectId
                principalType = $PrincipalType
            }
        } | ConvertTo-Json -Depth 10 -Compress
        $roleBodyPath = Join-Path $env:TEMP ("jarvis-role-" + [Guid]::NewGuid().ToString("N") + ".json")
        $roleBody | Set-Content -LiteralPath $roleBodyPath -Encoding utf8
        try {
            Invoke-AzQuiet @(
                "rest", "--method", "put",
                "--url", "$Scope/providers/Microsoft.Authorization/roleAssignments/$assignmentId`?api-version=2022-04-01",
                "--subscription", $Subscription, "--body", "@$roleBodyPath", "--only-show-errors"
            )
        } finally {
            Remove-Item -LiteralPath $roleBodyPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Set-KeyVaultSecret {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Value,
        [Parameter(Mandatory)][hashtable]$Headers
    )
    $body = @{ value = $Value } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Put `
        -Uri "https://$KeyVaultName.vault.azure.net/secrets/$Name`?api-version=7.4" `
        -Headers $Headers -ContentType "application/json" -Body $body | Out-Null
}

function Ensure-ProjectConnection {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][hashtable]$Properties
    )
    $connectionId = "$ProjectResourceId/connections/$Name"
    New-ArmResource -Url "https://management.azure.com$connectionId" -Body @{ properties = $Properties } | Out-Null
    Wait-ArmResource -ResourceId $connectionId | Out-Null
}

Write-Host "Target subscription: $Subscription"
Write-Host "Target resource group: $ResourceGroup ($Location)"
Assert-TargetSubscription
Ensure-File -Path $CopilotTokenPath -Description "Copilot token file"
Ensure-File -Path $GithubTokenPath -Description "GitHub token file"
$personalCodexLogin = Join-Path $env:USERPROFILE ".codex\auth.json"
if ([System.IO.Path]::GetFullPath($CodexLoginPath) -eq [System.IO.Path]::GetFullPath($personalCodexLogin)) {
    throw "Refusing to upload Dan's personal Codex login. Create a Jarvis-only login (see README)."
}

# Read secret files into variables; do not print or persist these values.
$copilotToken = (Get-Content -LiteralPath $CopilotTokenPath -Raw).Trim()
$githubToken = (Get-Content -LiteralPath $GithubTokenPath -Raw).Trim()
$codexLogin = if (Test-Path -LiteralPath $CodexLoginPath) { (Get-Content -LiteralPath $CodexLoginPath -Raw).Trim() } else { $null }
if ([string]::IsNullOrWhiteSpace($copilotToken) -or [string]::IsNullOrWhiteSpace($githubToken)) {
    throw "One or more credential files are empty"
}
if ($ReseedCodexLogin -and [string]::IsNullOrWhiteSpace($codexLogin)) {
    throw "-ReseedCodexLogin needs a fresh Jarvis Codex login at $CodexLoginPath (see README)."
}

# Provider registration is subscription-scope metadata and is intentionally a
# prerequisite, not a deployment side effect. Register these namespaces before
# running the prototype if a new subscription needs them.
foreach ($provider in @(
        "Microsoft.CognitiveServices",
        "Microsoft.ContainerRegistry",
        "Microsoft.KeyVault",
        "Microsoft.Insights",
        "Microsoft.OperationalInsights",
        "Microsoft.Consumption"
    )) {
    $registration = Invoke-AzJson @(
        "provider", "show", "--namespace", $provider, "--subscription", $Subscription,
        "--query", "registrationState", "--only-show-errors"
    )
    if ([string]$registration -ne "Registered") {
        throw "$provider is not registered in subscription $Subscription. Register it before deployment; this script does not change subscription metadata."
    }
}

Invoke-AzQuiet @("group", "create", "--name", $ResourceGroup, "--location", $Location, "--subscription", $Subscription, "--only-show-errors")

if ([string]::IsNullOrWhiteSpace($FoundryAccount)) {
    $existingAccounts = @(Invoke-AzJson @(
        "cognitiveservices", "account", "list", "--resource-group", $ResourceGroup,
        "--subscription", $Subscription, "--query", "[?kind=='AIServices'].name", "--only-show-errors"
    ))
    if ($existingAccounts.Count -eq 1) {
        $FoundryAccount = [string]$existingAccounts[0]
        Write-Host "Reusing existing Foundry account: $FoundryAccount"
    } elseif ($existingAccounts.Count -eq 0) {
        $FoundryAccount = "jarvispoc$([DateTime]::UtcNow.ToString('yyyyMMddHHmm'))"
        Write-Host "Creating new Foundry account: $FoundryAccount"
    } else {
        throw "The resource group has several Foundry accounts ($($existingAccounts -join ', ')); pass -FoundryAccount."
    }
}
$FoundryResourceId = "/subscriptions/$Subscription/resourceGroups/$ResourceGroup/providers/Microsoft.CognitiveServices/accounts/$FoundryAccount"

$foundry = Get-ArmResource -ResourceId $FoundryResourceId
if (-not $foundry) {
    $foundryBody = @{
        location = $Location
        sku = @{ name = "S0" }
        kind = "AIServices"
        identity = @{ type = "SystemAssigned" }
        properties = @{
            customSubDomainName = $FoundryAccount
            publicNetworkAccess = "Enabled"
            allowProjectManagement = $true
        }
    }
    New-ArmResource -Url "https://management.azure.com$FoundryResourceId" -Body $foundryBody | Out-Null
}
Wait-ArmResource -ResourceId $FoundryResourceId | Out-Null
$accountEndpoint = & az cognitiveservices account show `
    --name $FoundryAccount --resource-group $ResourceGroup --subscription $Subscription `
    --query properties.endpoint --output tsv --only-show-errors 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($accountEndpoint)) {
    throw "Foundry account did not return its runtime endpoint."
}

if ([string]::IsNullOrWhiteSpace($ProjectName)) {
    $existingProjects = @(Invoke-AzJson @(
        "rest", "--method", "get",
        "--url", "https://management.azure.com$FoundryResourceId/projects?api-version=2025-06-01",
        "--subscription", $Subscription, "--query", "value[].name", "--only-show-errors"
    ) | ForEach-Object { ([string]$_).Split('/')[-1] })
    if ($existingProjects.Count -eq 1) {
        $ProjectName = $existingProjects[0]
        Write-Host "Reusing existing Foundry project: $ProjectName"
    } elseif ($existingProjects.Count -eq 0) {
        $ProjectName = "jarvis-poc-$([DateTime]::UtcNow.ToString('yyyyMMddHHmm'))"
        Write-Host "Creating new Foundry project: $ProjectName"
    } else {
        throw "The Foundry account has several projects ($($existingProjects -join ', ')); pass -ProjectName."
    }
}
$ProjectEndpoint = "https://$FoundryAccount.services.ai.azure.com/api/projects/$ProjectName"
$ProjectResourceId = "$FoundryResourceId/projects/$ProjectName"
$RuntimeProjectEndpoint = "$($accountEndpoint.TrimEnd('/'))/api/projects/$ProjectName"

$project = Get-ArmResource -ResourceId $ProjectResourceId
if (-not $project) {
    $projectBody = @{
        location = $Location
        identity = @{ type = "SystemAssigned" }
        properties = @{
            displayName = "Jarvis Foundry coding sandbox"
            description = "Proof-of-concept project for the Jarvis coding sandbox."
        }
    }
    New-ArmResource -Url "https://management.azure.com$ProjectResourceId" `
        -Body $projectBody -ApiVersion "2025-04-01-preview" | Out-Null
}
Wait-ArmResource -ResourceId $ProjectResourceId | Out-Null

# Basic Agent Service projects use Microsoft-managed storage. Empty capability
# hosts turn this into an invalid hybrid setup, so remove any hosts left by an
# earlier prototype version and do not recreate them.
$accountCapabilityHostId = "$FoundryResourceId/capabilityHosts/agents"
$projectCapabilityHostId = "$ProjectResourceId/capabilityHosts/agents"
Remove-ArmResourceIfExists -ResourceId $projectCapabilityHostId
Remove-ArmResourceIfExists -ResourceId $accountCapabilityHostId

if (-not (Test-AzResource -Arguments @("acr", "show", "--name", $RegistryName, "--resource-group", $ResourceGroup, "--subscription", $Subscription, "--only-show-errors"))) {
    Invoke-AzQuiet @(
        "acr", "create", "--name", $RegistryName, "--resource-group", $ResourceGroup,
        "--location", $Location, "--sku", "Basic", "--admin-enabled", "false",
        "--subscription", $Subscription, "--only-show-errors"
    )
}
Invoke-AzQuiet @(
    "acr", "config", "authentication-as-arm", "update", "--registry", $RegistryName,
    "--status", "enabled", "--subscription", $Subscription, "--only-show-errors"
)
$acrArmAuthentication = Invoke-AzJson @(
    "acr", "config", "authentication-as-arm", "show", "--registry", $RegistryName,
    "--subscription", $Subscription, "--query", "status", "--only-show-errors"
)
if ([string]$acrArmAuthentication -ne "enabled") {
    throw "ACR authentication-as-ARM is not enabled for $RegistryName."
}

if (-not (Test-AzResource -Arguments @("keyvault", "show", "--name", $KeyVaultName, "--resource-group", $ResourceGroup, "--subscription", $Subscription, "--only-show-errors"))) {
    Invoke-AzQuiet @(
        "keyvault", "create", "--name", $KeyVaultName, "--resource-group", $ResourceGroup,
        "--location", $Location, "--sku", "standard", "--enable-rbac-authorization", "true",
        "--subscription", $Subscription, "--only-show-errors"
    )
}

# `az ad signed-in-user` follows the CLI's Microsoft tenant even when the
# target subscription is in the Novaro tenant. Use Dan's target-tenant object
# ID supplied in the goal instead of assigning a role to the wrong tenant.
$callerObjectId = "12bcfab7-49ba-4cf7-8be7-780a13911f93"
Ensure-RoleAssignment -AssigneeObjectId $callerObjectId -Role "Key Vault Administrator" -Scope $KeyVaultResourceId -PrincipalType "User"
Start-Sleep -Seconds 20

# Key Vault contains exactly the three prototype credentials. Values never enter
# the agent-version definition or the image build context.
$vaultToken = & az account get-access-token `
    --resource https://vault.azure.net/ --subscription $Subscription `
    --query accessToken --output tsv --only-show-errors 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($vaultToken)) {
    throw "Could not acquire a target-tenant Key Vault data-plane token."
}
$vaultHeaders = @{ Authorization = "Bearer $vaultToken" }
try {
    Set-KeyVaultSecret -Name "copilot-token" -Value $copilotToken -Headers $vaultHeaders
    Set-KeyVaultSecret -Name "github-token" -Value $githubToken -Headers $vaultHeaders
    # Seed the Codex login once. Overwriting a renewed copy with the original
    # file would bring back an invalidated refresh token.
    $existing = Invoke-WebRequest -Uri "https://$KeyVaultName.vault.azure.net/secrets/codex-login?api-version=7.4" `
        -Headers $vaultHeaders -UseBasicParsing -SkipHttpErrorCheck
    if ($existing.StatusCode -notin @(200, 404)) {
        throw "Could not check the stored Codex login (HTTP $($existing.StatusCode))."
    }
    if ($codexLogin -and ($existing.StatusCode -eq 404 -or $ReseedCodexLogin)) {
        Set-KeyVaultSecret -Name "codex-login" -Value $codexLogin -Headers $vaultHeaders
        # Key Vault must hold the only copy: a leftover seed file goes stale at the
        # first renewal and would bring back an invalidated login if reseeded.
        Remove-Item -LiteralPath $CodexLoginPath -Force
        Write-Host "Seeded the Jarvis Codex login in Key Vault and deleted the local seed file."
    } elseif ($existing.StatusCode -eq 200) {
        if ($codexLogin) {
            Write-Warning "Ignoring $CodexLoginPath; Key Vault already holds the Jarvis Codex login. Pass -ReseedCodexLogin to replace it."
        } else {
            Write-Host "Keeping the stored Jarvis Codex login."
        }
    } else {
        Write-Warning "No Jarvis Codex login in Key Vault or at $CodexLoginPath; Codex tasks stay unavailable until one is seeded."
    }
    $existing = $null
} finally {
    $vaultToken = $null
    $vaultHeaders = $null
}
$copilotToken = $null
$githubToken = $null
$codexLogin = $null

if (-not (Test-AzResource -Arguments @("monitor", "log-analytics", "workspace", "show", "--workspace-name", $WorkspaceName, "--resource-group", $ResourceGroup, "--subscription", $Subscription, "--only-show-errors"))) {
    Invoke-AzQuiet @(
        "monitor", "log-analytics", "workspace", "create", "--workspace-name", $WorkspaceName,
        "--resource-group", $ResourceGroup, "--location", $Location,
        "--subscription", $Subscription, "--only-show-errors"
    )
}
if (-not (Test-AzResource -Arguments @("monitor", "app-insights", "component", "show", "--app", $AppInsightsName, "--resource-group", $ResourceGroup, "--subscription", $Subscription, "--only-show-errors"))) {
    Invoke-AzQuiet @(
        "monitor", "app-insights", "component", "create", "--app", $AppInsightsName,
        "--resource-group", $ResourceGroup, "--location", $Location,
        "--application-type", "web", "--workspace", $WorkspaceResourceId,
        "--subscription", $Subscription, "--only-show-errors"
    )
}
Invoke-AzQuiet @(
    "resource", "update", "--ids", $AppInsightsResourceId,
    "--set", "properties.WorkspaceResourceId=$WorkspaceResourceId", "properties.DisableLocalAuth=true",
    "--subscription", $Subscription, "--only-show-errors"
)

# Consumption budgets use the subscription billing currency. This subscription
# is billed in DKK; the threshold is therefore 300 DKK per month.
if (-not (Test-AzResource -Arguments @("consumption", "budget", "show", "--budget-name", $BudgetName, "--resource-group", $ResourceGroup, "--subscription", $Subscription, "--only-show-errors"))) {
    $budgetStart = (Get-Date).ToUniversalTime().Date
    $budgetEnd = $budgetStart.AddYears(1).AddDays(-1)
    $budgetBody = @{
        properties = @{
            category = "Cost"
            amount = 300
            timeGrain = "Monthly"
            timePeriod = @{
                startDate = $budgetStart.ToString("o")
                endDate = $budgetEnd.ToString("o")
            }
            filter = @{ resourceGroups = @($ResourceGroup) }
            notifications = @{
                Actual_GreaterThan_80_Percent = @{
                    enabled = $true
                    operator = "GreaterThan"
                    threshold = 80
                    contactEmails = @("Dan@novaro.dk")
                }
            }
        }
    } | ConvertTo-Json -Depth 20 -Compress
    $budgetBodyPath = Join-Path $env:TEMP ("jarvis-budget-" + [Guid]::NewGuid().ToString("N") + ".json")
    $budgetBody | Set-Content -LiteralPath $budgetBodyPath -Encoding utf8
    try {
        Invoke-AzQuiet @(
            "rest", "--method", "put",
            "--url", "https://management.azure.com/subscriptions/$Subscription/resourceGroups/$ResourceGroup/providers/Microsoft.Consumption/budgets/$BudgetName`?api-version=2019-05-01",
            "--subscription", $Subscription, "--body", "@$budgetBodyPath", "--only-show-errors"
        )
    } finally {
        Remove-Item -LiteralPath $budgetBodyPath -Force -ErrorAction SilentlyContinue
    }
}

$project = Invoke-AzJson @(
    "rest", "--method", "get", "--url", "https://management.azure.com$ProjectResourceId`?api-version=2025-06-01",
    "--subscription", $Subscription, "--only-show-errors"
)
$projectPrincipalId = $project.identity.principalId
if ([string]::IsNullOrWhiteSpace([string]$projectPrincipalId)) {
    throw "Foundry project did not return a system-assigned managed identity."
}
Ensure-RoleAssignment -AssigneeObjectId $callerObjectId -Role "Foundry Project Manager" -Scope $ProjectResourceId -PrincipalType "User"
Ensure-RoleAssignment -AssigneeObjectId $callerObjectId -Role "Foundry Owner" -Scope $ProjectResourceId -PrincipalType "User"
Ensure-RoleAssignment -AssigneeObjectId $callerObjectId -Role "Foundry User" -Scope $ProjectResourceId -PrincipalType "User"
Ensure-RoleAssignment -AssigneeObjectId $callerObjectId -Role "Foundry Account Owner" -Scope $FoundryResourceId -PrincipalType "User"
Ensure-RoleAssignment -AssigneeObjectId $projectPrincipalId -Role "Foundry User" -Scope $FoundryResourceId
Start-Sleep -Seconds 30
$foundry = Invoke-AzJson @(
    "rest", "--method", "get", "--url", "https://management.azure.com$FoundryResourceId`?api-version=2025-06-01",
    "--subscription", $Subscription, "--only-show-errors"
)
$foundryPrincipalId = $foundry.identity.principalId

if ($projectPrincipalId) {
    Ensure-RoleAssignment -AssigneeObjectId $projectPrincipalId -Role "AcrPull" -Scope $RegistryResourceId
}
Ensure-RoleAssignment -AssigneeObjectId $projectPrincipalId -Role "Log Analytics Data Reader" -Scope $WorkspaceResourceId
Ensure-RoleAssignment -AssigneeObjectId $projectPrincipalId -Role "Monitoring Metrics Publisher" -Scope $AppInsightsResourceId

# Hosted Agents require project connections for the image registry and trace
# destination. Credentials remain managed by Azure; these connections contain
# only resource identifiers and non-secret endpoints.
Ensure-ProjectConnection -Name "jarvis-acr" -Properties @{
    category = "ContainerRegistry"
    target = "$RegistryName.azurecr.io"
    authType = "None"
    metadata = @{ ResourceId = $RegistryResourceId }
}
$appInsightsConnectionString = & az monitor app-insights component show `
    --app $AppInsightsName --resource-group $ResourceGroup --subscription $Subscription `
    --query connectionString --output tsv --only-show-errors 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($appInsightsConnectionString)) {
    throw "Application Insights did not return a connection string for its Foundry project connection."
}
Ensure-ProjectConnection -Name "jarvis-appinsights" -Properties @{
    category = "AppInsights"
    target = $AppInsightsResourceId
    authType = "ProjectManagedIdentity"
    metadata = @{
        ResourceId = $AppInsightsResourceId
        ApplicationInsightsConnectionString = $appInsightsConnectionString
    }
}
$appInsightsConnectionString = $null

$image = "$RegistryName.azurecr.io/jarvis-runner:$ImageTag"
if (-not $SkipImageBuild) {
    Invoke-AzQuiet @(
        "acr", "build", "--registry", $RegistryName, "--image", $image,
        "--file", (Join-Path $Root "runner/Dockerfile"), (Join-Path $Root "runner"),
        "--platform", "linux/amd64", "--no-logs", "--no-wait",
        "--subscription", $Subscription, "--only-show-errors"
    )
    $AcrBuildRunId = $null
    for ($attempt = 1; $attempt -le 15; $attempt++) {
        $runOutput = & az acr task list-runs --registry $RegistryName --top 1 `
            --subscription $Subscription --query "[0].runId" --output tsv --only-show-errors 2>&1
        if ($LASTEXITCODE -eq 0 -and $runOutput) {
            $AcrBuildRunId = ($runOutput -join "`n").Trim()
            break
        }
        Start-Sleep -Seconds 5
    }
    if ([string]::IsNullOrWhiteSpace($AcrBuildRunId)) { throw "ACR build did not return a run ID." }
    for ($attempt = 1; $attempt -le 90; $attempt++) {
        $runStatusOutput = & az acr task show-run --registry $RegistryName --run-id $AcrBuildRunId `
            --subscription $Subscription --query status --output tsv --only-show-errors 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Could not read ACR build status: $($runStatusOutput -join "`n")" }
        $runStatus = ($runStatusOutput -join "`n").Trim()
        Write-Host "ACR build run $AcrBuildRunId status: $runStatus (attempt $attempt/90)"
        if ($runStatus -eq "Succeeded") { break }
        if ($runStatus -in @("Failed", "Canceled", "Timeout")) { throw "ACR build run $AcrBuildRunId ended with status $runStatus" }
        Start-Sleep -Seconds 20
    }
    if ($runStatus -ne "Succeeded") { throw "Timed out waiting for ACR build run $AcrBuildRunId" }
}

# An ACR build run ID identifies the build execution; it is not an image tag.
# Verify the selected tag (including an override used with -SkipImageBuild)
# before the Foundry version request so a stale or mistyped reference cannot
# be hidden by -AllowHostedAgentFailure.
$ImageDigest = Assert-AcrManifest `
    -Tag $ImageTag -RegistryName $RegistryName -Subscription $Subscription
Write-Host "Selected runner image tag: $ImageTag (manifest digest: $ImageDigest)"

try {
$versionDefinition = @{
        kind = "hosted"
        # The runner image contains both coding CLIs and their runtimes.  The
        # 1 vCPU/2 GiB tier is the smallest tier that can stage this image.
        cpu = "1"
        memory = "2Gi"
        container_configuration = @{ image = $image }
        protocol_versions = @(@{ protocol = "invocations"; version = "2.0.0" })
        environment_variables = @{
            KEY_VAULT_URI = "https://$KeyVaultName.vault.azure.net/"
            JARVIS_WORK_ROOT = "/files/jarvis"
        }
        session_configuration = @{ idle_timeout_seconds = 120 }
}
$connections = $null
for ($attempt = 1; $attempt -le 60; $attempt++) {
    try {
        $connections = Invoke-FoundryDataPlane -Method get `
            -Url "$ProjectEndpoint/connections?api-version=v1"
        break
    } catch {
        if ($_.Exception.Message -notmatch "HTTP 404") { throw }
        Write-Host "Foundry project data plane is not ready (attempt $attempt/60); retrying."
        Start-Sleep -Seconds 15
    }
}
if ($null -eq $connections) {
    throw "Foundry project data plane did not become ready after 15 minutes."
}
Write-Host "Foundry data-plane preflight passed: connections returned HTTP 200."

# The Agent Service supports routing for a named agent before the agent record
# exists.  The collection route is not available for this project, so do not
# use GET /agents or POST /agents as an existence/creation gate.  The
# documented create-version operation is always scoped to the agent name.
$versionPostUrl = "$ProjectEndpoint/agents/$AgentName/versions?api-version=v1"
$versionPostBody = @{ definition = $versionDefinition } |
    ConvertTo-Json -Depth 20 -Compress
$version = Invoke-FoundryDataPlane -Method post -Url $versionPostUrl -Body $versionPostBody
$versionNumber = [string]$version.version
if ([string]::IsNullOrWhiteSpace($versionNumber)) {
    throw "Foundry did not return an agent version from the documented agent create/version endpoint."
}

$status = "creating"
for ($attempt = 1; $attempt -le 90; $attempt++) {
    Start-Sleep -Seconds 10
    $current = Invoke-FoundryDataPlane -Method get `
        -Url "$ProjectEndpoint/agents/$AgentName/versions/$versionNumber`?api-version=v1"
    $status = [string]$current.status
    Write-Host "Hosted agent version $versionNumber status: $status (attempt $attempt/90)"
    if ($status -eq "active") {
        break
    }
    if ($status -eq "failed") {
        throw "Hosted agent version provisioning failed: $($current.error | ConvertTo-Json -Depth 10 -Compress)"
    }
}
if ($status -ne "active") { throw "Timed out waiting for hosted agent version $versionNumber" }

$activeVersion = Invoke-FoundryDataPlane -Method get `
    -Url "$ProjectEndpoint/agents/$AgentName/versions/$versionNumber`?api-version=v1"
$idleTimeout = $activeVersion.definition.session_configuration.idle_timeout_seconds
if ([int]$idleTimeout -ne 120) {
    throw "Hosted agent version did not retain the required 120-second idle timeout."
}

# New agents default to a Responses endpoint even when the version declares
# Invocations.  Select the active version explicitly and configure the
# Invocations protocol before probing or using the endpoint.
$endpointPatch = @{
    agent_endpoint = @{
        version_selector = @{
            version_selection_rules = @(
                @{
                    agent_version = $versionNumber
                    traffic_percentage = 100
                    type = "FixedRatio"
                }
            )
        }
        protocol_configuration = @{ invocations = @{} }
    }
} | ConvertTo-Json -Depth 20 -Compress
Invoke-FoundryDataPlane -Method patch `
    -Url "$ProjectEndpoint/agents/$AgentName`?api-version=v1" `
    -Body $endpointPatch -MergePatch | Out-Null
$agentRecord = Invoke-FoundryDataPlane -Method get `
    -Url "$ProjectEndpoint/agents/$AgentName`?api-version=v1"
$agentPrincipalId = $null
if (
    $agentRecord.PSObject.Properties.Name -contains "instance_identity" -and
    $agentRecord.instance_identity -and
    $agentRecord.instance_identity.PSObject.Properties.Name -contains "principal_id"
) {
    $agentPrincipalId = [string]$agentRecord.instance_identity.principal_id
}
if ([string]::IsNullOrWhiteSpace($agentPrincipalId)) {
    if (
        $activeVersion.PSObject.Properties.Name -contains "instance_identity" -and
        $activeVersion.instance_identity -and
        $activeVersion.instance_identity.PSObject.Properties.Name -contains "principal_id"
    ) {
        $agentPrincipalId = [string]$activeVersion.instance_identity.principal_id
    }
}
if ([string]::IsNullOrWhiteSpace($agentPrincipalId)) {
    throw "Hosted agent did not return its dedicated Entra identity; refusing to deploy without Key Vault and telemetry RBAC."
}
Ensure-RoleAssignment -AssigneeObjectId $agentPrincipalId -Role "Key Vault Secrets User" -Scope $KeyVaultResourceId
# The runner writes a renewed Codex login back. Write access covers that one
# secret only, never the Copilot or GitHub tokens.
$vaultCheckToken = & az account get-access-token --resource https://vault.azure.net/ --subscription $Subscription `
    --query accessToken --output tsv --only-show-errors 2>$null
$codexSecretCheck = Invoke-WebRequest -Uri "https://$KeyVaultName.vault.azure.net/secrets/codex-login?api-version=7.4" `
    -Headers @{ Authorization = "Bearer $vaultCheckToken" } -UseBasicParsing -SkipHttpErrorCheck
$vaultCheckToken = $null
if ($codexSecretCheck.StatusCode -eq 200) {
    Ensure-RoleAssignment -AssigneeObjectId $agentPrincipalId -Role "Key Vault Secrets Officer" `
        -Scope "$KeyVaultResourceId/secrets/codex-login"
}
$codexSecretCheck = $null
Ensure-RoleAssignment -AssigneeObjectId $agentPrincipalId -Role "Monitoring Metrics Publisher" -Scope $AppInsightsResourceId
Start-Sleep -Seconds 30

# A new project's runtime host can answer "Project not found" for a while after
# its administration host already works (observed 2 October 2026). Wait for it.
$runtimeReady = $false
for ($attempt = 1; $attempt -le 60; $attempt++) {
    try {
        Invoke-FoundryDataPlane -Method get `
            -Url "$RuntimeProjectEndpoint/agents/$AgentName/endpoint/sessions?api-version=v1" | Out-Null
        $runtimeReady = $true
        break
    } catch {
        if ($_.Exception.Message -notmatch "HTTP 404") { throw }
        Write-Host "Foundry runtime endpoint is not ready for this project (attempt $attempt/60); retrying."
        Start-Sleep -Seconds 30
    }
}
if (-not $runtimeReady) {
    throw "Foundry runtime endpoint did not recognize project $ProjectName after 30 minutes."
}
Write-Host "Foundry runtime endpoint is ready: sessions returned HTTP 200."

# The platform-created agent identity is not usable from the local CLI. A
# runner-side probe reads the secrets and returns only a boolean, proving that
# the identity/RBAC path works without exposing a credential value.
$probeBody = @{ agent = "copilot"; probe = "key-vault"; task = "runtime credential probe" } |
    ConvertTo-Json -Compress
$probe = Invoke-FoundryDataPlane -Method post `
    -Url "$RuntimeProjectEndpoint/agents/$AgentName/endpoint/protocols/invocations?api-version=v1" `
    -Body $probeBody
if ($null -eq $probe -or $probe.key_vault_access -ne $true) {
    throw "Hosted agent runtime Key Vault probe did not report access."
}
if ($probe.PSObject.Properties.Name -contains "session_id" -and $probe.session_id) {
    Invoke-FoundryDataPlane -Method delete `
        -Url "$RuntimeProjectEndpoint/agents/$AgentName/endpoint/sessions/$($probe.session_id)?api-version=v1" | Out-Null
}
Write-Host "Hosted agent identity and Key Vault runtime probe passed."

$state = [ordered]@{
    subscription = $Subscription
    tenant = $Tenant
    resourceGroup = $ResourceGroup
    location = $Location
    foundryAccount = $FoundryAccount
    projectName = $ProjectName
    agentName = $AgentName
    agentVersion = $versionNumber
    controlPlaneProjectEndpoint = $ProjectEndpoint
    runtimeProjectEndpoint = $RuntimeProjectEndpoint
    projectEndpoint = $RuntimeProjectEndpoint
    registry = $RegistryName
    image = $image
    imageTag = $ImageTag
    imageDigest = $ImageDigest
    acrBuildRunId = $AcrBuildRunId
    workspace = $WorkspaceName
    keyVault = $KeyVaultName
    appInsights = $AppInsightsName
    agentPrincipalId = $agentPrincipalId
    budget = $BudgetName
    deployedAtUtc = [DateTime]::UtcNow.ToString("o")
}
$state | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $StatePath -Encoding utf8
Write-Host "Deployment complete. State written to $StatePath"
Write-Host "Runtime project endpoint: $RuntimeProjectEndpoint"
Write-Host "Agent version: $versionNumber (idle timeout: 120 seconds)"
} catch {
    if (-not $AllowHostedAgentFailure) { throw }
    $hostedError = $_.Exception.Message
    $state = [ordered]@{
        subscription = $Subscription
        tenant = $Tenant
        resourceGroup = $ResourceGroup
        location = $Location
        foundryAccount = $FoundryAccount
        projectName = $ProjectName
        agentName = $AgentName
        agentVersion = $null
        controlPlaneProjectEndpoint = $ProjectEndpoint
        runtimeProjectEndpoint = $RuntimeProjectEndpoint
        projectEndpoint = $RuntimeProjectEndpoint
        hostedAgentStatus = "Blocked"
        hostedAgentError = $hostedError
        registry = $RegistryName
        image = $image
        imageTag = $ImageTag
        imageDigest = $ImageDigest
        acrBuildRunId = $AcrBuildRunId
        workspace = $WorkspaceName
        keyVault = $KeyVaultName
        appInsights = $AppInsightsName
        budget = $BudgetName
        deployedAtUtc = [DateTime]::UtcNow.ToString("o")
    }
    $state | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $StatePath -Encoding utf8
    Write-Warning "Hosted agent deployment is blocked, but supporting resources are deployed: $hostedError"
    Write-Host "Deployment finished with hosted-agent status Blocked. State written to $StatePath"
}
