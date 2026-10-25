import { afterEach, describe, expect, it, vi } from 'vitest';
import { isBackgroundJob, type BackgroundJob, type BackgroundJobStatus } from '@jarvis/contracts';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier } from '../auth/verify.js';
import { createEventHub } from './event-hub.js';
import { BackgroundJobRegistry, cancelJobTool, getJobTool, listJobsTool, workspaceResultDelivery } from './jobs.js';
import type { FastifyRequest } from 'fastify';
import { ToolFailure, ToolRefusal } from './tool-registry.js';
import type { JarvisActivityHub } from './activity.js';
import type { BackgroundJobStore } from '../database/background-job-store.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: `${['Bear', 'er'].join('')} ${['e30', 'e30', 'sig'].join('.')}` };
const apps: ReturnType<typeof buildApp>[] = [];

function fixture(objectId = config.auth.ownerObjectId, backgroundJobStore?: BackgroundJobStore) {
  const auth: TokenVerifier = async () => ({ objectId, tenantId: config.auth.tenantId, displayName: 'Dan' });
  const app = buildApp(config, undefined, { auth, ...(backgroundJobStore ? { backgroundJobStore } : {}) });
  apps.push(app);
  return app;
}

function dismissalFixture() {
  const jobs: BackgroundJob[] = (['running', 'done', 'failed', 'cancelled'] as BackgroundJobStatus[]).map((status, index) => ({
    jobId: `aaaaaaaa-0000-4000-8000-${String(index + 20).padStart(12, '0')}`,
    kind: 'research',
    title: `Research: ${status}`,
    status,
    step: status === 'done' ? 2 : 1,
    steps: 2,
    ...(status === 'done' ? { viewId: 'research-result' } : {}),
    ...(status === 'failed' ? { detail: 'interrupted by restart' } : {}),
    startedAt: '2026-10-17T12:00:00.000Z',
    updatedAt: '2026-10-17T12:01:00.000Z',
  }));
  const dismissals = new Map<string, Set<string>>();
  const store: BackgroundJobStore = {
    create: vi.fn(async () => true),
    update: vi.fn(async (job) => job),
    updateResultDelivery: vi.fn(async (jobId, resultDelivery) => {
      const job = jobs.find((candidate) => candidate.jobId === jobId);
      if (!job?.resultId) return null;
      Object.assign(job, { resultDelivery });
      return job;
    }),
    list: vi.fn(async () => jobs),
    get: vi.fn(async (id) => {
      const job = jobs.find((candidate) => candidate.jobId === id);
      return job ? { details: { job, steps: [], retryable: false } } : null;
    }),
    reconcileInterrupted: vi.fn(async () => []),
    prune: vi.fn(async () => {}),
    listDismissed: vi.fn(async (owner) => [...dismissals.get(owner.toLowerCase()) ?? []]),
    dismiss: vi.fn(async (owner, ids, skipRunning = false) => {
      const selected = jobs.filter((job) => ids ? ids.includes(job.jobId) : job.status !== 'running');
      const runningJobIds = selected.filter((job) => job.status === 'running').map((job) => job.jobId);
      if (runningJobIds.length > 0 && !skipRunning) return { dismissedJobIds: [], runningJobIds };
      const terminal = selected.filter((job) => job.status !== 'running');
      const dismissed = dismissals.get(owner.toLowerCase()) ?? new Set<string>();
      for (const job of terminal) dismissed.add(job.jobId);
      if (terminal.length > 0) dismissals.set(owner.toLowerCase(), dismissed);
      return { dismissedJobIds: terminal.map((job) => job.jobId), runningJobIds };
    }),
  };
  return { jobs, store, dismissals };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});


describe('background jobs', () => {
  it('keeps successful research completion separate from persisted result delivery acknowledgement', async () => {
    const hub: JarvisActivityHub = createEventHub();
    const events: BackgroundJob[] = [];
    hub.subscribe((event) => { if (event.type === 'job') events.push(event.job); });
    let persisted: BackgroundJob | null = null;
    const store: BackgroundJobStore = {
      create: vi.fn(async () => true),
      update: vi.fn(async (job) => { persisted = job; return job; }),
      updateResultDelivery: vi.fn(async (_jobId, resultDelivery) => {
        if (!persisted?.resultId || persisted.resultDelivery === 'delivered' && resultDelivery !== 'delivered') return null;
        persisted = { ...persisted, resultDelivery };
        return persisted;
      }),
      list: vi.fn(async () => persisted ? [persisted] : []),
      get: vi.fn(async () => null),
      reconcileInterrupted: vi.fn(async () => []),
      prune: vi.fn(async () => {}),
    };
    const registry = new BackgroundJobRegistry(hub, Date.now, store);
    const job = await registry.start('research', 'Research: Saved result', 2);
    const resultId = 'research:11111111-1111-4111-8111-111111111111';

    await job.done(`research-${job.jobId.replaceAll('-', '')}`, 'Report saved', {
      resultId, resultDelivery: 'pending',
    });
    await job.setResultDelivery('delivered');
    await job.setResultDelivery('unknown');

    expect(events.map(({ status, resultDelivery }) => [status, resultDelivery])).toEqual([
      ['running', undefined], ['done', 'pending'], ['done', 'delivered'],
    ]);
    expect(persisted).toMatchObject({ status: 'done', resultId, resultDelivery: 'delivered' });
    expect(store.updateResultDelivery).toHaveBeenCalledOnce();
  });

  it('distinguishes missing Workspace delivery, explicit refusal and ambiguous acknowledgement', () => {
    expect(workspaceResultDelivery(new ToolRefusal('No active signed-in workspace is connected.')))
      .toBe('pending');
    expect(workspaceResultDelivery(new ToolRefusal('The workspace refused the report.'))).toBe('failed');
    expect(workspaceResultDelivery(new ToolFailure(
      'The workspace did not acknowledge the command within 10 seconds; it may already have been applied.',
    ))).toBe('unknown');
  });

  it('publishes bounded, contract-valid job changes and ignores updates after the job ends', async () => {
    const hub: JarvisActivityHub = createEventHub();
    const events: BackgroundJob[] = [];
    hub.subscribe((event) => { if (event.type === 'job') events.push(event.job); });
    let time = Date.parse('2026-10-07T12:00:00.000Z');
    const registry = new BackgroundJobRegistry(hub, () => time);

    const job = await registry.start('embedding', `Research: ${'x'.repeat(200)}`, 3, undefined, 'Starting');
    time += 1_000;
    await job.progress(1, 'Searching: key facts\nwith a newline');
    await job.progress(9);
    await job.done('research-abc', 'Report ready');
    await job.fail('too late');

    expect(events.map((event) => event.status)).toEqual(['running', 'running', 'running', 'done']);
    expect(events.every((event) => isBackgroundJob(event))).toBe(true);
    expect(events[0]!.title.length).toBeLessThanOrEqual(80);
    expect(events[1]).toMatchObject({ step: 1, detail: 'Searching: key factswith a newline' });
    expect(events[2]).toMatchObject({ step: 3 });
    expect(events[2]).not.toHaveProperty('detail');
    expect(events[3]).toMatchObject({ step: 3, viewId: 'research-abc', updatedAt: '2026-10-07T12:00:01.000Z' });
    expect(await registry.list()).toHaveLength(1);

    time += 31 * 24 * 60 * 60_000;
    expect(await registry.list()).toEqual([]);
  });

  describe('durable background job dismissal routes', () => {
    it('hides terminal jobs across app instances without changing raw audit, details, results or interruption status', async () => {
      const { jobs, store } = dismissalFixture();
      const snapshot = structuredClone(jobs);
      const app = fixture(undefined, store);
      const target = jobs[1]!;
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await app.inject({ method: 'POST', url: `/jobs/${target.jobId.toUpperCase()}/dismiss`, headers });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ dismissedJobIds: [target.jobId] });
        expect(response.headers['cache-control']).toBe('no-store');
      }
      const restarted = fixture(config.auth.ownerObjectId.toUpperCase(), store);
      const listed = await restarted.inject({ url: '/jobs', headers });
      expect(listed.json().jobs).toEqual(jobs.filter((job) => job !== target));
      expect(listed.json().dismissedJobIds).toEqual([target.jobId]);
      expect(listed.headers['cache-control']).toBe('no-store');
      expect(await restarted.backgroundJobs.list()).toEqual(snapshot);
      expect(await restarted.backgroundJobs.details(target.jobId)).toMatchObject({ details: { job: target } });
      expect(await restarted.backgroundJobs.visibleSnapshot('00000000-0000-4000-8000-000000000099')).toEqual({
        jobs: snapshot, dismissedJobIds: [],
      });
      expect(jobs).toEqual(snapshot);
      expect(store.update).not.toHaveBeenCalled();
    });

    it('excludes owner dismissals from list_jobs and smoke counts while preserving raw get_job and audit reads', async () => {
      const { jobs, store } = dismissalFixture();
      const app = fixture(undefined, store);
      for (const job of jobs.slice(1, 3)) {
        expect((await app.inject({ method: 'POST', url: `/jobs/${job.jobId}/dismiss`, headers })).statusCode).toBe(200);
      }
      const request = { server: app } as unknown as FastifyRequest;
      const signal = new AbortController().signal;
      await expect(listJobsTool.execute({}, request, signal)).resolves.toMatchObject({
        running: [{ jobId: jobs[0]!.jobId, status: 'running' }],
        finished: [{ jobId: jobs[3]!.jobId, status: 'cancelled' }],
      });
      await expect(listJobsTool.execute({}, {
        server: app, headers: { 'x-jarvis-smoke': 'true' },
      } as unknown as FastifyRequest, signal)).resolves.toEqual({ runningCount: 1, finishedCount: 1 });
      await expect(getJobTool.execute({ jobId: jobs[1]!.jobId }, request, signal))
        .resolves.toMatchObject({ job: { status: 'done', viewId: 'research-result' } });
      await expect(getJobTool.execute({ jobId: jobs[2]!.jobId }, request, signal))
        .resolves.toMatchObject({ job: { status: 'failed', detail: 'interrupted by restart' } });
      expect(await app.backgroundJobs.list()).toEqual(jobs);
    });

    it('refuses running and missing individual jobs, then dismisses all terminal states idempotently', async () => {
      const { jobs, store, dismissals } = dismissalFixture();
      const app = fixture(undefined, store);
      expect((await app.inject({ method: 'POST', url: `/jobs/${jobs[0]!.jobId}/dismiss`, headers })).statusCode).toBe(409);
      expect((await app.inject({
        method: 'POST', url: '/jobs/00000000-0000-4000-8000-000000000099/dismiss', headers,
      })).statusCode).toBe(404);
      expect(dismissals.size).toBe(0);
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await app.inject({ method: 'POST', url: '/jobs/dismiss-finished', headers });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ dismissedJobIds: jobs.slice(1).map((job) => job.jobId) });
      }
      expect((await app.inject({ url: '/jobs', headers })).json()).toEqual({
        jobs: [jobs[0]], dismissedJobIds: jobs.slice(1).map((job) => job.jobId),
      });
      expect(await app.backgroundJobs.list()).toHaveLength(4);
    });

    it('imports only retained terminal IDs, confirms previous dismissals and ignores missing IDs', async () => {
      const { jobs, store } = dismissalFixture();
      const app = fixture(undefined, store);
      const requested = jobs[2]!.jobId;
      await app.inject({ method: 'POST', url: `/jobs/${requested}/dismiss`, headers });
      const response = await app.inject({
        method: 'POST', url: '/jobs/dismissals/import', headers,
        payload: { jobIds: [requested.toUpperCase(), requested, jobs[3]!.jobId, '00000000-0000-4000-8000-000000000099'] },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ dismissedJobIds: [requested, jobs[3]!.jobId] });
      expect(store.dismiss).toHaveBeenLastCalledWith(config.auth.ownerObjectId, [
        requested, jobs[3]!.jobId, '00000000-0000-4000-8000-000000000099',
      ], true);
      const empty = await app.inject({ method: 'POST', url: '/jobs/dismissals/import', headers, payload: { jobIds: [] } });
      expect(empty.statusCode).toBe(200);
      expect(empty.json()).toEqual({ dismissedJobIds: [] });
    });

    it('imports terminal legacy hides while ignoring running IDs so old preferences cannot hide active work', async () => {
      const { jobs, store } = dismissalFixture();
      const app = fixture(undefined, store);
      const response = await app.inject({
        method: 'POST', url: '/jobs/dismissals/import', headers, payload: { jobIds: [jobs[0]!.jobId, jobs[1]!.jobId] },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ dismissedJobIds: [jobs[1]!.jobId] });
      expect((await app.inject({ url: '/jobs', headers })).json().jobs).toContainEqual(jobs[0]);
      const runningOnly = await app.inject({
        method: 'POST', url: '/jobs/dismissals/import', headers, payload: { jobIds: [jobs[0]!.jobId] },
      });
      expect(runningOnly.statusCode).toBe(200);
      expect(runningOnly.json()).toEqual({ dismissedJobIds: [] });
    });

    it.each([
      null, [], {}, { jobIds: '00000000-0000-4000-8000-000000000020' }, { jobIds: [42] },
      { jobIds: ['------------------------------------'] }, { jobIds: ['00000000-0000-4000-8000-000000000020 '] },
      { jobIds: ['00000000-0000-4000-8000-000000000020'], ownerObjectId: config.auth.ownerObjectId },
      { jobIds: Array.from({ length: 1_001 }, () => '00000000-0000-4000-8000-000000000020') },
    ])('rejects malformed imports before persistence (%#)', async (payload) => {
      const { store } = dismissalFixture();
      const app = fixture(undefined, store);
      const response = await app.inject({
        method: 'POST', url: '/jobs/dismissals/import', headers: { ...headers, 'content-type': 'application/json' },
        payload: JSON.stringify(payload),
      });
      expect(response.statusCode).toBe(400);
      expect(store.dismiss).not.toHaveBeenCalled();
    });

    it('accepts the 1000-ID limit and rejects malformed individual IDs', async () => {
      const { jobs, store } = dismissalFixture();
      const app = fixture(undefined, store);
      expect((await app.inject({
        method: 'POST', url: '/jobs/dismissals/import', headers,
        payload: { jobIds: Array.from({ length: 1_000 }, () => jobs[1]!.jobId) },
      })).statusCode).toBe(200);
      expect((await app.inject({ method: 'POST', url: '/jobs/------------------------------------/dismiss', headers })).statusCode).toBe(400);
    });

    it('requires authentication and the configured owner for every job visibility operation', async () => {
      const { jobs, store } = dismissalFixture();
      const app = fixture(undefined, store);
      const stranger = fixture('00000000-0000-4000-8000-000000000099', store);
      for (const request of [
        { method: 'GET' as const, url: '/jobs' },
        { method: 'POST' as const, url: `/jobs/${jobs[1]!.jobId}/dismiss` },
        { method: 'POST' as const, url: '/jobs/dismiss-finished' },
        { method: 'POST' as const, url: '/jobs/dismissals/import', payload: { jobIds: [jobs[1]!.jobId] } },
      ]) {
        expect((await app.inject(request)).statusCode).toBe(401);
        expect([401, 403]).toContain((await stranger.inject({ ...request, headers })).statusCode);
      }
      expect(store.dismiss).not.toHaveBeenCalled();
      expect(store.listDismissed).not.toHaveBeenCalled();
    });

    it('returns 503 instead of reporting success when durable dismissal is absent or fails', async () => {
      const { jobs, store } = dismissalFixture();
      const withoutMethods = { ...store };
      delete withoutMethods.dismiss;
      delete withoutMethods.listDismissed;
      const unavailable = fixture(undefined, withoutMethods);
      const withoutReads = { ...store };
      delete withoutReads.listDismissed;
      const unreadable = fixture(undefined, withoutReads);
      const absent = fixture();
      vi.mocked(store.dismiss!).mockRejectedValue(new Error('private SQL connection details'));
      const failed = fixture(undefined, store);
      for (const app of [unavailable, unreadable, absent, failed]) {
        for (const request of [
          { url: `/jobs/${jobs[1]!.jobId}/dismiss` },
          { url: '/jobs/dismiss-finished' },
          { url: '/jobs/dismissals/import', payload: { jobIds: [jobs[1]!.jobId] } },
        ]) {
          const response = await app.inject({ method: 'POST', ...request, headers });
          expect(response.statusCode).toBe(503);
          expect(response.json()).toEqual({ error: 'Background job dismissal persistence is unavailable' });
          expect(response.body).not.toContain('private SQL');
        }
      }
    });

    it('returns 503 rather than resurfacing dismissed jobs when durable visibility reads fail', async () => {
      const { store } = dismissalFixture();
      vi.mocked(store.listDismissed!).mockRejectedValue(new Error('private SQL connection details'));
      const response = await fixture(undefined, store).inject({ url: '/jobs', headers });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'Background job persistence is unavailable' });
      expect(response.body).not.toContain('private SQL');
    });

    it('logs only fixed safe failure messages without SQL errors or private connection details', async () => {
      const { jobs, store } = dismissalFixture();
      const privateFailure = new Error('private SQL connection details');
      vi.mocked(store.listDismissed!).mockRejectedValue(privateFailure);
      vi.mocked(store.dismiss!).mockRejectedValue(privateFailure);
      const app = fixture(undefined, store);
      const logged = vi.fn();
      app.addHook('onRequest', async (request) => {
        vi.spyOn(request.log, 'error').mockImplementation(logged);
      });
      for (const request of [
        { method: 'GET' as const, url: '/jobs' },
        { method: 'POST' as const, url: `/jobs/${jobs[1]!.jobId}/dismiss` },
        { method: 'POST' as const, url: '/jobs/dismiss-finished' },
        { method: 'POST' as const, url: '/jobs/dismissals/import', payload: { jobIds: [jobs[1]!.jobId] } },
      ]) {
        expect((await app.inject({ ...request, headers })).statusCode).toBe(503);
      }
      expect(logged.mock.calls).toEqual([
        ['Background job visibility read failed'], ['Background job dismissal failed'],
        ['Background job dismissal failed'], ['Background job dismissal import failed'],
      ]);
    });

    it('bounds snapshots and clear-finished acknowledgements without limiting durable dismissal writes', async () => {
      const { jobs, store } = dismissalFixture();
      const many = Array.from({ length: 1_005 }, (_, index) => ({
        ...jobs[1]!, jobId: `bbbbbbbb-0000-4000-8000-${String(index).padStart(12, '0')}`,
      }));
      vi.mocked(store.list).mockResolvedValue([...many, ...jobs]);
      vi.mocked(store.listDismissed!).mockResolvedValue(many.map((job) => job.jobId));
      const app = fixture(undefined, store);
      const snapshot = await app.inject({ url: '/jobs', headers });
      expect(snapshot.json()).toEqual({ jobs, dismissedJobIds: many.slice(0, 1_000).map((job) => job.jobId) });
      vi.mocked(store.listDismissed!).mockResolvedValue([]);
      expect((await app.inject({ url: '/jobs', headers })).json().jobs).toHaveLength(1_000);
      vi.mocked(store.dismiss!).mockResolvedValue({ dismissedJobIds: many.map((job) => job.jobId), runningJobIds: [] });
      const finished = await app.inject({ method: 'POST', url: '/jobs/dismiss-finished', headers });
      expect(finished.json().dismissedJobIds).toHaveLength(1_000);
      expect(store.dismiss).toHaveBeenCalledWith(config.auth.ownerObjectId, undefined, false);
    });
  });

  it('lists and cancels jobs for the owner only', async () => {
    const app = fixture();
    const cancel = vi.fn();
    const running = await app.backgroundJobs.start('research', 'Research: Foundry IQ', 3, cancel);
    const fixed = await app.backgroundJobs.start('image', 'Image: robot butler', 1);

    const list = await app.inject({ url: '/jobs', headers });
    expect(list.statusCode).toBe(200);
    expect(list.json().jobs.map((job: BackgroundJob) => job.jobId).sort()).toEqual([running.jobId, fixed.jobId].sort());

    expect((await app.inject({ method: 'POST', url: `/jobs/${fixed.jobId}/cancel`, headers })).statusCode).toBe(409);
    const cancelled = await app.inject({ method: 'POST', url: `/jobs/${running.jobId}/cancel`, headers });
    expect(cancelled.statusCode).toBe(202);
    expect(cancel).toHaveBeenCalledOnce();
    expect((await app.backgroundJobs.list()).find((job) => job.jobId === running.jobId)?.status).toBe('cancelled');
    expect((await app.inject({ method: 'POST', url: `/jobs/${running.jobId}/cancel`, headers })).statusCode).toBe(409);
    expect((await app.inject({
      method: 'POST', url: '/jobs/00000000-0000-4000-8000-000000000000/cancel', headers,
    })).statusCode).toBe(404);

    const stranger = fixture('00000000-0000-4000-8000-000000000001');
    expect([401, 403]).toContain((await stranger.inject({ url: '/jobs', headers })).statusCode);
  });

  it('lets Jarvis list jobs and cancel one by title in chat or voice', async () => {
    const app = fixture();
    const request = { server: app } as unknown as FastifyRequest;
    const signal = new AbortController().signal;
    const stopIgnite = vi.fn();
    const ignite = await app.backgroundJobs.start('research', 'Research: Microsoft Ignite 2026', 3, stopIgnite);
    await ignite.progress(1, 'Searching: Key findings');
    const foundry = await app.backgroundJobs.start('research', 'Research: Foundry IQ', 3, vi.fn());
    await foundry.done('research-foundry', 'Report ready');
    const failed = await app.backgroundJobs.start('research', 'Research: Failed safely', 2);
    await failed.fail('Research could not be completed.');

    const listed = await listJobsTool.execute({}, request, signal) as {
      running: Array<Record<string, unknown>>; finished: Array<Record<string, unknown>>;
    };
    expect(listed.running).toEqual([expect.objectContaining({
      title: 'Research: Microsoft Ignite 2026', status: 'running', progress: '1/3', detail: 'Searching: Key findings',
    })]);
    expect(listed.finished).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Research: Foundry IQ', status: 'done', resultWindow: 'research-foundry' }),
      expect.objectContaining({ title: 'Research: Failed safely', status: 'failed' }),
    ]));
    const smokeListed = await listJobsTool.execute({}, {
      server: app, headers: { 'x-jarvis-smoke': 'true' },
    } as unknown as FastifyRequest, signal);
    expect(smokeListed).toEqual({ runningCount: 1, finishedCount: 2 });
    expect(JSON.stringify(smokeListed)).not.toContain('Research:');
    await expect(getJobTool.execute({ jobId: foundry.jobId }, request, signal)).resolves.toMatchObject({
      job: { title: 'Research: Foundry IQ', status: 'done', viewId: 'research-foundry' },
      steps: [{ status: 'running', step: 0 }, { status: 'done', step: 3, viewId: 'research-foundry' }],
      resultWindow: 'research-foundry',
      retryable: false,
    });
    await expect(getJobTool.execute({ jobId: failed.jobId }, request, signal)).resolves.toMatchObject({
      error: 'Research could not be completed.',
      steps: [{ status: 'running' }, { status: 'failed', detail: 'Research could not be completed.' }],
    });
    await expect(getJobTool.execute({ jobId: '00000000-0000-4000-8000-000000000099' }, request, signal))
      .rejects.toBeInstanceOf(ToolRefusal);
    await expect(getJobTool.execute({ jobId: 'invalid' }, request, signal)).rejects.toBeInstanceOf(ToolRefusal);

    await expect(cancelJobTool.execute({ query: 'Foundry' }, request, signal)).rejects.toBeInstanceOf(ToolRefusal);
    await expect(cancelJobTool.execute({ query: 'ignite research' }, request, signal))
      .resolves.toMatchObject({ cancelled: 'Research: Microsoft Ignite 2026' });
    expect(stopIgnite).toHaveBeenCalledOnce();
    await expect(cancelJobTool.execute({ jobId: ignite.jobId }, request, signal)).rejects.toBeInstanceOf(ToolRefusal);

    await app.backgroundJobs.start('research', 'Research: Azure pricing', 2, vi.fn());
    await app.backgroundJobs.start('research', 'Research: Azure quotas', 2, vi.fn());
    await expect(cancelJobTool.execute({ query: 'azure' }, request, signal)).rejects.toThrow(/Several running jobs/);
  });

  it('reconciles interrupted persisted work and serves API, event, and tool reads from the store', async () => {
    const jobs: BackgroundJob[] = [
      {
        jobId: '00000000-0000-4000-8000-000000000014',
        kind: 'research',
        title: 'Research: Restart regression',
        status: 'running',
        step: 1,
        steps: 3,
        detail: 'Searching: sources',
        startedAt: '2026-10-07T12:00:00.000Z',
        updatedAt: '2026-10-07T12:01:00.000Z',
      },
      {
        jobId: '00000000-0000-4000-8000-000000000015',
        kind: 'image',
        title: 'Image: Robot Butler',
        status: 'done',
        step: 1,
        steps: 1,
        viewId: 'image-robot-result',
        startedAt: '2026-10-07T11:00:00.000Z',
        updatedAt: '2026-10-07T11:05:00.000Z',
      },
    ];
    const store: BackgroundJobStore = {
      create: vi.fn(async () => true),
      update: vi.fn(async (job) => job),
      updateResultDelivery: vi.fn(async (jobId, resultDelivery) => {
        const job = jobs.find((candidate) => candidate.jobId === jobId);
        if (!job?.resultId) return null;
        Object.assign(job, { resultDelivery });
        return job;
      }),
      list: vi.fn(async () => jobs),
      get: vi.fn(async (jobId) => {
        const job = jobs.find((candidate) => candidate.jobId === jobId);
        return job ? {
          details: {
            job,
            steps: [{
              status: job.status,
              step: job.step,
              ...(job.detail ? { detail: job.detail } : {}),
              ...(job.viewId ? { viewId: job.viewId } : {}),
              updatedAt: job.updatedAt,
            }],
            ...(job.status === 'failed' && job.detail ? { error: job.detail } : {}),
            ...(job.viewId ? { resultWindow: job.viewId } : {}),
            retryable: false,
          },
        } : null;
      }),
      reconcileInterrupted: vi.fn(async () => {
        const interrupted = jobs.filter((job) => job.status === 'running').map((job) => ({
          ...job, status: 'failed' as const, detail: 'interrupted by restart',
        }));
        for (const job of interrupted) jobs[jobs.findIndex((existing) => existing.jobId === job.jobId)] = job;
        return interrupted;
      }),
      prune: vi.fn(async () => {}),
    };
    const app = fixture(config.auth.ownerObjectId, store);
    const events: BackgroundJob[] = [];
    app.jarvisActivityHub.subscribe((event) => { if (event.type === 'job') events.push(event.job); });

    const response = await app.inject({ url: '/jobs', headers });
    expect(response.statusCode).toBe(200);
    expect(store.reconcileInterrupted).toHaveBeenCalledOnce();
    expect(response.json().jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'failed', detail: 'interrupted by restart' }),
      expect.objectContaining({ status: 'done', viewId: 'image-robot-result' }),
    ]));
    expect(events).toEqual([expect.objectContaining({ status: 'failed', detail: 'interrupted by restart' })]);

    const listed = await listJobsTool.execute({}, { server: app } as unknown as FastifyRequest, new AbortController().signal);
    expect(listed).toMatchObject({
      running: [],
      finished: [
        { title: 'Research: Restart regression', status: 'failed', detail: 'interrupted by restart' },
        { title: 'Image: Robot Butler', status: 'done', resultWindow: 'image-robot-result' },
      ],
    });
    expect(store.list).toHaveBeenCalled();
  });

  it('allows failure persistence after an earlier store write fails', async () => {
    const hub: JarvisActivityHub = createEventHub();
    const events: BackgroundJob[] = [];
    hub.subscribe((event) => { if (event.type === 'job') events.push(event.job); });
    const store: BackgroundJobStore = {
      create: vi.fn(async () => true),
      update: vi.fn()
        .mockRejectedValueOnce(new Error('database unavailable'))
        .mockImplementation(async (job: BackgroundJob) => job),
      updateResultDelivery: vi.fn(async () => null),
      list: vi.fn(async () => []),
      get: vi.fn(async () => null),
      reconcileInterrupted: vi.fn(async () => []),
      prune: vi.fn(async () => {}),
    };
    const registry = new BackgroundJobRegistry(hub, Date.now, store);
    const job = await registry.start('research', 'Research: Store recovery', 2);

    await expect(job.progress(1, 'Searching: sources')).rejects.toThrow('database unavailable');
    await job.fail('Research could not be completed.');

    expect(store.update).toHaveBeenCalledTimes(2);
    expect(events.map((event) => event.status)).toEqual(['running', 'failed']);
    expect(events.at(-1)).toMatchObject({ detail: 'Research could not be completed.' });
  });
});
