targetScope = 'resourceGroup'

@description('Immutable, digest-pinned runner image and non-secret worker boot configuration.')
param customData string
param sshPublicKey string
param backendIdentityName string
param registryName string
param storageAccountName string
param keyVaultName string
param vmSize string = 'Standard_D2as_v5'
param adminUsername string = 'jarvisadmin'
var name = 'vm-jarvis-factory'
var vmContributor = '9980e02c-c2be-4d73-94e8-173b1dc7cf3c'

resource backend 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = { name: backendIdentityName }
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = { name: registryName }
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = { name: storageAccountName }
resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = { parent: storage, name: 'default' }
resource mailbox 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'factory-worker'
  properties: { publicAccess: 'None' }
}
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = { name: keyVaultName }
resource copilot 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = { parent: vault, name: 'jarvis-copilot' }
resource codex 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = { parent: vault, name: 'codex-login' }
resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${name}-nsg'
  location: resourceGroup().location
  properties: {
    securityRules: [{
      name: 'DenyAllInbound'
      properties: {
        priority: 100
        direction: 'Inbound'
        access: 'Deny'
        protocol: '*'
        sourcePortRange: '*'
        destinationPortRange: '*'
        sourceAddressPrefix: '*'
        destinationAddressPrefix: '*'
      }
    }]
  }
}
resource network 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${name}-vnet'
  location: resourceGroup().location
  properties: {
    addressSpace: { addressPrefixes: ['10.42.0.0/24'] }
    subnets: [{name: 'workers', properties: {addressPrefix: '10.42.0.0/24', defaultOutboundAccess: false}}]
  }
}
// Explicit outbound connectivity; the NSG denies every inbound port, including SSH.
resource outbound 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: '${name}-outbound'
  location: resourceGroup().location
  sku: { name: 'Standard' }
  properties: { publicIPAllocationMethod: 'Static' }
}
resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: '${name}-nic'
  location: resourceGroup().location
  properties: {
    networkSecurityGroup: { id: nsg.id }
    ipConfigurations: [{
      name: 'primary'
      properties: {
        privateIPAllocationMethod: 'Dynamic'
        subnet: { id: '${network.id}/subnets/workers' }
        publicIPAddress: { id: outbound.id }
      }
    }]
  }
}
resource workspace 'Microsoft.Compute/disks@2024-03-02' = {
  name: '${name}-workspace'
  location: resourceGroup().location
  sku: { name: 'StandardSSD_LRS' }
  properties: { creationData: { createOption: 'Empty' }, diskSizeGB: 128 }
  tags: { project: 'jarvis', purpose: 'factory-workspace', retention: 'keep' }
}
resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: name
  location: resourceGroup().location
  identity: { type: 'SystemAssigned' }
  tags: { project: 'jarvis', purpose: 'factory-worker', idleDeallocationSeconds: '120' }
  properties: {
    hardwareProfile: { vmSize: vmSize }
    networkProfile: { networkInterfaces: [{id: nic.id}] }
    storageProfile: {
      imageReference: { publisher: 'Canonical', offer: 'ubuntu-24_04-lts', sku: 'server', version: 'latest' }
      osDisk: { createOption: 'FromImage', managedDisk: { storageAccountType: 'StandardSSD_LRS' }, diskSizeGB: 64 }
      dataDisks: [{lun: 0, name: workspace.name, createOption: 'Attach', managedDisk: {id: workspace.id}, deleteOption: 'Detach'}]
    }
    osProfile: {
      computerName: name
      adminUsername: adminUsername
      ...(empty(customData) ? {} : {customData: customData})
      linuxConfiguration: {
        disablePasswordAuthentication: true
        provisionVMAgent: true
        ssh: {publicKeys: [{path: '/home/${adminUsername}/.ssh/authorized_keys', keyData: sshPublicKey}]}
      }
    }
    securityProfile: { securityType: 'TrustedLaunch', uefiSettings: {secureBootEnabled: true, vTpmEnabled: true} }
  }
}
resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, vm.id, 'pull')
  scope: registry
  properties: { principalId: vm.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d') }
}
resource mailboxAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(mailbox.id, vm.id, 'mailbox')
  scope: mailbox
  properties: { principalId: vm.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe') }
}
resource copilotAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(copilot.id, vm.id, 'read')
  scope: copilot
  properties: { principalId: vm.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6') }
}
resource codexAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(codex.id, vm.id, 'refresh')
  scope: codex
  properties: { principalId: vm.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7') }
}
// The deploy identity cannot create custom role definitions. Both built-in assignments
// are limited to this one VM; neither identity can manage other compute or the disk.
resource selfPower 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vm.id, 'self-power')
  scope: vm
  properties: { principalId: vm.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', vmContributor) }
}
resource backendPower 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vm.id, backend.id, 'wake')
  scope: vm
  properties: { principalId: backend.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', vmContributor) }
}
output resourceId string = vm.id
output workspaceGiB int = workspace.properties.diskSizeGB
