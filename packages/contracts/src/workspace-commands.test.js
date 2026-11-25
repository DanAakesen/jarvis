import assert from 'node:assert/strict';
import test from 'node:test';
import { isWorkspaceCommand, workspaceCommandProblems, workspaceCommandSchema } from './index.js';

test('the schema the model reads offers only actions and values that some command accepts', () => {
  const { action, value } = workspaceCommandSchema.properties;
  const accepted = (command) => isWorkspaceCommand({ commandId: 'offered', ...command });
  for (const name of action.enum) {
    const commands = [
      { operation: 'conversation', action: name },
      { operation: 'voice-window', action: name },
      { operation: 'context-panel', action: name },
      ...value.enum.map((given) => ({ operation: 'session', action: name, value: given })),
    ];
    assert.ok(commands.some(accepted), `the schema offers action ${name}, but no command accepts it`);
  }
  for (const name of value.enum) {
    assert.ok(['voice', 'camera'].some((action) => accepted({ operation: 'session', action, value: name })),
      `the schema offers value ${name}, but no session command accepts it`);
  }
});

test('relative Voice window commands accept only a phone and a supported action', () => {
  const base = { commandId: 'step', operation: 'voice-window' };
  for (const action of ['previous', 'next', 'close']) {
    assert.ok(isWorkspaceCommand({ ...base, action }));
    assert.ok(isWorkspaceCommand({ ...base, action, target: 'phone' }));
    assert.deepEqual(workspaceCommandProblems({ ...base, action }), []);
  }
  assert.equal(isWorkspaceCommand({ ...base, action: 'next', target: 'all' }), false);
  assert.equal(isWorkspaceCommand({ ...base, action: 'end' }), false);
  assert.equal(isWorkspaceCommand({ ...base, action: 'next', viewId: 'other' }), false);
});

test('a session command other than ending the voice session or setting the camera is refused and names the supported actions', () => {
  const command = { commandId: 'session-language', operation: 'session', action: 'language', value: 'en' };
  assert.equal(isWorkspaceCommand(command), false);
  assert.deepEqual(workspaceCommandProblems(command), [{ path: 'action', problem: 'must be voice or camera' }]);
});

test('the supported session commands have no problems', () => {
  for (const command of [
    { commandId: 'session-voice', operation: 'session', action: 'voice', value: 'end' },
    { commandId: 'session-camera', operation: 'session', action: 'camera', value: 'off' },
  ]) {
    assert.equal(isWorkspaceCommand(command), true);
    assert.deepEqual(workspaceCommandProblems(command), []);
  }
});
