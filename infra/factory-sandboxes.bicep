targetScope = 'resourceGroup'

param location string = 'swedencentral'
param registryName string
param keyVaultName string
param backendIdentityName string
param deployPrincipalId string

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-jarvis-factory-sandbox'
  location: location
  tags: { project: 'jarvis', purpose: 'factory-sandboxes' }
}
resource group 'Microsoft.App/sandboxGroups@2026-07-01' = {
  name: 'jarvis-factory'
  location: location
  tags: { project: 'jarvis', purpose: 'factory-sandboxes' }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    defaultCpu: '2'
    defaultMemory: '4Gi'
    defaultDisk: '40Gi'
    // Retained stopped sessions must not consume the 100 active-worker slots.
    maxSandboxCount: 1000
  }
}
resource backend 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = { name: backendIdentityName }
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = { name: registryName }
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = { name: keyVaultName }
resource copilot 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = { parent: vault, name: 'jarvis-copilot' }
resource codex 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = { parent: vault, name: 'codex-login' }
var dataOwner = 'c24cf47c-5077-412d-a19c-45202126392c'
resource deployAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(group.id, deployPrincipalId, dataOwner)
  scope: group
  properties: {
    principalId: deployPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', dataOwner)
  }
}
resource backendAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(group.id, backend.id, dataOwner)
  scope: group
  properties: {
    principalId: backend.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', dataOwner)
  }
}
resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.id, 'pull')
  scope: registry
  properties: { principalId: identity.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d') }
}
resource copilotRead 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(copilot.id, identity.id, 'read')
  scope: copilot
  properties: { principalId: identity.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6') }
}
resource codexRefresh 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(codex.id, identity.id, 'refresh')
  scope: codex
  properties: { principalId: identity.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7') }
}
// Workers receive no group-management or account-wide storage role.
output resourceId string = group.id
output identityResourceId string = identity.id
output identityClientId string = identity.properties.clientId
