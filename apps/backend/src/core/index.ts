import type { BackendModule } from '../modules.js';

export const coreModule: BackendModule = {
  id: 'core',
  tools: [],
  registerRoutes: async (app) => {
    app.get('/health', {
      schema: { response: { 200: { type: 'object', properties: { status: { type: 'string', const: 'ok' } }, required: ['status'], additionalProperties: false } } },
    }, async () => ({ status: 'ok' }));
    app.get('/tools', async () => app.jarvisTools.list().map(({ name, description, inputSchema }) => ({
      name, description, inputSchema,
    })));
    for (const tool of app.jarvisTools.list()) {
      app.post(`/tools/${tool.name}`, { schema: { body: tool.inputSchema } }, async (request, reply) => {
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
        let outcome: 'ok' | 'error' = 'ok';
        let result: unknown;
        try {
          result = await tool.execute(request.body, request, controller.signal);
          const serialized = JSON.stringify(result);
          if (serialized === undefined || Buffer.byteLength(serialized) > 1024 * 1024) {
            throw new Error('Tool result is not serializable or exceeds the size limit');
          }
        } catch {
          outcome = 'error';
          result = { error: 'Tool execution failed' };
        } finally {
          request.raw.removeListener('aborted', abortOnRequest);
          reply.raw.removeListener('close', abortOnClose);
        }
        await app.toolCallStore.record({ messageId, tool: tool.name, arguments: request.body, result, outcome });
        return { tool: tool.name, outcome, result };
      });
    }
  },
};
