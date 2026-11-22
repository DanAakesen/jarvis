import assert from 'node:assert/strict';
import test from 'node:test';
import { isWorkspaceCommand, workspaceCommandProblems } from './index.js';

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
