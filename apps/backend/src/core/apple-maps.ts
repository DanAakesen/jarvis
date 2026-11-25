import { randomUUID } from 'node:crypto';
import {
  appleMapsQuerySchema, isAppleMapsQuery, type AppleMapsViewData, type GeneratedView,
} from '@jarvis/contracts';
import type { FastifyRequest } from 'fastify';
import { finalizeChatBlock } from './chat-blocks.js';
import { ToolFailure, ToolRefusal, type JarvisTool } from './tool-registry.js';

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
  description: 'Find a place, nearby business, route or travel time in Apple Maps on the connected iPhone. For a nearby named shop use nearby=name and the brand alone as query. For a nearby type of business use nearby=category and the category as query. A nearby result needs nearbyRadiusMeters in the phone receipt. For no_matches, report the empty result and include the radius only if returned. When reason=needs_origin, ask for a starting address. When asked for the nearest named business, including after a nearby search finds none, use nearest=true with the brand alone. The iPhone compares matching businesses by straight-line distance from the origin and shows the closest returned match on the card. Use searchOnly for an unrestricted place lookup, or omit nearby for directions to a destination. Use origin for a manual starting address, arriveBy and optional bufferMinutes for departure estimates, and driving or walking mode. For a choice, send the earlier lookupId and one-based ordinal together. The iPhone displays the map and speaks Voice results locally. Report only the receipt; ask for an origin or a fresh search when needed.',
  inputSchema: appleMapsQuerySchema,
  sensitive: true,
  execution: { defaultEffect: 'read' },
  validateInput: isAppleMapsQuery,
  async execute(input, request, signal) {
    if (!isAppleMapsQuery(input)) throw new ToolRefusal('Give a destination or place to search for, and optional origin, mode, arrival time or buffer.');
    const voice = request.jarvisPi === 'turn' && request.headers['x-jarvis-pi-channel'] === 'voice';
    const { lookupId, ...receipt } = await request.server.workspaceCommands.appleMaps(request.server.ownerObjectId, input, voice, signal);
    if ('nearby' in input && input.nearby && receipt.matches > 0 && !receipt.nearbyRadiusMeters) {
      throw new ToolRefusal('The iPhone did not verify that these places are nearby.');
    }
    if ('nearest' in input && input.nearest && receipt.matches > 0 && !receipt.nearest) {
      throw new ToolRefusal('The iPhone could not verify which matching business was closest.');
    }
    let presentation = 'No places to show.';
    if (receipt.matches > 0) {
      presentation = await present({ lookupId, ...('query' in input ? { request: input } : {}) }, receipt.reason ? 'partial' : 'complete', voice, request, signal)
        .catch((error: unknown) => error instanceof ToolFailure && error.outcomeUnknown ? error.message : 'The map could not be shown.');
    }
    return { ...receipt, ...(receipt.matches > 1 ? { lookupId } : {}), presentation };
  },
};
