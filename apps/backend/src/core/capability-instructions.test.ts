import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { workspaceNavigationPages, workspaceSettingsSections } from '@jarvis/contracts';
import { capabilityInstructions, CAPABILITY_INSTRUCTIONS_MAX_CODE_POINTS } from './capability-instructions.js';

describe('shared navigation capability instructions', () => {
  it.each([true, false])('includes canonical destinations and aliases with automatic capture %s', (automaticCapture) => {
    const instructions = capabilityInstructions({ automaticCapture });
    expect(instructions).toContain('operation "conversation" and action "show"');
    expect(instructions).toContain('hide the transcript, use action "hide"');
    expect(instructions).toContain('This reversible view change needs no confirmation');
    expect(instructions).toContain('Only report it applied after the tool succeeds');
    expect(instructions).toContain('workspace_command with operation "navigate"');
    for (const page of workspaceNavigationPages) expect(instructions).toContain(`"${page}"`);
    for (const section of workspaceSettingsSections) expect(instructions).toContain(`"${section}"`);
    for (const alias of ['Kanban', 'board', 'factory', 'tasks', 'Software Factory', 'Go home', 'back to Jarvis']) {
      expect(instructions).toContain(`"${alias}"`);
    }
    expect(instructions).toContain('section is settings-only; taskId and issueNumber are factory-only');
    expect(instructions).toContain('use renew_credential with name "codex-login"');
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
    expect(instructions).toContain('For "show me", "visualise", chart or timeline requests');
    expect(instructions).toContain('with the chart or timeline renderer');
    expect(instructions).toContain('Charts support line, bar or area, with 1–5 named series of x/y points and up to 1,000 points total');
    expect(instructions).toContain('Timelines use events in order');
    expect(instructions).toContain('Use a self-contained HTML app view for richer visuals');
    expect(instructions).toContain('read and revise that artifact with the supplied tools instead of creating another');
    expect(instructions).not.toContain('update_html_view');
  });
});

describe('shared capability instruction budget', () => {
  // The hosted chat agent rejects the whole settings payload (and so every text reply) when
  // capabilityInstructions exceeds its limit. agents/jarvis/limits.json is the single source for
  // both services (L129): the agent reads it, and these tests tie the backend to the same file.
  const limits = JSON.parse(readFileSync(
    new URL('../../../../agents/jarvis/limits.json', import.meta.url), 'utf8',
  )) as { capabilityInstructionsMaxCodePoints: number; capabilityInstructionsBudgetCodePoints: number };
  const codePoints = (text: string) => Array.from(text).length;

  it('keeps the budget below the hard limit and the backend constant equal to the shared file', () => {
    expect(CAPABILITY_INSTRUCTIONS_MAX_CODE_POINTS).toBe(limits.capabilityInstructionsMaxCodePoints);
    expect(limits.capabilityInstructionsBudgetCodePoints).toBeLessThan(limits.capabilityInstructionsMaxCodePoints);
  });

  it.each([true, false])('stays within the headroom budget with automatic capture %s', (automaticCapture) => {
    expect(codePoints(capabilityInstructions({ automaticCapture })))
      .toBeLessThanOrEqual(limits.capabilityInstructionsBudgetCodePoints);
  });

  it.each([true, false])('uses only BMP characters so TypeScript and Python count the same with automatic capture %s', (automaticCapture) => {
    const text = capabilityInstructions({ automaticCapture });
    expect(codePoints(text)).toBe(text.length);
  });
});
