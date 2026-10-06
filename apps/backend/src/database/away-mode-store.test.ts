import type sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createAwayModeStore } from './away-mode-store.js';

describe('SQL away-mode store', () => {
  it('reads legacy Teams-presence state as manual away state', async () => {
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

    await expect(createAwayModeStore(pool).read()).resolves.toEqual({
      mode: 'away',
      source: 'manual',
      changedAt: state.changedAt,
    });
    expect(pool.request).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();
  });

  it('reads legacy boolean settings as the matching presence mode', async () => {
    const legacy = {
      away: false,
      source: null,
      changedAt: null,
      presenceAwaySince: null,
    };
    const query = vi.fn(async () => ({ recordset: [{ value: JSON.stringify(legacy) }] }));
    const request = { input: vi.fn(), query };
    request.input.mockReturnValue(request);
    const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;

    await expect(createAwayModeStore(pool).read()).resolves.toEqual({
      mode: 'present',
      source: 'manual',
      changedAt: null,
    });
  });
});
