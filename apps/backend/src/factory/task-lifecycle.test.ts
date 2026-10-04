import { describe, expect, it } from 'vitest';
import { canTransitionTask, taskStates, type TaskState } from './task-lifecycle.js';

const allowed: readonly [TaskState, TaskState][] = [
  ['Ready', 'Running'],
  ['Ready', 'Cancelled'],
  ['Running', 'PauseRequested'],
  ['Running', 'NeedsAttention'],
  ['Running', 'Cancelled'],
  ['PauseRequested', 'Running'],
  ['PauseRequested', 'Paused'],
  ['PauseRequested', 'NeedsAttention'],
  ['Paused', 'Running'],
  ['Paused', 'Cancelled'],
  ['NeedsAttention', 'Running'],
];

describe('task lifecycle', () => {
  it.each(allowed)('allows %s → %s', (from, to) => {
    expect(canTransitionTask(from, to)).toBe(true);
  });

  it('allows Done only when completion has been verified', () => {
    expect(canTransitionTask('Running', 'Done')).toBe(false);
    expect(canTransitionTask('Running', 'Done', true)).toBe(true);
  });

  it.each(taskStates.flatMap((from) => taskStates
    .filter((to) => !allowed.some(([allowedFrom, allowedTo]) => allowedFrom === from && allowedTo === to) &&
      !(from === 'Running' && to === 'Done'))
    .map((to) => [from, to] as const)))('rejects %s → %s', (from, to) => {
    expect(canTransitionTask(from, to, true)).toBe(false);
  });
});
