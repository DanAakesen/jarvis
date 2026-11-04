import type sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createHealthChanges } from '../revisions.js';
import { parseDeviceSync, type DeviceSyncBatch } from './device-sync.js';

const owner = '11111111-1111-4111-8111-111111111111';
const written = vi.fn(async () => undefined);
const ingestions = new Map<string, { received_at: string; normalized_counts_json: string }>();

vi.mock('../health/persistence.js', async importOriginal => ({ ...await importOriginal<object>(), writeNormalized: written }));
vi.mock('../health-upload/sql-transaction.js', () => ({
  healthSqlTransaction: async (_pool: unknown, _owner: string, _signal: AbortSignal, action: (tx: unknown, signal: AbortSignal) => unknown) => action({}, new AbortController().signal),
  healthSqlQuery: async (request: { parameters: Record<string, { value: string }> }, query: string) => {
    const session = request.parameters.session?.value;
    if (query.startsWith('SELECT')) return { recordset: session && ingestions.has(session) ? [ingestions.get(session)] : [] };
    ingestions.set(request.parameters.id!.value, { received_at: request.parameters.received!.value, normalized_counts_json: request.parameters.counts!.value });
    return { recordset: [] };
  },
}));

const { SqlDeviceSyncStore } = await import('./device-sync-store.js');
const request = { server: { ownerObjectId: owner }, principal: { objectId: owner, tenantId: 't' } } as never;
const batch = (): DeviceSyncBatch => {
  const result = parseDeviceSync({ samples: [{ id: 'a', metric: 'step_count', unit: 'count', start: '2026-11-04T08:00:00Z', end: '2026-11-04T08:05:00Z', value: 10 }] });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
};

describe('SqlDeviceSyncStore', () => {
  it('writes once and acknowledges an identical retry without writing or notifying again', async () => {
    const changes = createHealthChanges();
    const published = vi.fn();
    changes.subscribe(published);
    const store = SqlDeviceSyncStore.forRequest({} as sql.ConnectionPool, request, changes, () => Date.parse('2026-11-04T10:00:00Z'));
    const first = await store.apply(batch(), new AbortController().signal);
    const second = await store.apply(batch(), new AbortController().signal);
    expect(first.status).toBe('applied');
    expect(second).toMatchObject({ status: 'replayed', id: first.id, receivedAt: first.receivedAt });
    expect(written).toHaveBeenCalledTimes(1);
    expect(published).toHaveBeenCalledTimes(1);
  });
});
