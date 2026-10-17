import type { FastifyRequest } from 'fastify';
import type sql from 'mssql';
import { describe, expect, it } from 'vitest';
import { AuthenticationDenied } from '../../auth/verify.js';
import { DailyBriefReadModel } from './read-model.js';

const owner = '11111111-1111-4111-8111-111111111111';
const pool = {} as sql.ConnectionPool;
const request = (extra: Record<string, unknown> = {}) => ({
  server: { ownerObjectId: owner }, principal: { objectId: owner }, ...extra,
}) as unknown as FastifyRequest;

describe('historical brief owner/read boundary', () => {
  it('allows only existing owner/hosted-agent authority, never connector/runner/device/export identities', () => {
    expect(DailyBriefReadModel.forRequest(pool, request())).toBeInstanceOf(DailyBriefReadModel);
    expect(DailyBriefReadModel.forRequest(pool, request({ principal: undefined, agentPrincipal: { kind: 'jarvis-agent' } }))).toBeInstanceOf(DailyBriefReadModel);
    for (const extra of [{ principal: undefined }, { principal: { objectId: '22222222-2222-4222-8222-222222222222' } },
      { runnerPrincipal: {} }, { dailyConnectorPrincipal: { kind: 'jarvis-daily-connector', objectId: owner }, principal: undefined },
      { nutritionExportPrincipal: {} }, { phoneEventGridPrincipal: {} }]) {
      expect(() => DailyBriefReadModel.forRequest(pool, request(extra))).toThrow(AuthenticationDenied);
    }
  });
  it('rejects invalid selectors and pre-cancelled reads before allocating a SQL request', async () => {
    const reader = DailyBriefReadModel.forRequest(pool, request());
    const signal = new AbortController().signal;
    for (const options of [{ limit: 0 }, { limit: 101 }, { limit: 1.2 },
      { after: { startedAt: 'x'.repeat(65), id: 'id' } }, { after: { startedAt: 'raw', id: '' } }]) {
      await expect(reader.history(options, signal)).rejects.toBeInstanceOf(TypeError);
    }
    for (const id of ['', 'x'.repeat(257)]) await expect(reader.detail(id, signal)).rejects.toBeInstanceOf(TypeError);
    const cancelled = new AbortController();
    cancelled.abort(new Error('Synthetic cancelled read'));
    await expect(reader.history({}, cancelled.signal)).rejects.toThrow('Synthetic cancelled read');
    await expect(reader.detail('id', cancelled.signal)).rejects.toThrow('Synthetic cancelled read');
  });
});
