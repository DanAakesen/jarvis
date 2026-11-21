import { expect } from 'vitest';
import { parseTodosWithContext } from '../../../proactive/todo-file.js';
import type { ToolCase } from '../types.testkit.js';
import { calendarDay, inboxIds, personalTasks, workTasks, type NotesFixtures } from './notes-fixtures.testkit.js';

type Json = Record<string, unknown>;
const record = (value: unknown): Json => value as Json;

/**
 * Arguments (or a message) computed at the moment the call is made, from the stores as the earlier calls left them. A case that
 * must name a version, a line or a reminder id reads it here, so it stays valid whatever ran before it and when it runs again.
 */
export function live<T extends Json>(build: () => T): T {
  return new Proxy({} as T, {
    ownKeys: () => Reflect.ownKeys(build()),
    getOwnPropertyDescriptor: (_target, key) => (key in build() ? { enumerable: true, configurable: true, value: build()[key as keyof T] } : undefined),
    get: (_target, key) => build()[key as keyof T],
    has: (_target, key) => key in build(),
  });
}

/** What the vault says about one task right now: the exact path, line, text and version a task write has to quote. */
export function taskIdentity(fixtures: NotesFixtures, path: string, find: number | string) {
  const todos = parseTodosWithContext(fixtures.vault.files.get(path) ?? '', path);
  const todo = todos.find((candidate) => typeof find === 'number' ? candidate.line === find : candidate.text === find);
  return { path, line: todo?.line ?? 1, text: todo?.text ?? `no task ${String(find)} in ${path}`, version: todo?.version ?? '0'.repeat(64) };
}

export const hours = (count: number) => new Date(Date.now() + count * 3_600_000).toISOString();

export function buildNotesCases(fixtures: NotesFixtures): Readonly<Record<string, readonly ToolCase[]>> {
  const { vault, memory, reminders, findingIds } = fixtures;
  const task = (path: string, find: number | string) => taskIdentity(fixtures, path, find);
  const reminderId = (title: string) => reminders.snapshot().find((schedule) => schedule.taskTitle === title)?.id ?? `no reminder for ${title}`;
  const unknownFinding = '00000000-0000-4000-8000-000000000001';
  const note = (path: string, reason = 'Dan asked to save a note') => ({ path, reason, automaticCapture: false });

  return {
    // ---- Personal Memory ------------------------------------------------------------------------------------------------------
    memory_remember: [
      {
        label: 'saves a preference Dan asked to remember', ownerMessage: 'Remember that I drink tea at four in the afternoon',
        arguments: { category: 'preference', key: 'tea-time', content: 'Dan drinks tea at four in the afternoon.' },
        check: (result) => { expect(record(result)).toMatchObject({ category: 'preference', key: 'tea-time', changed: true, searchMode: 'vector' }); },
      },
      {
        label: 'the same memory again is already remembered', ownerMessage: 'Remember that I drink tea at four in the afternoon',
        arguments: { category: 'preference', key: 'tea-time', content: 'Dan drinks tea at four in the afternoon.' },
        check: (result) => { expect(record(result)).toMatchObject({ changed: false }); },
      },
      {
        label: 'saves a clearly stated fact without being asked (automatic capture is on in the default settings)',
        ownerMessage: 'I always book the window seat on the train',
        arguments: { category: 'preference', key: 'train-seat', content: 'Dan books the window seat on the train.', sourceIntent: 'automatic' },
      },
      {
        label: 'a key with spaces is refused in plain words', expect: 'refused', ownerMessage: 'Remember that I like tea',
        arguments: { category: 'preference', key: 'tea time', content: 'Dan likes tea.' },
      },
    ],
    memory_correct: [
      {
        label: 'corrects a project fact after Dan corrected it', ownerMessage: 'Actually the Jarvis backend now runs in Sweden Central',
        arguments: { memoryId: '2', content: 'The Jarvis backend runs on Azure Container Apps in Sweden Central.' },
        check: (result) => { expect(record(result)).toMatchObject({ id: '2', key: 'jarvis-hosting', revision: 2, changed: true }); },
      },
      { label: 'an unknown memory id is refused', expect: 'refused', arguments: { memoryId: '999', content: 'Anything at all.' } },
    ],
    memory_forget: [
      {
        label: 'forgets the bike memory', ownerMessage: 'Forget that I need to service the bike', arguments: { memoryId: '4' },
        check: (result) => { expect(record(result)).toMatchObject({ id: '4', key: 'bike-service' }); expect(memory.records.has('4')).toBe(false); },
      },
      { label: 'a memory that is already gone is refused', expect: 'refused', ownerMessage: 'Forget that I need to service the bike', arguments: { memoryId: '4' } },
    ],
    memory_history: [
      {
        label: 'shows both versions of a corrected memory', arguments: { memoryId: '3' },
        check: (result) => { expect(record(result).versions).toHaveLength(2); },
      },
      { label: 'an unknown memory id is refused', expect: 'refused', arguments: { memoryId: '999' } },
    ],
    memory_list: [
      { label: 'lists the saved memories', arguments: {}, check: (result) => { expect(record(result).count).toBeGreaterThanOrEqual(3); } },
      { label: 'a short page says there is more', arguments: { limit: 2 }, check: (result) => { expect(record(result)).toMatchObject({ count: 2, hasMore: true }); } },
    ],
    memory_search: [
      {
        label: 'finds what Dan said about coffee', arguments: { query: 'coffee' },
        check: (result) => { expect(record(result)).toMatchObject({ method: 'vector' }); expect(record((record(result).memories as unknown[])[0]).key).toBe('coffee'); },
      },
      { label: 'a question in other words still answers', arguments: { query: 'where do my notes live' } },
    ],

    // ---- Vault notes ----------------------------------------------------------------------------------------------------------
    vault_read: [
      {
        label: 'reads a note', arguments: { path: 'Personal/Reading list.md' },
        check: (result) => { expect(record(result)).toMatchObject({ path: 'Personal/Reading list.md', sha: vault.shaOf('Personal/Reading list.md') }); },
      },
      { label: 'a note that does not exist is refused', expect: 'refused', arguments: { path: 'Personal/No such note.md' } },
      { label: 'a path that is not Markdown is refused', expect: 'refused', arguments: { path: 'Personal/notes.txt' } },
    ],
    vault_search: [
      {
        label: 'finds a note by meaning', arguments: { query: 'reading list' },
        check: (result) => { expect(record((record(result).results as unknown[])[0]).path).toBe('Personal/Reading list.md'); },
      },
      { label: 'limits the number of notes', arguments: { query: 'garden', k: 2 }, check: (result) => { expect(Number(record(result).count)).toBeLessThanOrEqual(2); } },
      { label: 'lists the open tasks', arguments: { kind: 'tasks' }, check: (result) => { expect(Number(record(result).total)).toBeGreaterThanOrEqual(5); } },
      {
        label: 'lists what is due in a week', arguments: { kind: 'tasks', dueWindowDays: 7 },
        check: (result) => { expect((record(result).items as Json[]).map((item) => item.text)).toContain('Call the dentist'); },
      },
      {
        label: 'finds a task by its words, done or not', arguments: { kind: 'tasks', query: 'bike', state: 'all' },
        check: (result) => { expect(record(result).total).toBe(1); },
      },
      { label: 'a note search without words is refused in plain words', expect: 'refused', arguments: { kind: 'notes' } },
    ],
    show_knowledge: [
      {
        label: 'opens the knowledge graph on the matching notes', arguments: { query: 'reading list' },
        check: (result) => {
          expect(record(result)).toMatchObject({ type: 'generated-view' });
          expect(fixtures.recordedGraphs.at(-1)?.query).toBe('reading list');
        },
      },
    ],
    vault_write: [
      {
        label: 'creates a note', arguments: { ...note('Personal/Conformance note.md'), content: '# Conformance note\n\nA first draft.\n' },
        check: (result) => { expect(record(result).path).toBe('Personal/Conformance note.md'); expect(vault.files.get('Personal/Conformance note.md')).toContain('first draft'); },
      },
      {
        label: 'appends to the note', arguments: { ...note('Personal/Conformance note.md'), append: '\nA second line.\n' },
        check: () => { expect(vault.files.get('Personal/Conformance note.md')).toContain('second line'); },
      },
      {
        label: 'replaces the note with the sha it has now',
        arguments: live(() => ({ ...note('Personal/Conformance note.md'), content: '# Conformance note\n\nRewritten.\n', expectedSha: vault.shaOf('Personal/Conformance note.md') })),
        check: () => { expect(vault.files.get('Personal/Conformance note.md')).toBe('# Conformance note\n\nRewritten.'); },
      },
      {
        label: 'saves a clearly stated fact without being asked', ownerMessage: 'I prefer window seats on trains',
        arguments: { path: 'General/Preferences.md', append: 'Dan prefers window seats on trains.\n', reason: 'Dan stated a preference', automaticCapture: true },
      },
      {
        label: 'a stale sha is a failure that says what to do', expect: 'error',
        arguments: { ...note('Personal/Conformance note.md'), content: '# Conformance note\n\nToo late.\n', expectedSha: '0'.repeat(40) },
      },
      {
        label: 'content and append together are refused', expect: 'refused',
        arguments: { ...note('Personal/Conformance note.md'), content: 'One.', append: 'Two.' },
      },
    ],
    vault_delete: [
      {
        label: 'deletes the old shopping list when Dan asks', ownerMessage: 'Delete my old shopping list', arguments: { path: 'General/Old shopping list.md' },
        check: () => { expect(vault.files.has('General/Old shopping list.md')).toBe(false); },
      },
      { label: 'a note that is already gone is refused', expect: 'refused', ownerMessage: 'Delete my old shopping list', arguments: { path: 'General/Old shopping list.md' } },
    ],

    // ---- Vault tasks ----------------------------------------------------------------------------------------------------------
    vault_task_create: [
      {
        label: 'adds a plain task to the personal inbox', arguments: { text: 'Pick up the parcel' },
        check: (result) => { expect(record(result)).toMatchObject({ text: 'Pick up the parcel', path: personalTasks }); },
      },
      {
        label: 'adds a work task with a day, a time and an exact-time reminder',
        arguments: { text: 'Join the Jarvis demo call', scope: 'work', due: calendarDay(2), time: '10:00', priority: 'high', remindAtDue: true },
        check: (result) => { expect(record(result)).toMatchObject({ path: workTasks, dueDate: calendarDay(2), dueTime: '10:00', remindAtDue: true }); },
      },
      { label: 'a time without a day is refused in plain words', expect: 'refused', arguments: { text: 'Join the demo call', time: '10:00' } },
    ],
    vault_task_complete: [
      {
        label: 'completes a task', arguments: live(() => ({ ...task(personalTasks, 4), done: true })),
        check: (result) => { expect(record(result)).toMatchObject({ text: 'Renew the library books', done: true }); },
      },
      {
        label: 'reopens it', arguments: live(() => ({ ...task(personalTasks, 4), done: false })),
        check: (result) => { expect(record(result)).toMatchObject({ done: false }); },
      },
      { label: 'a task that changed since it was read is refused', expect: 'refused', arguments: { ...task(personalTasks, 4), version: 'f'.repeat(64), done: true } },
    ],
    vault_task_edit: [
      {
        label: 'moves a task to another day and raises its priority',
        arguments: live(() => ({ ...task(personalTasks, 5), newText: task(personalTasks, 5).text, due: calendarDay(5), priority: 'high' })),
        check: (result) => { expect(record(result)).toMatchObject({ text: 'Send the quarterly report', dueDate: calendarDay(5), priority: 'high' }); },
      },
      {
        label: 'rewords a task', arguments: live(() => ({ ...task(workTasks, 4), newText: 'Book a room for the Jarvis demo' })),
        check: (result) => { expect(record(result)).toMatchObject({ text: 'Book a room for the Jarvis demo' }); },
      },
      {
        label: 'a task that changed since it was read is refused', expect: 'refused',
        arguments: { ...task(personalTasks, 5), version: 'f'.repeat(64), newText: 'Send the quarterly report' },
      },
    ],

    // ---- Inbox ----------------------------------------------------------------------------------------------------------------
    inbox_capture: [
      {
        label: 'saves an idea with a note', ownerMessage: 'I should compare bike lights for the winter',
        arguments: { title: 'Compare bike lights for winter', note: 'Dan wants brighter lights before the dark months.' },
        check: (result) => { expect(record(result)).toMatchObject({ title: 'Compare bike lights for winter', created: true }); },
      },
      {
        label: 'the same message and title again returns the existing item', ownerMessage: 'I should compare bike lights for the winter',
        arguments: { title: 'Compare bike lights for winter', note: 'Dan wants brighter lights before the dark months.' },
        check: (result) => { expect(record(result)).toMatchObject({ created: false }); },
      },
      { label: 'a blank title is refused in plain words', expect: 'refused', arguments: { title: '   ' } },
    ],
    inbox_close: [
      {
        label: 'closes an item when Dan says so', ownerMessage: 'Bin the garden beds idea',
        arguments: { id: inboxIds.gardenBeds, reason: 'Dan said to bin it' },
        check: (result) => { expect(record(result)).toMatchObject({ title: 'Plan the garden beds' }); },
      },
      {
        label: 'an item that is already closed is refused', expect: 'refused', ownerMessage: 'Bin the garden beds idea',
        arguments: { id: inboxIds.gardenBeds, reason: 'Dan said to bin it' },
      },
    ],
    inbox_items: [
      { label: 'lists the open items', arguments: {}, check: (result) => { expect(Number(record(result).count)).toBeGreaterThanOrEqual(2); } },
      { label: 'finds an item by its words', arguments: { query: 'desk' }, check: (result) => { expect(record(result).count).toBe(1); } },
      { label: 'also shows what was closed', arguments: { includeClosed: true }, check: (result) => { expect((record(result).items as Json[]).some((item) => item.closed === true)).toBe(true); } },
      {
        label: 'reads one item in full', arguments: { id: inboxIds.standingDesk },
        check: (result) => { expect(record(record(result).item).content).toContain('standing desk'); },
      },
      { label: 'an unknown id is refused', expect: 'refused', arguments: { id: 'deadbeef' } },
    ],

    // ---- Proactive findings and owner reminders -------------------------------------------------------------------------------
    proactive_recent_items: [
      { label: 'reads the new findings', arguments: {}, check: (result) => { expect(Number(record(result).count)).toBeGreaterThanOrEqual(1); } },
      { label: 'reads every finding', arguments: { state: 'all', limit: 5 }, check: (result) => { expect(record(result).count).toBe(3); } },
    ],
    proactive_preferences: [
      { label: 'explains what can be changed', arguments: { operation: 'help' } },
      { label: 'reads the current preferences', arguments: { operation: 'read' } },
      { label: 'pauses suggestions', arguments: { operation: 'update', paused: true }, check: (result) => { expect(record(result)).toMatchObject({ saved: true, paused: true }); } },
      { label: 'resumes suggestions', arguments: { operation: 'update', paused: false }, check: (result) => { expect(record(result)).toMatchObject({ saved: true, paused: false }); } },
      { label: 'turns one category off', arguments: { operation: 'update', categories: { news: false } }, check: (result) => { expect(record(result)).toMatchObject({ saved: true }); } },
      { label: 'turns it on again', arguments: { operation: 'update', categories: { news: true } } },
      { label: 'limits suggestions to work', arguments: { operation: 'update', suggestionScope: 'work' } },
      { label: 'allows suggestions about everything again', arguments: { operation: 'update', suggestionScope: 'all' } },
      { label: 'an update that changes nothing named is refused in plain words', expect: 'refused', arguments: { operation: 'update' } },
    ],
    proactive_item_feedback: [
      {
        label: 'a finding that does not exist is refused', expect: 'refused',
        ownerMessage: `dismiss ${unknownFinding}`, arguments: { itemId: unknownFinding, action: 'dismiss' },
      },
      {
        label: 'marks a finding seen when Dan says so',
        get ownerMessage() { return `mark ${findingIds[0]} as seen`; },
        arguments: live(() => ({ itemId: findingIds[0] ?? unknownFinding, action: 'seen' })),
        check: (result) => { expect(record(result)).toMatchObject({ saved: true, state: 'seen' }); },
      },
    ],
    owner_reminders: [
      { label: 'lists the reminders', arguments: { operation: 'read' }, check: (result) => { expect((record(result).reminders as unknown[]).length).toBeGreaterThanOrEqual(2); } },
      {
        label: 'sets a reminder for an open task', ownerMessage: 'Remind me in two hours to call the dentist',
        arguments: live(() => ({ operation: 'create', task: 'Call the dentist', fireAt: hours(2) })),
        check: (result) => { expect(record(result)).toMatchObject({ operation: 'create', created: true }); },
      },
      {
        label: 'moves a reminder and makes it repeat daily',
        arguments: live(() => ({ operation: 'update', id: reminderId('Send the quarterly report'), task: 'Send the quarterly report', fireAt: hours(26), cadence: 'daily' })),
        check: (result) => { expect(record(result)).toMatchObject({ operation: 'update', updated: true }); },
      },
      {
        label: 'snoozes a reminder',
        arguments: live(() => ({ operation: 'snooze', id: reminderId('Call the dentist'), task: 'Call the dentist', fireAt: hours(3) })),
        check: (result) => { expect(record(result)).toMatchObject({ operation: 'snooze', updated: true }); },
      },
      {
        label: 'cancels a reminder',
        arguments: live(() => ({ operation: 'cancel', id: reminderId('Pay the electricity bill'), task: 'Pay the electricity bill' })),
        check: (result) => { expect(record(result)).toMatchObject({ operation: 'cancel', cancelled: true }); },
      },
      {
        label: 'a time in the past is refused in plain words', expect: 'refused',
        arguments: { operation: 'create', task: 'Call the dentist', fireAt: '2020-01-01T10:00:00.000Z' },
      },
      {
        label: 'a task that is not open is refused in plain words', expect: 'refused',
        arguments: live(() => ({ operation: 'create', task: 'Renew the bike lock', fireAt: hours(2) })),
      },
    ],
  };
}
