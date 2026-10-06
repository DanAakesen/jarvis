import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CredentialStatusStore } from './credential-status.js';
import { runCodexRenewalOnce, startDailyCodexRenewalJob } from './codex-renewal.js';
import { FoundryClientError, type FoundryClient, type InvocationSnapshot } from '../foundry/client.js';

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
    updateGitHubAppStatus: vi.fn(async () => {}),
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
  afterEach(() => { vi.useRealTimers(); });
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

  it('forces manual renewal but still respects the existing lease', async () => {
    const { store, client } = fixture();
    await expect(runCodexRenewalOnce(store, client, undefined, true)).resolves.toBe('fresh');
    expect(client.startCodexRenewal).toHaveBeenCalledWith({ signal: expect.any(AbortSignal), force: true });
    vi.mocked(client.startCodexRenewal).mockClear();
    vi.mocked(store.acquireCodexRenewalLease).mockResolvedValue(false);
    await expect(runCodexRenewalOnce(store, client, undefined, true)).resolves.toBe('skipped');
    expect(client.startCodexRenewal).not.toHaveBeenCalled();
  });

  it('does not overwrite authenticated Copilot health with missing runner expiry', async () => {
    const { store, client } = fixture('completed', {
      renewed: false, expires: '2030-01-01T00:00:00.000Z', copilot: { expires: null },
    });
    await runCodexRenewalOnce(store, client);
    expect(store.updateCopilotStatus).not.toHaveBeenCalled();
  });

  it('marks an expired Copilot credential as failed', async () => {
    const { store, client } = fixture('completed', {
      renewed: false, expires: '2030-01-01T00:00:00.000Z',
      copilot: { expires: '2020-01-01T00:00:00.000Z' },
    });
    await runCodexRenewalOnce(store, client);
    expect(store.updateCopilotStatus).toHaveBeenCalledWith('failed', '2020-01-01T00:00:00.000Z', null);
  });

  it('keeps the lease until expiry when invocation completion is uncertain', async () => {
    const { store, client } = fixture('running', null);
    vi.mocked(client.status).mockRejectedValue(new Error('provider details are not surfaced'));
    await expect(runCodexRenewalOnce(store, client)).resolves.toBe('uncertain');
    expect(store.completeCodexRenewal).not.toHaveBeenCalled();
    expect(client.deleteSession).not.toHaveBeenCalled();
  });

  it.each(['startCodexRenewal', 'status'] as const)(
    'preserves credential state and reports safe diagnostics when %s throws',
    async (operation) => {
      for (const error of [
        new FoundryClientError('http', operation, 404),
        new FoundryClientError('timeout', operation),
        new FoundryClientError('aborted', operation),
        new FoundryClientError('transport', operation),
        new Error('provider-token-secret'),
      ]) {
        const { store, client } = fixture();
        vi.mocked(client[operation]).mockRejectedValue(error);
        const onError = vi.fn();
        await expect(runCodexRenewalOnce(store, client, onError)).resolves.toBe('uncertain');
        expect(store.completeCodexRenewal).not.toHaveBeenCalled();
        expect(store.updateCopilotStatus).not.toHaveBeenCalled();
        expect(client.deleteSession).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith(error instanceof FoundryClientError
          ? { kind: error.kind, statusCode: error.statusCode }
          : { kind: 'internal' });
        expect(JSON.stringify(onError.mock.calls)).not.toContain('secret');
      }
    },
  );

  it('still marks a definitive runner failure as failed and releases the lease', async () => {
    const { store, client } = fixture('failed', null);
    await expect(runCodexRenewalOnce(store, client)).resolves.toBe('failed');
    expect(store.completeCodexRenewal).toHaveBeenCalledWith(expect.any(String), 'failed', null, null, true);
    expect(client.deleteSession).toHaveBeenCalledWith('session');
  });

  it('preserves state when the operation deadline interrupts polling', async () => {
    vi.useFakeTimers();
    const { store, client } = fixture('running', null);
    const renewal = runCodexRenewalOnce(store, client);
    await vi.advanceTimersByTimeAsync(8 * 60_000);
    await expect(renewal).resolves.toBe('uncertain');
    expect(store.completeCodexRenewal).not.toHaveBeenCalled();
    expect(client.deleteSession).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries uncertainty after 15 minutes with capped backoff, then resets after success', async () => {
    vi.useFakeTimers();
    const { store, client } = fixture();
    vi.mocked(client.startCodexRenewal).mockRejectedValue(new FoundryClientError('http', 'start', 404));
    const onResult = vi.fn();
    const stop = startDailyCodexRenewalJob(store, client, onResult);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(onResult).toHaveBeenLastCalledWith('uncertain', { kind: 'http', statusCode: 404 });
      for (const minutes of [15, 30, 60, 60]) {
        const count = vi.mocked(client.startCodexRenewal).mock.calls.length;
        await vi.advanceTimersByTimeAsync(minutes * 60_000 - 1);
        expect(client.startCodexRenewal).toHaveBeenCalledTimes(count);
        await vi.advanceTimersByTimeAsync(1);
        expect(client.startCodexRenewal).toHaveBeenCalledTimes(count + 1);
      }
      vi.mocked(client.startCodexRenewal).mockResolvedValue({
        invocationId: 'invocation', sessionId: 'session', agent: 'codex', status: 'queued',
      });
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(onResult).toHaveBeenLastCalledWith('fresh', {});
      vi.mocked(client.startCodexRenewal).mockRejectedValue(new Error('private-provider-body'));
      const count = vi.mocked(client.startCodexRenewal).mock.calls.length;
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000 - 1);
      expect(client.startCodexRenewal).toHaveBeenCalledTimes(count);
      await vi.advanceTimersByTimeAsync(1);
      expect(onResult).toHaveBeenLastCalledWith('uncertain', { kind: 'internal' });
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      expect(client.startCodexRenewal).toHaveBeenCalledTimes(count + 2);
    } finally {
      stop();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries and reports a lease acquisition failure without exposing the error', async () => {
    vi.useFakeTimers();
    const { store, client } = fixture();
    vi.mocked(store.acquireCodexRenewalLease).mockRejectedValue(new Error('private-database-error'));
    const onResult = vi.fn();
    const stop = startDailyCodexRenewalJob(store, client, onResult);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(onResult).toHaveBeenLastCalledWith('uncertain', { kind: 'internal' });
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      expect(onResult).toHaveBeenCalledTimes(2);
      expect(client.startCodexRenewal).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });
});
