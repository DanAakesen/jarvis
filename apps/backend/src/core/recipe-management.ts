import { routineNameSchema, routineUpdateSchema } from '@jarvis/contracts';
import type { BackendModule } from '../modules.js';
import { ToolRefusal, type JarvisTool } from './tool-registry.js';
import { normalizeRoutineName, type RecipeStore } from './task-recipes.js';

const routineIdSchema = { type: 'string', pattern: '^[a-f0-9]{64}$' };

function createManagementTool(name: string, legacy: boolean, store: RecipeStore | undefined): JarvisTool {
  return {
    name,
    description: `${legacy ? 'Legacy alias. ' : ''}List, rename, or delete saved PC/browser routines. Routines contain no entered text; deleting one prevents future reuse.`,
    sensitive: true,
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['action'],
      properties: {
        action: { type: 'string', enum: ['list', 'delete', 'rename', 'update'] },
        id: routineIdSchema,
        name: routineNameSchema,
      },
    },
    async execute(input, _request, signal) {
      signal.throwIfAborted();
      if (!store) throw new ToolRefusal('Routines are unavailable.');
      const args = input as { action?: string; id?: string; name?: string };
      if (args.action === 'list' && args.id === undefined && args.name === undefined) {
        const routines = await store.list();
        return legacy ? { recipes: routines } : { routines };
      }
      if (args.action === 'delete' && args.id && /^[a-f0-9]{64}$/u.test(args.id) && args.name === undefined) {
        return { deleted: await store.delete(args.id) };
      }
      if ((args.action === 'rename' || args.action === 'update') &&
          args.id && /^[a-f0-9]{64}$/u.test(args.id) && args.name !== undefined) {
        const normalizedName = normalizeRoutineName(args.name);
        if (!normalizedName) throw new ToolRefusal('Choose a safe routine name of at most 80 characters.');
        return { updated: await store.rename(args.id, normalizedName) };
      }
      throw new ToolRefusal('Choose list, delete with a routine ID, or rename with a routine ID and name.');
    },
  };
}

export function createRecipeModule(store: RecipeStore | undefined): BackendModule {
  const tools = [
    createManagementTool('task_routines', false, store),
    createManagementTool('task_recipes', true, store),
  ];
  const module: BackendModule = {
    id: 'task-recipes',
    tools,
    registerRoutes: async app => {
      for (const path of ['/routines', '/recipes']) {
        app.get(path, async (_request, reply) => {
          reply.header('Cache-Control', 'no-store');
          if (!store) return reply.code(503).send({ error: 'Routines unavailable' });
          const routines = await store.list();
          return path === '/recipes' ? { recipes: routines } : { routines };
        });
      }
      for (const path of ['/routines/:id', '/recipes/:id']) {
        app.patch<{ Params: { id: string }; Body: { name: string } }>(path, {
          schema: {
            params: {
              type: 'object', additionalProperties: false, required: ['id'],
              properties: { id: routineIdSchema },
            },
            body: routineUpdateSchema,
          },
        }, async (request, reply) => {
          reply.header('Cache-Control', 'no-store');
          if (!store) return reply.code(503).send({ error: 'Routines unavailable' });
          const name = normalizeRoutineName(request.body.name);
          if (!name) return reply.code(400).send({ error: 'Invalid routine name' });
          if (!await store.rename(request.params.id, name)) return reply.code(404).send({ error: 'Routine not found' });
          return { updated: true };
        });
      }
      for (const path of ['/routines/:id', '/recipes/:id']) {
        app.delete<{ Params: { id: string } }>(path, {
          schema: {
            params: {
              type: 'object', additionalProperties: false, required: ['id'],
              properties: { id: routineIdSchema },
            },
          },
        }, async (request, reply) => {
          reply.header('Cache-Control', 'no-store');
          if (!store) return reply.code(503).send({ error: 'Routines unavailable' });
          if (!await store.delete(request.params.id)) return reply.code(404).send({ error: 'Routine not found' });
          return reply.code(204).send();
        });
      }
    },
  };
  return module;
}
