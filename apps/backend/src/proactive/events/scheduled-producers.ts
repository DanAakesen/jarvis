import type { UsageStore } from '../../core/usage.js';
import { dayKey } from '../time.js';
import type { ProactiveSource } from '../types.js';
import type { ProactiveSettings } from '../types.js';
import type { EventQueueStore } from './event-queue.js';
import { factEvent } from './producers.js';
import type { ProactiveEventSink } from './types.js';

const SIX_HOURS_MS = 6 * 60 * 60_000;
const FIFTEEN_MINUTES_MS = 15 * 60_000;
const SOURCE_TIMEOUT_MS = 20_000;
const MAX_SEEN = 2_000;
const SPIKE_MIN_DKK = 15;
const SPIKE_FACTOR = 3;

export interface ProducerLogger {
  warn?: (data: Record<string, string>, message: string) => void;
}

/** Today's spend against the average of the previous seven days; a spike needs both a floor and a multiple. */
export function detectCostSpike(
  entries: readonly { costDkk: number | null; at: string }[],
  now: Date,
): { todayDkk: number; usualDkk: number } | undefined {
  const today = dayKey(now);
  const perDay = new Map<string, number>();
  for (const { costDkk, at } of entries) {
    if (costDkk === null || !Number.isFinite(costDkk) || costDkk < 0) continue;
    const day = dayKey(new Date(at));
    perDay.set(day, (perDay.get(day) ?? 0) + costDkk);
  }
  const todayDkk = perDay.get(today) ?? 0;
  let previous = 0;
  for (let ago = 1; ago <= 7; ago += 1) previous += perDay.get(dayKey(new Date(now.getTime() - ago * 86_400_000))) ?? 0;
  const usualDkk = previous / 7;
  return todayDkk >= SPIKE_MIN_DKK && todayDkk >= SPIKE_FACTOR * Math.max(usualDkk, 1)
    ? { todayDkk, usualDkk } : undefined;
}

/** A review every six hours, aligned to the clock so restarts and replicas share one dedupe key per slot. */
export function createTimerProducer(options: {
  sink: ProactiveEventSink;
  usageStore?: Pick<UsageStore, 'list'>;
  now: () => Date;
  intervalMs?: number;
  logger?: ProducerLogger;
  allowed?: () => Promise<boolean>;
}) {
  const interval = options.intervalMs ?? SIX_HOURS_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  async function fire(slot: Date) {
    const now = options.now();
    try {
      if (options.allowed && !await options.allowed()) return;
      await options.sink.enqueue({
        source: 'timer', kind: 'review', dedupeKey: `timer:review:${slot.toISOString()}`,
        summary: 'Periodic review: notice anything that has stalled, slipped or needs preparation.',
        occurredAt: slot,
      });
      const report = await options.usageStore?.list(new Date(now.getTime() - 8 * 86_400_000), now);
      const spike = report ? detectCostSpike(report.entries, now) : undefined;
      if (spike) {
        await options.sink.enqueue({
          source: 'cost', kind: 'spike.daily', dedupeKey: `cost:spike:${dayKey(now)}`,
          summary: `Spend today is ${spike.todayDkk.toFixed(0)} DKK against about ${spike.usualDkk.toFixed(0)} DKK a day over the last week.`,
          detail: { todayDkk: Math.round(spike.todayDkk), usualDkk: Math.round(spike.usualDkk) },
          occurredAt: now,
        });
      }
    } catch {
      options.logger?.warn?.({ reason: 'timer_event_failed' }, 'proactive.event_producer');
    }
  }

  function schedule() {
    if (stopped) return;
    const now = options.now().getTime();
    const next = new Date((Math.floor(now / interval) + 1) * interval);
    timer = setTimeout(() => {
      timer = undefined;
      void fire(next).finally(schedule);
    }, next.getTime() - now);
    timer.unref();
  }

  return {
    start() { schedule(); },
    stop() { stopped = true; if (timer) clearTimeout(timer); },
    fire,
  };
}

/**
 * Mail and calendar have no change notification this backend can receive (Gmail push needs Google Pub/Sub,
 * a new cloud service), so the existing read-only sources are polled. Each fact keeps one dedupe key; the
 * queue's unique key is the memory of what was already seen. The first poll of a source is a baseline.
 */
export function createSourceChangePoller(options: {
  sources: readonly ProactiveSource[];
  sink: ProactiveEventSink;
  queue: Pick<EventQueueStore, 'hasSource'>;
  now: () => Date;
  intervalMs?: number;
  firstPollDelayMs?: number;
  logger?: ProducerLogger;
  settings: () => Promise<ProactiveSettings>;
  allowed?: () => Promise<boolean>;
}) {
  const seen = new Set<string>();
  const baselined = new Set<string>();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let polling: Promise<void> | undefined;
  let stopped = false;

  async function pollSource(source: ProactiveSource & { id: 'mail' | 'calendar' }, settings: ProactiveSettings) {
    const timeout = AbortSignal.any([controller.signal, AbortSignal.timeout(SOURCE_TIMEOUT_MS)]);
    const now = options.now();
    // Mail and calendar read nothing from the settings; the queue's rules apply the owner's switches later.
    const result = await source.read({ now, signal: timeout, settings });
    if (result.state !== 'ok') return;
    if (!baselined.has(source.id)) {
      baselined.add(source.id);
      // A source with earlier events is not new: only a source never seen before is baselined.
      const baseline = !await options.queue.hasSource(source.id);
      for (const fact of result.facts) {
        const event = factEvent(source.id, fact, now);
        seen.add(event.dedupeKey);
        await options.sink.enqueue({ ...event, baseline });
      }
      return;
    }
    for (const fact of result.facts) {
      const event = factEvent(source.id, fact, now);
      if (seen.has(event.dedupeKey)) continue;
      await options.sink.enqueue(event);
      seen.add(event.dedupeKey);
      if (seen.size > MAX_SEEN) seen.delete(seen.values().next().value as string);
    }
  }

  async function poll() {
    if (options.allowed && !await options.allowed()) return;
    const settings = await options.settings();
    for (const source of options.sources) {
      if (stopped) return;
      if (source.id !== 'mail' && source.id !== 'calendar') continue;
      if (!settings.paused && !settings.sources[source.id]) continue;
      if (settings.paused) continue;
      try { await pollSource(source as ProactiveSource & { id: 'mail' | 'calendar' }, settings); }
      catch { options.logger?.warn?.({ reason: 'source_poll_failed', source: source.id }, 'proactive.event_producer'); }
    }
  }

  function schedule(delay: number) {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      polling = poll().finally(() => { polling = undefined; schedule(options.intervalMs ?? FIFTEEN_MINUTES_MS); });
    }, delay);
    timer.unref();
  }

  return {
    start() { schedule(options.firstPollDelayMs ?? 30_000); },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller.abort();
      await polling;
    },
    poll,
  };
}
