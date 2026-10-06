import { describe, expect, it, vi } from 'vitest';
import {
  defaultAwayModeState,
  observeAwayPresence,
  parseAwayModeState,
  presenceAwayThresholdMs,
  setPresenceMode,
  setPresenceModeTool,
  setAwayModeTool,
} from './away-mode.js';
import { ToolRefusal } from './tool-registry.js';
import type { FastifyRequest } from 'fastify';

const at = new Date('2026-10-04T12:00:00.000Z');

describe('presence mode state', () => {
  it('migrates persisted boolean state and retains the derived-away semantics', () => {
    expect(parseAwayModeState({
      away: true,
      source: 'teams_presence',
      changedAt: at.toISOString(),
      presenceAwaySince: null,
    })).toEqual({ mode: 'away', source: 'jarvis', changedAt: at.toISOString() });
    expect(parseAwayModeState({
      away: false,
      source: null,
      changedAt: null,
      presenceAwaySince: null,
    })).toEqual({ mode: 'present', source: 'manual', changedAt: null });
  });

  it('requires ten uninterrupted minutes of Away or Offline before switching to away', () => {
    const first = observeAwayPresence(defaultAwayModeState, true, at);
    expect(first).toEqual({
      state: defaultAwayModeState,
      presenceAwaySince: at.toISOString(),
    });
    expect(observeAwayPresence(first.state, true, new Date(at.getTime() + presenceAwayThresholdMs - 1), first.presenceAwaySince).state)
      .toBe(first.state);
    expect(observeAwayPresence(first.state, true, new Date(at.getTime() + presenceAwayThresholdMs), first.presenceAwaySince))
      .toEqual({
        state: { mode: 'away', source: 'jarvis', changedAt: new Date(at.getTime() + presenceAwayThresholdMs).toISOString() },
        presenceAwaySince: at.toISOString(),
      });
  });

  it('clears an interrupted presence timer without undoing an active non-present mode', () => {
    const observed = observeAwayPresence(defaultAwayModeState, true, at);
    expect(observeAwayPresence(observed.state, false, new Date(at.getTime() + 30_000), observed.presenceAwaySince))
      .toEqual({ state: defaultAwayModeState, presenceAwaySince: null });

    const manual = setPresenceMode(defaultAwayModeState, 'on_the_move', 'manual', at);
    expect(observeAwayPresence(manual, false, new Date(at.getTime() + 30_000)).state).toBe(manual);
  });

  it('changes source and timestamp only when the selected mode changes', () => {
    const away = setPresenceMode(defaultAwayModeState, 'away', 'manual', at);
    expect(away).toEqual({ mode: 'away', source: 'manual', changedAt: at.toISOString() });
    expect(setPresenceMode(away, 'away', 'jarvis', new Date(at.getTime() + 1_000))).toEqual(away);
    expect(setPresenceMode(away, 'on_the_move', 'jarvis', new Date(at.getTime() + 2_000)))
      .toEqual({ mode: 'on_the_move', source: 'jarvis', changedAt: new Date(at.getTime() + 2_000).toISOString() });
  });

  it('validates the new and compatibility tools and records Jarvis as the source', async () => {
    const store = {
      read: vi.fn(),
      set: vi.fn(async (mode: 'present' | 'away' | 'on_the_move') => ({
        ...defaultAwayModeState,
        mode,
      })),
    };
    const request = {
      principal: null,
      agentPrincipal: null,
      server: { awayModeStore: store },
    } as unknown as FastifyRequest;
    const signal = new AbortController().signal;

    await expect(setPresenceModeTool.execute({ mode: 'away' }, request, signal))
      .rejects.toBeInstanceOf(ToolRefusal);
    request.agentPrincipal = { kind: 'jarvis-agent', objectId: 'agent', tenantId: 'tenant' };
    await expect(setPresenceModeTool.execute({ mode: 'on_the_move', extra: true }, request, signal))
      .rejects.toBeInstanceOf(ToolRefusal);
    await expect(setPresenceModeTool.execute({ mode: 'on_the_move' }, request, signal))
      .resolves.toMatchObject({ mode: 'on_the_move', away: true, message: expect.stringContaining('on the move') });
    await expect(setAwayModeTool.execute({ mode: 'on' }, request, signal))
      .resolves.toMatchObject({ mode: 'away', away: true });
    expect(store.set).toHaveBeenNthCalledWith(1, 'on_the_move', 'jarvis');
    expect(store.set).toHaveBeenNthCalledWith(2, 'away', 'jarvis');
  });
});
