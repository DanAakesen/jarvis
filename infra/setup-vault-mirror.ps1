<#
.SYNOPSIS
    Stores the owner's vault-mirror credentials in Key Vault.

.DESCRIPTION
    Run from Windows PowerShell 5.1 after the infrastructure is deployed.
    The script never writes credentials to disk or displays secret values.
#>
[CmdletBinding()]
param(
    [string]$ResourceGroup = 'rg-jarvis',
    [string]$GitHubRepo = ''
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$roleAssignmentId = $null
$authToken = $null
$vaultPassword = $null
$policyJson = $null
$accessToken = $null

function Invoke-Native([scriptblock]$Command) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $Command 2>$null }
    finally { $ErrorActionPreference = $previous }
}

function Invoke-Az {
    $azArgs = $args
    $output = Invoke-Native { & az @azArgs }
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI command failed: az $($args -join ' ')"
    }
    return $output
}

function ConvertFrom-SecureInput([Security.SecureString]$Value) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Read-SecretInput([string]$Prompt) {
    $secureValue = Read-Host $Prompt -AsSecureString
    try { return ConvertFrom-SecureInput $secureValue }
    finally { $secureValue.Dispose() }
}

function Test-Policy([string]$Json) {
    if (-not $Json -or $Json.Length -gt 32768) {
        throw 'The policy JSON is empty or too large.'
    }
    try { $policy = ConvertFrom-Json -InputObject $Json -ErrorAction Stop }
    catch { throw 'The policy JSON could not be parsed.' }

    $required = @(
        'allowedRoots', 'allowedExtensions', 'excludedPrefixes', 'excludedNames',
        'excludedNamePattern', 'secretPatterns', 'maxNoteBytes'
    )
    foreach ($name in $required) {
        if ($policy.PSObject.Properties.Name -notcontains $name) {
            throw 'The policy JSON is missing a required field.'
        }
    }
    foreach ($name in @('allowedRoots', 'allowedExtensions', 'excludedPrefixes', 'excludedNames', 'secretPatterns')) {
        if ($policy.$name -isnot [Array] -or
            @($policy.$name | Where-Object { $_ -isnot [string] -or [string]::IsNullOrWhiteSpace($_) }).Count -gt 0) {
            throw 'Policy list fields must be arrays of non-empty strings.'
        }
    }
    if ($policy.allowedRoots.Count -eq 0 -or $policy.allowedExtensions.Count -eq 0 -or
        $policy.excludedNamePattern -isnot [string] -or
        $policy.maxNoteBytes -isnot [int] -and $policy.maxNoteBytes -isnot [long] -or
        $policy.maxNoteBytes -le 0) {
        throw 'The policy must include allowed roots, extensions, a string name pattern and a positive integer size.'
    }
    return (ConvertTo-Json -InputObject $policy -Depth 20 -Compress)
}

function Set-GitHubVariable([string]$Name, [string]$Value, [string]$Repository) {
    Invoke-Native { & gh variable set $Name --repo $Repository --body $Value }
    if ($LASTEXITCODE -ne 0) {
        throw "GitHub CLI could not set repository variable '$Name'."
    }
}

if ($PSVersionTable.PSVersion.Major -lt 5 -or
    ($PSVersionTable.PSVersion.Major -eq 5 -and $PSVersionTable.PSVersion.Minor -lt 1)) {
    throw 'PowerShell 5.1 or later is required.'
}
if (-not (Get-Command az -ErrorAction SilentlyContinue) -or
    -not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw 'Azure CLI and GitHub CLI must be installed and signed in.'
}

$bootstrapPath = Join-Path $PSScriptRoot 'bootstrap.output.json'
if (-not (Test-Path -LiteralPath $bootstrapPath)) {
    throw 'infra/bootstrap.output.json is required; run the approved Azure bootstrap first.'
}
$bootstrap = Get-Content -LiteralPath $bootstrapPath -Raw | ConvertFrom-Json
$subscriptionId = [string]$bootstrap.subscriptionId
if (-not $subscriptionId) { throw 'The bootstrap output has no subscription ID.' }

if (-not $GitHubRepo) {
    $GitHubRepo = [string](Invoke-Native { & gh repo view --json nameWithOwner --jq .nameWithOwner })
    if ($LASTEXITCODE -ne 0 -or -not $GitHubRepo) {
        throw 'GitHub CLI could not identify the current repository.'
    }
}
if ($GitHubRepo -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') {
    throw 'GitHubRepo must be an owner/repository name.'
}

try {
    $account = Invoke-Az account show --subscription $subscriptionId --output json | ConvertFrom-Json
    if ([string]$account.id -ne $subscriptionId -or
        [string]$account.tenantId -ne [string]$bootstrap.tenantId) {
        throw 'The active Azure CLI tenant/subscription does not match infra/bootstrap.output.json.'
    }
    $keyVaultName = [string](Invoke-Az deployment group show --name jarvis-infra --resource-group $ResourceGroup `
        --subscription $subscriptionId --query properties.outputs.keyVaultName.value --output tsv)
    if (-not $keyVaultName) { throw 'The deployed jarvis-infra deployment has no Key Vault output.' }
    $vaultUri = [string](Invoke-Az keyvault show --name $keyVaultName --subscription $subscriptionId `
        --query properties.vaultUri --output tsv)
    if ($vaultUri -notmatch '^https://[^/]+/?$') { throw 'Could not resolve the deployed Key Vault URI.' }

    $defaultTokenPath = Join-Path $HOME '.obsidian-headless/auth_token'
    $readTokenFile = Read-Host "Read the Obsidian CLI token from $defaultTokenPath? [y/N]"
    if ($readTokenFile -match '^(?i:y|yes)$') {
        if (-not (Test-Path -LiteralPath $defaultTokenPath -PathType Leaf)) {
            throw 'The Obsidian CLI token file is not present; run ob login or paste the token instead.'
        }
        $authToken = (Get-Content -LiteralPath $defaultTokenPath -Raw).Trim()
    }
    else {
        $authToken = Read-SecretInput 'Obsidian auth token (hidden)'
    }
    $vaultName = Read-Host 'Obsidian vault name'
    $securePassword = Read-Host 'End-to-end-encryption password (hidden; leave blank if unused)' -AsSecureString
    try { $vaultPassword = ConvertFrom-SecureInput $securePassword }
    finally { $securePassword.Dispose() }
    $policyJson = Test-Policy (Read-SecretInput 'Vault policy JSON, single line (hidden)')

    if (-not $authToken -or $authToken.Length -gt 10000 -or $authToken -match '[\r\n]') {
        throw 'The Obsidian auth token is invalid.'
    }
    if (-not $vaultName -or $vaultName.Length -gt 255 -or $vaultName -match '[\r\n]') {
        throw 'The Obsidian vault name is invalid.'
    }
    if ($vaultPassword -and ($vaultPassword.Length -gt 10000 -or $vaultPassword -match '[\r\n]')) {
        throw 'The vault password is invalid.'
    }
    $maxChangedInput = Read-Host 'Maximum changed files per run [25]'
    if (-not $maxChangedInput) { $maxChangedInput = '25' }
    $maxDeletesInput = Read-Host 'Maximum deletions per run [3]'
    if (-not $maxDeletesInput) { $maxDeletesInput = '3' }
    if ($maxChangedInput -notmatch '^[1-9][0-9]*$' -or [int]$maxChangedInput -gt 100 -or
        $maxDeletesInput -notmatch '^(0|[1-9][0-9]*)$' -or [int]$maxDeletesInput -gt 10) {
        throw 'Change caps must be 1–100 changed files and 0–10 deletions.'
    }

    $operatorObjectId = [string](Invoke-Az ad signed-in-user show --query id --output tsv)
    if (-not $operatorObjectId) { throw 'Could not resolve the signed-in Azure owner.' }
    $vaultId = [string](Invoke-Az keyvault show --name $keyVaultName --subscription $subscriptionId --query id --output tsv)
    if (-not $vaultId) { throw 'Could not resolve the deployed Key Vault resource ID.' }
    $roleAssignmentJson = Invoke-Az role assignment list --scope $vaultId --assignee-object-id $operatorObjectId `
        --query "[?roleDefinitionName=='Key Vault Secrets Officer' && scope=='$vaultId'].id" --output json | Out-String
    $roleAssignments = @(($roleAssignmentJson | ConvertFrom-Json) | Where-Object { $_ })
    if ($roleAssignments.Count -eq 0) {
        $assignment = Invoke-Az role assignment create --assignee-object-id $operatorObjectId `
            --assignee-principal-type User --role 'Key Vault Secrets Officer' --scope $vaultId --output json |
            ConvertFrom-Json
        $roleAssignmentId = [string]$assignment.id
        if (-not $roleAssignmentId) { throw 'Could not create temporary Key Vault access.' }
    }

    $accessToken = [string](Invoke-Az account get-access-token --subscription $subscriptionId `
        --resource https://vault.azure.net --query accessToken --output tsv)
    if (-not $accessToken) { throw 'Could not acquire a Key Vault access token.' }
    $secrets = @(
        @{ Name = 'obsidian-auth-token'; Value = $authToken }
        @{ Name = 'obsidian-vault'; Value = $vaultName }
        @{ Name = 'vault-mirror-policy'; Value = $policyJson }
    )
    if ($vaultPassword) { $secrets += @{ Name = 'obsidian-vault-password'; Value = $vaultPassword } }

    foreach ($secret in $secrets) {
        $body = ConvertTo-Json -InputObject @{ value = $secret.Value; contentType = 'text/plain' } -Compress
        $bodyBytes = [Text.Encoding]::UTF8.GetBytes($body)
        $stored = $false
        for ($attempt = 1; $attempt -le 24; $attempt++) {
            try {
                $null = Invoke-RestMethod -Method Put -Uri "$($vaultUri.TrimEnd('/'))/secrets/$($secret.Name)?api-version=7.4" `
                    -Headers @{ Authorization = ('Bearer ' + $accessToken) } -ContentType 'application/json; charset=utf-8' `
                    -Body $bodyBytes -TimeoutSec 30 -ErrorAction Stop
                $stored = $true
                break
            }
            catch {
                if ($attempt -eq 1) { Write-Host 'Waiting for temporary Key Vault access to take effect (up to six minutes)...' }
                if ($attempt -lt 24) { Start-Sleep -Seconds 15 }
            }
        }
        if (-not $stored) { throw "Could not store Key Vault secret '$($secret.Name)'." }
    }

    Set-GitHubVariable 'JARVIS_VAULT_MIRROR_WRITE_BACK' 'dry-run' $GitHubRepo
    Set-GitHubVariable 'JARVIS_VAULT_MIRROR_MAX_CHANGED' $maxChangedInput $GitHubRepo
    Set-GitHubVariable 'JARVIS_VAULT_MIRROR_MAX_DELETES' $maxDeletesInput $GitHubRepo

    foreach ($secret in $secrets) {
        $secretId = [string](Invoke-Az keyvault secret show --vault-name $keyVaultName --name $secret.Name `
            --subscription $subscriptionId --query id --output tsv)
        if (-not $secretId) { throw "Key Vault did not report secret '$($secret.Name)' as present." }
        $secretIdParts = $secretId.TrimEnd('/') -split '/'
        if ($secretIdParts.Count -lt 2 -or $secretIdParts[-2] -ne $secret.Name) {
            throw "Key Vault returned an invalid version identifier for secret '$($secret.Name)'."
        }
        $version = $secretIdParts[-1]
        Write-Host "Stored $($secret.Name); present with version $version."
    }
    Write-Host "Vault-mirror settings are stored. Write-back remains dry-run; the enable switch was not changed."
}
finally {
    if ($roleAssignmentId) {
        $removed = $false
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            Invoke-Native {
                & az role assignment delete --ids $roleAssignmentId --subscription $subscriptionId `
                    --output none --only-show-errors
            }
            if ($LASTEXITCODE -eq 0) { $removed = $true; break }
            if ($attempt -lt 3) { Start-Sleep -Seconds 5 }
        }
        if (-not $removed) { throw 'Temporary Key Vault access could not be removed; delete the role assignment manually.' }
    }
    $authToken = $null
    $vaultPassword = $null
    $policyJson = $null
    $accessToken = $null
    $body = $null
    $bodyBytes = $null
    $secrets = $null
    $secret = $null
}
