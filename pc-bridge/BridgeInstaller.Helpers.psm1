function Update-BridgeSettings {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Path,
        [Parameter(Mandatory)]
        [string]$BackendUrl,
        [Parameter(Mandatory)]
        [string]$TenantId,
        [Parameter(Mandatory)]
        [string]$ApiClientId,
        [Parameter(Mandatory)]
        [string]$BridgeClientId
    )

    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        try {
            $settings = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            throw "Existing PC bridge settings are invalid: $Path"
        }

        if ($null -eq $settings -or $settings -isnot [pscustomobject]) {
            throw "Existing PC bridge settings must contain a JSON object: $Path"
        }
    }
    else {
        $settings = [pscustomobject]@{}
    }

    foreach ($field in ([ordered]@{
        BackendUrl = $BackendUrl
        TenantId = $TenantId
        ApiClientId = $ApiClientId
        BridgeClientId = $BridgeClientId
    }).GetEnumerator()) {
        Add-Member -InputObject $settings -MemberType NoteProperty -Name $field.Key -Value $field.Value -Force
    }

    $browserEnabled = $false
    $browserEnabledProperty = $settings.PSObject.Properties['BrowserEnabled']
    if ($null -ne $browserEnabledProperty) {
        if ($browserEnabledProperty.Value -isnot [bool]) {
            throw 'BrowserEnabled in the existing PC bridge settings must be a boolean.'
        }

        $browserEnabled = $browserEnabledProperty.Value
    }

    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $temporaryPath = "$Path.tmp"
    try {
        $json = ConvertTo-Json -InputObject $settings -Depth 100
        [IO.File]::WriteAllText($temporaryPath, $json, [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $temporaryPath -Destination $Path -Force | Out-Null
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }

    return $browserEnabled
}

function Get-BridgeExtensionHash {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        return $null
    }

    $directory = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path).Path)
    $entries = [System.Collections.Generic.List[string]]::new()
    foreach ($file in (Get-ChildItem -LiteralPath $directory -File -Recurse -Force | Sort-Object FullName)) {
        $relativePath = $file.FullName.Substring($directory.Length).TrimStart([char[]]@('\', '/'))
        $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        $entries.Add("$relativePath=$hash")
    }

    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $payload = [Text.Encoding]::UTF8.GetBytes([string]::Join("`n", $entries))
        return [Convert]::ToBase64String($sha256.ComputeHash($payload))
    }
    finally {
        $sha256.Dispose()
    }
}

Export-ModuleMember -Function Update-BridgeSettings, Get-BridgeExtensionHash
