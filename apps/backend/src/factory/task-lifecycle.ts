export const taskStates = [
  'Ready',
  'Running',
  'PauseRequested',
  'Paused',
  'NeedsAttention',
  'Done',
  'Cancelled',
] as const;

export type TaskState = typeof taskStates[number];

const transitions: Readonly<Record<TaskState, readonly TaskState[]>> = {
  Ready: ['Running', 'Cancelled'],
  Running: ['PauseRequested', 'NeedsAttention', 'Done', 'Cancelled'],
  PauseRequested: ['Running', 'Paused', 'NeedsAttention'],
  Paused: ['Running', 'Cancelled'],
  NeedsAttention: ['Running', 'Done'],
  Done: [],
  Cancelled: [],
};

export function canTransitionTask(from: TaskState, to: TaskState, completionVerified = false): boolean {
  return transitions[from].includes(to) && (to !== 'Done' || completionVerified);
}
