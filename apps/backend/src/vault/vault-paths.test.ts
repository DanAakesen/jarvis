import { describe, expect, it, vi } from 'vitest';
import { createGymLogWriter } from '../health/gym/gym-log.js';
import { createMemoryProactiveStore } from '../proactive/store.js';
import { createMemoryProactiveTodoReceiptStore } from '../proactive/todo-store.js';
import { createProactiveTodoWriter } from '../proactive/todo-writer.js';
import type { FindingsStoredContext } from '../proactive/engine.js';
import { taskWriteHelpers } from './index.js';
import { createTaskWriter } from './task-writes.js';

const signal = new AbortController().signal;

function memoryVault(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    tree: vi.fn(async () => [...files.keys()].map((path) => ({ path }))),
    read: vi.fn(async (path: string) => files.has(path) ? { path, sha: 'a'.repeat(40), content: files.get(path)! } : null),
    write: vi.fn(async (path: string, content: string) => { files.set(path, content); return 'c'.repeat(40); }),
  };
}

describe('vault paths', () => {
  it('creates tasks in the Task inbox notes', async () => {
    const vault = memoryVault({ 'Personal/Task inbox.md': '# Inbox\n\n- [ ] one\n' });
    const writer = createTaskWriter({ ...taskWriteHelpers, client: vault as never, onWrite: () => {}, log: () => {} });
    expect((await writer.create({ text: 'Buy milk' }, signal)).path).toBe('Personal/Task inbox.md');
    expect((await writer.create({ text: 'Plan sprint', scope: 'work' }, signal)).path).toBe('Work/Task inbox.md');
    expect([...vault.files.keys()].sort()).toEqual(['Personal/Task inbox.md', 'Work/Task inbox.md']);
  });

  it('writes the gym log under Personal/Health/Gym log', async () => {
    const vault = memoryVault({});
    await createGymLogWriter({ vault: vault as never }).apply('2026-11-15', {
      type: 'upsert-lift', lift: { id: '11111111-1111-4111-8111-111111111111', workoutId: null, exerciseName: 'Squat', weightKg: 80, reps: 5, sets: 3 },
    }, signal);
    expect([...vault.files.keys()]).toEqual(['Personal/Health/Gym log/2026-11-15.md']);
  });

  it('adds proactive todos to the existing Task inbox', async () => {
    const vault = memoryVault({ 'Personal/Task inbox.md': '# Inbox\n\n- [ ] one\n' });
    const writer = createProactiveTodoWriter({
      vault: vault as never, store: createMemoryProactiveStore(), receipts: createMemoryProactiveTodoReceiptStore(),
    });
    await writer({
      runId: 'run-1', trigger: 'manual', now: new Date('2026-11-15T12:00:00Z'), signal,
      findings: [{
        itemId: 'item-1', dedupeKey: 'key-1', evidenceRefs: ['f1'], category: 'prep', suggestionScope: 'personal',
        urgency: 'soon', dueAt: null, dueHasTime: false, highPriority: false, suggestedTodo: 'Pack the gym bag',
      }],
      facts: [{ ref: 'f1', identity: 'fact-1', taskScope: 'personal', source: 'calendar', kind: 'event', text: 'Gym session' }],
      sources: [],
    } as unknown as FindingsStoredContext);
    expect(vault.write.mock.calls[0]![0]).toBe('Personal/Task inbox.md');
    expect(vault.files.get('Personal/Task inbox.md')).toContain('(proactive) Pack the gym bag');
  });
});
