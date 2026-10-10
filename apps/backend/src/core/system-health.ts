import type { FastifyInstance } from 'fastify';
import type { SystemHealth, SystemHealthComponent, SystemStatusValue, WorkStatus } from '@jarvis/contracts';
import { systemSmokeCheckIds } from '@jarvis/contracts';
import { JARVIS_REPOSITORY } from '../factory/project-context.js';
import { ToolRefusal, type JarvisTool } from './tool-registry.js';

const hourMs = 60 * 60_000;
const staleMs = 5 * 60_000;
const subsystemIds = ['database', 'foundry.chat', 'foundry.voice', 'foundry.embeddings',
  'vault_index', 'github_app', 'google', 'pc_bridge', 'runner', 'deployed_commit', 'last_error'] as const;
const credentialNames = ['codex-login', 'copilot-token', 'github-app', 'github-app-key'] as const;

/** Bounded process-local diagnostics contain counts and verdicts, never tool input or result text. */
export class SystemHealthDiagnostics {
  private readonly buckets = new Map<number, { invalid: number; failed: number }>();
  private work?: { status: SystemStatusValue; checkedAt: string; detail: string };

  constructor(private readonly now: () => number = Date.now) {}

  record(kind: 'invalid' | 'failed'): void {
    const minute = Math.floor(this.now() / 60_000);
    this.prune(minute);
    const bucket = this.buckets.get(minute) ?? { invalid: 0, failed: 0 };
    bucket[kind] = Math.min(1_000, bucket[kind] + 1);
    this.buckets.set(minute, bucket);
  }

  counts(): { invalid: number; failed: number } {
    this.prune(Math.floor(this.now() / 60_000));
    return [...this.buckets.values()].reduce((sum, bucket) => ({
      invalid: Math.min(1_000, sum.invalid + bucket.invalid),
      failed: Math.min(1_000, sum.failed + bucket.failed),
    }), { invalid: 0, failed: 0 });
  }

  recordWork(status: WorkStatus): void {
    this.work = { status: status.partial ? 'unknown' : status.verdict === 'needs_attention' ? 'degraded' : 'ok',
      checkedAt: new Date(this.now()).toISOString(),
      detail: status.partial ? 'Latest work lookup was incomplete.' :
        status.verdict === 'needs_attention' ? 'Latest work lookup needs attention.' : 'Latest work lookup needs no attention.' };
  }

  peekWork() { return this.work; }

  private prune(minute: number): void {
    for (const key of this.buckets.keys()) if (key <= minute - 60) this.buckets.delete(key);
  }
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z$/u.test(value)) return null;
  const date = Date.parse(value);
  return Number.isFinite(date) ? new Date(date).toISOString() : null;
}

function statusValue(value: unknown): SystemStatusValue {
  return value === 'ok' || value === 'degraded' || value === 'down' ? value : 'unknown';
}

async function read<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  if (signal.aborted) return undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([operation(), new Promise<undefined>((resolve) => {
      abort = () => resolve(undefined);
      signal.addEventListener('abort', abort, { once: true });
    })]);
  } catch { return undefined; }
  finally { if (abort) signal.removeEventListener('abort', abort); }
}

export async function getSystemHealth(app: FastifyInstance, signal: AbortSignal,
  now = Date.now()): Promise<SystemHealth> {
  signal = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
  const components: SystemHealthComponent[] = [];
  const add = (id: string, status: SystemStatusValue, detail: string, checkedAt: unknown,
    recovery: SystemHealthComponent['recovery'] = [], freshness = false) => {
    const at = timestamp(checkedAt);
    if (freshness && status !== 'unknown' && (!at || now - Date.parse(at) > staleMs || Date.parse(at) > now)) {
      status = 'unknown';
      detail = 'Cached check is stale or has no valid timestamp.';
    }
    components.push({ id, status, detail, checkedAt: at,
      recovery: status === 'ok' ? [] : recovery.filter(({ tool }) => app.jarvisTools.get(tool)) });
  };
  let snapshot;
  try { snapshot = app.systemStatusReader.peek?.(); } catch { /* Missing cached state is unknown. */ }
  for (const id of subsystemIds) {
    const entry = snapshot?.entries.find((item) => item.id === id);
    const status = statusValue(entry?.status);
    const detail = !entry ? 'No verified cached check is available.' :
      entry.details?.configured === false ? 'Component is not configured.' :
      entry.details?.healthProbe === 'not_run' ? 'Runner health has not been probed.' :
      entry.details?.deploymentAvailable === false ? 'Required model deployment is unavailable.' :
      entry.details?.catalogue === 'fallback' ? 'Model catalogue is using fallback configuration.' :
      id === 'pc_bridge' && entry.details?.connected === false ? 'PC bridge is disconnected.' :
      id === 'vault_index' && status === 'degraded' ? 'Vault index is stale or embedding coverage is incomplete.' :
      status === 'unknown' ? 'No verified cached check is available.' :
      entry.details?.reason === 'check_failed' ? 'Component check failed.' :
      id === 'last_error' && status !== 'ok' ? 'An HTTP server error was recorded.' :
      status === 'ok' ? 'Cached component check passed.' :
      status === 'down' ? 'Cached component check failed.' : 'Cached component check reports reduced availability.';
    add(id, status, detail, entry?.checkedAt, [], true);
  }
  for (const id of systemSmokeCheckIds) {
    const entry = snapshot?.smoke?.entries.find((item) => item.id === id);
    const status = statusValue(entry?.status);
    add(`smoke.${id}`, status, status === 'unknown' ? 'No cached smoke check is available.' :
      status === 'ok' ? 'Cached smoke check passed.' : 'Cached smoke check did not pass.',
    entry?.checkedAt, [], true);
  }
  const [credentials, jobs, projects] = await Promise.all([
    app.credentialStatusStore ? read(() => app.credentialStatusStore!.list(), signal) : undefined,
    read(() => app.backgroundJobs.list(), signal),
    app.projectStore ? read(() => app.projectStore!.list(), signal) : undefined,
  ]);
  for (const name of credentialNames) {
    const credential = credentials?.find((item) => item.name === name);
    const expiry = timestamp(credential?.expiresAt);
    const expired = expiry !== null && Date.parse(expiry) <= now;
    const expiring = expiry !== null && Date.parse(expiry) <= now + 7 * 24 * hourMs;
    const status = !credential ? 'unknown' : expired || credential.status === 'failed' ? 'down' :
      credential.status === 'unknown' ? 'unknown' : expiring || credential.status === 'renew_soon' ? 'degraded' : 'ok';
    add(`credential.${name}`, status, expired ? 'Credential has expired.' :
      status === 'down' ? 'Credential check or renewal failed.' :
      status === 'degraded' ? 'Credential expires soon or needs renewal.' :
      status === 'ok' ? 'Stored credential status is healthy.' : 'Credential status is unavailable.',
    credential?.lastCheckedAt ?? credential?.lastRenewedAt,
    name === 'codex-login' ? [{ tool: 'renew_credential', description: 'Request renewal of codex-login; Now approval may be required.' }] : []);
  }
  const failed = jobs?.slice(0, 100).filter((job) => job.status === 'failed' &&
    timestamp(job.updatedAt) !== null && Date.parse(job.updatedAt) >= now - hourMs && Date.parse(job.updatedAt) <= now);
  let retryable = false;
  if (app.jarvisTools.get('retry_job')) {
    for (const job of (failed ?? []).slice(0, 5)) {
      const details = await read(() => app.backgroundJobs.details(job.jobId), signal);
      if (details?.details.retryable) { retryable = true; break; }
    }
  }
  add('background_jobs', failed ? failed.length ? 'degraded' : 'ok' : 'unknown',
    failed ? `${Math.min(100, failed.length)} failed background jobs in the last hour (up to 100 retained jobs).` :
      'Background job history is unavailable.', new Date(now).toISOString(),
    retryable ? [{ tool: 'retry_job', description: 'List failed jobs, then retry an eligible research job by jobId.' }] : []);

  const project = projects?.find((item) => item.active && item.repo.toLowerCase() === JARVIS_REPOSITORY.toLowerCase());
  const records = project && app.releaseViewStore
    ? await read(() => app.releaseViewStore!.read(project.id), signal) : undefined;
  const deployment = records?.deployments.filter((item) => item.environment.toLowerCase() === 'production')
    .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))[0];
  const run = records?.workflowRuns.filter((item) => ['deploy', 'deploy.yml', '.github/workflows/deploy.yml']
    .includes(item.workflow.toLowerCase())).sort((a, b) =>
    (b.startedAt ?? b.completedAt ?? '').localeCompare(a.startedAt ?? a.completedAt ?? '') || b.id.localeCompare(a.id))[0];
  const useRun = run && (!deployment || Date.parse(run.completedAt ?? run.startedAt ?? '') >= Date.parse(deployment.at));
  const deployStatus = useRun ? run.status !== 'completed' ? 'degraded' :
    run.conclusion === 'success' ? 'ok' : run.conclusion === null ? 'unknown' : 'down' :
    deployment ? deployment.status === 'success' ? 'ok' : deployment.status === 'failure' ? 'down' : 'degraded' : 'unknown';
  add('deployment', deployStatus, deployStatus === 'ok' ? 'Latest recorded production deployment succeeded.' :
    deployStatus === 'down' ? 'Latest recorded production deployment failed or was cancelled.' :
      deployStatus === 'degraded' ? 'Latest recorded production deployment is pending.' : 'No recorded production deployment result is available.',
  useRun ? run.completedAt ?? run.startedAt : deployment?.at,
  [{ tool: 'get_deployment_status', description: 'Read the latest deploy workflow for the Jarvis project.' }]);
  const work = app.systemHealthDiagnostics.peekWork();
  add('work', work?.status ?? 'unknown', work?.detail ?? 'No cached work-status lookup is available.', work?.checkedAt,
    [{ tool: 'get_work_status', description: 'Read work evidence using an issue number, task ID or short query.' }], true);
  const counts = app.systemHealthDiagnostics.counts();
  for (const [id, count] of [['tool.invalid_arguments', counts.invalid], ['tool.failures', counts.failed]] as const) {
    add(id, count ? 'degraded' : 'ok', `${count === 1_000 ? '1000 or more' : count} events in the last hour of this backend process.`,
      new Date(now).toISOString());
  }
  return { components };
}

export const getSystemHealthTool: JarvisTool = {
  name: 'get_system_health',
  description: 'Diagnose cached system and smoke checks, credential expiry, recent failed jobs, recorded deployment, work evidence and tool failure counts. Returns bounded safe reasons and available recovery tools only; never runs probes or repairs.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  reflexSafe: true,
  execute: async (input, request, signal) => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) {
      throw new ToolRefusal('System health request is invalid.');
    }
    if (!request.principal && !request.agentPrincipal) throw new ToolRefusal('System health requires an authenticated Jarvis identity.');
    return getSystemHealth(request.server, signal);
  },
};
