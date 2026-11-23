import type { BackendModule } from '../modules.js';
import { ToolFailure, ToolRefusal } from '../core/tool-registry.js';
import type { TaskStore } from '../factory/task-store.js';
import type { ContainerAppScaler, MinimumReplicas } from './container-app-scale.js';

const sleepStates = ['awake', 'asleep'] as const;
type SleepState = typeof sleepStates[number];

function toMinimumReplicas(state: SleepState): MinimumReplicas {
  return state === 'asleep' ? 0 : 1;
}

function toSleepState(minimumReplicas: MinimumReplicas): SleepState {
  return minimumReplicas === 0 ? 'asleep' : 'awake';
}

export function createSleepModule(scaler: ContainerAppScaler | null): BackendModule {
  async function changeState(state: SleepState, taskStore: TaskStore | null) {
    if (!scaler) throw new ToolFailure('Backend scaling is unavailable');
    try {
      if (state === 'asleep') {
        if (!taskStore) throw new ToolFailure('Task service unavailable');
        const result = await taskStore.withNoActiveTasks(() => scaler.setMinimumReplicas(0));
        if (result.kind === 'active') throw new ToolRefusal('Cannot put the backend to sleep while tasks are Ready, Running, or PauseRequested.');
      } else {
        await scaler.setMinimumReplicas(toMinimumReplicas(state));
      }
    } catch (error) {
      if (error instanceof ToolRefusal || error instanceof ToolFailure) throw error;
      throw new ToolFailure('The sleep switch change was not confirmed. Read its state before retrying.', { outcomeUnknown: true });
    }
  }

  return {
    id: 'operations',
    tools: scaler ? [{
      name: 'backend_sleep',
      description: 'Read the Jarvis backend Container App sleep switch, put it to sleep (minimum zero replicas), or wake it (minimum one). Sleep permits scale-to-zero when idle. Wake keeps one replica warm and can incur running costs.',
      inputSchema: { type: 'object', properties: { operation: { type: 'string', enum: ['read', 'sleep', 'wake'] } }, required: ['operation'], additionalProperties: false },
      async execute(input, request) {
        const { operation } = input as { operation: 'read' | 'sleep' | 'wake' };
        if (operation === 'read') {
          try {
            const minimumReplicas = await scaler.getMinimumReplicas();
            return { state: toSleepState(minimumReplicas), minimumReplicas };
          } catch { throw new ToolFailure('Backend scaling is unavailable'); }
        }
        if (operation !== 'sleep' && operation !== 'wake') throw new ToolRefusal('Choose read, sleep, or wake.');
        const state = operation === 'sleep' ? 'asleep' : 'awake';
        await changeState(state, request.server.taskStore);
        return { status: 'requested', state, requestedMinimumReplicas: toMinimumReplicas(state) };
      },
    }] : [],
    registerRoutes: async (app) => {
      app.get('/operations/sleep', async (_request, reply) => {
        if (!scaler) return reply.code(503).send({ error: 'Backend scaling is unavailable' });
        try {
          return { state: toSleepState(await scaler.getMinimumReplicas()) };
        } catch {
          return reply.code(503).send({ error: 'Backend scaling is unavailable' });
        }
      });

      app.put<{ Body: { state: SleepState } }>('/operations/sleep', {
        schema: {
          body: {
            type: 'object',
            properties: { state: { type: 'string', enum: sleepStates } },
            required: ['state'],
            additionalProperties: false,
          },
        },
      }, async (request, reply) => {
        try {
          await changeState(request.body.state, app.taskStore);
          return { state: request.body.state };
        } catch (error) {
          if (error instanceof ToolRefusal) return reply.code(409).send({ error: error.message });
          if (error instanceof ToolFailure && !error.outcomeUnknown) return reply.code(503).send({ error: error.message });
          return reply.code(503).send({ error: 'Backend scaling is unavailable' });
        }
      });
    },
  };
}
