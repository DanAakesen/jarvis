import type sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createAwayModeStore } from './away-mode-store.js';

describe('SQL away-mode store', () => {
  it('skips SQL when a cached presence observation leaves state unchanged', async () => {
    const state = {
      mode: 'present',
      source: 'manual',
      changedAt: null,
    };
    const query = vi.fn(async () => ({
      recordset: [
        { key: 'away.mode.state', value: JSON.stringify(state) },
        { key: 'away.presence.timer', value: JSON.stringify('2026-10-06T12:00:00.000Z') },
      ],
    }));
    const request = { input: vi.fn(), query };
    request.input.mockReturnValue(request);
    const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
    const store = createAwayModeStore(pool);

    await store.read();
    await expect(store.observePresence(true, new Date('2026-10-06T12:01:00.000Z'))).resolves.toEqual(state);

    expect(pool.request).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();
  });

  it('reads legacy away settings as the matching presence mode', async () => {
    const legacy = {
      away: true,
      source: 'manual',
      changedAt: '2026-10-06T12:00:00.000Z',
      presenceAwaySince: null,
    };
    const query = vi.fn(async () => ({
      recordset: [{ key: 'away.mode.state', value: JSON.stringify(legacy) }],
    }));
    const request = { input: vi.fn(), query };
    request.input.mockReturnValue(request);
    const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;

    await expect(createAwayModeStore(pool).read()).resolves.toEqual({
      mode: 'away',
      source: 'manual',
      changedAt: legacy.changedAt,
    });
  });
});
