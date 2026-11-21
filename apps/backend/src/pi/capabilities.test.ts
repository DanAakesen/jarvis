import { describe, expect, it } from 'vitest';
import type { RegisteredTool, ToolRegistry } from '../core/tool-registry.js';
import { piCapabilityNote } from './capabilities.js';
import type { RemoteMcpBridge, RemoteMcpStatus } from './remote-mcp.js';

// One tool per example name of every category: the fullest overview the index can produce.
const names = [
  'vault_task_create', 'vault_task_complete', 'vault_task_edit', 'owner_reminders', 'inbox_capture', 'inbox_items', 'inbox_close',
  'calendar_today_agenda', 'calendar_list_events', 'calendar_create_event', 'calendar_find_free_slots',
  'mail_search', 'mail_draft_reply', 'mail_send', 'mail_list_drafts', 'vault_search', 'vault_read', 'vault_write', 'show_knowledge',
  'health_query', 'health_food', 'gym_lifts', 'gym_sessions', 'list_projects', 'list_tasks', 'create_task', 'get_work_status',
  'github_read', 'github_write', 'repo_search', 'pr_get', 'pc_open', 'pc_media', 'browser_do', 'pc_act',
  'workspace_command', 'show_in_chat', 'workspaces_open', 'create_html_view', 'memory_search', 'memory_remember', 'conversation_search',
  'attachment_read', 'research', 'web_research', 'list_jobs', 'weather', 'watch_for', 'stop_watching_for',
  'get_settings', 'set_presence_mode', 'get_system_health', 'get_usage', 'proactive_recent_items', 'proactive_item_feedback',
  'proactive_preferences',
];
const registry: ToolRegistry = {
  list: () => names.map((name) => ({ name, description: name, inputSchema: { type: 'object' } }) as RegisteredTool),
  get: () => undefined,
};
const bridge = (prefix: string, label: string, status: RemoteMcpStatus): RemoteMcpBridge => ({
  prefix, label, status: () => status, warm: () => {}, tools: async () => [], call: async () => ({ outcome: 'ok', result: {} }),
});

describe('PI tool overview note', () => {
  it('stays within 1,500 characters with every area present and lists the connections', () => {
    const note = piCapabilityNote(registry, [bridge('gh_', 'GitHub', { state: 'idle' })]);
    expect(note.text.length).toBeLessThanOrEqual(1_500);
    expect(note.text).toContain('GitHub=idle; Azure=not_configured');
    expect(note.text).toContain('Calendar: calendar_today_agenda');
    expect(note.text).toContain('Proactive findings');
  });

  it('changes its signature with a connection state, not with a reason or a load in progress', () => {
    const signature = (github: RemoteMcpStatus, azure?: RemoteMcpStatus) =>
      piCapabilityNote(registry, [bridge('gh_', 'GitHub', github), ...(azure ? [bridge('az_', 'Azure', azure)] : [])]).signature;
    const idle = signature({ state: 'idle' });
    expect(signature({ state: 'starting' })).toBe(idle);
    expect(signature({ state: 'ready' })).not.toBe(idle);
    expect(signature({ state: 'unreachable', reason: 'a' })).toBe(signature({ state: 'unreachable', reason: 'b' }));
    expect(signature({ state: 'stale', reason: 'a' })).not.toBe(signature({ state: 'ready' }));
    expect(signature({ state: 'idle' }, { state: 'ready' })).not.toBe(idle);
  });
});
