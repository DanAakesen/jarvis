import sql from 'mssql';
import {
  isBackgroundJob,
  isBackgroundJobDetails,
  isBackgroundJobStep,
  researchDepths,
  type BackgroundJob,
  type BackgroundJobDetails,
  type BackgroundJobStep,
  type ResearchDepth,
} from '@jarvis/contracts';

const retentionDays = 30;

interface BackgroundJobRow {
  job_id: string;
  kind: BackgroundJob['kind'];
  title: string;
  status: BackgroundJob['status'];
  step: number;
  steps: number;
  detail: string | null;
  view_id: string | null;
  started_at: Date | string;
  updated_at: Date | string;
  retry_input?: string | null;
  retry_job_id?: string | null;
}

interface BackgroundJobStepRow {
  status: BackgroundJob['status'];
  step: number;
  detail: string | null;
  view_id: string | null;
  updated_at: Date | string;
}

export interface ResearchJobRetryInput {
  topic: string;
  depth: ResearchDepth;
}

export interface StoredBackgroundJobDetails {
  details: BackgroundJobDetails;
  retryInput?: ResearchJobRetryInput;
}

export interface BackgroundJobStore {
  create(job: BackgroundJob, retryInput?: ResearchJobRetryInput, retryOf?: string): Promise<boolean>;
  update(job: BackgroundJob): Promise<BackgroundJob | null>;
  list(): Promise<BackgroundJob[]>;
  get(jobId: string): Promise<StoredBackgroundJobDetails | null>;
  reconcileInterrupted(): Promise<BackgroundJob[]>;
  prune(): Promise<void>;
}

function mapJob(row: BackgroundJobRow): BackgroundJob {
  const job: BackgroundJob = {
    jobId: row.job_id.toLowerCase(),
    kind: row.kind,
    title: row.title,
    status: row.status,
    step: row.step,
    steps: row.steps,
    ...(row.detail === null ? {} : { detail: row.detail }),
    ...(row.view_id === null ? {} : { viewId: row.view_id }),
    startedAt: row.started_at instanceof Date ? row.started_at.toISOString() : new Date(row.started_at).toISOString(),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
  };
  if (!isBackgroundJob(job)) throw new Error('Stored background job is invalid');
  return job;
}

function addJobInputs(request: sql.Request, job: BackgroundJob, retryInput?: ResearchJobRetryInput): sql.Request {
  return request
    .input('jobId', sql.NVarChar(36), job.jobId.toLowerCase())
    .input('kind', sql.NVarChar(16), job.kind)
    .input('title', sql.NVarChar(80), job.title)
    .input('status', sql.NVarChar(16), job.status)
    .input('step', sql.TinyInt, job.step)
    .input('steps', sql.TinyInt, job.steps)
    .input('detail', sql.NVarChar(120), job.detail ?? null)
    .input('viewId', sql.NVarChar(200), job.viewId ?? null)
    .input('startedAt', sql.DateTime2(7), new Date(job.startedAt))
    .input('updatedAt', sql.DateTime2(7), new Date(job.updatedAt))
    .input('retryInput', sql.NVarChar(sql.MAX), retryInput ? JSON.stringify(retryInput) : null);
}

function parseRetryInput(value: string | null | undefined): ResearchJobRetryInput | undefined {
  if (!value) return undefined;
  try {
    const input: unknown = JSON.parse(value);
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
    const record = input as Record<string, unknown>;
    if (Object.keys(record).some((key) => !['topic', 'depth'].includes(key)) ||
        typeof record.topic !== 'string' || !record.topic.trim() || record.topic.length > 2_000 ||
        typeof record.depth !== 'string' || !researchDepths.includes(record.depth as ResearchDepth)) return undefined;
    return { topic: record.topic, depth: record.depth as ResearchDepth };
  } catch {
    return undefined;
  }
}

function mapStep(row: BackgroundJobStepRow): BackgroundJobStep {
  const step: BackgroundJobStep = {
    status: row.status,
    step: row.step,
    ...(row.detail === null ? {} : { detail: row.detail }),
    ...(row.view_id === null ? {} : { viewId: row.view_id }),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
  };
  if (!isBackgroundJobStep(step)) throw new Error('Stored background job step is invalid');
  return step;
}

async function insertStep(transaction: sql.Transaction, job: BackgroundJob): Promise<void> {
  await new sql.Request(transaction)
    .input('jobId', sql.NVarChar(36), job.jobId.toLowerCase())
    .input('status', sql.NVarChar(16), job.status)
    .input('step', sql.TinyInt, job.step)
    .input('detail', sql.NVarChar(120), job.detail ?? null)
    .input('viewId', sql.NVarChar(200), job.viewId ?? null)
    .input('updatedAt', sql.DateTime2(7), new Date(job.updatedAt))
    .query(`INSERT dbo.background_job_steps (job_id, status, step, detail, view_id, updated_at)
      VALUES (@jobId, @status, @step, @detail, @viewId, @updatedAt);`);
}

async function pruneJobs(pool: sql.ConnectionPool): Promise<void> {
  await pool.request().query(`DELETE dbo.background_jobs
    WHERE started_at < DATEADD(day, -${retentionDays}, SYSUTCDATETIME());`);
}

export function createBackgroundJobStore(pool: sql.ConnectionPool): BackgroundJobStore {
  return {
    async create(job, retryInput, retryOf) {
      if (!isBackgroundJob(job)) throw new TypeError('Invalid background job');
      if (retryOf && (!retryInput || job.kind !== 'research')) {
        throw new TypeError('A retry needs its saved research input');
      }
      if (retryInput && (job.kind !== 'research' || !retryInput.topic.trim() ||
          retryInput.topic.length > 2_000 || !researchDepths.includes(retryInput.depth))) {
        throw new TypeError('Invalid research retry input');
      }
      await pruneJobs(pool);
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        let persistedRetryInput = retryInput;
        if (retryOf) {
          if (retryOf.toLowerCase() === job.jobId.toLowerCase()) throw new TypeError('A research job cannot retry itself');
          const { recordset, rowsAffected } = await new sql.Request(transaction)
            .input('retryOf', sql.NVarChar(36), retryOf.toLowerCase())
            .input('retryJobId', sql.NVarChar(36), job.jobId.toLowerCase())
            .query<{ retry_input: string }>(`UPDATE dbo.background_jobs SET retry_job_id = @retryJobId
              OUTPUT INSERTED.retry_input
              WHERE job_id = @retryOf AND kind = N'research' AND status = N'failed'
                AND retry_input IS NOT NULL AND retry_job_id IS NULL;`);
          const storedRetryInput = recordset[0] ? parseRetryInput(recordset[0].retry_input) : undefined;
          if (rowsAffected[0] !== 1 || !storedRetryInput) {
            await transaction.rollback();
            return false;
          }
          persistedRetryInput = storedRetryInput;
        }
        await addJobInputs(new sql.Request(transaction), job, persistedRetryInput).query(`INSERT dbo.background_jobs
          (job_id, kind, title, status, step, steps, detail, view_id, started_at, updated_at, retry_input)
          VALUES (@jobId, @kind, @title, @status, @step, @steps, @detail, @viewId, @startedAt, @updatedAt, @retryInput);`);
        await insertStep(transaction, job);
        await transaction.commit();
        return true;
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    },
    async update(job) {
      if (!isBackgroundJob(job)) throw new TypeError('Invalid background job');
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        const { recordset } = await addJobInputs(new sql.Request(transaction), job).query<BackgroundJobRow>(`UPDATE dbo.background_jobs
          SET status = @status, step = @step, detail = @detail, view_id = @viewId, updated_at = @updatedAt
          OUTPUT INSERTED.job_id, INSERTED.kind, INSERTED.title, INSERTED.status, INSERTED.step,
            INSERTED.steps, INSERTED.detail, INSERTED.view_id, INSERTED.started_at, INSERTED.updated_at
          WHERE job_id = @jobId AND status = N'running';`);
        const updated = recordset[0] ? mapJob(recordset[0]) : null;
        if (updated) await insertStep(transaction, updated);
        await transaction.commit();
        return updated;
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    },
    async list() {
      await pruneJobs(pool);
      const { recordset } = await pool.request().query<BackgroundJobRow>(`SELECT job_id, kind, title, status, step, steps,
        detail, view_id, started_at, updated_at
        FROM dbo.background_jobs
        WHERE started_at >= DATEADD(day, -${retentionDays}, SYSUTCDATETIME())
        ORDER BY started_at DESC;`);
      return recordset.map(mapJob);
    },
    async get(jobId) {
      const { recordset } = await pool.request()
        .input('jobId', sql.NVarChar(36), jobId.toLowerCase())
        .query<BackgroundJobRow>(`SELECT job_id, kind, title, status, step, steps, detail, view_id, started_at,
          updated_at, retry_input, retry_job_id
          FROM dbo.background_jobs WHERE job_id = @jobId
            AND started_at >= DATEADD(day, -${retentionDays}, SYSUTCDATETIME());`);
      const row = recordset[0];
      if (!row) return null;
      const job = mapJob(row);
      const { recordset: stepRows } = await pool.request()
        .input('jobId', sql.NVarChar(36), job.jobId)
        .query<BackgroundJobStepRow>(`SELECT TOP (100) status, step, detail, view_id, updated_at
          FROM dbo.background_job_steps WHERE job_id = @jobId ORDER BY id DESC;`);
      const steps = stepRows.reverse().map(mapStep);
      const retryInput = parseRetryInput(row.retry_input);
      const details: BackgroundJobDetails = {
        job,
        steps,
        ...(job.status === 'failed' && job.detail ? { error: job.detail } : {}),
        ...(job.viewId ? { resultWindow: job.viewId } : {}),
        retryable: job.kind === 'research' && job.status === 'failed' &&
          retryInput !== undefined && row.retry_job_id == null,
      };
      if (!isBackgroundJobDetails(details)) throw new Error('Stored background job details are invalid');
      return { details, ...(retryInput ? { retryInput } : {}) };
    },
    async reconcileInterrupted() {
      await pruneJobs(pool);
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        const { recordset } = await new sql.Request(transaction).query<BackgroundJobRow>(`UPDATE dbo.background_jobs
          SET status = N'failed', detail = N'interrupted by restart', updated_at = SYSUTCDATETIME()
          OUTPUT INSERTED.job_id, INSERTED.kind, INSERTED.title, INSERTED.status, INSERTED.step,
            INSERTED.steps, INSERTED.detail, INSERTED.view_id, INSERTED.started_at, INSERTED.updated_at
          WHERE status = N'running';`);
        const jobs = recordset.map(mapJob);
        for (const job of jobs) await insertStep(transaction, job);
        await transaction.commit();
        return jobs;
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    },
    async prune() {
      await pruneJobs(pool);
    },
  };
}
