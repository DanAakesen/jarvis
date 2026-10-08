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
  });
});
