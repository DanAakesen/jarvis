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
$backendOrigin = $backendUri.GetLeftPart([UriPartial]::Authority)

$source = (Resolve-Path -LiteralPath $PublishPath).Path
$executable = Join-Path $source 'Jarvis.PcBridge.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw 'PublishPath must contain Jarvis.PcBridge.exe.'
}
$extensionManifest = Join-Path $source 'chrome-extension\manifest.json'
if (-not (Test-Path -LiteralPath $extensionManifest -PathType Leaf)) {
    throw 'PublishPath must contain chrome-extension\manifest.json.'
}

$local = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$installDirectory = Join-Path $local 'Programs\Jarvis.PcBridge'
$settingsDirectory = Join-Path $local 'Jarvis\PcBridge'
$startupDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$settingsPath = Join-Path $settingsDirectory 'settings.json'
$shortcutPath = Join-Path $startupDirectory 'Jarvis PC bridge.lnk'
$extensionDirectory = Join-Path $installDirectory 'chrome-extension'
Import-Module (Join-Path $PSScriptRoot 'BridgeInstaller.Helpers.psm1') -Force
$sourceExtensionHash = Get-BridgeExtensionHash -Path (Join-Path $source 'chrome-extension')
$installedExtensionHash = Get-BridgeExtensionHash -Path $extensionDirectory

New-Item -ItemType Directory -Path $installDirectory, $settingsDirectory -Force | Out-Null

$copyAttempts = 5
for ($attempt = 1; $attempt -le $copyAttempts; $attempt++) {
    Get-Process -Name 'Jarvis.PcBridge' -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
    try {
        Copy-Item -Path (Join-Path $source '*') -Destination $installDirectory -Recurse -Force -ErrorAction Stop
        break
    }
    catch {
        if ($attempt -eq $copyAttempts) {
            throw "Could not update the PC bridge after $copyAttempts attempts. Close Chrome and retry. $($_.Exception.Message)"
        }

        Start-Sleep -Milliseconds 400
    }
}

$nativeHostManifestPath = Join-Path $installDirectory 'com.jarvis.pcbridge.json'
$nativeHostManifest = [ordered]@{
    name = 'com.jarvis.pcbridge'
    description = 'Jarvis PC bridge Chrome extension transport'
    path = (Join-Path $installDirectory 'Jarvis.PcBridge.exe')
    type = 'stdio'
    allowed_origins = @('chrome-extension://emeeijaopandgohikamdpjajpmkkdlbg/')
} | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText($nativeHostManifestPath, $nativeHostManifest, [Text.UTF8Encoding]::new($false))
$nativeHostKey = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.jarvis.pcbridge'
New-Item -Path $nativeHostKey -Force | Out-Null
Set-Item -Path $nativeHostKey -Value $nativeHostManifestPath

$browserAutomationEnabled = Update-BridgeSettings `
    -Path $settingsPath `
    -BackendUrl $backendOrigin `
    -TenantId $TenantId.ToString() `
    -ApiClientId $ApiClientId.ToString() `
    -BridgeClientId $BridgeClientId.ToString()
$extensionChanged = $sourceExtensionHash -ne $installedExtensionHash

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $installDirectory 'Jarvis.PcBridge.exe'
$shortcut.WorkingDirectory = $installDirectory
$shortcut.Description = 'Authenticated outbound Jarvis PC bridge'
$shortcut.Save()

Write-Host 'Jarvis PC bridge installed for the current Windows user.'
Write-Host "Configuration: $settingsPath"
Write-Host "Chrome browser automation: $(if ($browserAutomationEnabled) { 'on' } else { 'off' })."
Write-Host 'The bridge starts at sign-in and connects outbound; no inbound network listener is created.'
if ($null -eq $installedExtensionHash) {
    Write-Host 'Load the installed chrome-extension folder from chrome://extensions with Developer mode enabled.'
}
elseif ($extensionChanged) {
    Write-Host 'Chrome extension files changed. Reload the unpacked extension from chrome://extensions.'
}
else {
    Write-Host 'Chrome extension files are unchanged; no reload is needed.'
}
