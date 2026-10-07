import { describe, expect, it, vi } from 'vitest';
import { createSystemStatusReader, summarizeSystemStatus } from './system-status.js';

describe('system status reader', () => {
  it('caches the subsystem checks and reports all requested entries', async () => {
    let now = Date.parse('2026-10-07T12:00:00.000Z');
    const database = vi.fn(async () => ({ status: 'ok' as const, details: { configured: true } }));
    const reader = createSystemStatusReader({ database }, 'a'.repeat(40), () => now, 1_000);

    const first = await reader.read();
    const second = await reader.read();

    expect(second).toBe(first);
    expect(database).toHaveBeenCalledOnce();
    expect(first.entries).toHaveLength(11);
    expect(first.entries[0]).toMatchObject({ id: 'database', status: 'ok', checkedAt: first.checkedAt });
    expect(first.entries.find(({ id }) => id === 'deployed_commit')).toMatchObject({
      status: 'ok', details: { commit: 'a'.repeat(40) },
    });
    expect(first.entries.find(({ id }) => id === 'last_error')).toMatchObject({
      status: 'ok', details: { occurredAt: null, route: null, statusCode: null },
    });
    expect(summarizeSystemStatus(first)).toBe('System status: 2 ok, 0 degraded, 0 down, 8 unknown.');

    now += 1_001;
    await reader.read();
    expect(database).toHaveBeenCalledTimes(2);
  });

  it('makes probe failures visible without returning provider error text', async () => {
    const reader = createSystemStatusReader({
      google: async () => { throw new Error('private provider response'); },
    }, undefined, () => Date.parse('2026-10-07T12:00:00.000Z'));
    const status = await reader.read();

    expect(status.entries.find(({ id }) => id === 'google')).toMatchObject({
      status: 'down', details: { reason: 'check_failed' },
    });
    expect(JSON.stringify(status)).not.toContain('private provider response');
  });

  it('invalidates the cached snapshot and records only a safe route template for server errors', async () => {
    let now = Date.parse('2026-10-07T12:00:00.000Z');
    const reader = createSystemStatusReader({}, undefined, () => now);
    const before = await reader.read();

    reader.recordError('/private/:id', 500);
    now += 1_000;
    const after = await reader.read();

    expect(after).not.toBe(before);
    expect(after.entries.find(({ id }) => id === 'last_error')).toMatchObject({
      status: 'degraded',
      details: {
        occurredAt: new Date(now - 1_000).toISOString(),
        route: '/private/:id',
        statusCode: 500,
      },
    });
    reader.recordError('/private?token=secret', 404);
    expect((await reader.read()).entries.find(({ id }) => id === 'last_error')).toMatchObject({
      status: 'degraded', details: { route: '/private/:id' },
    });
  });
});
