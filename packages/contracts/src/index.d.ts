import type { ZodType } from 'zod';

export interface VaultMirrorStatus {
  runId: string;
  startedAt: string;
  finishedAt: string;
  outcome: 'ok' | 'ok-noop' | 'skipped-busy' | 'needs-attention' | 'failed';
  reason?: 'auth' | 'policy-missing' | 'repo-not-private' | 'pull-failed' | 'guard-tripped'
    | 'conflict' | 'secret-match' | 'push-rejected' | 'upload-failed' | 'state-corrupt'
    | 'timeout' | 'unexpected';
  writeBack: 'dry-run' | 'on';
  approved: number;
  pushed: number;
  writtenBack: number;
  deleted: number;
  conflicts: number;
  skipped: number;
  credentialMatches: number;
  pendingWriteBack: number;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  conflictPaths: string[];
}
export const vaultMirrorStatusSchema: ZodType<VaultMirrorStatus>;

/** Reserved IDs only; native Daily renderers are implemented in P12-16. */
export const dailyViewIds: Readonly<{
  status: 'daily-status'; recomp: 'daily-recomp'; review: 'daily-review'; ready: 'daily-ready';
}>;
export type DailyViewKind = keyof typeof dailyViewIds;
export type DailyViewId = typeof dailyViewIds[DailyViewKind];
export const dailyModuleId: 'daily';
export const dailyContractVersion: 1;
export const dailyQuerySources: Readonly<{
  metrics: 'daily.health.metrics'; sleep: 'daily.health.sleep'; workouts: 'daily.health.workouts';
  workout: 'daily.health.workout'; heartRate: 'daily.health.heart-rate';
  meals: 'daily.nutrition.meals'; favorites: 'daily.nutrition.favorites';
  plans: 'daily.nutrition.plans'; sync: 'daily.sync';
  briefs: 'daily.briefs.history'; brief: 'daily.briefs.detail';
  metricCatalog: 'daily.health.metric-catalog'; days: 'daily.nutrition.days';
}>;
export type DailySourceId = typeof dailyQuerySources[keyof typeof dailyQuerySources];
export const dailyQuerySourcesV1: readonly Exclude<DailySourceId, 'daily.briefs.history' | 'daily.briefs.detail' | 'daily.health.metric-catalog' | 'daily.nutrition.days'>[];
export const dailyQuerySourcesV2: readonly Exclude<DailySourceId, 'daily.health.metric-catalog' | 'daily.nutrition.days'>[];
export const dailyQuerySourcesV3: readonly DailySourceId[];
export const dailyCapabilitiesVersion: 3;
export const dailyCapabilitiesAccept: 'application/json;version=3, application/json;version=2, application/json';
export type DailyCursor = { date: string; key: string } | { key: string } | { date: string } | { minute: string; metric: string } | { createdAt: string; id: string } | { id: string } | { startedAt: string; id: string };
export type DailyQuery =
  | { source: 'daily.health.metrics'; startDate: string; endDate: string; metric?: string; limit?: number; cursor?: { date: string; key: string } }
  | { source: 'daily.health.metric-catalog'; startDate: string; endDate: string; limit?: number; cursor?: { key: string } }
  | { source: 'daily.health.sleep' | 'daily.health.workouts'; startDate: string; endDate: string; limit?: number; cursor?: { date: string; key: string } }
  | { source: 'daily.health.heart-rate'; workoutId: string; limit?: number; cursor?: { minute: string; metric: string } }
  | { source: 'daily.health.workout'; workoutId: string }
  | { source: 'daily.nutrition.meals'; startDate: string; endDate: string; limit?: number; cursor?: { createdAt: string; id: string } }
  | { source: 'daily.nutrition.days'; startDate: string; endDate: string; limit?: number; cursor?: { date: string } }
  // Separate discriminants preserve narrowing after collection sources are excluded.
  | { source: 'daily.nutrition.favorites'; limit?: number; cursor?: { id: string } }
  | { source: 'daily.nutrition.plans'; limit?: number; cursor?: { id: string } }
  | { source: 'daily.briefs.history'; limit?: number; cursor?: { startedAt: string; id: string } }
  | { source: 'daily.briefs.detail'; briefId: string }
  | { source: 'daily.sync' };
export type DailyJson = null | boolean | number | string | DailyJson[] | { [key: string]: DailyJson };
export interface DailyQueryResult {
  source: DailySourceId;
  period: { startDate: string; endDate: string; timeZone: 'Europe/Copenhagen' } | null;
  items: Record<string, DailyJson>[];
  status: 'available' | 'empty' | 'partial';
  units: Readonly<Record<string, string>>;
  provenance: {
    store: 'daily-sql'; detail: 'retained-record'; calculations: 'existing-read-model' | 'derived-from-retained-meals';
    consistency: 'independent-committed-reads';
  };
  freshness: {
    observedAt: string; sourceProcessedCommittedAt: string | null;
    latestReturnedRecordUpdatedAt: string | null; staleness: 'unknown';
  };
  coverage: { returned: number; hasMore: boolean; next: DailyCursor | null; sourceCompleteness: 'unknown' };
  /** Content fingerprint of this exact committed-read result, not a global ordering/replay token. */
  revision: string;
}
export const dailyQuerySchema: Readonly<Record<string, unknown>>;
export function isDailyQuery(value: unknown): value is DailyQuery;

export const generatedViewVersion: 1;
export const presenceModes: readonly ['present', 'away', 'on_the_move'];
export type PresenceMode = typeof presenceModes[number];
export const presenceSources: readonly ['manual', 'device', 'jarvis', 'browser'];
export type PresenceSource = typeof presenceSources[number];
export type PresenceUpdateSource = 'manual' | 'device';
export interface PresenceUpdate {
  mode: PresenceMode;
  source?: PresenceUpdateSource;
}
export interface PresenceState {
  mode: PresenceMode;
  source: PresenceSource;
  changedAt: string | null;
  ignored?: 'recent_manual';
}
export const presenceUpdateSchema: Readonly<Record<string, unknown>>;
export const presenceStateSchema: Readonly<Record<string, unknown>>;
export function isPresenceState(value: unknown): value is PresenceState;
export const modelRoles: readonly ['chat', 'vision', 'research', 'voice', 'transcription', 'embedding', 'codex', 'copilot'];
export type ModelRole = typeof modelRoles[number];
export const reasoningEfforts: readonly ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
export type ReasoningEffort = typeof reasoningEfforts[number];
export const modelCapabilities: readonly ['chat', 'responses', 'realtime', 'transcription', 'embeddings', 'image'];
export type ModelCapability = typeof modelCapabilities[number];
export const clipboardTextMaxBytes: 20480;
export interface ClipboardReadResult {
  text: string;
}
export interface ClipboardWriteResult {
  written: true;
}
export function isClipboardText(value: unknown): value is string;
export function isClipboardReadResult(value: unknown): value is ClipboardReadResult;
export function isClipboardWriteResult(value: unknown): value is ClipboardWriteResult;
export interface VoiceTuningSettings {
  serverVadThreshold: number;
  prefixPaddingMs: number;
  silenceDurationMs: number;
  bargeInEnabled: boolean;
  maxSpokenReplyTokens: number;
}
export const voiceTuningSettingsBounds: Readonly<{
  serverVadThreshold: Readonly<{ minimum: 0; maximum: 1 }>;
  prefixPaddingMs: Readonly<{ minimum: 0; maximum: 2000 }>;
  silenceDurationMs: Readonly<{ minimum: 100; maximum: 5000 }>;
  maxSpokenReplyTokens: Readonly<{ minimum: 1; maximum: 4096 }>;
}>;
export const voiceTuningSettingsSchema: Readonly<{
  type: 'object';
  minProperties: 1;
  additionalProperties: false;
  properties: Readonly<Record<keyof VoiceTuningSettings, Readonly<Record<string, unknown>>>>;
}>;
export const researchDepths: readonly ['quick', 'standard', 'deep'];
export type ResearchDepth = typeof researchDepths[number];
export interface ResearchSettings {
  depth: ResearchDepth;
  maxSources: number;
  timeoutSeconds: number;
}
export interface MemorySettings {
  similarityThreshold: number;
  searchTopK: number;
  graphTextSimilarityThreshold: number;
  automaticCapture: boolean;
}
export const memorySettingsBounds: Readonly<{
  similarityThreshold: Readonly<{ minimum: 0; maximum: 1 }>;
  searchTopK: Readonly<{ minimum: 1; maximum: 8 }>;
  graphTextSimilarityThreshold: Readonly<{ minimum: 0; maximum: 1 }>;
}>;
export const memorySettingsSchema: Readonly<{
  type: 'object';
  minProperties: 1;
  additionalProperties: false;
  properties: Readonly<Record<keyof MemorySettings, Readonly<Record<string, unknown>>>>;
}>;
export interface HomeLocationSettings {
  city: string;
  latitude: number | null;
  longitude: number | null;
}
export const homeLocationSettingsSchema: Readonly<{
  type: 'object';
  minProperties: 1;
  additionalProperties: false;
  properties: Readonly<Record<keyof HomeLocationSettings, Readonly<Record<string, unknown>>>>;
}>;
export const researchSettingsBounds: Readonly<{
  maxSources: Readonly<{ minimum: 1; maximum: 50 }>;
  timeoutSeconds: Readonly<{ minimum: 1; maximum: 320 }>;
}>;
export const researchSettingsSchema: Readonly<{
  type: 'object';
  minProperties: 1;
  additionalProperties: false;
  properties: Readonly<Record<keyof ResearchSettings, Readonly<Record<string, unknown>>>>;
}>;
export interface TimeoutSettings {
  toolTimeoutSeconds: number;
  longToolTimeoutSeconds: number;
  backendHttpTimeoutSeconds: number;
}
export interface Routine {
  readonly id: string;
  readonly name?: string;
  readonly kind: 'pc' | 'browser';
  readonly key: string;
  readonly goal: string;
  readonly steps: readonly {
    readonly operation: 'click' | 'type' | 'type_focused' | 'keys' | 'select' | 'scroll_up' | 'scroll_down' | 'wait' | 'done';
    readonly target?: { readonly role: string; readonly name: string };
    readonly valueSlot?: number;
    readonly keys?: readonly string[];
  }[];
}
export const routineNameMaxLength: 80;
export const routineNameSchema: Readonly<Record<string, unknown>>;
export const routineUpdateSchema: Readonly<Record<string, unknown>>;
export const timeoutSettingsBounds: Readonly<{
  toolTimeoutSeconds: Readonly<{ minimum: 1; maximum: 120 }>;
  longToolTimeoutSeconds: Readonly<{ minimum: 30; maximum: 320 }>;
  backendHttpTimeoutSeconds: Readonly<{ minimum: 1; maximum: 60 }>;
}>;
export const timeoutSettingsSchema: Readonly<{
  type: 'object';
  minProperties: 1;
  additionalProperties: false;
  properties: Readonly<Record<keyof TimeoutSettings, Readonly<Record<string, unknown>>>>;
}>;
export interface ModelDeployment {
  name: string;
  model: string;
  version: string;
  sku: string;
  capacity: number;
  capabilities: ModelCapability[];
  reasoningEfforts: ReasoningEffort[];
}
export interface ModelCatalogue {
  source: 'arm' | 'fallback';
  deployments: ModelDeployment[];
  reason?: string;
}
export function isModelCatalogue(value: unknown): value is ModelCatalogue;
export const generatedViewRenderers: readonly [
  'table', 'list', 'detail', 'text', 'timeline', 'chart', 'task-card', 'status', 'image', 'html-app',
  'knowledge-graph', 'code',
];
export const htmlArtifactByteLimit: 524288;
export const generatedViewActionTypes: readonly ['open-route', 'open-link', 'call-tool', 'window'];

export type GeneratedViewRenderer = typeof generatedViewRenderers[number];
export type GeneratedViewActionType = typeof generatedViewActionTypes[number];

export interface GeneratedViewPage {
  limit: number;
  offset: number;
  total?: number;
  nextOffset: number | null;
}

export interface GeneratedViewSource {
  id: 'now' | 'factory.tasks' | 'factory.projects' | 'usage' | 'image_generation' | 'html_generation' | 'research' | 'knowledge_graph';
  status: 'running' | 'complete' | 'partial' | 'unavailable';
  updatedAt?: string;
  reason?: string;
  page?: GeneratedViewPage;
}

export type GeneratedViewAction =
  | { type: 'open-route'; route: string }
  | { type: 'open-link'; url: string; label: string }
  | { type: 'call-tool'; tool: string }
  | GeneratedViewWindowAction;

export type GeneratedViewWindowAction =
  | {
    type: 'window';
    operation: 'focus' | 'minimise' | 'restore' | 'close';
    windowId: string;
  }
  | {
    type: 'window';
    operation: 'move';
    windowId: string;
    x: number;
    y: number;
  }
  | {
    type: 'window';
    operation: 'resize';
    windowId: string;
    width: number;
    height: number;
    x?: number;
    y?: number;
  };

export interface GeneratedViewListItem {
  title: string;
  description?: string;
  details?: { label: string; value: string }[];
  action?: Extract<GeneratedViewAction, { type: 'open-route' | 'open-link' }>;
}

export interface GeneratedViewListData {
  items: GeneratedViewListItem[];
}

export interface GeneratedKnowledgeGraphData {
  query: string;
  highlight: string[];
}

export interface VaultNoteListItem {
  path: string;
  title: string;
  /** First path segment, or an empty string for a root note. */
  folder: string;
  /** Full parent directory path, or an empty string for a root note. */
  directory: string;
  updatedAt: string;
}

export interface VaultKnowledgeGraphNode extends VaultNoteListItem {
  id: string;
  degree: number;
}

export interface VaultDirectoryTree {
  directories: string[];
  rootNoteCount: number;
  truncated: boolean;
  updatedAt: string;
}

export interface GeneratedCodeData {
  repo: string;
  path: string;
  ref?: string;
  language?: string;
  content: string;
  startLine?: number;
  /** Absolute, inclusive line ranges within the displayed content. */
  highlight?: { from: number; to: number }[];
  query?: string;
}

interface GeneratedViewBase {
  version: 1;
  title: string;
  source: GeneratedViewSource;
  actions?: GeneratedViewAction[];
}

export type GeneratedView =
  | (GeneratedViewBase & {
    renderer: 'table';
    data: { columns: string[]; rows: (string | number | boolean | null)[][] };
  })
  | (GeneratedViewBase & { renderer: 'list'; data: GeneratedViewListData })
  | (GeneratedViewBase & { renderer: 'detail'; data: { fields: { label: string; value: string }[] } })
  | (GeneratedViewBase & { renderer: 'text'; data: { format: 'plain' | 'markdown'; content: string } })
  | (GeneratedViewBase & { renderer: 'code'; data: GeneratedCodeData })
  | (GeneratedViewBase & {
    renderer: 'timeline';
    data: { events: (({ at: string; label?: string } | { at?: string; label: string }) &
      { title: string; description?: string })[] };
  })
  | (GeneratedViewBase & {
    renderer: 'chart';
    data: {
      kind: 'line' | 'bar' | 'area';
      series: { name: string; points: { x: number | string; y: number }[] }[];
    };
  })
  | (GeneratedViewBase & {
    renderer: 'task-card';
    data: { id: string; title: string; state: string; summary?: string };
  })
  | (GeneratedViewBase & {
    renderer: 'status';
    data: { label: string; value?: string; state: 'ok' | 'warning' | 'error' | 'unknown' };
  })
  | (GeneratedViewBase & { renderer: 'image'; data: { images: { url: string; alt: string }[] } })
  | (GeneratedViewBase & { renderer: 'html-app'; data: { artifactId: string } })
  | (GeneratedViewBase & { renderer: 'knowledge-graph'; data: GeneratedKnowledgeGraphData });

export interface HtmlArtifactSource {
  title: string;
  url: string;
}

export interface HtmlArtifact {
  id: string;
  kind: 'html';
  title: string;
  html: string;
  sources: HtmlArtifactSource[];
  createdAt: string;
  pinned: boolean;
}

export type FolioKind = 'research' | 'html_app' | 'image' | 'knowledge_graph';
export interface FolioItem {
  id: `${FolioKind}:${string}`;
  title: string;
  kind: FolioKind;
  createdAt: string;
  promptSummary: string;
  pinned: boolean;
}
export interface FolioSearch {
  q?: string;
  kind?: FolioKind;
  before?: string;
}
export interface FolioSearchResponse { items: FolioItem[] }
export interface FolioPatch { title?: string; pinned?: boolean }

export interface HtmlArtifactFrame {
  widthPx: number;
  heightPx: number;
  device: 'desktop' | 'phone';
  theme: 'dark' | 'light';
  reducedMotion: boolean;
  density: 'compact' | 'comfortable' | 'spacious';
  designTokens: Record<string, string>;
  fonts: { body: string; heading: string; mono: string };
  layout: 'tiled' | 'layered';
  pinned: boolean;
}

export type WorkspaceWindowRegion = 'left' | 'right' | 'top' | 'bottom' | 'centre' | 'full';
export type WorkspaceWindowState = 'open' | 'minimised';
export type WorkspaceWindowPlacement = 'auto' | 'region' | 'manual';
export type WorkspaceArrangeLayout = 'auto' | 'side-by-side' | 'grid' | 'cascade';

export interface WorkspaceSnapshotWindow {
  viewId: string;
  title: string;
  state?: WorkspaceWindowState;
  placement?: WorkspaceWindowPlacement;
  region?: WorkspaceWindowRegion;
  pinned?: boolean;
  front?: boolean;
  /** Untrusted page-reported text, at most 8 KiB UTF-8. */
  content?: string;
  /** Untrusted selected text, at most 2 KiB UTF-8. */
  selection?: string;
}

export type WorkspaceDeviceKind = 'desktop' | 'phone' | 'tablet';
export type WorkspaceCommandTarget = 'active' | 'desktop' | 'phone' | 'all';
export interface WorkspaceDevice {
  kind: WorkspaceDeviceKind;
  label?: string;
}
export const workspaceDeviceKinds: readonly WorkspaceDeviceKind[];
export const workspaceCommandTargets: readonly WorkspaceCommandTarget[];

export interface WorkspaceSnapshot {
  windows: readonly WorkspaceSnapshotWindow[];
  /** The kind of device this tab runs on; older pages omit it. */
  device?: WorkspaceDevice;
  contextPanelOpen: boolean;
  frame?: HtmlArtifactFrame;
  view?: WorkspaceView;
}

export interface WorkspacePin {
  viewId: string;
  view: GeneratedView;
  pinnedAt: string;
}
export interface WorkspacePinsResponse {
  pins: WorkspacePin[];
}
export const workspaceViewIdSchema: Readonly<Record<string, unknown>>;
export const workspacePinSchema: Readonly<Record<string, unknown>>;
export const workspacePinPutSchema: Readonly<Record<string, unknown>>;
export const workspacePinResponseSchema: Readonly<Record<string, unknown>>;
export const workspacePinsResponseSchema: Readonly<Record<string, unknown>>;
export function isWorkspacePin(
  value: unknown,
  options?: { trustedBlobHost?: string; registeredTools?: readonly string[] },
): value is WorkspacePin;
export function isWorkspacePinsResponse(
  value: unknown,
  options?: { trustedBlobHost?: string; registeredTools?: readonly string[] },
): value is WorkspacePinsResponse;

export interface WorkspaceViewLocation {
  page: WorkspaceNavigationPage;
  section?: WorkspaceSettingsSection;
  taskId?: string;
  issueNumber?: number;
}
export interface WorkspaceView extends WorkspaceViewLocation {
  folioOpen?: boolean;
  focusedViewId?: string;
  previous?: WorkspaceViewLocation;
}
export const workspaceViewSchema: Readonly<Record<string, unknown>>;
export function isWorkspaceView(value: unknown): value is WorkspaceView;
export function isWorkspaceSnapshot(value: unknown): value is WorkspaceSnapshot;

export const workspaceNavigationPages: readonly [
  'home', 'factory', 'settings', 'usage', 'notes', 'knowledge', 'folio', 'status', 'daily',
];
export type WorkspaceNavigationPage = typeof workspaceNavigationPages[number];
export const workspaceSettingsSections: readonly [
  'appearance', 'jarvis', 'personality', 'voice', 'presence', 'memory',
  'coding', 'projects', 'routines', 'credentials', 'backend',
];
export type WorkspaceSettingsSection = typeof workspaceSettingsSections[number];

/** `target` is optional on every operation and addresses a device kind; the broker routes it (P9-61). */
export type WorkspaceCommand = { target?: WorkspaceCommandTarget } & (
  | { commandId: string; operation: 'navigate'; page: 'settings'; section?: WorkspaceSettingsSection }
  | { commandId: string; operation: 'navigate'; page: 'factory'; taskId?: string; issueNumber?: number }
  | { commandId: string; operation: 'navigate'; page: Exclude<WorkspaceNavigationPage, 'settings' | 'factory'> }
  | { commandId: string; operation: 'conversation'; action: 'show' | 'hide' }
  | { commandId: string; operation: 'session'; action: 'language'; value: 'da' | 'en' }
  | { commandId: string; operation: 'session'; action: 'voice'; value: 'end' }
  | { commandId: string; operation: 'session'; action: 'camera'; value: 'front' | 'rear' | 'off' }
  | { commandId: string; operation: 'create' | 'update'; viewId: string; view: GeneratedView }
  | { commandId: string; operation: 'show' | 'close' | 'minimise' | 'restore' | 'focus'; viewId: string }
  | { commandId: string; operation: 'move'; viewId: string; x: number; y: number }
  | { commandId: string; operation: 'resize'; viewId: string; width: number; height: number; x?: number; y?: number }
  | { commandId: string; operation: 'layout'; arrangement: 'tiled' | 'layered' }
  | { commandId: string; operation: 'place'; viewId: string; region: WorkspaceWindowRegion }
  | { commandId: string; operation: 'arrange'; layout: WorkspaceArrangeLayout; viewIds?: string[] }
  | { commandId: string; operation: 'minimise-all' | 'restore-all' | 'close-all' }
  | { commandId: string; operation: 'pin' | 'unpin'; viewId: string }
  | { commandId: string; operation: 'context-panel'; action: 'open'; view?: GeneratedView }
  | { commandId: string; operation: 'context-panel'; action: 'close' | 'toggle' });

export interface WebResearchSource {
  title: string;
  url: string;
  retrievedAt: string;
}

export interface WebResearchResult {
  answer: string;
  sources: WebResearchSource[];
}

export type UsageRole = 'chat' | 'smoke' | 'voice' | 'vision' | 'research' | 'embeddings';
export type UsageVerification = 'measured' | 'estimated' | 'unverified';
export type UsagePeriod = 'today' | '7d' | '30d' | '90d' | 'all';
export type UsageSource = 'sandbox' | 'jarvis_model' | 'voice' | 'codex' | 'copilot';
export type UsageMetric = 'minutes' | 'input_tokens' | 'output_tokens' | 'turns' | 'premium_requests' | 'screen_frames';

export interface UsageEntry {
  taskId: string | null;
  taskTitle: string | null;
  projectId: string | null;
  projectName: string | null;
  agent: 'codex' | 'copilot' | 'jarvis';
  source: 'sandbox' | 'jarvis_model' | 'voice' | 'codex' | 'copilot';
  metric: 'minutes' | 'input_tokens' | 'output_tokens' | 'turns' | 'premium_requests' | 'screen_frames';
  quantity: number;
  costUsd: number | null;
  costDkk: number | null;
  costStatus: UsageVerification;
  role: UsageRole | null;
  model: string | null;
  at: string;
  estimated: boolean;
}

export interface UsageCostTotal {
  period: string;
  usd: number;
  dkk: number;
  estimatedEntries: number;
  unverifiedEntries: number;
}

export interface UsageToolCallCount {
  tool: 'research' | 'web_research' | 'image_generation';
  count: string;
  costStatus: 'unverified';
}

export interface UsageRoleCoverage {
  role: UsageRole;
  usageStatus: UsageVerification;
  costStatus: UsageVerification;
  note: string;
}

export interface UsageReport {
  period: UsagePeriod;
  from: string | null;
  to: string;
  entries: UsageEntry[];
  totalEntries: string;
  dailyToolUsage: { date: string; tools: { tool: string; count: string }[] };
  dailyCostTotals: UsageCostTotal[];
  monthlyCostTotals: UsageCostTotal[];
  toolCalls: UsageToolCallCount[];
  roleCoverage: UsageRoleCoverage[];
  codexToolCallsToday: { tool: 'web_research'; count: string }[] | null;
  truncated: boolean;
}

export type JarvisActivitySource = 'chat' | 'voice';
export type JarvisActivityOutcome = 'ok' | 'refused' | 'error';
export const jarvisWorkActivityKinds: readonly [
  'vault_search', 'repo_read', 'repo_search', 'web_search', 'task', 'other',
];
export type JarvisWorkActivityKind = typeof jarvisWorkActivityKinds[number];
export interface JarvisWorkActivityDetail {
  activityId: string;
  kind: JarvisWorkActivityKind;
  text: string;
  target?: { label: string };
}
export const jarvisWorkActivityDetailSchema: Readonly<Record<string, unknown>>;
export function isJarvisWorkActivityDetail(value: unknown): value is JarvisWorkActivityDetail;
export type JarvisActivityEvent =
  | (JarvisWorkActivityDetail & { type: 'work-started'; source?: JarvisActivitySource })
  | { type: 'work-finished'; activityId: string; source?: JarvisActivitySource }
  | {
    type: 'listening' | 'thinking' | 'speaking' | 'interrupted' | 'reconnecting' | 'failed' | 'ended';
    activityId: string;
    source: JarvisActivitySource;
  }
  | {
    type: 'tool-call-started';
    activityId: string;
    source: JarvisActivitySource;
    toolName: string;
  }
  | {
    type: 'tool-call-finished';
    activityId: string;
    source: JarvisActivitySource;
    toolName: string;
    outcome: JarvisActivityOutcome;
  };

export function isJarvisActivityEvent(value: unknown): value is JarvisActivityEvent;

/** The PC bridge heard Dan's offline wake word; `at` is the detection time as an ISO 8601 UTC timestamp. */
export interface JarvisVoiceWakeEvent {
  type: 'voice.wake';
  at: string;
}

export function isJarvisVoiceWakeEvent(value: unknown): value is JarvisVoiceWakeEvent;

export const generatedViewSchema: Readonly<Record<string, unknown>>;
export const generatedCodeDataSchema: Readonly<Record<string, unknown>>;
export function isGeneratedCodeData(value: unknown): value is GeneratedCodeData;
export const htmlArtifactSchema: Readonly<Record<string, unknown>>;
export const folioKinds: readonly FolioKind[];
export const folioItemSchema: Readonly<Record<string, unknown>>;
export const folioSearchSchema: Readonly<Record<string, unknown>>;
export const folioSearchResponseSchema: Readonly<Record<string, unknown>>;
export const folioPatchSchema: Readonly<Record<string, unknown>>;
export const folioDeleteSchema: Readonly<Record<string, unknown>>;
export const folioSearchToolSchema: Readonly<Record<string, unknown>>;
export const folioOpenToolSchema: Readonly<Record<string, unknown>>;
export const folioManageToolSchema: Readonly<Record<string, unknown>>;
export function isFolioItem(value: unknown): value is FolioItem;
export const htmlArtifactFrameSchema: Readonly<Record<string, unknown>>;
export function isHtmlArtifact(value: unknown): value is HtmlArtifact;
export function isHtmlArtifactFrame(value: unknown): value is HtmlArtifactFrame;
export function isValidHtmlArtifactHtml(value: unknown): value is string;
export function isGeneratedView(
  value: unknown,
  options?: { trustedBlobHost?: string; registeredTools?: readonly string[] },
): value is GeneratedView;
export const workspaceCommandSchema: Readonly<Record<string, unknown>>;
export const webResearchResultSchema: Readonly<Record<string, unknown>>;
export function isWebResearchResult(value: unknown): value is WebResearchResult;
export function isWorkspaceCommand(
  value: unknown,
  options?: { trustedBlobHost?: string; registeredTools?: readonly string[] },
): value is WorkspaceCommand;
/** One concrete reason a workspace command is invalid: a property path and static, value-free text. */
export interface WorkspaceCommandProblem {
  readonly path: string;
  readonly problem: string;
}
/** Explains an invalid workspace command in up to three problems; `[]` when nothing concrete is found. */
export function workspaceCommandProblems(
  value: unknown,
  options?: { trustedBlobHost?: string; registeredTools?: readonly string[] },
): WorkspaceCommandProblem[];

export type BackgroundJobKind = 'research' | 'image' | 'html_app' | 'embedding' | 'proactive';
export type BackgroundJobStatus = 'running' | 'done' | 'failed' | 'cancelled';
/** A slow Jarvis task running in the background; the shell shows it as a job chip until its window is ready. */
export interface BackgroundJob {
  jobId: string;
  kind: BackgroundJobKind;
  /** Short title, 3-6 words, at most 80 characters. */
  title: string;
  status: BackgroundJobStatus;
  /** Completed steps, 0..steps. */
  step: number;
  steps: number;
  /** Current step or failure reason, at most 120 characters. */
  detail?: string;
  /** Workspace view that holds the result; present when status is done. */
  viewId?: string;
  startedAt: string;
  updatedAt: string;
}
export interface BackgroundJobStep {
  status: BackgroundJobStatus;
  step: number;
  detail?: string;
  viewId?: string;
  updatedAt: string;
}
export interface BackgroundJobDetails {
  job: BackgroundJob;
  steps: BackgroundJobStep[];
  error?: string;
  resultWindow?: string;
  retryable: boolean;
}
export interface BackgroundJobEvent {
  type: 'job';
  job: BackgroundJob;
}
export const backgroundJobKinds: readonly BackgroundJobKind[];
export const backgroundJobStatuses: readonly BackgroundJobStatus[];
export function isBackgroundJob(value: unknown): value is BackgroundJob;
export function isBackgroundJobStep(value: unknown): value is BackgroundJobStep;
export function isBackgroundJobDetails(value: unknown): value is BackgroundJobDetails;
export function isBackgroundJobEvent(value: unknown): value is BackgroundJobEvent;

export const nowSseEventNames: readonly [
  'mode', 'now', 'voice-wake', 'job', 'jarvis-activity', 'workspace-ready', 'workspace-command',
  'workspace-cancel', 'board',
];
export interface TaskEventRecord {
  id: string;
  type: string;
  summary: string | null;
  payload: unknown;
  payloadTruncated: boolean;
  source: 'runner' | 'backend' | 'github' | 'dan';
  at: string;
}
export interface TaskEventMessage extends TaskEventRecord {
  taskId: string;
}
export type NowSseEvent =
  | { event: 'mode'; data: Record<string, never> }
  | { event: 'now'; data: Record<string, never> }
  | { event: 'board'; data: FactoryBoardUpdate }
  | { event: 'voice-wake'; data: JarvisVoiceWakeEvent }
  | { event: 'job'; data: BackgroundJob }
  | { event: 'jarvis-activity'; data: JarvisActivityEvent }
  | { event: 'workspace-ready'; data: { sessionId: string; trustedBlobHost?: string } }
  | { event: 'workspace-command'; data: { command: WorkspaceCommand; expiresAt: number } }
  | { event: 'workspace-cancel'; data: { commandId: string } };
export type WorkspaceSseEvent = Extract<NowSseEvent, { event: 'workspace-command' | 'workspace-cancel' }>;
export type TaskEventStreamEvent =
  | { event: 'task'; id: string; data: TaskEventMessage }
  | { event: 'ready'; data: Record<string, never> };
export type ServerSentEvent = NowSseEvent | TaskEventStreamEvent;

export const factoryBoardColumnIds: readonly [
  'backlog', 'needs_dan', 'ready', 'in_progress', 'in_review', 'done',
];
export type FactoryBoardColumnId = typeof factoryBoardColumnIds[number];
export interface BoardCardIssue {
  number: number;
  url: string;
  title: string;
  taskCode: string | null;
  labels: string[];
  worker: 'Jarvis' | 'Copilot' | 'Codex' | 'Dan' | null;
  state: 'open' | 'closed';
  updatedAt: string;
  closedAt: string | null;
  blockedBy: number[];
}
export interface BoardCardPullRequest {
  number: number;
  url: string;
  draft: boolean;
  checks: 'none' | 'pending' | 'passing' | 'failing';
}
export interface FactoryBoardTask {
  id: string;
  state: 'Ready' | 'Running' | 'PauseRequested' | 'Paused' | 'NeedsAttention' | 'Done' | 'Cancelled';
  agent: 'codex' | 'copilot';
  activity: string | null;
  attemptCount: number;
  branch: string | null;
  startedAt: string | null;
  latestSessionEndReason: 'done' | 'cancelled' | 'crashed' | 'idle' | 'idle_expired' | null;
}
export interface BoardCard {
  issue: BoardCardIssue;
  pr: BoardCardPullRequest | null;
  task: FactoryBoardTask | null;
}
export interface FactoryBoardColumn {
  id: FactoryBoardColumnId;
  cards: BoardCard[];
}
export interface FactoryBoard {
  project: { id: string; repo: string };
  fetchedAt: string;
  stale: boolean;
  columns: FactoryBoardColumn[];
}
export interface FactoryBoardUpdate {
  projectId: string;
  version: number;
}
export function isFactoryBoard(value: unknown): value is FactoryBoard;
export function isFactoryBoardUpdate(value: unknown): value is FactoryBoardUpdate;
export function isTaskEventRecord(value: unknown): value is TaskEventRecord;
export function isTaskEventMessage(value: unknown): value is TaskEventMessage;
export function isNowSseEvent(
  value: unknown,
  options?: { trustedBlobHost?: string; registeredTools?: readonly string[] },
): value is NowSseEvent;
export function isTaskEventStreamEvent(value: unknown): value is TaskEventStreamEvent;

export type PhoneCallOutcome = 'in_progress' | 'ended' | 'failed';
export interface PhoneCallHistoryEntry {
  startedAt: string;
  durationSeconds: number;
  outcome: PhoneCallOutcome;
}
export type ConversationSearchSource = 'chat' | 'voice' | 'phone';
export interface ConversationSearchHit {
  messageId: string;
  sessionId: string;
  source: ConversationSearchSource;
  role: 'dan' | 'jarvis';
  at: string;
  snippet: string;
}
export interface ConversationSearchPage {
  results: ConversationSearchHit[];
  hasMore: boolean;
}
export interface PhoneStatus {
  configured: boolean;
  historyAvailable: boolean;
  recentCalls: readonly PhoneCallHistoryEntry[];
}

export const systemSmokeCheckIds: readonly [
  'google', 'github_app', 'vault', 'foundry.embeddings', 'research', 'pc_bridge', 'agent_contract',
  'chat_canary', 'chat_identity', 'chat_capabilities', 'chat_github_read', 'chat_jobs',
  'chat_navigation', 'chat_no_timestamp', 'chat_plain_approval',
];
export type SystemSmokeCheckId = typeof systemSmokeCheckIds[number];
export interface SystemSmokeEntry {
  id: SystemSmokeCheckId;
  status: SystemStatusValue;
  checkedAt: string;
  reason?: string;
}
export interface SystemSmokeStatus {
  checkedAt: string;
  entries: readonly SystemSmokeEntry[];
}
export function isSystemSmokeStatus(value: unknown): value is SystemSmokeStatus;

export type SystemStatusValue = 'ok' | 'degraded' | 'down' | 'unknown';
export type SystemStatusSubsystem =
  | 'database'
  | 'foundry.chat'
  | 'foundry.voice'
  | 'foundry.embeddings'
  | 'vault_index'
  | 'github_app'
  | 'google'
  | 'pc_bridge'
  | 'runner'
  | 'deployed_commit'
  | 'last_error';
export interface SystemStatusEntry {
  id: SystemStatusSubsystem;
  status: SystemStatusValue;
  checkedAt: string;
  details?: Readonly<Record<string, string | number | boolean | null>>;
}
export interface SystemStatus {
  checkedAt: string;
  entries: readonly SystemStatusEntry[];
  smoke?: SystemSmokeStatus;
}
export interface SystemHealthComponent {
  id: string;
  status: SystemStatusValue;
  detail: string;
  checkedAt: string | null;
  recovery: { tool: 'retry_job' | 'renew_credential' | 'get_deployment_status' | 'get_work_status';
    description: string }[];
}
export interface SystemHealth {
  components: SystemHealthComponent[];
}
export interface WorkStatusInput {
  issueNumber?: number;
  taskId?: string;
  query?: string;
  project?: string;
}
export interface WorkStatus {
  verdict: 'delivered' | 'in_progress' | 'needs_attention' | 'not_started';
  project: { id: string; name: string; repo: string } | null;
  issue: { number: number; url: string; title: string; state: 'open' | 'closed'; labels: string[] } | null;
  tasks: { id: string; issueNumber: number | null; title: string; state: string; activity: string | null;
    attemptCount: number; linked: boolean }[];
  pullRequests: { number: number; url: string; state: 'open' | 'closed' | 'merged'; draft: boolean;
    merged: boolean;
    checks: 'pending' | 'passed' | 'failed'; mergeSha: string | null }[];
  deployments: { sha: string; status: 'verified' | 'failed' | 'pending' | 'unknown';
    source: 'release' | 'actions'; url: string | null }[];
  warnings: string[];
  partial: boolean;
}
export type IssueAttachmentInput = {
  attachmentIds?: string[];
  publish?: 'description' | 'public';
};
export const issueAttachmentFields: Readonly<Record<'attachmentIds' | 'publish', object>>;
