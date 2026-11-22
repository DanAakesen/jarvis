export const rateLimitCodes: ReadonlySet<string> = new Set(['rate_limit', 'rate_limit_exceeded', 'too_many_requests']);

const messages = {
  tokens: 'Token rate limit reached.',
  requests: 'Request rate limit reached.',
  capacity: 'Provider capacity limit reached.',
  backend: 'Provider reported a backend error.',
  other: 'Provider message omitted.',
} as const;
export const safeRateLimitMessages: ReadonlySet<string> = new Set(Object.values(messages));

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function duration(value: unknown, unit: number): number | undefined {
  const amount = typeof value === 'string' && /^\d+(?:\.\d+)?$/u.test(value.trim()) ? Number(value) : value;
  if (typeof amount !== 'number' || Number.isNaN(amount) || amount < 0) return undefined;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(amount * unit));
}

/** Summarise approved subjects, never copy the provider's prose (which can include prompts, ids and credentials). */
export function rateLimitDetails(error: unknown, now: Date, headers?: Headers): {
  providerMessage?: string; retryAfterMs?: number;
} {
  const body = object(error);
  const param = object(body.param);
  const message = typeof body.message === 'string' ? body.message.slice(0, 4096) : '';
  const standard = headers?.get('retry-after');
  const date = standard && /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/u.test(standard)
    ? Date.parse(standard) : NaN;
  const inMessage = /\b(?:retry after|try again in)\s+(\d{1,10}(?:\.\d{1,3})?)\s*(milliseconds?|ms|seconds?|s|minutes?|m)\b/iu.exec(message);
  const unit = inMessage?.[2]?.toLowerCase();
  const waits = [
    duration(standard, 1000), Number.isFinite(date) ? Math.max(0, date - now.getTime()) : undefined,
    duration(headers?.get('retry-after-ms'), 1), duration(headers?.get('x-ms-retry-after-ms'), 1),
    duration(body.retry_after, 1000), duration(param.retry_after, 1000),
    duration(body.retry_after_ms, 1), duration(param.retry_after_ms, 1),
    duration(inMessage?.[1], unit?.startsWith('ms') || unit?.startsWith('millisecond') ? 1 : unit?.startsWith('m') ? 60_000 : 1000),
  ].filter((value): value is number => value !== undefined);
  const providerMessage = !message ? undefined
    : /\b(?:token rate limit|tokens? per minute|TPM|token quota)\b/iu.test(message) ? messages.tokens
    : /\b(?:request rate limit|requests? per minute|RPM|request quota)\b/iu.test(message) ? messages.requests
    : /\bcapacity\b/iu.test(message) ? messages.capacity
    : /\bbackend error\b/iu.test(message) ? messages.backend
    : messages.other;
  return { ...(providerMessage ? { providerMessage } : {}), ...(waits.length ? { retryAfterMs: Math.max(...waits) } : {}) };
}
