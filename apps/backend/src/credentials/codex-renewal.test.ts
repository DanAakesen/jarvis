import { describe, expect, it, vi } from 'vitest';
import type { CredentialStatusStore } from './credential-status.js';
import { runCodexRenewalOnce } from './codex-renewal.js';
import type { FoundryClient, InvocationSnapshot } from '../foundry/client.js';

function fixture(status = 'completed', result: Record<string, unknown> | null = {
  renewed: false,
  reason: 'fresh',
  expires: '2030-01-01T00:00:00.000Z',
  copilot: { expires: '2030-01-01T00:00:00.000Z', last_renewed: '2026-10-03T00:00:00.000Z' },
}): {
  store: CredentialStatusStore;
  client: Pick<FoundryClient, 'startCodexRenewal' | 'status' | 'deleteSession'>;
} {
  const store: CredentialStatusStore = {
    list: vi.fn(async () => []),
    acquireCodexRenewalLease: vi.fn(async () => true),
    refreshCodexRenewalLease: vi.fn(async () => true),
    updateCopilotStatus: vi.fn(async () => {}),
    completeCodexRenewal: vi.fn(async () => {}),
  };
  const snapshot = {
    invocationId: 'invocation',
    sessionId: 'session',
    agent: 'codex',
    status,
    startedAt: 1,
    finishedAt: 2,
    events: [],
    result,
    error: null,
  } as InvocationSnapshot;
  const client: Pick<FoundryClient, 'startCodexRenewal' | 'status' | 'deleteSession'> = {
    startCodexRenewal: vi.fn(async () => ({
      invocationId: 'invocation', sessionId: 'session', agent: 'codex', status: 'queued',
    })),
    status: vi.fn(async () => snapshot),
    deleteSession: vi.fn(async () => {}),
  };
  return { store, client };
}

describe('Codex renewal job', () => {
  it('renews or records a fresh credential and releases the lease after a terminal result', async () => {
    const { store, client } = fixture();
    await expect(runCodexRenewalOnce(store, client)).resolves.toBe('fresh');
    expect(store.acquireCodexRenewalLease).toHaveBeenCalledWith(expect.any(String), 900);
    expect(store.completeCodexRenewal).toHaveBeenCalledWith(
      expect.any(String), 'ok', '2030-01-01T00:00:00.000Z', null, true,
    );
    expect(store.updateCopilotStatus).toHaveBeenCalledWith(
      'ok', '2030-01-01T00:00:00.000Z', '2026-10-03T00:00:00.000Z',
    );
    expect(client.deleteSession).toHaveBeenCalledWith('session');
  });

  it('does not start Foundry work when a Codex task already owns the credential', async () => {
    const { store, client } = fixture();
    vi.mocked(store.acquireCodexRenewalLease).mockResolvedValue(false);
    await expect(runCodexRenewalOnce(store, client)).resolves.toBe('skipped');
    expect(client.startCodexRenewal).not.toHaveBeenCalled();
    expect(store.completeCodexRenewal).not.toHaveBeenCalled();
  });

  it('keeps the lease until expiry when invocation completion is uncertain', async () => {
    const { store, client } = fixture('running', null);
    vi.mocked(client.status).mockRejectedValue(new Error('provider details are not surfaced'));
    await expect(runCodexRenewalOnce(store, client)).resolves.toBe('uncertain');
    expect(store.completeCodexRenewal).toHaveBeenCalledWith(
      expect.any(String), 'failed', null, null, false,
    );
    expect(client.deleteSession).not.toHaveBeenCalled();
  });
});
