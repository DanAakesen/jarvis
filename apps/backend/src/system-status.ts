import type {
  SystemStatus,
  SystemStatusEntry,
  SystemStatusSubsystem,
  SystemStatusValue,
  SystemSmokeCheckId,
  SystemSmokeStatus,
} from '@jarvis/contracts';
import { systemSmokeCheckIds } from '@jarvis/contracts';

export type SystemStatusResult = Pick<SystemStatusEntry, 'status' | 'details'>;

export type SystemStatusProbe = () => Promise<SystemStatusResult>;

export interface SystemStatusProbes {
  readonly database?: SystemStatusProbe;
  readonly 'foundry.chat'?: SystemStatusProbe;
  readonly 'foundry.voice'?: SystemStatusProbe;
  readonly 'foundry.embeddings'?: SystemStatusProbe;
  readonly vault_index?: SystemStatusProbe;
  readonly github_app?: SystemStatusProbe;
  readonly google?: SystemStatusProbe;
  readonly pc_bridge?: SystemStatusProbe;
  readonly runner?: SystemStatusProbe;
}

export interface SystemStatusReader {
  read(): Promise<SystemStatus>;
  peek?(): SystemStatus | undefined;
  refresh(): Promise<SystemStatus>;
  recordError(route: string | undefined, statusCode: number): void;
  recordSmoke(report: SystemSmokeStatus): void;
}

export interface SystemSmokeReader {
  run(): Promise<SystemSmokeStatus>;
}

const subsystems: readonly SystemStatusSubsystem[] = [
  'database',
  'foundry.chat',
  'foundry.voice',
  'foundry.embeddings',
  'vault_index',
  'github_app',
  'google',
  'pc_bridge',
  'runner',
  'deployed_commit',
  'last_error',
];

const cacheTtlMs = 60_000;

export const systemStatusResponseSchema = {
  type: 'object',
  properties: {
    checkedAt: { type: 'string', format: 'date-time' },
    smoke: {
      type: 'object',
      properties: {
        checkedAt: { type: 'string', format: 'date-time' },
        entries: {
          type: 'array',
          minItems: 6,
          maxItems: 6,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', enum: systemSmokeCheckIds },
              status: { type: 'string', enum: ['ok', 'degraded', 'down', 'unknown'] },
              checkedAt: { type: 'string', format: 'date-time' },
            },
            required: ['id', 'status', 'checkedAt'],
            additionalProperties: false,
          },
        },
      },
      required: ['checkedAt', 'entries'],
      additionalProperties: false,
    },
    entries: {
      type: 'array',
      minItems: subsystems.length,
      maxItems: subsystems.length,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', enum: subsystems },
          status: { type: 'string', enum: ['ok', 'degraded', 'down', 'unknown'] },
          checkedAt: { type: 'string', format: 'date-time' },
          details: {
            type: 'object',
            additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
          },
        },
        required: ['id', 'status', 'checkedAt'],
        additionalProperties: false,
      },
    },
  },
  required: ['checkedAt', 'entries'],
  additionalProperties: false,
} as const;

export const systemSmokeResponseSchema = {
type: 'object',
properties: {
  checkedAt: { type: 'string', format: 'date-time' },
  entries: {
    type: 'array',
    minItems: 6,
    maxItems: 6,
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', enum: systemSmokeCheckIds },
        status: { type: 'string', enum: ['ok', 'degraded', 'down', 'unknown'] },
        checkedAt: { type: 'string', format: 'date-time' },
      },
      required: ['id', 'status', 'checkedAt'],
      additionalProperties: false,
    },
  },
},
required: ['checkedAt', 'entries'],
additionalProperties: false,
} as const;

function isStatus(value: unknown): value is SystemStatusValue {
  return value === 'ok' || value === 'degraded' || value === 'down' || value === 'unknown';
}

export function createSystemStatusReader(
  probes: SystemStatusProbes,
  deployedCommit: string | undefined,
  now: () => number = Date.now,
  ttlMs = cacheTtlMs,
): SystemStatusReader {
  let cached: { expiresAt: number; value: SystemStatus } | undefined;
  let pending: Promise<SystemStatus> | undefined;
  let lastError: { occurredAt: string; route: string | null; statusCode: number } | undefined;
  let latestSmoke: SystemSmokeStatus | undefined;
  let latest: SystemStatus | undefined;

  const readProbe = async (id: SystemStatusSubsystem): Promise<SystemStatusEntry> => {
    const checkedAt = new Date(now()).toISOString();
    if (id === 'deployed_commit') {
      return {
        id,
        checkedAt,
        status: deployedCommit ? 'ok' : 'unknown',
        details: { commit: deployedCommit ?? null },
      };
    }
    if (id === 'last_error') {
      return {
        id,
        checkedAt,
        status: lastError ? 'degraded' : 'ok',
        details: lastError
          ? { occurredAt: lastError.occurredAt, route: lastError.route, statusCode: lastError.statusCode }
          : { occurredAt: null, route: null, statusCode: null },
      };
    }

    const probe = probes[id];
    if (!probe) return { id, checkedAt, status: 'unknown', details: { configured: false } };
    try {
      const result = await probe();
      return {
        id,
        checkedAt,
        status: isStatus(result.status) ? result.status : 'unknown',
        ...(result.details ? { details: result.details } : {}),
      };
    } catch {
      return { id, checkedAt, status: 'down', details: { reason: 'check_failed' } };
    }
  };

  return {
    peek() {
      return latest ? {
        ...latest,
        ...(latestSmoke ? { smoke: latestSmoke } : {}),
        entries: latest.entries.map((entry) => entry.id === 'last_error' && lastError
          ? { id: entry.id, status: 'degraded', checkedAt: lastError.occurredAt,
            details: { statusCode: lastError.statusCode } }
          : entry),
      } : latestSmoke ? { checkedAt: latestSmoke.checkedAt, entries: [], smoke: latestSmoke } : undefined;
    },
    async read() {
      const timestamp = now();
      if (cached && timestamp < cached.expiresAt) return cached.value;
      if (pending) return pending;
      pending = Promise.all(subsystems.map(readProbe)).then((entries) => {
        const value: SystemStatus = {
          checkedAt: new Date(timestamp).toISOString(),
          entries,
          ...(latestSmoke ? { smoke: latestSmoke } : {}),
        };
        cached = { expiresAt: timestamp + ttlMs, value };
        latest = value;
        return value;
      }).finally(() => { pending = undefined; });
      return pending;
    },
    refresh() {
      cached = undefined;
      return this.read();
    },
    recordError(route, statusCode) {
      if (!Number.isInteger(statusCode) || statusCode < 500 || statusCode > 599) return;
      const safeRoute = typeof route === 'string' && route.startsWith('/') &&
        !route.includes('?') && !route.includes('#') &&
        !Array.from(route).some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        })
        ? route.slice(0, 128)
        : null;
      lastError = { occurredAt: new Date(now()).toISOString(), route: safeRoute, statusCode };
      cached = undefined;
    },
    recordSmoke(report) {
      latestSmoke = report;
      if (cached) cached.value = { ...cached.value, smoke: report };
    },
  };
}

export function createSystemSmokeReader(
  status: SystemStatusReader,
  probes: Partial<Record<SystemSmokeCheckId, SystemStatusProbe>>,
  now: () => number = Date.now,
): SystemSmokeReader {
  const sourceFor: Readonly<Partial<Record<SystemSmokeCheckId, SystemStatusSubsystem>>> = {
    google: 'google',
    github_app: 'github_app',
    'foundry.embeddings': 'foundry.embeddings',
    pc_bridge: 'pc_bridge',
  };
  return {
    async run() {
      const [snapshot, probeResults] = await Promise.all([
        status.refresh(),
        Promise.all(Object.entries(probes).map(async ([id, probe]) => {
          try {
            return [id, await probe!()] as const;
          } catch {
            return [id, { status: 'down' as const }] as const;
          }
        })),
      ]);
      const activeChecks = new Map(probeResults);
      const sourceEntries = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
      const researchCheckedAt = new Date(now()).toISOString();
      const entries = systemSmokeCheckIds.map((id) => {
        const active = activeChecks.get(id);
        const source = sourceFor[id] ? sourceEntries.get(sourceFor[id]!) : undefined;
        if (active) {
          return {
            id,
            status: isStatus(active.status) ? active.status : 'unknown',
            checkedAt: researchCheckedAt,
          };
        }
        return {
          id,
          status: source?.status ?? 'unknown',
          checkedAt: source?.checkedAt ?? researchCheckedAt,
        };
      });
      const report: SystemSmokeStatus = { checkedAt: new Date(now()).toISOString(), entries };
      status.recordSmoke(report);
      return report;
    },
  };
}

export function summarizeSystemStatus(status: SystemStatus): string {
  const counts = { ok: 0, degraded: 0, down: 0, unknown: 0 };
  for (const { id, status: value } of status.entries) {
    if (id !== 'last_error' && isStatus(value)) counts[value] += 1;
  }
  return `System status: ${counts.ok} ok, ${counts.degraded} degraded, ${counts.down} down, ${counts.unknown} unknown.`;
}
