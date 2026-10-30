import { ConfigurationError } from '../configuration-error.js';
import type { BackendLogsConfig } from './backend-logs.js';

export interface BackendLogProbeConfig extends BackendLogsConfig {
  readonly principalId: string;
  readonly foreignWorkspaceId?: string;
}

const guid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu;
const appName = /^ca-jarvis-backend-[a-z0-9]{1,32}$/u;
const resource = /^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[a-z0-9._()-]+\/providers\/Microsoft\.CognitiveServices\/accounts\/[a-z0-9-]+$/iu;

export function loadBackendLogProbeConfig(env: NodeJS.ProcessEnv): BackendLogProbeConfig | undefined {
  const workspaceId = env.JARVIS_BACKEND_LOGS_PROBE_WORKSPACE_ID || undefined;
  const principalId = env.JARVIS_BACKEND_LOGS_PROBE_PRINCIPAL_ID || undefined;
  const name = env.JARVIS_BACKEND_LOGS_PROBE_APP_NAME || undefined;
  const foreignWorkspaceId = env.JARVIS_BACKEND_LOGS_PROBE_FOREIGN_WORKSPACE_ID || undefined;
  if ([workspaceId, principalId, name, foreignWorkspaceId].every((value) => value === undefined)) return undefined;
  if (!workspaceId || !guid.test(workspaceId) || !principalId || !guid.test(principalId) || !name || !appName.test(name) ||
      (foreignWorkspaceId !== undefined && (!guid.test(foreignWorkspaceId) || foreignWorkspaceId.toLowerCase() === workspaceId.toLowerCase()))) {
    throw new ConfigurationError('Backend log authorization probe configuration is invalid');
  }
  return Object.freeze({ workspaceId, principalId, appName: name, ...(foreignWorkspaceId ? { foreignWorkspaceId } : {}) });
}

const verdicts = ['denied', 'no_visible_rows', 'backend_only', 'other_app_visible', 'query_allowed', 'not_configured', 'unavailable', 'bad_request', 'unauthenticated', 'not_found', 'throttled', 'timeout', 'invalid_response', 'rows_visible',
  'metadata_missing', 'metadata_invalid', 'resource_not_listed', 'no_data_sources', 'data_sources_not_listed',
  'resource_table_denied', 'data_source_table_denied', 'table_not_explicitly_denied'] as const;
type Verdict = typeof verdicts[number];
const checks = ['unfiltered_table', 'other_app', 'other_table', 'foreign_workspace', 'foundry_resource', 'foundry_permissions'] as const;
type Check = typeof checks[number];
export interface BackendLogAuthorizationSnapshot {
  readonly stage: 'authorization_observations';
  readonly checkedAt: string;
  readonly identity: 'matched' | 'mismatch' | 'unavailable';
  readonly checks: Record<Check, Verdict>;
}
export interface BackendLogAuthorizationProbe {
  read(): Promise<BackendLogAuthorizationSnapshot>;
}

export const backendLogAuthorizationSchema = {
  type: 'object', additionalProperties: false,
  required: ['stage', 'checkedAt', 'identity', 'checks'],
  properties: {
    stage: { const: 'authorization_observations' }, checkedAt: { type: 'string', format: 'date-time' },
    identity: { type: 'string', enum: ['matched', 'mismatch', 'unavailable'] },
    checks: { type: 'object', additionalProperties: false, required: checks,
      properties: Object.fromEntries(checks.map((key) => [key, { type: 'string', enum: verdicts }])) },
  },
} as const;

const deadlineMs = 8_000;
const responseBytes = 4_096;

async function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    })]);
  } finally { if (abort) signal.removeEventListener('abort', abort); }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function body(response: Response, signal: AbortSignal): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (!response.body || (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > responseBytes))) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error('Probe response unavailable');
  }
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const next = await bounded(reader.read(), signal);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > responseBytes) throw new Error('Probe response unavailable');
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function counts(value: unknown, expected: readonly string[]): number[] | undefined {
  if (!object(value) || value.error !== undefined || !Array.isArray(value.tables) || value.tables.length !== 1) return undefined;
  const table: unknown = value.tables[0];
  if (!object(table) || table.name !== 'PrimaryResult' || !Array.isArray(table.columns) || !Array.isArray(table.rows) ||
      table.columns.length !== expected.length || table.rows.length !== 1 || !Array.isArray(table.rows[0])) return undefined;
  const row = table.rows[0] as unknown[];
  if (row.length !== expected.length || !row.every((item) => Number.isSafeInteger(item) && Number(item) >= 0)) return undefined;
  if (!table.columns.every((column: unknown, index: number) => object(column) && column.name === expected[index] && column.type === 'long')) return undefined;
  return row as number[];
}

const workspaceResource = /^\/subscriptions\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\/resourceGroups\/[a-z0-9._()-]+\/providers\/Microsoft\.OperationalInsights\/workspaces\/[a-z0-9._()-]+$/iu;

/** Classify permission metadata in memory; never return its identifiers or provider text. */
function foundryPermissions(value: unknown, resourceId: string): Verdict {
  if (!object(value) || value.permissions === undefined) return 'metadata_missing';
  const permissions = value.permissions;
  if (!object(permissions) || Object.keys(permissions).some((key) => !['resources', 'dataSources'].includes(key)) ||
      !Array.isArray(permissions.resources) || !Array.isArray(permissions.dataSources) ||
      permissions.resources.length > 16 || permissions.dataSources.length > 16) return 'metadata_invalid';
  const deniedTables = (item: Record<string, unknown>) => item.denyTables === undefined || (Array.isArray(item.denyTables) &&
    item.denyTables.length <= 32 && item.denyTables.every((name: unknown) => typeof name === 'string' && /^[a-z][a-z0-9_.]{0,127}$/iu.test(name)));
  const validId = (id: unknown, pattern: RegExp): id is string => typeof id === 'string' && id.length <= 1_024 && pattern.test(id);
  const seen = new Set<string>();
  for (const item of permissions.resources) {
    if (!object(item) || Object.keys(item).some((key) => !['resourceId', 'dataSources', 'denyTables'].includes(key)) ||
        !validId(item.resourceId, resource) || seen.has(item.resourceId.toLowerCase()) || !deniedTables(item) ||
        !Array.isArray(item.dataSources) || item.dataSources.length > 16 ||
        !item.dataSources.every((id: unknown) => validId(id, workspaceResource)) ||
        new Set(item.dataSources.map((id: string) => id.toLowerCase())).size !== item.dataSources.length) return 'metadata_invalid';
    seen.add(item.resourceId.toLowerCase());
  }
  seen.clear();
  for (const item of permissions.dataSources) {
    if (!object(item) || Object.keys(item).some((key) => !['resourceId', 'denyTables'].includes(key)) ||
        !validId(item.resourceId, workspaceResource) || seen.has(item.resourceId.toLowerCase()) || !deniedTables(item)) return 'metadata_invalid';
    seen.add(item.resourceId.toLowerCase());
  }
  const target = permissions.resources.find((item: Record<string, unknown>) => (item.resourceId as string).toLowerCase() === resourceId.toLowerCase()) as Record<string, unknown> | undefined;
  if (!target) return 'resource_not_listed';
  const denies = (item: Record<string, unknown>) => (item.denyTables as string[] | undefined)?.some((name) => name.toLowerCase() === 'azurediagnostics') ?? false;
  if (denies(target)) return 'resource_table_denied';
  const sources = target.dataSources as string[];
  if (!sources.length) return 'no_data_sources';
  let missing = false;
  for (const id of sources) {
    const source = permissions.dataSources.find((item: Record<string, unknown>) => (item.resourceId as string).toLowerCase() === id.toLowerCase()) as Record<string, unknown> | undefined;
    if (!source) { missing = true; continue; }
    if (!denies(source)) return 'table_not_explicitly_denied';
  }
  return missing ? 'data_sources_not_listed' : 'data_source_table_denied';
}

/** Deployment-only observations. Empty negative queries never establish isolation. */
export function createBackendLogAuthorizationProbe(options: {
  config: BackendLogProbeConfig;
  foundryResourceId?: string;
  getToken: (signal: AbortSignal) => Promise<string>;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
}): BackendLogAuthorizationProbe {
  const config = loadBackendLogProbeConfig({
    JARVIS_BACKEND_LOGS_PROBE_WORKSPACE_ID: options.config.workspaceId,
    JARVIS_BACKEND_LOGS_PROBE_PRINCIPAL_ID: options.config.principalId,
    JARVIS_BACKEND_LOGS_PROBE_APP_NAME: options.config.appName,
    ...(options.config.foreignWorkspaceId ? { JARVIS_BACKEND_LOGS_PROBE_FOREIGN_WORKSPACE_ID: options.config.foreignWorkspaceId } : {}),
  })!;
  const foundryResourceId = options.foundryResourceId;
  if (foundryResourceId !== undefined && !resource.test(foundryResourceId)) throw new ConfigurationError('Invalid probe resource');
  const fetcher = options.fetch ?? globalThis.fetch;
  let active: Promise<BackendLogAuthorizationSnapshot> | undefined;
  let cached: BackendLogAuthorizationSnapshot | undefined;
  return { async read() {
    if (cached) return structuredClone(cached);
    active ??= (async () => {
      const now = (options.now ?? (() => new Date()))();
      const result: BackendLogAuthorizationSnapshot = { stage: 'authorization_observations', checkedAt: now.toISOString(), identity: 'unavailable',
        checks: { unfiltered_table: 'unavailable', other_app: 'unavailable', other_table: 'unavailable',
          foreign_workspace: config.foreignWorkspaceId ? 'unavailable' : 'not_configured',
          foundry_resource: foundryResourceId ? 'unavailable' : 'not_configured',
          foundry_permissions: foundryResourceId ? 'unavailable' : 'not_configured' } };
      const signal = AbortSignal.timeout(deadlineMs);
      try {
        const token = await bounded(options.getToken(signal), signal);
        if (token.length > 16_384 || !token) return result;
        const payload: unknown = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
        if (!object(payload) || typeof payload.oid !== 'string' || payload.oid.toLowerCase() !== config.principalId.toLowerCase()) {
          return { ...result, identity: 'mismatch' as const };
        }
        const matched = { ...result, identity: 'matched' as const };
        const start = new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString();
        const window = `| where TimeGenerated >= datetime(${start}) and TimeGenerated < datetime(${now.toISOString()})`;
        const endpoint = (workspace: string) => `https://api.loganalytics.azure.com/v1/workspaces/${workspace}/query`;
        const plans: { key: Check; url: string; query: string; columns: readonly string[] }[] = [
          { key: 'unfiltered_table', url: endpoint(config.workspaceId), query: `ContainerAppConsoleLogs_CL ${window} | summarize Backend=countif(ContainerAppName_s == '${config.appName}'), Other=countif(ContainerAppName_s != '${config.appName}')`, columns: ['Backend', 'Other'] },
          { key: 'other_app', url: endpoint(config.workspaceId), query: `ContainerAppConsoleLogs_CL ${window} | where ContainerAppName_s != '${config.appName}' | summarize Records=count()`, columns: ['Records'] },
          { key: 'other_table', url: endpoint(config.workspaceId), query: `AppTraces ${window} | summarize Records=count()`, columns: ['Records'] },
          ...(config.foreignWorkspaceId ? [{ key: 'foreign_workspace' as const, url: endpoint(config.foreignWorkspaceId), query: `Usage ${window} | summarize Records=count()`, columns: ['Records'] }] : []),
          ...(foundryResourceId ? [{ key: 'foundry_resource' as const, url: `https://api.loganalytics.azure.com/v1${foundryResourceId}/query`, query: `AzureDiagnostics ${window} | summarize Records=count()`, columns: ['Records'] }] : []),
        ];
        await Promise.all(plans.map(async (plan) => {
          try {
            const response = await bounded(fetcher(plan.url, { method: 'POST', signal, redirect: 'error',
              headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json',
                Prefer: plan.key === 'foundry_resource' ? 'wait=5, include-permissions=true' : 'wait=5' },
              body: JSON.stringify({ query: plan.query }) }), signal);
            if (!response.ok) {
              matched.checks[plan.key] = ({ 400: 'bad_request', 401: 'unauthenticated', 403: 'denied', 404: 'not_found',
                408: 'timeout', 429: 'throttled', 504: 'timeout' } as Record<number, Verdict>)[response.status] ?? 'unavailable';
              if (plan.key === 'foundry_resource') {
                try { matched.checks.foundry_permissions = foundryPermissions(await body(response, signal), foundryResourceId!); }
                catch { matched.checks.foundry_permissions = signal.aborted ? 'timeout' : 'unavailable'; }
              } else { void response.body?.cancel().catch(() => undefined); }
              return;
            }
            const value = await body(response, signal);
            if (plan.key === 'foundry_resource') matched.checks.foundry_permissions = foundryPermissions(value, foundryResourceId!);
            const row = counts(value, plan.columns);
            if (!row) { matched.checks[plan.key] = 'invalid_response'; return; }
            matched.checks[plan.key] = plan.key === 'unfiltered_table'
              ? row[1]! > 0 ? 'other_app_visible' : row[0]! > 0 ? 'backend_only' : 'no_visible_rows'
              : plan.key === 'foreign_workspace' || plan.key === 'foundry_resource' ? 'query_allowed'
                : row[0]! > 0 ? plan.key === 'other_app' ? 'other_app_visible' : 'rows_visible' : 'no_visible_rows';
          } catch {
            matched.checks[plan.key] = signal.aborted ? 'timeout' : 'unavailable';
            if (plan.key === 'foundry_resource') matched.checks.foundry_permissions = matched.checks[plan.key];
          }
        }));
        return matched;
      } catch { return result; }
    })();
    cached = await active;
    return structuredClone(cached);
  } };
}
