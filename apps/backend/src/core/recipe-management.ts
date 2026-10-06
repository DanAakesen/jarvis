import type { BackendModule } from '../modules.js';
import { ToolRefusal, type JarvisTool } from './tool-registry.js';
import type { RecipeStore } from './task-recipes.js';

export function createRecipeModule(store: RecipeStore | undefined): BackendModule {
  const tool: JarvisTool = {
    name: 'task_recipes',
    description: 'List saved PC/browser task recipes, or delete a recipe by its ID. Recipes contain no entered text. Deleting a recipe prevents future reuse.',
    sensitive: true,
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['action'],
      properties: {
        action: { type: 'string', enum: ['list', 'delete'] },
        id: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      },
    },
    async execute(input, _request, signal) {
      signal.throwIfAborted();
      if (!store) throw new ToolRefusal('Task recipes are unavailable.');
      const args = input as { action?: string; id?: string };
      if (args.action === 'list' && args.id === undefined) return { recipes: await store.list() };
      if (args.action !== 'delete' || !args.id || !/^[a-f0-9]{64}$/u.test(args.id)) {
        throw new ToolRefusal('Choose list, or delete with a recipe ID.');
      }
      return { deleted: await store.delete(args.id) };
    },
  };
  return {
    id: 'task-recipes',
    tools: [tool],
    registerRoutes: async app => {
      app.get('/recipes', async (_request, reply) => {
        reply.header('Cache-Control', 'no-store');
        if (!store) return reply.code(503).send({ error: 'Task recipes unavailable' });
        return { recipes: await store.list() };
      });
      app.delete<{ Params: { id: string } }>('/recipes/:id', {
        schema: {
          params: {
            type: 'object', additionalProperties: false, required: ['id'],
            properties: { id: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
          },
        },
      }, async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        if (!store) return reply.code(503).send({ error: 'Task recipes unavailable' });
        if (!await store.delete(request.params.id)) return reply.code(404).send({ error: 'Task recipe not found' });
        return reply.code(204).send();
      });
    },
  };
}
