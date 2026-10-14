import type { FastifyRequest } from 'fastify';
import type sql from 'mssql';
import { describe, expect, it } from 'vitest';
import { AuthenticationDenied } from '../../auth/verify.js';
import { DailyHealthReadModel } from './read-model.js';

const owner = '11111111-1111-4111-8111-111111111111';
const pool = {} as sql.ConnectionPool; // Invalid auth/input must not reach persistence.
const request = (extra: Record<string, unknown> = {}) => ({ server: { ownerObjectId: owner }, principal: { objectId: owner }, ...extra }) as unknown as FastifyRequest;
const signal = () => new AbortController().signal;

describe('unregistered owner health read boundary', () => {
  it('reuses existing human/agent owner auth and denies device/export/runner identities', () => {
    expect(DailyHealthReadModel.forRequest(pool, request())).toBeInstanceOf(DailyHealthReadModel);
    expect(DailyHealthReadModel.forRequest(pool, request({ principal: undefined, agentPrincipal: { kind: 'jarvis-agent' } }))).toBeInstanceOf(DailyHealthReadModel);
    for (const extra of [
      { principal: undefined }, { principal: { objectId: '22222222-2222-4222-8222-222222222222' } },
      { runnerPrincipal: {} }, { nutritionExportPrincipal: {} }, { pcBridgePrincipal: {} },
      { phoneEventGridPrincipal: {} }, { deployPrincipal: {} }, { agentPrincipal: { kind: 'jarvis-agent' } },
    ]) expect(() => DailyHealthReadModel.forRequest(pool, request(extra))).toThrow(AuthenticationDenied);
  });
  it('bounds dates, page sizes and cursors before any SQL request', async () => {
    const model = DailyHealthReadModel.forRequest(pool, request());
    for (const range of [
      { startDate: '2026-02-30', endDate: '2026-03-01' },
      { startDate: '2026-10-14', endDate: '2026-10-13' },
      { startDate: '2024-01-01', endDate: '2026-01-01' },
      { startDate: '2026-10-13', endDate: '2026-10-13', limit: 501 },
      { startDate: '2026-10-13', endDate: '2026-10-13', after: { date: '2026-10-12', key: 'id' } },
    ]) await expect(model.history('workouts', range, signal())).rejects.toBeInstanceOf(TypeError);
    await expect(model.heartRate('id', { limit: 0 }, signal())).rejects.toBeInstanceOf(TypeError);
    await expect(model.heartRate('id ', {}, signal())).rejects.toBeInstanceOf(TypeError);
    await expect(model.heartRate('id', { after: { minute: '2026-10-13T10:00:00', metric: 'hr' } }, signal())).rejects.toBeInstanceOf(TypeError);
  });
});
