import type { BackendModule } from '../modules.js';
import type { TaskState } from '../factory/task-lifecycle.js';
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

async function hasReadyOrRunningTasks(taskStore: TaskStore) {
  const filters = (state: TaskState) => ({ state, limit: 1, offset: 0 });
  const [ready, running] = await Promise.all([
    taskStore.list(filters('Ready')),
    taskStore.list(filters('Running')),
  ]);
  return ready.length > 0 || running.length > 0;
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
          if (await hasReadyOrRunningTasks(taskStore)) {
            return reply.code(409).send({ error: 'Cannot put the backend to sleep while tasks are Ready or Running.' });
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
