import { describe, expect, it, vi } from 'vitest';
import {
  defaultAwayModeState,
  parseAwayModeState,
  setPresenceMode,
  setPresenceModeTool,
  setAwayModeTool,
  updatePresenceMode,
} from './away-mode.js';
import { ToolRefusal } from './tool-registry.js';
import type { FastifyRequest } from 'fastify';

const at = new Date('2026-10-04T12:00:00.000Z');

describe('presence mode state', () => {
  it('migrates persisted boolean state and normalizes removed Teams presence data', () => {
    expect(parseAwayModeState({
      away: true,
      source: 'teams_presence',
      changedAt: at.toISOString(),
      presenceAwaySince: null,
    })).toEqual({ mode: 'away', source: 'manual', changedAt: at.toISOString() });
    expect(parseAwayModeState({
      away: false,
      source: null,
      changedAt: null,
      presenceAwaySince: null,
    })).toEqual({ mode: 'present', source: 'manual', changedAt: null });
    expect(parseAwayModeState({
      mode: 'on_the_move',
      source: 'device',
      changedAt: at.toISOString(),
    })).toEqual({ mode: 'on_the_move', source: 'device', changedAt: at.toISOString() });
  });

  it('keeps non-manual same-mode updates unchanged', () => {
    const away = setPresenceMode(defaultAwayModeState, 'away', 'manual', at);
    expect(away).toEqual({ mode: 'away', source: 'manual', changedAt: at.toISOString() });
    expect(setPresenceMode(away, 'away', 'jarvis', new Date(at.getTime() + 1_000))).toEqual(away);
    expect(setPresenceMode(away, 'on_the_move', 'jarvis', new Date(at.getTime() + 2_000)))
      .toEqual({ mode: 'on_the_move', source: 'jarvis', changedAt: new Date(at.getTime() + 2_000).toISOString() });
  });

  it('protects recent manual changes from devices and lets manual changes reset the window', () => {
    const manual = setPresenceMode(defaultAwayModeState, 'away', 'manual', at);
    expect(updatePresenceMode(manual, 'on_the_move', 'device', new Date(at.getTime() + 90 * 60_000)))
      .toEqual({ state: manual, ignored: 'recent_manual' });
    expect(updatePresenceMode(manual, 'on_the_move', 'device', new Date(at.getTime() + 2 * 60 * 60_000 + 1)))
      .toEqual({
        state: {
          mode: 'on_the_move',
          source: 'device',
          changedAt: new Date(at.getTime() + 2 * 60 * 60_000 + 1).toISOString(),
        },
      });

    const device = setPresenceMode(defaultAwayModeState, 'on_the_move', 'device', at);
    const manualAfterDevice = updatePresenceMode(device, 'present', 'manual', new Date(at.getTime() + 1_000));
    expect(manualAfterDevice.state).toEqual({
      mode: 'present', source: 'manual', changedAt: new Date(at.getTime() + 1_000).toISOString(),
    });
    expect(updatePresenceMode(manualAfterDevice.state, 'away', 'device', new Date(at.getTime() + 2_000)))
      .toEqual({ state: manualAfterDevice.state, ignored: 'recent_manual' });
  });

  it('refreshes the manual window when the selected mode is unchanged', () => {
    const previous = setPresenceMode(defaultAwayModeState, 'away', 'manual', at);
    expect(setPresenceMode(previous, 'away', 'manual', new Date(at.getTime() + 1_000))).toEqual({
      mode: 'away', source: 'manual', changedAt: new Date(at.getTime() + 1_000).toISOString(),
    });
  });

  it('records an accepted same-mode device update after the manual window expires', () => {
    const previous = setPresenceMode(defaultAwayModeState, 'present', 'manual', at);
    expect(updatePresenceMode(previous, 'present', 'device', new Date(at.getTime() + 2 * 60 * 60_000))).toEqual({
      state: { mode: 'present', source: 'device', changedAt: new Date(at.getTime() + 2 * 60 * 60_000).toISOString() },
    });
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
    expect(store.set).toHaveBeenNthCalledWith(1, 'on_the_move', 'manual');
    expect(store.set).toHaveBeenNthCalledWith(2, 'away', 'manual');
  });
});
