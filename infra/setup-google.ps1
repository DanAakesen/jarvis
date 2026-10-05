<#
.SYNOPSIS
    Connects Jarvis to Dan's Gmail and Google Calendar account.

.DESCRIPTION
    Run from Windows PowerShell 5.1 after the core Azure deployment:
    & .\infra\setup-google.ps1
    The OAuth client credentials and refresh token are stored only in Key Vault.
#>
[CmdletBinding()]
param(
    [string]$SubscriptionId = '0ac7d719-89bc-4100-be87-a79d33e953a7',
    [string]$ResourceGroup = 'rg-jarvis',
    [string]$GitHubRepo = 'DanAakesen/jarvis',
    [string]$TimeZone = 'Europe/Copenhagen'
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$roleAssignmentId = $null
$tempDirectory = $null
$listener = $null
$loopbackClient = $null
$pendingConnection = $null
$requestBytes = $null
$clientId = $null
$clientSecret = $null
$refreshToken = $null

# Windows PowerShell 5.1 turns redirected native stderr into a terminating error under
# $ErrorActionPreference = 'Stop', which skipped the Key Vault retries (L95).
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

function ConvertTo-Base64Url([byte[]]$Bytes) {
    return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Write-SecretFile([string]$Name, [string]$Value) {
    $path = Join-Path $tempDirectory $Name
    [IO.File]::WriteAllText($path, $Value, (New-Object System.Text.UTF8Encoding($false)))
    return $path
}

function Send-LoopbackResponse([Net.Sockets.TcpClient]$Client, [int]$Status, [string]$Message) {
    $stream = $Client.GetStream()
    $body = [Text.Encoding]::UTF8.GetBytes($Message)
    $statusText = switch ($Status) { 200 { 'OK' } 404 { 'Not Found' } default { 'Bad Request' } }
    $header = "HTTP/1.1 $Status $statusText`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
    $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    $stream.Write($body, 0, $body.Length)
    $stream.Flush()
}

if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -lt 1) {
    throw 'Windows PowerShell 5.1 is required.'
}
if ($TimeZone -notmatch '^(UTC|[A-Za-z_+-]+(/[A-Za-z0-9_+-]+)+)$') {
    throw 'TimeZone must be a supported IANA time zone.'
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
if ([string]$bootstrap.subscriptionId -ne $SubscriptionId) {
    throw 'The requested subscription does not match infra/bootstrap.output.json.'
}
$account = (Invoke-Az account show --subscription $SubscriptionId --output json | ConvertFrom-Json)
if ([string]$account.id -ne $SubscriptionId -or
    [string]$account.tenantId -ne [string]$bootstrap.tenantId) {
    throw 'The active Azure CLI tenant/subscription does not match infra/bootstrap.output.json.'
}
$deployment = Invoke-Az deployment group show --name jarvis-infra --resource-group $ResourceGroup `
    --subscription $SubscriptionId --query properties.outputs.keyVaultName.value --output tsv
$keyVaultName = [string]$deployment
if (-not $keyVaultName) {
    throw 'The deployed jarvis-infra deployment has no Key Vault output.'
}
$vaultId = [string](Invoke-Az keyvault show --name $keyVaultName --subscription $SubscriptionId `
    --query id --output tsv)
if (-not $vaultId) { throw 'Could not resolve the deployed Key Vault resource ID.' }

$secureClientId = Read-Host 'Google OAuth Desktop app client ID' -AsSecureString
$clientId = ConvertFrom-SecureInput $secureClientId
$secureClientSecret = Read-Host 'Google OAuth Desktop app client secret' -AsSecureString
$clientSecret = ConvertFrom-SecureInput $secureClientSecret
if (-not $clientId -or -not $clientSecret -or
    $clientId.Length -gt 10000 -or $clientSecret.Length -gt 10000 -or
    $clientId -match '[\r\n]' -or $clientSecret -match '[\r\n]') {
    throw 'The OAuth client ID or secret is invalid.'
}

$random = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($random) } finally { $rng.Dispose() }
$verifier = ConvertTo-Base64Url $random
$challenge = ConvertTo-Base64Url ([Security.Cryptography.SHA256]::Create().ComputeHash(
    [Text.Encoding]::ASCII.GetBytes($verifier)
))
$stateBytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($stateBytes) } finally { $rng.Dispose() }
$state = ConvertTo-Base64Url $stateBytes
$listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
$redirectUri = "http://127.0.0.1:$port/"

try {
    $operatorObjectId = [string](Invoke-Az ad signed-in-user show --query id --output tsv)
    $roleAssignments = @(Invoke-Az role assignment list --scope $vaultId --assignee-object-id $operatorObjectId `
        --query "[?roleDefinitionName=='Key Vault Secrets Officer' && scope=='$vaultId'].id" --output json |
        ConvertFrom-Json)
    if ($roleAssignments.Count -eq 0) {
        $assignment = Invoke-Az role assignment create --assignee-object-id $operatorObjectId `
            --assignee-principal-type User --role 'Key Vault Secrets Officer' --scope $vaultId --output json |
            ConvertFrom-Json
        $roleAssignmentId = [string]$assignment.id
        if (-not $roleAssignmentId) { throw 'Could not create temporary Key Vault access.' }
    }
    $temporaryPath = Join-Path $env:TEMP ('jarvis-google-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temporaryPath | Out-Null
    $tempDirectory = $temporaryPath
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls $tempDirectory /inheritance:r /grant:r "*${sid}:(OI)(CI)F" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not restrict temporary credential-file access.' }

    $scopes = @(
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/calendar.events'
    ) -join ' '
    $null = Add-Type -AssemblyName System.Web
    $authorize = New-Object -TypeName System.UriBuilder -ArgumentList 'https://accounts.google.com/o/oauth2/v2/auth'
    $query = [System.Web.HttpUtility]::ParseQueryString('')
    $query['client_id'] = $clientId
    $query['redirect_uri'] = $redirectUri
    $query['response_type'] = 'code'
    $query['scope'] = $scopes
    $query['access_type'] = 'offline'
    $query['prompt'] = 'consent'
    $query['code_challenge'] = $challenge
    $query['code_challenge_method'] = 'S256'
    $query['state'] = $state
    $authorize.Query = $query.ToString()
    Write-Host 'Opening Google consent in your browser. Sign in as danaakesen@gmail.com.'
    Start-Process $authorize.Uri.AbsoluteUri
    Write-Host 'Waiting up to five minutes for the Google loopback response.'
    # Browsers open speculative empty connections and may request /favicon.ico; keep accepting
    # until the OAuth callback arrives or the five-minute deadline passes.
    $deadline = (Get-Date).AddMinutes(5)
    $requestText = ''
    while (-not $requestText) {
        $remaining = [int][Math]::Max(0, ($deadline - (Get-Date)).TotalMilliseconds)
        if ($remaining -le 0) { throw 'Google consent timed out; run the setup script again.' }
        $pendingConnection = $listener.BeginAcceptTcpClient($null, $null)
        if (-not $pendingConnection.AsyncWaitHandle.WaitOne($remaining)) {
            throw 'Google consent timed out; run the setup script again.'
        }
        $loopbackClient = $listener.EndAcceptTcpClient($pendingConnection)
        $pendingConnection.AsyncWaitHandle.Close()
        $pendingConnection = $null
        $stream = $loopbackClient.GetStream()
        $stream.ReadTimeout = 5000
        $buffer = New-Object byte[] 4096
        if ($requestBytes) { $requestBytes.Dispose() }
        $requestBytes = New-Object System.IO.MemoryStream
        $candidate = ''
        try {
            while (-not $candidate.Contains("`r`n`r`n")) {
                $read = $stream.Read($buffer, 0, $buffer.Length)
                if ($read -le 0) { break }
                if (($requestBytes.Length + $read) -gt 16384) {
                    throw 'Google returned an oversized loopback response.'
                }
                $requestBytes.Write($buffer, 0, $read)
                $candidate = [Text.Encoding]::ASCII.GetString($requestBytes.ToArray())
            }
        }
        catch [System.IO.IOException] { $candidate = '' }
        if ($candidate.Contains("`r`n`r`n") -and ($candidate -split "`r`n", 2)[0] -match '^GET /\?') {
            $requestText = $candidate
        }
        else {
            if ($candidate) { Send-LoopbackResponse $loopbackClient 404 'Not found.' }
            $loopbackClient.Close()
            $loopbackClient = $null
        }
    }
    $requestLine = ($requestText -split "`r`n", 2)[0]
    $requestParts = $requestLine.Split(' ')
    if ($requestParts.Count -ne 3 -or $requestParts[0] -ne 'GET' -or
        $requestParts[1] -notmatch '^/\?' -or $requestParts[2] -notmatch '^HTTP/1\.[01]$') {
        Send-LoopbackResponse $loopbackClient 400 'Invalid OAuth callback.'
        throw 'Google returned an invalid OAuth callback.'
    }
    $callbackUri = New-Object System.Uri("http://127.0.0.1$($requestParts[1])")
    if ($callbackUri.AbsolutePath -ne '/') {
        Send-LoopbackResponse $loopbackClient 400 'Invalid OAuth callback.'
        throw 'Google returned an invalid OAuth callback.'
    }
    $callbackQuery = [System.Web.HttpUtility]::ParseQueryString($callbackUri.Query)
    if ($callbackQuery['state'] -ne $state) {
        Send-LoopbackResponse $loopbackClient 400 'OAuth state validation failed.'
        throw 'Google OAuth state validation failed.'
    }
    if ($callbackQuery['error']) {
        Send-LoopbackResponse $loopbackClient 400 'Google authorization was denied.'
        throw 'Google OAuth authorization was denied.'
    }
    $authorizationCode = $callbackQuery['code']
    if (-not $authorizationCode) {
        Send-LoopbackResponse $loopbackClient 400 'Google did not return an authorization code.'
        throw 'Google did not return an authorization code.'
    }
    Send-LoopbackResponse $loopbackClient 200 'Authorization received. You can close this browser window.'
    $loopbackClient.Close()
    $loopbackClient = $null
    $listener.Stop()

    try {
        $tokenResponse = Invoke-RestMethod -Method Post -Uri 'https://oauth2.googleapis.com/token' `
            -ContentType 'application/x-www-form-urlencoded' -Body @{
                code = $authorizationCode
                client_id = $clientId
                client_secret = $clientSecret
                redirect_uri = $redirectUri
                grant_type = 'authorization_code'
                code_verifier = $verifier
            } -ErrorAction Stop
    }
    catch { throw 'Google token exchange failed. Check the OAuth client and consent settings, then retry.' }
    if (-not $tokenResponse.access_token) { throw 'Google did not return an access token.' }
    try {
        $profile = Invoke-RestMethod -Method Get -Uri 'https://gmail.googleapis.com/gmail/v1/users/me/profile' `
            -Headers @{ Authorization = ('Bea' + 'rer ' + [string]$tokenResponse.access_token) } -ErrorAction Stop
    }
    catch { throw 'Could not verify the authorized Gmail account.' }
    if ([string]$profile.emailAddress -ne 'danaakesen@gmail.com') {
        throw 'The OAuth account must be danaakesen@gmail.com.'
    }
    $refreshToken = [string]$tokenResponse.refresh_token
    if (-not $refreshToken -or $refreshToken.Length -gt 10000 -or $refreshToken -match '[\r\n]') {
        throw 'Google did not issue a refresh token. Re-run consent with offline access and consent prompt.'
    }

    $secrets = @(
        @{ Name = 'google-oauth-client-id'; Value = $clientId }
        @{ Name = 'google-oauth-client-secret'; Value = $clientSecret }
        @{ Name = 'google-refresh-token'; Value = $refreshToken }
    )
    foreach ($secret in $secrets) {
        $file = Write-SecretFile $secret.Name $secret.Value
        $stored = $false
        for ($attempt = 1; $attempt -le 12; $attempt++) {
            Invoke-Native {
                & az keyvault secret set --vault-name $keyVaultName --name $secret.Name `
                    --file $file --content-type text/plain --output none --only-show-errors
            }
            if ($LASTEXITCODE -eq 0) { $stored = $true; break }
            Start-Sleep -Seconds 5
        }
        if (-not $stored) { throw "Could not store Key Vault secret '$($secret.Name)'." }
    }

    & gh variable set JARVIS_GOOGLE_TIME_ZONE --repo $GitHubRepo --body $TimeZone
    if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI could not set JARVIS_GOOGLE_TIME_ZONE.' }
    Write-Host 'Google Gmail and Calendar credentials are stored in Key Vault.'
}
finally {
    if ($loopbackClient) { $loopbackClient.Close() }
    if ($pendingConnection) { $pendingConnection.AsyncWaitHandle.Close() }
    if ($listener) { $listener.Stop() }
    if ($requestBytes) { $requestBytes.Dispose() }
    if ($roleAssignmentId) {
        Invoke-Native {
            & az role assignment delete --ids $roleAssignmentId --subscription $SubscriptionId `
                --output none --only-show-errors
        }
        if ($LASTEXITCODE -ne 0) {
            Write-Warning 'Temporary Key Vault access could not be removed. Delete the role assignment manually.'
        }
    }
    if ($tempDirectory -and (Test-Path -LiteralPath $tempDirectory)) {
        Remove-Item -LiteralPath $tempDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
    $clientId = $null
    $clientSecret = $null
    $refreshToken = $null
    $secureClientId = $null
    $secureClientSecret = $null
    $secrets = $null
    $secret = $null
    $profile = $null
    $verifier = $null
    $authorizationCode = $null
    $tokenResponse = $null
}
