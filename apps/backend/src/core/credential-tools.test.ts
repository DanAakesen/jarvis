import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { CredentialStatus, CredentialStatusStore } from '../credentials/credential-status.js';
import type { TeamsNotificationService } from '../teams/service.js';
import type { ToolCallRecord } from './tool-calls.js';
import { coreModule } from './index.js';
import { ToolRefusal } from './tool-registry.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = {
  authorization: ['Bearer', ['e30', 'e30', 'sig'].join('.')].join(' '),
  'x-jarvis-message-id': '42',
};
const apps: ReturnType<typeof buildApp>[] = [];

function fixture(options: {
  outcome?: 'skipped' | 'fresh' | 'renewed' | 'failed' | 'uncertain';
  unavailable?: boolean;
  decline?: boolean;
  error?: string;
} = {}) {
  const credential: CredentialStatus = {
    name: 'codex-login',
    status: options.outcome === 'failed' ? 'failed' : 'ok',
    expiresAt: '2030-01-01T00:00:00.000Z',
    lastRenewedAt: '2026-10-06T00:00:00.000Z',
  };
  const store: CredentialStatusStore = {
    list: vi.fn(async () => [{ ...credential }]),
    updateGitHubAppStatus: vi.fn(async () => {}),
    acquireCodexRenewalLease: vi.fn(async () => true),
    refreshCodexRenewalLease: vi.fn(async () => true),
    updateCopilotStatus: vi.fn(async () => {}),
    completeCodexRenewal: vi.fn(async () => {}),
  };
  const renew = vi.fn(async () => {
    if (options.error) throw new Error(options.error);
    return options.outcome ?? 'renewed';
  });
  const runConfirmed = vi.fn(async (
    _kind: string,
    _summary: string,
    action: () => Promise<unknown>,
  ) => {
    if (options.decline) throw new ToolRefusal('Dan rejected the request.');
    return action();
  });
  const record = vi.fn<(call: ToolCallRecord) => Promise<void>>(async () => {});
  const app = buildApp(config, undefined, {
    modules: [coreModule],
    auth: async () => ({
      objectId: config.auth.ownerObjectId,
      tenantId: config.auth.tenantId,
      displayName: 'Dan',
    }),
    ...(options.unavailable ? {} : {
      credentialStatusStore: store,
      renewCodexCredential: renew,
    }),
    ...(!options.unavailable ? {
      teamsNotifications: { runConfirmed } as unknown as TeamsNotificationService,
    } : {}),
    toolCallStore: { record },
  });
  apps.push(app);
  return { app, credential, store, renew, runConfirmed, record };
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('renew_credential tool', () => {
  it('confirms renewal, relays the outcome and status, and redacts the audit record', async () => {
    const { app, credential, renew, runConfirmed, record } = fixture();
    const response = await app.inject({
      method: 'POST', url: '/tools/renew_credential', headers, payload: { name: 'codex-login' },
    });

    expect(response.json()).toMatchObject({
      tool: 'renew_credential',
      outcome: 'ok',
      result: { outcome: 'renewed', credential, nextStep: null },
      confirmation: 'Jarvis Codex login renewed.',
    });
    expect(runConfirmed).toHaveBeenCalledWith(
      'other', 'Renew the Jarvis Codex login.', expect.any(Function), expect.any(AbortSignal),
    );
    expect(renew).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'renew_credential',
      arguments: { redacted: true },
      result: { redacted: true },
      outcome: 'ok',
    }));
    expect(response.body).not.toContain('token');
  });

  it('returns the human sign-in step when renewal fails', async () => {
    const { app } = fixture({ outcome: 'failed' });
    const response = await app.inject({
      method: 'POST', url: '/tools/renew_credential', headers, payload: { name: 'codex-login' },
    });

    expect(response.json()).toMatchObject({
      outcome: 'ok',
      result: {
        outcome: 'failed',
        nextStep: 'Sign in to the Jarvis-only Codex account again, then retry.',
      },
      confirmation: 'Codex login renewal failed. Sign in to the Jarvis-only Codex account again, then retry.',
    });
  });

  it('refuses unknown credential names without starting renewal', async () => {
    const { app, renew, runConfirmed } = fixture();
    const response = await app.inject({
      method: 'POST', url: '/tools/renew_credential', headers, payload: { name: 'copilot-token' },
    });

    expect(response.json()).toMatchObject({ tool: 'renew_credential', outcome: 'refused' });
    expect(renew).not.toHaveBeenCalled();
    expect(runConfirmed).not.toHaveBeenCalled();
  });

  it('refuses when renewal dependencies are unavailable', async () => {
    const { app, renew, runConfirmed } = fixture({ unavailable: true });
    const response = await app.inject({
      method: 'POST', url: '/tools/renew_credential', headers, payload: { name: 'codex-login' },
    });

    expect(response.json()).toMatchObject({ outcome: 'refused' });
    expect(response.json().result.refused).toContain('unavailable');
    expect(renew).not.toHaveBeenCalled();
    expect(runConfirmed).not.toHaveBeenCalled();
  });

  it('makes no renewal or status change when Dan declines Now confirmation', async () => {
    const { app, credential, store, renew, record } = fixture({ decline: true });
    const response = await app.inject({
      method: 'POST', url: '/tools/renew_credential', headers, payload: { name: 'codex-login' },
    });

    expect(response.json()).toMatchObject({ outcome: 'refused' });
    expect(renew).not.toHaveBeenCalled();
    expect(store.list).not.toHaveBeenCalled();
    expect(credential.status).toBe('ok');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      arguments: { redacted: true }, result: { redacted: true }, outcome: 'refused',
    }));
  });

  it('sanitizes unexpected renewal errors from the result and tool-call record', async () => {
    const secretLikeError = 'codex-token-secret-value';
    const { app, record } = fixture({ error: secretLikeError });
    const response = await app.inject({
      method: 'POST', url: '/tools/renew_credential', headers, payload: { name: 'codex-login' },
    });

    expect(response.json()).toMatchObject({ outcome: 'refused' });
    expect(response.body).not.toContain(secretLikeError);
    expect(JSON.stringify(record.mock.calls)).not.toContain(secretLikeError);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      arguments: { redacted: true }, result: { redacted: true },
    }));
  });
});
