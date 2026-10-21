export const sourceIds = ['todos', 'calendar', 'mail', 'weather', 'factory', 'news', 'travel', 'x'] as const;
export type SourceId = typeof sourceIds[number];

export type RunSummary = {
  id: string;
  trigger: 'scheduled' | 'catchup' | 'manual';
  slot: string | null;
  status: 'running' | 'done' | 'failed' | 'skipped' | 'cancelled';
  reason: string | null;
  startedAt: string;
  finishedAt: string | null;
  findingCount: number;
};

export type SourceStatus = {
  id: SourceId;
  label: string;
  enabled: boolean;
  state: 'ok' | 'unavailable' | 'stale' | 'disabled' | 'not_run';
  reason: string | null;
  observedAt: string | null;
};

export type Item = {
  id: string;
  kind: 'finding' | 'test';
  title: string;
  body: string;
  category: 'deadline' | 'clash' | 'travel' | 'todo' | 'prep' | 'news' | 'weather' | 'status' | 'suggestion' | null;
  urgency: 'time_critical' | 'normal' | 'fyi';
  dueAt: string | null;
  evidence: { source: SourceId; label: string; observedAt: string }[];
  state: 'new' | 'seen' | 'dismissed' | 'snoozed';
  snoozedUntil: string | null;
  feedback: 'useful' | 'wrong' | null;
  runId: string | null;
  todoAdded: boolean;
  language: 'da' | 'en' | null;
  createdAt: string;
};

export interface SourceFact {
  ref: string;
  identity?: string;
  taskScope?: 'personal' | 'work';
  projectRelated?: boolean;
  kind: 'todo' | 'event' | 'mail' | 'weather' | 'factory' | 'news' | 'travel';
  label: string;
  text: string;
  observedAt: string;
  dueAt?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  allDay?: boolean;
  dueHasTime?: boolean;
  highPriority?: boolean;
}

export interface SourceResult {
  source: SourceId;
  state: 'ok' | 'unavailable';
  reason: string | null;
  facts: SourceFact[];
  observedAt: string;
}

export interface ProactiveSettings {
  paused: boolean;
  monthlyBudgetDkk: number;
  sources: Record<SourceId, boolean>;
  newsFeeds: string[];
  guidance: string;
}

export interface SourceContext {
  now: Date;
  signal: AbortSignal;
  settings: ProactiveSettings;
}

export interface ProactiveSource {
  id: SourceId;
  label: string;
  read(context: SourceContext): Promise<SourceResult>;
}
