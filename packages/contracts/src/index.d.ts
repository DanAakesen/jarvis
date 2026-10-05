export const generatedViewVersion: 1;
export const generatedViewRenderers: readonly [
  'table', 'list', 'detail', 'text', 'timeline', 'chart', 'task-card', 'status', 'image',
];
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
  id: 'now' | 'factory.tasks' | 'factory.projects' | 'usage';
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
  | (GeneratedViewBase & { renderer: 'image'; data: { images: { url: string; alt: string }[] } });

export interface WorkspaceSnapshot {
  windows: readonly { viewId: string; title: string }[];
  contextPanelOpen: boolean;
}

export type WorkspaceCommand =
  | { commandId: string; operation: 'create' | 'update'; viewId: string; view: GeneratedView }
  | { commandId: string; operation: 'show' | 'close' | 'minimise' | 'restore' | 'focus'; viewId: string }
  | { commandId: string; operation: 'move'; viewId: string; x: number; y: number }
  | { commandId: string; operation: 'resize'; viewId: string; width: number; height: number; x?: number; y?: number }
  | { commandId: string; operation: 'layout'; arrangement: 'tiled' | 'layered' }
  | { commandId: string; operation: 'context-panel'; action: 'open'; view: GeneratedView }
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

export const generatedViewSchema: Readonly<Record<string, unknown>>;
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
