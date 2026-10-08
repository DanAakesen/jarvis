import { describe, expect, it } from 'vitest';
import { workspaceNavigationPages, workspaceSettingsSections } from '@jarvis/contracts';
import { capabilityInstructions } from './capability-instructions.js';

describe('shared navigation capability instructions', () => {
  it.each([true, false])('includes canonical destinations and aliases with automatic capture %s', (automaticCapture) => {
    const instructions = capabilityInstructions({ automaticCapture });
    expect(instructions).toContain('workspace_command with operation "navigate"');
    for (const page of workspaceNavigationPages) expect(instructions).toContain(`"${page}"`);
    for (const section of workspaceSettingsSections) expect(instructions).toContain(`"${section}"`);
    for (const alias of ['Kanban', 'board', 'factory', 'tasks', 'Software Factory', 'Go home', 'back to Jarvis']) {
      expect(instructions).toContain(`"${alias}"`);
    }
    expect(instructions).toContain('section is settings-only; taskId and issueNumber are factory-only');
    expect(instructions).toContain('issueNumber as a positive integer');
    expect(instructions).toContain('task recipes means "routines"');
    expect(instructions).not.toContain('"knowledge-graph"');
    expect(instructions).toContain('never claim navigation succeeded on send');
    expect(instructions).toContain('Only report it applied after the tool succeeds');
    expect(instructions).toContain('"This" or "that" refers to the focused workspace window');
    expect(instructions).toContain('"Go back" means navigate to view.previous');
    expect(instructions).toContain('If view.previous is unavailable, ask Dan');
    expect(instructions).toContain('If no snapshot or focus is available, say so');
    expect(instructions).toContain('The Folio is a pane');
    expect(instructions).toContain('The UI still refuses Status until its page exists');
    expect(instructions).not.toContain('refuses Folio and Status');
  });
});
