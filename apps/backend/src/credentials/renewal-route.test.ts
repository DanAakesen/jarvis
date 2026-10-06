import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier } from '../auth/verify.js';
import type { CredentialStatus, CredentialStatusStore } from './credential-status.js';
import type { FoundryClient, InvocationSnapshot } from '../foundry/client.js';
import { runCodexRenewalOnce } from './codex-renewal.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: [['Bear', 'er'].join(''), 'a.b.c'].join(' ') };
const url = '/settings/credentials/codex-login/renew';
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function fixture(auth: TokenVerifier = async () => ({
  objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan',
})) {
  const credential: CredentialStatus = {
    name: 'codex-login', status: 'failed', expiresAt: null, lastRenewedAt: null,
  };
  let leased = false;
  const store: CredentialStatusStore = {
    list: vi.fn(async () => [{ ...credential }]),
    updateCopilotStatus: vi.fn(async () => {}),
    updateGitHubAppStatus: vi.fn(async () => {}),
    acquireCodexRenewalLease: vi.fn(async () => {
      if (leased) return false;
      leased = true;
      return true;
    }),
    refreshCodexRenewalLease: vi.fn(async () => true),
    completeCodexRenewal: vi.fn(async (_owner, status, expiresAt, lastRenewedAt) => {
      Object.assign(credential, { status, expiresAt, lastRenewedAt });
      leased = false;
    }),
  };
  const snapshot = {
    status: 'completed', error: null,
    result: { renewed: true, expires_after: '2030-01-01T00:00:00.000Z', last_refresh_after: '2026-10-06T00:00:00.000Z' },
  } as InvocationSnapshot;
  const client: Pick<FoundryClient, 'startCodexRenewal' | 'status' | 'deleteSession'> = {
    startCodexRenewal: vi.fn(async () => ({
      invocationId: 'invocation', sessionId: 'session', agent: 'codex', status: 'queued',
    })),
    status: vi.fn(async () => snapshot),
    deleteSession: vi.fn(async () => {}),
  };
  const app = buildApp(config, undefined, {
    auth, credentialStatusStore: store,
    renewCodexCredential: () => runCodexRenewalOnce(store, client, undefined, true),
  });
  apps.push(app);
  return { app, store, client, credential, snapshot };
}

describe('credential repair API', () => {
  it('forces renewal and returns the persisted status, not provider results', async () => {
    const { app, client, credential } = fixture();
    const response = await app.inject({ method: 'POST', url, headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ credential });
    expect(credential.status).toBe('ok');
    expect(client.startCodexRenewal).toHaveBeenCalledWith({ force: true, signal: expect.any(AbortSignal) });
    expect(response.body).not.toContain('invocation');
  });

  it('rejects anonymous, non-owner, agent and runner identities before starting renewal', async () => {
    const { app, client } = fixture();
    expect((await app.inject({ method: 'POST', url })).statusCode).toBe(401);
    expect(client.startCodexRenewal).not.toHaveBeenCalled();
    for (const principal of [
      { objectId: 'other-user', tenantId: config.auth.tenantId, displayName: 'Other' },
      { kind: 'jarvis-agent' as const, objectId: 'agent', tenantId: config.auth.tenantId },
      { kind: 'jarvis-runner' as const, objectId: 'runner', tenantId: config.auth.tenantId },
    ]) {
      const denied = fixture(async () => principal);
      expect((await denied.app.inject({ method: 'POST', url, headers })).statusCode).toBe(403);
      expect(denied.client.startCodexRenewal).not.toHaveBeenCalled();
    }
  });

  it.each(['copilot-token', 'github-app', 'github-app-key', 'unknown'])(
    'rejects unsupported repair for %s', async (name) => {
      const { app, client } = fixture();
      expect((await app.inject({ method: 'POST', url: `/settings/credentials/${name}/renew`, headers })).statusCode).toBe(400);
      expect(client.startCodexRenewal).not.toHaveBeenCalled();
    },
  );

  it('returns busy without starting a second concurrent renewal', async () => {
    const { app, client, snapshot } = fixture();
    let finish!: (value: InvocationSnapshot) => void;
    let started!: () => void;
    const polling = new Promise<void>((resolve) => { started = resolve; });
    vi.mocked(client.status).mockImplementation(async () => {
      started();
      return new Promise((resolve) => { finish = resolve; });
    });
    const first = app.inject({ method: 'POST', url, headers });
    await polling;
    const second = await app.inject({ method: 'POST', url, headers });
    expect(second.statusCode).toBe(409);
    expect(second.json().credential.status).toBe('failed');
    expect(client.startCodexRenewal).toHaveBeenCalledOnce();
    finish(snapshot);
    expect((await first).statusCode).toBe(200);
  });

  it.each(['failed', 'uncertain'] as const)('reports %s without false success or provider details', async (outcome) => {
    const { app, client, snapshot } = fixture();
    if (outcome === 'failed') snapshot.status = 'failed';
    else vi.mocked(client.status).mockRejectedValue(new Error('private-provider-detail'));
    const response = await app.inject({ method: 'POST', url, headers });
    expect(response.statusCode).toBe(outcome === 'failed' ? 502 : 503);
    expect(response.json().credential.status).toBe('failed');
    expect(response.body).not.toContain('private-provider-detail');
  });

  it('returns unavailable without configured storage or runner', async () => {
    const app = buildApp(config, undefined, {
      auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan' }),
    });
    apps.push(app);
    expect((await app.inject({ method: 'POST', url, headers })).statusCode).toBe(503);
  });
});
