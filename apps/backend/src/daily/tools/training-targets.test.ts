import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationDenied } from '../../auth/verify.js';
import { ToolRefusal } from '../../core/tool-registry.js';
import type { BrowserConfirmationDelivery, ConfirmationActionKind } from '../../core/owner-interactions.js';
import {
  emptyTrainingTargets, trainingTargetBounds, trainingTargetFields, type StoredTrainingTargets, type TrainingTargets, type TrainingTargetsPatch,
} from '../training/targets.js';
import { dailyTrainingTargetsTool } from './training-targets.js';

const owner = '11111111-1111-4111-8111-111111111111';
const signal = () => new AbortController().signal;
const savedAt = '2026-10-17T10:00:00.000Z';
afterEach(() => { vi.restoreAllMocks(); });

function fixture(options: { approval?: boolean } = {}) {
  let state: TrainingTargets = { ...emptyTrainingTargets };
  const snapshot = (): StoredTrainingTargets => ({
    targets: { ...state },
    updatedAt: Object.values(state).some((value) => value !== null) ? savedAt : null,
  });
  const store = {
    read: vi.fn(async () => snapshot()),
    write: vi.fn(async (patch: TrainingTargetsPatch) => { state = { ...state, ...patch }; return snapshot(); }),
  };
  const access = vi.fn(() => store);
  const runConfirmed = vi.fn(async <T>(_kind: ConfirmationActionKind, _text: string, action: () => Promise<T>,
    _signal?: AbortSignal, delivery?: BrowserConfirmationDelivery): Promise<T> => {
    expect(delivery).toEqual({ channel: 'browser', lifetimeSeconds: 120 });
    return action();
  });
  const request = {
    principal: { objectId: owner }, headers: {},
    server: { ownerObjectId: owner, ...(options.approval === false ? {} : { ownerInteractions: { runConfirmed } }) },
  } as unknown as FastifyRequest;
  return { tool: dailyTrainingTargetsTool(access), request, store, access, runConfirmed };
}

describe('daily_training_targets', () => {
  it('is sensitive, denied on phone and describes no default values', () => {
    const { tool } = fixture();
    expect(tool.name).toBe('daily_training_targets');
    expect(tool.sensitive).toBe(true);
    expect(tool.denyOnPhone).toBe(true);
    expect(tool.bodyLimit).toBeLessThanOrEqual(4096);
    expect(tool.description).not.toMatch(/\d/u);
    const schema = tool.inputSchema as { properties: { targets: { properties: Record<string, unknown> } } };
    expect(Object.keys(schema.properties.targets.properties)).toEqual([...trainingTargetFields]);
    for (const field of trainingTargetFields) {
      expect(schema.properties.targets.properties[field]).toMatchObject({
        type: ['integer', 'null'], minimum: trainingTargetBounds[field].min, maximum: trainingTargetBounds[field].max,
      });
    }
  });

  it('reads unset targets and bounds without asking for approval', async () => {
    const f = fixture();
    expect(await f.tool.execute({ operation: 'read' }, f.request, signal())).toMatchObject({
      status: 'needs-configuration', targets: emptyTrainingTargets,
      missing: trainingTargetFields, bounds: trainingTargetBounds,
      provenance: { store: 'daily-training-targets', enteredBy: 'owner' },
    });
    expect(f.runConfirmed).not.toHaveBeenCalled();
    expect(f.store.write).not.toHaveBeenCalled();
  });

  it('requires the browser confirmation before writing and records only a sensitive redaction contract', async () => {
    const f = fixture();
    const response = await f.tool.execute({ operation: 'set_targets', targets: { gymSessionsPerWeek: 3 } }, f.request, signal());
    expect(f.runConfirmed).toHaveBeenCalledOnce();
    expect(f.runConfirmed.mock.calls[0]?.[1]).toContain('Gym sessions: not set → 3 sessions/week');
    expect(f.store.write).toHaveBeenCalledWith({ gymSessionsPerWeek: 3 }, expect.any(AbortSignal));
    expect(response).toMatchObject({ status: 'committed', targets: { gymSessionsPerWeek: 3 } });
  });

  it('refuses invalid actions, missing approval, connector access and unknown input fields', async () => {
    const f = fixture({ approval: false });
    await expect(f.tool.execute({ operation: 'set_targets', targets: { dailySteps: 5000 } }, f.request, signal()))
      .rejects.toThrow('Now approval is unavailable');
    await expect(f.tool.execute({ operation: 'read', owner }, f.request, signal())).rejects.toBeInstanceOf(ToolRefusal);
    const connector = {
      ...f.request, dailyConnectorPrincipal: { kind: 'jarvis-daily-connector', objectId: owner },
    } as FastifyRequest;
    await expect(f.tool.execute({ operation: 'read' }, connector, signal())).rejects.toBeInstanceOf(AuthenticationDenied);
    expect(f.store.write).not.toHaveBeenCalled();
  });
});
