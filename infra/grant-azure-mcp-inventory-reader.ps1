[CmdletBinding()]
param([string]$ResourceGroup = 'rg-jarvis')

$ErrorActionPreference = 'Stop'
$bootstrap = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bootstrap.output.json') -Raw | ConvertFrom-Json
$subscriptionId = [string]$bootstrap.subscriptionId
if (-not $subscriptionId) { throw 'The bootstrap output has no subscription ID.' }
$account = az account show --subscription $subscriptionId --query id --output tsv --only-show-errors
if ($LASTEXITCODE -ne 0 -or ([string]$account).Trim() -ne $subscriptionId) { throw 'Azure CLI is not authenticated to the Jarvis subscription.' }

$apps = @(az containerapp list --resource-group $ResourceGroup --subscription $subscriptionId --query "[?tags.purpose=='azure-mcp'].{principalId:identity.principalId}" --output json --only-show-errors | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or $apps.Count -ne 1 -or [string]$apps[0].principalId -notmatch '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$') {
    throw 'Expected exactly one deployed Azure MCP app with a system-assigned identity.'
}

$principalId = [string]$apps[0].principalId
$scope = "/subscriptions/$subscriptionId"
$roleId = 'acdd72a7-3385-48ef-bd42-f606fba81ae7'
$assignments = @(az role assignment list --scope $scope --assignee-object-id $principalId --include-inherited --subscription $subscriptionId --query "[?contains(roleDefinitionId, '$roleId')].{scope:scope}" --output json --only-show-errors | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { throw 'Could not read inherited Azure MCP Reader assignments.' }
$alreadyInherited = @($assignments | Where-Object {
    $_.scope -eq $scope -or $_.scope -eq '/' -or $_.scope -like '/providers/Microsoft.Management/managementGroups/*'
}).Count -gt 0
if (-not $alreadyInherited) {
    az role assignment create --assignee-object-id $principalId --assignee-principal-type ServicePrincipal --role $roleId --scope $scope --subscription $subscriptionId --output none --only-show-errors
    if ($LASTEXITCODE -ne 0) { throw 'Could not assign built-in Reader at the Jarvis subscription scope.' }
}

$verified = @(az role assignment list --scope $scope --assignee-object-id $principalId --include-inherited --subscription $subscriptionId --query "[?roleDefinitionId=='/subscriptions/$subscriptionId/providers/Microsoft.Authorization/roleDefinitions/$roleId' && scope=='$scope']" --output json --only-show-errors | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or $verified.Count -ne 1) { throw 'The exact subscription Reader assignment did not verify.' }
Write-Host 'Azure MCP subscription resource inventory Reader is effective.'
