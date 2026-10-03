Set-StrictMode -Version Latest

# This is the exact identity created by the first Application Insights
# deployment. Keep these values fixed: discovery must never broaden into a
# subscription-wide workspace search or an unrelated-resource cleanup.
$PrototypeLegacyManagedWorkspaceResourceGroup = "ai_jarvis-poc-appins_bc830105-74f0-41c7-b6e5-98d20a67ef73_managed"
$PrototypeLegacyManagedWorkspaceName = "managed-jarvis-poc-appins-ws"
$PrototypeLegacyManagedWorkspaceType = "Microsoft.OperationalInsights/workspaces"
$PrototypeLegacyManagedResourceGroupType = "Microsoft.Resources/resourceGroups"

function Get-PrototypeLegacyManagedWorkspaceResourceId {
    param(
        [Parameter(Mandatory)][string]$Subscription
    )

    return "/subscriptions/$Subscription/resourceGroups/$PrototypeLegacyManagedWorkspaceResourceGroup/providers/$PrototypeLegacyManagedWorkspaceType/$PrototypeLegacyManagedWorkspaceName"
}

function Get-PrototypeLegacyManagedResourceGroupResourceId {
    param(
        [Parameter(Mandatory)][string]$Subscription
    )

    return "/subscriptions/$Subscription/resourceGroups/$PrototypeLegacyManagedWorkspaceResourceGroup"
}

function Remove-PrototypeLegacyManagedResource {
    param(
        [Parameter(Mandatory)][string]$Subscription,
        [Parameter(Mandatory)][ValidateSet("workspace", "resourceGroup")][string]$ResourceKind,
        [scriptblock]$AzInvoker
    )

    $resourceId = if ($ResourceKind -eq "workspace") {
        Get-PrototypeLegacyManagedWorkspaceResourceId -Subscription $Subscription
    } else {
        Get-PrototypeLegacyManagedResourceGroupResourceId -Subscription $Subscription
    }
    $arguments = if ($ResourceKind -eq "workspace") {
        @(
            "resource", "delete", "--ids", $resourceId,
            "--subscription", $Subscription, "--only-show-errors"
        )
    } else {
        @(
            "group", "delete", "--name", $PrototypeLegacyManagedWorkspaceResourceGroup,
            "--yes", "--subscription", $Subscription, "--only-show-errors"
        )
    }

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
    $output = if ($null -ne $result -and $result.PSObject.Properties.Name -contains "Output") {
        (@($result.Output) -join "`n").Trim()
    } else {
        ""
    }
    if ($exitCode -ne 0) {
        if ([string]::IsNullOrWhiteSpace($output)) {
            $output = "Azure returned no error details."
        }
        throw "Could not delete exact prototype-managed $ResourceKind '$resourceId'; refusing to continue. Azure response: $output"
    }

    return $resourceId
}

function Test-PrototypeLegacyManagedWorkspaceNotFound {
    param(
        [Parameter(Mandatory)][string]$Output,
        [Parameter(Mandatory)][string]$ExpectedResourceId,
        [ValidateSet("workspace", "managedResourceGroup")]
        [string]$ExpectedResourceKind = "workspace"
    )

    $structuredResponse = $null
    try {
        $structuredResponse = $Output | ConvertFrom-Json -ErrorAction Stop
    } catch {
        # An unstructured Azure CLI message cannot bind a not-found code to
        # the exact recorded resource. It must therefore fail closed.
        return $false
    }

    if ($null -eq $structuredResponse) {
        return $false
    }

    $records = [System.Collections.Generic.List[object]]::new()
    $pending = [System.Collections.Generic.Queue[object]]::new()
    foreach ($item in @($structuredResponse)) {
        if ($null -ne $item) {
            $pending.Enqueue($item)
        }
    }
    while ($pending.Count -gt 0) {
        $record = $pending.Dequeue()
        if ($null -eq $record) { continue }
        if ($record -is [System.Array]) {
            foreach ($item in $record) {
                if ($null -ne $item) {
                    $pending.Enqueue($item)
                }
            }
            continue
        }
        if ($record -is [string] -or $record.GetType().IsValueType) {
            continue
        }
        [void]$records.Add($record)
        foreach ($property in $record.PSObject.Properties) {
            $value = $property.Value
            if ($null -eq $value -or $value -is [string] -or $value.GetType().IsValueType) {
                continue
            }
            $pending.Enqueue($value)
        }
    }

    $knownNotFoundRecords = @()
    $identityAssertions = @()
    $codes = @()
    $statuses = @()
    foreach ($record in $records) {
        foreach ($propertyName in @("code", "Code", "errorCode", "ErrorCode")) {
            if ($record.PSObject.Properties.Name -contains $propertyName) {
                $code = [string]$record.$propertyName
                if (-not [string]::IsNullOrWhiteSpace($code)) {
                    $codes += $code
                    if ($code -match "(?i)^(ResourceNotFound|ResourceGroupNotFound)$") {
                        $knownNotFoundRecords += $record
                    }
                }
            }
        }
        foreach ($property in $record.PSObject.Properties) {
            $kind = $null
            switch -Regex ($property.Name) {
                "^(id|resourceId|target)$" {
                    $kind = "resource"
                    break
                }
                "^(resourceGroup|resourceGroupName)$" {
                    $kind = "resourceGroup"
                    break
                }
                "^(subscription|subscriptionId)$" {
                    $kind = "subscription"
                    break
                }
                "^name$" {
                    $kind = "name"
                    break
                }
                "^(type|provider|providerType)$" {
                    $kind = "type"
                    break
                }
            }
            if ($null -eq $kind) {
                continue
            }
            $value = $property.Value
            if (
                $null -eq $value -or
                $value -is [System.Array] -or
                ($value -isnot [string] -and -not $value.GetType().IsValueType)
            ) {
                $identityAssertions += [pscustomobject]@{
                    Kind = $kind
                    Value = $null
                }
                continue
            }
            $identityAssertions += [pscustomobject]@{
                Kind = $kind
                Value = [string]$value
            }
        }
        foreach ($propertyName in @("status", "statusCode", "httpStatusCode")) {
            if ($record.PSObject.Properties.Name -contains $propertyName) {
                $status = [string]$record.$propertyName
                if (-not [string]::IsNullOrWhiteSpace($status)) {
                    $statuses += $status
                }
            }
        }
    }

    $unexpectedCode = @(
        $codes | Where-Object {
            -not [string]::IsNullOrWhiteSpace($_) -and
            $_ -notmatch "(?i)^(ResourceNotFound|ResourceGroupNotFound)$"
        }
    ).Count -gt 0
    if ($knownNotFoundRecords.Count -eq 0 -or $unexpectedCode) {
        return $false
    }

    if (
        @($statuses | Where-Object { $_ -notmatch "^\s*404\s*$" }).Count -gt 0
    ) {
        return $false
    }

    $expectedResourceIdNormalized = $ExpectedResourceId.TrimEnd("/")
    $expectedResourceGroup = $PrototypeLegacyManagedWorkspaceResourceGroup
    $expectedSubscription = $expectedResourceIdNormalized -replace (
        "(?i)^/subscriptions/([^/]+)/.*$"
    ), '$1'
    $expectedResourceGroupId = "/subscriptions/$expectedSubscription/resourceGroups/$expectedResourceGroup"

    $expectedAnchorId = if ($ExpectedResourceKind -eq "workspace") {
        $expectedResourceIdNormalized
    } else {
        $expectedResourceGroupId
    }
    $hasExpectedAnchor = $false
    foreach ($assertion in $identityAssertions) {
        if ($null -eq $assertion.Value) {
            return $false
        }
        $normalizedValue = $assertion.Value.TrimEnd("/")
        if ([string]::IsNullOrWhiteSpace($normalizedValue)) {
            return $false
        }
        if ($assertion.Kind -ne "resource") {
            continue
        }
        if ($normalizedValue.Equals(
                $expectedAnchorId,
                [StringComparison]::OrdinalIgnoreCase
            )) {
            $hasExpectedAnchor = $true
        } else {
            return $false
        }
    }

    # Component fields cannot substitute for a full resource or resource-group
    # anchor. The caller selects the expected profile explicitly so a
    # managed-resource-group lookup cannot accidentally use the workspace
    # profile when both IDs have the same subscription and group segments.
    if (-not $hasExpectedAnchor) {
        return $false
    }

    $expectedName = if ($ExpectedResourceKind -eq "workspace") {
        $PrototypeLegacyManagedWorkspaceName
    } else {
        $expectedResourceGroup
    }
    $expectedType = if ($ExpectedResourceKind -eq "workspace") {
        $PrototypeLegacyManagedWorkspaceType
    } else {
        $PrototypeLegacyManagedResourceGroupType
    }

    foreach ($assertion in $identityAssertions) {
        $normalizedValue = $assertion.Value.TrimEnd("/")
        switch ($assertion.Kind) {
            "resource" {
                # Resource anchors were validated while selecting the anchor
                # type above; the branch remains explicit for all identity
                # kinds collected from the response envelope.
            }
            "resourceGroup" {
                if (-not $normalizedValue.Equals(
                        $expectedResourceGroup,
                        [StringComparison]::OrdinalIgnoreCase
                    )) {
                    return $false
                }
            }
            "subscription" {
                if (-not $normalizedValue.Equals(
                        $expectedSubscription,
                        [StringComparison]::OrdinalIgnoreCase
                    )) {
                    return $false
                }
            }
            "name" {
                if (-not $normalizedValue.Equals(
                        $expectedName,
                        [StringComparison]::OrdinalIgnoreCase
                    )) {
                    return $false
                }
            }
            "type" {
                if (-not $normalizedValue.Equals(
                        $expectedType,
                        [StringComparison]::OrdinalIgnoreCase
                    )) {
                    return $false
                }
            }
        }
    }

    return $true
}

function Get-PrototypeLegacyManagedWorkspace {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Subscription,
        [scriptblock]$AzInvoker
    )

    $expectedResourceId = Get-PrototypeLegacyManagedWorkspaceResourceId -Subscription $Subscription
    $arguments = @(
        "resource", "show",
        "--ids", $expectedResourceId,
        "--query", "{id:id,name:name,resourceGroup:resourceGroup,type:type}",
        "--output", "json",
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
    $output = if ($null -ne $result -and $result.PSObject.Properties.Name -contains "Output") {
        (@($result.Output) -join "`n").Trim()
    } else {
        ""
    }

    if ($exitCode -ne 0) {
        # A precise not-found response is the only failure treated as an
        # absent resource. Permission, tenant, subscription, and transient
        # failures remain fatal so teardown cannot claim verification.
        if (-not (Test-PrototypeLegacyManagedWorkspaceNotFound `
                -Output $output `
                -ExpectedResourceId $expectedResourceId `
                -ExpectedResourceKind workspace)) {
            throw "Could not verify prototype-managed workspace '$expectedResourceId'; refusing to continue."
        }
        return $null
    }
    if ([string]::IsNullOrWhiteSpace($output)) {
        throw "Azure returned no identity for prototype-managed workspace '$expectedResourceId'; refusing to continue."
    }

    try {
        $workspace = $output | ConvertFrom-Json
    } catch {
        throw "Azure returned invalid identity for prototype-managed workspace '$expectedResourceId'; refusing to continue."
    }

    $actualResourceId = [string]$workspace.id
    $actualName = [string]$workspace.name
    $actualResourceGroup = [string]$workspace.resourceGroup
    $actualType = [string]$workspace.type
    $sameResourceId = $actualResourceId.TrimEnd("/").Equals($expectedResourceId, [StringComparison]::OrdinalIgnoreCase)
    $sameType = $actualType.Equals($PrototypeLegacyManagedWorkspaceType, [StringComparison]::OrdinalIgnoreCase)
    if (
        -not $sameResourceId -or
        $actualName -cne $PrototypeLegacyManagedWorkspaceName -or
        $actualResourceGroup -cne $PrototypeLegacyManagedWorkspaceResourceGroup -or
        -not $sameType
    ) {
        throw "Azure returned an unexpected resource while checking prototype-managed workspace '$expectedResourceId'; refusing to continue."
    }

    return [pscustomobject]@{
        ResourceId = $expectedResourceId
        Name = $PrototypeLegacyManagedWorkspaceName
        ResourceGroup = $PrototypeLegacyManagedWorkspaceResourceGroup
        Type = $PrototypeLegacyManagedWorkspaceType
    }
}

function Get-PrototypeLegacyManagedResourceGroup {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Subscription,
        [Parameter(Mandatory)][string]$ExpectedManagedBy,
        [scriptblock]$AzInvoker
    )

    if ([string]::IsNullOrWhiteSpace($ExpectedManagedBy)) {
        throw "Expected managed-by resource is required; refusing to continue."
    }

    $expectedResourceGroupId = Get-PrototypeLegacyManagedResourceGroupResourceId `
        -Subscription $Subscription
    $arguments = @(
        "group", "show",
        "--name", $PrototypeLegacyManagedWorkspaceResourceGroup,
        "--query", "{id:id,name:name,managedBy:managedBy}",
        "--output", "json",
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
    $output = if ($null -ne $result -and $result.PSObject.Properties.Name -contains "Output") {
        (@($result.Output) -join "`n").Trim()
    } else {
        ""
    }

    if ($exitCode -ne 0) {
        if (-not (Test-PrototypeLegacyManagedWorkspaceNotFound `
                -Output $output `
                -ExpectedResourceId $expectedResourceGroupId `
                -ExpectedResourceKind managedResourceGroup)) {
            throw "Could not verify prototype-managed resource group '$expectedResourceGroupId'; refusing to continue."
        }
        return $null
    }
    if ([string]::IsNullOrWhiteSpace($output)) {
        throw "Azure returned no identity for prototype-managed resource group '$expectedResourceGroupId'; refusing to continue."
    }

    try {
        $resourceGroup = $output | ConvertFrom-Json
    } catch {
        throw "Azure returned invalid identity for prototype-managed resource group '$expectedResourceGroupId'; refusing to continue."
    }

    $actualResourceId = [string]$resourceGroup.id
    $actualName = [string]$resourceGroup.name
    $actualManagedBy = [string]$resourceGroup.managedBy
    if ([string]::IsNullOrWhiteSpace($actualManagedBy)) {
        throw "Azure returned no managed-by identity for prototype-managed resource group '$expectedResourceGroupId'; refusing to continue."
    }
    $sameResourceId = $actualResourceId.TrimEnd("/").Equals(
        $expectedResourceGroupId,
        [StringComparison]::OrdinalIgnoreCase
    )
    $sameManagedBy = $actualManagedBy.TrimEnd("/").Equals(
        $ExpectedManagedBy.TrimEnd("/"),
        [StringComparison]::OrdinalIgnoreCase
    )
    if (
        -not $sameResourceId -or
        $actualName -cne $PrototypeLegacyManagedWorkspaceResourceGroup -or
        -not $sameManagedBy
    ) {
        throw "Azure returned an unexpected resource group while checking prototype-managed resource group '$expectedResourceGroupId'; refusing to continue."
    }

    return [pscustomobject]@{
        ResourceId = $expectedResourceGroupId
        Name = $PrototypeLegacyManagedWorkspaceResourceGroup
        ManagedBy = $ExpectedManagedBy
    }
}
