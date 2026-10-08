import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  isBackgroundJob,
  isBackgroundJobDetails,
  type BackgroundJob,
  type BackgroundJobDetails,
  type BackgroundJobKind,
  type BackgroundJobStep,
} from '@jarvis/contracts';
import type { JarvisActivityHub } from './activity.js';
import { ToolRefusal, type JarvisTool } from './tool-registry.js';
import type {
  BackgroundJobStore,
  ResearchJobRetryInput,
  StoredBackgroundJobDetails,
} from '../database/background-job-store.js';

const retentionMs = 30 * 24 * 60 * 60_000;
const jobIdPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;

function bounded(text: string, maximum: number): string {
  const clean = Array.from(text.trim()).filter((character) => {
    const code = character.charCodeAt(0);
    return code >= 32 && code !== 127;
  }).join('');
  return clean.length > maximum ? `${clean.slice(0, maximum - 1).trimEnd()}\u2026` : clean;
}

export interface BackgroundJobStartOptions {
  retryInput?: ResearchJobRetryInput;
  retryOf?: string;
}

export interface BackgroundJobHandle {
  readonly jobId: string;
  progress(step: number, detail?: string): Promise<void>;
  done(viewId: string, detail?: string): Promise<void>;
  fail(detail: string): Promise<void>;
}

interface TrackedJob {
  job: BackgroundJob;
  steps: BackgroundJobStep[];
  retryInput?: ResearchJobRetryInput;
  retryJobId?: string;
  cancel?: () => void;
  finishedAt?: number;
  pending: Promise<void>;
}

/** Tracks local cancellation while SQL owns the durable job state and history. */
export class BackgroundJobRegistry {
  private readonly jobs = new Map<string, TrackedJob>();

  constructor(
    private readonly hub: JarvisActivityHub,
    private readonly now: () => number = Date.now,
    private readonly store?: BackgroundJobStore,
  ) {}

  async initialize(): Promise<void> {
    for (const job of await this.store?.reconcileInterrupted() ?? []) this.publish(job);
  }

  async start(
    kind: BackgroundJobKind,
    title: string,
    steps: number,
    cancel?: () => void,
    detail?: string,
    options: BackgroundJobStartOptions = {},
  ): Promise<BackgroundJobHandle> {
    const retryOf = options.retryOf?.toLowerCase();
    if ((options.retryInput && kind !== 'research') ||
        (retryOf && (!jobIdPattern.test(retryOf) || !options.retryInput || kind !== 'research'))) {
      throw new TypeError('Invalid background job retry options');
    }
    const at = new Date(this.now()).toISOString();
    const jobId = randomUUID();
    const job: BackgroundJob = {
      jobId,
      kind,
      title: bounded(title, 80) || 'Background task',
      status: 'running',
      step: 0,
      steps: Math.min(Math.max(Math.trunc(steps), 1), 20),
      ...(detail ? { detail: bounded(detail, 120) } : {}),
      startedAt: at,
      updatedAt: at,
    };
    if (retryOf && !this.store) {
      const source = this.jobs.get(retryOf);
      if (!source || source.job.kind !== 'research' || source.job.status !== 'failed' ||
          !source.retryInput || source.retryJobId) {
        throw new ToolRefusal('This research job can no longer be retried.');
      }
    }
    const created = await this.store?.create(job, options.retryInput, retryOf) ?? true;
    if (!created) throw new ToolRefusal('This research job can no longer be retried.');
    if (retryOf && !this.store) this.jobs.get(retryOf)!.retryJobId = jobId;
    const initialStep: BackgroundJobStep = {
      status: job.status,
      step: job.step,
      ...(job.detail ? { detail: job.detail } : {}),
      updatedAt: job.updatedAt,
    };
    const tracked: TrackedJob = {
      job,
      steps: [initialStep],
      ...(options.retryInput ? { retryInput: options.retryInput } : {}),
      ...(cancel ? { cancel } : {}),
      pending: Promise.resolve(),
    };
    this.jobs.set(jobId, tracked);
    this.publish(tracked.job);
    return this.handle(tracked);
  }

  async details(jobId: string): Promise<StoredBackgroundJobDetails | null> {
    if (!jobIdPattern.test(jobId)) return null;
    const stored = await this.store?.get(jobId);
    if (stored) {
      if (!isBackgroundJobDetails(stored.details)) throw new Error('Stored background job details are invalid');
      return stored;
    }
    const tracked = this.jobs.get(jobId.toLowerCase());
    if (!tracked) return null;
    const details: BackgroundJobDetails = {
      job: tracked.job,
      steps: tracked.steps.slice(-100),
      ...(tracked.job.status === 'failed' && tracked.job.detail ? { error: tracked.job.detail } : {}),
      ...(tracked.job.viewId ? { resultWindow: tracked.job.viewId } : {}),
      retryable: tracked.job.kind === 'research' && tracked.job.status === 'failed' &&
        tracked.retryInput !== undefined && tracked.retryJobId === undefined,
    };
    if (!isBackgroundJobDetails(details)) throw new Error('Background job details are invalid');
    return { details, ...(tracked.retryInput ? { retryInput: tracked.retryInput } : {}) };
  }

  private handle(tracked: TrackedJob): BackgroundJobHandle {
    return {
      jobId: tracked.job.jobId,
      progress: async (step, stepDetail) => {
        await this.update(tracked, {
          step: Math.min(Math.max(Math.trunc(step), 0), tracked.job.steps),
          ...(stepDetail ? { detail: stepDetail } : {}),
        });
      },
      done: async (viewId, doneDetail) => {
        await this.update(tracked, {
          status: 'done',
          step: tracked.job.steps,
          viewId,
          ...(doneDetail ? { detail: doneDetail } : {}),
        });
      },
      fail: async (failDetail) => { await this.update(tracked, { status: 'failed', detail: failDetail }); },
    };
  }

  async list(): Promise<BackgroundJob[]> {
    this.prune();
    const jobs = await this.store?.list() ?? [...this.jobs.values()].map(({ job }) => job)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    for (const job of jobs) {
      const tracked = this.jobs.get(job.jobId);
      if (tracked && Date.parse(job.updatedAt) >= Date.parse(tracked.job.updatedAt)) tracked.job = job;
    }
    return jobs;
  }

  async cancel(jobId: string): Promise<'cancelled' | 'not-found' | 'finished' | 'not-cancellable'> {
    const job = (await this.list()).find((candidate) => candidate.jobId === jobId);
    if (!job) return 'not-found';
    if (job.status !== 'running') return 'finished';
    const tracked = this.jobs.get(jobId);
    if (!tracked?.cancel) return 'not-cancellable';
    const changed = await this.update(tracked, { status: 'cancelled' });
    if (!changed) return 'finished';
    tracked.cancel();
    return 'cancelled';
  }

  private update(tracked: TrackedJob, change: Partial<BackgroundJob>): Promise<boolean> {
    let changed = false;
    const operation = tracked.pending.then(async () => {
      if (tracked.job.status !== 'running') return;
      const { detail: nextDetail, ...rest } = change;
      const next: BackgroundJob = { ...tracked.job, ...rest, updatedAt: new Date(this.now()).toISOString() };
      if (nextDetail === undefined) delete next.detail;
      else next.detail = bounded(nextDetail, 120);
      const job = await this.store?.update(next) ?? (this.store ? null : next);
      if (!job) return;
      tracked.job = job;
      const historyStep: BackgroundJobStep = {
        status: job.status,
        step: job.step,
        ...(job.detail ? { detail: job.detail } : {}),
        ...(job.viewId ? { viewId: job.viewId } : {}),
        updatedAt: job.updatedAt,
      };
      tracked.steps = [...tracked.steps, historyStep].slice(-100);
      if (job.status !== 'running') tracked.finishedAt = this.now();
      changed = true;
      this.publish(job);
    });
    tracked.pending = operation.catch(() => {});
    return operation.then(() => changed);
  }

  private publish(job: BackgroundJob): void {
    if (isBackgroundJob(job)) this.hub.publish({ type: 'job', job });
  }

  private prune(): void {
    const cutoff = this.now() - retentionMs;
    for (const [jobId, tracked] of this.jobs) {
      if (tracked.finishedAt !== undefined && tracked.finishedAt < cutoff) this.jobs.delete(jobId);
    }
  }
}

const jobIdSchema = { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' };

export function registerJobRoutes(app: FastifyInstance): void {
  const isOwner = (objectId: string | undefined) =>
    objectId !== undefined && objectId.toLowerCase() === app.ownerObjectId.toLowerCase();

  app.get('/jobs', async (request, reply) => {
    if (!isOwner(request.principal?.objectId)) return reply.code(403).send({ error: 'Forbidden' });
    reply.header('Cache-Control', 'no-store');
    return { jobs: await app.backgroundJobs.list() };
  });

  app.post<{ Params: { jobId: string } }>('/jobs/:jobId/cancel', {
    schema: { params: { type: 'object', properties: { jobId: jobIdSchema }, required: ['jobId'] } },
  }, async (request, reply) => {
    if (!isOwner(request.principal?.objectId)) return reply.code(403).send({ error: 'Forbidden' });
    const result = await app.backgroundJobs.cancel(request.params.jobId);
    if (result === 'not-found') return reply.code(404).send({ error: 'Job not found' });
    if (result === 'finished') return reply.code(409).send({ error: 'Job already finished' });
    if (result === 'not-cancellable') return reply.code(409).send({ error: 'Job cannot be cancelled' });
    return reply.code(202).send({ status: 'cancelled' });
  });
}

function describeJob(job: BackgroundJob, now: number): Record<string, unknown> {
  const ageSeconds = Math.max(0, Math.round((now - Date.parse(job.startedAt)) / 1000));
  return {
    jobId: job.jobId,
    kind: job.kind,
    title: job.title,
    status: job.status,
    progress: `${job.step}/${job.steps}`,
    ...(job.detail ? { detail: job.detail } : {}),
    ...(job.viewId ? { resultWindow: job.viewId } : {}),
    startedSecondsAgo: ageSeconds,
  };
}

/** Lets Jarvis answer "how is the research going?" from the same state the shell's job tabs show. */
export const listJobsTool: JarvisTool = {
  name: 'list_jobs',
  description: 'List Jarvis background jobs (research, images, HTML apps) shown in the job tabs: running jobs with ' +
    'progress and current step, and jobs finished in the last 30 days (done with their result window, failed with ' +
    'the reason, or cancelled). Use it whenever Dan asks about a running or recent background task.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  reflexSafe: true,
  execute: async (_input, request) => {
    const now = Date.now();
    const jobs = await request.server.backgroundJobs.list();
    return {
      running: jobs.filter((job) => job.status === 'running').map((job) => describeJob(job, now)),
      finished: jobs.filter((job) => job.status !== 'running').map((job) => describeJob(job, now)),
    };
  },
};

export const getJobTool: JarvisTool = {
  name: 'get_job',
  description: 'Get a background job by jobId, including its bounded step history, failure reason, result window, and retry availability.',
  inputSchema: {
    type: 'object',
    properties: { jobId: jobIdSchema },
    required: ['jobId'],
    additionalProperties: false,
  },
  reflexSafe: true,
  execute: async (input, request) => {
    const { jobId } = (input ?? {}) as { jobId?: string };
    if (!jobId || !jobIdPattern.test(jobId)) throw new ToolRefusal('A valid background job ID is required.');
    const stored = await request.server.backgroundJobs.details(jobId);
    if (!stored) throw new ToolRefusal('No background job matches that ID.');
    return stored.details;
  },
};

function matchingJobs(jobs: readonly BackgroundJob[], query: string): BackgroundJob[] {
  const words = query.toLowerCase().split(/\s+/u).filter((word) => word.length > 1 && word !== 'research');
  if (words.length === 0) return [...jobs];
  return jobs.filter((job) => {
    const title = job.title.toLowerCase();
    return words.every((word) => title.includes(word));
  });
}

/** Cancels a running job by id or by words from its title ("stop the Ignite research"). */
export const cancelJobTool: JarvisTool = {
  name: 'cancel_job',
  description: 'Cancel a running background job. Pass jobId from list_jobs, or query with words from its title ' +
    '(for example "Ignite"). Cancelling only stops the work; nothing else is changed, so no confirmation is needed. ' +
    'If several running jobs match, ask Dan which one.',
  inputSchema: {
    type: 'object',
    properties: {
      jobId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' },
      query: { type: 'string', minLength: 1, maxLength: 120 },
    },
    additionalProperties: false,
  },
  execute: async (input, request) => {
    const { jobId, query } = (input ?? {}) as { jobId?: string; query?: string };
    const running = (await request.server.backgroundJobs.list()).filter((job) => job.status === 'running');
    let target: BackgroundJob | undefined;
    if (jobId) {
      target = running.find((job) => job.jobId.toLowerCase() === jobId.toLowerCase());
    } else {
      const matches = matchingJobs(running, query ?? '');
      if (matches.length > 1) {
        throw new ToolRefusal(`Several running jobs match: ${matches.map((job) => job.title).join('; ')}. Ask Dan which one.`);
      }
      target = matches[0];
    }
    if (!target) throw new ToolRefusal('No running background job matches that.');
    const result = await request.server.backgroundJobs.cancel(target.jobId);
    if (result !== 'cancelled') throw new ToolRefusal(`"${target.title}" cannot be cancelled (${result}).`);
    return { cancelled: target.title, confirmation: `Cancelled ${target.title}.` };
  },
};
