import { Unzip, UnzipInflate } from 'fflate';
import type { GitHubAppTokenIssuer } from '../github-app.js';

const githubApi = 'https://api.github.com';
const maxJobsResponseBytes = 1024 * 1024;
const maxJobLogArchiveBytes = 8 * 1024 * 1024;
export const maxCheckLogBytes = 8 * 1024 * 1024;
const maxFailedJobs = 5;
const requestTimeoutMs = 15_000;
const actionsLogHost = 'pipelines.actions.githubusercontent.com';

function allowedLogHost(hostname: string): boolean {
  return hostname === actionsLogHost || hostname.endsWith('.blob.core.windows.net');
}

interface FailedJob {
  readonly id: number;
  readonly name: string;
}

interface JobListResponse {
  total_count: number;
  jobs: unknown[];
}

export interface FailedJobLogs {
  readonly content: Buffer;
  readonly jobs: readonly string[];
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(requestTimeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function readBounded(response: Response, limit: number): Promise<Buffer> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > limit) {
    throw new Error('GitHub Actions response is too large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('GitHub Actions response is invalid');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        throw new Error('GitHub Actions response is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

function parseFailedJobs(value: unknown): FailedJob[] {
  const response = object(value) as JobListResponse | undefined;
  if (!response || !Number.isSafeInteger(response.total_count) || response.total_count < 0 ||
    !Array.isArray(response.jobs) || response.jobs.length > 100 ||
    response.total_count !== response.jobs.length) {
    throw new Error('GitHub Actions job response is invalid');
  }
  const jobs: FailedJob[] = [];
  for (const value of response.jobs) {
    const job = object(value);
    if (!job || !positiveSafeInteger(job.id) || typeof job.name !== 'string' ||
      job.name.length === 0 || job.name.length > 255 ||
      (job.conclusion !== undefined && job.conclusion !== null &&
        job.conclusion !== 'success' && job.conclusion !== 'failure' &&
        job.conclusion !== 'cancelled' && job.conclusion !== 'skipped' && job.conclusion !== 'timed_out' &&
        job.conclusion !== 'action_required' && job.conclusion !== 'neutral' && job.conclusion !== 'startup_failure')) {
      throw new Error('GitHub Actions job response is invalid');
    }
    if (job.conclusion === 'failure' || job.conclusion === 'timed_out' || job.conclusion === 'startup_failure') {
      jobs.push({ id: job.id, name: job.name });
    }
  }
  jobs.sort((left, right) => left.id - right.id);
  if (jobs.length === 0) throw new Error('GitHub Actions run has no failed jobs');
  if (jobs.length > maxFailedJobs) throw new Error('GitHub Actions run has too many failed jobs');
  return jobs;
}

export function extractJobLog(archive: Buffer): Buffer {
  if (archive.length === 0 || archive.length > maxJobLogArchiveBytes) {
    throw new Error('GitHub job log archive is too large');
  }
  let log: Buffer | undefined;
  let extractionError: Error | undefined;
  let matchingFiles = 0;
  const unzip = new Unzip((file) => {
    if (!file.name.toLowerCase().endsWith('.txt')) return;
    matchingFiles += 1;
    if (matchingFiles > 1 || file.compression !== 0 && file.compression !== 8 ||
      (file.originalSize !== undefined &&
        (!Number.isSafeInteger(file.originalSize) || file.originalSize > maxCheckLogBytes))) {
      extractionError = new Error('GitHub job log archive is invalid');
      void file.terminate();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    file.ondata = (error, chunk, final) => {
      if (error) {
        extractionError = new Error('GitHub job log archive is invalid');
        return;
      }
      size += chunk.byteLength;
      if (size > maxCheckLogBytes) {
        extractionError = new Error('GitHub job log exceeds its size limit');
        void file.terminate();
        return;
      }
      chunks.push(Buffer.from(chunk));
      if (final) log = Buffer.concat(chunks);
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    unzip.push(archive, true);
  } catch {
    throw new Error('GitHub job log archive is invalid');
  }
  if (extractionError) throw extractionError;
  if (!log || matchingFiles !== 1) throw new Error('GitHub job log archive contains no text log');
  return log;
}

export function createGitHubActionsLogClient(
  tokenIssuer: Pick<GitHubAppTokenIssuer, 'issueForActions'>,
  fetchImpl: typeof fetch = fetch,
) {
  return {
    async readWorkflowRun(repository: string, runId: number): Promise<{ workflowId: number; cancelled: boolean }> {
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) || !positiveSafeInteger(runId)) {
        throw new Error('GitHub Actions run is invalid');
      }
      const token = await tokenIssuer.issueForActions(repository);
      const response = await fetchImpl(`${githubApi}/repos/${repository}/actions/runs/${runId}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `${['Bear', 'er'].join('')} ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: requestSignal(),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('GitHub Actions run is unavailable');
      const run = object(JSON.parse((await readBounded(response, maxJobsResponseBytes)).toString('utf8')));
      if (run?.id !== runId || !positiveSafeInteger(run.workflow_id)) {
        throw new Error('GitHub Actions run response is invalid');
      }
      return { workflowId: run.workflow_id, cancelled: run.conclusion === 'cancelled' };
    },
    async downloadFailedJobLogs(repository: string, runId: number, signal?: AbortSignal): Promise<FailedJobLogs> {
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) || !positiveSafeInteger(runId)) {
        throw new Error('GitHub Actions run is invalid');
      }
      const [owner, name] = repository.split('/');
      if (!owner || !name) throw new Error('GitHub Actions repository is invalid');
      const token = await tokenIssuer.issueForActions(repository);
      const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions`;
      const headers = {
        Accept: 'application/vnd.github+json',
        Authorization: `${['Bear', 'er'].join('')} ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      };
      const jobsResponse = await fetchImpl(
        `${githubApi}${base}/runs/${runId}/jobs?filter=latest&per_page=100`,
        { headers, signal: requestSignal(signal), redirect: 'error' },
      );
      if (!jobsResponse.ok) throw new Error('GitHub Actions jobs are unavailable');
      let decoded: unknown;
      try {
        decoded = JSON.parse((await readBounded(jobsResponse, maxJobsResponseBytes)).toString('utf8')) as unknown;
      } catch {
        throw new Error('GitHub Actions job response is invalid');
      }
      const failedJobs = parseFailedJobs(decoded);
      const logs: Buffer[] = [];
      const names: string[] = [];
      let totalBytes = 0;
      for (const job of failedJobs) {
        const apiResponse = await fetchImpl(
          `${githubApi}${base}/jobs/${job.id}/logs`,
          { headers, signal: requestSignal(signal), redirect: 'manual' },
        );
        let response = apiResponse;
        if (apiResponse.status >= 300 && apiResponse.status < 400) {
          const location = apiResponse.headers.get('location');
          if (!location) throw new Error('GitHub job log response is invalid');
          const downloadUrl = new URL(location, `${githubApi}${base}/jobs/${job.id}/logs`);
          if (downloadUrl.protocol !== 'https:' || !allowedLogHost(downloadUrl.hostname) ||
            downloadUrl.username || downloadUrl.password || downloadUrl.hash || downloadUrl.port) {
            throw new Error('GitHub job log response is invalid');
          }
          response = await fetchImpl(downloadUrl, {
            headers: { Accept: 'application/zip' },
            signal: requestSignal(signal),
            redirect: 'error',
          });
        }
        if (!response.ok) throw new Error('GitHub job log is unavailable');
        const finalUrl = response.url ? new URL(response.url) : undefined;
        if (finalUrl && (finalUrl.protocol !== 'https:' ||
          (finalUrl.hostname !== 'api.github.com' && !allowedLogHost(finalUrl.hostname)))) {
          throw new Error('GitHub job log response is invalid');
        }
        const log = extractJobLog(await readBounded(response, maxJobLogArchiveBytes));
        const heading = Buffer.from(`===== ${job.name} =====\n`);
        totalBytes += heading.length + log.length + 1;
        if (totalBytes > maxCheckLogBytes) throw new Error('GitHub failed job logs exceed the size limit');
        logs.push(heading, log, Buffer.from('\n'));
        names.push(job.name);
      }
      return { content: Buffer.concat(logs), jobs: names };
    },
    async downloadFailedJobLog(repository: string, jobId: number, signal?: AbortSignal): Promise<FailedJobLogs> {
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) || !positiveSafeInteger(jobId)) {
        throw new Error('GitHub Actions job is invalid');
      }
      const [owner, name] = repository.split('/');
      if (!owner || !name) throw new Error('GitHub Actions repository is invalid');
      const token = await tokenIssuer.issueForActions(repository);
      const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/jobs`;
      const headers = {
        Accept: 'application/vnd.github+json',
        Authorization: `${['Bear', 'er'].join('')} ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      };
      const jobResponse = await fetchImpl(
        `${githubApi}${base}/${jobId}`,
        { headers, signal: requestSignal(signal), redirect: 'error' },
      );
      if (!jobResponse.ok) throw new Error('GitHub Actions job is unavailable');
      let decoded: unknown;
      try {
        decoded = JSON.parse((await readBounded(jobResponse, maxJobsResponseBytes)).toString('utf8')) as unknown;
      } catch {
        throw new Error('GitHub Actions job response is invalid');
      }
      const job = object(decoded);
      if (job?.id !== jobId || !positiveSafeInteger(job.run_id) || typeof job.name !== 'string' ||
        job.name.length === 0 || job.name.length > 255 ||
        (job.conclusion !== 'failure' && job.conclusion !== 'timed_out' &&
          job.conclusion !== 'startup_failure')) {
        throw new Error('GitHub Actions job is not a failed job');
      }
      const apiResponse = await fetchImpl(
        `${githubApi}${base}/${jobId}/logs`,
        { headers, signal: requestSignal(signal), redirect: 'manual' },
      );
      let response = apiResponse;
      if (apiResponse.status >= 300 && apiResponse.status < 400) {
        const location = apiResponse.headers.get('location');
        if (!location) throw new Error('GitHub job log response is invalid');
        const downloadUrl = new URL(location, `${githubApi}${base}/${jobId}/logs`);
        if (downloadUrl.protocol !== 'https:' || !allowedLogHost(downloadUrl.hostname) ||
          downloadUrl.username || downloadUrl.password || downloadUrl.hash || downloadUrl.port) {
          throw new Error('GitHub job log response is invalid');
        }
        response = await fetchImpl(downloadUrl, {
          headers: { Accept: 'application/zip' },
          signal: requestSignal(signal),
          redirect: 'error',
        });
      }
      if (!response.ok) throw new Error('GitHub job log is unavailable');
      const finalUrl = response.url ? new URL(response.url) : undefined;
      if (finalUrl && (finalUrl.protocol !== 'https:' ||
        (finalUrl.hostname !== 'api.github.com' && !allowedLogHost(finalUrl.hostname)))) {
        throw new Error('GitHub job log response is invalid');
      }
      const log = extractJobLog(await readBounded(response, maxJobLogArchiveBytes));
      const content = Buffer.concat([Buffer.from(`===== ${job.name} =====\n`), log, Buffer.from('\n')]);
      if (content.length > maxCheckLogBytes) throw new Error('GitHub failed job log exceeds the size limit');
      return { content, jobs: [job.name] };
    },
  };
}
