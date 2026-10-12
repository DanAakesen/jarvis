import { afterEach,describe,expect,it,vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { coreModule } from '../../core/index.js';
import { registerNutritionExportRoutes } from './routes.js';
import { ExportConflict } from './model.js';
import type { NutritionExportCredentialVerifier,NutritionExportDevice } from './auth.js';

const config = { ...loadConfig({}),logLevel: 'silent' as const };
const credential = 'synthetic_export_capability_'.padEnd(43,'x');
const headers = { authorization: `Bearer ${credential}` };
const path = '/daily/nutrition/export/claim';
const device: NutritionExportDevice = { kind: 'nutrition-export-device',scope: 'nutrition-export',ownerObjectId: config.auth.ownerObjectId,
  deviceId: 'synthetic-phone',expiresAt: '2027-01-01T00:00:00Z',revoked: false };
const apps: ReturnType<typeof buildApp>[] = [];
const claim = vi.fn(async () => ({ state: 'claimed' as const,claimToken: '11111111-1111-4111-8111-111111111111',claimedAt: '2026-10-12T12:00:00Z',claimExpiresAt: '2026-10-12T12:05:00Z',items: [] }));
const complete = vi.fn(async () => ({ state: 'written',completedAt: '2026-10-12T12:00:00Z',replay: false }));
async function fixture(verify?: NutritionExportCredentialVerifier,registered = true) {
  const app = buildApp(config,undefined,{ modules: [coreModule],nutritionExportAuth: verify,
    auth: async () => ({ objectId: config.auth.ownerObjectId,tenantId: config.auth.tenantId,displayName: 'Synthetic owner' }) });
  apps.push(app);
  app.get('/wrong-export',{ config: { jarvisNutritionExport: true } },async () => ({}));
  if (registered) await registerNutritionExportRoutes(app,() => ({ claim,complete }));
  return app;
}
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); vi.clearAllMocks(); });
describe('inactive scoped export root authentication and endpoints',() => {
  it('leaves production registration absent and existing owner/agent/tool auth untouched',async () => {
    const app = await fixture(undefined,false);
    expect((await app.inject({ method: 'POST',url: path,headers: { authorization: 'Bearer owner.e30.sig' },payload: { operationKey: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ url: '/tools',headers: { authorization: 'Bearer owner.e30.sig' } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/tools',headers })).statusCode).toBe(401);
    expect(claim).not.toHaveBeenCalled();
  });
  it.each([undefined,async () => null,async () => ({ ...device,revoked: true }),async () => ({ ...device,expiresAt: '2020-01-01T00:00:00Z' }),
    async () => ({ ...device,ownerObjectId: '22222222-2222-4222-8222-222222222222' }),async () => ({ ...device,scope: 'upload' } as never),
  ])('fails closed for absent/revoked/expired/wrong-owner/wrong-scope capability %#',async verify => {
    const app = await fixture(verify);
    const result = await app.inject({ method: 'POST',url: path,headers,payload: { operationKey: 'x' } });
    expect(result.statusCode).toBe(403); expect(result.body).not.toContain(credential); expect(claim).not.toHaveBeenCalled();
  });
  it('checks capability on every call, denies JWT/human/other-route reuse and observes revocation',async () => {
    let revoked = false; const verify = vi.fn<NutritionExportCredentialVerifier>(async () => ({ ...device,revoked }));
    const app = await fixture(verify);
    expect((await app.inject({ method: 'POST',url: path,headers,payload: { operationKey: 'x' } })).statusCode).toBe(200);
    revoked = true;
    expect((await app.inject({ method: 'POST',url: path,headers,payload: { operationKey: 'y' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST',url: path,headers: { authorization: 'Bearer owner.e30.sig' },payload: { operationKey: 'z' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/wrong-export',headers })).statusCode).toBe(403);
    expect(verify).toHaveBeenCalledTimes(2); expect(claim).toHaveBeenCalledTimes(1);
  });
  it('rejects owner selectors and over-16KiB bodies before store calls; sanitizes conflicts',async () => {
    const app = await fixture(async () => device);
    expect((await app.inject({ method: 'POST',url: path,headers,payload: { operationKey: 'x',owner: 'other' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST',url: path,headers,payload: { operationKey: 'x'.repeat(17000) } })).statusCode).toBe(413);
    expect(claim).not.toHaveBeenCalled();
    claim.mockRejectedValueOnce(new ExportConflict());
    expect((await app.inject({ method: 'POST',url: path,headers,payload: { operationKey: 'x' } })).statusCode).toBe(409);
    const response = await app.inject({ method: 'POST',url: '/daily/nutrition/export/complete',headers,
      payload: { id: '01',claimToken: '11111111-1111-4111-8111-111111111111',status: 'written' } });
    expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
  });
});
