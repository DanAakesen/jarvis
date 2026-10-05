import { generatedViewSchema, isGeneratedView } from '@jarvis/contracts';
import type { BackendModule } from '../modules.js';
import { confirmToolCall, type ToolCallOutcome } from './tool-calls.js';
import { ToolFailure, ToolRefusal } from './tool-registry.js';
import { registerSettingsRoutes } from './settings.js';
import { setThemeTool } from './theme.js';
import { registerNowRoutes } from './now.js';
import { registerUsageRoutes } from './usage.js';
import { setJarvisModelTool } from './model-tools.js';
import { setAwayModeTool } from './away-mode.js';
import { getStatusSummaryTool } from './status.js';
import { generatedViewValidationOptions } from './generated-view-validation.js';
import { registerWorkspaceCommandRoutes, workspaceCommandTool } from './workspace-commands.js';

const memoryReadOnlyTools = new Set(['memory_search', 'memory_list', 'memory_history']);

// Keep deletable memory content out of the durable generic tool-call audit.
function auditToolArguments(toolName: string, value: unknown): unknown {
  return toolName.startsWith('memory_') ? {} : value;
}

function auditToolResult(toolName: string, outcome: ToolCallOutcome, result: unknown): unknown {
  if (!toolName.startsWith('memory_')) return result;
  return {
    confirmation: outcome === 'ok'
      ? 'Memory operation completed.'
      : outcome === 'refused'
        ? 'Memory operation was refused.'
        : 'Memory operation failed.',
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const coreModule: BackendModule = {
  id: 'core',
  tools: [setThemeTool, setJarvisModelTool, setAwayModeTool, getStatusSummaryTool, workspaceCommandTool],
  registerRoutes: async (app) => {
    await registerSettingsRoutes(app);
    registerNowRoutes(app);
    await registerUsageRoutes(app);
    registerWorkspaceCommandRoutes(app);
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
        const messageHeader = request.headers['x-jarvis-message-id'];
        const voiceItemHeader = request.headers['x-jarvis-voice-item-id'];
        let messageId = typeof messageHeader === 'string' ? messageHeader : undefined;
        if (messageHeader === undefined && typeof voiceItemHeader === 'string' &&
            /^[A-Za-z0-9_-]{1,128}$/u.test(voiceItemHeader)) {
          messageId = await app.conversationStore?.getDanMessageIdBySourceItemId(voiceItemHeader) ?? undefined;
        }
        const validMessageId = messageId !== undefined &&
          /^[1-9]\d{0,18}$/u.test(messageId) && BigInt(messageId) <= 9_223_372_036_854_775_807n;
        const unrecordedRead = messageId === undefined && request.agentPrincipal !== null &&
          memoryReadOnlyTools.has(tool.name);
        if (!validMessageId && !unrecordedRead) {
          return reply.code(400).send({ error: 'Invalid message ID' });
        }
        if (messageHeader === undefined && messageId !== undefined && validMessageId) {
          request.jarvisMemorySourceMessageId = messageId;
        }
        if (validMessageId && !app.toolCallStore) return reply.code(503).send({ error: 'Tool execution unavailable' });

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
          if (isObject(result) && result.type === 'generated-view') {
            const validateView = request.compileValidationSchema(generatedViewSchema, 'body');
            if (!validateView(result.view) || !isGeneratedView(result.view, {
              ...generatedViewValidationOptions(app),
            })) throw new Error('Tool returned an invalid generated view');
          }
          const serialized = JSON.stringify(result);
          if (serialized === undefined || Buffer.byteLength(serialized) > 1024 * 1024) {
            throw new Error('Tool result is not serializable or exceeds the size limit');
          }
        } catch (error) {
          if (error instanceof ToolRefusal && !controller.signal.aborted) {
            outcome = 'refused';
            result = { refused: error.message };
          } else if (error instanceof ToolFailure && !controller.signal.aborted) {
            outcome = 'error';
            result = { error: error.message };
          } else {
            outcome = 'error';
            result = { error: 'Tool execution failed' };
          }
        } finally {
          request.raw.removeListener('aborted', abortOnRequest);
          reply.raw.removeListener('close', abortOnClose);
        }
        if (validMessageId) {
          await app.toolCallStore!.record({
            messageId: messageId!,
            tool: tool.name,
            arguments: tool.sensitive ? { redacted: true } : auditToolArguments(tool.name, request.body),
            result: tool.sensitive ? { redacted: true } : auditToolResult(tool.name, outcome, result),
            outcome,
          });
        }
        return { tool: tool.name, outcome, result, confirmation: confirmToolCall(tool.name, outcome, result) };
      });
    }
  },
};
