import { randomUUID } from 'node:crypto';
import { copenhagenDayStart } from './time.js';
import { sourceIds, type Item, type ProactiveSettings, type RunSummary, type SourceId, type SourceStatus } from './types.js';

export const DEFAULT_NEWS_FEEDS = [
  'https://github.blog/changelog/feed/',
  'https://openai.com/news/rss.xml',
] as const;

export const sourceLabels: Record<SourceId, string> = {
  todos: 'Todo list',
  calendar: 'Calendar',
  mail: 'Mail',
  weather: 'Weather',
  factory: 'Factory',
  news: 'News',
  travel: 'Travel',
  x: 'X',
};

export function defaultProactiveSettings(): ProactiveSettings {
  return {
    paused: false,
    monthlyBudgetDkk: 100,
    sources: {
      todos: true,
      calendar: true,
      mail: true,
      weather: true,
      factory: true,
      news: true,
      travel: true,
      x: false,
    },
    newsFeeds: [...DEFAULT_NEWS_FEEDS],
    guidance: '',
  };
}

export type ProactiveSettingsPatch = Partial<Pick<ProactiveSettings, 'paused' | 'monthlyBudgetDkk' | 'newsFeeds' | 'guidance'>> & {
  sources?: Partial<Record<SourceId, boolean>>;
};
export type FeedbackAction = 'seen' | 'dismiss' | 'snooze' | 'useful' | 'wrong';
export interface FindingInput {
  dedupeKey: string;
  title: string;
  body: string;
  category: NonNullable<Item['category']>;
  urgency: Item['urgency'];
  dueAt: string | null;
  evidence: Item['evidence'];
  runId: string | null;
  language: 'da' | 'en';
  eventStartAt?: string | null;
  eventEndAt?: string | null;
}

export interface FindingWriteGuard {
  runId: string;
  generation: number;
  signal: AbortSignal;
  check: () => void;
  now: () => Date;
}

export interface ProactiveSettingsStore {
  read(): Promise<ProactiveSettings>;
  patch(patch: ProactiveSettingsPatch): Promise<ProactiveSettings>;
}
export interface ProactiveItemsStore {
  list(state: 'open' | 'all', limit: number, now: Date): Promise<Item[]>;
  get(id: string, markLoaded?: boolean): Promise<Item | undefined>;
  applyFeedback(id: string, action: FeedbackAction, snoozeUntil?: string): Promise<Item | undefined>;
  upsertFinding(input: FindingInput, guard?: FindingWriteGuard): Promise<Item>;
}
export interface ProactiveRunsStore {
  claim(input: { trigger: RunSummary['trigger']; slot: string | null; now: Date }): Promise<{ run: RunSummary; generation: number } | null>;
  heartbeat(id: string, generation: number, now: Date): Promise<boolean>;
  finish(id: string, generation: number, status: Exclude<RunSummary['status'], 'running'>, reason: string | null, findingCount: number, finishedAt: Date): Promise<boolean>;
  latest(): Promise<RunSummary | null>;
  running(now: Date): Promise<RunSummary | null>;
  list(limit: number): Promise<RunSummary[]>;
  countManualSince(since: Date): Promise<number>;
  markInterruptedOnStartup(): Promise<number>;
}
export interface ProactiveSourceStatusStore {
  list(): Promise<SourceStatus[]>;
  upsert(status: SourceStatus): Promise<void>;
}
export interface ProactiveSpendStore {
  record(input: { runId: string; month: string; inputTokens: number; outputTokens: number; estimatedDkk: number; createdAt: Date }): Promise<void>;
  monthTotal(month: string): Promise<number>;
}
export interface ProactiveStore {
  settings: ProactiveSettingsStore;
  items: ProactiveItemsStore;
  runs: ProactiveRunsStore;
  sources: ProactiveSourceStatusStore;
  spend: ProactiveSpendStore;
}

function copyItem(item: Item): Item {
  return { ...item, evidence: item.evidence.map((fact) => ({ ...fact })) };
}

function runSummary(run: RunSummary & { generation: number; leaseUntil: number }): RunSummary {
  return {
    id: run.id,
    trigger: run.trigger,
    slot: run.slot,
    status: run.status,
    reason: run.reason,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    findingCount: run.findingCount,
  };
}

export function createMemoryProactiveStore(ownerObjectId: string = randomUUID()): ProactiveStore {
  void ownerObjectId;
  let settings = defaultProactiveSettings();
  const items = new Map<string, Item>();
  const findings = new Map<string, string>();
  const materials = new Map<string, string>();
  const runs: (RunSummary & { generation: number; leaseUntil: number })[] = [];
  const sources = new Map<SourceId, SourceStatus>();
  const spend: { month: string; estimatedDkk: number }[] = [];

  return {
    settings: {
      async read() {
        return { ...settings, sources: { ...settings.sources }, newsFeeds: [...settings.newsFeeds] };
      },
      async patch(patch) {
        settings = {
          ...settings,
          ...patch,
          sources: { ...settings.sources, ...patch.sources },
          newsFeeds: patch.newsFeeds === undefined ? [...settings.newsFeeds] : [...patch.newsFeeds],
        };
        return { ...settings, sources: { ...settings.sources }, newsFeeds: [...settings.newsFeeds] };
      },
    },
    items: {
      async list(state, limit, now) {
        const visible = [...items.values()].filter((item) => state === 'all' ||
          item.state === 'new' || item.state === 'seen' ||
          (item.state === 'snoozed' && item.snoozedUntil !== null && Date.parse(item.snoozedUntil) <= now.getTime()));
        return visible.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(copyItem);
      },
      async get(id) {
        const item = items.get(id.toLowerCase());
        return item ? copyItem(item) : undefined;
      },
      async applyFeedback(id, action, snoozeUntil) {
        const key = id.toLowerCase();
        const item = items.get(key);
        if (!item) return undefined;
        const state = action === 'dismiss' ? 'dismissed'
          : action === 'seen' && item.state === 'new' ? 'seen'
            : action === 'snooze' ? 'snoozed' : item.state;
        const feedback = action === 'useful' || action === 'wrong' ? action : item.feedback;
        const updated = {
          ...item,
          state,
          snoozedUntil: action === 'snooze' ? snoozeUntil! : item.snoozedUntil,
          feedback,
        };
        items.set(key, updated);
        return copyItem(updated);
      },
      async upsertFinding(input, guard) {
        if (input.dedupeKey.length > 64) throw new RangeError('Dedupe key exceeds 64 characters');
        const existingId = findings.get(input.dedupeKey);
        const existing = existingId ? items.get(existingId) : undefined;
        const material = JSON.stringify([input.dueAt, input.eventStartAt ?? null, input.eventEndAt ?? null]);
        const changed = existing !== undefined && (materials.get(existing.id) !== material ||
          (input.urgency === 'time_critical' && existing.urgency !== 'time_critical'));
        const item: Item = {
          id: existing?.id ?? randomUUID(),
          kind: 'finding',
          title: input.title,
          body: input.body,
          category: input.category,
          urgency: input.urgency,
          dueAt: input.dueAt,
          evidence: input.evidence.map((fact) => ({ ...fact })),
          state: existing ? (existing.state === 'dismissed' && changed ? 'new' : existing.state) : 'new',
          snoozedUntil: existing?.snoozedUntil ?? null,
          feedback: existing?.feedback ?? null,
          runId: input.runId,
          todoAdded: existing?.todoAdded ?? false,
          language: input.language,
          createdAt: existing?.createdAt ?? new Date().toISOString(),
        };
        if (guard) {
          guard.check();
          guard.signal.throwIfAborted();
          const run = runs.find((entry) => entry.id === guard.runId);
          if (input.runId !== guard.runId || !run || run.status !== 'running' ||
              run.generation !== guard.generation || run.leaseUntil <= guard.now().getTime()) {
            throw new Error('lease_lost');
          }
        }
        items.set(item.id, item);
        findings.set(input.dedupeKey, item.id);
        materials.set(item.id, material);
        return copyItem(item);
      },
    },
    runs: {
      async claim({ trigger, slot, now }) {
        for (const run of runs) {
          if (run.status === 'running' && run.leaseUntil <= now.getTime()) {
            Object.assign(run, {
              status: 'failed',
              reason: 'lease_lost',
              finishedAt: now.toISOString(),
              generation: run.generation + 1,
            });
          }
        }
        const active = runs.some((run) => run.status === 'running' && run.leaseUntil > now.getTime());
        if (active || (slot !== null && runs.some((run) => run.slot === slot))) return null;
        if (trigger === 'manual') {
          const manual = runs.filter((run) => run.trigger === 'manual');
          if (manual.some((run) => Date.parse(run.startedAt) > now.getTime() - 5 * 60_000) ||
              manual.filter((run) => Date.parse(run.startedAt) >= copenhagenDayStart(now).getTime()).length >= 6) return null;
        }
        const run: RunSummary & { generation: number; leaseUntil: number } = {
          id: randomUUID(),
          trigger,
          slot,
          status: 'running',
          reason: null,
          startedAt: now.toISOString(),
          finishedAt: null,
          findingCount: 0,
          generation: 1,
          leaseUntil: now.getTime() + 10 * 60_000,
        };
        runs.push(run);
        return { run: runSummary(run), generation: run.generation };
      },
      async heartbeat(id, generation, now) {
        const run = runs.find((entry) => entry.id === id && entry.status === 'running' && entry.generation === generation);
        if (!run) return false;
        run.leaseUntil = now.getTime() + 10 * 60_000;
        return true;
      },
      async finish(id, generation, status, reason, findingCount, finishedAt) {
        const run = runs.find((entry) => entry.id === id && entry.status === 'running' && entry.generation === generation);
        if (!run) return false;
        Object.assign(run, { status, reason, findingCount, finishedAt: finishedAt.toISOString() });
        return true;
      },
      async latest() {
        const run = [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
        return run ? runSummary(run) : null;
      },
      async running(now) {
        const run = runs.find((entry) => entry.status === 'running' && entry.leaseUntil > now.getTime());
        return run ? runSummary(run) : null;
      },
      async list(limit) {
        return [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit).map(runSummary);
      },
      async countManualSince(since) {
        return runs.filter((run) => run.trigger === 'manual' && Date.parse(run.startedAt) >= since.getTime()).length;
      },
      async markInterruptedOnStartup(now = new Date()) {
        let changed = 0;
        for (const run of runs) {
          if (run.status !== 'running') continue;
          Object.assign(run, {
            status: 'failed', reason: 'interrupted_by_restart', finishedAt: now.toISOString(),
            generation: run.generation + 1,
          });
          changed++;
        }
        return changed;
      },
    },
    sources: {
      async list() { return sourceIds.flatMap((id) => sources.has(id) ? [sources.get(id)!] : []); },
      async upsert(status) { sources.set(status.id, { ...status }); },
    },
    spend: {
      async record(input) { spend.push({ month: input.month, estimatedDkk: input.estimatedDkk }); },
      async monthTotal(month) { return spend.filter((entry) => entry.month === month).reduce((total, entry) => total + entry.estimatedDkk, 0); },
    },
  };
}
