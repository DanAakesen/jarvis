import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { ActivityRegistration, ActivityRegistrationStore } from '../database/activitykit-store.js';
import type { ActivityContentState, ActivityPhase, ActivityPushSender } from './activitykit.js';

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
const activityIdPattern = /^[a-z0-9-]{1,128}$/iu;
type Resource = Pick<ActivityRegistration, 'kind' | 'resourceId'>;
export interface ActivityKitServices {
  store: ActivityRegistrationStore;
  sender: ActivityPushSender;
}

export function validateActivityRegistration(body: unknown): ActivityRegistration | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return;
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['activityId', 'kind', 'resourceId', 'pushToken', 'language'].includes(key)) ||
      typeof input.activityId !== 'string' || !activityIdPattern.test(input.activityId) ||
      typeof input.resourceId !== 'string' || typeof input.pushToken !== 'string' ||
      !/^(?:[0-9a-f]{2}){32,256}$/iu.test(input.pushToken) ||
      (input.language !== undefined && input.language !== 'da' && input.language !== 'en')) return;
  if (input.kind !== 'background_job' && input.kind !== 'factory_task') return;
  if (input.kind === 'background_job' ? !uuid.test(input.resourceId) :
    !/^[1-9]\d{0,18}$/u.test(input.resourceId) || BigInt(input.resourceId) > 9223372036854775807n) return;
  return {
    activityId: input.activityId,
    kind: input.kind,
    resourceId: input.resourceId.toLowerCase(),
    pushToken: input.pushToken.toLowerCase(),
    language: input.language ?? 'da',
  };
}

function validateTaskActivityRegistration(body: unknown): ActivityRegistration | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return;
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((name) => !['taskID', 'activityID', 'pushToken', 'language'].includes(name)) ||
      typeof input.taskID !== 'string' || typeof input.pushToken !== 'string' ||
      typeof input.activityID !== 'string' || (input.language !== 'da' && input.language !== 'en')) return;
  return validateActivityRegistration({
    kind: uuid.test(input.taskID) ? 'background_job' : 'factory_task',
    resourceId: input.taskID,
    activityId: input.activityID,
    pushToken: input.pushToken,
    language: input.language,
  });
}

export function activityContent(phase: ActivityPhase, language: 'da' | 'en'): ActivityContentState {
  const states = {
    da: { running: 'Arbejder', waiting: 'Venter', done: 'Færdig', failed: 'Mislykkedes', cancelled: 'Annulleret' },
    en: { running: 'Working', waiting: 'Waiting', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' },
  };
  // Task descriptions and provider errors can contain private details; push only fixed status copy.
  return { state: states[language][phase], activity: null, phase };
}

export function registerActivityKitRoutes<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>,
  services?: ActivityKitServices,
): void {
  const owner = app.ownerObjectId;
  const controller = new AbortController();
  const known = new Map<string, Resource>();
  const terminal = new Set<string>();
  const retries = new Map<string, { count: number; at: number }>();
  const retiredTokens = new Map<string, string>();
  const pending = new Map<string, Resource>();
  let active: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let stopping = false;
  const key = (resource: Resource) => `${resource.kind}:${resource.resourceId}`;
  async function refreshKnown() {
    const registrations = await services!.store.list(owner);
    known.clear();
    for (const registration of registrations) known.set(key(registration), registration);
    for (const resourceKey of pending.keys()) if (!known.has(resourceKey)) pending.delete(resourceKey);
    for (const resourceKey of retries.keys()) if (!known.has(resourceKey)) retries.delete(resourceKey);
    for (const resourceKey of terminal) if (!known.has(resourceKey)) terminal.delete(resourceKey);
    for (const [activityId, pushToken] of retiredTokens) {
      if (!registrations.some((registration) => registration.activityId === activityId && registration.pushToken === pushToken)) {
        retiredTokens.delete(activityId);
      }
    }
    return registrations;
  }

  async function snapshot(resource: Resource): Promise<ActivityPhase | undefined> {
    if (resource.kind === 'background_job') return (await app.backgroundJobs.details(resource.resourceId))?.details.job.status;
    const task = await app.taskStore?.get(resource.resourceId, 0, 0);
    if (!task) return;
    switch (task.state) {
      case 'Running': return 'running';
      case 'Done': return 'done';
      case 'Cancelled': return 'cancelled';
      case 'NeedsAttention': return task.latestSessionEndReason === 'crashed' ? 'failed' : 'waiting';
      case 'Ready': case 'PauseRequested': case 'Paused': return 'waiting';
    }
  }
  async function flush() {
    if (!services || stopping) return;
    const resources = [...pending.values()].filter((resource) => (retries.get(key(resource))?.at ?? 0) <= Date.now());
    for (const resource of resources) pending.delete(key(resource));
    for (const resource of resources) {
      if (stopping) break;
      try {
        const registrations = (await refreshKnown()).filter((registration) => key(registration) === key(resource));
        if (registrations.length === 0) { known.delete(key(resource)); continue; }
        const phase = await snapshot(resource);
        if (!phase) {
          for (const registration of registrations) await services.store.remove(owner, registration.activityId, registration.pushToken);
          known.delete(key(resource));
          continue;
        }
        const isTerminal = ['done', 'failed', 'cancelled'].includes(phase);
        if (isTerminal) {
          if (!terminal.has(key(resource))) retries.delete(key(resource));
          terminal.add(key(resource));
        }
        else terminal.delete(key(resource));
        if (isTerminal && (retries.get(key(resource))?.count ?? 0) >= 3) continue;
        let retryable = false;
        for (const registration of registrations) {
          if (stopping) break;
          try {
            if (retiredTokens.get(registration.activityId) === registration.pushToken) {
              await services.store.remove(owner, registration.activityId, registration.pushToken);
              continue;
            }
            const result = await services.sender.send(registration.pushToken, activityContent(phase, registration.language), controller.signal);
            if (result.invalidToken || result.accepted && isTerminal) {
              retiredTokens.set(registration.activityId, registration.pushToken);
              await services.store.remove(owner, registration.activityId, registration.pushToken);
            }
            retryable ||= result.retryable === true;
            if (!result.accepted) app.log.warn('activitykit.push_not_accepted');
          } catch {
            retryable = true;
            if (!stopping) app.log.warn('activitykit.push_unavailable');
          }
        }
        if (retryable) retry(resource);
        else retries.delete(key(resource));
      } catch {
        if (!stopping) {
          app.log.warn('activitykit.snapshot_unavailable');
          retry(resource);
        }
      }
    }
  }
  function retry(resource: Resource) {
    if (stopping) return;
    const count = (retries.get(key(resource))?.count ?? 0) + 1;
    const at = Date.now() + (count < 3 ? 5000 * 2 ** (count - 1) : 0);
    retries.set(key(resource), { count, at });
    if (count < 3) pending.set(key(resource), resource);
    else app.log.warn('activitykit.push_retry_exhausted');
  }
  function schedule() {
    if (timer || active || stopping || pending.size === 0) return;
    const nextAt = Math.min(...[...pending.keys()].map((resourceKey) => retries.get(resourceKey)?.at ?? 0));
    timer = setTimeout(() => {
      timer = undefined;
      active = flush().finally(() => { active = undefined; schedule(); });
    }, Math.max(1000, nextAt - Date.now()));
    timer.unref();
  }
  function enqueue(resource: Resource) {
    if (!services || stopping || !known.has(key(resource))) return;
    pending.set(key(resource), resource);
    schedule();
  }
  if (services) {
    const unsubscribeJobs = app.jarvisActivityHub.subscribe((event) => {
      if (event.type === 'job') enqueue({ kind: 'background_job', resourceId: event.job.jobId });
    });
    const unsubscribeTasks = app.eventHub.subscribe((event) => {
      enqueue({ kind: 'factory_task', resourceId: event.taskId });
    });
    app.addHook('onReady', async () => {
      const registrations = await refreshKnown();
      for (const registration of registrations) enqueue(registration);
      heartbeat = setInterval(() => {
        for (const resource of known.values()) {
          if (terminal.has(key(resource))) continue;
          if ((retries.get(key(resource))?.count ?? 0) >= 3) retries.delete(key(resource));
          enqueue(resource);
        }
      }, 120_000);
      heartbeat.unref();
    });
    app.addHook('preClose', async () => {
      stopping = true;
      unsubscribeJobs();
      unsubscribeTasks();
      if (timer) clearTimeout(timer);
      if (heartbeat) clearInterval(heartbeat);
      controller.abort();
      await active;
      pending.clear();
      known.clear();
      terminal.clear();
      retries.clear();
      retiredTokens.clear();
    });
  }

  let windowAt = 0;
  let registrationsInWindow = 0;
  app.post('/ios/task-activities', { bodyLimit: 2048 }, async (request, reply) => {
    if (request.principal?.objectId.toLowerCase() !== owner.toLowerCase()) return reply.code(403).send({ error: 'Forbidden' });
    if (!services) return reply.code(503).send({ error: 'activitykit_unavailable' });
    const registration = validateTaskActivityRegistration(request.body);
    if (!registration) return reply.code(400).send({ error: 'invalid_activity_registration' });
    const now = Date.now();
    if (now - windowAt >= 60_000) { windowAt = now; registrationsInWindow = 0; }
    if (++registrationsInWindow > 60) return reply.code(429).send({ error: 'rate_limited' });
    try {
      if (!await snapshot(registration)) return reply.code(404).send({ error: 'not_found' });
      if (!await services.store.upsert(owner, registration)) return reply.code(429).send({ error: 'activity_limit' });
      await refreshKnown();
      retries.delete(key(registration));
      // Refresh from durable state after registration, covering completion before the token arrived.
      enqueue(registration);
      return reply.code(204).send();
    } catch {
      request.log.warn('activitykit.registration_unavailable');
      return reply.code(503).send({ error: 'activitykit_unavailable' });
    }
  });
  app.delete<{ Params: { activityId: string } }>('/ios/task-activities/:activityId', async (request, reply) => {
    if (request.principal?.objectId.toLowerCase() !== owner.toLowerCase()) return reply.code(403).send({ error: 'Forbidden' });
    if (!services) return reply.code(503).send({ error: 'activitykit_unavailable' });
    if (!activityIdPattern.test(request.params.activityId)) return reply.code(400).send({ error: 'invalid_activity_id' });
    try {
      await services.store.remove(owner, request.params.activityId);
      await refreshKnown();
      return reply.code(204).send();
    } catch {
      request.log.warn('activitykit.registration_unavailable');
      return reply.code(503).send({ error: 'activitykit_unavailable' });
    }
  });
}
