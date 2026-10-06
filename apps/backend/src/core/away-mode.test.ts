import { describe, expect, it, vi } from 'vitest';
import { defaultAwayModeState, parseAwayModeState, setAwayMode, setAwayModeTool } from './away-mode.js';
import { ToolRefusal } from './tool-registry.js';
import type { FastifyRequest } from 'fastify';

const at = new Date('2026-10-04T12:00:00.000Z');

describe('away mode state', () => {
  it('changes away mode only through manual or browser activity', () => {
    const manual = setAwayMode(defaultAwayModeState, true, 'manual', at);
    expect(manual).toEqual({ away: true, source: 'manual', changedAt: at.toISOString() });
    expect(setAwayMode(manual, false, 'browser', new Date(at.getTime() + 2_000)))
      .toEqual({ away: false, source: 'browser', changedAt: new Date(at.getTime() + 2_000).toISOString() });
  });

  it('normalizes persisted Teams-presence fields without changing the away value', () => {
    expect(parseAwayModeState({
      away: true,
      source: 'teams_presence',
      changedAt: at.toISOString(),
      presenceAwaySince: at.toISOString(),
    })).toEqual({ away: true, source: null, changedAt: at.toISOString() });
  });

  it('validates tool input and requires a verified principal and available state store', async () => {
    const store = { read: vi.fn(), set: vi.fn(async (away: boolean) => ({ ...defaultAwayModeState, away })) };
    const request = {
      principal: null,
      agentPrincipal: null,
      server: { awayModeStore: store },
    } as unknown as FastifyRequest;
    const signal = new AbortController().signal;

    await expect(setAwayModeTool.execute({ mode: 'on' }, request, signal))
      .rejects.toBeInstanceOf(ToolRefusal);
    request.agentPrincipal = { kind: 'jarvis-agent', objectId: 'agent', tenantId: 'tenant' };
    await expect(setAwayModeTool.execute({ mode: 'on', extra: true }, request, signal))
      .rejects.toBeInstanceOf(ToolRefusal);
    await expect(setAwayModeTool.execute({ mode: 'on' }, request, signal)).resolves.toMatchObject({
      away: true,
      message: expect.stringContaining('Now'),
    });
    expect(store.set).toHaveBeenCalledWith(true);
  });
});
