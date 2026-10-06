import type sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createAwayModeStore } from './away-mode-store.js';

describe('SQL away-mode store', () => {
  it('reads legacy Teams presence state as manual away state', async () => {
    const state = {
      away: true,
      source: 'teams_presence',
      changedAt: '2026-10-06T12:00:00.000Z',
      presenceAwaySince: '2026-10-06T12:00:00.000Z',
    };
    const query = vi.fn(async () => ({ recordset: [{ value: JSON.stringify(state) }] }));
    const request = { input: vi.fn(), query };
    request.input.mockReturnValue(request);
    const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
    const store = createAwayModeStore(pool);

    await expect(store.read()).resolves.toEqual({
      away: true,
      source: null,
      changedAt: '2026-10-06T12:00:00.000Z',
    });

    expect(pool.request).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();
  });
});
