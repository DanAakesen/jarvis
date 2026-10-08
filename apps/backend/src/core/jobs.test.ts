import { afterEach, describe, expect, it, vi } from 'vitest';
import { isBackgroundJob, type BackgroundJob } from '@jarvis/contracts';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier } from '../auth/verify.js';
import { createEventHub } from './event-hub.js';
import { BackgroundJobRegistry, cancelJobTool, getJobTool, listJobsTool } from './jobs.js';
import type { FastifyRequest } from 'fastify';
import { ToolRefusal } from './tool-registry.js';
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

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});


describe('background jobs', () => {
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
