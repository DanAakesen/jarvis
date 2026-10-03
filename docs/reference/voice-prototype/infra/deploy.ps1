[CmdletBinding()]
param(
    [string]$Subscription = "0ac7d719-89bc-4100-be87-a79d33e953a7",
    [string]$Tenant = "802efa29-17f2-4a79-8f5f-38f087aed96a",
    [string]$ResourceGroup = "rg-jarvis-voice-poc",
    [string]$Location = "swedencentral",
    # Leave empty to reuse the group's single Foundry account or create a new
    # timestamped one. Never reuse a purged name (jarvis.md learnings).
    [string]$FoundryAccount,
    [string]$ProjectName,
    [string]$JarvisModel = "gpt-5.6-luna",
    [string]$ReasoningEffort = "none",
    [switch]$SkipImageBuild,
    [string]$ImageTagOverride
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
$StatePath = Join-Path $PSScriptRoot ".deployment-state.json"
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$AgentName = "jarvis-voice-target"
$Suffix = $Subscription.Substring(0, 8)
$RegistryName = "jvoice$($Suffix)acr"
$StorageName = "jvoice$($Suffix)st"
$ToolTable = "toolcalls"
$WorkspaceName = "jarvis-voice-law"
$AppInsightsName = "jarvis-voice-appins"
$BudgetName = "jarvis-voice-budget"
$BudgetAmount = 100
# Dan's object ID in the Novaro tenant. `az ad signed-in-user` follows the CLI's
# default (Microsoft) tenant, so it cannot be used here.
$CallerObjectId = "12bcfab7-49ba-4cf7-8be7-780a13911f93"
$Models = @(
    @{ name = "gpt-5.4-mini"; version = "2026-03-17" },
    @{ name = "gpt-5.6-luna"; version = "2026-07-09" },
    @{ name = "gpt-5.4"; version = "2026-03-05" }
)
$ImageTag = if ($ImageTagOverride) { $ImageTagOverride } else { "voice-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))" }

$Rg = "/subscriptions/$Subscription/resourceGroups/$ResourceGroup"
$RegistryResourceId = "$Rg/providers/Microsoft.ContainerRegistry/registries/$RegistryName"
$StorageResourceId = "$Rg/providers/Microsoft.Storage/storageAccounts/$StorageName"
$WorkspaceResourceId = "$Rg/providers/Microsoft.OperationalInsights/workspaces/$WorkspaceName"
$AppInsightsResourceId = "$Rg/providers/Microsoft.Insights/components/$AppInsightsName"

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

function Test-AzResource {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $null = & az @Arguments 2>&1
    return $LASTEXITCODE -eq 0
}

function New-ArmResource {
    param([Parameter(Mandatory)][string]$Url, [Parameter(Mandatory)][hashtable]$Body, [string]$ApiVersion = "2025-06-01")
    $bodyPath = Join-Path $env:TEMP ("jarvis-voice-arm-" + [Guid]::NewGuid().ToString("N") + ".json")
    $Body | ConvertTo-Json -Depth 20 -Compress | Set-Content -LiteralPath $bodyPath -Encoding utf8
    try {
        return Invoke-AzJson @("rest", "--method", "put", "--url", "$Url`?api-version=$ApiVersion",
            "--subscription", $Subscription, "--body", "@$bodyPath", "--only-show-errors")
    } finally { Remove-Item -LiteralPath $bodyPath -Force -ErrorAction SilentlyContinue }
}

function Get-ArmResource {
    param([Parameter(Mandatory)][string]$ResourceId, [string]$ApiVersion = "2025-06-01")
    $output = & az resource show --ids $ResourceId --api-version $ApiVersion --subscription $Subscription --only-show-errors 2>&1
    if ($LASTEXITCODE -ne 0) { return $null }
    return ($output -join "`n" | ConvertFrom-Json)
}

function Wait-ArmResource {
    param([Parameter(Mandatory)][string]$ResourceId, [string]$ApiVersion = "2025-06-01", [int]$Attempts = 90)
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        $resource = Get-ArmResource -ResourceId $ResourceId -ApiVersion $ApiVersion
        $state = if ($resource -and $resource.properties -and $resource.properties.PSObject.Properties.Name -contains "provisioningState") {
            [string]$resource.properties.provisioningState
        } elseif ($resource) { "Succeeded" } else { "Missing" }
        if ($state -notin @("Creating", "Updating", "Accepted", "Missing", "ResolvingDns", "Provisioning")) {
            if ($state -ne "Succeeded") { throw "$($ResourceId.Split('/')[-1]) ended in state $state" }
            return $resource
        }
        Write-Host "  waiting for $($ResourceId.Split('/')[-1]): $state ($attempt/$Attempts)"
        Start-Sleep -Seconds 10
    }
    throw "Timed out waiting for $ResourceId"
}

function Ensure-RoleAssignment {
    param(
        [Parameter(Mandatory)][string]$AssigneeObjectId,
        [Parameter(Mandatory)][string]$Role,
        [Parameter(Mandatory)][string]$Scope,
        [string]$PrincipalType = "ServicePrincipal"
    )
    $definition = Invoke-AzJson @("role", "definition", "list", "--name", $Role, "--subscription", $Subscription, "--only-show-errors")
    $roleDefinitionId = @($definition)[0].id
    if (-not $roleDefinitionId) { throw "Could not resolve role '$Role'" }
    $existing = Invoke-AzJson @("rest", "--method", "get",
        "--url", "https://management.azure.com$Scope/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01",
        "--subscription", $Subscription, "--only-show-errors")
    $match = @($existing.value | Where-Object {
        $_.properties.principalId -eq $AssigneeObjectId -and $_.properties.roleDefinitionId -eq $roleDefinitionId
    })
    if ($match.Count -gt 0) { return }
    $body = @{ properties = @{ roleDefinitionId = $roleDefinitionId; principalId = $AssigneeObjectId; principalType = $PrincipalType } }
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        try {
            New-ArmResource -Url "https://management.azure.com$Scope/providers/Microsoft.Authorization/roleAssignments/$([Guid]::NewGuid())" `
                -Body $body -ApiVersion "2022-04-01" | Out-Null
            Write-Host "  role '$Role' assigned on $($Scope.Split('/')[-1])"
            return
        } catch {
            # A new managed identity can take a minute to replicate to Entra ID.
            if ($_.Exception.Message -notmatch "PrincipalNotFound|does not exist in the directory") { throw }
            Start-Sleep -Seconds 15
        }
    }
    throw "Role assignment '$Role' failed: principal $AssigneeObjectId not found"
}

function Get-FoundryToken {
    $token = & az account get-access-token --resource "https://ai.azure.com/" --subscription $Subscription `
        --query accessToken --output tsv --only-show-errors 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $token) { throw "Could not get a Foundry token for subscription $Subscription" }
    return $token
}

function Invoke-Foundry {
    param([Parameter(Mandatory)][ValidateSet("get", "post", "patch", "delete")][string]$Method,
        [Parameter(Mandatory)][string]$Url, [string]$Body, [switch]$MergePatch)
    $headers = @{ Authorization = "Bearer $(Get-FoundryToken)" }
    $params = @{ Method = $Method; Uri = $Url; Headers = $headers; ErrorAction = "Stop" }
    if ($Body) {
        $params.ContentType = if ($MergePatch) { "application/merge-patch+json" } else { "application/json" }
        $params.Body = [Text.Encoding]::UTF8.GetBytes($Body)
    }
    try { return Invoke-RestMethod @params }
    catch {
        $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
        $detail = if ($_.ErrorDetails) { $_.ErrorDetails.Message } else { $_.Exception.Message }
        throw "Foundry $Method $Url failed (HTTP $status): $detail"
    }
}

Write-Host "Subscription $Subscription, resource group $ResourceGroup ($Location)"
$tenantOfSubscription = & az account show --subscription $Subscription --query tenantId -o tsv --only-show-errors 2>$null
if ($tenantOfSubscription -ne $Tenant) { throw "Azure CLI is not signed in to subscription $Subscription in tenant $Tenant." }
if (-not (Test-Path $Python)) { throw "Python environment missing: run the setup in README.md first." }
foreach ($provider in "Microsoft.CognitiveServices", "Microsoft.ContainerRegistry", "Microsoft.Storage", "Microsoft.Insights", "Microsoft.OperationalInsights", "Microsoft.Consumption") {
    $registration = & az provider show --namespace $provider --subscription $Subscription --query registrationState -o tsv --only-show-errors 2>$null
    if ($registration -ne "Registered") { throw "$provider is not registered in the subscription." }
}

Invoke-AzQuiet @("group", "create", "--name", $ResourceGroup, "--location", $Location, "--subscription", $Subscription, "--only-show-errors")

# --- Foundry account and project -------------------------------------------
if (-not $FoundryAccount) {
    $accounts = @(Invoke-AzJson @("cognitiveservices", "account", "list", "--resource-group", $ResourceGroup,
        "--subscription", $Subscription, "--query", "[?kind=='AIServices'].name", "--only-show-errors"))
    if ($accounts.Count -gt 1) { throw "Several Foundry accounts exist ($($accounts -join ', ')); pass -FoundryAccount." }
    $FoundryAccount = if ($accounts.Count -eq 1) { [string]$accounts[0] } else { "jarvisvoice$([DateTime]::UtcNow.ToString('MMddHHmm'))" }
}
$FoundryResourceId = "$Rg/providers/Microsoft.CognitiveServices/accounts/$FoundryAccount"
if (-not (Get-ArmResource -ResourceId $FoundryResourceId)) {
    Write-Host "Creating Foundry account $FoundryAccount"
    New-ArmResource -Url "https://management.azure.com$FoundryResourceId" -Body @{
        location = $Location; sku = @{ name = "S0" }; kind = "AIServices"; identity = @{ type = "SystemAssigned" }
        properties = @{ customSubDomainName = $FoundryAccount; publicNetworkAccess = "Enabled"; allowProjectManagement = $true; disableLocalAuth = $true }
    } | Out-Null
}
$foundry = Wait-ArmResource -ResourceId $FoundryResourceId
$accountEndpoint = ([string]$foundry.properties.endpoint).TrimEnd('/')

if (-not $ProjectName) {
    $projects = @(Invoke-AzJson @("rest", "--method", "get", "--url", "https://management.azure.com$FoundryResourceId/projects?api-version=2025-06-01",
        "--subscription", $Subscription, "--query", "value[].name", "--only-show-errors") | ForEach-Object { ([string]$_).Split('/')[-1] })
    if ($projects.Count -gt 1) { throw "Several projects exist ($($projects -join ', ')); pass -ProjectName." }
    $ProjectName = if ($projects.Count -eq 1) { $projects[0] } else { "jarvis-voice-$([DateTime]::UtcNow.ToString('MMddHHmm'))" }
}
$ProjectResourceId = "$FoundryResourceId/projects/$ProjectName"
if (-not (Get-ArmResource -ResourceId $ProjectResourceId)) {
    Write-Host "Creating Foundry project $ProjectName"
    New-ArmResource -Url "https://management.azure.com$ProjectResourceId" -ApiVersion "2025-04-01-preview" -Body @{
        location = $Location; identity = @{ type = "SystemAssigned" }
        properties = @{ displayName = "Jarvis Danish voice"; description = "Prototype for the Jarvis Danish voice path." }
    } | Out-Null
}
$project = Wait-ArmResource -ResourceId $ProjectResourceId
$ProjectEndpoint = "https://$FoundryAccount.services.ai.azure.com/api/projects/$ProjectName"
$RuntimeProjectEndpoint = "$accountEndpoint/api/projects/$ProjectName"
$projectPrincipalId = [string]$project.identity.principalId

# --- Model deployments -----------------------------------------------------
foreach ($model in $Models) {
    $deploymentId = "$FoundryResourceId/deployments/$($model.name)"
    if (-not (Get-ArmResource -ResourceId $deploymentId)) {
        Write-Host "Deploying model $($model.name)"
        New-ArmResource -Url "https://management.azure.com$deploymentId" -Body @{
            sku = @{ name = "GlobalStandard"; capacity = 50 }
            properties = @{ model = @{ format = "OpenAI"; name = $model.name; version = $model.version } }
        } | Out-Null
    }
    Wait-ArmResource -ResourceId $deploymentId | Out-Null
}

# --- Supporting resources --------------------------------------------------
if (-not (Test-AzResource @("acr", "show", "--name", $RegistryName, "--subscription", $Subscription, "--only-show-errors"))) {
    Write-Host "Creating container registry $RegistryName"
    Invoke-AzQuiet @("acr", "create", "--name", $RegistryName, "--resource-group", $ResourceGroup, "--location", $Location,
        "--sku", "Basic", "--admin-enabled", "false", "--subscription", $Subscription, "--only-show-errors")
}
Invoke-AzQuiet @("acr", "config", "authentication-as-arm", "update", "--registry", $RegistryName, "--status", "enabled",
    "--subscription", $Subscription, "--only-show-errors")

if (-not (Get-ArmResource -ResourceId $StorageResourceId -ApiVersion "2024-01-01")) {
    Write-Host "Creating storage account $StorageName for the tool log"
    New-ArmResource -Url "https://management.azure.com$StorageResourceId" -ApiVersion "2024-01-01" -Body @{
        location = $Location; kind = "StorageV2"; sku = @{ name = "Standard_LRS" }
        properties = @{ allowSharedKeyAccess = $false; minimumTlsVersion = "TLS1_2"; allowBlobPublicAccess = $false }
    } | Out-Null
}
Wait-ArmResource -ResourceId $StorageResourceId -ApiVersion "2024-01-01" | Out-Null
New-ArmResource -Url "https://management.azure.com$StorageResourceId/tableServices/default/tables/$ToolTable" -ApiVersion "2024-01-01" -Body @{ properties = @{} } | Out-Null

if (-not (Test-AzResource @("monitor", "log-analytics", "workspace", "show", "--resource-group", $ResourceGroup, "--workspace-name", $WorkspaceName, "--subscription", $Subscription, "--only-show-errors"))) {
    Invoke-AzQuiet @("monitor", "log-analytics", "workspace", "create", "--resource-group", $ResourceGroup, "--workspace-name", $WorkspaceName,
        "--location", $Location, "--subscription", $Subscription, "--only-show-errors")
}
if (-not (Test-AzResource @("monitor", "app-insights", "component", "show", "--app", $AppInsightsName, "--resource-group", $ResourceGroup, "--subscription", $Subscription, "--only-show-errors"))) {
    Invoke-AzQuiet @("monitor", "app-insights", "component", "create", "--app", $AppInsightsName, "--resource-group", $ResourceGroup,
        "--location", $Location, "--application-type", "web", "--workspace", $WorkspaceResourceId, "--subscription", $Subscription, "--only-show-errors")
}

$budgetUrl = "https://management.azure.com$Rg/providers/Microsoft.Consumption/budgets/$BudgetName"
if (-not (Test-AzResource @("rest", "--method", "get", "--url", "$budgetUrl`?api-version=2019-05-01", "--subscription", $Subscription, "--only-show-errors"))) {
    $start = (Get-Date).ToUniversalTime().Date
    $start = $start.AddDays(1 - $start.Day)
    New-ArmResource -Url $budgetUrl -ApiVersion "2019-05-01" -Body @{
        properties = @{
            category = "Cost"; amount = $BudgetAmount; timeGrain = "Monthly"
            timePeriod = @{
                startDate = $start.ToString("yyyy-MM-dd'T'00':'00':'00'Z'", [Globalization.CultureInfo]::InvariantCulture)
                endDate = $start.AddYears(1).ToString("yyyy-MM-dd'T'00':'00':'00'Z'", [Globalization.CultureInfo]::InvariantCulture)
            }
            notifications = @{ Actual_GreaterThan_80_Percent = @{ enabled = $true; operator = "GreaterThan"; threshold = 80; contactEmails = @("Dan@novaro.dk") } }
        }
    } | Out-Null
}

# --- Roles for Dan and the project ------------------------------------------
Ensure-RoleAssignment -AssigneeObjectId $CallerObjectId -PrincipalType "User" -Role "Foundry User" -Scope $ProjectResourceId
Ensure-RoleAssignment -AssigneeObjectId $CallerObjectId -PrincipalType "User" -Role "Foundry Project Manager" -Scope $ProjectResourceId
Ensure-RoleAssignment -AssigneeObjectId $CallerObjectId -PrincipalType "User" -Role "Cognitive Services User" -Scope $FoundryResourceId
Ensure-RoleAssignment -AssigneeObjectId $CallerObjectId -PrincipalType "User" -Role "Storage Table Data Contributor" -Scope $StorageResourceId
Ensure-RoleAssignment -AssigneeObjectId $projectPrincipalId -Role "AcrPull" -Scope $RegistryResourceId
Ensure-RoleAssignment -AssigneeObjectId $projectPrincipalId -Role "Monitoring Metrics Publisher" -Scope $AppInsightsResourceId

$appInsightsConnectionString = & az monitor app-insights component show --app $AppInsightsName --resource-group $ResourceGroup `
    --subscription $Subscription --query connectionString -o tsv --only-show-errors
New-ArmResource -Url "https://management.azure.com$ProjectResourceId/connections/jarvis-voice-acr" -Body @{ properties = @{
    category = "ContainerRegistry"; target = "$RegistryName.azurecr.io"; authType = "None"; metadata = @{ ResourceId = $RegistryResourceId } } } | Out-Null
New-ArmResource -Url "https://management.azure.com$ProjectResourceId/connections/jarvis-voice-appinsights" -Body @{ properties = @{
    category = "AppInsights"; target = $AppInsightsResourceId; authType = "ProjectManagedIdentity"
    metadata = @{ ResourceId = $AppInsightsResourceId; ApplicationInsightsConnectionString = $appInsightsConnectionString } } } | Out-Null
$appInsightsConnectionString = $null

# --- Hosted agent image ----------------------------------------------------
$image = "$RegistryName.azurecr.io/jarvis-voice-target:$ImageTag"
if (-not $SkipImageBuild) {
    Write-Host "Building image $image"
    $buildOutput = & az acr build --registry $RegistryName --image $image --platform linux/amd64 `
        --file (Join-Path $Root "agent\Dockerfile") (Join-Path $Root "agent") --no-logs `
        --subscription $Subscription --only-show-errors 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Image build failed: $($buildOutput | Select-Object -Last 20 | Out-String)" }
}
$tagCheck = & az acr repository show-tags --name $RegistryName --repository jarvis-voice-target --subscription $Subscription -o tsv --only-show-errors 2>$null
if ($tagCheck -notcontains $ImageTag) { throw "Image tag $ImageTag is not in $RegistryName." }

# --- Hosted agent version --------------------------------------------------
for ($attempt = 1; $attempt -le 40; $attempt++) {
    try { Invoke-Foundry -Method get -Url "$ProjectEndpoint/connections?api-version=v1" | Out-Null; break }
    catch {
        if ($_.Exception.Message -notmatch "HTTP 404|HTTP 403") { throw }
        Write-Host "  project data plane not ready ($attempt/40)"; Start-Sleep -Seconds 15
    }
}
$versionBody = @{
    metadata = @{ voiceLiveCompatible = "true"; bridgeProtocolVersion = "1.0" }
    definition = @{
        kind = "hosted"
        cpu = "1"
        memory = "2Gi"
        container_configuration = @{ image = $image }
        protocol_versions = @(@{ protocol = "invocations_ws"; version = "1.0.0" })
        environment_variables = @{
            # FOUNDRY_PROJECT_ENDPOINT is injected by the platform (FOUNDRY_* and AGENT_* are reserved).
            AZURE_AI_MODEL_DEPLOYMENT_NAME = $JarvisModel
            AZURE_OPENAI_MAX_OUTPUT_TOKENS = "512"
            JARVIS_REASONING_EFFORT = $ReasoningEffort
            JARVIS_TOOL_LOG_ACCOUNT = $StorageName
            JARVIS_TOOL_LOG_TABLE = $ToolTable
        }
    }
} | ConvertTo-Json -Depth 20 -Compress
$version = Invoke-Foundry -Method post -Url "$ProjectEndpoint/agents/$AgentName/versions?api-version=v1" -Body $versionBody
$versionNumber = [string]$version.version
Write-Host "Hosted agent $AgentName version $versionNumber created"
$status = ""
$current = $null
for ($attempt = 1; $attempt -le 90; $attempt++) {
    Start-Sleep -Seconds 10
    $current = Invoke-Foundry -Method get -Url "$ProjectEndpoint/agents/$AgentName/versions/$versionNumber`?api-version=v1"
    $status = [string]$current.status
    Write-Host "  version $versionNumber status: $status ($attempt/90)"
    if ($status -eq "active") { break }
    if ($status -eq "failed") { throw "Hosted agent version failed: $($current.error | ConvertTo-Json -Depth 10 -Compress)" }
}
if ($status -ne "active") { throw "Timed out waiting for hosted agent version $versionNumber" }

Invoke-Foundry -Method patch -MergePatch -Url "$ProjectEndpoint/agents/$AgentName`?api-version=v1" -Body (@{
    agent_endpoint = @{
        version_selector = @{ version_selection_rules = @(@{ agent_version = $versionNumber; traffic_percentage = 100; type = "FixedRatio" }) }
        protocol_configuration = @{ invocations_ws = @{} }
    }
} | ConvertTo-Json -Depth 20 -Compress) | Out-Null

$agentRecord = Invoke-Foundry -Method get -Url "$ProjectEndpoint/agents/$AgentName`?api-version=v1"
$agentPrincipalId = $null
foreach ($candidate in @($agentRecord, $current)) {
    if ($candidate -and $candidate.PSObject.Properties.Name -contains "instance_identity" -and $candidate.instance_identity) {
        $agentPrincipalId = [string]$candidate.instance_identity.principal_id
        if ($agentPrincipalId) { break }
    }
}
if (-not $agentPrincipalId) { throw "The hosted agent did not return its Entra identity." }
Ensure-RoleAssignment -AssigneeObjectId $agentPrincipalId -Role "Cognitive Services OpenAI User" -Scope $FoundryResourceId
Ensure-RoleAssignment -AssigneeObjectId $agentPrincipalId -Role "Foundry User" -Scope $ProjectResourceId
Ensure-RoleAssignment -AssigneeObjectId $agentPrincipalId -Role "Storage Table Data Contributor" -Scope $StorageResourceId
Ensure-RoleAssignment -AssigneeObjectId $agentPrincipalId -Role "Monitoring Metrics Publisher" -Scope $AppInsightsResourceId

$state = [ordered]@{
    subscription = $Subscription
    tenant = $Tenant
    resourceGroup = $ResourceGroup
    location = $Location
    foundryAccount = $FoundryAccount
    projectName = $ProjectName
    projectEndpoint = $ProjectEndpoint
    runtimeProjectEndpoint = $RuntimeProjectEndpoint
    speechEndpoint = $accountEndpoint
    foundryResourceId = $FoundryResourceId
    hostedAgent = $AgentName
    hostedAgentVersion = $versionNumber
    hostedAgentPrincipalId = $agentPrincipalId
    jarvisModel = $JarvisModel
    reasoningEffort = $ReasoningEffort
    models = @($Models | ForEach-Object { $_.name })
    image = $image
    registry = $RegistryName
    storageAccount = $StorageName
    toolTable = $ToolTable
    appInsights = $AppInsightsName
    budget = $BudgetName
    deployedAtUtc = [DateTime]::UtcNow.ToString("o")
}
$state | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $StatePath -Encoding utf8

# --- Voice agents (SDK) ----------------------------------------------------
Write-Host "Creating voice agents"
& $Python (Join-Path $PSScriptRoot "create_voice_agents.py")
if ($LASTEXITCODE -ne 0) { throw "Creating the voice agents failed." }
& $Python (Join-Path $PSScriptRoot "create_realtime_agents.py")
if ($LASTEXITCODE -ne 0) { throw "Creating the speech-to-speech agents failed." }

Write-Host "Deployment complete. State: $StatePath"
