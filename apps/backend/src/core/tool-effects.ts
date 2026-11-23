import type { ToolExecutionMetadata } from './tool-registry.js';

/**
 * What a call does to the world, for the tools that do not declare `execution` themselves (a tool's own declaration wins, so a
 * test double that declares its own effect is left alone; the conformance suite fails when a production tool's own declaration
 * differs from its row here, but not when it repeats it exactly). Only the PI door and the failure wording read it: the door counts a call as an
 * action by it, and answers a replay of an action without running it again. A tool that only reads, searches or shows is not
 * listed here but in `readOnlyTools`; the conformance suite fails for a tool that is in neither, so a new tool that writes
 * cannot be forgotten. List a tool as `action` when a call of it changes something outside Jarvis's own screen: a calendar, a
 * mailbox, the vault, a GitHub issue, a setting, Dan's PC, a task, a job.
 */
const action: ToolExecutionMetadata = { defaultEffect: 'action' };

/** A tool whose operations differ: the operations named are judged by their entry, any other operation is `unclassified`. */
const operations = (field: string, effects: Readonly<Record<string, 'read' | 'action'>>): ToolExecutionMetadata =>
  ({ defaultEffect: 'unclassified', operation: { field, effects } });

export const writingTools: Readonly<Record<string, ToolExecutionMetadata>> = Object.freeze({
  azure_storage_queue_create: action,
  azure_storage_queue_delete: action,
  azure_storage_queue_delete_message: action,
  azure_storage_queue_receive: action,
  azure_storage_queue_send: action,
  archive_project: action,
  browser_do: action,
  browser_do_shared: action,
  calendar_confirm_change: action,
  calendar_create_event: action,
  calendar_create_events: action,
  calendar_delete_event: action,
  calendar_move_event: action,
  calendar_update_event: action,
  cancel_job: action,
  cancel_task: action,
  codex_prompt: action,
  confirm_create_issue: action,
  confirm_project_archive: action,
  create_html_view: action,
  create_issue: action,
  create_project: action,
  folio_manage: action,
  github_write: action,
  health_coach_status: operations('operation', {
    get_coach_status: 'read', get_coach_profile: 'read', update_coach_profile: 'action', set_recovery_period: 'action',
  }),
  health_food: action,
  health_food_review: action,
  health_nutrition_history: operations('operation', {
    get_nutrition_history: 'read', analyze_nutrition: 'read', get_calorie_balance: 'read', set_meal_preference: 'action',
  }),
  health_nutrition_targets: operations('operation', { read: 'read', set_targets: 'action' }),
  image_generation: action,
  issue_comment: action,
  mail_archive: action,
  mail_confirm_action: action,
  mail_delete_draft: action,
  mail_draft_reply: action,
  mail_label: action,
  mail_send: action,
  mail_update_draft: action,
  manage_foundry_agent: operations('operation', {
    list: 'read', list_versions: 'read', read: 'read', create_version: 'action', activate: 'action',
  }),
  manage_model_deployment: operations('action', { list: 'read', create: 'action', delete: 'action' }),
  manage_repository: action,
  pause_task: action,
  pc_act: action,
  pc_browser_act: action,
  pc_clipboard_write: action,
  pc_close: action,
  pc_media: action,
  pc_open: action,
  proactive_item_feedback: action,
  renew_credential: action,
  research: action,
  resume_task: action,
  retry_job: action,
  retry_task: action,
  set_away_mode: action,
  set_jarvis_model: action,
  set_presence_mode: action,
  set_task_model: action,
  set_theme: action,
  start_issue: action,
  steer_task: action,
  stop_watching_for: action,
  task_recipes: operations('action', { list: 'read', delete: 'action', rename: 'action', update: 'action' }),
  task_routines: operations('action', { list: 'read', delete: 'action', rename: 'action', update: 'action' }),
  update_html_view: action,
  update_project: action,
  update_settings: action,
  vault_delete: action,
  vault_task_complete: action,
  vault_task_create: action,
  vault_task_edit: action,
  vault_write: action,
  watch_for: action,
  // Screen and window commands only show things, except these: pins are stored, and a session command ends the voice session or switches the camera.
  workspace_command: operations('operation', { pin: 'action', unpin: 'action', session: 'action' }),
  workspaces_manage: action,
});

/** Tools that only read, search or show (opening a window is showing). They stay `unclassified` for the door and the legacy agent. */
export const readOnlyTools: ReadonlySet<string> = new Set([
  'azure_storage_queue_names', 'azure_storage_queue_peek', 'azure_storage_queue_properties',
  'attachment_list', 'attachment_read', 'calendar_find_free_slots', 'calendar_get_pending_change',
  'calendar_next_event', 'calendar_today_agenda', 'checks_list', 'ci_log', 'conversation_search', 'folio_open', 'folio_search',
  'get_deployment_status', 'get_job', 'get_pending_issue', 'get_release', 'get_settings', 'get_status_summary', 'get_usage',
  'get_work_status', 'github_capabilities', 'github_read', 'health_nutrition_suggest', 'health_query', 'health_show',
  'health_summary', 'list_capabilities', 'list_jobs', 'list_projects', 'list_releases', 'list_tasks', 'mail_list_drafts',
  'mail_search', 'pc_active_window', 'pc_browser_snapshot', 'pc_browser_tabs', 'pc_clipboard_read', 'pin_restore', 'pins_list',
  'pr_diff', 'pr_get', 'pr_reviews', 'read_html_view', 'read_window', 'repo_issues', 'repo_list', 'repo_overview', 'repo_read',
  'repo_search', 'show_knowledge', 'vault_read', 'vault_search', 'web_research', 'workspaces_open', 'workspaces_search',
]);
