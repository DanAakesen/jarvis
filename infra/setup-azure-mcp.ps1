<#
.SYNOPSIS
    Creates the Entra app that guards the Azure MCP server of the PI agent and lets the Foundry project call it.

.DESCRIPTION
    Run from Windows PowerShell 5.1 as the owner, signed in to Azure CLI (az login) and GitHub CLI (gh auth login),
    BEFORE the first Deploy that should attach the Azure MCP server. It is idempotent.

    1. App registration 'jarvis-azure-mcp' with the identifier URI api://<appId> and the application role
       Mcp.Tools.ReadWrite.All (the role name the Azure MCP server checks). The Deploy gives the server's own identity the
       Contributor role on the Jarvis resource group; widening beyond that is the owner's call.
    2. Its service principal, and the role assigned to the Foundry project's managed identity, so only the project
       can call the server.
    3. The repository variable JARVIS_AZURE_MCP_CLIENT_ID, which the Deploy workflow reads to create the container
       (scale to zero) and to attach the server to the PI agent.

    The script prints no secret: there is none. A client ID is not a credential.
#>
[CmdletBinding()]
param(
    [string]$ResourceGroup = 'rg-jarvis',
    [string]$GitHubRepo = '',
    # Read from the last infrastructure deployment when omitted.
    [string]$FoundryProjectPrincipalId = ''
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$graph = 'https://graph.microsoft.com/v1.0'
$appName = 'jarvis-azure-mcp'
$roleValue = 'Mcp.Tools.ReadWrite.All'

function Invoke-Native([scriptblock]$Command) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $Command 2>$null }
    finally { $ErrorActionPreference = $previous }
}

function Invoke-Graph([string]$Method, [string]$Path, $Body) {
    $azArgs = @('rest', '--method', $Method, '--url', "$graph$Path", '--resource', 'https://graph.microsoft.com', '--output', 'json')
    $file = $null
    if ($null -ne $Body) {
        $file = [IO.Path]::GetTempFileName()
        [IO.File]::WriteAllText($file, ($Body | ConvertTo-Json -Depth 8 -Compress), (New-Object Text.UTF8Encoding($false)))
        $azArgs += @('--headers', 'Content-Type=application/json', '--body', "@$file")
    }
    try {
        $output = Invoke-Native { & az @azArgs }
        if ($LASTEXITCODE -ne 0) { throw "Microsoft Graph call failed: $Method $Path" }
    }
    finally { if ($file) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue } }
    if ($output) { return ($output -join "`n") | ConvertFrom-Json }
}

if (-not (Get-Command az -ErrorAction SilentlyContinue) -or -not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw 'Azure CLI and GitHub CLI must be installed and signed in.'
}
$bootstrapPath = Join-Path $PSScriptRoot 'bootstrap.output.json'
if (-not (Test-Path -LiteralPath $bootstrapPath)) { throw 'infra/bootstrap.output.json is required; run the approved Azure bootstrap first.' }
$bootstrap = Get-Content -LiteralPath $bootstrapPath -Raw | ConvertFrom-Json
$subscriptionId = [string]$bootstrap.subscriptionId
if (-not $GitHubRepo) { $GitHubRepo = [string]$bootstrap.gitHubRepo }
if (-not $subscriptionId -or -not $GitHubRepo) { throw 'The bootstrap output has no subscription ID or repository.' }

if (-not $FoundryProjectPrincipalId) {
    $query = 'properties.outputs.foundryProjectPrincipalId.value'
    $output = Invoke-Native { & az deployment group show --name jarvis-infra --resource-group $ResourceGroup --subscription $subscriptionId --query $query --output tsv --only-show-errors }
    $FoundryProjectPrincipalId = ([string]($output -join '')).Trim()
}
if ($FoundryProjectPrincipalId -notmatch '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$') {
    throw 'The Foundry project principal ID is unknown. Deploy the infrastructure once with this branch, or pass -FoundryProjectPrincipalId.'
}

Write-Host "App registration $appName"
$found = @((Invoke-Graph GET "/applications?`$filter=displayName eq '$appName'").value)
if ($found.Count -gt 1) { throw "More than one app is named $appName; remove the extra ones first." }
$app = if ($found.Count -eq 1) { $found[0] } else { Invoke-Graph POST '/applications' @{ displayName = $appName; signInAudience = 'AzureADMyOrg' } }
$app = Invoke-Graph GET "/applications/$($app.id)"
$role = @($app.appRoles) | Where-Object { $_ -and $_.value -eq $roleValue } | Select-Object -First 1
$roleId = if ($role) { $role.id } else { [guid]::NewGuid().ToString() }
$roles = @(@($app.appRoles) | Where-Object { $_ -and $_.value -ne $roleValue } |
    Select-Object id, value, allowedMemberTypes, isEnabled, displayName, description) + @(@{
    id = $roleId; value = $roleValue; allowedMemberTypes = @('Application'); isEnabled = $true
    displayName = 'Azure MCP tools'; description = 'Call the Azure MCP server of Jarvis'
})
Invoke-Graph PATCH "/applications/$($app.id)" @{
    identifierUris = @("api://$($app.appId)")
    api = @{ requestedAccessTokenVersion = 2 }
    appRoles = @($roles)
} | Out-Null

Write-Host 'Service principal and the Foundry project as its only caller'
$sps = @((Invoke-Graph GET "/servicePrincipals?`$filter=appId eq '$($app.appId)'").value)
$sp = if ($sps.Count -gt 0) { $sps[0] } else { Invoke-Graph POST '/servicePrincipals' @{ appId = $app.appId } }
Invoke-Graph PATCH "/servicePrincipals/$($sp.id)" @{ appRoleAssignmentRequired = $true } | Out-Null
$assigned = @((Invoke-Graph GET "/servicePrincipals/$($sp.id)/appRoleAssignedTo").value) |
    Where-Object { $_.principalId -eq $FoundryProjectPrincipalId -and $_.appRoleId -eq $roleId }
if (-not $assigned) {
    Invoke-Graph POST "/servicePrincipals/$($sp.id)/appRoleAssignedTo" @{
        principalId = $FoundryProjectPrincipalId; resourceId = $sp.id; appRoleId = $roleId
    } | Out-Null
}

Write-Host "Repository variable JARVIS_AZURE_MCP_CLIENT_ID on $GitHubRepo"
Invoke-Native { & gh variable set JARVIS_AZURE_MCP_CLIENT_ID --repo $GitHubRepo --body $app.appId }
if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI could not set JARVIS_AZURE_MCP_CLIENT_ID.' }
Write-Host 'Done. Run the Deploy workflow: it creates the container (scale to zero, Contributor on the Jarvis resource group) and attaches the server to PI.'
