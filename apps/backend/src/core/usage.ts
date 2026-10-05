import type { FastifyInstance } from 'fastify';
import type { CodexToolUsageCount } from './tool-calls.js';

export type UsagePeriod = '7d' | '30d' | '90d' | 'all';
export type UsageSource = 'sandbox' | 'jarvis_model' | 'voice' | 'codex' | 'copilot';
export type UsageMetric = 'minutes' | 'input_tokens' | 'output_tokens' | 'turns' | 'premium_requests' | 'screen_frames';

export interface UsageEntry {
  taskId: string | null;
  taskTitle: string | null;
  projectId: string | null;
  projectName: string | null;
  agent: 'codex' | 'copilot' | 'jarvis';
  source: UsageSource;
  metric: UsageMetric;
  quantity: number;
  costDkk: number | null;
  at: string;
  estimated: boolean;
}

export interface DailyToolCount {
  tool: string;
  count: string;
}

export interface UsageStore {
  list(from: Date | null, to: Date): Promise<{
    entries: UsageEntry[];
    totalEntries: string;
    dailyToolCounts?: DailyToolCount[];
  }>;
}

const periodDays: Record<UsagePeriod, number | null> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: null,
};
const maxResponseBytes = 1024 * 1024;

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
    const days = periodDays[period];
    const from = days === null ? null : new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
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
      codexToolCallsToday,
      truncated: BigInt(report.totalEntries) > BigInt(report.entries.length),
    };
    if (Buffer.byteLength(JSON.stringify(result)) > maxResponseBytes) {
      return reply.code(413).send({ error: 'Usage report too large' });
    }
    return result;
  });
}
