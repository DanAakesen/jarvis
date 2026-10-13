// UNREFERENCED PROPOSAL ONLY. No execution, grants, activation or cost approval.
// Keep outside infra/: the existing planner treats that tree as real redeployment.
targetScope = 'resourceGroup'

@minLength(3)
@maxLength(8)
param namePrefix string
param location string = resourceGroup().location
param existingEnvironmentName string
param existingRegistryName string
param image string
@minLength(36)
@maxLength(36)
param ownerObjectId string
param deployHost bool = false
param uploadEnabled bool = false
param recoveryEnabled bool = false
@allowed([0, 1])
param minimumReplicas int = 0

var tags = { project: 'jarvis', purpose: 'daily-health-ingestion-proposal' }
var rawName = 'health-raw'
var devicesName = 'health-devices'
var queueName = 'health-pointers'

// Reuse the established Jarvis environment and registry; no duplicate platform/log sink.
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = { name: existingEnvironmentName }
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = { name: existingRegistryName }
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-daily-health-${namePrefix}'
  location: location
  tags: tags
}
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'st${namePrefix}${uniqueString(resourceGroup().id, namePrefix)}'
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  tags: tags
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    allowCrossTenantReplication: false
    publicNetworkAccess: 'Enabled'
    // Authenticated public service endpoints are proposed, not private-link verification.
    networkAcls: { bypass: 'None', defaultAction: 'Allow', ipRules: [], virtualNetworkRules: [] }
  }
}
resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = { parent: storage, name: 'default' }
resource raw 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: rawName
  properties: { publicAccess: 'None' }
}
resource devices 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: devicesName
  properties: { publicAccess: 'None' }
}
resource queues 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = { parent: storage, name: 'default' }
resource pointers 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = { parent: queues, name: queueName }

// Proposed custom data-plane roles deliberately exclude deletion, queue consumption,
// account keys, user delegation keys, capability writes and SQL/agent access.
// Operator must verify provider permission semantics before approving/executing grants.
resource rawRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(resourceGroup().id, namePrefix, 'health-raw-writer')
  properties: {
    roleName: 'Daily health raw writer ${namePrefix}'
    description: 'Proposed private raw/outbox read/write/lease; no delete.'
    type: 'CustomRole'
    assignableScopes: [resourceGroup().id]
    permissions: [{
      actions: ['Microsoft.Storage/storageAccounts/blobServices/containers/read']
      notActions: []
      dataActions: [
        'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read'
        'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/write'
      ]
      notDataActions: []
    }]
  }
}
resource devicesRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(resourceGroup().id, namePrefix, 'health-capability-reader')
  properties: {
    roleName: 'Daily health capability reader ${namePrefix}'
    description: 'Proposed private capability read only; no issuance/revocation writes.'
    type: 'CustomRole'
    assignableScopes: [resourceGroup().id]
    permissions: [{ actions: ['Microsoft.Storage/storageAccounts/blobServices/containers/read'], notActions: [], dataActions: ['Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read'], notDataActions: [] }]
  }
}
resource pointersRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(resourceGroup().id, namePrefix, 'health-pointer-sender')
  properties: {
    roleName: 'Daily health pointer sender ${namePrefix}'
    description: 'Proposed pointer messages add only; no consume/delete.'
    type: 'CustomRole'
    assignableScopes: [resourceGroup().id]
    permissions: [{ actions: [], notActions: [], dataActions: ['Microsoft.Storage/storageAccounts/queueServices/queues/messages/add/action'], notDataActions: [] }]
  }
}
resource rawGrant 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(raw.id, identity.id, rawRole.id)
  scope: raw
  properties: { roleDefinitionId: rawRole.id, principalId: identity.properties.principalId, principalType: 'ServicePrincipal' }
}
resource devicesGrant 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(devices.id, identity.id, devicesRole.id)
  scope: devices
  properties: { roleDefinitionId: devicesRole.id, principalId: identity.properties.principalId, principalType: 'ServicePrincipal' }
}
resource pointersGrant 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(pointers.id, identity.id, pointersRole.id)
  scope: pointers
  properties: { roleDefinitionId: pointersRole.id, principalId: identity.properties.principalId, principalType: 'ServicePrincipal' }
}
resource imagePullGrant 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.id, 'health-image-pull')
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource host 'Microsoft.App/containerApps@2024-03-01' = if (deployHost) {
  name: 'ca-daily-health-${namePrefix}'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 3001, transport: 'http', allowInsecure: false }
      registries: [{ server: registry.properties.loginServer, identity: identity.id }]
    }
    template: {
      scale: { minReplicas: minimumReplicas, maxReplicas: 1 }
      containers: [{
        name: 'health-upload'
        image: image
        command: ['node', 'apps/backend/dist/daily/health-upload/main.js']
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [
          { name: 'DAILY_HEALTH_UPLOAD_ENABLED', value: string(uploadEnabled) }
          { name: 'DAILY_HEALTH_RECOVERY_ENABLED', value: string(recoveryEnabled) }
          { name: 'DAILY_HEALTH_MODE', value: 'serve' }
          { name: 'DAILY_HEALTH_PORT', value: '3001' }
          { name: 'DAILY_HEALTH_OWNER_OBJECT_ID', value: ownerObjectId }
          { name: 'DAILY_HEALTH_MANAGED_IDENTITY_CLIENT_ID', value: identity.properties.clientId }
          { name: 'DAILY_HEALTH_BLOB_URL', value: storage.properties.primaryEndpoints.blob }
          { name: 'DAILY_HEALTH_QUEUE_URL', value: storage.properties.primaryEndpoints.queue }
          { name: 'DAILY_HEALTH_RAW_CONTAINER', value: rawName }
          { name: 'DAILY_HEALTH_DEVICE_CONTAINER', value: devicesName }
          { name: 'DAILY_HEALTH_QUEUE_NAME', value: queueName }
          { name: 'DAILY_HEALTH_SHUTDOWN_MS', value: '25000' }
          { name: 'DAILY_HEALTH_RATE_PER_CLIENT', value: '60' }
          { name: 'DAILY_HEALTH_RATE_PER_INSTANCE', value: '120' }
          { name: 'DAILY_HEALTH_RATE_WINDOW_MS', value: '60000' }
          // Socket identity by default; no unverified ACA forwarded-header trust.
          { name: 'DAILY_HEALTH_TRUSTED_PROXY_CIDRS', value: '' }
        ]
        probes: [{ type: 'Liveness', httpGet: { path: '/health', port: 3001 }, initialDelaySeconds: 5, periodSeconds: 30 }]
      }]
    }
  }
}

output proposedBlobUrl string = storage.properties.primaryEndpoints.blob
output proposedQueueUrl string = storage.properties.primaryEndpoints.queue
output proposedManagedIdentityClientId string = identity.properties.clientId
