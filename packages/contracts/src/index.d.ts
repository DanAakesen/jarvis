export const generatedViewVersion: 1;
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
  'knowledge-graph',
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
  status: 'complete' | 'partial' | 'unavailable';
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
  | (GeneratedViewBase & {
    renderer: 'timeline';
    data: { events: { at: string; title: string; description?: string }[] };
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

export interface WorkspaceSnapshot {
  windows: readonly { viewId: string; title: string }[];
  contextPanelOpen: boolean;
  frame?: HtmlArtifactFrame;
}

export type WorkspaceCommand =
  | { commandId: string; operation: 'create' | 'update'; viewId: string; view: GeneratedView }
  | { commandId: string; operation: 'show' | 'close' | 'minimise' | 'restore' | 'focus'; viewId: string }
  | { commandId: string; operation: 'move'; viewId: string; x: number; y: number }
  | { commandId: string; operation: 'resize'; viewId: string; width: number; height: number; x?: number; y?: number }
  | { commandId: string; operation: 'layout'; arrangement: 'tiled' | 'layered' }
  | { commandId: string; operation: 'context-panel'; action: 'open'; view?: GeneratedView }
  | { commandId: string; operation: 'context-panel'; action: 'close' | 'toggle' };

export interface WebResearchSource {
  title: string;
  url: string;
  retrievedAt: string;
}

export interface WebResearchResult {
  answer: string;
  sources: WebResearchSource[];
}

export type UsageRole = 'chat' | 'voice' | 'vision' | 'research' | 'embeddings';
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
export type JarvisActivityEvent =
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
export const htmlArtifactSchema: Readonly<Record<string, unknown>>;
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

export type BackgroundJobKind = 'research' | 'image' | 'html_app' | 'embedding';
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
  'mode', 'now', 'voice-wake', 'job', 'jarvis-activity', 'workspace-ready', 'workspace-command', 'workspace-cancel',
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
  'google', 'github_app', 'vault', 'foundry.embeddings', 'research', 'pc_bridge',
];
export type SystemSmokeCheckId = typeof systemSmokeCheckIds[number];
export interface SystemSmokeEntry {
  id: SystemSmokeCheckId;
  status: SystemStatusValue;
  checkedAt: string;
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