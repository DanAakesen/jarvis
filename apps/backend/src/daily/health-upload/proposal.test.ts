import { readFileSync,readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe,expect,it } from 'vitest';

const root = fileURLToPath(new URL('../../../../../',import.meta.url));
const source = readFileSync(join(root,'docs/daily-health-ingestion/proposal.bicep'),'utf8');
// Deliberately a source contract, not an RBAC provider validator. Offline Bicep
// build/lint is separate; only protected deployed-identity tests prove authorization.
function resource(name: string): string {
  const declaration = new RegExp(`^resource ${name} '[^']+'[^\\n]*`, 'mu').exec(source);
  expect(declaration,`resource ${name}`).not.toBeNull();
  const start = declaration!.index;
  const next = source.slice(start + declaration![0].length).search(/^(?:resource|output) /mu);
  return next < 0 ? source.slice(start) : source.slice(start,start + declaration![0].length + next);
}
function array(body: string,key: string): string[] {
  const matches = [...body.matchAll(new RegExp(`\\b${key}:\\s*\\[([^\\]]*)\\]`,'gu'))];
  expect(matches).toHaveLength(1);
  const content = matches[0]![1]!;
  expect(content.replace(/'[^']*'/gu,'').replace(/[\s,]/gu,'')).toBe('');
  return [...content.matchAll(/'([^']*)'/gu)].map(match => match[1]!);
}
function watchedFiles(directory: string): string[] {
  return readdirSync(directory,{ withFileTypes: true }).flatMap(entry => {
    const path = join(directory,entry.name);
    return entry.isDirectory() ? watchedFiles(path) : /\.(?:bicep|ya?ml|json|py|ps1|sh)$/u.test(entry.name) ? [path] : [];
  });
}
describe('unreferenced Daily health proposal offline contract',() => {
  it('keeps exact provider permissions and separate resource assignment scopes',() => {
    expect([...source.matchAll(/^resource (\w+) 'Microsoft.Authorization\/roleDefinitions@/gmu)].map(match => match[1])).toEqual(['rawRole','devicesRole','pointersRole']);
    const containerRead = 'Microsoft.Storage/storageAccounts/blobServices/containers/read';
    const blob = 'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/';
    const roles = [
      { name: 'rawRole',grant: 'rawGrant',scope: 'raw',actions: [containerRead],data: [blob + 'read',blob + 'write'] },
      { name: 'devicesRole',grant: 'devicesGrant',scope: 'devices',actions: [containerRead],data: [blob + 'read'] },
      { name: 'pointersRole',grant: 'pointersGrant',scope: 'pointers',actions: [],data: ['Microsoft.Storage/storageAccounts/queueServices/queues/messages/add/action'] },
    ];
    for (const role of roles) {
      const body = resource(role.name);
      expect(array(body,'actions')).toEqual(role.actions); expect(array(body,'dataActions')).toEqual(role.data);
      expect(array(body,'notActions')).toEqual([]); expect(array(body,'notDataActions')).toEqual([]);
      expect(body).toMatch(/assignableScopes:\s*\[resourceGroup\(\)\.id\]/u);
      const grant = resource(role.grant);
      expect(grant).toMatch(new RegExp(`\\bscope: ${role.scope}\\s`,'u'));
      expect(grant).toContain(`roleDefinitionId: ${role.name}.id`);
      expect(grant).toContain('principalId: identity.properties.principalId');
    }
    expect([...source.matchAll(/^resource (\w+) 'Microsoft.Authorization\/roleAssignments@/gmu)].map(match => match[1])).toEqual(['rawGrant','devicesGrant','pointersGrant','imagePullGrant']);
    expect(resource('imagePullGrant')).toMatch(/scope: registry\s/u);
    expect(resource('imagePullGrant')).toContain("subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')");
  });
  it('remains private, default-off and at most one replica without production composition',() => {
    for (const flag of ['deployHost','uploadEnabled','recoveryEnabled']) expect(source).toContain(`param ${flag} bool = false`);
    expect(source).toMatch(/@allowed\(\[0, 1\]\)\s*param minimumReplicas int = 0/u);
    expect(resource('host')).toContain('= if (deployHost)');
    expect(resource('host')).toContain('scale: { minReplicas: minimumReplicas, maxReplicas: 1 }');
    expect(resource('host')).toContain("name: 'DAILY_HEALTH_UPLOAD_ENABLED', value: string(uploadEnabled)");
    expect(resource('host')).toContain("name: 'DAILY_HEALTH_RECOVERY_ENABLED', value: string(recoveryEnabled)");
    for (const name of ['raw','devices']) expect(resource(name)).toContain("publicAccess: 'None'");
    expect(resource('storage')).toContain('allowBlobPublicAccess: false');
    expect(resource('storage')).toContain('allowSharedKeyAccess: false');
    for (const directory of ['infra','.github/workflows','.github/scripts']) {
      for (const path of watchedFiles(join(root,directory))) expect(readFileSync(path,'utf8'),path).not.toMatch(/daily-health-ingestion|proposal\.bicep/u);
    }
  });
});
