import { describe, expect, it } from 'vitest';
import { systemSmokeCheckIds, type SystemSmokeStatus } from '@jarvis/contracts';
import { createSystemStatusReader } from './system-status.js';

const checkAt = '2026-11-19T01:00:00.000Z';

describe('system status evidence', () => {
  it('ages a backend error out of degraded status without hiding the historical record', async () => {
    let now = Date.parse(checkAt);
    const reader = createSystemStatusReader({}, 'abc1234', () => now);
    const initial = await reader.read();
    expect(initial.entries.find(entry => entry.id === 'last_error')).toMatchObject({
      status: 'ok',
      details: { occurredAt: null, recent: false },
    });

    reader.recordError('/synthetic', 503);
    now += 1_000;
    expect((await reader.read()).entries.find(entry => entry.id === 'last_error')).toMatchObject({
      status: 'degraded',
      details: {
        occurredAt: checkAt,
        route: '/synthetic',
        statusCode: 503,
        recent: true,
      },
    });

    now += 6 * 60_000;
    expect((await reader.read()).entries.find(entry => entry.id === 'last_error')).toMatchObject({
      status: 'ok',
      details: { occurredAt: checkAt, recent: false },
    });
  });

  it('turns a recent runtime result into health evidence and stale evidence into unknown', async () => {
    let now = Date.parse(checkAt);
    const reader = createSystemStatusReader({
      'foundry.chat': async () => ({
        status: 'unknown',
        details: { configured: true, engine: 'pi', runtimeProbe: 'not_run' },
      }),
    }, undefined, () => now);
    reader.recordEvidence('foundry.chat', {
      status: 'ok',
      checkedAt: checkAt,
      details: { engine: 'pi', evidence: 'runtime-turn', channel: 'chat', outcome: 'ok' },
    });

    expect((await reader.read()).entries.find(entry => entry.id === 'foundry.chat')).toMatchObject({
      status: 'ok',
      checkedAt: checkAt,
      details: { configured: true, runtimeProbe: 'runtime', outcome: 'ok' },
    });

    now += 16 * 60_000;
    expect((await reader.refresh()).entries.find(entry => entry.id === 'foundry.chat')).toMatchObject({
      status: 'unknown',
      checkedAt: checkAt,
      details: { runtimeProbe: 'stale', lastEvidenceAt: checkAt },
    });
  });

  it('maps active embedding and runner smoke checks into their main rows', async () => {
    const reader = createSystemStatusReader({
      'foundry.embeddings': async () => ({ status: 'unknown', details: { configured: true } }),
      runner: async () => ({ status: 'unknown', details: { configured: true, healthProbe: 'not_run' } }),
    }, undefined, () => Date.parse(checkAt));
    const smoke: SystemSmokeStatus = {
      checkedAt: checkAt,
      entries: systemSmokeCheckIds.map(id => ({
        id,
        status: id === 'foundry.embeddings' ? 'ok' : id === 'research' ? 'down' : 'unknown',
        checkedAt: checkAt,
      })),
    };
    reader.recordSmoke(smoke);
    const snapshot = await reader.read();
    expect(snapshot.entries.find(entry => entry.id === 'foundry.embeddings')).toMatchObject({
      status: 'ok',
      details: { evidence: 'smoke', smokeCheck: 'foundry.embeddings' },
    });
    expect(snapshot.entries.find(entry => entry.id === 'runner')).toMatchObject({
      status: 'down',
      details: { evidence: 'smoke', smokeCheck: 'research' },
    });
  });

  it('clears superseded failure details when newer runtime evidence succeeds', async () => {
    const reader = createSystemStatusReader({
      'foundry.chat': async () => ({
        status: 'unknown',
        details: { configured: true, engine: 'pi', runtimeProbe: 'not_run' },
      }),
    }, undefined, () => Date.parse(checkAt));
    reader.recordEvidence('foundry.chat', {
      status: 'down',
      checkedAt: checkAt,
      details: {
        configured: true, evidence: 'deploy-smoke', smokePart: 'core',
        reason: 'smoke_failed',
      },
    });
    await reader.read();
    reader.recordEvidence('foundry.chat', {
      status: 'ok',
      checkedAt: checkAt,
      details: {
        configured: true, evidence: 'runtime-turn', channel: 'chat',
        outcome: 'ok', source: 'turn',
      },
    });
    const entry = (await reader.read()).entries.find(candidate => candidate.id === 'foundry.chat')!;
    expect(entry).toMatchObject({
      status: 'ok',
      details: { evidence: 'runtime-turn', outcome: 'ok', runtimeProbe: 'runtime' },
    });
    expect(entry.details).not.toHaveProperty('reason');
    expect(entry.details).not.toHaveProperty('smokePart');
  });

  it('does not let smoke evidence overwrite an unconfigured component', async () => {
    const reader = createSystemStatusReader({
      runner: async () => ({
        status: 'down',
        details: { configured: false },
      }),
    }, undefined, () => Date.parse(checkAt));
    reader.recordEvidence('runner', {
      status: 'ok',
      checkedAt: checkAt,
      details: { evidence: 'smoke', smokeCheck: 'research' },
    });
    expect((await reader.read()).entries.find(entry => entry.id === 'runner')).toMatchObject({
      status: 'down',
      details: { configured: false },
    });
  });
});
