$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot '..\BridgeInstaller.Helpers.psm1') -Force

$testDirectory = Join-Path ([IO.Path]::GetTempPath()) "jarvis-bridge-installer-tests-$([guid]::NewGuid())"
$settingsPath = Join-Path $testDirectory 'settings.json'

function Assert-Equal {
    param(
        [object]$Expected,
        [object]$Actual,
        [string]$Message
    )

    if ($Expected -is [bool]) {
        if ($Actual -is [bool] -and $Expected -eq $Actual) {
            return
        }

        throw "$Message Expected '$Expected', got '$Actual'."
    }

    if ([string]$Expected -cne [string]$Actual) {
        throw "$Message Expected '$Expected', got '$Actual'."
    }
}

try {
    New-Item -ItemType Directory -Path $testDirectory -Force | Out-Null
    [IO.File]::WriteAllText($settingsPath, '{"BrowserEnabled":true,"CustomChoice":{"Mode":"careful"},"BackendUrl":"https://old.example"}')

    $browserEnabled = Update-BridgeSettings `
        -Path $settingsPath `
        -BackendUrl 'https://new.example' `
        -TenantId 'tenant-new' `
        -ApiClientId 'api-new' `
        -BridgeClientId 'bridge-new'
    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json

    Assert-Equal $true $browserEnabled 'The installer must report the retained browser setting.'
    Assert-Equal $true $settings.BrowserEnabled 'The installer must preserve Chrome automation.'
    Assert-Equal 'careful' $settings.CustomChoice.Mode 'The installer must preserve unrelated user settings.'
    Assert-Equal 'https://new.example' $settings.BackendUrl 'The installer must update its backend setting.'
    Assert-Equal 'tenant-new' $settings.TenantId 'The installer must update its tenant setting.'
    Assert-Equal 'api-new' $settings.ApiClientId 'The installer must update its API client setting.'
    Assert-Equal 'bridge-new' $settings.BridgeClientId 'The installer must update its bridge client setting.'

    Remove-Item -LiteralPath $settingsPath -Force
    $browserEnabled = Update-BridgeSettings `
        -Path $settingsPath `
        -BackendUrl 'https://new.example' `
        -TenantId 'tenant-new' `
        -ApiClientId 'api-new' `
        -BridgeClientId 'bridge-new'
    Assert-Equal $false $browserEnabled 'A first install must default Chrome automation to off.'

    $extensionPath = Join-Path $testDirectory 'chrome-extension'
    New-Item -ItemType Directory -Path $extensionPath -Force | Out-Null
    $firstHash = Get-BridgeExtensionHash -Path $extensionPath
    [IO.File]::WriteAllText((Join-Path $extensionPath 'service-worker.js'), 'updated')
    $secondHash = Get-BridgeExtensionHash -Path $extensionPath
    if ($firstHash -ceq $secondHash) {
        throw 'Extension content changes must produce a different hash.'
    }
}
finally {
    Remove-Item -LiteralPath $testDirectory -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'Bridge installer helper tests passed.'
