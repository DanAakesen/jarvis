<#
.SYNOPSIS
    Creates the Outlook app registration and scopes Exchange Online RBAC to Dan's mailbox.

.DESCRIPTION
    Safe to rerun. The app has no Entra API permissions; Exchange Online RBAC for
    Applications is the only Graph authorization path. The client credential is
    stored only in the deployed Key Vault.

.EXAMPLE
    ./infra/setup-outlook.ps1 -MailboxUpn dan@example.com
    ./infra/setup-outlook.ps1 -MailboxUpn dan@example.com -RotateCredential
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$MailboxUpn,
    [string]$GitHubRepo = 'DanAakesen/jarvis',
    [string]$TimeZone = 'Europe/Copenhagen',
    [switch]$RotateCredential
)

$ErrorActionPreference = 'Stop'
$displayName = 'jarvis-outlook'
$scopeName = 'JarvisOutlookDanMailbox'
$secretName = 'jarvis-outlook-client-secret'
$credentialName = 'Jarvis Outlook Key Vault'
$roles = @(
    'Application Calendars.ReadWrite'
    'Application Mail.ReadWrite'
    'Application Mail.Send'
)

function Invoke-Az {
    $output = & az @args 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI command failed: az $($args -join ' ')"
    }
    return $output
}

function Write-Step([string]$Message) {
    Write-Host "-> $Message" -ForegroundColor Cyan
}

if ($MailboxUpn -match "['`r`n]") {
    throw 'MailboxUpn contains unsupported characters.'
}
if ($TimeZone -notmatch '^[A-Za-z_+-]+(/[A-Za-z0-9_+-]+)+$') {
    throw 'TimeZone must be an IANA time zone, for example Europe/Copenhagen.'
}
if (-not (Get-Command Connect-ExchangeOnline -ErrorAction SilentlyContinue)) {
    throw 'Install the ExchangeOnlineManagement module and import it before running this script.'
}

$bootstrapPath = Join-Path $PSScriptRoot 'bootstrap.output.json'
if (-not (Test-Path $bootstrapPath)) {
    throw 'infra/bootstrap.output.json is required; run the approved Azure bootstrap first.'
}
$bootstrap = Get-Content -Raw $bootstrapPath | ConvertFrom-Json
$tenantId = [string]$bootstrap.tenantId
$subscriptionId = [string]$bootstrap.subscriptionId
$resourceGroup = [string]$bootstrap.resourceGroup
if (-not $tenantId -or -not $subscriptionId -or -not $resourceGroup) {
    throw 'The bootstrap output is missing the tenant, subscription, or resource group.'
}

$activeSubscription = [string](Invoke-Az account show --query id --output tsv)
if ($activeSubscription -ne $subscriptionId) {
    throw 'The active Azure CLI subscription does not match infra/bootstrap.output.json.'
}
$keyVaultName = [string](Invoke-Az deployment group show --name jarvis-infra `
    --resource-group $resourceGroup --subscription $subscriptionId `
    --query properties.outputs.keyVaultName.value --output tsv)
if (-not $keyVaultName) {
    throw 'The deployed jarvis-infra deployment has no Key Vault output.'
}

Write-Step 'Checking the Outlook app registration'
$apps = @(Invoke-Az ad app list --display-name $displayName --output json | ConvertFrom-Json)
if ($apps.Count -gt 1) {
    throw "More than one Entra app is named $displayName; resolve the duplicate manually."
}
if ($apps.Count -eq 0) {
    $appId = [string](Invoke-Az ad app create --display-name $displayName `
        --sign-in-audience AzureADMyOrg --query appId --output tsv)
}
else {
    $app = $apps[0]
    if (@($app.requiredResourceAccess).Count -gt 0) {
        throw 'The Outlook app declares Entra API permissions. Remove them; Graph access must be limited by Exchange RBAC.'
    }
    $appId = [string]$app.appId
}
if ($appId -notmatch '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$') {
    throw 'Azure did not return a valid Outlook app ID.'
}

$servicePrincipalId = [string](Invoke-Az ad sp list --filter "appId eq '$appId'" `
    --query '[0].id' --output tsv)
if (-not $servicePrincipalId -or $servicePrincipalId -eq 'None') {
    $servicePrincipalId = [string](Invoke-Az ad sp create --id $appId --query id --output tsv)
}
if ($servicePrincipalId -notmatch '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$') {
    throw 'Azure did not return a valid Outlook service-principal ID.'
}

Connect-ExchangeOnline -Organization $tenantId -ShowBanner:$false
try {
    Write-Step 'Checking the exact mailbox scope'
    $mailbox = Get-EXOMailbox -Identity $MailboxUpn -Properties PrimarySmtpAddress
    $primarySmtpAddress = [string]$mailbox.PrimarySmtpAddress
    if (-not $primarySmtpAddress -or $primarySmtpAddress -match "['`r`n]") {
        throw 'Exchange Online returned an invalid primary SMTP address.'
    }
    $recipientFilter = "PrimarySmtpAddress -eq '$primarySmtpAddress'"
    $scope = Get-ManagementScope -Identity $scopeName -ErrorAction SilentlyContinue
    if ($null -eq $scope) {
        $scope = New-ManagementScope -Name $scopeName -RecipientRestrictionFilter $recipientFilter
    }
    elseif ([string]$scope.RecipientRestrictionFilter -ne $recipientFilter) {
        throw "The existing Exchange scope $scopeName does not match the requested mailbox; refusing to widen or change it."
    }
    $scopedRecipients = @(Get-Recipient -RecipientPreviewFilter $recipientFilter -ResultSize Unlimited)
    if ($scopedRecipients.Count -ne 1 -or
        [string]$scopedRecipients[0].PrimarySmtpAddress -ne $primarySmtpAddress) {
        throw 'The Exchange scope does not resolve to exactly the requested mailbox.'
    }

    Write-Step 'Checking the Exchange Online app service principal'
    $exchangeServicePrincipal = Get-ServicePrincipal -Identity $servicePrincipalId -ErrorAction SilentlyContinue
    if ($null -eq $exchangeServicePrincipal) {
        New-ServicePrincipal -AppId $appId -ObjectId $servicePrincipalId -DisplayName $displayName | Out-Null
    }

    foreach ($role in $roles) {
        $assignmentName = "Jarvis Outlook - $($role -replace '^Application ', '')"
        $assignment = Get-ManagementRoleAssignment -Identity $assignmentName -ErrorAction SilentlyContinue
        if ($null -eq $assignment) {
            New-ManagementRoleAssignment -Name $assignmentName -App $servicePrincipalId `
                -Role $role -CustomResourceScope $scopeName | Out-Null
        }
        elseif ([string]$assignment.Role -ne $role -or
            [string]$assignment.CustomResourceScope -ne $scopeName -or
            [string]$assignment.App -ne $servicePrincipalId) {
            throw "The existing Exchange role assignment $assignmentName does not match the required app, role, and mailbox scope."
        }
    }
}
finally {
    Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue
}

Write-Step 'Checking the Key Vault client credential'
$secretNames = @(Invoke-Az keyvault secret list --vault-name $keyVaultName `
    --query "[?name=='$secretName'].name | [0]" --output tsv)
$hasSecret = $secretNames.Count -gt 0 -and [string]$secretNames[0] -eq $secretName
if (-not $hasSecret -or $RotateCredential) {
    $oldCredentialIds = @(
        Invoke-Az ad app credential list --id $appId --output json |
            ConvertFrom-Json |
            Where-Object { $_.displayName -eq $credentialName } |
            ForEach-Object { [string]$_.keyId }
    )
    $credentialJson = & az ad app credential reset --id $appId --append `
        --display-name $credentialName --years 1 --output json 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw 'Azure CLI could not create the Outlook app credential.'
    }
    $credential = $credentialJson | ConvertFrom-Json
    $clientSecret = [string]$credential.password
    $newCredentialId = [string]$credential.keyId
    if (-not $clientSecret -or -not $newCredentialId) {
        throw 'Azure CLI returned an incomplete Outlook app credential.'
    }

    $secretFile = [System.IO.Path]::GetTempFileName()
    try {
        [System.IO.File]::WriteAllText($secretFile, $clientSecret, [System.Text.UTF8Encoding]::new($false))
        if (-not $IsWindows) {
            [System.IO.File]::SetUnixFileMode(
                $secretFile,
                [System.IO.UnixFileMode]::UserRead -bor [System.IO.UnixFileMode]::UserWrite
            )
        }
        & az keyvault secret set --vault-name $keyVaultName --name $secretName `
            --file $secretFile --content-type text/plain --output none --only-show-errors
        if ($LASTEXITCODE -ne 0) {
            throw 'Key Vault did not accept the Outlook app credential.'
        }
    }
    finally {
        Remove-Item -LiteralPath $secretFile -Force -ErrorAction SilentlyContinue
        $clientSecret = $null
        $credentialJson = $null
    }
    foreach ($keyId in $oldCredentialIds) {
        if ($keyId -and $keyId -ne $newCredentialId) {
            Invoke-Az ad app credential delete --id $appId --key-id $keyId --output none | Out-Null
        }
    }
}

Write-Step 'Setting non-secret deployment variables'
& gh variable set JARVIS_GRAPH_APP_ID --repo $GitHubRepo --body $appId
if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI could not set JARVIS_GRAPH_APP_ID.' }
& gh variable set JARVIS_GRAPH_TIME_ZONE --repo $GitHubRepo --body $TimeZone
if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI could not set JARVIS_GRAPH_TIME_ZONE.' }

Write-Host "Outlook app ID: $appId"
Write-Host "Exchange RBAC scope: $scopeName ($primarySmtpAddress)"
Write-Host "Key Vault secret: $secretName in $keyVaultName"
Write-Host 'No Entra Graph API permissions were granted.'
