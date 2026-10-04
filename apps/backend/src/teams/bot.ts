import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { App, type IHttpServerAdapter, type IHttpServerRequest, type IHttpServerResponse } from '@microsoft/teams.apps';
import type { ActivityLike, ConversationReference } from '@microsoft/teams.api';
import type { ILogger } from '@microsoft/teams.common';
import type { BackendModule } from '../modules.js';
import { createAskDanToConfirmTool, type TeamsConnector, type TeamsNotificationService } from './service.js';
import type { EphemeralAudioStore } from './audio-store.js';

const noOpLogger: ILogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  trace() {},
  log() {},
  child() { return noOpLogger; },
};

class FastifyTeamsAdapter implements IHttpServerAdapter {
  private handler: ((request: IHttpServerRequest) => Promise<IHttpServerResponse>) | undefined;

  registerRoute(method: 'POST', path: string, handler: (request: IHttpServerRequest) => Promise<IHttpServerResponse>) {
    if (method !== 'POST' || path !== '/api/messages' || this.handler) {
      throw new Error('Unsupported Teams bot route');
    }
    this.handler = handler;
  }

  async dispatch(request: IHttpServerRequest): Promise<IHttpServerResponse> {
    if (!this.handler) return { status: 503 };
    return this.handler(request);
  }

  async start() {}
  async stop() {}
}

function safeRequestHeaders(headers: FastifyRequest['headers']) {
  const safe: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string' || (Array.isArray(value) && value.every((entry) => typeof entry === 'string'))) {
      safe[name] = value as string | string[];
    }
  }
  return safe;
}

export function createTeamsConnector(clientId: string, tenantId: string): TeamsConnector {
  return {
    async send(reference: ConversationReference, activity: ActivityLike) {
      const sender = new App({
        clientId,
        tenantId,
        managedIdentityClientId: clientId,
        serviceUrl: reference.serviceUrl,
        logger: noOpLogger,
      });
      await sender.send(reference.conversation.id, activity);
    },
  };
}

export interface TeamsBotOptions {
  readonly clientId: string;
  readonly tenantId: string;
  readonly notificationService: TeamsNotificationService;
  readonly audioStore: EphemeralAudioStore;
}

export async function createTeamsBotModule({
  clientId,
  tenantId,
  notificationService,
  audioStore,
}: TeamsBotOptions): Promise<BackendModule & { close(): Promise<void> }> {
  const adapter = new FastifyTeamsAdapter();
  const bot = new App({
    clientId,
    tenantId,
    managedIdentityClientId: clientId,
    httpServerAdapter: adapter,
    messagingEndpoint: '/api/messages',
    logger: noOpLogger,
  });
  bot.on('message', async (context) => {
    await notificationService.rememberMessage(context.activity, context.ref);
  });
  bot.on('card.action.confirmation', async (context) => {
    const accepted = await notificationService.receiveConfirmation(context.activity, context.ref);
    return {
      statusCode: 200,
      type: 'application/vnd.microsoft.activity.message',
      value: accepted ? 'Response recorded.' : 'This request is no longer available.',
    };
  });
  await bot.initialize();

  const registerRoutes: FastifyPluginAsync = async (app) => {
    app.addHook('onClose', async () => {
      audioStore.clear();
      await bot.stop();
    });
    app.post('/api/messages', { config: { teamsBot: true } }, async (request, reply) => {
      const response = await adapter.dispatch({
        body: request.body,
        headers: safeRequestHeaders(request.headers),
      });
      reply.code(response.status);
      return response.body === undefined ? reply.send() : reply.send(response.body);
    });
    app.route({
      method: ['GET', 'HEAD'],
      url: '/teams/audio/:token',
      config: { teamsAudio: true },
      handler: async (request, reply) => {
        const { token } = request.params as { token: string };
        const bytes = audioStore.get(token);
        if (!bytes) return reply.code(404).send();
        reply
          .header('Content-Type', 'audio/mpeg')
          .header('Content-Length', bytes.length)
          .header('Cache-Control', 'no-store')
          .header('X-Content-Type-Options', 'nosniff');
        return request.method === 'HEAD' ? reply.send() : reply.send(bytes);
      },
    });
  };

  return {
    id: 'teams',
    registerRoutes,
    tools: [createAskDanToConfirmTool(notificationService)],
  };
}
