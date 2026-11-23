import { randomUUID } from 'node:crypto';
import {
  appleMapsQuerySchema, isAppleMapsQuery, type AppleMapsViewData, type GeneratedView,
} from '@jarvis/contracts';
import type { FastifyRequest } from 'fastify';
import { finalizeChatBlock } from './chat-blocks.js';
import { ToolRefusal, type JarvisTool } from './tool-registry.js';

async function present(data: AppleMapsViewData, status: 'complete' | 'partial', voice: boolean, request: FastifyRequest, signal: AbortSignal): Promise<string> {
  const app = request.server;
  const title = 'Apple Maps';
  const view: GeneratedView = { version: 1, renderer: 'map', title, data, source: { id: 'now', status } };
  if (voice) {
    await app.workspaceCommands.execute(app.ownerObjectId, {
      operation: 'create', target: 'phone', commandId: randomUUID(), viewId: data.lookupId, view,
    }, signal);
    return 'Map shown on the phone.';
  }
  const messageId = request.headers['x-jarvis-message-id'] ?? request.jarvisMemorySourceMessageId;
  const sessionId = typeof messageId === 'string' ? await app.conversationStore?.getMessageSessionId?.(messageId) : null;
  if (!sessionId || (await app.conversationStore?.getSession(sessionId))?.channel !== 'chat') return 'No typed reply to attach a map to.';
  const block = finalizeChatBlock({ version: 1, type: 'view', title, data: { view },
    source: { label: 'Apple Maps', status, ...(status === 'partial' ? { reason: 'The iPhone returned a partial result.' } : {}) },
    summary: 'Open the map on your iPhone to see the result.',
  });
  return app.chatBlocks.add(sessionId, block) ? 'Map attached to the reply.' : 'This reply already has its maximum number of cards.';
}

export const appleMapsTool: JarvisTool = {
  name: 'apple_maps',
  description: 'Find a place, nearby business, route or travel time in Apple Maps using the connected iPhone. Ask when to leave with arriveBy and optional bufferMinutes; use driving or walking. Use searchOnly for a named place without directions or local proximity. Give origin to route from an address instead of the current location. The iPhone shows the map and speaks Voice results locally. For a choice like “the second one”, send the earlier receipt’s lookupId and one-based ordinal together. If the list expired, ask for a fresh search. You receive only a receipt: do not invent or repeat directions, places or travel times. Ask for an origin if needed.',
  inputSchema: appleMapsQuerySchema,
  sensitive: true,
  execution: { defaultEffect: 'read' },
  validateInput: isAppleMapsQuery,
  async execute(input, request, signal) {
    if (!isAppleMapsQuery(input)) throw new ToolRefusal('Give a destination or place to search for, and optional origin, mode, arrival time or buffer.');
    const voice = request.jarvisPi === 'turn' && request.headers['x-jarvis-pi-channel'] === 'voice';
    const { lookupId, ...receipt } = await request.server.workspaceCommands.appleMaps(request.server.ownerObjectId, input, voice, signal);
    let presentation = 'No places to show.';
    if (receipt.matches > 0) {
      presentation = await present({ lookupId, ...('query' in input ? { request: input } : {}) }, receipt.reason ? 'partial' : 'complete', voice, request, signal)
        .catch(() => 'The map could not be shown.');
    }
    return { ...receipt, ...(receipt.matches > 1 ? { lookupId } : {}), presentation };
  },
};
