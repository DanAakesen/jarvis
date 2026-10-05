<#
.SYNOPSIS
    Grant the backend managed identity Microsoft Graph access to read Dan's presence.

.DESCRIPTION
    Run after deployment with an Azure CLI session whose signed-in administrator
    can assign Microsoft Graph application permissions. This grants Presence.Read.All
    to the backend identity so the backend can poll Dan's Teams presence.

.EXAMPLE
    ./infra/setup-away-presence.ps1
#>
[CmdletBinding()]
param(
    [string]$SubscriptionId = '0ac7d719-89bc-4100-be87-a79d33e953a7',
    [string]$ResourceGroup = 'rg-jarvis',
    [string]$ManagedIdentityName = 'id-jarvis-backend'
)

$ErrorActionPreference = 'Stop'
$graph = 'https://graph.microsoft.com/v1.0'
$graphAppId = '00000003-0000-0000-c000-000000000000'

$token = & az account get-access-token --subscription $SubscriptionId --resource-type ms-graph --query accessToken -o tsv 2>$null
if ($LASTEXITCODE -ne 0 -or -not $token) {
    throw 'Sign in to the expected Azure tenant with an administrator authorized to assign Graph application permissions.'
}
$scheme = 'Bearer'
$script:headers = @{ Authorization = $scheme + ' ' + $token }

function Invoke-Graph([string]$Method, [string]$Path, $Body) {
    $params = @{ Method = $Method; Uri = "$graph$Path"; Headers = $script:headers; ContentType = 'application/json' }
    if ($null -ne $Body) { $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress) }
    try {
        return Invoke-RestMethod @params
    } catch {
        throw "Microsoft Graph setup request failed ($Method $Path). Check administrator consent and retry."
    }
}

$identityJson = & az identity show -g $ResourceGroup -n $ManagedIdentityName --subscription $SubscriptionId -o json 2>$null
if ($LASTEXITCODE -ne 0) {
    throw "Could not find managed identity '$ManagedIdentityName' in resource group '$ResourceGroup'."
}
$identity = $identityJson | ConvertFrom-Json
$graphServicePrincipals = @((Invoke-Graph GET "/servicePrincipals?`$filter=appId eq '$graphAppId'&`$select=id,appRoles").value)
if ($graphServicePrincipals.Count -ne 1) {
    throw 'Could not resolve the Microsoft Graph service principal.'
}
$graphServicePrincipal = $graphServicePrincipals[0]
$roles = @($graphServicePrincipal.appRoles | Where-Object {
    $_.value -eq 'Presence.Read.All' -and $_.isEnabled -and $_.allowedMemberTypes -contains 'Application'
})
if ($roles.Count -ne 1) {
    throw 'Could not resolve the Microsoft Graph Presence.Read.All application role.'
}
$role = $roles[0]
$assignments = @((Invoke-Graph GET "/servicePrincipals/$($identity.principalId)/appRoleAssignments?`$select=appRoleId,resourceId").value)
if ($assignments | Where-Object { $_.appRoleId -eq $role.id -and $_.resourceId -eq $graphServicePrincipal.id }) {
    Write-Host "Presence.Read.All is already assigned to $ManagedIdentityName."
    return
}

try {
    Invoke-Graph POST "/servicePrincipals/$($identity.principalId)/appRoleAssignments" @{
        principalId = $identity.principalId
        resourceId = $graphServicePrincipal.id
        appRoleId = $role.id
    } | Out-Null
    Write-Host "Assigned Presence.Read.All to $ManagedIdentityName."
} catch {
    $assignments = @((Invoke-Graph GET "/servicePrincipals/$($identity.principalId)/appRoleAssignments?`$select=appRoleId,resourceId").value)
    if ($assignments | Where-Object { $_.appRoleId -eq $role.id -and $_.resourceId -eq $graphServicePrincipal.id }) {
        Write-Host "Presence.Read.All is already assigned to $ManagedIdentityName."
        return
    }
    throw
}
