import { describe,expect,it,vi } from 'vitest';
import type sql from 'mssql';
import { SqlHealthBuffer,healthInboxByteLimit } from './sql-buffer.js';
import { SqlHealthCapabilities } from './sql-capabilities.js';
import { createSqlHealthUpload } from './sql-composition.js';
import { healthUploadLimit,type HealthCapability } from './contracts.js';

const owner = '11111111-1111-4111-8111-111111111111';
const capability: HealthCapability = { version: 1,ownerObjectId: owner,deviceId: 'synthetic',permissions: ['health-ingest'],expiresAt: '2099-01-01T00:00:00.000Z',revoked: false };
const identity = { automationId: 'synthetic-automation',sessionId: 'synthetic-session' };
const pool = { request: vi.fn(() => { throw new Error('unexpected database access'); }) } as unknown as sql.ConnectionPool;

describe('SQL upload local validation and inactive wiring',() => {
  it('constructs default-off dependencies without opening/using a pool',() => {
    const options = createSqlHealthUpload(pool,owner);
    expect(options.enabled).toBe(false); expect(options.buffer?.owner).toBe(owner);
    expect(pool.request).not.toHaveBeenCalled();
    for (const maxRawBytes of [0,-1,1.1,NaN,Infinity,healthInboxByteLimit + 1]) expect(() => new SqlHealthBuffer(pool,owner,{ maxRawBytes })).toThrow('capacity');
  });
  it('denies missing hash, invalid owner/capability and malformed/oversized bytes before SQL',async () => {
    const buffer = new SqlHealthBuffer(pool,owner); const signal = new AbortController().signal;
    await expect(buffer.accept('upload',capability,identity,Buffer.from('{}'),signal)).rejects.toThrow('denied');
    await expect(buffer.accept('upload',{ ...capability,revoked: true },identity,Buffer.from('{}'),signal,'a'.repeat(64))).rejects.toThrow('denied');
    await expect(buffer.accept('upload',capability,{ ...identity,sessionId: '' },Buffer.from('{}'),signal,'a'.repeat(64))).rejects.toThrow('identifier');
    for (const body of [Buffer.alloc(0),Buffer.alloc(healthUploadLimit + 1),Buffer.from('{'),Buffer.from([0xff])]) {
      await expect(buffer.accept('upload',capability,identity,body,signal,'a'.repeat(64))).rejects.toThrow();
    }
    expect(pool.request).not.toHaveBeenCalled();
  });
  it('validates protected lifecycle input without generating a database request',async () => {
    const store = new SqlHealthCapabilities(pool,owner);
    for (const input of [
      { deviceId: '',permissions: ['health-ingest'],expiresAt: '2099-01-01T00:00:00.000Z' },
      { deviceId: 'synthetic',permissions: [],expiresAt: '2099-01-01T00:00:00.000Z' },
      { deviceId: 'synthetic',permissions: ['health-ingest'],expiresAt: '2000-01-01T00:00:00.000Z' },
    ]) expect(() => store.prepare(input as Parameters<typeof store.prepare>[0])).toThrow('invalid-input');
    expect(await store.verify('human.jwt.shape',new AbortController().signal)).toBeNull();
    expect(pool.request).not.toHaveBeenCalled();
  });
});
