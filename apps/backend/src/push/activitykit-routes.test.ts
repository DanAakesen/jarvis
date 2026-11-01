import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type BuildAppOptions } from '../app.js';
import { loadConfig } from '../config.js';
import type { ActivityRegistration, ActivityRegistrationStore } from '../database/activitykit-store.js';
import type { ActivityContentState, ActivityPushResult } from './activitykit.js';
import { validateActivityRegistration } from './activitykit-routes.js';
import type { TaskDetail } from '../factory/task-store.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: `${['Bear', 'er'].join('')} ${['e30', 'e30', 'sig'].join('.')}` };
const apps: ReturnType<typeof buildApp>[] = [];
const token = 'ab'.repeat(32);
const registration: ActivityRegistration = {
  kind: 'background_job', resourceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', activityId: 'fixture-activity', pushToken: token, language: 'en',
};
function fixture(options: BuildAppOptions = {}, objectId = config.auth.ownerObjectId, initial: ActivityRegistration[] = [], enabled = true) {
  const rows = new Map(initial.map((item) => [item.activityId, item]));
  const store: ActivityRegistrationStore = {
    upsert: vi.fn(async (_owner, value) => { rows.set(value.activityId, { ...value }); return true; }),
    list: vi.fn(async () => [...rows.values()]),
    remove: vi.fn(async (_owner, id, expectedToken) => {
      if (expectedToken === undefined || rows.get(id)?.pushToken === expectedToken) rows.delete(id);
    }),
  };
  const send = vi.fn<(token: string, content: ActivityContentState, signal: AbortSignal) => Promise<ActivityPushResult>>(
    async () => ({ accepted: true, invalidToken: false }),
  );
  const app = buildApp(config, undefined, {
    auth: async () => ({ objectId, tenantId: config.auth.tenantId, displayName: 'Fixture' }),
    ...(enabled ? { activityKit: { store, sender: { send } } } : {}), ...options,
  });
  apps.push(app);
  return { app, store, send, rows };
}
const body = (value: ActivityRegistration) => ({
  taskID: value.resourceId, activityID: value.activityId, pushToken: value.pushToken, language: value.language,
});
const post = (app: ReturnType<typeof buildApp>, registration: ActivityRegistration) =>
  app.inject({ method: 'POST', url: '/ios/task-activities', headers, payload: body(registration) });
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('ActivityKit owner registration', () => {
  it('requires owner authentication, denies foreign and service identities, and reports disabled infrastructure', async () => {
    const disabled = fixture({}, config.auth.ownerObjectId, [], false);
    expect((await disabled.app.inject({ method: 'POST', url: '/ios/task-activities', payload: body(registration) })).statusCode).toBe(401);
    expect((await post(disabled.app, registration)).json()).toEqual({ error: 'activitykit_unavailable' });
    const foreign = fixture({}, 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff');
    expect((await post(foreign.app, registration)).statusCode).toBe(403);
    expect(foreign.store.upsert).not.toHaveBeenCalled();
    const service = fixture({ auth: async () => ({ kind: 'jarvis-agent', objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }) });
    expect((await post(service.app, registration)).statusCode).toBe(403);
    expect(service.store.upsert).not.toHaveBeenCalled();
  });
  it.each([
    null, [], { ...registration, pushToken: 'ff' }, { ...registration, pushToken: 'ab'.repeat(257) },
    { ...registration, pushToken: `${token}a` }, { ...registration, resourceId: 'not-a-job' },
    { ...registration, kind: 'factory_task', resourceId: '9223372036854775808' },
    { ...registration, kind: 'factory_task', resourceId: '0' }, { ...registration, language: 'fr' },
    { ...registration, activityId: 'x'.repeat(129) }, { ...registration, activityId: '../bad' },
    { ...registration, start: true },
  ])('rejects malformed registrations without storing tokens: %j', (body) => {
    expect(validateActivityRegistration(body)).toBeUndefined();
  });
  it('normalizes valid IDs and hex, limits bodies, and rejects nonexistent resources', async () => {
    expect(validateActivityRegistration({ ...registration, resourceId: registration.resourceId.toUpperCase(), pushToken: token.toUpperCase() })).toEqual(registration);
    const f = fixture();
    expect((await post(f.app, registration)).statusCode).toBe(404);
    expect((await post(f.app, { ...registration, pushToken: 'a'.repeat(3000) })).statusCode).toBe(413);
    expect(f.store.upsert).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it('bounds registration count and returns a sanitized unavailable response on SQL failure', async () => {
    const f = fixture();
    const job = await f.app.backgroundJobs.start('research', 'Private title', 2);
    f.store.upsert = vi.fn(async () => false);
    expect((await post(f.app, { ...registration, resourceId: job.jobId })).json()).toEqual({ error: 'activity_limit' });
    f.store.upsert = vi.fn(async () => { throw new Error(`Private SQL detail ${token}`); });
    const response = await post(f.app, { ...registration, resourceId: job.jobId });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain(token);
  });
  it('requires explicit native activity identity and language, upserts idempotently and rejects extra fields', async () => {
    const f = fixture();
    const job = await f.app.backgroundJobs.start('research', 'Title', 2);
    const value = { ...registration, resourceId: job.jobId, language: 'da' as const };
    expect((await post(f.app, value)).statusCode).toBe(204);
    expect((await post(f.app, value)).statusCode).toBe(204);
    expect(f.rows.size).toBe(1);
    const saved = [...f.rows.values()][0];
    expect(saved).toMatchObject({ kind: 'background_job', resourceId: job.jobId, pushToken: token, language: 'da' });
    expect(saved?.activityId).toBe(registration.activityId);
    for (const extra of [{ start: true }, { activityID: null }, { language: 'fr' }, { taskID: '9223372036854775808' }]) {
      expect((await f.app.inject({
        method: 'POST', url: '/ios/task-activities', headers,
        payload: { ...body(value), ...extra },
      })).statusCode).toBe(400);
    }
    for (const missing of ['activityID', 'language']) {
      const incomplete: Record<string, unknown> = body(value);
      delete incomplete[missing];
      expect((await f.app.inject({ method: 'POST', url: '/ios/task-activities', headers, payload: incomplete })).statusCode).toBe(400);
    }
  });
  it('registers an existing job and catches up from snapshots, coalesces progress and ends with no private detail', async () => {
    const f = fixture();
    await f.app.ready();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const job = await f.app.backgroundJobs.start('research', 'Private title', 2);
    expect((await post(f.app, { ...registration, resourceId: job.jobId })).statusCode).toBe(204);
    await job.progress(1, 'Sensitive provider detail');
    await job.progress(2, 'Other sensitive detail');
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.send.mock.calls[0]).toEqual([token, { state: 'Working', activity: null, phase: 'running' }, expect.any(AbortSignal)]);
    await job.fail('Secret provider failure');
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.send.mock.calls[1]).toEqual([token, { state: 'Failed', activity: null, phase: 'failed' }, expect.any(AbortSignal)]);
    expect(f.rows.size).toBe(0);
    await job.progress(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.send).toHaveBeenCalledTimes(2);
  });
  it('ends already-completed jobs on registration and deletes only the delivered token version', async () => {
    const f = fixture();
    await f.app.ready();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const job = await f.app.backgroundJobs.start('research', 'Private title', 1);
    await job.done('result');
    expect((await post(f.app, { ...registration, resourceId: job.jobId })).statusCode).toBe(204);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.send.mock.calls[0]?.[1]).toMatchObject({ phase: 'done' });
    expect(f.store.remove).toHaveBeenCalledWith(config.auth.ownerObjectId, registration.activityId, token);
  });
  it('cleans invalid tokens, retains transient failures without retry, and unregisters owner-scoped activities', async () => {
    const f = fixture();
    await f.app.ready();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const job = await f.app.backgroundJobs.start('research', 'Title', 2);
    f.send.mockResolvedValue({ accepted: false, invalidToken: false });
    await post(f.app, { ...registration, resourceId: job.jobId });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.rows.size).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.send).toHaveBeenCalledOnce();
    f.send.mockResolvedValue({ accepted: false, invalidToken: true });
    await job.progress(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.rows.size).toBe(0);
    await post(f.app, { ...registration, resourceId: job.jobId });
    const removed = await f.app.inject({ method: 'DELETE', url: `/ios/task-activities/${registration.activityId}`, headers });
    expect(removed.statusCode).toBe(204);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.send).toHaveBeenCalledTimes(2);
  });
  it('hooks Factory events, refreshes waiting and terminal state, and reconciles persisted registrations on boot', async () => {
    let state: TaskDetail['state'] = 'Running';
    const taskStore = {
      get: vi.fn(async () => ({ id: '42', projectId: '1', state, title: 'Private', activity: 'Private event' }) as TaskDetail),
    } as unknown as NonNullable<BuildAppOptions['taskStore']>;
    const factoryRegistration: ActivityRegistration = { ...registration, kind: 'factory_task', resourceId: '42' };
    const f = fixture({ taskStore }, config.auth.ownerObjectId, [factoryRegistration]);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    await f.app.ready();
    state = 'NeedsAttention';
    f.app.eventHub.publish({
      id: '1', taskId: '42', type: 'paused', summary: 'Private', payload: {}, payloadTruncated: false, source: 'backend', at: new Date().toISOString(),
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.send.mock.calls[0]?.[1]).toMatchObject({ phase: 'waiting', activity: null });
    state = 'Cancelled';
    f.app.eventHub.publish({
      id: '2', taskId: '42', type: 'cancelled', summary: 'Private', payload: {}, payloadTruncated: false, source: 'backend', at: new Date().toISOString(),
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.send.mock.calls[1]?.[1]).toMatchObject({ phase: 'cancelled' });
    expect(f.rows.size).toBe(0);
  });
  it('unsubscribes and aborts active sends on shutdown', async () => {
    const f = fixture();
    await f.app.ready();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let pushSignal: AbortSignal | undefined;
    f.send.mockImplementation(async (_token, _content, signal) => {
      pushSignal = signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { reject(new Error('cancelled')); }, { once: true }));
    });
    const job = await f.app.backgroundJobs.start('research', 'Title', 2);
    await post(f.app, { ...registration, resourceId: job.jobId });
    await vi.advanceTimersByTimeAsync(1000);
    expect(pushSignal?.aborted).toBe(false);
    await f.app.close();
    expect(pushSignal?.aborted).toBe(true);
    await job.progress(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.send).toHaveBeenCalledOnce();
  });
  it('ends a crashed NeedsAttention Factory task as failed but keeps other attention states waiting', async () => {
    let latestSessionEndReason: TaskDetail['latestSessionEndReason'] = 'idle_expired';
    const taskStore = {
      get: vi.fn(async () => ({
        id: '42', projectId: '1', state: 'NeedsAttention', latestSessionEndReason,
      }) as TaskDetail),
    } as unknown as NonNullable<BuildAppOptions['taskStore']>;
    const f = fixture({ taskStore });
    await f.app.ready();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const value: ActivityRegistration = { ...registration, kind: 'factory_task', resourceId: '42' };
    await post(f.app, value);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.send.mock.calls[0]?.[1]).toMatchObject({ phase: 'waiting' });
    expect(f.rows.size).toBe(1);
    latestSessionEndReason = 'crashed';
    await post(f.app, value);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.send.mock.calls[1]?.[1]).toMatchObject({ phase: 'failed' });
    expect(f.rows.size).toBe(0);
  });
  it('retries transient terminal rejection twice, keeps unacknowledged tokens, and does not retry forever', async () => {
    const f = fixture();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    await f.app.ready();
    const job = await f.app.backgroundJobs.start('research', 'Private title', 2);
    await job.fail('Private error');
    f.send.mockResolvedValue({ accepted: false, invalidToken: false, retryable: true });
    await post(f.app, { ...registration, resourceId: job.jobId });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.send).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.send).toHaveBeenCalledTimes(3);
    expect(f.rows.size).toBe(1);
    await vi.advanceTimersByTimeAsync(240_000);
    expect(f.send).toHaveBeenCalledTimes(3);
  });
  it('refreshes the current snapshot on transient retry and removes a token only after successful end', async () => {
    const f = fixture();
    await f.app.ready();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const job = await f.app.backgroundJobs.start('research', 'Private title', 2);
    f.send.mockRejectedValueOnce(new Error('Synthetic transport failure'));
    await post(f.app, { ...registration, resourceId: job.jobId });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.rows.size).toBe(1);
    await job.fail('Private detail');
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.send.mock.calls[1]?.[1]).toMatchObject({ phase: 'failed', activity: null });
    expect(f.rows.size).toBe(0);
  });
  it('sends terminal completion after exhausting running-phase retries when APNs recovers', async () => {
    const f = fixture();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    await f.app.ready();
    const job = await f.app.backgroundJobs.start('research', 'Private title', 2);
    f.send.mockResolvedValue({ accepted: false, invalidToken: false, retryable: true });
    await post(f.app, { ...registration, resourceId: job.jobId });
    await vi.advanceTimersByTimeAsync(16_000);
    expect(f.send).toHaveBeenCalledTimes(3);
    expect(f.rows.size).toBe(1);
    f.send.mockResolvedValue({ accepted: true, invalidToken: false });
    await job.done('result');
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.send).toHaveBeenCalledTimes(4);
    expect(f.send.mock.calls[3]?.[1]).toMatchObject({ phase: 'done', activity: null });
    expect(f.store.remove).toHaveBeenCalledWith(config.auth.ownerObjectId, registration.activityId, token);
    expect(f.rows.size).toBe(0);
    await vi.advanceTimersByTimeAsync(240_000);
    expect(f.send).toHaveBeenCalledTimes(4);
  });
  it('heartbeats registered running jobs before the five-minute stale date even without events', async () => {
    const f = fixture();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    await f.app.ready();
    const job = await f.app.backgroundJobs.start('research', 'Private title', 2);
    await post(f.app, { ...registration, resourceId: job.jobId });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.send).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.send.mock.calls[1]?.[1]).toMatchObject({ phase: 'running', activity: null });
    await job.done('result');
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.send).toHaveBeenCalledTimes(3);
    expect(f.rows.size).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.send).toHaveBeenCalledTimes(3);
  });
  it('does not resend invalid tokens when durable cleanup temporarily fails', async () => {
    const f = fixture();
    await f.app.ready();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const job = await f.app.backgroundJobs.start('research', 'Private title', 2);
    f.send.mockResolvedValue({ accepted: false, invalidToken: true });
    const remove = f.store.remove;
    f.store.remove = vi.fn()
      .mockRejectedValueOnce(new Error('Synthetic cleanup failure'))
      .mockImplementation(remove);
    await post(f.app, { ...registration, resourceId: job.jobId });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.rows.size).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.rows.size).toBe(0);
  });
});
