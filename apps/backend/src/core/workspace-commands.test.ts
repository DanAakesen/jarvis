import { describe, expect, it } from 'vitest';
import { isWorkspaceReflexOperation, workspaceCommandTool } from './workspace-commands.js';

describe('session commands', () => {
  it('counts only voice and camera as session reflexes', () => {
    expect(isWorkspaceReflexOperation({ operation: 'session', action: 'language', value: 'da' })).toBe(false);
    for (const action of ['voice', 'camera']) expect(isWorkspaceReflexOperation({ operation: 'session', action })).toBe(true);
  });

  it('offers the model no language change in the schema it reads', () => {
    const { action, value } = (workspaceCommandTool.inputSchema as { properties: Record<string, { enum: string[] }> }).properties;
    expect(action!.enum).not.toContain('language');
    expect(value!.enum).not.toContain('da');
    expect(value!.enum).not.toContain('en');
  });
});
