import { createHash } from 'node:crypto';
import type { UsageStore } from '../../core/usage.js';
import { dayKey } from '../time.js';
import type { ProactiveSource, SourceId, SourceResult } from '../types.js';
import type { ProactiveSettings } from '../types.js';
import type { EventQueueStore } from './event-queue.js';
import { clashEvents, factEvent } from './producers.js';
import { contextOnlyReason, type ProactiveEventSink } from './types.js';

const SIX_HOURS_MS = 6 * 60 * 60_000;
const FIFTEEN_MINUTES_MS = 15 * 60_000;
const SOURCE_TIMEOUT_MS = 20_000;
const MAX_SEEN = 2_000;
const SPIKE_MIN_DKK = 15;
const SPIKE_FACTOR = 3;
const observationEventSources = new Set<SourceId>([
  'news', 'travel', 'memory', 'location',
]);

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
 * A calendar poll also queues one `calendar.clash` event per pair of overlapping entries.
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
  observe?: (source: SourceId, result: SourceResult, signal: AbortSignal) => Promise<{
    readonly changed: boolean;
    readonly baseline: boolean;
    readonly admissible: boolean;
  }>;
}) {
  const seen = new Set<string>();
  const baselined = new Set<string>();
  const disabled = new Set<string>();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let polling: Promise<void> | undefined;
  let stopped = false;

  async function pollSource(source: ProactiveSource, settings: ProactiveSettings) {
    const timeout = AbortSignal.any([controller.signal, AbortSignal.timeout(SOURCE_TIMEOUT_MS)]);
    const now = options.now();
    let result: SourceResult;
    try {
      result = await source.read({ now, signal: timeout, settings });
    } catch {
      if (controller.signal.aborted) throw new DOMException('Polling stopped', 'AbortError');
      result = {
        source: source.id,
        state: 'unavailable',
        reason: timeout.aborted ? 'timeout' : 'read_failed',
        facts: [],
        observedAt: now.toISOString(),
      };
      options.logger?.warn?.({ reason: result.reason ?? 'read_failed', source: source.id }, 'proactive.event_source');
    }
    const observation = options.observe
      ? await options.observe(source.id, result, timeout)
      : undefined;
    if (observation?.admissible === false) return;
    if (source.id === 'calendar' && result.state === 'ok' && settings.sources.weather && options.observe) {
      const weather = options.sources.find(entry => entry.id === 'weather');
      if (weather) {
        try {
          const forecast = await weather.read({ now, signal: timeout, settings, calendarFacts: result.facts });
          if (forecast.reason !== 'daily_forecast_reserved') await options.observe('weather', forecast, timeout);
        } catch {
          options.logger?.warn?.({ reason: 'source_poll_failed', source: 'weather' }, 'proactive.event_producer');
        }
      }
    }
    if (source.id !== 'mail' && source.id !== 'calendar') {
      if (contextOnlyReason({ source: source.id, kind: 'observation.changed' })) return;
      if (observation?.changed && !observation.baseline &&
          (result.state !== 'ok' || observationEventSources.has(source.id))) {
        const material = {
          state: result.state,
          reason: result.reason,
          facts: result.facts.slice(0, 16).map((fact) => [
            createHash('sha256').update(fact.identity ?? fact.ref).digest('hex').slice(0, 32),
            createHash('sha256').update(JSON.stringify([
              fact.text, fact.startsAt ?? null, fact.endsAt ?? null, fact.dueAt ?? null,
            ])).digest('hex').slice(0, 32),
            fact.startsAt ?? null,
            fact.endsAt ?? null,
            fact.dueAt ?? null,
          ]),
        };
        const fingerprint = createHash('sha256').update(JSON.stringify(material)).digest('hex').slice(0, 40);
        await options.sink.enqueue({
          source: source.id,
          kind: result.state === 'ok' ? 'observation.changed' : 'observation.unavailable',
          identity: `source-observation:${source.id}`,
          material,
          dedupeKey: `${source.id}:observation:${fingerprint}`,
          summary: result.state === 'ok'
            ? `${source.label} has a material change to review.`
            : `${source.label} could not be refreshed${result.reason ? `: ${result.reason}` : ''}.`,
          detail: { sourceState: result.state, reason: result.reason, refCount: result.facts.length },
          occurredAt: now,
        });
      }
      return;
    }
    if (result.state !== 'ok') return;
    const id = source.id;
    const events = [
      ...result.facts.map((fact) => factEvent(id, fact, now)),
      // Overlapping calendar entries are found in the facts just read; there is no second read.
      ...(id === 'calendar' ? clashEvents(result.facts, now) : []),
    ];
    if (!baselined.has(source.id)) {
      baselined.add(source.id);
      // A source with earlier events is not new: only a source never seen before is baselined.
      const baseline = !await options.queue.hasSource(source.id);
      for (const event of events) {
        seen.add(event.dedupeKey);
        await options.sink.enqueue({ ...event, baseline });
      }
      return;
    }
    for (const event of events) {
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
      if (!settings.sources[source.id]) {
        disabled.add(source.id);
      } else if (disabled.delete(source.id)) {
        for (const key of seen) {
          if (key.startsWith(`${source.id}:`)) seen.delete(key);
        }
      }
    }
    const enabled = options.sources.filter((source) =>
      source.id !== 'weather' && !settings.paused && settings.sources[source.id] &&
      (source.id === 'mail' || source.id === 'calendar' || options.observe !== undefined));
    for (let offset = 0; offset < enabled.length && !stopped; offset += 3) {
      await Promise.all(enabled.slice(offset, offset + 3).map(async (source) => {
        if (stopped) return;
        try { await pollSource(source, settings); }
        catch { options.logger?.warn?.({ reason: 'source_poll_failed', source: source.id }, 'proactive.event_producer'); }
      }));
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
