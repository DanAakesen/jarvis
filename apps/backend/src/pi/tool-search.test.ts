import { describe, expect, it } from 'vitest';
import type { RegisteredTool, ToolRegistry } from '../core/tool-registry.js';
import { providersNamedBy, searchJarvisTools } from './tool-search.js';

const names = [
  'weather', 'memory_remember', 'memory_search', 'owner_reminders', 'calendar_today_agenda', 'mail_search',
  'vault_task_create', 'vault_search', 'vault_read', 'health_query', 'inbox_capture', 'get_usage',
  'gh_issue_read', 'gh_list_pull_requests', 'az_group_list', 'az_group_resource_list',
];
const registry: ToolRegistry = {
  list: () => names.map((name) => ({ name, description: `Tool ${name}.`, inputSchema: { type: 'object' } }) as RegisteredTool),
  get: () => undefined,
};
const top = (query: string) => searchJarvisTools(registry, query, () => true).map((tool) => tool.name);

describe('tool search wording', () => {
  it.each([
    ['vejret i morgen', 'weather'],
    ['what is the weather', 'weather'],
    ['husk at jeg kan lide te', 'memory_remember'],
    ['remember this', 'memory_remember'],
    ['påmind mig i morgen', 'owner_reminders'],
    ['reminder for the meeting', 'owner_reminders'],
    ['hvad er i min kalender', 'calendar_today_agenda'],
    ['aftale i morgen', 'calendar_today_agenda'],
    ['read my email', 'mail_search'],
    ['mine opgaver', 'vault_task_create'],
    ['show my tasks', 'vault_task_create'],
    ['mine noter om haven', 'vault_search'],
    ['sundhed i dag', 'health_query'],
    ['open pull request', 'gh_list_pull_requests'],
    ['github issue', 'gh_issue_read'],
    ['ressourcer i azure', 'az_group_resource_list'],
  ])('finds the right tool for "%s"', (query, expected) => {
    expect(top(query).slice(0, 3)).toContain(expected);
  });

  it('ranks a tool named exactly in the query first', () => {
    expect(top('az_group_resource_list')[0]).toBe('az_group_resource_list');
    expect(top('please run get_usage now')[0]).toBe('get_usage');
  });

  it('names a remote provider only for its own words or tool prefix', () => {
    expect([...providersNamedBy('github issue')]).toEqual(['gh_']);
    expect([...providersNamedBy('ressourcer i azure')]).toEqual(['az_']);
    expect([...providersNamedBy('az_group_list')]).toEqual(['az_']);
    expect([...providersNamedBy('gh_issue_read')]).toEqual(['gh_']);
    expect([...providersNamedBy('weather kalender noter mail report')]).toEqual([]);
  });
});
