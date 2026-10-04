import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BackendModule } from '../modules.js';
import { mapGithubWebhook, type GithubWebhookMapping } from './webhook-mapping.js';
import type { WebhookDeliveryStore } from './webhook-delivery.js';

const acceptedEvents = new Set([
  'pull_request',
  'check_run',
  'workflow_run',
  'deployment_status',
  'push',
]);

interface WebhookOptions {
  readonly deliveryStore: WebhookDeliveryStore | null;
  readonly getSecret: () => Promise<string | undefined>;
  readonly onWorkflowRun?: (mapping: Extract<GithubWebhookMapping, { kind: 'workflow_run' }>) => Promise<void>;
}

function uniqueHeader(request: { raw: { rawHeaders: string[] }; headers: Record<string, unknown> }, name: string): string | undefined {
  const occurrences = request.raw.rawHeaders.filter((_value, index) =>
    index % 2 === 0 && request.raw.rawHeaders[index]?.toLowerCase() === name,
  ).length;
  const value = request.headers[name];
  return occurrences === 1 && typeof value === 'string' ? value : undefined;
}

function validSignature(signature: string, body: Buffer, secret: string): boolean {
  if (!/^sha256=[\da-f]{64}$/u.test(signature)) return false;
  const supplied = Buffer.from(signature.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(supplied, expected);
}

export function createGithubWebhookModule(options: WebhookOptions): BackendModule {
  return {
    id: 'github-webhook',
    tools: [],
    registerRoutes: async (app) => {
      app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
        done(null, body);
      });

      app.post('/github/webhooks', {
        config: { githubWebhook: true },
      }, async (request, reply) => {
        if (!options.deliveryStore) return reply.code(503).send({ error: 'Webhook storage unavailable' });

        const deliveryId = uniqueHeader(request, 'x-github-delivery');
        const event = uniqueHeader(request, 'x-github-event');
        const signature = uniqueHeader(request, 'x-hub-signature-256');
        if (!deliveryId || !/^[\da-zA-Z._:-]{1,100}$/u.test(deliveryId) ||
            !event || !/^[a-z_]{1,64}$/u.test(event) ||
            !signature || !Buffer.isBuffer(request.body)) {
          return reply.code(400).send({ error: 'Invalid webhook request' });
        }

        let secret: string | undefined;
        try {
          secret = await options.getSecret();
        } catch {
          request.log.warn('github.webhook_secret_unavailable');
        }
        if (!secret) return reply.code(503).send({ error: 'Webhook verification unavailable' });
        if (!validSignature(signature, request.body, secret)) {
          request.log.warn('github.webhook_signature_invalid');
          return reply.code(401).send({ error: 'Invalid webhook signature' });
        }

        let payload: unknown;
        try {
          payload = JSON.parse(request.body.toString('utf8'));
        } catch {
          return reply.code(400).send({ error: 'Invalid webhook payload' });
        }
        const mapping = acceptedEvents.has(event) ? mapGithubWebhook(event, payload) : undefined;
        try {
          const inserted = await options.deliveryStore.record({
            deliveryId,
            event,
            outcome: mapping ? 'ok' : 'ignored',
            ...(mapping ? { mapping } : {}),
          });
          if (mapping?.kind === 'workflow_run' && options.onWorkflowRun) {
            try {
              await options.onWorkflowRun(mapping);
            } catch {
              request.log.error('github.checks_loop_failed');
              return reply.code(503).send({ error: 'Webhook processing unavailable' });
            }
          }
          return reply.code(202).send({ status: inserted ? 'accepted' : 'duplicate' });
        } catch {
          request.log.error('github.webhook_delivery_store_failed');
          return reply.code(503).send({ error: 'Webhook storage unavailable' });
        }
      });
    },
  };
}
