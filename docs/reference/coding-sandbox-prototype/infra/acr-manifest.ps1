function Assert-AcrManifest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Tag,
        [Parameter(Mandatory)][string]$RegistryName,
        [Parameter(Mandatory)][string]$Subscription,
        [scriptblock]$AzInvoker
    )

    $selectedTag = $Tag.Trim()
    if ([string]::IsNullOrWhiteSpace($selectedTag)) {
        throw "An image tag is required; refusing to create a hosted-agent version."
    }

    $manifestName = "jarvis-runner:$selectedTag"
    $arguments = @(
        "acr", "manifest", "show-metadata",
        "--registry", $RegistryName,
        "--name", $manifestName,
        "--query", "digest",
        "--output", "tsv",
        "--subscription", $Subscription,
        "--only-show-errors"
    )

    if ($null -eq $AzInvoker) {
        $AzInvoker = {
            param([string[]]$Arguments)
            $output = & az @Arguments 2>&1
            [pscustomobject]@{
                ExitCode = $LASTEXITCODE
                Output = @($output)
            }
        }
    }

    $result = & $AzInvoker $arguments
    $exitCode = if ($null -ne $result -and $result.PSObject.Properties.Name -contains "ExitCode") {
        [int]$result.ExitCode
    } else {
        -1
    }
    $digest = if ($null -ne $result -and $result.PSObject.Properties.Name -contains "Output") {
        (@($result.Output) -join "`n").Trim()
    } else {
        ""
    }

    # show-metadata is the Azure CLI contract that returns the selected tag's
    # registry digest. Anything other than a complete sha256 digest is a
    # missing or unusable manifest and must fail closed.
    if (
        $exitCode -ne 0 -or
        $digest -notmatch '^sha256:[0-9a-fA-F]{64}$'
    ) {
        throw "Selected ACR image manifest '$manifestName' was not found; refusing to create a hosted-agent version."
    }

    return $digest
}
