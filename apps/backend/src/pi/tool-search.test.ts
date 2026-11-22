import { describe, expect, it } from 'vitest';
import type { RegisteredTool, ToolRegistry } from '../core/tool-registry.js';
import { providersNamedBy, searchJarvisTools } from './tool-search.js';

const names = [
  'weather', 'memory_remember', 'memory_search', 'owner_reminders', 'calendar_today_agenda', 'mail_search',
  'vault_task_create', 'vault_search', 'vault_read', 'health_query', 'inbox_capture', 'get_usage',
  'gh_issue_read', 'gh_list_pull_requests', 'gh_create_pull_request', 'create_issue', 'az_group_list', 'az_group_resource_list',
  'pc_open', 'pc_close', 'pc_media', 'health_nutrition_suggest', 'calendar_next_event', 'vault_write', 'memory_forget',
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
    ['luk Spotify på min computer', 'pc_close'],
    ['hvornår er mit næste møde', 'calendar_next_event'],
    ['don’t forget that my sister has a birthday', 'memory_remember'],
    ['hvor meget protein mangler jeg i dag', 'health_nutrition_suggest'],
    ['gem en note om havplanen', 'vault_write'],
    ['pause the music on my computer', 'pc_media'],
  ])('finds the right tool for "%s"', (query, expected) => {
    expect(top(query).slice(0, 3)).toContain(expected);
  });

  it('keeps an issue request away from the pull request tools', () => {
    expect(top('create an issue for the login bug in Jarvis')[0]).toBe('create_issue');
    expect(top('opret et issue om login-fejlen')[0]).toBe('create_issue');
    expect(top('show issue 12 on github')[0]).toBe('gh_issue_read');
  });

  it.each([
    'huske', 'huskede', 'huskes', 'husk', 'kan du huske at jeg bor i Aarhus', 'du skal huske at jeg har en hund',
    'jeg huskede ikke at sige det', 'det skal huskes', 'huskeregel',
  ])('finds a memory tool for the Danish "%s"', (query) => {
    expect(top(query).slice(0, 3).some((name) => name.startsWith('memory_'))).toBe(true);
  });

  it('puts a request to remember a fact first, and a huskeliste with the tasks', () => {
    expect(top('kan du huske at jeg bor i Aarhus')[0]).toBe('memory_remember');
    expect(top('du skal huske at jeg har en hund')[0]).toBe('memory_remember');
    expect(top('min huskeliste').slice(0, 3)).not.toContain('memory_remember');
  });

  it('does not wait for the Azure bridge for a request that only says group', () => {
    for (const query of ['send til gruppen', 'create a group chat', 'gruppe', 'group']) expect([...providersNamedBy(query)]).toEqual([]);
    for (const query of ['mine ressourcegrupper', 'list the resource group', 'azure group']) expect([...providersNamedBy(query)]).toEqual(['az_']);
  });

  it('ignores words that carry no meaning instead of letting them score long descriptions', () => {
    expect(top('hvad er det')).toEqual([]);
    expect(top('what is it')).toEqual([]);
    expect(top('12')).toEqual([]);
  });

  it('ranks a tool named exactly in the query first', () => {
    expect(top('az_group_resource_list')[0]).toBe('az_group_resource_list');
    expect(top('please run get_usage now')[0]).toBe('get_usage');
  });

  it('lets a verb count only next to its noun: "tick off" and "rename" mean a vault task only when a task is named', () => {
    const tasks = ['vault_task_complete', 'vault_task_edit', 'vault_write', 'create_task', 'cancel_task'];
    const ranked = (query: string) => searchJarvisTools({
      list: () => tasks.map((name) => ({ name, description: `Tool ${name}.`, inputSchema: { type: 'object' } }) as RegisteredTool), get: () => undefined,
    }, query, () => true).map((tool) => tool.name);
    expect(ranked('tick off the milk task')[0]).toBe('vault_task_complete');
    expect(ranked('rename the milk task')[0]).toBe('vault_task_edit');
    // Without the noun the verb alone names no tool, and next to a note it edits the note.
    expect(ranked('tick off the milk')).toEqual([]);
    expect(ranked('add this to my note')[0]).toBe('vault_write');
  });

  it('names a remote provider only for its own words or tool prefix', () => {
    expect([...providersNamedBy('github issue')]).toEqual(['gh_']);
    expect([...providersNamedBy('ressourcer i azure')]).toEqual(['az_']);
    expect([...providersNamedBy('az_group_list')]).toEqual(['az_']);
    expect([...providersNamedBy('gh_issue_read')]).toEqual(['gh_']);
    expect([...providersNamedBy('weather kalender noter mail report')]).toEqual([]);
  });

  it.each([
    'github-issues', 'GitHub issues', 'pull-request', 'pull request', 'pullrequest', 'PR list', 'my PRs', 'list commits',
    'commits in jarvis', 'branches', 'åbne pull requests', 'vis pullanmodninger', 'mine issues på github', 'git-hub',
  ])('names GitHub for "%s"', (query) => {
    expect([...providersNamedBy(query)]).toEqual(['gh_']);
  });

  it.each([
    'azure-resources', 'az-resources', 'resource-group', 'resource group', 'container-app', 'container app',
    'ressourcegruppe', 'ressourcegruppen', 'mine ressourcer', 'abonnement',
  ])('names Azure for "%s"', (query) => {
    expect([...providersNamedBy(query)]).toEqual(['az_']);
  });

  it.each([
    'what is on my calendar', 'remind me in 5 minutes', 'hvad er i min kalender', 'påmind mig om fem minutter',
    'list my tasks', 'e-mail from Anna', 'weather in Aarhus', 'show the report',
  ])('names no provider for the local query "%s"', (query) => {
    expect([...providersNamedBy(query)]).toEqual([]);
  });
});
