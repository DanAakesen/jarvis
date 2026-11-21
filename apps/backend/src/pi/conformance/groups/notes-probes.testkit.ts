import type { ToolCase } from '../types.testkit.js';
import { hours, live, taskIdentity } from './notes-cases.testkit.js';
import { personalTasks, type NotesFixtures } from './notes-fixtures.testkit.js';

/** A call that must be answered with a typed, plain-English refusal or failure (see notes-edges.test.ts). */
export type NotesProbe = ToolCase & { readonly expect: 'refused' | 'error' };

const refused = (label: string, args: Record<string, unknown>, extra: Partial<ToolCase> = {}): NotesProbe =>
  ({ label, arguments: args, expect: 'refused', ...extra });
const failed = (label: string, args: Record<string, unknown>, extra: Partial<ToolCase> = {}): NotesProbe =>
  ({ label, arguments: args, expect: 'error', ...extra });

const missingNote = { path: 'Personal/No such note.md', reason: 'Dan asked to save a note', automaticCapture: false };

/**
 * The calls the group's cases cannot make, because the suite reports a tool as `ok` only when every case of it is: stale versions,
 * made-up ids and paths, and arguments that break a rule between fields. Each one is self-contained (it does not depend on what
 * another call changed), because a probe world starts from the seeds.
 */
export function buildNotesProbes(fixtures: NotesFixtures): Readonly<Record<string, readonly NotesProbe[]>> {
  const unknownFinding = '00000000-0000-4000-8000-000000000001';
  const task = (path: string, line: number) => taskIdentity(fixtures, path, line);
  return {
    memory_remember: [
      refused('a key with spaces', { category: 'preference', key: 'tea time', content: 'Dan likes tea.' }, { ownerMessage: 'Remember that I like tea' }),
    ],
    memory_correct: [refused('a memory id that does not exist', { memoryId: '999', content: 'Anything at all.' })],
    memory_forget: [refused('a memory id that does not exist', { memoryId: '999' }, { ownerMessage: 'Forget that I need to service the bike' })],
    memory_history: [refused('a memory id that does not exist', { memoryId: '999' })],
    vault_read: [
      refused('a note that does not exist', { path: 'Personal/No such note.md' }),
      refused('a path that is not Markdown', { path: 'Personal/notes.txt' }),
    ],
    vault_search: [refused('a note search without words', { kind: 'notes' })],
    vault_write: [
      failed('a stale sha says what to do', { ...missingNote, path: 'Personal/Reading list.md', content: '# Reading list\n\nToo late.', expectedSha: '0'.repeat(40) }),
      failed('replacing a note that does not exist', { ...missingNote, content: '# Nothing\n\nNothing here.', expectedSha: '1'.repeat(40) }),
      refused('content and append together', { ...missingNote, content: 'One.', append: 'Two.' }),
      refused('neither content nor append', { ...missingNote }),
    ],
    vault_delete: [refused('a note that does not exist', { path: 'General/No such note.md' }, { ownerMessage: 'Delete the note about nothing' })],
    vault_task_create: [refused('a time without a day', { text: 'Join the demo call', time: '10:00' })],
    vault_task_complete: [refused('a task that changed since it was read', { ...task(personalTasks, 4), version: 'f'.repeat(64), done: true })],
    vault_task_edit: [refused('a task that changed since it was read', { ...task(personalTasks, 5), version: 'f'.repeat(64), newText: 'Send the quarterly report' })],
    inbox_capture: [refused('a blank title', { title: '   ' })],
    inbox_close: [refused('an item that does not exist', { id: 'deadbeef', reason: 'Dan said to bin it' }, { ownerMessage: 'Bin that idea' })],
    inbox_items: [refused('an item that does not exist', { id: 'deadbeef' })],
    proactive_preferences: [refused('an update that names nothing to change', { operation: 'update' })],
    proactive_item_feedback: [
      refused('a finding that does not exist', { itemId: unknownFinding, action: 'dismiss' }, { ownerMessage: `dismiss ${unknownFinding}` }),
    ],
    owner_reminders: [
      refused('a time in the past', { operation: 'create', task: 'Call the dentist', fireAt: '2020-01-01T10:00:00.000Z' }),
      refused('a task that is not open', live(() => ({ operation: 'create', task: 'Renew the bike lock', fireAt: hours(2) }))),
    ],
  };
}
