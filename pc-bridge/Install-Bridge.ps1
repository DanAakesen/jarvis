[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$PublishPath,
    [Parameter(Mandatory)]
    [string]$BackendUrl,
    [Parameter(Mandatory)]
    [guid]$TenantId,
    [Parameter(Mandatory)]
    [guid]$ApiClientId,
    [Parameter(Mandatory)]
    [guid]$BridgeClientId
)

$ErrorActionPreference = 'Stop'

$backendUri = $null
if (-not [uri]::TryCreate($BackendUrl, [UriKind]::Absolute, [ref]$backendUri) -or
    $backendUri.UserInfo -or $backendUri.Query -or $backendUri.Fragment -or
    $backendUri.AbsolutePath -ne '/' -or
    ($backendUri.Scheme -ne 'https' -and -not ($backendUri.Scheme -eq 'http' -and $backendUri.IsLoopback))) {
    throw 'BackendUrl must be an HTTPS backend origin (or an HTTP loopback origin for local tests).'
}

$source = (Resolve-Path -LiteralPath $PublishPath).Path
$executable = Join-Path $source 'Jarvis.PcBridge.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw 'PublishPath must contain Jarvis.PcBridge.exe.'
}

$local = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$installDirectory = Join-Path $local 'Programs\Jarvis.PcBridge'
$settingsDirectory = Join-Path $local 'Jarvis\PcBridge'
$startupDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$settingsPath = Join-Path $settingsDirectory 'settings.json'
$shortcutPath = Join-Path $startupDirectory 'Jarvis PC bridge.lnk'

Get-Process -Name 'Jarvis.PcBridge' -ErrorAction SilentlyContinue | Stop-Process -Force
New-Item -ItemType Directory -Path $installDirectory, $settingsDirectory -Force | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $installDirectory -Recurse -Force

$settings = [ordered]@{
    BackendUrl = $backendUri.GetLeftPart([UriPartial]::Authority)
    TenantId = $TenantId.ToString()
    ApiClientId = $ApiClientId.ToString()
    BridgeClientId = $BridgeClientId.ToString()
} | ConvertTo-Json
$temporarySettingsPath = "$settingsPath.tmp"
[IO.File]::WriteAllText($temporarySettingsPath, $settings, [Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $temporarySettingsPath -Destination $settingsPath -Force

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $installDirectory 'Jarvis.PcBridge.exe'
$shortcut.WorkingDirectory = $installDirectory
$shortcut.Description = 'Authenticated outbound Jarvis PC bridge'
$shortcut.Save()

Write-Host 'Jarvis PC bridge installed for the current Windows user.'
Write-Host "Configuration: $settingsPath"
Write-Host 'The bridge starts at sign-in and connects outbound; no inbound firewall rule is created.'
