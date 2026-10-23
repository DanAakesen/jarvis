import type { LookupAdmissionPolicy } from './config.js';
import { SlidingWindowRateLimiter } from './rate-limit.js';

export type LookupAdmission =
  | { readonly admitted: true; readonly release: () => void }
  | { readonly admitted: false; readonly retryAfterSeconds: number };

const budgetKey = 'unverified-session-lookups';

/**
 * Decides, before the session store is read, whether a lookup may run. Its state is per process, so each
 * replica counts on its own. It is not keyed on the client address: the backend sets no trusted proxy, so the
 * address is the ingress and a forwarded header is chosen by the caller.
 *
 * An id this replica verified successfully a short while ago is recently verified. Such an id skips the budget
 * and the unverified cap, so the owner's own traffic never throttles itself, but the store is still read and
 * the secret still compared on every request. Nothing here caches a verdict, so a revocation applies from the
 * next request. Only a successful verification adds an id, so a caller cannot get an id into the set without a
 * valid secret. Every other lookup spends the budget, and only a few of them run at once.
 *
 * The caller releases the slot when the lookup ends and reports the outcome with `verified` or `forget`.
 */
export class SessionLookupAdmission {
  private readonly budget: SlidingWindowRateLimiter;
  // Session id to the time its exemption ends. Iteration order runs from least to most recently verified.
  private readonly recentlyVerified = new Map<string, number>();
  private inFlight = 0;
  private unverifiedInFlight = 0;

  constructor(private readonly policy: LookupAdmissionPolicy, private readonly now: () => Date) {
    this.budget = new SlidingWindowRateLimiter([policy.unverifiedBudget], now);
  }

  admit(sessionId: string): LookupAdmission {
    const capped = { admitted: false, retryAfterSeconds: this.policy.throttledRetryAfterSeconds } as const;
    if (this.inFlight >= this.policy.maxConcurrent) return capped;
    const known = this.isRecentlyVerified(sessionId);
    if (!known) {
      if (this.unverifiedInFlight >= this.policy.maxConcurrentUnverified) return capped;
      // Spent last and only for an admitted lookup, so a request a cap refuses never uses up budget.
      const decision = this.budget.consume(budgetKey);
      if (!decision.allowed) return { admitted: false, retryAfterSeconds: decision.retryAfterSeconds };
      this.unverifiedInFlight += 1;
    }
    this.inFlight += 1;
    let released = false;
    return {
      admitted: true,
      release: () => {
        if (released) return;
        released = true;
        this.inFlight -= 1;
        if (!known) this.unverifiedInFlight -= 1;
      },
    };
  }

  /** The lookup verified the session: keep its id exempt for another period. */
  verified(sessionId: string): void {
    const nowMs = this.now().getTime();
    for (const [id, expiresAt] of this.recentlyVerified) {
      if (expiresAt <= nowMs) this.recentlyVerified.delete(id);
    }
    this.recentlyVerified.delete(sessionId);
    this.recentlyVerified.set(sessionId, nowMs + this.policy.recentlyVerifiedTtlMs);
    for (const id of this.recentlyVerified.keys()) {
      if (this.recentlyVerified.size <= this.policy.recentlyVerifiedCapacity) break;
      this.recentlyVerified.delete(id);
    }
  }

  /** The lookup refused the id (revoked, expired, wrong secret, another owner, unknown): it falls back to the budget at once. */
  forget(sessionId: string): void {
    this.recentlyVerified.delete(sessionId);
  }

  private isRecentlyVerified(sessionId: string): boolean {
    const expiresAt = this.recentlyVerified.get(sessionId);
    return expiresAt !== undefined && expiresAt > this.now().getTime();
  }
}
