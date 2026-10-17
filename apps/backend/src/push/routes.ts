import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { FastifyBaseLogger, FastifyInstance, FastifyPluginAsync, FastifyTypeProviderDefault } from 'fastify';
import type { PushStore, ProactiveItem, StoredPushSubscription } from '../database/push-store.js';
import { generateVapidKeyPair, sendWebPush, type PushSendOrigin, type VapidKeyPair, type WebPushResult, type WebPushTransport } from './webpush.js';
import { validatePushEndpoint, validatePushSubscription } from './validation.js';

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
const testIntervalMs = 10_000;
const testDayMs = 24 * 60 * 60_000;
const testDailyLimit = 30;

export interface PushRouteDependencies {
  readonly store: PushStore;
  readonly publicOrigin: string;
  readonly now?: () => number;
  readonly transport?: WebPushTransport;
  readonly generateKeys?: () => VapidKeyPair;
  readonly send?: (
    subscription: StoredPushSubscription,
    payload: Buffer,
    keys: VapidKeyPair,
    publicOrigin: string,
    origin: PushSendOrigin,
    transport: WebPushTransport,
  ) => Promise<WebPushResult>;
}

function createRoutes<Logger extends FastifyBaseLogger>(
  dependencies: PushRouteDependencies,
): FastifyPluginAsync<Record<never, never>, Server, FastifyTypeProviderDefault, Logger> {
  const now = dependencies.now ?? Date.now;
  const transport = dependencies.transport ?? {
    fetch,
    now,
    sleep: (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
  };
  const send = dependencies.send ?? sendWebPush;
  const getKeys = dependencies.generateKeys ?? generateVapidKeyPair;
  const testTimes = new Map<string, number[]>();
  let keyPromise: Promise<VapidKeyPair> | undefined;

  const vapidKeys = (): Promise<VapidKeyPair> => {
    if (keyPromise) return keyPromise;
    const pending = (async () => {
      const stored = await dependencies.store.readVapidKey();
      if (stored) return stored;
      const generated = getKeys();
      try {
        await dependencies.store.insertVapidKey(generated);
      } catch {
        // A concurrent process may have inserted the singleton key first.
      }
      const winner = await dependencies.store.readVapidKey();
      if (!winner) throw new Error('Push signing key is unavailable');
      return winner;
    })().catch((error: unknown) => {
      if (keyPromise === pending) keyPromise = undefined;
      throw error;
    });
    keyPromise = pending;
    return pending;
  };

  function claimTest(owner: string): boolean {
    const timestamp = now();
    const recent = (testTimes.get(owner) ?? []).filter((time) => timestamp - time < testDayMs);
    if ((recent.length > 0 && timestamp - recent[recent.length - 1]! < testIntervalMs) ||
        recent.length >= testDailyLimit) {
      testTimes.set(owner, recent);
      return false;
    }
    recent.push(timestamp);
    testTimes.set(owner, recent);
    return true;
  }

  return async (app) => {
    app.get('/push/config', async () => ({ publicKey: (await vapidKeys()).publicKey }));

    app.put('/push/subscription', async (request, reply) => {
      const subscription = validatePushSubscription(request.body);
      if (!subscription) return reply.code(400).send({ error: 'invalid_subscription' });
      const owner = request.principal?.objectId;
      if (!owner) return reply.code(401).send({ error: 'Unauthorized' });
      await dependencies.store.upsertSubscription(owner, subscription);
      return reply.code(204).send();
    });

    app.delete('/push/subscription', async (request, reply) => {
      const body = request.body as { endpoint?: unknown } | null;
      const endpoint = validatePushEndpoint(body?.endpoint);
      if (!endpoint) return reply.code(400).send({ error: 'invalid_subscription' });
      const owner = request.principal?.objectId;
      if (!owner) return reply.code(401).send({ error: 'Unauthorized' });
      await dependencies.store.deleteSubscription(owner, endpoint);
      return reply.code(204).send();
    });

    app.post('/push/test', async (request, reply) => {
      const owner = request.principal?.objectId;
      if (!owner) return reply.code(401).send({ error: 'Unauthorized' });
      const subscriptions = await dependencies.store.listSubscriptions(owner);
      if (subscriptions.length === 0) return reply.code(409).send({ error: 'no_subscription' });
      if (!claimTest(owner)) return reply.code(429).send({ error: 'rate_limited' });
      const keys = await vapidKeys();
      const item = await dependencies.store.createTestItem(owner);
      const payload = Buffer.from(JSON.stringify({
        v: 1,
        title: 'Jarvis',
        body: 'New item',
        itemId: item.id,
      }));
      const deliveries = await Promise.all(subscriptions.map(async (subscription) => {
        const result = await send(subscription, payload, keys, dependencies.publicOrigin, 'user_test', transport);
        if (result.removed) await dependencies.store.removeSubscription(subscription.id);
        else await dependencies.store.recordSubscriptionResult(subscription.id, result.accepted);
        return result;
      }));
      const accepted = deliveries.filter(({ accepted: didAccept }) => didAccept).length;
      const statusCode = deliveries.find(({ accepted: didAccept }) => didAccept)?.statusCode ??
        deliveries.find(({ statusCode: status }) => status !== null)?.statusCode ?? null;
      await dependencies.store.updateItemDelivery(item.id, accepted > 0 ? 'accepted' : 'failed', statusCode);
      return reply.code(200).send({
        itemId: item.id,
        delivery: {
          attempted: deliveries.reduce((total, { attempted }) => total + attempted, 0),
          accepted,
          failed: deliveries.length - accepted,
        },
      });
    });

    app.get<{ Params: { id: string } }>('/proactive/items/:id', async (request, reply) => {
      const owner = request.principal?.objectId;
      if (!owner) return reply.code(401).send({ error: 'Unauthorized' });
      if (!uuidPattern.test(request.params.id)) return reply.code(404).send({ error: 'not_found' });
      const item: ProactiveItem | undefined = await dependencies.store.readItem(owner, request.params.id);
      if (!item) return reply.code(404).send({ error: 'not_found' });
      return {
        id: item.id,
        kind: item.kind,
        title: item.title,
        body: item.body,
        createdAt: item.createdAt,
      };
    });
  };
}

export function registerPushRoutes<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>,
  enabled: boolean,
  dependencies: () => PushRouteDependencies,
): void {
  if (!enabled) return;
  app.register(createRoutes<Logger>(dependencies()));
}
