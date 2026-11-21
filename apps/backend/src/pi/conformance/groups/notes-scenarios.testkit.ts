import { expect } from 'vitest';
import type { Scenario } from '../types.testkit.js';
import { hours, live, taskIdentity } from './notes-cases.testkit.js';
import { calendarDay, nextWeekday, personalTasks, type NotesFixtures } from './notes-fixtures.testkit.js';

type Json = Record<string, unknown>;
const record = (value: unknown): Json => value as Json;

const gardenNote = 'Personal/Garden plan.md';

/**
 * Dan's daily-core scenarios 2 and 3, one spoken request per step, each answered in one call with no confirmation step. A
 * scenario runs once per language against the same stores, so every step reads what it needs from the vault as it is now.
 */
export function buildNotesScenarios(fixtures: NotesFixtures): readonly Scenario[] {
  const { vault } = fixtures;
  const read = (path: string) => vault.files.get(path) ?? '';
  return [
    {
      id: 'notes',
      title: 'Notes: save, find, read and retitle a note',
      steps: [
        {
          say: { en: 'save a note called Garden plan about the tomato beds', da: 'gem en note der hedder Havplan om tomatbedene' },
          tool: 'vault_write',
          call: {
            label: 'save a note',
            // Append creates the note when it is new, so the same step is valid when the scenario runs a second time.
            arguments: { path: gardenNote, append: '# Garden plan\n\nPlant tomatoes and basil in the south bed in May.\n', reason: 'Dan asked to save a note', automaticCapture: false },
            check: (result) => { expect(record(result).path).toBe(gardenNote); expect(read(gardenNote)).toContain('tomatoes'); },
          },
        },
        {
          say: { en: 'find my note about the garden plan', da: 'find min note om havplanen' },
          tool: 'vault_search',
          call: {
            label: 'find a note', arguments: { query: 'garden plan' },
            check: (result) => { expect((record(result).results as Json[]).map((hit) => hit.path)).toContain(gardenNote); },
          },
        },
        {
          say: { en: 'read my Garden plan note', da: 'læs min note Havplan' },
          tool: 'vault_read',
          call: {
            label: 'read a note', arguments: { path: gardenNote },
            check: (result) => { expect(record(result)).toMatchObject({ path: gardenNote, sha: vault.shaOf(gardenNote) }); },
          },
        },
        {
          say: { en: 'change the title of my Garden plan note to Garden plan 2027', da: 'ret titlen på min note Havplan til Havplan 2027' },
          tool: 'vault_write',
          call: {
            label: 'edit the title',
            // Replacing a note needs the sha a read gave; the case asks the vault for it when the call is made.
            arguments: live(() => ({
              path: gardenNote, content: read(gardenNote).replace(/^# .*$/mu, '# Garden plan 2027'), expectedSha: vault.shaOf(gardenNote),
              reason: 'Dan asked to change the title', automaticCapture: false,
            })),
            check: () => { expect(read(gardenNote)).toMatch(/^# Garden plan 2027$/mu); },
          },
        },
      ],
    },
    {
      id: 'tasks',
      title: 'Tasks: create, complete, edit, what is due today and a reminder',
      steps: [
        {
          say: { en: 'add a task to buy milk tomorrow', da: 'tilføj en opgave om at købe mælk i morgen' },
          tool: 'vault_task_create',
          call: {
            label: 'create a task', arguments: { text: 'Buy milk', due: calendarDay(1) },
            check: (result) => { expect(record(result)).toMatchObject({ text: 'Buy milk', path: personalTasks }); },
          },
        },
        {
          say: { en: 'mark the library books task as done', da: 'marker biblioteksbøgerne som færdige' },
          tool: 'vault_task_complete',
          call: {
            label: 'complete a task', arguments: live(() => ({ ...taskIdentity(fixtures, personalTasks, 4), done: true })),
            check: (result) => { expect(record(result)).toMatchObject({ text: 'Renew the library books', done: true }); },
          },
        },
        {
          say: { en: 'move the milk task to Friday', da: 'flyt mælk-opgaven til fredag' },
          tool: 'vault_task_edit',
          call: {
            label: 'edit a task',
            arguments: live(() => ({ ...taskIdentity(fixtures, personalTasks, 'Buy milk'), newText: 'Buy milk', due: nextWeekday(5) })),
            check: (result) => { expect(record(result)).toMatchObject({ text: 'Buy milk', dueDate: nextWeekday(5) }); },
          },
        },
        {
          say: { en: 'what tasks are due today', da: 'hvilke opgaver skal jeg have lavet i dag' },
          tool: 'vault_search',
          call: {
            label: 'what is due today', arguments: { kind: 'tasks', dueWindowDays: 0 },
            check: (result) => { expect((record(result).items as Json[]).map((item) => item.text)).toContain('Call the dentist'); },
          },
        },
        {
          say: { en: 'remind me in two hours to call the dentist', da: 'påmind mig om to timer om at ringe til tandlægen' },
          tool: 'owner_reminders',
          call: {
            label: 'a reminder', arguments: live(() => ({ operation: 'create', task: 'Call the dentist', fireAt: hours(2) })),
            check: (result) => { expect(record(result)).toMatchObject({ operation: 'create' }); },
          },
        },
      ],
    },
  ];
}
