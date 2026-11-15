import { describe, expect, it, vi } from 'vitest';
import { applyGymLogOperation, createGymLogWriter, type GymLogOperation } from '../health/gym/gym-log.js';
import { createMemoryProactiveStore } from '../proactive/store.js';
import { createMemoryProactiveTodoReceiptStore } from '../proactive/todo-store.js';
import { createProactiveTodoWriter } from '../proactive/todo-writer.js';
import type { FindingsStoredContext } from '../proactive/engine.js';
import { taskWriteHelpers } from './index.js';
import { gymLogNotePaths, isCurrentVaultLayout, resolveVaultPath, taskInboxPaths } from './layout.js';
import { createTaskWriter } from './task-writes.js';

type Files = Map<string, string>;

function memoryVault(initial: Record<string, string>) {
  const files: Files = new Map(Object.entries(initial));
  const sha = (path: string) => (path.length.toString(16).padStart(2, '0') + 'a'.repeat(40)).slice(0, 40);
  return {
    files,
    tree: vi.fn(async () => [...files.keys()].map((path) => ({ path }))),
    read: vi.fn(async (path: string) => files.has(path) ? { path, sha: sha(path), content: files.get(path)! } : null),
    write: vi.fn(async (path: string, content: string) => { files.set(path, content); return 'c'.repeat(40); }),
  };
}

const signal = new AbortController().signal;
const layouts = {
  legacy: { 'Personal/Inbox.md': '# Inbox\n\n- [ ] one\n', 'Work/Inbox.md': '# Inbox\n\n- [ ] two\n' },
  current: { 'Personal/Task inbox.md': '# Inbox\n\n- [ ] one\n', 'Work/Task inbox.md': '# Inbox\n\n- [ ] two\n' },
} as const;

describe('vault layout paths', () => {
  it('prefers an existing current note, then the legacy one', async () => {
    const both = memoryVault({ ...layouts.legacy, ...layouts.current });
    expect(await resolveVaultPath(taskInboxPaths('Personal'), both, signal)).toBe('Personal/Task inbox.md');
    const legacy = memoryVault(layouts.legacy);
    expect(await resolveVaultPath(taskInboxPaths('Work'), legacy, signal)).toBe('Work/Inbox.md');
    expect(legacy.tree).not.toHaveBeenCalled();
  });

  it('starts a missing note at the current path only when the current layout is detected', async () => {
    const paths = gymLogNotePaths('2026-11-15.md');
    expect(await resolveVaultPath(paths, memoryVault({ 'Personal/Inbox.md': '' }), signal)).toBe('Health/Gym log/2026-11-15.md');
    expect(await resolveVaultPath(paths, memoryVault({ 'Work/Task inbox.md': '' }), signal)).toBe('Personal/Health/Gym log/2026-11-15.md');
    expect(isCurrentVaultLayout(['_agent-activity/README.md'])).toBe(true);
    expect(isCurrentVaultLayout(['_agent-log/README.md', 'Personal/Inbox.md'])).toBe(false);
  });
});

describe.each(['legacy', 'current'] as const)('task creation in the %s layout', (layout) => {
  const inbox = layout === 'legacy' ? 'Personal/Inbox.md' : 'Personal/Task inbox.md';

  function writer(vault: ReturnType<typeof memoryVault>) {
    return createTaskWriter({ ...taskWriteHelpers, client: vault as never, onWrite: () => {}, log: () => {} });
  }

  it('appends to the existing inbox and creates no second one', async () => {
    const vault = memoryVault(layouts[layout]);
    const result = await writer(vault).create({ text: 'Buy milk' }, signal);
    expect(result.path).toBe(inbox);
    expect(vault.files.get(inbox)).toContain('- [ ] Buy milk');
    expect([...vault.files.keys()].filter((path) => /Inbox\.md$|Task inbox\.md$/u.test(path))).toHaveLength(2);
  });

  it('creates a missing work inbox where the vault layout says', async () => {
    const vault = memoryVault({ [inbox]: '# Inbox\n' });
    const result = await writer(vault).create({ text: 'Plan sprint', scope: 'work' }, signal);
    expect(result.path).toBe(layout === 'legacy' ? 'Work/Inbox.md' : 'Work/Task inbox.md');
  });
});

describe.each(['legacy', 'current'] as const)('gym log in the %s layout', (layout) => {
  const folder = layout === 'legacy' ? 'Health/Gym log' : 'Personal/Health/Gym log';
  const liftId = '11111111-1111-4111-8111-111111111111';
  const operation: GymLogOperation = { type: 'upsert-lift', lift: {
    id: liftId, workoutId: null, exerciseName: 'Squat', weightKg: 80, reps: 5, sets: 3,
  } };

  it('writes the day note to one folder and then updates the same note', async () => {
    const vault = memoryVault(layouts[layout]);
    const gym = createGymLogWriter({ vault: vault as never });
    expect(await gym.apply('2026-11-15', operation, signal)).toBe('written');
    expect([...vault.files.keys()].filter((path) => path.includes('Gym log'))).toEqual([`${folder}/2026-11-15.md`]);
    const first = vault.files.get(`${folder}/2026-11-15.md`);
    expect(first).toBeDefined();
    expect(await gym.apply('2026-11-15', operation, signal)).toBe('unchanged');
    expect(applyGymLogOperation(first!, '2026-11-15', operation)).toBe(first);
  });

  it('keeps updating a note that already lives in the other folder', async () => {
    const other = layout === 'legacy' ? 'Personal/Health/Gym log' : 'Health/Gym log';
    const vault = memoryVault({ [`${other}/2026-11-15.md`]: applyGymLogOperation(null, '2026-11-15', operation) });
    await createGymLogWriter({ vault: vault as never }).apply('2026-11-15', { type: 'remove-lift', id: liftId }, signal);
    expect([...vault.files.keys()].filter((path) => path.includes('Gym log'))).toEqual([`${other}/2026-11-15.md`]);
  });
});

describe.each(['legacy', 'current'] as const)('proactive todos in the %s layout', (layout) => {
  const inbox = layout === 'legacy' ? 'Personal/Inbox.md' : 'Personal/Task inbox.md';

  it('adds the suggestion to the existing personal inbox', async () => {
    const vault = memoryVault(layouts[layout]);
    const writer = createProactiveTodoWriter({
      vault: vault as never, store: createMemoryProactiveStore(), receipts: createMemoryProactiveTodoReceiptStore(),
    });
    const context: FindingsStoredContext = {
      runId: 'run-1', trigger: 'manual', now: new Date('2026-11-15T12:00:00Z'), signal,
      findings: [{
        itemId: 'item-1', dedupeKey: 'key-1', evidenceRefs: ['f1'], category: 'prep', suggestionScope: 'personal',
        urgency: 'soon', dueAt: null, dueHasTime: false, highPriority: false, suggestedTodo: 'Pack the gym bag',
      }],
      facts: [{ ref: 'f1', identity: 'fact-1', taskScope: 'personal', source: 'calendar', kind: 'event', text: 'Gym session' }],
      sources: [],
    } as unknown as FindingsStoredContext;
    await writer(context);
    expect(vault.write).toHaveBeenCalledTimes(1);
    expect(vault.write.mock.calls[0]![0]).toBe(inbox);
    expect(vault.files.get(inbox)).toContain('(proactive) Pack the gym bag');
  });
});
