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

export type ActivityCategory = 'attention' | 'release' | 'credential' | 'alert';

export interface ActivityItem {
  id: string;
  category: ActivityCategory;
  title: string;
  /** `activity.link`, for example `task:42`, `release:7` or `project:3`. */
  link: string | null;
  at: string;
}

export type NowFeed =
  | { status: 'loading' }
  | { status: 'unavailable'; message: string }
  | { status: 'ready'; running: readonly RunningTask[]; items: readonly ActivityItem[]; updatedAt: string };

export type NowFeedStreamStatus = 'connecting' | 'connected' | 'reconnecting' | 'unavailable';

export const activityCategories: readonly { id: ActivityCategory; heading: string; empty: string }[] = [
  { id: 'attention', heading: 'Needs attention', empty: 'No tasks need attention.' },
  { id: 'release', heading: 'Releases and deployments', empty: 'No recent releases or deployments.' },
  { id: 'credential', heading: 'Credential warnings', empty: 'No credential warnings.' },
  { id: 'alert', heading: 'Alerts', empty: 'No active alerts.' },
];

export const agentNames: Record<CodingAgent, string> = { codex: 'Codex', copilot: 'Copilot' };

const linkPattern = /^(task|release|project):([1-9]\d{0,15})$/;
const linkRoutes = { task: '/factory/tasks/', release: '/factory/releases/', project: '/factory/projects/' } as const;

/** Maps an activity link to its Software Factory page; anything unexpected gets no link. */
export function activityHref(link: string | null): string | null {
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

const timeFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export function formatTime(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 'Unknown time' : timeFormat.format(time);
}
