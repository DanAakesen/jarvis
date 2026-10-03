<#
.SYNOPSIS
    One-time Azure, Entra ID, and GitHub setup that the deploy workflows cannot do for themselves.

.DESCRIPTION
    Idempotent: safe to run again; existing items are reused and only missing ones are created.
    Creates:
      - Resource providers registered on the subscription
      - Resource group
      - Entra app 'jarvis-github-deploy' with a GitHub OIDC federated credential (main branch, immutable-ID subject),
        Contributor and Role Based Access Control Administrator on the resource group
      - Entra app 'jarvis-api' (scope access_as_user, only Dan assigned) and 'jarvis-web' (SPA, pre-authorized)
      - User-assigned managed identity for the backend, and the Entra group 'jarvis-sql-admins'
        (Dan + backend identity) used as the Azure SQL Entra admin
      - The private GitHub repository and its Actions variables (IDs only; no secrets)
    Writes non-secret IDs to infra/bootstrap.output.json.

    Entra calls use a Graph token for the subscription's account, so the Azure CLI default
    subscription and tenant are never changed (L7).

.EXAMPLE
    ./infra/bootstrap.ps1
    ./infra/bootstrap.ps1 -WebRedirectUris 'http://localhost:5173','https://<name>.azurestaticapps.net'
#>
[CmdletBinding()]
param(
    [string]$SubscriptionId = '0ac7d719-89bc-4100-be87-a79d33e953a7',
    [string]$TenantId = '802efa29-17f2-4a79-8f5f-38f087aed96a',
    [string]$Location = 'swedencentral',
    [string]$ResourceGroup = 'rg-jarvis',
    [string]$GitHubRepo = 'DanAakesen/jarvis',
    [string]$OwnerObjectId = '12bcfab7-49ba-4cf7-8be7-780a13911f93',
    [string[]]$WebRedirectUris = @('http://localhost:5173')
)

$ErrorActionPreference = 'Stop'
$graph = 'https://graph.microsoft.com/v1.0'

function Step([string]$text) { Write-Host "-> $text" -ForegroundColor Cyan }

function Invoke-Az {
    $out = & az @args 2>&1
    if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') failed: $out" }
    return $out
}

$token = Invoke-Az account get-access-token --subscription $SubscriptionId --resource-type ms-graph --query accessToken -o tsv
$script:headers = @{ Authorization = "Bearer $token" }

function Invoke-Graph([string]$Method, [string]$Path, $Body) {
    $params = @{ Method = $Method; Uri = "$graph$Path"; Headers = $script:headers; ContentType = 'application/json' }
    if ($null -ne $Body) { $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress) }
    # GET and PATCH are idempotent, so transient network failures are retried; POST is not (re-run the script instead).
    $attempts = if ($Method -eq 'POST') { 1 } else { 4 }
    for ($i = 1; ; $i++) {
        try { return Invoke-RestMethod @params }
        catch {
            $status = $_.Exception.Response.StatusCode.value__
            $transient = (-not $status) -or $status -eq 429 -or $status -ge 500
            if ($i -ge $attempts -or -not $transient) { throw }
            Start-Sleep -Seconds (5 * $i)
        }
    }
}

function Get-OrCreateApp([string]$Name) {
    $found = @((Invoke-Graph GET "/applications?`$filter=displayName eq '$Name'").value)
    if ($found.Count -gt 1) { throw "More than one app named '$Name'; resolve manually." }
    if ($found.Count -eq 1) { Write-Host "   exists: $Name"; return $found[0] }
    Write-Host "   created: $Name"
    Invoke-Graph POST '/applications' @{ displayName = $Name; signInAudience = 'AzureADMyOrg' }
}

function Get-OrCreateServicePrincipal([string]$AppId) {
    $found = @((Invoke-Graph GET "/servicePrincipals?`$filter=appId eq '$AppId'").value)
    if ($found.Count -eq 1) { return $found[0] }
    Invoke-Graph POST '/servicePrincipals' @{ appId = $AppId }
}

function Set-RoleAssignment([string]$PrincipalId, [string]$Role, [string]$Scope) {
    $existing = Invoke-Az role assignment list --scope $Scope --subscription $SubscriptionId -o json | ConvertFrom-Json |
        Where-Object { $_.principalId -eq $PrincipalId -and $_.roleDefinitionName -eq $Role }
    if ($existing) { Write-Host "   exists: $Role"; return }
    for ($i = 1; $i -le 6; $i++) {
        & az role assignment create --assignee-object-id $PrincipalId --assignee-principal-type ServicePrincipal `
            --role $Role --scope $Scope --subscription $SubscriptionId -o none 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { Write-Host "   assigned: $Role"; return }
        Start-Sleep -Seconds 10   # new service principals take a moment to replicate
    }
    throw "Could not assign '$Role' to $PrincipalId"
}

# --- Checks -------------------------------------------------------------------------------
Step 'Checking access'
$me = Invoke-Graph GET '/me?$select=id,userPrincipalName'
if ($me.id -ne $OwnerObjectId) { throw "Signed in to Graph as $($me.userPrincipalName), expected object ID $OwnerObjectId." }
$subTenant = Invoke-Az account show --subscription $SubscriptionId --query tenantId -o tsv
if ($subTenant -ne $TenantId) { throw "Subscription $SubscriptionId is in tenant $subTenant, expected $TenantId." }
& gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI is not signed in; run gh auth login.' }
Write-Host "   Azure and Graph as $($me.userPrincipalName); GitHub CLI signed in"

# --- Subscription -------------------------------------------------------------------------
Step 'Registering resource providers'
$providers = 'Microsoft.App', 'Microsoft.Web', 'Microsoft.Sql', 'Microsoft.Storage', 'Microsoft.KeyVault',
    'Microsoft.ContainerRegistry', 'Microsoft.CognitiveServices', 'Microsoft.OperationalInsights',
    'Microsoft.Insights', 'Microsoft.ManagedIdentity', 'Microsoft.Consumption'
foreach ($p in $providers) { Invoke-Az provider register --namespace $p --subscription $SubscriptionId -o none | Out-Null }
Write-Host "   requested: $($providers.Count) providers"

Step "Resource group $ResourceGroup ($Location)"
Invoke-Az group create -n $ResourceGroup -l $Location --tags project=jarvis --subscription $SubscriptionId -o none | Out-Null
$rgScope = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup"

# --- GitHub repository --------------------------------------------------------------------
Step "GitHub repository $GitHubRepo"
& gh repo view $GitHubRepo --json name 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    & gh repo create $GitHubRepo --private --description 'Jarvis: personal AI platform' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not create $GitHubRepo" }
    Write-Host '   created (private, empty)'
}
$repoJson = & gh api "repos/$GitHubRepo"
if ($LASTEXITCODE -ne 0) { throw "Could not read $GitHubRepo from GitHub" }
$repoInfo = ($repoJson -join "`n") | ConvertFrom-Json
if (-not $repoInfo.id -or -not $repoInfo.owner.id) { throw "GitHub returned no owner or repository ID for $GitHubRepo" }

# --- Deploy identity for GitHub Actions ---------------------------------------------------
Step 'Deploy identity for GitHub Actions'
$deployApp = Get-OrCreateApp 'jarvis-github-deploy'
$deploySp = Get-OrCreateServicePrincipal $deployApp.appId
$subject = "repo:${GitHubRepo}:ref:refs/heads/main"
# GitHub also issues OIDC subjects with immutable owner and repository IDs
# (repo:owner@ownerId/name@repoId:...); trust both forms for main only.
$idSubject = "repo:$($repoInfo.owner.login)@$($repoInfo.owner.id)/$($repoInfo.name)@$($repoInfo.id):ref:refs/heads/main"
$subjects = [ordered]@{ 'github-main' = $subject; 'github-main-ids' = $idSubject }
$creds = @((Invoke-Graph GET "/applications/$($deployApp.id)/federatedIdentityCredentials").value)
foreach ($name in $subjects.Keys) {
    if (-not ($creds | Where-Object { $_.subject -eq $subjects[$name] })) {
        Invoke-Graph POST "/applications/$($deployApp.id)/federatedIdentityCredentials" @{
            name = $name; issuer = 'https://token.actions.githubusercontent.com'
            subject = $subjects[$name]; audiences = @('api://AzureADTokenExchange')
        } | Out-Null
        Write-Host "   federated credential: $($subjects[$name])"
    }
}
Set-RoleAssignment $deploySp.id 'Contributor' $rgScope
# Needed because Bicep assigns roles to Jarvis's managed identities; limited to this resource group.
Set-RoleAssignment $deploySp.id 'Role Based Access Control Administrator' $rgScope

# --- Sign-in apps -------------------------------------------------------------------------
Step 'Sign-in apps: jarvis-api and jarvis-web'
$apiApp = Get-OrCreateApp 'jarvis-api'
$webApp = Get-OrCreateApp 'jarvis-web'
$apiApp = Invoke-Graph GET "/applications/$($apiApp.id)"
$scope = $apiApp.api.oauth2PermissionScopes | Where-Object { $_.value -eq 'access_as_user' }
$scopeId = if ($scope) { $scope.id } else { [guid]::NewGuid().ToString() }
Invoke-Graph PATCH "/applications/$($apiApp.id)" @{
    identifierUris = @("api://$($apiApp.appId)")
    api = @{
        requestedAccessTokenVersion = 2
        oauth2PermissionScopes = @(@{
            id = $scopeId; value = 'access_as_user'; type = 'User'; isEnabled = $true
            adminConsentDisplayName = 'Use Jarvis'; adminConsentDescription = 'Sign in to the Jarvis backend as the signed-in user.'
            userConsentDisplayName = 'Use Jarvis'; userConsentDescription = 'Sign in to the Jarvis backend as you.'
        })
    }
} | Out-Null
Invoke-Graph PATCH "/applications/$($apiApp.id)" @{
    api = @{ preAuthorizedApplications = @(@{ appId = $webApp.appId; delegatedPermissionIds = @($scopeId) }) }
} | Out-Null
$webCurrent = Invoke-Graph GET "/applications/$($webApp.id)?`$select=spa"
$WebRedirectUris = @(@($webCurrent.spa.redirectUris) + $WebRedirectUris | Where-Object { $_ } | Sort-Object -Unique)   # never drop URIs added later
Invoke-Graph PATCH "/applications/$($webApp.id)" @{
    spa = @{ redirectUris = @($WebRedirectUris) }
    requiredResourceAccess = @(@{ resourceAppId = $apiApp.appId; resourceAccess = @(@{ id = $scopeId; type = 'Scope' }) })
} | Out-Null
$apiSp = Get-OrCreateServicePrincipal $apiApp.appId
Get-OrCreateServicePrincipal $webApp.appId | Out-Null
# Only assigned users can get tokens for the API; Dan is the only assignment. The backend's allow-list is a second check.
Invoke-Graph PATCH "/servicePrincipals/$($apiSp.id)" @{ appRoleAssignmentRequired = $true } | Out-Null
$assigned = @((Invoke-Graph GET "/servicePrincipals/$($apiSp.id)/appRoleAssignedTo").value) | Where-Object { $_.principalId -eq $OwnerObjectId }
if (-not $assigned) {
    Invoke-Graph POST "/servicePrincipals/$($apiSp.id)/appRoleAssignedTo" @{
        principalId = $OwnerObjectId; resourceId = $apiSp.id; appRoleId = '00000000-0000-0000-0000-000000000000'
    } | Out-Null
}
Write-Host "   redirect URIs: $($WebRedirectUris -join ', ')"

# --- Backend identity and SQL admins ------------------------------------------------------
Step 'Backend identity and SQL admin group'
$identity = Invoke-Az identity create -g $ResourceGroup -n 'id-jarvis-backend' -l $Location --subscription $SubscriptionId -o json | ConvertFrom-Json
$group = @((Invoke-Graph GET "/groups?`$filter=displayName eq 'jarvis-sql-admins'").value) | Select-Object -First 1
if (-not $group) {
    $group = Invoke-Graph POST '/groups' @{
        displayName = 'jarvis-sql-admins'; description = 'Entra admins of the Jarvis Azure SQL server'
        mailEnabled = $false; mailNickname = 'jarvis-sql-admins'; securityEnabled = $true
        'owners@odata.bind' = @("$graph/users/$OwnerObjectId")
    }
    Write-Host '   created: jarvis-sql-admins'
}
$members = @((Invoke-Graph GET "/groups/$($group.id)/members").value | ForEach-Object { $_.id })
foreach ($m in @($OwnerObjectId, $identity.principalId)) {
    if ($members -notcontains $m) {
        for ($i = 1; $i -le 6; $i++) {
            try { Invoke-Graph POST "/groups/$($group.id)/members/`$ref" @{ '@odata.id' = "$graph/directoryObjects/$m" } | Out-Null; break }
            catch {
                if ("$_" -match 'already exist') { break }   # member list reads can lag behind Entra replication
                if ($i -eq 6) { throw }; Start-Sleep -Seconds 10
            }
        }
    }
}
Write-Host '   members: Dan, id-jarvis-backend'

# --- GitHub Actions variables -------------------------------------------------------------
Step "GitHub Actions variables on $GitHubRepo"
$variables = [ordered]@{
    AZURE_CLIENT_ID = $deployApp.appId; AZURE_TENANT_ID = $TenantId; AZURE_SUBSCRIPTION_ID = $SubscriptionId
    AZURE_RESOURCE_GROUP = $ResourceGroup; AZURE_LOCATION = $Location
    JARVIS_API_CLIENT_ID = $apiApp.appId; JARVIS_WEB_CLIENT_ID = $webApp.appId
    JARVIS_BACKEND_IDENTITY_ID = $identity.id; JARVIS_SQL_ADMIN_GROUP_ID = $group.id
}
foreach ($k in $variables.Keys) {
    & gh variable set $k --body $variables[$k] --repo $GitHubRepo | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not set GitHub variable $k" }
}
Write-Host "   Actions variables: $($variables.Count)"

# --- Output -------------------------------------------------------------------------------
$output = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o', [Globalization.CultureInfo]::InvariantCulture)
    tenantId = $TenantId; subscriptionId = $SubscriptionId; location = $Location; resourceGroup = $ResourceGroup
    gitHubRepo = $GitHubRepo; ownerObjectId = $OwnerObjectId
    deploy = [ordered]@{ appId = $deployApp.appId; servicePrincipalId = $deploySp.id; federatedSubjects = @($subjects.Values) }
    api = [ordered]@{ appId = $apiApp.appId; identifierUri = "api://$($apiApp.appId)"; scope = "api://$($apiApp.appId)/access_as_user" }
    web = [ordered]@{ appId = $webApp.appId; redirectUris = $WebRedirectUris }
    backendIdentity = [ordered]@{ resourceId = $identity.id; clientId = $identity.clientId; principalId = $identity.principalId }
    sqlAdminGroup = [ordered]@{ objectId = $group.id; displayName = 'jarvis-sql-admins' }
}
$outPath = Join-Path $PSScriptRoot 'bootstrap.output.json'
[IO.File]::WriteAllText($outPath, ($output | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
Step "Done. IDs written to $outPath (no secrets)."
