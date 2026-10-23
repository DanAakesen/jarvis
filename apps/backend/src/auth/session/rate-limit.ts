export interface RateWindow {
  readonly windowMs: number;
  readonly max: number;
}

export type RateDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

/** In-process sliding-window limiter. Each backend replica counts on its own. */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly windows: readonly RateWindow[], private readonly now: () => Date) {}

  consume(key: string): RateDecision {
    const nowMs = this.now().getTime();
    const horizon = Math.max(...this.windows.map((window) => window.windowMs));
    const recent = (this.hits.get(key) ?? []).filter((at) => nowMs - at < horizon);
    let limited = false;
    let waitMs = 0;
    for (const { windowMs, max } of this.windows) {
      const inWindow = recent.filter((at) => nowMs - at < windowMs);
      if (inWindow.length < max) continue;
      // The request fits again once the hit that is max places from the newest has left the window.
      limited = true;
      waitMs = Math.max(waitMs, (inWindow[inWindow.length - max] ?? nowMs) + windowMs - nowMs);
    }
    if (limited) {
      this.hits.set(key, recent);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
    }
    recent.push(nowMs);
    this.hits.set(key, recent);
    return { allowed: true };
  }
}
