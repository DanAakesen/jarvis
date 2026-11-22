import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import { createBackendLogsModule } from './backend-logs.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const app = buildApp(config, undefined, {
  modules: [coreModule, createBackendLogsModule()],
  auth: async () => ({ kind: 'jarvis-agent', objectId: 'b331004a-777a-4e53-b7b0-40bf9ab3b9ef', tenantId: config.auth.tenantId }),
  toolCallStore: { record: async () => {} },
});

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); });

/** One read_backend_logs call through the real dispatcher, as Jarvis makes it. */
async function callTool(payload: Record<string, unknown>) {
  const response = await app.inject({
    method: 'POST', url: '/tools/read_backend_logs', payload,
    headers: { authorization: ['Bearer', 'header.agent.signature'].join(' '), 'x-jarvis-message-id': '101' },
  });
  return response.json() as { outcome: string; result: { refused?: string } };
}

describe('read_backend_logs limit', () => {
  it('names the maximum when the limit is too large', async () => {
    const answer = await callTool({ limit: 500 });
    expect(answer.outcome).toBe('refused');
    expect(answer.result.refused).toContain('limit must be a whole number from 1 to 100');
  });

  it('accepts the maximum itself', async () => {
    expect((await callTool({ limit: 100 })).outcome).toBe('ok');
  });
});

describe('backend request diagnosis', () => {
  const target = { workspaceId: '00000000-0000-4000-8000-000000000001', appName: 'ca-jarvis-backend-test' };
  const requestId = '28d1efca-d8d7-4090-8822-9105c58652ad';
  const now = () => new Date('2026-11-22T23:08:00Z');

  it('filters before the row limit and exposes only correlated diagnostic metadata', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ tables: [{
      name: 'PrimaryResult', columns: ['TimeGenerated', 'IngestedAt', 'ContainerAppName_s', 'Log_s'].map(name => ({ name })),
      rows: [['2026-11-22T23:06:43Z', '2026-11-22T23:07:43Z', target.appName, JSON.stringify({
        service: 'jarvis-backend', msg: 'watch_transcription.stage', level: 40, reqId: requestId,
        stage: 'recognizer_cancelled', errorCode: 4, token: 'private-token', text: 'private-utterance',
      })]],
    }] }));
    const tool = createBackendLogsModule({ config: target, now, fetch, getToken: async () => 'fake-credential' }).tools[0]!;
    const result = await tool.execute({ component: 'watch', severity: 'warning', errorCode: '4', requestId, limit: 1 }, {} as never, new AbortController().signal);
    const sent = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as { query: string };
    const beforeLimit = sent.query.split('| top ')[0]!;
    for (const part of [target.appName, "'watch_transcription'", 'toint(d.level) >= 40',
      "tostring(d.errorCode) == '4'", "tostring(d.reqId) =~ '" + requestId + "'"]) expect(beforeLimit).toContain(part);
    expect(result).toMatchObject({ status: 'ok', records: [{ requestId, ingestionDelayMs: 60_000, level: 40,
      event: 'watch_transcription.stage', fields: { stage: 'recognizer_cancelled', errorCode: 4 } }] });
    expect(JSON.stringify(result)).not.toMatch(/private-|fake-credential/u);
    for (const bad of [{ component: 'AppTraces' }, { severity: 'all' }, { requestId: 'some-name' }, { errorCode: "' or true" }]) {
      await expect(tool.execute(bad, {} as never, new AbortController().signal)).rejects.toThrow();
    }
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('keeps delayed, partial or inaccessible evidence distinct from success', async () => {
    const table = { name: 'PrimaryResult', columns: ['TimeGenerated', 'IngestedAt', 'ContainerAppName_s', 'Log_s'].map(name => ({ name })), rows: [] };
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ tables: [table] }))
      .mockResolvedValueOnce(Response.json({ tables: [table], error: { code: 'PartialError' } }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    const tool = createBackendLogsModule({ config: target, now, fetch, getToken: async () => 'test' }).tools[0]!;
    const run = () => tool.execute({ requestId }, {} as never, new AbortController().signal);
    expect(await run()).toMatchObject({ status: 'ok', records: [], newestReturnedAt: null, notice: expect.stringContaining('Empty or partial') });
    expect(await run()).toMatchObject({ status: 'partial', partial: true, records: [] });
    expect(await run()).toMatchObject({ status: 'unavailable', reason: 'access_denied', records: [] });
  });
});
