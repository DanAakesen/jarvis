import { isCurrentAssistantTool, type RegisteredTool, type ToolRegistry } from './tool-registry.js';

const MAX_INDEX_CHARACTERS = 1_500;

interface Category {
  readonly label: string;
  readonly matches: (name: string) => boolean;
  /** Preferred example names, shown first when the catalogue has them. */
  readonly examples: readonly string[];
}

const prefix = (...prefixes: string[]) => (name: string) => prefixes.some((item) => name.startsWith(item));
const exact = (...names: string[]) => (name: string) => names.includes(name);

// First match wins, so order narrows from specific to broad. Tools no category claims land in "Other".
const categories: readonly Category[] = [
  { label: 'Tasks and reminders', matches: (name) => name.startsWith('vault_task_') || name === 'owner_reminders',
    examples: ['vault_task_create', 'vault_task_complete', 'vault_task_edit', 'owner_reminders'] },
  { label: 'Calendar', matches: prefix('calendar_'),
    examples: ['calendar_today_agenda', 'calendar_list_events', 'calendar_create_event', 'calendar_find_free_slots'] },
  { label: 'Mail', matches: prefix('mail_'),
    examples: ['mail_search', 'mail_draft_reply', 'mail_send', 'mail_list_drafts'] },
  { label: 'Notes and vault', matches: prefix('vault_', 'show_knowledge'),
    examples: ['vault_search', 'vault_read', 'vault_write', 'show_knowledge'] },
  { label: 'Health and gym', matches: prefix('health_', 'gym_'),
    examples: ['health_query', 'health_food', 'gym_lifts', 'gym_sessions'] },
  { label: 'Factory projects and tasks',
    matches: exact('list_projects', 'create_project', 'update_project', 'archive_project', 'manage_repository',
      'list_tasks', 'get_task', 'create_task', 'steer_task', 'pause_task', 'resume_task', 'cancel_task',
      'retry_task', 'set_task_model', 'start_issue', 'create_issue', 'get_work_status', 'list_releases',
      'get_release', 'get_deployment_status'),
    examples: ['list_projects', 'list_tasks', 'create_task', 'get_work_status'] },
  { label: 'GitHub and code', matches: (name) => prefix('github_', 'pr_', 'repo_')(name) ||
      exact('checks_list', 'ci_log', 'issue_comment')(name),
  examples: ['github_read', 'github_write', 'repo_search', 'pr_get'] },
  { label: 'PC and browser', matches: prefix('pc_', 'browser_do', 'codex_prompt', 'read_window'),
    examples: ['pc_open', 'pc_media', 'browser_do', 'pc_act'] },
  { label: 'Workspace and views',
    matches: prefix('workspace', 'pin', 'create_html_view', 'read_html_view', 'update_html_view', 'set_theme'),
    examples: ['workspace_command', 'workspaces_open', 'create_html_view', 'set_theme'] },
  { label: 'Memory and conversation', matches: prefix('memory_', 'conversation_', 'attachment_'),
    examples: ['memory_search', 'memory_remember', 'conversation_search', 'attachment_read'] },
  { label: 'Research and jobs',
    matches: exact('research', 'web_research', 'weather', 'image_generation', 'list_jobs', 'get_job',
      'cancel_job', 'retry_job'),
    examples: ['research', 'web_research', 'list_jobs', 'weather'] },
  { label: 'Camera', matches: exact('watch_for', 'stop_watching_for'),
    examples: ['watch_for', 'stop_watching_for'] },
  { label: 'Settings and system',
    matches: exact('get_settings', 'update_settings', 'get_status_summary', 'get_system_health', 'get_usage',
      'set_presence_mode', 'set_away_mode', 'set_jarvis_model', 'manage_model_deployment', 'renew_credential',
      'read_backend_logs'),
    examples: ['get_settings', 'set_presence_mode', 'get_system_health', 'get_usage'] },
  { label: 'Proactive findings', matches: prefix('proactive_'),
    examples: ['proactive_recent_items', 'proactive_item_feedback', 'proactive_preferences'] },
];

function examplesFor(category: Category, tools: readonly RegisteredTool[], count: number): string[] {
  const names = tools.map((tool) => tool.name);
  const preferred = category.examples.filter((name) => names.includes(name));
  return [...preferred, ...names.filter((name) => !preferred.includes(name)).sort()].slice(0, count);
}

/**
 * Compact index of what the tool catalogue offers, built from the registry so it cannot drift.
 * The model sees names only; schemas come from find_tools.
 */
export function capabilityIndex(registry: ToolRegistry): string {
  const tools = registry.list().filter((tool) => isCurrentAssistantTool(tool.name));
  const groups = new Map<string, RegisteredTool[]>();
  const other: RegisteredTool[] = [];
  for (const tool of tools) {
    const category = categories.find((entry) => entry.matches(tool.name));
    if (!category) { other.push(tool); continue; }
    groups.set(category.label, [...groups.get(category.label) ?? [], tool]);
  }
  const lines = (count: number) => [
    ...categories.flatMap((category) => {
      const members = groups.get(category.label);
      return members ? [`${category.label}: ${examplesFor(category, members, count).join(', ')}`] : [];
    }),
    ...(other.length > 0
      ? [`Other: ${other.map((tool) => tool.name).sort().slice(0, count).join(', ')}`] : []),
  ].join('\n');
  let result = lines(3);
  for (const count of [2, 1]) {
    if (result.length <= MAX_INDEX_CHARACTERS) break;
    result = lines(count);
  }
  return result;
}
