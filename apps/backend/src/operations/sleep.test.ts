import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { ToolRefusal } from '../core/tool-registry.js';
import type { MinimumReplicas } from './container-app-scale.js';
import { createSleepModule } from './sleep.js';

describe('backend sleep switch through PI', () => {
  it('uses the task lock for sleep, reports the request, and reads the resulting minimum', async () => {
    let minimum: MinimumReplicas = 1;
    let active = true;
    const setMinimumReplicas = vi.fn(async (value: MinimumReplicas) => { minimum = value; });
    const withNoActiveTasks = vi.fn(async (write: () => Promise<void>) =>
      active ? { kind: 'active' } : { kind: 'idle', value: await write() });
    const tool = createSleepModule({ getMinimumReplicas: async () => minimum, setMinimumReplicas }).tools[0]!;
    const request = { server: { taskStore: { withNoActiveTasks } } } as unknown as FastifyRequest;
    const call = (operation: string) => tool.execute({ operation }, request, new AbortController().signal);

    await expect(call('restart')).rejects.toBeInstanceOf(ToolRefusal);
    await expect(call('sleep')).rejects.toBeInstanceOf(ToolRefusal);
    expect(setMinimumReplicas).not.toHaveBeenCalled();
    active = false;
    await expect(call('sleep')).resolves.toEqual({ status: 'requested', state: 'asleep', requestedMinimumReplicas: 0 });
    await expect(call('read')).resolves.toEqual({ state: 'asleep', minimumReplicas: 0 });
    await expect(call('wake')).resolves.toEqual({ status: 'requested', state: 'awake', requestedMinimumReplicas: 1 });
    await expect(call('read')).resolves.toEqual({ state: 'awake', minimumReplicas: 1 });
    expect(withNoActiveTasks).toHaveBeenCalledTimes(2);
    expect(setMinimumReplicas.mock.calls).toEqual([[0], [1]]);
  });
});
