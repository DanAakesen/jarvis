targetScope = 'resourceGroup'

@description('The resource ID of the backend user-assigned managed identity created by bootstrap.')
param backendIdentityResourceId string

@description('The object ID of the jarvis-sql-admins Entra group created by bootstrap.')
param sqlAdminGroupObjectId string

@description('The display name of the SQL administrator group.')
param sqlAdminGroupName string = 'jarvis-sql-admins'

@description('The container image to run in the backend app. Empty skips the backend app; the deploy workflow uses this only before the registry holds the first backend image.')
param backendImage string = ''

@description('The Entra object ID of the hosted Jarvis agent. Empty keeps agent access disabled.')
param jarvisAgentObjectId string = ''

@description('The non-secret GitHub App ID used by the backend to mint installation tokens.')
param githubAppId string = ''

@description('The public client ID reserved for Dan’s local PC bridge. Empty disables bridge sign-in.')
param pcBridgeClientId string = ''
@description('Dan’s IANA time zone used for Google Calendar day boundaries. Empty disables Google mail and calendar tools.')
param jarvisGoogleTimeZone string = ''

@description('A ChatGPT-supported model for Codex hosted-runner tools.')
param codexToolModel string = 'gpt-5.5'


@description('The subscription currency amount for the monthly resource group budget (300 DKK).')
param monthlyBudgetAmount int = 300

@description('Start of the budget period. Fixed, because Azure rejects changing the start date of an existing budget.')
param budgetStartDate string = '2026-10-01T00:00:00Z'

@description('Email addresses for Azure Monitor alerts and budget thresholds. Include Dan’s address; no phone actions are configured.')
param budgetContactEmails array

@description('14-digit UTC timestamp (yyyyMMddHHmmss); keep it unchanged for redeployments and choose a new value if the Foundry account is deleted.')
@minLength(14)
@maxLength(14)
param foundryNameTimestamp string

var suffix = uniqueString(resourceGroup().id)
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var blobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var blobUserDelegatorRoleId = 'db58b8e5-c6ad-4a2a-8342-4190687cbf4a'
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
var monitoringMetricsPublisherRoleId = '3913510d-42f4-4e42-8a64-420c390055eb'
var costManagementReaderRoleId = '72fafb9e-0641-4937-9268-a91bfd8191a3'
// Custom role created by infra/bootstrap.ps1: the deploy identity cannot create role definitions (L54).
var backendAppScaleRoleId = '985158cb-2c3c-5b9b-bd65-897ed9be3e36'
var foundryUserRoleId = '53ca6127-db72-4b80-b1b0-d745d6d5456d'
var cognitiveServicesUserRoleId = 'a97b65f3-24c7-4388-baec-2e87135dc908'
var cognitiveServicesContributorRoleId = '25fbc0a9-bd7c-42a3-aa1a-3b75d497ee68'
var foundryDeploymentReaderRoleId = 'acdd72a7-3385-48ef-bd42-f606fba81ae7'
var foundryAccountName = 'jarvis-${foundryNameTimestamp}-${suffix}'
var backendAppName = 'ca-jarvis-backend-${suffix}'
var deployBackendApp = !empty(backendImage)

resource backendIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: last(split(backendIdentityResourceId, '/'))
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'law-jarvis-${suffix}'
  location: resourceGroup().location
  tags: {
    project: 'jarvis'
  }
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-jarvis-${suffix}'
  location: resourceGroup().location
  kind: 'web'
  tags: {
    project: 'jarvis'
  }
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource alertActionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'jarvis-alerts'
  location: 'global'
  tags: {
    project: 'jarvis'
  }
  properties: {
    groupShortName: 'Jarvis'
    enabled: true
    emailReceivers: [for (emailAddress, index) in budgetContactEmails: {
      name: 'Recipient ${index + 1}'
      emailAddress: emailAddress
      useCommonAlertSchema: true
    }]
  }
}

var appAlertTypes = [
  'deployment_failure'
  'sandbox_crash'
  'credential_expiry'
]

resource appAlertRules 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = [for alertType in appAlertTypes: {
  name: 'jarvis-${alertType}'
  location: resourceGroup().location
  tags: {
    project: 'jarvis'
  }
  kind: 'LogAlert'
  properties: {
    displayName: 'Jarvis ${replace(alertType, '_', ' ')}'
    description: 'One stateful notification for each distinct Jarvis alert condition.'
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT10M'
    severity: 2
    autoMitigate: true
    scopes: [
      logAnalytics.id
    ]
    criteria: {
      allOf: [
        {
          query: '''
            AppTraces
            | where TimeGenerated >= ago(10m)
            | where Message == "jarvis.alert"
            | extend alertType = tostring(Properties.alertType), alertKey = tostring(Properties.alertKey)
            | where alertType == "${alertType}"
            | summarize alertCount = count() by alertKey
          '''
          timeAggregation: 'Total'
          metricMeasureColumn: 'alertCount'
          operator: 'GreaterThan'
          threshold: 0
          dimensions: [
            {
              name: 'alertKey'
              operator: 'Include'
              values: [
                '*'
              ]
            }
          ]
        }
      ]
    }
    actions: {
      actionGroups: [
        alertActionGroup.id
      ]
    }
  }
}]

resource budgetReaderAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, backendIdentity.id, costManagementReaderRoleId)
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', costManagementReaderRoleId)
    principalId: backendIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-jarvis-${suffix}'
  location: resourceGroup().location
  tags: {
    project: 'jarvis'
  }
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: false
    publicNetworkAccess: 'Enabled'
    accessPolicies: []
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'stjarvis${suffix}'
  location: resourceGroup().location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  tags: {
    project: 'jarvis'
  }
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
      ipRules: []
      virtualNetworkRules: []
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource artifactsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'artifacts'
  properties: {
    publicAccess: 'None'
  }
}

resource logsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'logs'
  properties: {
    publicAccess: 'None'
  }
}

resource taskEventsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'task-events'
  properties: {
    publicAccess: 'None'
  }
}

resource blobDataAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, backendIdentity.id, blobDataContributorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContributorRoleId)
    principalId: backendIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource blobUserDelegatorAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, backendIdentity.id, blobUserDelegatorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobUserDelegatorRoleId)
    principalId: backendIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'crjarvis${suffix}'
  location: resourceGroup().location
  sku: {
    name: 'Basic'
  }
  tags: {
    project: 'jarvis'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource acrPullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, backendIdentity.id, acrPullRoleId)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: backendIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource foundryAccount 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: foundryAccountName
  location: resourceGroup().location
  identity: {
    type: 'SystemAssigned'
  }
  sku: {
    name: 'S0'
  }
  kind: 'AIServices'
  tags: {
    project: 'jarvis'
  }
  properties: {
    customSubDomainName: foundryAccountName
    publicNetworkAccess: 'Enabled'
    allowProjectManagement: true
    disableLocalAuth: true
  }
}

resource backendFoundrySpeechUserAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundryAccount.id, backendIdentity.id, cognitiveServicesUserRoleId)
  scope: foundryAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesUserRoleId)
    principalId: backendIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource backendFoundryDeploymentReaderAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundryAccount.id, backendIdentity.id, foundryDeploymentReaderRoleId)
  scope: foundryAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', foundryDeploymentReaderRoleId)
    principalId: backendIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource backendFoundryDeploymentContributorAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundryAccount.id, backendIdentity.id, cognitiveServicesContributorRoleId)
  scope: foundryAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesContributorRoleId)
    principalId: backendIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource foundryProject 'Microsoft.CognitiveServices/accounts/projects@2025-04-01-preview' = {
  parent: foundryAccount
  name: 'jarvis-${foundryNameTimestamp}'
  location: resourceGroup().location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    displayName: 'Jarvis'
    description: 'Jarvis production project'
  }
}

resource backendFoundryUserAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundryProject.id, backendIdentity.id, foundryUserRoleId)
  scope: foundryProject
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', foundryUserRoleId)
    principalId: backendIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Foundry allows one operation at a time per account: create the project first,
// then each model deployment in turn (the first deploy failed with RequestConflict).
resource gpt56LunaDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: foundryAccount
  name: 'gpt-5.6-luna'
  dependsOn: [
    foundryProject
  ]
  sku: {
    name: 'GlobalStandard'
    // Global Standard bills per token; capacity is only the rate limit (1 = 1K TPM, too low for one chat turn with tools, L91).
    capacity: 100
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-5.6-luna'
      version: '2026-07-09'
    }
  }
}

resource gptRealtime21Deployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: foundryAccount
  name: 'gpt-realtime-2.1'
  dependsOn: [
    gpt56LunaDeployment
  ]
  sku: {
    name: 'GlobalStandard'
    // Regional quota maximum for gpt-realtime-2.1 Global Standard (L91).
    capacity: 10
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-realtime-2.1'
      version: '2026-07-07'
    }
  }
}

resource gptRealtime21MiniDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: foundryAccount
  name: 'gpt-realtime-2.1-mini'
  dependsOn: [
    gptRealtime21Deployment
  ]
  sku: {
    name: 'GlobalStandard'
    capacity: 10
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-realtime-2.1-mini'
      version: '2026-07-07'
    }
  }
}

resource memoryEmbeddingDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: foundryAccount
  name: 'text-embedding-3-small'
  dependsOn: [
    gptRealtime21MiniDeployment
  ]
  sku: {
    name: 'GlobalStandard'
    // Memory capture, search and vault backfills embed in bursts (L91, L119); billing is per token.
    capacity: 150
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'text-embedding-3-small'
      version: '1'
    }
  }
}

resource memoryEmbeddingLargeDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: foundryAccount
  name: 'text-embedding-3-large'
  dependsOn: [
    memoryEmbeddingDeployment
  ]
  sku: {
    name: 'GlobalStandard'
    capacity: 150
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'text-embedding-3-large'
      version: '1'
    }
  }
}

// Continuous screen and camera vision (Dan's choice, 6 October): cheapest capable vision model.
resource gpt6LunaVisionDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: foundryAccount
  name: 'gpt-6-luna'
  dependsOn: [
    memoryEmbeddingLargeDeployment
  ]
  sku: {
    name: 'GlobalStandard'
    capacity: 50
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-6-luna'
      version: '2026-09-22'
    }
  }
}

// Dan's choice, 10 October: stronger models for research, Danish voice chat and Codex. Deployed one at a
// time like the others (Foundry allows one operation per account); capacity matches gpt-6-luna.
resource gpt6AstraDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: foundryAccount
  name: 'gpt-6-astra'
  dependsOn: [
    gpt6LunaVisionDeployment
  ]
  sku: {
    name: 'GlobalStandard'
    capacity: 50
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-6-astra'
      version: '2026-09-03'
    }
  }
}

resource gpt61SolDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: foundryAccount
  name: 'gpt-6.1-sol'
  dependsOn: [
    gpt6AstraDeployment
  ]
  sku: {
    name: 'GlobalStandard'
    capacity: 50
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-6.1-sol'
      version: '2026-09-29'
    }
  }
}

resource foundryAcrPullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, foundryProject.id, acrPullRoleId)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: foundryProject.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource foundryAppInsightsAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(appInsights.id, foundryProject.id, monitoringMetricsPublisherRoleId)
  scope: appInsights
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', monitoringMetricsPublisherRoleId)
    principalId: foundryProject.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource foundryAcrConnection 'Microsoft.CognitiveServices/accounts/projects/connections@2025-04-01-preview' = {
  parent: foundryProject
  name: 'container-registry'
  properties: {
    category: 'ContainerRegistry'
    target: registry.properties.loginServer
    authType: 'None'
    metadata: {
      ResourceId: registry.id
    }
  }
}

resource foundryAppInsightsConnection 'Microsoft.CognitiveServices/accounts/projects/connections@2025-04-01-preview' = {
  parent: foundryProject
  name: 'application-insights'
  properties: {
    category: 'AppInsights'
    target: appInsights.id
    authType: any('ProjectManagedIdentity')
    metadata: {
      ResourceId: appInsights.id
      ApplicationInsightsConnectionString: appInsights.properties.ConnectionString
    }
  }
}

resource keyVaultSecretsAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, backendIdentity.id, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: backendIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource sqlServer 'Microsoft.Sql/servers@2021-11-01' = {
  name: 'sql-jarvis-${suffix}'
  location: resourceGroup().location
  tags: {
    project: 'jarvis'
  }
  properties: {
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    // A new server needs an administrator at creation; without a SQL login that must be
    // the Entra admin with Entra-only authentication (first deploy: InvalidParameterValue Login).
    administrators: {
      administratorType: 'ActiveDirectory'
      azureADOnlyAuthentication: true
      login: sqlAdminGroupName
      principalType: 'Group'
      sid: sqlAdminGroupObjectId
      tenantId: subscription().tenantId
    }
  }
}

resource sqlAdministrator 'Microsoft.Sql/servers/administrators@2021-11-01' = {
  parent: sqlServer
  name: 'ActiveDirectory'
  properties: {
    administratorType: 'ActiveDirectory'
    login: sqlAdminGroupName
    sid: sqlAdminGroupObjectId
    tenantId: subscription().tenantId
  }
}

resource sqlEntraOnlyAuthentication 'Microsoft.Sql/servers/azureADOnlyAuthentications@2021-11-01' = {
  parent: sqlServer
  name: 'Default'
  properties: {
    azureADOnlyAuthentication: true
  }
  dependsOn: [
    sqlAdministrator
  ]
}

resource sqlAzureServicesFirewall 'Microsoft.Sql/servers/firewallRules@2021-11-01' = {
  parent: sqlServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2025-01-01' = {
  parent: sqlServer
  name: 'jarvis'
  location: resourceGroup().location
  sku: {
    name: 'GP_S_Gen5_1'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 1
  }
  tags: {
    project: 'jarvis'
  }
  properties: {
    maxSizeBytes: 34359738368
    autoPauseDelay: 60
    minCapacity: json('0.5')
    useFreeLimit: true
    // Keep running past the free monthly allowance (Dan approved, 6 October; L104). Azure
    // cannot switch back to AutoPause once BillOverUsage is set.
    freeLimitExhaustionBehavior: 'BillOverUsage'
  }
}

resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-jarvis-${suffix}'
  location: resourceGroup().location
  tags: {
    project: 'jarvis'
  }
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource backendApp 'Microsoft.App/containerApps@2024-03-01' = if (deployBackendApp) {
  name: backendAppName
  location: resourceGroup().location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${backendIdentity.id}': {}
    }
  }
  tags: {
    project: 'jarvis'
  }
  properties: {
    managedEnvironmentId: containerAppsEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: registry.properties.loginServer
          identity: backendIdentity.id
        }
      ]
    }
    template: {
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
      containers: [
        {
          name: 'backend'
          image: backendImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: concat([
            {
              name: 'STATIC_WEB_APP_ORIGIN'
              value: 'https://${staticWebApp.properties.defaultHostname}'
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              value: appInsights.properties.ConnectionString
            }
            {
              name: 'FOUNDRY_ADMIN_ENDPOINT'
              value: 'https://${foundryAccount.name}.services.ai.azure.com/api/projects/${foundryProject.name}'
            }
            {
              name: 'FOUNDRY_RUNTIME_ENDPOINT'
              value: 'https://${foundryAccount.name}.cognitiveservices.azure.com/api/projects/${foundryProject.name}'
            }
            {
              name: 'FOUNDRY_ACCOUNT_RESOURCE_ID'
              value: foundryAccount.id
            }
            {
              name: 'SQL_SERVER'
              value: sqlServer.properties.fullyQualifiedDomainName
            }
            {
              name: 'SQL_DATABASE'
              value: sqlDatabase.name
            }
            {
              name: 'TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT'
              value: storage.name
            }
            {
              name: 'KEY_VAULT_URI'
              value: keyVault.properties.vaultUri
            }
            {
              name: 'SQL_MANAGED_IDENTITY_CLIENT_ID'
              value: backendIdentity.properties.clientId
            }
            {
              name: 'KEY_VAULT_URI'
              value: keyVault.properties.vaultUri
            }
            {
              name: 'FOUNDRY_PROJECT_ENDPOINT'
              value: 'https://${foundryAccount.name}.services.ai.azure.com/api/projects/${foundryProject.name}'
            }
            {
              name: 'JARVIS_CHAT_AGENT_NAME'
              value: 'jarvis'
            }
            {
              name: 'JARVIS_MEMORY_EMBEDDING_DEPLOYMENT_NAME'
              value: memoryEmbeddingDeployment.name
            }
            {
              name: 'BACKEND_CONTAINER_APP_RESOURCE_ID'
              value: resourceId('Microsoft.App/containerApps', 'ca-jarvis-backend-${suffix}')
            }
            {
              name: 'JARVIS_MONTHLY_BUDGET_RESOURCE_ID'
              value: monthlyBudget.id
            }
            {
              name: 'FOUNDRY_RUNNER_AGENT_NAME'
              value: 'jarvis-runner-base-1x2'
            }
            {
              name: 'JARVIS_CODEX_TOOL_MODEL'
              value: codexToolModel
            }
            {
              // English voice route; without it /voice is never registered (L102).
              name: 'VOICE_LIVE_ENDPOINT'
              value: 'wss://${foundryAccount.name}.services.ai.azure.com/voice-live/realtime?api-version=2026-07-15'
            }
          ], empty(jarvisAgentObjectId) ? [] : [
            {
              name: 'ENTRA_JARVIS_AGENT_OBJECT_ID'
              value: jarvisAgentObjectId
            }
          ], empty(githubAppId) ? [] : [
            {
              name: 'GITHUB_APP_ID'
              value: githubAppId
            }
          ], empty(pcBridgeClientId) ? [] : [
            {
              name: 'ENTRA_PC_BRIDGE_CLIENT_ID'
              value: pcBridgeClientId
            }
          ], empty(jarvisGoogleTimeZone) ? [] : [
            {
              name: 'JARVIS_GOOGLE_TIME_ZONE'
              value: jarvisGoogleTimeZone
            }
          ])
          // Startup applies migrations before listening and may wait for the serverless database to resume (300-second deadline).
          probes: [
            {
              type: 'Startup'
              httpGet: {
                path: '/health'
                port: 3000
              }
              initialDelaySeconds: 10
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 10
            }
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
      ]
    }
  }
  dependsOn: [
    acrPullAssignment
    blobDataAssignment
    blobUserDelegatorAssignment
    taskEventsContainer
    backendFoundrySpeechUserAssignment
    backendFoundryDeploymentReaderAssignment
    backendFoundryDeploymentContributorAssignment
  ]
}

resource backendAppScaleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployBackendApp) {
  name: guid(backendApp.id, backendIdentity.id, backendAppScaleRoleId)
  scope: backendApp
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', backendAppScaleRoleId)
    principalId: backendIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource staticWebApp 'Microsoft.Web/staticSites@2022-09-01' = {
  name: 'swa-jarvis-${suffix}'
  location: 'westeurope'
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  tags: {
    project: 'jarvis'
  }
  properties: {}
}

resource monthlyBudget 'Microsoft.Consumption/budgets@2019-10-01' = {
  name: 'jarvis-monthly'
  scope: resourceGroup()
  properties: {
    amount: monthlyBudgetAmount
    category: 'Cost'
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
    }
    notifications: {
      Actual_GreaterThan_80_Percent: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: []
        contactGroups: [
          alertActionGroup.id
        ]
        contactRoles: []
      }
      Actual_GreaterThan_100_Percent: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: []
        contactGroups: [
          alertActionGroup.id
        ]
        contactRoles: []
      }
    }
  }
}

output backendAppName string = deployBackendApp ? backendApp.name : ''
output backendFqdn string = deployBackendApp ? backendApp!.properties.configuration.ingress.fqdn : ''
output applicationInsightsConnectionString string = appInsights.properties.ConnectionString
output containerRegistryName string = registry.name
output containerRegistryLoginServer string = registry.properties.loginServer
output foundryAccountName string = foundryAccount.name
output foundryProjectName string = foundryProject.name
output foundryAdminEndpoint string = 'https://${foundryAccount.name}.services.ai.azure.com/api/projects/${foundryProject.name}'
output foundryRuntimeEndpoint string = 'https://${foundryAccount.name}.cognitiveservices.azure.com/api/projects/${foundryProject.name}'
output sqlServerName string = sqlServer.name
output databaseName string = sqlDatabase.name
output storageAccountName string = storage.name
output keyVaultName string = keyVault.name
output staticWebAppName string = staticWebApp.name
output staticWebAppHostname string = staticWebApp.properties.defaultHostname
