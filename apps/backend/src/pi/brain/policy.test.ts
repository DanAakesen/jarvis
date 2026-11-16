import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isCurrentAssistantTool } from '../../core/tool-registry.js';
import { brainMayRun, brainOnlyTools, brainSeesTool } from './policy.js';

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [readFileSync(path, 'utf8')] : [];
  });
}

describe('what a brain wake may run', () => {
  it('runs plain reads, and refuses everything that needs Dan\'s words or changes something', () => {
    for (const name of ['calendar_today_agenda', 'mail_search', 'vault_read', 'get_work_status', 'list_tasks', 'github_read', 'ci_log']) {
      expect(brainMayRun({ name }, {})).toBe(true);
    }
    for (const name of ['create_issue', 'start_issue', 'create_task', 'steer_task', 'research', 'weather', 'mail_send', 'vault_write', 'vault_task_create',
      'calendar_create_event', 'inbox_capture', 'inbox_close', 'memory_remember', 'github_write', 'update_settings', 'pc_open', 'codex_prompt']) {
      expect(brainMayRun({ name }, {})).toBe(false);
      expect(brainSeesTool(name)).toBe(false);
    }
  });

  it('classifies a call by its operation, so a tool that can both read and write only reads', () => {
    const tool = { name: 'inbox_items', execution: { defaultEffect: 'action' as const, operation: { field: 'operation', effects: { list: 'read' as const, revoke: 'action' as const } } } };
    expect(brainMayRun(tool, { operation: 'list' })).toBe(true);
    expect(brainMayRun(tool, { operation: 'revoke' })).toBe(false);
    expect(brainMayRun(tool, { operation: 'unknown' })).toBe(false);
    expect(brainMayRun(tool, {})).toBe(false);
    expect(brainMayRun({ name: 'inbox_items', execution: { defaultEffect: 'action' } }, {})).toBe(false);
    expect(brainMayRun({ name: 'inbox_items', execution: { defaultEffect: 'read' } }, {})).toBe(true);
  });

  it('keeps the brain-only tools out of chat and voice, and in reach of a wake', () => {
    for (const name of brainOnlyTools) {
      expect(isCurrentAssistantTool(name)).toBe(false);
      expect(brainSeesTool(name)).toBe(true);
      expect(brainMayRun({ name }, {})).toBe(true);
    }
  });

  it('only names tools that exist, so a rename cannot silently shrink what the brain can read', () => {
    const code = sources(new URL('../..', import.meta.url).pathname).join('\n');
    const listed = readFileSync(new URL('./policy.ts', import.meta.url), 'utf8');
    const block = /brainReadTools[^[]*\[([\s\S]*?)\]\);/u.exec(listed)![1]!;
    const names = [...block.matchAll(/'([a-z_]+)'/gu)].map((match) => match[1]!);
    expect(names.length).toBeGreaterThan(30);
    for (const name of names) expect(code, name).toMatch(new RegExp(`['"]${name}['"]`, 'u'));
  });
});
