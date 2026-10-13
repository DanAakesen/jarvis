import { randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import sql from 'mssql';
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations,readDownMigration,readMigrations,revertMigration } from './migrations.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { SqlHealthBuffer } from '../daily/health-upload/sql-buffer.js';
import { SqlHealthCapabilities } from '../daily/health-upload/sql-capabilities.js';
import { createSqlHealthUpload } from '../daily/health-upload/sql-composition.js';
import { healthSqlTransaction } from '../daily/health-upload/sql-transaction.js';
import { HealthConflict,HealthDenied,HealthUnavailable,sha256,type HealthCapability } from '../daily/health-upload/contracts.js';
import { HealthCapabilityLifecycleError,type PreparedHealthCapability } from '../daily/health-upload/capability-operation.js';

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') throw new Error('Health tests require isolated loopback SQL Server');
const database = `jarvis_health_ci_${randomUUID().replaceAll('-','')}`;
const admin = new sql.ConnectionPool({ ...configuration,database: 'master' });
const pool = new sql.ConnectionPool({ ...configuration,database });
const owner = '11111111-1111-4111-8111-111111111111'; const other = '22222222-2222-4222-8222-222222222222';
const filename = '0046_daily_health_upload_inbox.sql';
const base = Date.parse('2026-10-13T18:00:00.000Z'); let clock = base;
const now = () => clock; const signal = () => new AbortController().signal;
const definition = { deviceId: 'synthetic-phone',permissions: ['health-ingest','health-heartbeat'] as HealthCapability['permissions'],expiresAt: '2099-01-01T00:00:00.000Z' };
const body = Buffer.from('{ "synthetic":true,"data":{"metrics":[],"workouts":[]},"offset":"+02:00" }');
const identity = { automationId: 'synthetic-automation',sessionId: 'synthetic-session' };
const capabilities = (id = owner) => new SqlHealthCapabilities(pool,id,now);
const buffer = (id = owner,maxRawBytes?: number) => new SqlHealthBuffer(pool,id,{ now,maxRawBytes });
const migrations = async () => (await readMigrations()).filter(({ name }) => name === '0041_daily_owner_schema.sql' || name === filename);
const apps: ReturnType<typeof buildApp>[] = [];
async function provision(id = owner,input = definition) {
  const store = capabilities(id); const operation = store.prepare(input);
  expect(await store.issue(operation,signal())).toEqual({ state: 'issued' });
  const capability = await operation.useSecret(token => store.verify(token,signal()));
  expect(capability).not.toBeNull();
  return { store,operation,capability: capability! };
}
const rows = async () => (await pool.request().query('SELECT * FROM daily.health_upload_inbox')).recordset;
const accept = (device: Awaited<ReturnType<typeof provision>>,payload = body,ids = identity,inbox = buffer()) =>
  inbox.accept('upload',device.capability,ids,payload,signal(),device.operation.reference);
function app(options = createSqlHealthUpload(pool,owner)) {
  const config = loadConfig({});
  const instance = buildApp({ ...config,auth: { ...config.auth,ownerObjectId: owner } },undefined,{ modules: [],healthUpload: { ...options,enabled: true } });
  apps.push(instance); return instance;
}
function post(instance: ReturnType<typeof buildApp>,operation: PreparedHealthCapability,payload = body) {
  return operation.useSecret(token => instance.inject({ method: 'POST',url: '/api/health/ingest',payload,
    headers: { authorization: `Bearer ${token}`,'content-type': 'application/json','automation-id': identity.automationId,'session-id': identity.sessionId } }));
}
beforeAll(async () => {
  await admin.connect(); await admin.request().batch(`CREATE DATABASE [${database}];`); await pool.connect();
  await applyMigrations(pool,await migrations());
});
beforeEach(async () => { clock = base; await pool.request().batch('DELETE daily.health_upload_inbox; DELETE daily.health_upload_capabilities;'); });
afterAll(async () => {
  await Promise.all(apps.map(instance => instance.close())); await pool.close();
  if (admin.connected) await admin.request().batch(`IF DB_ID(N'${database}') IS NOT NULL BEGIN ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}]; END;`);
  await admin.close();
});

describe('inactive health acceptance on real isolated SQL Server',() => {
  it('creates empty reversible tables once without changing source-mapped rows',async () => {
    expect(await applyMigrations(pool,await migrations())).toEqual([]);
    expect(await rows()).toEqual([]);
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM daily.health_ingestions')).recordset[0].count).toBe(0);
    expect(createSqlHealthUpload(pool,owner).enabled).toBe(false);
  });
  it('commits exact raw bytes and one receipt across concurrent retries/reconstruction',async () => {
    const device = await provision();
    const receipts = await Promise.all(Array.from({ length: 6 },() => accept(device)));
    expect(new Set(receipts.map(row => row.acceptanceId)).size).toBe(1);
    expect(receipts.filter(row => !row.duplicate)).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ status: 'accepted',storage: 'sql',queue: 'pending',processing: 'not-confirmed',acceptedAt: new Date(base).toISOString() });
    const saved = await rows(); expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ checksum: sha256(body),raw_bytes: body,byte_count: body.length,processing_status: 'pending',processed_at: null });
    expect(await accept(device,body,identity,buffer())).toEqual({ ...receipts[0],duplicate: true });
    await expect(accept(device,Buffer.from('{"changed":true}'))).rejects.toBeInstanceOf(HealthConflict);
    expect((await rows())[0].raw_bytes).toEqual(body);
  });
  it('keeps owners, exact case-sensitive sessions and devices isolated',async () => {
    const device = await provision(); const foreign = await provision(other);
    await accept(device); await accept(device,body,{ ...identity,sessionId: 'Synthetic-session' });
    await accept(foreign,body,identity,buffer(other));
    expect(await rows()).toHaveLength(3);
    await expect(accept(foreign)).rejects.toBeInstanceOf(HealthDenied);
    await expect(buffer(other).accept('upload',{ ...device.capability,ownerObjectId: other },identity,body,signal(),device.operation.reference)).rejects.toBeInstanceOf(HealthDenied);
    const second = await provision(owner,{ ...definition,deviceId: 'synthetic-phone-two' });
    await expect(accept(second)).rejects.toBeInstanceOf(HealthConflict);
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM daily.health_daily_metrics')).recordset[0].count).toBe(0);
  });
  it('reconciles lost commit acknowledgement by retrying the same session',async () => {
    const device = await provision();
    const original = sql.Transaction.prototype.commit;
    const lost = vi.spyOn(sql.Transaction.prototype,'commit').mockImplementationOnce(async function(this: sql.Transaction) {
      await original.call(this); throw new Error('synthetic-commit-response-lost');
    });
    try { await expect(accept(device)).rejects.toBeInstanceOf(HealthUnavailable); }
    finally { lost.mockRestore(); }
    const saved = await rows(); expect(saved).toHaveLength(1);
    expect(await accept(device)).toMatchObject({ acceptanceId: String(saved[0].acceptance_id).toLowerCase(),duplicate: true });
    expect(await rows()).toHaveLength(1);
  });
  it('rechecks revocation, expiry and scope inside acceptance, not only before reading the body',async () => {
    const device = await provision(); await device.store.revoke(device.operation.reference,signal());
    await expect(accept(device)).rejects.toBeInstanceOf(HealthDenied);
    expect(await device.operation.useSecret(token => device.store.verify(token,signal()))).toBeNull();
    const expiring = await provision(owner,{ ...definition,expiresAt: new Date(base + 1000).toISOString() });
    clock = base + 1000;
    await expect(accept(expiring)).rejects.toBeInstanceOf(HealthDenied);
    const heartbeat = await provision(owner,{ ...definition,permissions: ['health-heartbeat'] });
    await expect(accept(heartbeat)).rejects.toBeInstanceOf(HealthDenied);
    expect(await rows()).toEqual([]);
  });
  it('hashes credentials, makes revocation terminal and atomically narrows a retryable rotation',async () => {
    const device = await provision();
    expect(JSON.stringify(device.operation)).toContain('redacted'); expect(inspect(device.operation)).toContain('redacted');
    const schema = (await pool.request().query("SELECT name FROM sys.columns WHERE object_id=OBJECT_ID('daily.health_upload_capabilities')")).recordset.map(row => row.name);
    expect(schema).not.toContain('token'); expect(schema).not.toContain('secret');
    const next = device.store.prepare({ ...definition,permissions: ['health-heartbeat'] });
    const results = await Promise.all(Array.from({ length: 4 },() => device.store.rotate(device.operation.reference,next,signal())));
    expect(results).toEqual(Array.from({ length: 4 },() => ({ state: 'rotated' })));
    expect(await device.operation.useSecret(token => device.store.verify(token,signal()))).toBeNull();
    expect(await next.useSecret(token => device.store.verify(token,signal()))).toMatchObject({ permissions: ['health-heartbeat'],revoked: false });
    await expect(device.store.rotate(device.operation.reference,device.store.prepare(definition),signal())).rejects.toBeInstanceOf(HealthCapabilityLifecycleError);
    await expect(device.store.rotate(next.reference,device.store.prepare(definition),signal())).rejects.toBeInstanceOf(HealthCapabilityLifecycleError);
    expect(await device.store.revoke(next.reference,signal())).toEqual({ state: 'revoked' });
    expect(await device.store.issue(next,signal())).toEqual({ state: 'revoked' });
    expect(await device.store.rotate(device.operation.reference,next,signal())).toEqual({ state: 'replacement-revoked' });
    expect(await capabilities(other).revoke(next.reference,signal())).toEqual({ state: 'not-found' });
  });
  it('retains raw evidence without age deletion and applies capacity backpressure without rejecting duplicates',async () => {
    const device = await provision(); const inbox = buffer(owner,body.length);
    await accept(device,body,identity,inbox);
    clock += 90 * 86400000;
    expect(await accept(device,body,identity,inbox)).toMatchObject({ duplicate: true });
    await expect(accept(device,body,{ ...identity,sessionId: 'another' },inbox)).rejects.toBeInstanceOf(HealthUnavailable);
    expect((await rows())[0].raw_bytes).toEqual(body); expect(await rows()).toHaveLength(1);
  });
  it('rolls back partial work on failure/cancellation and never emits an accepted receipt for it',async () => {
    const device = await provision();
    for (const cancel of [false,true]) {
      const controller = new AbortController();
      await expect(healthSqlTransaction(pool,owner,controller.signal,async tx => {
        await new sql.Request(tx).input('owner',sql.UniqueIdentifier,owner).input('id',sql.Char(64),device.operation.reference)
          .query('UPDATE daily.health_upload_capabilities SET revoked=1 WHERE owner_object_id=@owner AND token_hash=@id;');
        if (cancel) controller.abort(); else throw new Error('synthetic-private-sql-error');
      })).rejects.toThrow('Health buffer unavailable');
      expect(await device.operation.useSecret(token => device.store.verify(token,signal()))).not.toBeNull();
    }
    await expect(buffer().accept('upload',device.capability,identity,body,AbortSignal.abort(),device.operation.reference)).rejects.toBeInstanceOf(HealthUnavailable);
    expect(await rows()).toEqual([]);
  });
  it('exercises the actual backend: SQL commit -> 202, conflict -> 409, SQL unavailable -> 503',async () => {
    const device = await provision(); const instance = app();
    const first = await post(instance,device.operation); expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ storage: 'sql',processing: 'not-confirmed',duplicate: false });
    const second = await post(instance,device.operation); expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual({ ...first.json(),duplicate: true });
    expect((await post(instance,device.operation,Buffer.from('{"different":true}'))).statusCode).toBe(409);
    const disconnected = new sql.ConnectionPool({ ...configuration,database });
    try {
      const offline = await post(app(createSqlHealthUpload(disconnected,owner)),device.operation);
      expect(offline.statusCode).toBe(503); expect(offline.json()).toEqual({ error: 'Health acceptance unavailable' });
    } finally { await disconnected.close(); }
    expect(await rows()).toHaveLength(1);
  });
  it('refuses rollback with inbox or capability evidence and reverses only empty tables',async () => {
    const device = await provision(); await accept(device);
    const down = await readDownMigration(filename);
    await expect(revertMigration(pool,down)).rejects.toThrow('empty inbox');
    await pool.request().batch('DELETE daily.health_upload_inbox;');
    await expect(revertMigration(pool,down)).rejects.toThrow('empty capability');
    await pool.request().batch('DELETE daily.health_upload_capabilities;');
    await revertMigration(pool,down);
    expect((await pool.request().query("SELECT name FROM sys.tables WHERE name IN('health_upload_inbox','health_upload_capabilities')")).recordset).toEqual([]);
    await applyMigrations(pool,await migrations());
    expect(await rows()).toEqual([]);
  });
});
