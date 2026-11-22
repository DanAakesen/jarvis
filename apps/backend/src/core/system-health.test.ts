import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getSystemHealth, SystemHealthDiagnostics } from './system-health.js';

const now = Date.parse('2026-11-21T12:00:00.000Z');

function appWithLastError(checkedAt: string): FastifyInstance {
  return {
    systemStatusReader: {
      peek: () => ({ checkedAt, entries: [{ id: 'last_error', status: 'ok', checkedAt, details: { occurredAt: null, recent: false } }] }),
    },
    systemHealthDiagnostics: new SystemHealthDiagnostics(() => now),
    backgroundJobs: { recentFailures: async () => ({ count: 0, retryable: false }) },
    jarvisTools: { get: () => undefined },
    credentialStatusStore: null, projectStore: null, releaseViewStore: null, renewCodexCredential: null, ownerInteractions: null,
  } as unknown as FastifyInstance;
}

describe('get_system_health freshness', () => {
  const lastError = async (checkedAt: string) => (await getSystemHealth(appWithLastError(checkedAt), new AbortController().signal, now))
    .components.find((component) => component.id === 'last_error');

  it('keeps the last-error check, which is stamped when it is read, healthy when it is a few milliseconds after the lookup began', async () => {
    expect((await lastError(new Date(now + 3).toISOString()))?.status).toBe('ok');
  });

  it('still calls a check from well in the future unknown', async () => {
    expect((await lastError(new Date(now + 10 * 60_000).toISOString()))?.status).toBe('unknown');
  });
});
