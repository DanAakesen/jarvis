export const sourceIds = ['todos', 'calendar', 'mail', 'weather', 'factory', 'news', 'travel', 'x', 'health', 'nutrition', 'notes', 'memory', 'location'] as const;
export type SourceId = typeof sourceIds[number];
export const findingCategories = [
  'deadline', 'clash', 'travel', 'todo', 'prep', 'news', 'weather', 'status', 'suggestion',
] as const;
export type FindingCategory = typeof findingCategories[number];
export type SuggestionScope = 'personal' | 'work' | 'unknown';
export type SuggestionScopePreference = 'all' | 'personal' | 'work';

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
  verifiedAt?: string | null;
  invalidatedAt?: string | null;
};

export type Item = {
  id: string;
  kind: 'finding' | 'test';
  title: string;
  body: string;
  category: 'deadline' | 'clash' | 'travel' | 'todo' | 'prep' | 'news' | 'weather' | 'status' | 'suggestion' | null;
  suggestionScope: SuggestionScope;
  ownerRequested?: boolean;
  relatedCategories?: FindingCategory[];
  urgency: 'time_critical' | 'normal' | 'fyi';
  dueAt: string | null;
  evidence: { source: SourceId; label: string; observedAt: string }[];
  state: 'new' | 'seen' | 'dismissed' | 'snoozed';
  snoozedUntil: string | null;
  feedback: 'useful' | 'wrong' | null;
  runId: string | null;
  todoAdded: boolean;
  createdAt: string;
};

export interface SourceFact {
  ref: string;
  identity?: string;
  taskScope?: 'personal' | 'work';
  projectRelated?: boolean;
  kind: 'todo' | 'event' | 'mail' | 'weather' | 'factory' | 'news' | 'travel' | 'health' | 'nutrition' | 'note' | 'memory' | 'commitment' | 'location';
  label: string;
  text: string;
  observedAt: string;
  dueAt?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  allDay?: boolean;
  dueHasTime?: boolean;
  remindAtDue?: boolean;
  weatherDestination?: string;
  weatherEventRef?: string;
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
  backgroundTurnsPerDay: number;
  sources: Record<SourceId, boolean>;
  categories: Record<FindingCategory, boolean>;
  suggestionScope: SuggestionScopePreference;
  newsFeeds: string[];
  guidance: string;
  brainInstructions?: string;
}

export interface SourceContext {
  calendarFacts?: readonly SourceFact[];
  now: Date;
  signal: AbortSignal;
  settings: ProactiveSettings;
}

export interface ProactiveSource {
  id: SourceId;
  label: string;
  read(context: SourceContext): Promise<SourceResult>;
}

/** Evidence shared by Inbox review and alert delivery for a claimed PI review slot. */
export interface FindingsStoredContext {
  runId: string;
  trigger: RunSummary['trigger'];
  now: Date;
  signal: AbortSignal;
  findings: {
    modelGenerated?: boolean;
    itemId: string;
    dedupeKey: string;
    evidenceRefs: string[];
    category: NonNullable<Item['category']>;
    suggestionScope: Item['suggestionScope'];
    relatedCategories?: Item['relatedCategories'];
    urgency: Item['urgency'];
    dueAt: string | null;
    dueHasTime: boolean;
    highPriority: boolean;
    suggestedTodo?: string;
  }[];
  facts: Pick<SourceFact & { source: SourceId },
    'ref' | 'identity' | 'taskScope' | 'projectRelated' | 'source' | 'kind' | 'text' |
    'dueAt' | 'dueHasTime' | 'remindAtDue' | 'highPriority' | 'startsAt' | 'endsAt' | 'allDay'>[];
  sources: { id: SourceId; state: 'ok' | 'unavailable'; reason?: string }[];
}
