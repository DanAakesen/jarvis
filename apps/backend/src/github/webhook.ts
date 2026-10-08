import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BackendModule } from '../modules.js';
import type { NowFeedStatusKind } from '../core/now.js';
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
  readonly isTrackedRepository?: (repository: string) => boolean;
  readonly onMapping?: (mapping: GithubWebhookMapping) => Promise<void>;
  readonly readWorkflowRun?: (repository: string, runId: number) => Promise<{ workflowId: number; cancelled: boolean }>;
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

function voiceStatusKind(event: string, payload: unknown, mapping: GithubWebhookMapping | undefined): NowFeedStatusKind | undefined {
  if (mapping?.kind === 'deployment_status' && mapping.status === 'failure') return 'deployment_failed';
  if (event === 'pull_request' && mapping?.kind === 'pull_request' &&
      payload !== null && typeof payload === 'object' && !Array.isArray(payload) &&
      (payload as Record<string, unknown>).action === 'ready_for_review') return 'pull_request_ready';
  return undefined;
}

function repositoryName(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const repository = (payload as Record<string, unknown>).repository;
  if (repository === null || typeof repository !== 'object' || Array.isArray(repository)) return undefined;
  const name = (repository as Record<string, unknown>).full_name;
  return typeof name === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(name) ? name : undefined;
}

function invalidatesFactoryBoard(event: string): boolean {
  return event === 'issues' || event === 'pull_request' || event === 'check_run' || event === 'workflow_run';
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
        const repository = repositoryName(payload);
        const invalidatesBoard = invalidatesFactoryBoard(event);
        const trackedBoardRepository = repository !== undefined &&
          (!options.isTrackedRepository || options.isTrackedRepository(repository));
        let mapping = acceptedEvents.has(event) ? mapGithubWebhook(event, payload) : undefined;
        if (!mapping || (options.isTrackedRepository && !options.isTrackedRepository(mapping.repository))) {
          if (invalidatesBoard && trackedBoardRepository) app.factoryBoardCache.invalidateAll();
          return reply.code(202).send({ status: 'ignored' });
        }
        if (mapping.kind === 'deployment_status' && mapping.status === 'failure' &&
            mapping.workflowRunId && options.readWorkflowRun) {
          try {
            const workflow = await options.readWorkflowRun(mapping.repository, mapping.workflowRunId);
            if (workflow.cancelled) return reply.code(202).send({ status: 'ignored' });
            mapping = { ...mapping, workflowId: workflow.workflowId };
          } catch {
            request.log.error('github.webhook_workflow_unavailable');
            return reply.code(503).send({ error: 'Webhook processing unavailable' });
          }
        }
        const statusKind = voiceStatusKind(event, payload, mapping);
        let inserted: boolean;
        try {
          inserted = await options.deliveryStore.record({
            deliveryId,
            event,
            outcome: 'ok',
            mapping,
          });
          if (inserted) {
            app.nowEventHub.publish({ type: 'refresh' });
            if (invalidatesBoard && trackedBoardRepository) app.factoryBoardCache.invalidateAll();
          }
        } catch {
          request.log.error('github.webhook_delivery_store_failed');
          return reply.code(503).send({ error: 'Webhook storage unavailable' });
        }
        try {
          await options.onMapping?.(mapping);
        } catch {
          request.log.error('github.webhook_mapping_failed');
          return reply.code(503).send({ error: 'Webhook processing unavailable' });
        }
        if (inserted && statusKind) app.nowEventHub.publish({ type: 'status', kind: statusKind });
        return reply.code(202).send({ status: inserted ? 'accepted' : 'duplicate' });
      });
    },
  };
}
