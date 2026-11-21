import type { GroupFactory } from '../types.testkit.js';
import { buildNotesCases } from './notes-cases.testkit.js';
import { createNotesFixtures } from './notes-fixtures.testkit.js';
import { buildNotesScenarios } from './notes-scenarios.testkit.js';

/** Memory, notes (vault), vault tasks, the inbox, owner reminders and proactive findings: golden scenarios 2 and 3. */
export const notesGroup: GroupFactory = (context) => {
  const fixtures = createNotesFixtures(context);
  return {
    id: 'notes',
    covers: ['memory', 'vault', 'inbox', 'proactive'],
    modules: fixtures.modules,
    cases: buildNotesCases(fixtures),
    scenarios: buildNotesScenarios(fixtures),
  };
};
