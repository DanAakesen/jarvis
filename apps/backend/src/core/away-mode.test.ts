import { describe, expect, it, vi } from 'vitest';
import { defaultAwayModeState, observeAwayPresence, presenceAwayThresholdMs, setAwayMode, setAwayModeTool } from './away-mode.js';
import { ToolRefusal } from './tool-registry.js';
import type { FastifyRequest } from 'fastify';

const at = new Date('2026-10-04T12:00:00.000Z');

describe('away mode state', () => {
  it('requires ten uninterrupted minutes of Away or Offline before switching on', () => {
    const first = observeAwayPresence(defaultAwayModeState, true, at);
    expect(first).toMatchObject({ away: false, presenceAwaySince: at.toISOString() });
    expect(observeAwayPresence(first, true, new Date(at.getTime() + presenceAwayThresholdMs - 1)).away).toBe(false);
    expect(observeAwayPresence(first, true, new Date(at.getTime() + presenceAwayThresholdMs)))
      .toMatchObject({ away: true, source: 'teams_presence' });
  });

  it('clears an interrupted presence timer without undoing an active away mode', () => {
    const observed = observeAwayPresence(defaultAwayModeState, true, at);
    expect(observeAwayPresence(observed, false, new Date(at.getTime() + 30_000)))
      .toMatchObject({ away: false, presenceAwaySince: null });

    const manual = setAwayMode(defaultAwayModeState, true, 'manual', at);
    expect(observeAwayPresence(manual, false, new Date(at.getTime() + 30_000)).away).toBe(true);
  });

  it('manual and browser changes persist an explicit mode and reset the presence timer', () => {
    const observed = observeAwayPresence(defaultAwayModeState, true, at);
    const manual = setAwayMode(observed, true, 'manual', new Date(at.getTime() + 1_000));
    expect(manual).toMatchObject({ away: true, source: 'manual', presenceAwaySince: null });
    expect(setAwayMode(manual, false, 'browser', new Date(at.getTime() + 2_000)))
      .toMatchObject({ away: false, source: 'browser', presenceAwaySince: null });
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
      message: expect.stringContaining('Teams'),
    });
    expect(store.set).toHaveBeenCalledWith(true);
  });
});
