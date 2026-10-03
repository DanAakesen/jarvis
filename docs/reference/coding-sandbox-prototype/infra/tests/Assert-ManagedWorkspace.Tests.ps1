[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "..\managed-workspace.ps1")

$targetSubscription = "0ac7d719-89bc-4100-be87-a79d33e953a7"
$currentAppInsightsWorkspaceId = "/subscriptions/$targetSubscription/resourceGroups/rg-jarvis-poc/providers/Microsoft.OperationalInsights/workspaces/jarvis-poc-law"
$expectedManagedBy = "/subscriptions/$targetSubscription/resourceGroups/rg-jarvis-poc/providers/Microsoft.Insights/components/jarvis-poc-appins"
$expectedResourceId = Get-PrototypeLegacyManagedWorkspaceResourceId -Subscription $targetSubscription
$expectedResourceGroupId = Get-PrototypeLegacyManagedResourceGroupResourceId -Subscription $targetSubscription
$lastArguments = @()
$deleteCalls = 0

function Assert-Equal {
    param(
        [Parameter(Mandatory)]$Actual,
        [Parameter(Mandatory)]$Expected,
        [Parameter(Mandatory)][string]$Message
    )
    if ($Actual -ne $Expected) {
        throw "$Message. Expected '$Expected', got '$Actual'."
    }
}

function Assert-True {
    param(
        [Parameter(Mandatory)][bool]$Condition,
        [Parameter(Mandatory)][string]$Message
    )
    if (-not $Condition) { throw $Message }
}

function Assert-Throws {
    param(
        [Parameter(Mandatory)][scriptblock]$Script,
        [Parameter(Mandatory)][string]$Message
    )
    try {
        & $Script
    } catch {
        return
    }
    throw "$Message Expected an exception."
}

function Assert-FailsClosed {
    param(
        [Parameter(Mandatory)][int]$ExitCode,
        [Parameter(Mandatory)][string]$Output,
        [Parameter(Mandatory)][string]$Message
    )
    Assert-Throws {
        Get-PrototypeLegacyManagedWorkspace `
            -Subscription $targetSubscription `
            -AzInvoker {
                param([string[]]$Arguments)
                if ($Arguments -contains "delete") {
                    $script:deleteCalls++
                }
                [pscustomobject]@{
                    ExitCode = $ExitCode
                    Output = @($Output)
                }
            }
    } $Message
}

function Assert-GroupFailsClosed {
    param(
        [Parameter(Mandatory)][int]$ExitCode,
        [Parameter(Mandatory)][string]$Output,
        [Parameter(Mandatory)][string]$Message
    )
    Assert-Throws {
        Get-PrototypeLegacyManagedResourceGroup `
            -Subscription $targetSubscription `
            -ExpectedManagedBy $expectedManagedBy `
            -AzInvoker {
                param([string[]]$Arguments)
                if ($Arguments -contains "delete") {
                    $script:deleteCalls++
                }
                [pscustomobject]@{
                    ExitCode = $ExitCode
                    Output = @($Output)
                }
            }
    } $Message
}

function Assert-RejectsIdentity {
    param(
        [Parameter(Mandatory)]$Identity,
        [Parameter(Mandatory)][string]$Description
    )
    Assert-Throws {
        Get-PrototypeLegacyManagedWorkspace `
            -Subscription $targetSubscription `
            -AzInvoker {
                param([string[]]$Arguments)
                if ($Arguments -contains "delete") {
                    $script:deleteCalls++
                }
                [pscustomobject]@{
                    ExitCode = 0
                    Output = @($Identity | ConvertTo-Json -Compress)
                }
            }
    } "$Description must be rejected"
}

$legacyFixture = [pscustomobject]@{
    id = $expectedResourceId
    name = $PrototypeLegacyManagedWorkspaceName
    resourceGroup = $PrototypeLegacyManagedWorkspaceResourceGroup
    type = $PrototypeLegacyManagedWorkspaceType
}

# The current App Insights link is now inside the approved resource group.
# Discovery must still use the recorded exact legacy identity, not that link.
$legacyWorkspace = Get-PrototypeLegacyManagedWorkspace `
    -Subscription $targetSubscription `
    -AzInvoker {
        param([string[]]$Arguments)
        $script:lastArguments = @($Arguments)
        [pscustomobject]@{
            ExitCode = 0
            Output = @($legacyFixture | ConvertTo-Json -Compress)
        }
    }
Assert-True -Condition ($null -ne $legacyWorkspace) `
    -Message "The known legacy workspace must be discovered after App Insights is relinked."
Assert-Equal -Actual $legacyWorkspace.ResourceId -Expected $expectedResourceId `
    -Message "Discovery must return the exact legacy resource ID"
Assert-Equal -Actual $lastArguments[$lastArguments.IndexOf("--ids") + 1] -Expected $expectedResourceId `
    -Message "Discovery must query the exact legacy resource ID"
Assert-True -Condition ($lastArguments -notcontains $currentAppInsightsWorkspaceId) `
    -Message "Discovery must not depend on the current App Insights workspace link"

$groupLastArguments = @()
$legacyGroupFixture = [pscustomobject]@{
    id = $expectedResourceGroupId
    name = $PrototypeLegacyManagedWorkspaceResourceGroup
    managedBy = $expectedManagedBy
}
$legacyGroup = Get-PrototypeLegacyManagedResourceGroup `
    -Subscription $targetSubscription `
    -ExpectedManagedBy $expectedManagedBy `
    -AzInvoker {
        param([string[]]$Arguments)
        $script:groupLastArguments = @($Arguments)
        [pscustomobject]@{
            ExitCode = 0
            Output = @($legacyGroupFixture | ConvertTo-Json -Compress)
        }
    }
Assert-True -Condition ($null -ne $legacyGroup) `
    -Message "The exact legacy managed resource group must be discovered"
Assert-Equal -Actual $legacyGroup.ResourceId -Expected $expectedResourceGroupId `
    -Message "Managed-group discovery must return the exact recorded group ID"
Assert-Equal -Actual $legacyGroup.ManagedBy -Expected $expectedManagedBy `
    -Message "Managed-group discovery must retain the exact manager resource"
Assert-Equal -Actual $groupLastArguments[$groupLastArguments.IndexOf("--name") + 1] `
    -Expected $PrototypeLegacyManagedWorkspaceResourceGroup `
    -Message "Managed-group discovery must query the exact recorded group name"
Assert-True -Condition ($groupLastArguments -contains "--subscription") `
    -Message "Managed-group discovery must bind the target subscription"

Assert-Throws {
    Get-PrototypeLegacyManagedResourceGroup `
        -Subscription $targetSubscription `
        -ExpectedManagedBy $expectedManagedBy `
        -AzInvoker {
            param([string[]]$Arguments)
            [pscustomobject]@{
                ExitCode = 0
                Output = @(
                    (
                        [pscustomobject]@{
                            id = $expectedResourceGroupId
                            name = $PrototypeLegacyManagedWorkspaceResourceGroup
                            managedBy = "$expectedManagedBy-unrelated"
                        } | ConvertTo-Json -Compress
                    )
                )
            }
        }
} "A managed group with an unexpected manager must be rejected"

Assert-Throws {
    Get-PrototypeLegacyManagedResourceGroup `
        -Subscription $targetSubscription `
        -ExpectedManagedBy $expectedManagedBy `
        -AzInvoker {
            param([string[]]$Arguments)
            [pscustomobject]@{
                ExitCode = 0
                Output = @(
                    (
                        [pscustomobject]@{
                            id = $expectedResourceGroupId
                            name = $PrototypeLegacyManagedWorkspaceResourceGroup
                        } | ConvertTo-Json -Compress
                    )
                )
            }
        }
} "A managed group without a manager must be rejected"

# A code-only Azure CLI rendering cannot bind absence to the exact recorded
# resource and is therefore fatal rather than an empty result.
Assert-FailsClosed -ExitCode 3 `
    -Output "ERROR: (ResourceNotFound) The resource was not found." `
    -Message "A code-only ResourceNotFound response must fail closed"

$structuredMissing = Get-PrototypeLegacyManagedWorkspace `
    -Subscription $targetSubscription `
    -AzInvoker {
        param([string[]]$Arguments)
        [pscustomobject]@{
            ExitCode = 3
            Output = @(
                (
                    [pscustomobject]@{
                        status = 404
                        error = [pscustomobject]@{
                            code = "ResourceNotFound"
                            target = $expectedResourceId
                        }
                    } | ConvertTo-Json -Compress
                )
            )
        }
    }
Assert-True -Condition ($null -eq $structuredMissing) `
    -Message "A structured 404 for the exact resource should be treated as absence"

$structuredGroupMissing = Get-PrototypeLegacyManagedResourceGroup `
    -Subscription $targetSubscription `
    -ExpectedManagedBy $expectedManagedBy `
    -AzInvoker {
        param([string[]]$Arguments)
        [pscustomobject]@{
            ExitCode = 3
            Output = @(
                (
                    [pscustomobject]@{
                        status = 404
                        error = [pscustomobject]@{
                            code = "ResourceGroupNotFound"
                            target = "/subscriptions/$targetSubscription/resourceGroups/$PrototypeLegacyManagedWorkspaceResourceGroup"
                        }
                    } | ConvertTo-Json -Compress
                )
            )
        }
    }
Assert-True -Condition ($null -eq $structuredGroupMissing) `
    -Message "A structured 404 for the exact managed resource group should be treated as absence"

# Exercise the direct managed-resource-group helper, not only workspace
# discovery with a group anchor. Its explicit group profile accepts the exact
# group fields and rejects workspace-shaped fields.
$directGroupIdentityMissing = Get-PrototypeLegacyManagedResourceGroup `
    -Subscription $targetSubscription `
    -ExpectedManagedBy $expectedManagedBy `
    -AzInvoker {
        param([string[]]$Arguments)
        [pscustomobject]@{
            ExitCode = 3
            Output = @(
                (
                    [pscustomobject]@{
                        status = 404
                        name = $PrototypeLegacyManagedWorkspaceResourceGroup
                        provider = $PrototypeLegacyManagedResourceGroupType
                        type = $PrototypeLegacyManagedResourceGroupType
                        error = [pscustomobject]@{
                            code = "ResourceGroupNotFound"
                            target = $expectedResourceGroupId
                        }
                    } | ConvertTo-Json -Compress
                )
            )
        }
    }
Assert-True -Condition ($null -eq $directGroupIdentityMissing) `
    -Message "The direct managed-group helper must accept exact group name and type fields"

Assert-GroupFailsClosed -ExitCode 3 `
    -Output (
        [pscustomobject]@{
            status = 404
            name = $PrototypeLegacyManagedWorkspaceName
            provider = $PrototypeLegacyManagedWorkspaceType
            type = $PrototypeLegacyManagedWorkspaceType
            error = [pscustomobject]@{
                code = "ResourceGroupNotFound"
                target = $expectedResourceGroupId
            }
        } | ConvertTo-Json -Compress
    ) `
    -Message "The direct managed-group helper must reject workspace name and type fields"

Assert-GroupFailsClosed -ExitCode 3 `
    -Output (
        [pscustomobject]@{
            status = 404
            subscription = $targetSubscription
            resourceGroup = $PrototypeLegacyManagedWorkspaceResourceGroup
            name = $PrototypeLegacyManagedWorkspaceResourceGroup
            type = $PrototypeLegacyManagedResourceGroupType
            error = [pscustomobject]@{
                code = "ResourceGroupNotFound"
            }
        } | ConvertTo-Json -Compress
    ) `
    -Message "The direct managed-group helper must reject anchorless exact fields"

Assert-GroupFailsClosed -ExitCode 3 `
    -Output (
        [pscustomobject]@{
            status = 404
            name = $PrototypeLegacyManagedWorkspaceResourceGroup
            type = $PrototypeLegacyManagedResourceGroupType
            error = [pscustomobject]@{
                code = "ResourceGroupNotFound"
                target = $expectedResourceGroupId
            }
            context = [pscustomobject]@{
                provider = "Microsoft.Storage/storageAccounts"
            }
        } | ConvertTo-Json -Compress
    ) `
    -Message "The direct managed-group helper must reject conflicting provider fields"

Assert-GroupFailsClosed -ExitCode 3 `
    -Output (
        [pscustomobject]@{
            status = 500
            name = $PrototypeLegacyManagedWorkspaceResourceGroup
            type = $PrototypeLegacyManagedResourceGroupType
            error = [pscustomobject]@{
                code = "ResourceGroupNotFound"
                target = $expectedResourceGroupId
            }
        } | ConvertTo-Json -Compress
    ) `
    -Message "The direct managed-group helper must reject a non-404 response"

Assert-GroupFailsClosed -ExitCode 3 `
    -Output (
        [pscustomobject]@{
            status = 404
            name = $PrototypeLegacyManagedWorkspaceResourceGroup
            type = $PrototypeLegacyManagedResourceGroupType
            error = [pscustomobject]@{
                code = "ResourceGroupNotFound"
                target = $expectedResourceGroupId
            }
            details = [pscustomobject]@{
                code = "UnexpectedProviderError"
            }
        } | ConvertTo-Json -Compress
    ) `
    -Message "The direct managed-group helper must reject an unexpected code"

# Exact component fields cannot manufacture a managed-resource-group anchor.
# A structured group-not-found response must carry either the exact workspace
# resource ID or the exact managed-resource-group ID in id/resourceId/target.
Assert-GroupFailsClosed -ExitCode 3 `
    -Output (
        [pscustomobject]@{
            status = 404
            subscription = $targetSubscription
            resourceGroup = $PrototypeLegacyManagedWorkspaceResourceGroup
            name = $PrototypeLegacyManagedWorkspaceResourceGroup
            type = $PrototypeLegacyManagedResourceGroupType
            error = [pscustomobject]@{
                code = "ResourceGroupNotFound"
            }
        } | ConvertTo-Json -Compress
    ) `
    -Message "An anchorless exact-component group-not-found response must fail closed"

# The exact managed-resource-group anchor selects the group identity profile:
# its name and provider/type are valid evidence, not workspace conflicts.
$structuredGroupIdentityMissing = Get-PrototypeLegacyManagedResourceGroup `
    -Subscription $targetSubscription `
    -ExpectedManagedBy $expectedManagedBy `
    -AzInvoker {
        param([string[]]$Arguments)
        [pscustomobject]@{
            ExitCode = 3
            Output = @(
                (
                    [pscustomobject]@{
                        status = 404
                        name = $PrototypeLegacyManagedWorkspaceResourceGroup
                        provider = $PrototypeLegacyManagedResourceGroupType
                        type = $PrototypeLegacyManagedResourceGroupType
                        error = [pscustomobject]@{
                            code = "ResourceGroupNotFound"
                            target = "/subscriptions/$targetSubscription/resourceGroups/$PrototypeLegacyManagedWorkspaceResourceGroup"
                        }
                    } | ConvertTo-Json -Compress
                )
            )
        }
    }
Assert-True -Condition ($null -eq $structuredGroupIdentityMissing) `
    -Message "An exact managed resource group with its name and provider/type should be treated as absence"

# A present non-404 status or an additional unexpected code invalidates the
# not-found classification even when an exact workspace anchor is present.
Assert-FailsClosed -ExitCode 3 `
    -Output (
        [pscustomobject]@{
            status = 500
            error = [pscustomobject]@{
                code = "ResourceNotFound"
                target = $expectedResourceId
            }
        } | ConvertTo-Json -Compress
    ) `
    -Message "A non-404 status must fail closed"
Assert-FailsClosed -ExitCode 3 `
    -Output (
        [pscustomobject]@{
            status = 404
            error = [pscustomobject]@{
                code = "ResourceNotFound"
                target = $expectedResourceId
            }
            details = [pscustomobject]@{
                code = "UnexpectedProviderError"
            }
        } | ConvertTo-Json -Compress
    ) `
    -Message "An unexpected structured code must fail closed"

# Natural-language phrases are not evidence of resource absence. In
# particular, authorization, subscription, tenant, proxy, and context
# failures must remain fatal even when their text contains a phrase that
# looks like a not-found message.
Assert-FailsClosed -ExitCode 1 `
    -Output "AuthorizationFailed: The subscription does not exist in this account context." `
    -Message "Authorization failures containing 'does not exist' must fail closed"
Assert-FailsClosed -ExitCode 1 `
    -Output "AuthorizationFailed: The resource was not found while resolving the subscription." `
    -Message "Authorization failures containing 'was not found' must fail closed"
Assert-FailsClosed -ExitCode 1 `
    -Output "ProxyError: The resource could not be found in the selected tenant." `
    -Message "Context failures containing 'could not be found' must fail closed"
Assert-FailsClosed -ExitCode 1 `
    -Output '{"status":404,"error":{"code":"AuthorizationFailed","target":"subscription"}}' `
    -Message "A structured authorization failure must fail closed"

# A known not-found code is not sufficient by itself. Every structured
# response must identify the exact recorded workspace or managed resource
# group; wrong subscription, group, name, provider, resource ID, and target
# values are all fail-closed errors.
$notFoundIdentityMismatches = @(
    [pscustomobject]@{
        Description = "A not-found response with a wrong subscription"
        Response = [pscustomobject]@{
            status = 404
            error = [pscustomobject]@{
                code = "ResourceNotFound"
                target = $expectedResourceId -replace $targetSubscription, "11111111-1111-1111-1111-111111111111"
            }
        }
    },
    [pscustomobject]@{
        Description = "A not-found response with a wrong resource group"
        Response = [pscustomobject]@{
            status = 404
            error = [pscustomobject]@{
                code = "ResourceGroupNotFound"
                target = $expectedResourceId -replace $PrototypeLegacyManagedWorkspaceResourceGroup, "unrelated-resource-group"
            }
        }
    },
    [pscustomobject]@{
        Description = "A not-found response with a wrong name"
        Response = [pscustomobject]@{
            status = 404
            error = [pscustomobject]@{
                code = "ResourceNotFound"
                target = $expectedResourceId -replace $PrototypeLegacyManagedWorkspaceName, "unrelated-workspace"
            }
        }
    },
    [pscustomobject]@{
        Description = "A not-found response with a wrong provider"
        Response = [pscustomobject]@{
            status = 404
            error = [pscustomobject]@{
                code = "ResourceNotFound"
                target = $expectedResourceId -replace $PrototypeLegacyManagedWorkspaceType, "Microsoft.Storage/storageAccounts"
            }
        }
    },
    [pscustomobject]@{
        Description = "A not-found response with a wrong resource ID"
        Response = [pscustomobject]@{
            status = 404
            error = [pscustomobject]@{
                code = "ResourceNotFound"
                id = $expectedResourceId -replace $PrototypeLegacyManagedWorkspaceName, "another-workspace"
            }
        }
    },
    [pscustomobject]@{
        Description = "A not-found response with a wrong target"
        Response = [pscustomobject]@{
            status = 404
            error = [pscustomobject]@{
                code = "ResourceNotFound"
                target = "/subscriptions/other/resourceGroups/other/providers/Microsoft.OperationalInsights/workspaces/other"
            }
        }
    }
)
foreach ($mismatch in $notFoundIdentityMismatches) {
    Assert-FailsClosed -ExitCode 3 `
        -Output ($mismatch.Response | ConvertTo-Json -Compress) `
        -Message $mismatch.Description
}

# An exact nested not-found target cannot override a contradictory identity
# assertion on the enclosing response or a sibling object.
$envelopeIdentityConflicts = @(
    [pscustomobject]@{
        Description = "A nested target with a wrong enclosing subscription"
        Response = [pscustomobject]@{
            status = 404
            subscription = "11111111-1111-1111-1111-111111111111"
            error = [pscustomobject]@{
                code = "ResourceNotFound"
                target = $expectedResourceId
            }
        }
    },
    [pscustomobject]@{
        Description = "A nested target with a wrong sibling resource group"
        Response = [pscustomobject]@{
            status = 404
            error = [pscustomobject]@{
                code = "ResourceNotFound"
                target = $expectedResourceId
            }
            context = [pscustomobject]@{
                resourceGroup = "unrelated-resource-group"
            }
        }
    },
    [pscustomobject]@{
        Description = "A nested target with a wrong enclosing name"
        Response = [pscustomobject]@{
            status = 404
            name = "unrelated-workspace"
            error = [pscustomobject]@{
                code = "ResourceNotFound"
                target = $expectedResourceId
            }
        }
    },
    [pscustomobject]@{
        Description = "A nested target with a wrong sibling provider"
        Response = [pscustomobject]@{
            status = 404
            error = [pscustomobject]@{
                code = "ResourceNotFound"
                target = $expectedResourceId
            }
            context = [pscustomobject]@{
                provider = "Microsoft.Storage/storageAccounts"
            }
        }
    },
    [pscustomobject]@{
        Description = "A nested target with a wrong enclosing resource ID"
        Response = [pscustomobject]@{
            status = 404
            resourceId = $expectedResourceId -replace $PrototypeLegacyManagedWorkspaceName, "another-workspace"
            error = [pscustomobject]@{
                code = "ResourceNotFound"
                target = $expectedResourceId
            }
        }
    },
    [pscustomobject]@{
        Description = "A nested target with a wrong sibling target"
        Response = [pscustomobject]@{
            status = 404
            error = [pscustomobject]@{
                code = "ResourceNotFound"
                target = $expectedResourceId
            }
            context = [pscustomobject]@{
                target = "/subscriptions/other/resourceGroups/other/providers/Microsoft.OperationalInsights/workspaces/other"
            }
        }
    }
)
foreach ($conflict in $envelopeIdentityConflicts) {
    Assert-FailsClosed -ExitCode 3 `
        -Output ($conflict.Response | ConvertTo-Json -Compress) `
        -Message $conflict.Description
}

# The same envelope-wide conflict policy applies when the exact
# managed-resource-group ID selects the group identity profile. The nested
# group target must not override a contradictory parent or sibling assertion.
$groupEnvelopeIdentityConflicts = @(
    [pscustomobject]@{
        Description = "A group target with a wrong enclosing subscription"
        Response = [pscustomobject]@{
            status = 404
            subscription = "11111111-1111-1111-1111-111111111111"
            error = [pscustomobject]@{
                code = "ResourceGroupNotFound"
                target = $expectedResourceGroupId
            }
        }
    },
    [pscustomobject]@{
        Description = "A group target with a wrong sibling resource group"
        Response = [pscustomobject]@{
            status = 404
            error = [pscustomobject]@{
                code = "ResourceGroupNotFound"
                target = $expectedResourceGroupId
            }
            context = [pscustomobject]@{
                resourceGroup = "unrelated-resource-group"
            }
        }
    },
    [pscustomobject]@{
        Description = "A group target with a wrong enclosing name"
        Response = [pscustomobject]@{
            status = 404
            name = "unrelated-resource-group"
            error = [pscustomobject]@{
                code = "ResourceGroupNotFound"
                target = $expectedResourceGroupId
            }
        }
    },
    [pscustomobject]@{
        Description = "A group target with a wrong sibling provider"
        Response = [pscustomobject]@{
            status = 404
            error = [pscustomobject]@{
                code = "ResourceGroupNotFound"
                target = $expectedResourceGroupId
            }
            context = [pscustomobject]@{
                provider = "Microsoft.Storage/storageAccounts"
            }
        }
    },
    [pscustomobject]@{
        Description = "A group target with a wrong enclosing resource ID"
        Response = [pscustomobject]@{
            status = 404
            resourceId = $expectedResourceId
            error = [pscustomobject]@{
                code = "ResourceGroupNotFound"
                target = $expectedResourceGroupId
            }
        }
    },
    [pscustomobject]@{
        Description = "A group target with a wrong sibling target"
        Response = [pscustomobject]@{
            status = 404
            error = [pscustomobject]@{
                code = "ResourceGroupNotFound"
                target = $expectedResourceGroupId
            }
            context = [pscustomobject]@{
                target = "/subscriptions/other/resourceGroups/other"
            }
        }
    }
)
foreach ($conflict in $groupEnvelopeIdentityConflicts) {
    Assert-GroupFailsClosed -ExitCode 3 `
        -Output ($conflict.Response | ConvertTo-Json -Compress) `
        -Message $conflict.Description
}

# Even if Azure returned an object, every identity component is checked. The
# helper never issues a delete operation, so unrelated workspaces cannot be
# silently deleted.
$identityMismatches = @(
    [pscustomobject]@{
        Description = "A wrong subscription"
        Identity = [pscustomobject]@{
            id = $expectedResourceId -replace $targetSubscription, "11111111-1111-1111-1111-111111111111"
            name = $PrototypeLegacyManagedWorkspaceName
            resourceGroup = $PrototypeLegacyManagedWorkspaceResourceGroup
            type = $PrototypeLegacyManagedWorkspaceType
        }
    },
    [pscustomobject]@{
        Description = "A wrong resource group"
        Identity = [pscustomobject]@{
            id = $expectedResourceId -replace $PrototypeLegacyManagedWorkspaceResourceGroup, "unrelated-resource-group"
            name = $PrototypeLegacyManagedWorkspaceName
            resourceGroup = "unrelated-resource-group"
            type = $PrototypeLegacyManagedWorkspaceType
        }
    },
    [pscustomobject]@{
        Description = "A wrong name"
        Identity = [pscustomobject]@{
            id = $expectedResourceId -replace $PrototypeLegacyManagedWorkspaceName, "unrelated-workspace"
            name = "unrelated-workspace"
            resourceGroup = $PrototypeLegacyManagedWorkspaceResourceGroup
            type = $PrototypeLegacyManagedWorkspaceType
        }
    },
    [pscustomobject]@{
        Description = "A wrong provider type"
        Identity = [pscustomobject]@{
            id = $expectedResourceId -replace $PrototypeLegacyManagedWorkspaceType, "Microsoft.Storage/storageAccounts"
            name = $PrototypeLegacyManagedWorkspaceName
            resourceGroup = $PrototypeLegacyManagedWorkspaceResourceGroup
            type = "Microsoft.Storage/storageAccounts"
        }
    },
    [pscustomobject]@{
        Description = "A wrong resource ID"
        Identity = [pscustomobject]@{
            id = $expectedResourceId -replace $PrototypeLegacyManagedWorkspaceName, "another-workspace"
            name = $PrototypeLegacyManagedWorkspaceName
            resourceGroup = $PrototypeLegacyManagedWorkspaceResourceGroup
            type = $PrototypeLegacyManagedWorkspaceType
        }
    }
)
foreach ($mismatch in $identityMismatches) {
    Assert-RejectsIdentity -Identity $mismatch.Identity -Description $mismatch.Description
}

# Cleanup is deliberately narrow: it may target only the exact recorded
# workspace or its exact recorded managed resource group. A service-owned deny
# assignment must be surfaced to the caller rather than bypassed or broadened.
$workspaceDeleteArguments = @()
$deletedWorkspaceId = Remove-PrototypeLegacyManagedResource `
    -Subscription $targetSubscription `
    -ResourceKind workspace `
    -AzInvoker {
        param([string[]]$Arguments)
        $script:workspaceDeleteArguments = @($Arguments)
        [pscustomobject]@{
            ExitCode = 0
            Output = @()
        }
    }
Assert-Equal -Actual $deletedWorkspaceId -Expected $expectedResourceId `
    -Message "Workspace cleanup must return the exact recorded workspace ID"
Assert-True -Condition (
    ($workspaceDeleteArguments -join "|") -eq (
        @(
            "resource", "delete", "--ids", $expectedResourceId,
            "--subscription", $targetSubscription, "--only-show-errors"
        ) -join "|"
    )
) -Message "Workspace cleanup must issue only the exact target resource delete"

$groupDeleteArguments = @()
$deletedGroupId = Remove-PrototypeLegacyManagedResource `
    -Subscription $targetSubscription `
    -ResourceKind resourceGroup `
    -AzInvoker {
        param([string[]]$Arguments)
        $script:groupDeleteArguments = @($Arguments)
        [pscustomobject]@{
            ExitCode = 0
            Output = @()
        }
    }
Assert-Equal -Actual $deletedGroupId -Expected $expectedResourceGroupId `
    -Message "Group cleanup must return the exact recorded managed group ID"
Assert-True -Condition (
    ($groupDeleteArguments -join "|") -eq (
        @(
            "group", "delete", "--name", $PrototypeLegacyManagedWorkspaceResourceGroup,
            "--yes", "--subscription", $targetSubscription, "--only-show-errors"
        ) -join "|"
    )
) -Message "Group cleanup must issue only the exact target resource-group delete"

Assert-Throws {
    Remove-PrototypeLegacyManagedResource `
        -Subscription $targetSubscription `
        -ResourceKind workspace `
        -AzInvoker {
            param([string[]]$Arguments)
            [pscustomobject]@{
                ExitCode = 403
                Output = @(
                    "DenyAssignmentAuthorizationFailed: deletion is controlled by Application Insights."
                )
            }
        }
} "A deny-assigned legacy workspace must fail closed with Azure evidence"

Assert-Equal -Actual $deleteCalls -Expected 0 `
    -Message "Workspace discovery must never issue a deletion operation"

Write-Host "Managed workspace regressions passed: exact discovery, narrow not-found classification, identity rejection, exact cleanup scoping, deny fail-closed behavior, and no discovery deletion."
