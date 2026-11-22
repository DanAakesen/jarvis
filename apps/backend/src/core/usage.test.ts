import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { UsageEntry } from '@jarvis/contracts';
import { getUsageTool } from './usage.js';

const entry = (costUsd: number, costDkk: number): UsageEntry => ({
  taskId: null, taskTitle: null, projectId: null, projectName: null, agent: 'jarvis', source: 'jarvis_model',
  metric: 'input_tokens', quantity: 1000, costUsd, costDkk, costStatus: 'measured', role: 'chat', model: 'gpt-6.1-terra',
  at: '2026-11-21T10:00:00.000Z', estimated: false,
});

type Spend = { usd: number; dkk: number };

async function usage(entries: UsageEntry[]) {
  const request = {
    server: { usageStore: { list: async () => ({ entries, totalEntries: String(entries.length) }) } },
  } as unknown as FastifyRequest;
  return await getUsageTool.execute({ period: '7d' }, request, new AbortController().signal) as
    { total: Spend; areas: Spend[]; models: Spend[] };
}

describe('get_usage spend', () => {
  it('reports sums without floating point noise in the total, each area and each model', async () => {
    const report = await usage([entry(0.1, 0.7), entry(0.2, 0.1)]);
    for (const spend of [report.total, report.areas[0], report.models[0]]) expect(spend).toMatchObject({ usd: 0.3, dkk: 0.8 });
  });

  it('keeps small costs visible to four decimals', async () => {
    expect((await usage([entry(0.000123, 0.00084)])).total).toMatchObject({ usd: 0.0001, dkk: 0.0008 });
  });
});
