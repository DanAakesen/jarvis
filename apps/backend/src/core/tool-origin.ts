import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyRequest } from 'fastify';

// Voice reaches tools through the owner's realtime socket, so Jarvis' own calls there carry the owner principal
// instead of the agent identity. The relay binds one call it received from the model to this async scope. The
// binding lives in process memory only: it is never read from arguments, headers or the browser, and it does not
// reach concurrent work on the same request such as reflex actions.
const modelToolCall = new AsyncLocalStorage<FastifyRequest>();

/** Runs one model-issued tool call on an owner-authenticated request. */
export function runModelToolCall<T>(request: FastifyRequest, run: () => Promise<T>): Promise<T> {
  return modelToolCall.run(request, run);
}

/** True for Jarvis' agent identity, or for a model-issued call made on behalf of the authenticated workspace owner. */
export function isJarvisToolCall(request: FastifyRequest): boolean {
  if (request.agentPrincipal) return true;
  if (!request.principal || modelToolCall.getStore() !== request) return false;
  return request.principal.objectId.toLowerCase() === request.server.ownerObjectId.toLowerCase();
}
