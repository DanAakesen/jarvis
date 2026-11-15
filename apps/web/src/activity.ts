/**
 * View model for the main page's "Now" activity panel.
 */
export type CodingAgent = 'codex' | 'copilot';

export interface RunningTask {
  id: string;
  title: string;
  project: string;
  agent: CodingAgent;
  /** The task's current activity, as shown on its card. */
  activity: string;
  startedAt: string;
}

export type ActivityCategory = 'attention' | 'release' | 'credential' | 'alert' | 'mode';
export type ConfirmationActionKind =
  | 'merge'
  | 'delete'
  | 'send_mail'
  | 'calendar_change'
  | 'create_repository'
  | 'computer_use'
  | 'spend_money'
  | 'other';

export interface BrowserConfirmation {
  id: string;
  actionKind: ConfirmationActionKind;
  summary: string;
  expiresAt: string;
}

export interface ActivityItem {
  id: string;
  category: ActivityCategory;
  title: string;
  /** `activity.link`, for example `task:42`, `release:7`, `project:3` or `proactive:<finding id>`. */
  link: string | null;
  at: string;
}

export interface FeedAttention {
  items: readonly ActivityItem[];
  confirmations: readonly BrowserConfirmation[];
  onDismiss?: (id: string) => Promise<void>;
  onResolveConfirmation?: (id: string, decision: 'approve' | 'reject') => Promise<void>;
}

export type NowFeed =
  | { status: 'loading' }
  | { status: 'unavailable'; message: string }
  | {
    status: 'ready';
    running: readonly RunningTask[];
    items: readonly ActivityItem[];
    confirmations: readonly BrowserConfirmation[];
    updatedAt: string;
    awayMode: boolean;
  };

export type NowFeedStreamStatus = 'connecting' | 'connected' | 'reconnecting' | 'unavailable';

export const activityCategories: readonly { id: ActivityCategory; heading: string; empty: string }[] = [
  { id: 'attention', heading: 'Needs attention', empty: 'No tasks need attention.' },
  { id: 'release', heading: 'Releases and deployments', empty: 'No recent releases or deployments.' },
  { id: 'credential', heading: 'Credential warnings', empty: 'No credential warnings.' },
  { id: 'alert', heading: 'Alerts', empty: 'No active alerts.' },
  { id: 'mode', heading: 'Away mode', empty: 'No away mode changes.' },
];

export const agentNames: Record<CodingAgent, string> = { codex: 'Codex', copilot: 'Copilot' };

const linkPattern = /^(task|release|project):([1-9]\d{0,15})$/;
const linkRoutes = { task: '/factory/tasks/', release: '/factory/releases/', project: '/factory/projects/' } as const;

const proactiveLinkPattern = /^proactive:([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/iu;

/** Maps an activity link to its Software Factory or Proactive finding page; anything unexpected gets no link. */
export function activityHref(link: string | null): string | null {
  const finding = link ? proactiveLinkPattern.exec(link) : null;
  if (finding) return `/proactive/${finding[1]}`;
  const match = link ? linkPattern.exec(link) : null;
  if (!match) return null;
  return `${linkRoutes[match[1] as keyof typeof linkRoutes]}${match[2]}`;
}

export function formatDuration(startedAt: string, now: number): string {
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return 'Unknown';
  const minutes = Math.floor(Math.max(0, now - started) / 60_000);
  if (minutes < 1) return 'Under 1 min';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}
