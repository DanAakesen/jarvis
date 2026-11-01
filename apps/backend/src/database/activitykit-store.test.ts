import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createActivityRegistrationStore, type ActivityRegistration } from './activitykit-store.js';
import { readDownMigration, readMigrations } from './migrations.js';

const owner = '11111111-2222-4333-8444-555555555555';
const registration: ActivityRegistration = {
  activityId: 'fixture', kind: 'factory_task', resourceId: '42', pushToken: 'ab'.repeat(32), language: 'da',
};
function fixture(recordset: unknown[] = []) {
  const query = vi.fn<(statement: string) => Promise<{ recordset: unknown[] }>>(async () => ({ recordset }));
  const input = vi.fn();
  const request = { query, input };
  input.mockReturnValue(request);
  const pool = { request: () => request } as unknown as sql.ConnectionPool;
  return { store: createActivityRegistrationStore(pool), query, input };
}

describe('SQL ActivityKit registration store', () => {
  it('saves bounded owner-scoped token registration with rotation and a serialized 20-activity limit', async () => {
    const f = fixture([{ saved: true }]);
    await expect(f.store.upsert(owner, registration)).resolves.toBe(true);
    expect(f.input).toHaveBeenCalledWith('owner', sql.UniqueIdentifier, owner);
    expect(f.input).toHaveBeenCalledWith('token', sql.VarChar(512), registration.pushToken);
    const statement = f.query.mock.calls[0]?.[0] ?? '';
    expect(statement).toContain('BEGIN TRANSACTION');
    expect(statement).toContain('sys.sp_getapplock');
    expect(statement).toContain('@LockTimeout=5000');
    expect(statement).toContain('expires_at <= SYSUTCDATETIME()');
    expect(statement).toContain('COUNT(*)');
    expect(statement).toContain('< 20');
    expect(statement).toContain('push_token=@token');
    expect(statement).toContain('DATEADD(hour, 8, SYSUTCDATETIME())');
    expect(statement).not.toContain(registration.pushToken);
    expect(statement).not.toContain(owner);
  });
  it('reports rejected writes and bounds live registrations to the authenticated owner', async () => {
    const f = fixture([{ saved: false }]);
    await expect(f.store.upsert(owner, registration)).resolves.toBe(false);
    const listed = fixture([registration]);
    await expect(listed.store.list(owner)).resolves.toEqual([registration]);
    expect(listed.query.mock.calls[0]?.[0]).toContain('SELECT TOP (20)');
    expect(listed.query.mock.calls[0]?.[0]).toContain('owner_object_id=@owner AND expires_at > SYSUTCDATETIME()');
  });
  it('guards asynchronous invalidation against deleting a newly rotated token', async () => {
    const f = fixture();
    await f.store.remove(owner, registration.activityId, registration.pushToken);
    expect(f.input).toHaveBeenCalledWith('token', sql.VarChar(512), registration.pushToken);
    expect(f.query.mock.calls[0]?.[0]).toContain('(@token IS NULL OR push_token=@token)');
    expect(f.query.mock.calls[0]?.[0]).toContain('owner_object_id=@owner AND activity_id=@activityId');
    await f.store.remove(owner, registration.activityId);
    expect(f.input).toHaveBeenLastCalledWith('token', sql.VarChar(512), null);
  });
  it('ships a reversible owner-scoped migration with explicit preservation on rollback', async () => {
    const migration = (await readMigrations()).find((item) => item.name === '0071_activitykit_registrations.sql');
    expect(migration?.sql).toContain('PRIMARY KEY (owner_object_id, activity_id)');
    expect(migration?.sql).toContain('push_token varchar(512) NOT NULL');
    expect(migration?.sql).toContain('expires_at datetime2(3) NOT NULL');
    const down = await readDownMigration('0071_activitykit_registrations.sql');
    expect(down.sql).toContain('TABLOCKX,HOLDLOCK');
    expect(down.sql).toContain('THROW 51000');
    expect(down.sql).toContain('DROP TABLE dbo.activitykit_registrations');
  });
});
