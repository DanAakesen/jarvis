import type { FastifyInstance } from 'fastify';
import type {
  UsageCostTotal,
  UsageEntry,
  UsagePeriod,
  UsageReport,
  UsageRole,
  UsageRoleCoverage,
  UsageToolCallCount,
} from '@jarvis/contracts';
import type { CodexToolUsageCount } from './tool-calls.js';
import type { JarvisTool } from './tool-registry.js';
import { ToolFailure } from './tool-registry.js';

export type {
  UsageEntry,
  UsageMetric,
  UsagePeriod,
  UsageRole,
  UsageSource,
  UsageVerification,
} from '@jarvis/contracts';

export interface DailyToolCount {
  tool: string;
  count: string;
}

export interface FoundryModelUsage {
  role: UsageRole;
  model: string;
  inputTokens: number;
  outputTokens: number;
  eventId: string;
}

export interface UsageStore {
  list(from: Date | null, to: Date): Promise<{
    entries: UsageEntry[];
    totalEntries: string;
    dailyToolCounts?: DailyToolCount[];
    dailyCostTotals?: UsageCostTotal[];
    monthlyCostTotals?: UsageCostTotal[];
    toolCalls?: UsageToolCallCount[];
  }>;
  recordFoundryUsage?(usage: FoundryModelUsage): Promise<void>;
}

const periodDays: Record<UsagePeriod, number | null> = {
  today: null,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: null,
};
const maxResponseBytes = 1024 * 1024;
const roleCoverage: UsageRoleCoverage[] = [
  {
    role: 'chat',
    usageStatus: 'measured',
    costStatus: 'estimated',
    note: 'Foundry-reported model tokens; list-price costs are estimates, not provider invoices.',
  },
  {
    role: 'voice',
    usageStatus: 'measured',
    costStatus: 'estimated',
    note: 'Foundry-reported model tokens; list-price costs are estimates, not provider invoices.',
  },
  {
    role: 'vision',
    usageStatus: 'measured',
    costStatus: 'estimated',
    note: 'Foundry-reported tokens and published list-price estimates.',
  },
  {
    role: 'research',
    usageStatus: 'unverified',
    costStatus: 'unverified',
    note: 'Subscription-backed research calls are counted; provider token and monetary usage are unavailable.',
  },
  {
    role: 'embeddings',
    usageStatus: 'measured',
    costStatus: 'unverified',
    note: 'Foundry input tokens are reported; deployment pricing has not been verified.',
  },
];

function usageRange(period: UsagePeriod, to: Date): { from: Date | null; to: Date } {
  if (period === 'today') {
    return { from: new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())), to };
  }
  const days = periodDays[period];
  return { from: days === null ? null : new Date(to.getTime() - days * 24 * 60 * 60 * 1000), to };
}

function summarizeSpend(entries: UsageEntry[], key: (entry: UsageEntry) => string | null) {
  const groups = new Map<string | null, {
    usd: number;
    dkk: number;
    estimatedEntries: number;
    unverifiedEntries: number;
  }>();
  for (const entry of entries) {
    const label = key(entry);
    const total = groups.get(label) ?? { usd: 0, dkk: 0, estimatedEntries: 0, unverifiedEntries: 0 };
    total.usd += entry.costUsd ?? 0;
    total.dkk += entry.costDkk ?? 0;
    if (entry.costStatus === 'estimated') total.estimatedEntries += 1;
    if (entry.costStatus === 'unverified') total.unverifiedEntries += 1;
    groups.set(label, total);
  }
  return [...groups].map(([label, total]) => ({
    label,
    ...total,
    costStatus: total.unverifiedEntries > 0 ? 'unverified' : total.estimatedEntries > 0 ? 'estimated' : 'measured',
  })).sort((a, b) => (a.label ?? '').localeCompare(b.label ?? ''));
}

function validFoundryUsage(value: unknown): value is FoundryModelUsage {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const usage = value as Record<string, unknown>;
  return ['chat', 'voice', 'vision', 'research', 'embeddings'].includes(String(usage.role)) &&
    typeof usage.model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(usage.model) &&
    Number.isSafeInteger(usage.inputTokens) && Number(usage.inputTokens) >= 0 &&
    Number(usage.inputTokens) <= 10_000_000 &&
    Number.isSafeInteger(usage.outputTokens) && Number(usage.outputTokens) >= 0 &&
    Number(usage.outputTokens) <= 10_000_000 &&
    typeof usage.eventId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(usage.eventId);
}

declare module 'fastify' {
  interface FastifyInstance {
    usageStore: UsageStore | null;
  }
}

export async function registerUsageRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { period?: UsagePeriod } }>('/usage', {
    schema: {
      querystring: {
        type: 'object',
        properties: { period: { type: 'string', enum: Object.keys(periodDays), default: '30d' } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!app.usageStore) return reply.code(503).send({ error: 'Usage service unavailable' });
    const period = request.query.period ?? '30d';
    const to = new Date();
    const { from } = usageRange(period, to);
    const report = await app.usageStore.list(from, to);
    const todayStart = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
    const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    let codexToolCallsToday: CodexToolUsageCount[] | null = null;
    if (app.toolCallStore?.listCodexToolCalls) {
      try {
        codexToolCallsToday = await app.toolCallStore.listCodexToolCalls(todayStart, tomorrowStart);
      } catch {
        request.log.warn('usage.codex_tool_counts_unavailable');
      }
    }
    const { dailyToolCounts = [], ...usageReport } = report;
    const result = {
      period,
      from: from?.toISOString() ?? null,
      to: to.toISOString(),
      ...usageReport,
      dailyToolUsage: {
        date: to.toISOString().slice(0, 10),
        tools: dailyToolCounts,
      },
      dailyCostTotals: report.dailyCostTotals ?? [],
      monthlyCostTotals: report.monthlyCostTotals ?? [],
      toolCalls: report.toolCalls ?? [],
      roleCoverage,
      codexToolCallsToday,
      truncated: BigInt(report.totalEntries) > BigInt(report.entries.length),
    } satisfies UsageReport;
    if (Buffer.byteLength(JSON.stringify(result)) > maxResponseBytes) {
      return reply.code(413).send({ error: 'Usage report too large' });
    }
    return result;
  });

  app.post<{ Body: FoundryModelUsage }>('/usage/foundry', {
    config: { jarvisAgent: true },
    schema: {
      body: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['chat', 'voice', 'vision', 'research', 'embeddings'] },
          model: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' },
          inputTokens: { type: 'integer', minimum: 0, maximum: 10_000_000 },
          outputTokens: { type: 'integer', minimum: 0, maximum: 10_000_000 },
          eventId: { type: 'string', format: 'uuid' },
        },
        required: ['role', 'model', 'inputTokens', 'outputTokens', 'eventId'],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!request.agentPrincipal) return reply.code(403).send({ error: 'Forbidden' });
    if (!app.usageStore?.recordFoundryUsage) return reply.code(503).send({ error: 'Usage service unavailable' });
    if (!validFoundryUsage(request.body)) return reply.code(400).send({ error: 'Invalid Foundry usage' });
    await app.usageStore.recordFoundryUsage({ ...request.body, role: request.body.role });
    return reply.code(204).send();
  });
}

export const getUsageTool: JarvisTool = {
  name: 'get_usage',
  description: 'Return usage spend grouped by area and model for the requested period. Use today for today’s UTC spend.',
  sensitive: true,
  inputSchema: {
    type: 'object',
    properties: { period: { type: 'string', enum: Object.keys(periodDays) } },
    required: ['period'],
    additionalProperties: false,
  },
  execute: async (input, request) => {
    const { period } = input as { period: UsagePeriod };
    const store = request.server.usageStore;
    if (!store) throw new ToolFailure('Usage data is currently unavailable.');
    const to = new Date();
    const { from } = usageRange(period, to);
    const report = await store.list(from, to);
    const [total] = summarizeSpend(report.entries, () => 'all');
    return {
      period,
      from: from?.toISOString() ?? null,
      to: to.toISOString(),
      total: total ? {
        usd: total.usd,
        dkk: total.dkk,
        estimatedEntries: total.estimatedEntries,
        unverifiedEntries: total.unverifiedEntries,
        costStatus: total.costStatus,
      } : {
        usd: 0, dkk: 0, estimatedEntries: 0, unverifiedEntries: 0, costStatus: 'measured',
      },
      areas: summarizeSpend(report.entries, (entry) => entry.role ?? entry.source)
        .map(({ label, ...spend }) => ({ area: label, ...spend })),
      models: summarizeSpend(report.entries, (entry) => entry.model)
        .map(({ label, ...spend }) => ({ model: label, ...spend })),
      unpricedToolCalls: report.toolCalls ?? [],
      truncated: BigInt(report.totalEntries) > BigInt(report.entries.length),
    };
  },
};
