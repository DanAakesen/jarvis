import type { ConformanceContext, ConformanceGroup, GroupFactory } from '../types.testkit.js';
import { buildNotesCases } from './notes-cases.testkit.js';
import { createNotesFixtures, type NotesFixtures } from './notes-fixtures.testkit.js';
import { buildNotesProbes, type NotesProbe } from './notes-probes.testkit.js';
import { buildNotesScenarios } from './notes-scenarios.testkit.js';

/**
 * Memory, notes (vault), vault tasks, the inbox, owner reminders and proactive findings: golden scenarios 2 and 3. The group's cases
 * are the successful calls; the calls that must be refused or fail (`probes`) run in notes-edges.test.ts, because the suite reports
 * a tool as `ok` only when every case of it is.
 */
export function createNotesGroup(context: ConformanceContext): {
  readonly group: ConformanceGroup; readonly fixtures: NotesFixtures; readonly probes: Readonly<Record<string, readonly NotesProbe[]>>;
} {
  const fixtures = createNotesFixtures(context);
  return {
    fixtures,
    probes: buildNotesProbes(fixtures),
    group: {
      id: 'notes',
      covers: ['memory', 'vault', 'inbox', 'proactive'],
      modules: fixtures.modules,
      cases: buildNotesCases(fixtures),
      scenarios: buildNotesScenarios(fixtures),
    },
  };
}

export const notesGroup: GroupFactory = (context) => createNotesGroup(context).group;
