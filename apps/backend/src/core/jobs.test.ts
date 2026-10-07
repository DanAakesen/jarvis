import { afterEach, describe, expect, it, vi } from 'vitest';
import { isBackgroundJob, type BackgroundJob } from '@jarvis/contracts';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier } from '../auth/verify.js';
import { createEventHub } from './event-hub.js';
import { BackgroundJobRegistry, cancelJobTool, listJobsTool } from './jobs.js';
import type { FastifyRequest } from 'fastify';
import { ToolRefusal } from './tool-registry.js';
import type { JarvisActivityHub } from './activity.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: `${['Bear', 'er'].join('')} ${['e30', 'e30', 'sig'].join('.')}` };
const apps: ReturnType<typeof buildApp>[] = [];

function fixture(objectId = config.auth.ownerObjectId) {
  const auth: TokenVerifier = async () => ({ objectId, tenantId: config.auth.tenantId, displayName: 'Dan' });
  const app = buildApp(config, undefined, { auth });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('background jobs', () => {
  it('publishes bounded, contract-valid job changes and ignores updates after the job ends', () => {
    const hub: JarvisActivityHub = createEventHub();
    const events: BackgroundJob[] = [];
    hub.subscribe((event) => { if (event.type === 'job') events.push(event.job); });
    let time = Date.parse('2026-10-07T12:00:00.000Z');
    const registry = new BackgroundJobRegistry(hub, () => time);

    const job = registry.start('research', `Research: ${'x'.repeat(200)}`, 3, undefined, 'Starting');
    time += 1_000;
    job.progress(1, 'Searching: key facts\nwith a newline');
    job.progress(9);
    job.done('research-abc', 'Report ready');
    job.fail('too late');

    expect(events.map((event) => event.status)).toEqual(['running', 'running', 'running', 'done']);
    expect(events.every((event) => isBackgroundJob(event))).toBe(true);
    expect(events[0]!.title.length).toBeLessThanOrEqual(80);
    expect(events[1]).toMatchObject({ step: 1, detail: 'Searching: key factswith a newline' });
    expect(events[2]).toMatchObject({ step: 3 });
    expect(events[2]).not.toHaveProperty('detail');
    expect(events[3]).toMatchObject({ step: 3, viewId: 'research-abc', updatedAt: '2026-10-07T12:00:01.000Z' });
    expect(registry.list()).toHaveLength(1);

    time += 11 * 60_000;
    expect(registry.list()).toEqual([]);
  });

  it('lists and cancels jobs for the owner only', async () => {
    const app = fixture();
    const cancel = vi.fn();
    const running = app.backgroundJobs.start('research', 'Research: Foundry IQ', 3, cancel);
    const fixed = app.backgroundJobs.start('image', 'Image: robot butler', 1);

    const list = await app.inject({ url: '/jobs', headers });
    expect(list.statusCode).toBe(200);
    expect(list.json().jobs.map((job: BackgroundJob) => job.jobId).sort()).toEqual([running.jobId, fixed.jobId].sort());

    expect((await app.inject({ method: 'POST', url: `/jobs/${fixed.jobId}/cancel`, headers })).statusCode).toBe(409);
    const cancelled = await app.inject({ method: 'POST', url: `/jobs/${running.jobId}/cancel`, headers });
    expect(cancelled.statusCode).toBe(202);
    expect(cancel).toHaveBeenCalledOnce();
    expect(app.backgroundJobs.list().find((job) => job.jobId === running.jobId)?.status).toBe('cancelled');
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
    const ignite = app.backgroundJobs.start('research', 'Research: Microsoft Ignite 2026', 3, stopIgnite);
    ignite.progress(1, 'Searching: Key findings');
    const foundry = app.backgroundJobs.start('research', 'Research: Foundry IQ', 3, vi.fn());
    foundry.done('research-foundry', 'Report ready');

    const listed = await listJobsTool.execute({}, request, signal) as {
      running: Array<Record<string, unknown>>; finished: Array<Record<string, unknown>>;
    };
    expect(listed.running).toEqual([expect.objectContaining({
      title: 'Research: Microsoft Ignite 2026', status: 'running', progress: '1/3', detail: 'Searching: Key findings',
    })]);
    expect(listed.finished).toEqual([expect.objectContaining({
      title: 'Research: Foundry IQ', status: 'done', resultWindow: 'research-foundry',
    })]);

    await expect(cancelJobTool.execute({ query: 'Foundry' }, request, signal)).rejects.toBeInstanceOf(ToolRefusal);
    await expect(cancelJobTool.execute({ query: 'ignite research' }, request, signal))
      .resolves.toMatchObject({ cancelled: 'Research: Microsoft Ignite 2026' });
    expect(stopIgnite).toHaveBeenCalledOnce();
    await expect(cancelJobTool.execute({ jobId: ignite.jobId }, request, signal)).rejects.toBeInstanceOf(ToolRefusal);

    app.backgroundJobs.start('research', 'Research: Azure pricing', 2, vi.fn());
    app.backgroundJobs.start('research', 'Research: Azure quotas', 2, vi.fn());
    await expect(cancelJobTool.execute({ query: 'azure' }, request, signal)).rejects.toThrow(/Several running jobs/);
  });
});