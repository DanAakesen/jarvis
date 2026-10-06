import type { FastifyRequest } from 'fastify';

export type JevFailureReason =
  | 'billing'
  | 'auth'
  | 'rate_limited'
  | 'timeout'
  | 'invalid_answer'
  | 'network_error'
  | `http_${number}`;

export interface JevFailure {
  readonly failure: JevFailureReason;
}

export const jevChoiceConfidenceThreshold = 0.9;
export const reflexAddressedThreshold = 0.9;
export const reflexConfirmationThreshold = 0.5;
export const reflexCompleteCommandThreshold = 0.9;

export function jevFailureFromStatus(status: number): JevFailure {
  if (status === 402) return { failure: 'billing' };
  if (status === 401 || status === 403) return { failure: 'auth' };
  if (status === 429) return { failure: 'rate_limited' };
  return { failure: `http_${status}` };
}

export function isJevFailure(value: unknown): value is JevFailure {
  if (typeof value !== 'object' || value === null || !('failure' in value) ||
      typeof value.failure !== 'string') return false;
  return ['billing', 'auth', 'rate_limited', 'timeout', 'invalid_answer', 'network_error']
    .includes(value.failure) ||
    /^http_[1-5]\d{2}$/u.test(value.failure);
}

export function reflexSourceForRequest(request: FastifyRequest): 'chat' | 'voice-final' {
  return request.routeOptions.url?.includes('/voice') ? 'voice-final' : 'chat';
}

export function logJevFailure(
  request: FastifyRequest,
  source: 'chat' | 'voice-partial' | 'voice-final',
  startedAt: number,
  failure: JevFailureReason,
): void {
  request.log.info({
    source,
    addressed: false,
    intent: 'other',
    tool: 'none',
    confidence: '<0.5',
    completeCommand: false,
    executed: false,
    reason: failure,
    latencyMs: Math.min(600_000, Math.max(0, performance.now() - startedAt)),
  }, 'reflex.decision');
}
