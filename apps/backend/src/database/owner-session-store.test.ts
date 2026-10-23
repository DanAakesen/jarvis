import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import type { OwnerSessionRecord } from '../auth/session/store.js';
import { generateOwnerSessionCredential, ownerSessionIdToBytes } from '../auth/session/token.js';
import { createOwnerSessionStatement, createOwnerSessionStore } from './owner-session-store.js';

const owner = '11111111-2222-4333-8444-555555555555';
const at = new Date('2026-10-22T12:00:00.000Z');
const day = 24 * 60 * 60_000;

type Result = { recordset?: unknown[]; rowsAffected?: number[] };

function fixture(result: Result = { recordset: [], rowsAffected: [1] }) {
  const query = vi.fn<(text: string) => Promise<Result>>(async () => result);
  const input = vi.fn();
  const request = { input, query };
  input.mockReturnValue(request);
  const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
  return { store: createOwnerSessionStore(pool), input, query };
}

function record(overrides: Partial<OwnerSessionRecord> = {}): OwnerSessionRecord {
  const credential = generateOwnerSessionCredential();
  return {
    sessionId: credential.sessionId,
    secretHash: credential.secretHash,
    ownerObjectId: owner,
    displayName: 'Test Owner',
    deviceLabel: null,
    createdAt: at,
    lastUsedAt: at,
    idleExpiresAt: new Date(at.getTime() + 10 * day),
    absoluteExpiresAt: new Date(at.getTime() + 30 * day),
    revokedAt: null,
    ...overrides,
  };
}

const flat = (text: string | undefined) => (text ?? '').replace(/\s+/g, ' ');

// A mock cannot run the SQL, but it can prove that every parameter a statement uses is bound, and nothing else is.
function expectBindsExactlyWhatItUses(
  input: ReturnType<typeof vi.fn>, text: string | undefined, notParameters: readonly string[] = [],
) {
  const bound = input.mock.calls.map(([name]) => String(name)).sort();
  const used = [...new Set([...(text ?? '').matchAll(/(?<!@)@(\w+)/g)].map((match) => match[1] ?? ''))]
    .filter((name) => !notParameters.includes(name)).sort();
  expect(bound).toEqual(used);
}

const batchLocals = ['lockResult', 'lockResource', 'evicted', 'Resource', 'LockMode', 'LockOwner', 'LockTimeout'];

describe('SQL owner session store', () => {
  describe('create', () => {
    const input = () => ({ record: record({ ownerObjectId: owner.toUpperCase(), deviceLabel: 'Work laptop' }), maxActive: 10, purgeBefore: new Date(at.getTime() - 30 * day) });

    it('saves the session in one batch and reports how many sessions it revoked', async () => {
      const f = fixture({ recordset: [{ evicted: 2 }], rowsAffected: [] });
      const request = input();
      await expect(f.store.create(request)).resolves.toEqual({ evicted: 2 });
      expect(f.query).toHaveBeenCalledTimes(1);
      expect(f.query.mock.calls[0]?.[0]).toBe(createOwnerSessionStatement);
      const row = request.record;
      expect(f.input).toHaveBeenCalledWith('sessionId', sql.VarBinary(16), ownerSessionIdToBytes(row.sessionId));
      expect(f.input).toHaveBeenCalledWith('secretHash', sql.VarBinary(32), row.secretHash);
      expect(f.input).toHaveBeenCalledWith('owner', sql.UniqueIdentifier, owner);
      expect(f.input).toHaveBeenCalledWith('displayName', sql.NVarChar(200), 'Test Owner');
      expect(f.input).toHaveBeenCalledWith('deviceLabel', sql.NVarChar(40), 'Work laptop');
      expect(f.input).toHaveBeenCalledWith('now', sql.DateTime2(3), row.createdAt);
      expect(f.input).toHaveBeenCalledWith('idleExpiresAt', sql.DateTime2(3), row.idleExpiresAt);
      expect(f.input).toHaveBeenCalledWith('absoluteExpiresAt', sql.DateTime2(3), row.absoluteExpiresAt);
      expect(f.input).toHaveBeenCalledWith('purgeBefore', sql.DateTime2(3), request.purgeBefore);
      expect(f.input).toHaveBeenCalledWith('keep', sql.Int, 9);
    });

    it('binds a missing device label as a null of the column type', async () => {
      const f = fixture({ recordset: [{ evicted: 0 }] });
      await f.store.create({ ...input(), record: record() });
      expect(f.input).toHaveBeenCalledWith('deviceLabel', sql.NVarChar(40), null);
    });

    it('keeps no negative number of sessions when the limit is zero', async () => {
      const f = fixture({ recordset: [{ evicted: 0 }] });
      await f.store.create({ ...input(), maxActive: 0 });
      expect(f.input).toHaveBeenCalledWith('keep', sql.Int, 0);
    });

    it('binds every parameter the batch uses and nothing else', async () => {
      const f = fixture({ recordset: [{ evicted: 0 }] });
      await f.store.create(input());
      expectBindsExactlyWhatItUses(f.input, createOwnerSessionStatement, batchLocals);
    });

    it('runs purge, eviction and insert in that order inside one locked transaction', () => {
      const text = flat(createOwnerSessionStatement);
      const steps = [
        'SET XACT_ABORT ON', 'BEGIN TRANSACTION', 'sys.sp_getapplock', 'DELETE FROM dbo.owner_sessions',
        'UPDATE dbo.owner_sessions SET revoked_at', 'INSERT dbo.owner_sessions', 'COMMIT TRANSACTION', 'SELECT @evicted AS evicted',
      ].map((step) => text.indexOf(step));
      expect(steps.every((position) => position >= 0)).toBe(true);
      expect(steps).toEqual([...steps].sort((a, b) => a - b));
      expect(text).toContain("@LockMode = 'Exclusive'");
      expect(text).toContain("@LockOwner = 'Transaction'");
      expect(text).toContain("jarvis.owner-sessions:");
      expect(text).toMatch(/IF @lockResult < 0 THROW/);
    });

    it('only ever deletes or revokes the creating owner\'s rows', () => {
      const text = flat(createOwnerSessionStatement);
      expect(text).toMatch(/DELETE FROM dbo\.owner_sessions WHERE owner_object_id = @owner AND/);
      expect(text).toMatch(/UPDATE dbo\.owner_sessions SET revoked_at = @now WHERE owner_object_id = @owner AND revoked_at IS NULL/);
      expect(text).toMatch(/SELECT TOP \(@keep\) session_id FROM dbo\.owner_sessions WHERE owner_object_id = @owner AND revoked_at IS NULL/);
      expect(text).toContain('ORDER BY last_used_at DESC, created_at DESC, session_id DESC');
    });

    it('fails when the batch does not report a saved row', async () => {
      const f = fixture({ recordset: [], rowsAffected: [] });
      await expect(f.store.create(input())).rejects.toThrow('Owner session was not saved');
    });

    it('passes a database failure through unchanged', async () => {
      const f = fixture();
      const failure = Object.assign(new Error('lock timeout'), { number: 51001 });
      f.query.mockRejectedValue(failure);
      await expect(f.store.create(input())).rejects.toBe(failure);
    });
  });

  describe('find', () => {
    const rowOf = (session: OwnerSessionRecord) => ({
      session_id: ownerSessionIdToBytes(session.sessionId),
      secret_hash: session.secretHash,
      owner_object_id: owner.toUpperCase(),
      display_name: session.displayName,
      device_label: session.deviceLabel,
      created_at: session.createdAt,
      last_used_at: session.lastUsedAt,
      idle_expires_at: session.idleExpiresAt,
      absolute_expires_at: session.absoluteExpiresAt,
      revoked_at: session.revokedAt,
    });

    it('maps the stored row to a record', async () => {
      const session = record({ deviceLabel: 'Work laptop', revokedAt: new Date(at.getTime() + day) });
      const f = fixture({ recordset: [rowOf(session)] });
      const found = await f.store.find(session.sessionId);
      expect(found).toEqual(session);
      expect(found?.secretHash).not.toBe(session.secretHash);
      expect(f.input).toHaveBeenCalledWith('sessionId', sql.VarBinary(16), ownerSessionIdToBytes(session.sessionId));
      expectBindsExactlyWhatItUses(f.input, f.query.mock.calls[0]?.[0]);
    });

    it('returns null for an unknown session', async () => {
      const f = fixture({ recordset: [] });
      await expect(f.store.find(record().sessionId)).resolves.toBeNull();
    });

    it('selects by the primary key and passes a database failure through', async () => {
      const f = fixture({ recordset: [] });
      await f.store.find(record().sessionId);
      expect(flat(f.query.mock.calls[0]?.[0])).toContain('FROM dbo.owner_sessions WHERE session_id = @sessionId');
      const failure = new Error('connection lost');
      f.query.mockRejectedValue(failure);
      await expect(f.store.find(record().sessionId)).rejects.toBe(failure);
    });
  });

  describe('touch', () => {
    const request = () => ({
      sessionId: record().sessionId,
      now: at,
      idleExpiresAt: new Date(at.getTime() + 10 * day),
      staleBefore: new Date(at.getTime() - 60 * 60_000),
    });

    it('extends only a live session that has not been refreshed recently', async () => {
      const f = fixture({ rowsAffected: [1] });
      const values = request();
      await expect(f.store.touch(values)).resolves.toBe(true);
      expect(f.input).toHaveBeenCalledWith('sessionId', sql.VarBinary(16), ownerSessionIdToBytes(values.sessionId));
      expect(f.input).toHaveBeenCalledWith('now', sql.DateTime2(3), values.now);
      expect(f.input).toHaveBeenCalledWith('idleExpiresAt', sql.DateTime2(3), values.idleExpiresAt);
      expect(f.input).toHaveBeenCalledWith('staleBefore', sql.DateTime2(3), values.staleBefore);
      const text = flat(f.query.mock.calls[0]?.[0]);
      for (const guard of [
        'revoked_at IS NULL', 'last_used_at <= @staleBefore', 'idle_expires_at > @now', 'absolute_expires_at > @now',
      ]) expect(text).toContain(guard);
      expectBindsExactlyWhatItUses(f.input, f.query.mock.calls[0]?.[0]);
    });

    it.each([[[0]], [[]]])('reports that nothing changed when rowsAffected is %j', async (rowsAffected) => {
      const f = fixture({ rowsAffected });
      await expect(f.store.touch(request())).resolves.toBe(false);
    });
  });

  describe('revoke', () => {
    it('revokes one unrevoked session of the owner', async () => {
      const f = fixture({ rowsAffected: [1] });
      const { sessionId } = record();
      await expect(f.store.revoke(owner.toUpperCase(), sessionId, at)).resolves.toBe(true);
      expect(f.input).toHaveBeenCalledWith('sessionId', sql.VarBinary(16), ownerSessionIdToBytes(sessionId));
      expect(f.input).toHaveBeenCalledWith('owner', sql.UniqueIdentifier, owner);
      expect(f.input).toHaveBeenCalledWith('at', sql.DateTime2(3), at);
      expect(flat(f.query.mock.calls[0]?.[0])).toContain(
        'WHERE session_id = @sessionId AND owner_object_id = @owner AND revoked_at IS NULL',
      );
      expectBindsExactlyWhatItUses(f.input, f.query.mock.calls[0]?.[0]);
    });

    it('reports a session that was missing, foreign or already revoked as not revoked', async () => {
      const f = fixture({ rowsAffected: [0] });
      await expect(f.store.revoke(owner, record().sessionId, at)).resolves.toBe(false);
    });
  });

  describe('revokeAll', () => {
    it('revokes every active session of the owner and returns how many there were', async () => {
      const f = fixture({ rowsAffected: [3] });
      await expect(f.store.revokeAll(owner.toUpperCase(), at)).resolves.toBe(3);
      expect(f.input).toHaveBeenCalledWith('owner', sql.UniqueIdentifier, owner);
      expect(f.input).toHaveBeenCalledWith('at', sql.DateTime2(3), at);
      expect(flat(f.query.mock.calls[0]?.[0])).toContain(
        'WHERE owner_object_id = @owner AND revoked_at IS NULL AND idle_expires_at > @at AND absolute_expires_at > @at',
      );
      expectBindsExactlyWhatItUses(f.input, f.query.mock.calls[0]?.[0]);
    });

    it('returns zero when there was nothing to revoke', async () => {
      const f = fixture({ rowsAffected: [] });
      await expect(f.store.revokeAll(owner, at)).resolves.toBe(0);
    });
  });
});
