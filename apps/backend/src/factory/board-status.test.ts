import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isFactoryBoard } from '@jarvis/contracts';
import {
  createFactoryBoard, desiredFactoryBoardStatus, type FactoryBoardIssue, type FactoryBoardSource,
} from './board.js';
import { taskStates } from './task-lifecycle.js';
import type { TaskRecord } from './task-store.js';

const cases = JSON.parse(readFileSync(
  new URL('../../../../.github/scripts/tests/fixtures/project_board_cases.json', import.meta.url),
  'utf8',
)) as {
  name: string;
  issue: { number: number; labels: string[]; blockedBy: number };
  pulls: { body: string; draft: boolean }[];
  status: string;
}[];
const timestamp = '2026-10-16T00:00:00.000Z';
const issue: FactoryBoardIssue = {
  number: 7, url: 'https://github.com/DanAakesen/jarvis/issues/7', title: 'Parked work',
  taskCode: null, labels: ['needs-decision'], worker: null, state: 'open',
  updatedAt: timestamp, closedAt: null, blockedBy: [], blockedByCount: 0, body: null,
};
const pullRequest: FactoryBoardSource['pullRequests'][number] = {
  number: 70, body: 'Refs #7. Preparatory only; Fixes #7 requires later acceptance.',
  url: 'https://github.com/DanAakesen/jarvis/pull/70', draft: true,
};
const task: TaskRecord = {
  id: '81', projectId: '42', originMessageId: null, title: 'Parked task', request: 'Prepare work',
  source: 'board', agent: 'codex', modelOverride: null, reasoningOverride: null, state: 'Paused',
  activity: 'Waiting for approval', priority: 0, attemptCount: 1, nextAttemptAt: null,
  branch: 'jarvis/task-81', createdAt: timestamp, startedAt: timestamp, finishedAt: null,
  latestSessionEndReason: 'idle',
};
const release = { number: pullRequest.number, checks: 'pending' as const, taskId: task.id };

describe('Factory canonical status parity', () => {
  it.each(cases)('$name', (testCase) => {
    expect(desiredFactoryBoardStatus(testCase.issue, testCase.pulls)).toBe(testCase.status);
  });

  it.each(taskStates)('retains Needs Dan and the truthful %s task overlay with a parked draft', (state) => {
    const board = createFactoryBoard(
      task.projectId, 'DanAakesen/jarvis', { issues: [issue], pullRequests: [pullRequest] },
      [{ ...task, state, activity: state === 'Running' ? 'Working' : task.activity }],
      [release], Date.parse(timestamp),
    );
    const card = board.columns.find(({ id }) => id === 'needs_dan')?.cards[0];
    expect(card?.issue).toMatchObject({ number: issue.number, worker: null, labels: ['needs-decision'] });
    expect(card?.pr).toEqual({
      number: pullRequest.number, url: pullRequest.url, draft: true, checks: 'pending',
    });
    expect(card?.task).toEqual({
      id: task.id, state, agent: task.agent,
      activity: state === 'Running' ? 'Working' : task.activity,
      attemptCount: task.attemptCount, branch: task.branch, startedAt: task.startedAt,
      latestSessionEndReason: task.latestSessionEndReason,
    });
    expect(board.columns.flatMap(({ cards }) => cards)).toEqual([card]);
    expect(isFactoryBoard(board)).toBe(true);
  });

  it('keeps an unclaimed parked draft in Needs Dan without a task or release record', () => {
    const board = createFactoryBoard(
      task.projectId, 'DanAakesen/jarvis', { issues: [issue], pullRequests: [pullRequest] },
      [], [], Date.parse(timestamp),
    );
    const card = board.columns.find(({ id }) => id === 'needs_dan')?.cards[0];
    expect(card?.pr).toMatchObject({ draft: true, checks: 'none' });
    expect(card?.task).toBeNull();
    expect(isFactoryBoard(board)).toBe(true);
  });

  it.each(['Codex', 'Copilot', 'Dan', 'Jarvis'] as const)('preserves an actual %s worker claim over Needs Dan', (worker) => {
    const board = createFactoryBoard(
      task.projectId, 'DanAakesen/jarvis',
      { issues: [{ ...issue, worker, labels: [...issue.labels, worker] }], pullRequests: [pullRequest] },
      [{ ...task, state: 'Running', activity: 'Working' }], [release], Date.parse(timestamp),
    );
    expect(board.columns.find(({ id }) => id === 'in_progress')?.cards[0]).toMatchObject({
      issue: { worker }, pr: { draft: true }, task: { state: 'Running', activity: 'Working' },
    });
    expect(isFactoryBoard(board)).toBe(true);
  });

  it.each([
    { name: 'ready', labels: [], pulls: [], state: 'open', column: 'ready' },
    { name: 'deferred', labels: ['deferred'], pulls: [], state: 'open', column: 'backlog' },
    { name: 'draft', labels: [], pulls: [pullRequest], state: 'open', column: 'in_progress' },
    { name: 'review ready', labels: ['needs-decision'], pulls: [{ ...pullRequest, draft: false }], state: 'open', column: 'in_review' },
    { name: 'closed', labels: ['needs-decision'], pulls: [pullRequest], state: 'closed', column: 'done' },
  ] as const)('does not let Running task state override the $name column', ({ labels, pulls, state, column }) => {
    const board = createFactoryBoard(
      task.projectId, 'DanAakesen/jarvis',
      {
        issues: [{ ...issue, labels, state, closedAt: state === 'closed' ? timestamp : null }],
        pullRequests: pulls,
      },
      [{ ...task, state: 'Running', activity: 'Working' }], [release], Date.parse(timestamp),
    );
    const card = board.columns.find(({ id }) => id === column)?.cards[0];
    expect(card?.issue.number).toBe(issue.number);
    expect(card?.task).toEqual(pulls.length === 0 ? null : expect.objectContaining({
      state: 'Running', activity: 'Working',
    }));
    expect(board.columns.flatMap(({ cards }) => cards)).toEqual([card]);
    expect(isFactoryBoard(board)).toBe(true);
  });
});
