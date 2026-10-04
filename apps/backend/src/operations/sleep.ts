import type { BackendModule } from '../modules.js';
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
  return {
    id: 'operations',
    tools: [],
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
        if (!scaler) return reply.code(503).send({ error: 'Backend scaling is unavailable' });
        if (request.body.state === 'asleep') {
          const taskStore = app.taskStore;
          if (!taskStore) return reply.code(503).send({ error: 'Task service unavailable' });
          try {
            const result = await taskStore.withNoActiveTasks(() => scaler.setMinimumReplicas(0));
            if (result.kind === 'active') {
              return reply.code(409).send({ error: 'Cannot put the backend to sleep while tasks are Ready, Running, or PauseRequested.' });
            }
            return { state: 'asleep' };
          } catch {
            return reply.code(503).send({ error: 'Backend scaling is unavailable' });
          }
        }
        try {
          await scaler.setMinimumReplicas(toMinimumReplicas(request.body.state));
          return { state: request.body.state };
        } catch {
          return reply.code(503).send({ error: 'Backend scaling is unavailable' });
        }
      });
    },
  };
}
