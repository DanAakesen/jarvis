import type { FastifyRequest } from 'fastify';
import { piDispatchObjectId } from '../auth/pi-credential.js';
import type { ConversationMessage } from './conversation-store.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set on the tool route only for the PI agent's own calls: a chat or voice turn, or a background wake. */
    jarvisPi?: 'turn' | 'wake';
  }
}

/** Not a real message id: it passes the id format checks but can never match a stored row, so a wrong use fails loudly. */
const wakeMessageId = '9223372036854775807';

/** True only for the in-process identity the PI MCP door uses for its own dispatches, never for another agent identity. */
export function isPiDispatch(request: FastifyRequest): boolean {
  return request.agentPrincipal?.objectId.toLowerCase() === piDispatchObjectId;
}

/** True for any call the PI agent makes itself, in a chat or voice turn or in a wake. */
export function isPiCall(request: FastifyRequest): boolean {
  return request.agentPrincipal !== null && request.agentPrincipal !== undefined && request.jarvisPi !== undefined;
}

/** True for a background wake of the PI agent, which has no owner message to point at. */
export function isPiWake(request: FastifyRequest): boolean {
  return request.agentPrincipal !== null && request.agentPrincipal !== undefined && request.jarvisPi === 'wake';
}

/**
 * The stand-in source of a wake's own action. Tools that record where a request came from use it instead of a Dan message;
 * nothing is attributed to Dan and nothing is written to a conversation.
 */
export function piWakeSource(request: FastifyRequest): ConversationMessage {
  const run = request.headers['x-jarvis-brain'];
  return {
    id: wakeMessageId, sessionId: `wake:${typeof run === 'string' ? run : 'unknown'}`, role: 'jarvis', text: '', model: 'pi', at: new Date(),
  };
}
