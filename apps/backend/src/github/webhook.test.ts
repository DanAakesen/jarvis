import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { BackendModule } from '../modules.js';
import { createGithubWebhookModule } from './webhook.js';
import type { WebhookDeliveryInput } from './webhook-delivery.js';

const secret = 'webhook-test-secret';
const sha = 'a'.repeat(40);
const timestamp = '2026-10-04T12:00:00.000Z';
const repository = { full_name: 'DanAakesen/jarvis-test-target', pushed_at: timestamp };
const apps: ReturnType<typeof buildApp>[] = [];

function payloadFor(event: string) {
  if (event === 'pull_request') return {
    repository,
    action: 'opened',
    pull_request: {
      number: 42, state: 'open', merged: false, merged_at: null, created_at: timestamp,
      head: { ref: 'feature/change', sha }, base: { ref: 'main' },
    },
  };
  if (event === 'check_run') return {
    repository,
    check_run: { head_sha: sha, status: 'completed', conclusion: 'success', pull_requests: [{ number: 42 }] },
  };
  if (event === 'workflow_run') return {
    repository,
    workflow_run: {
      id: 1_900_000_000_001, name: 'CI', event: 'pull_request', head_branch: 'feature/change', head_sha: sha,
      status: 'completed', conclusion: 'success', run_started_at: timestamp, completed_at: timestamp,
      pull_requests: [{ number: 42 }],
    },
  };
  if (event === 'push') return { repository, ref: 'refs/heads/main', after: sha };
  if (event === 'deployment_status') return {
    repository,
    deployment: { id: 1_900_000_000_002, sha, environment: 'production' },
    deployment_status: { state: 'success', created_at: timestamp },
  };
  return { action: 'opened' };
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function fixture(getSecret: () => Promise<string | undefined> = async () => secret) {
  const deliveries = new Map<string, WebhookDeliveryInput>();
  const module: BackendModule = createGithubWebhookModule({
    getSecret,
    deliveryStore: {
      async record(input) {
        if (deliveries.has(input.deliveryId)) return false;
        deliveries.set(input.deliveryId, input);
        return true;
      },
    },
  });
  const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
  const app = buildApp(config, undefined, { modules: [module] });
  apps.push(app);
  return { app, deliveries };
}

function headers(deliveryId: string, event = 'pull_request', body = Buffer.from(JSON.stringify(payloadFor(event)))) {
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  return {
    'content-type': 'application/json',
    'x-github-delivery': deliveryId,
    'x-github-event': event,
    'x-hub-signature-256': `sha256=${signature}`,
  };
}

async function deliver(
  app: ReturnType<typeof buildApp>,
  deliveryId: string,
  event?: string,
  body = Buffer.from(JSON.stringify(payloadFor(event ?? 'pull_request'))),
  signedBody = body,
) {
  return app.inject({
    method: 'POST',
    url: '/github/webhooks',
    headers: headers(deliveryId, event, signedBody),
    payload: body,
  });
}

describe('GitHub webhook receiver', () => {
  it.each(['pull_request', 'check_run', 'workflow_run', 'deployment_status', 'push'])(
    'accepts a correctly signed %s delivery without Entra authentication',
    async (event) => {
      const { app, deliveries } = fixture();
      const response = await deliver(app, 'delivery-1', event);
      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ status: 'accepted' });
      expect(deliveries.get('delivery-1')).toMatchObject({ event, outcome: 'ok', mapping: { repository: repository.full_name } });
    },
  );

  it('stores only the mapped fields from the signed payload', async () => {
    const { app, deliveries } = fixture();
    const body = Buffer.from(JSON.stringify({
      ...payloadFor('pull_request'),
      private_note: 'must not be retained or logged',
    }));
    const response = await deliver(app, 'delivery-1', 'pull_request', body);
    expect(response.statusCode).toBe(202);
    expect(deliveries.get('delivery-1')).toEqual({
      deliveryId: 'delivery-1',
      event: 'pull_request',
      outcome: 'ok',
      mapping: {
        kind: 'pull_request',
        repository: repository.full_name,
        number: 42,
        branch: 'feature/change',
        headSha: sha,
        state: 'open',
        openedAt: timestamp,
        mergedAt: null,
      },
    });
    expect(JSON.stringify(deliveries.get('delivery-1'))).not.toContain('must not be retained or logged');
  });

  it('ignores a duplicate delivery ID', async () => {
    const { app, deliveries } = fixture();
    expect((await deliver(app, 'delivery-1')).json()).toEqual({ status: 'accepted' });
    const duplicate = await deliver(app, 'delivery-1');
    expect(duplicate.statusCode).toBe(202);
    expect(duplicate.json()).toEqual({ status: 'duplicate' });
    expect(deliveries.size).toBe(1);
  });

  it('rejects a signature for different raw bytes before writing a delivery', async () => {
    const { app, deliveries } = fixture();
    const response = await deliver(
      app,
      'delivery-1',
      'push',
      Buffer.from('{"action":"closed"}'),
      Buffer.from(JSON.stringify(payloadFor('push'))),
    );
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Invalid webhook signature' });
    expect(deliveries.size).toBe(0);
  });

  it('records valid but unsupported events as ignored', async () => {
    const { app, deliveries } = fixture();
    const response = await deliver(app, 'delivery-1', 'ping');
    expect(response.json()).toEqual({ status: 'accepted' });
    expect(deliveries.get('delivery-1')).toMatchObject({ event: 'ping', outcome: 'ignored' });
  });

  it('fails closed when the Key Vault secret is unavailable', async () => {
    const getSecret = vi.fn(async () => undefined);
    const { app, deliveries } = fixture(getSecret);
    const response = await deliver(app, 'delivery-1');
    expect(response.statusCode).toBe(503);
    expect(deliveries.size).toBe(0);
    expect(getSecret).toHaveBeenCalledOnce();
  });

  it('keeps unrelated routes protected by default', async () => {
    const { app } = fixture();
    app.get('/protected-test', async () => ({ status: 'ok' }));
    const response = await app.inject({ url: '/protected-test' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('rejects malformed delivery headers', async () => {
    const { app, deliveries } = fixture();
    const response = await app.inject({
      method: 'POST',
      url: '/github/webhooks',
      headers: { 'content-type': 'application/json', ...headers('bad id'), 'x-github-delivery': 'bad id' },
      payload: Buffer.from(JSON.stringify(payloadFor('pull_request'))),
    });
    expect(response.statusCode).toBe(400);
    expect(deliveries.size).toBe(0);
  });
});
