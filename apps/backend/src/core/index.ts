import type { BackendModule } from '../modules.js';
import { confirmToolCall, type ToolCallOutcome } from './tool-calls.js';
import { ToolRefusal } from './tool-registry.js';
import { registerSettingsRoutes } from './settings.js';
import { registerNowRoutes } from './now.js';
import { registerUsageRoutes } from './usage.js';
import { setJarvisModelTool } from './model-tools.js';

export const coreModule: BackendModule = {
  id: 'core',
  tools: [setJarvisModelTool],
  registerRoutes: async (app) => {
    await registerSettingsRoutes(app);
    registerNowRoutes(app);
    await registerUsageRoutes(app);
    app.get('/database/status', {
      schema: { response: { 200: { type: 'object', properties: { waking: { type: 'boolean' } }, required: ['waking'], additionalProperties: false } } },
    }, async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return { waking: app.databaseStatus() };
    });
    app.get('/health', {
      schema: { response: { 200: { type: 'object', properties: { status: { type: 'string', const: 'ok' } }, required: ['status'], additionalProperties: false } } },
    }, async () => ({ status: 'ok' }));
    app.get('/me', {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: { name: { type: 'string', minLength: 1, maxLength: 200 } },
            required: ['name'],
            additionalProperties: false,
          },
          401: {
            type: 'object',
            properties: { error: { type: 'string', const: 'Unauthorized' } },
            required: ['error'],
            additionalProperties: false,
          },
        },
      },
    }, async (request, reply) => {
      if (!request.principal) return reply.code(401).send({ error: 'Unauthorized' });
      return { name: request.principal.displayName };
    });
    app.get('/tools', { config: { jarvisAgent: true } }, async () => app.jarvisTools.list().map(({ name, description, inputSchema }) => ({
      name, description, inputSchema,
    })));
    for (const tool of app.jarvisTools.list()) {
      app.post(`/tools/${tool.name}`, { config: { jarvisAgent: true }, schema: { body: tool.inputSchema } }, async (request, reply) => {
        if (!app.toolCallStore) return reply.code(503).send({ error: 'Tool execution unavailable' });
        const messageId = request.headers['x-jarvis-message-id'];
        if (typeof messageId !== 'string' || !/^[1-9]\d{0,18}$/.test(messageId) ||
          BigInt(messageId) > 9_223_372_036_854_775_807n) {
          return reply.code(400).send({ error: 'Invalid message ID' });
        }

        const controller = new AbortController();
        const abortOnRequest = () => controller.abort();
        const abortOnClose = () => {
          if (!reply.raw.writableEnded) controller.abort();
        };
        request.raw.once('aborted', abortOnRequest);
        reply.raw.once('close', abortOnClose);
        let outcome: ToolCallOutcome = 'ok';
        let result: unknown;
        try {
          result = await tool.execute(request.body, request, controller.signal);
          const serialized = JSON.stringify(result);
          if (serialized === undefined || Buffer.byteLength(serialized) > 1024 * 1024) {
            throw new Error('Tool result is not serializable or exceeds the size limit');
          }
        } catch (error) {
          if (error instanceof ToolRefusal && !controller.signal.aborted) {
            outcome = 'refused';
            result = { refused: error.message };
          } else {
            outcome = 'error';
            result = { error: 'Tool execution failed' };
          }
        } finally {
          request.raw.removeListener('aborted', abortOnRequest);
          reply.raw.removeListener('close', abortOnClose);
        }
        await app.toolCallStore.record({ messageId, tool: tool.name, arguments: request.body, result, outcome });
        return { tool: tool.name, outcome, result, confirmation: confirmToolCall(tool.name, outcome, result) };
      });
    }
  },
};
