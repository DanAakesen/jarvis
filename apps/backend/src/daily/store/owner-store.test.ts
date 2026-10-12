import { describe, expect, it, vi } from 'vitest';
import type sql from 'mssql';
import type { FastifyRequest } from 'fastify';
import { DailyOwnerStore } from './owner-store.js';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const principal = { server: { ownerObjectId: owner }, principal: { objectId: owner }, agentPrincipal: null } as unknown as FastifyRequest;
function fixture() {
  const request = { input: vi.fn(), query: vi.fn(async () => ({ recordset: [{ revision: 2, deleted_at: 'synthetic', protein_grams: null }] })), cancel: vi.fn() };
  request.input.mockReturnValue(request);
  const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
  return { request, pool, store: DailyOwnerStore.forRequest(pool, principal) };
}
describe('inactive Daily owner persistence boundary', () => {
  it('binds only server owner and exact source keys; retains nulls and tombstones', async () => {
    const data = fixture();
    expect(await data.store.read('nutrition_meals', { id: 'synthetic' }, new AbortController().signal)).toMatchObject({ revision: 2, deleted_at: 'synthetic', protein_grams: null });
    expect(data.request.input).toHaveBeenCalledWith('owner', expect.anything(), owner);
    expect(data.request.query).toHaveBeenCalledWith(expect.stringContaining('owner_object_id = @owner'));
  });
  it('denies non-owner principal and coding runner before any SQL', () => {
    const data = fixture();
    expect(() => DailyOwnerStore.forRequest(data.pool, { ...principal, principal: { objectId: other } } as unknown as FastifyRequest)).toThrow();
    expect(() => DailyOwnerStore.forRequest(data.pool, { ...principal, principal: null, runnerPrincipal: { kind: 'jarvis-runner', objectId: other } } as unknown as FastifyRequest)).toThrow();
  });
  it('rejects caller owner/email, extra keys, SQL identifiers and overlength keys', async () => {
    const data = fixture();
    for (const key of [{ id: 'x', owner_object_id: other }, { id: 'x', owner_email: 'synthetic@example.invalid' }, { id: 'x'.repeat(257) }, {}]) {
      await expect(data.store.read('nutrition_meals', key, new AbortController().signal)).rejects.toThrow();
    }
    await expect(data.store.read('nutrition_meals; DROP TABLE daily.recovery_days' as 'nutrition_meals', { id: 'x' }, new AbortController().signal)).rejects.toThrow();
    expect(data.request.query).not.toHaveBeenCalled();
  });
  it('aborts before executing SQL', async () => {
    const data = fixture();
    const controller = new AbortController(); controller.abort();
    await expect(data.store.read('nutrition_meals', { id: 'x' }, controller.signal)).rejects.toThrow();
    expect(data.request.query).not.toHaveBeenCalled();
  });
});
