import type { ToolExecutionMetadata } from '../../core/tool-registry.js';

/**
 * What a brain wake may run. A wake has no owner message, so nothing that needs Dan's words (starting a Worker, sending
 * mail, creating tasks, writing his notes) is reachable. The brain reads the world through these read-only Jarvis tools and
 * speaks and writes through the three brain-only tools below.
 */
export const brainOnlyTools: ReadonlySet<string> = new Set(['message_dan', 'pi_note', 'inbox_trail']);

/** Tools that only read. Anything not listed is out of reach for a wake, whatever the model asks for. */
const brainReadTools: ReadonlySet<string> = new Set([
  'calendar_list_events', 'calendar_next_event', 'calendar_today_agenda', 'calendar_find_free_slots',
  'mail_search', 'mail_list_drafts', 'weather', 'web_research', 'research',
  'vault_read', 'vault_search', 'memory_search', 'memory_list', 'memory_history', 'conversation_search',
  'inbox_items', 'proactive_recent_items',
  'list_projects', 'list_tasks', 'get_task', 'get_work_status', 'list_jobs', 'get_job', 'list_releases', 'get_release',
  'get_deployment_status', 'repo_list', 'repo_overview', 'repo_read', 'repo_search', 'repo_issues', 'github_read',
  'pr_get', 'pr_diff', 'pr_reviews', 'checks_list', 'ci_log', 'get_status_summary', 'get_usage', 'read_backend_logs',
]);

export function isBrainOnlyTool(name: string): boolean {
  return brainOnlyTools.has(name);
}

/** Visible to a brain wake in `find_tools`. */
export function brainSeesTool(name: string): boolean {
  return brainReadTools.has(name) || brainOnlyTools.has(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The effect of one call. A tool with no classification is a plain read only if it is on the list above. */
function effectOf(execution: ToolExecutionMetadata | undefined, input: unknown): 'read' | 'action' | 'unclassified' {
  if (!execution) return 'read';
  const operation = execution.operation;
  if (operation) {
    const name = isRecord(input) ? input[operation.field] : undefined;
    const effect = typeof name === 'string' ? operation.effects[name] : undefined;
    if (effect) return effect;
    return execution.defaultEffect === 'read' ? 'read' : 'unclassified';
  }
  return execution.defaultEffect;
}

/** The exact rule for a wake: a listed read-only tool whose call is classified as a read, or one of the brain-only tools. */
export function brainMayRun(tool: { readonly name: string; readonly execution?: ToolExecutionMetadata | undefined }, input: unknown): boolean {
  if (brainOnlyTools.has(tool.name)) return true;
  return brainReadTools.has(tool.name) && effectOf(tool.execution, input) === 'read';
}
