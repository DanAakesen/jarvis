import { randomUUID } from 'node:crypto';
import { generatedViewSchema, isGeneratedView } from '@jarvis/contracts';
import type { BackendModule } from '../modules.js';
import { confirmToolCall, type ToolCallOutcome } from './tool-calls.js';
import { ToolFailure, ToolRefusal } from './tool-registry.js';
import { registerSettingsRoutes } from './settings.js';
import { setThemeTool } from './theme.js';
import { registerNowRoutes } from './now.js';
import { getUsageTool, registerUsageRoutes } from './usage.js';
import { setJarvisModelTool } from './model-tools.js';
import { getSettingsTool, updateSettingsTool } from './settings-tools.js';
import { renewCredentialTool } from './credential-tools.js';
import { manageModelDeploymentTool, registerModelDeploymentRoutes } from './model-deployments.js';
import { setAwayModeTool, setPresenceModeTool } from './away-mode.js';
import { getStatusSummaryTool } from './status.js';
import { getSystemHealthTool } from './system-health.js';
import { generatedViewValidationOptions } from './generated-view-validation.js';
import { registerWorkspaceCommandRoutes, workspaceCommandTool } from './workspace-commands.js';
import { readWindowTool } from './read-window.js';
import { cancelJobTool, getJobTool, listJobsTool, registerJobRoutes } from './jobs.js';
import { findChatReflexReplay } from './reflex.js';
import { executePhoneTool } from '../phone/approval.js';
import { systemSmokeResponseSchema, systemStatusResponseSchema } from '../system-status.js';
import { toolArgumentRefusal, unexpectedToolArgument } from './tool-arguments.js';
import { startWorkPresentation } from './work-presentation.js';

const readOnlyToolsWithoutMessage = new Set(['memory_search', 'vault_search', 'vault_read']);

// Keep deletable memory content out of the durable generic tool-call audit.
function auditToolArguments(toolName: string, value: unknown): unknown {
  return toolName.startsWith('memory_') ? {} : value;
}

function auditToolResult(toolName: string, outcome: ToolCallOutcome, result: unknown): unknown {
  if (toolName === 'image_generation') {
    const artifactId = isObject(result) && typeof result.artifactId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(result.artifactId)
      ? result.artifactId
      : undefined;
    return outcome === 'ok' && artifactId ? { artifactId } : {};
  }
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
  tools: [setThemeTool, getSettingsTool, updateSettingsTool, renewCredentialTool, setJarvisModelTool, manageModelDeploymentTool, setPresenceModeTool, setAwayModeTool, getStatusSummaryTool, getSystemHealthTool, workspaceCommandTool, readWindowTool, listJobsTool, getJobTool, cancelJobTool, getUsageTool],
  registerRoutes: async (app) => {
    await registerSettingsRoutes(app);
    registerModelDeploymentRoutes(app);
    registerNowRoutes(app);
    await registerUsageRoutes(app);
    registerWorkspaceCommandRoutes(app);
    registerJobRoutes(app);
    app.get('/database/status', {
      schema: { response: { 200: { type: 'object', properties: { waking: { type: 'boolean' } }, required: ['waking'], additionalProperties: false } } },
    }, async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return { waking: app.databaseStatus() };
    });
    app.get('/status', { schema: { response: {
      200: systemStatusResponseSchema,
      401: {
        type: 'object',
        properties: { error: { type: 'string', const: 'Unauthorized' } },
        required: ['error'],
        additionalProperties: false,
      },
    } } }, async (request, reply) => {
      if (!request.principal) return reply.code(401).send({ error: 'Unauthorized' });
      reply.header('Cache-Control', 'private, max-age=30');
      return app.systemStatusReader.read();
    });
    app.get('/status/smoke', {
      config: { jarvisDeploySmoke: true },
      schema: { response: {
        200: systemSmokeResponseSchema,
        401: {
          type: 'object',
          properties: { error: { type: 'string', const: 'Unauthorized' } },
          required: ['error'],
          additionalProperties: false,
        },
      } },
    }, async (request, reply) => {
      if (!request.principal && !request.deployPrincipal) return reply.code(401).send({ error: 'Unauthorized' });
      reply.header('Cache-Control', 'no-store');
      return app.systemSmokeReader.run();
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
      app.post(`/tools/${tool.name}`, {
        config: { jarvisAgent: true },
        ...(tool.bodyLimit ? { bodyLimit: tool.bodyLimit } : {}),
        schema: { body: tool.inputSchema },
        preValidation: async (request, reply) => {
          // Fastify otherwise silently removes unknown root properties.
          const error = unexpectedToolArgument(request.body, tool.inputSchema);
          if (error) {
            app.systemHealthDiagnostics.record('invalid');
            const result = toolArgumentRefusal(tool, error, request.log);
            return reply.send({ tool: tool.name, outcome: 'refused', result, confirmation: confirmToolCall(tool.name, 'refused', result) });
          }
        },
        errorHandler: (error, request, reply) => {
          if (!error.validation || error.validationContext !== 'body') return reply.send(error);
          app.systemHealthDiagnostics.record('invalid');
          const result = toolArgumentRefusal(tool, error.validation, request.log);
          return reply.code(200).send({
            tool: tool.name, outcome: 'refused', result, confirmation: confirmToolCall(tool.name, 'refused', result),
          });
        },
      }, async (request, reply) => {
        const messageHeader = request.headers['x-jarvis-message-id'];
        const voiceItemHeader = request.headers['x-jarvis-voice-item-id'];
        const phoneSessionHeader = request.headers['x-jarvis-phone-session-id'];
        if (phoneSessionHeader !== undefined &&
            (typeof phoneSessionHeader !== 'string' ||
             !/^[1-9]\d{0,18}$/u.test(phoneSessionHeader) ||
             BigInt(phoneSessionHeader) > 9_223_372_036_854_775_807n)) {
          return reply.code(403).send({ error: 'Phone session unavailable' });
        }
        const phoneSessionId = typeof phoneSessionHeader === 'string' ? phoneSessionHeader : undefined;
        let messageId = typeof messageHeader === 'string' ? messageHeader : undefined;
        if (messageHeader === undefined && typeof voiceItemHeader === 'string' &&
            /^[A-Za-z0-9_-]{1,128}$/u.test(voiceItemHeader)) {
          messageId = await app.conversationStore?.getDanMessageIdBySourceItemId(voiceItemHeader) ?? undefined;
        }
        const validMessageId = messageId !== undefined &&
          /^[1-9]\d{0,18}$/u.test(messageId) && BigInt(messageId) <= 9_223_372_036_854_775_807n;
        const unrecordedRead = messageId === undefined && request.agentPrincipal !== null &&
          readOnlyToolsWithoutMessage.has(tool.name);
        if (!validMessageId && !unrecordedRead) {
          return reply.code(400).send({ error: 'Invalid message ID' });
        }
        if (messageHeader === undefined && messageId !== undefined && validMessageId) {
          request.jarvisMemorySourceMessageId = messageId;
        }
        if (validMessageId && !app.toolCallStore) return reply.code(503).send({ error: 'Tool execution unavailable' });
        if (validMessageId && phoneSessionId === undefined && voiceItemHeader === undefined &&
            (tool.reflexSafe || tool.name === 'workspace_command')) {
          const reflex = await findChatReflexReplay(messageId!, tool.name, request.body);
          if (reflex) {
            return {
              tool: tool.name,
              outcome: reflex.outcome,
              result: reflex.result,
              confirmation: reflex.note,
            };
          }
        }

        const activityId = randomUUID();
        const source = voiceItemHeader === undefined ? 'chat' : 'voice';
        const activity = (type: 'tool-call-started' | 'tool-call-finished' | 'failed', outcome?: ToolCallOutcome) => {
          if (type === 'tool-call-started') {
            app.jarvisActivityHub.publish({ type, activityId, source, toolName: tool.name });
          } else if (type === 'tool-call-finished') {
            app.jarvisActivityHub.publish({ type, activityId, source, toolName: tool.name, outcome: outcome ?? 'error' });
          } else {
            app.jarvisActivityHub.publish({ type, activityId, source });
          }
        };
        if (validMessageId) activity('tool-call-started');
        const controller = new AbortController();
        const abortOnRequest = () => controller.abort();
        const abortOnClose = () => {
          if (!reply.raw.writableEnded) controller.abort();
        };
        request.raw.once('aborted', abortOnRequest);
        reply.raw.once('close', abortOnClose);
        const presentation = startWorkPresentation(tool.name, request.body, request, activityId,
          messageId ?? (typeof voiceItemHeader === 'string' ? voiceItemHeader : activityId), controller.signal,
          voiceItemHeader !== undefined || phoneSessionId !== undefined ? 'voice' : 'chat');
        let outcome: ToolCallOutcome = 'ok';
        let result: unknown;
        try {
          result = phoneSessionId === undefined
            ? await tool.execute(request.body, request, controller.signal)
            : await executePhoneTool({
              tool,
              sessionId: phoneSessionId,
              callerId: app.ownerObjectId,
              store: app.phoneSessionStore,
              notifications: app.teamsNotifications,
              signal: controller.signal,
              execute: () => tool.execute(request.body, request, controller.signal),
            });
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
          if (outcome === 'error') app.systemHealthDiagnostics.record('failed');
          presentation.finish(result, outcome === 'ok');
          request.raw.removeListener('aborted', abortOnRequest);
          reply.raw.removeListener('close', abortOnClose);
        }
        if (validMessageId) {
          try {
            await app.toolCallStore!.record({
              messageId: messageId!,
              tool: tool.name,
              arguments: tool.sensitive ? { redacted: true } : auditToolArguments(tool.name, request.body),
              result: tool.sensitive && tool.name !== 'image_generation'
                ? { redacted: true }
                : auditToolResult(tool.name, outcome, result),
              outcome,
            });
          } catch (error) {
            activity('failed');
            throw error;
          }
          activity('tool-call-finished', outcome);
        }
        return { tool: tool.name, outcome, result, confirmation: confirmToolCall(tool.name, outcome, result) };
      });
    }
  },
};
