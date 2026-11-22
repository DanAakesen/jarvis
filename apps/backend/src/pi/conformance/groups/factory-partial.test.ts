import { afterAll, describe, expect, it } from 'vitest';
import { coreModule } from '../../../core/index.js';
import type { OwnerInteractionService } from '../../../core/owner-interactions.js';
import type { GitHubIssueClient } from '../../../github/issues.js';
import { buildConformanceWorld } from '../world.testkit.js';
import type { GroupFactory } from '../types.testkit.js';
import { factoryGroup } from './factory.testkit.js';

/**
 * A write that half-worked must be told as it happened. The issue is created, then handing it to its executor fails: the
 * confirmation Dan reads has to keep "created, handoff failed" and not read "Not done".
 */
const core: GroupFactory = () => ({ id: 'core', covers: ['core'], modules: [coreModule] });
const factory: GroupFactory = (context) => {
  const group = factoryGroup(context);
  return {
    ...group,
    appOptions: {
      ...group.appOptions,
      settingsStore: { read: async () => ({}), write: async () => {} },
      ownerInteractions: { runRequested: async (_kind: unknown, _summary: unknown, action: () => Promise<unknown>) => action() } as unknown as OwnerInteractionService,
    },
  };
};
const world = await buildConformanceWorld({ groups: [core, factory] });
afterAll(async () => { await world.close(); });

describe('create_issue when its handoff fails after the issue was created', () => {
  it('tells Dan the issue was created, not that nothing was done', async () => {
    const github = world.app.githubIssueClient as { -readonly [K in keyof GitHubIssueClient]: GitHubIssueClient[K] };
    const addLabels = github.addLabels;
    github.addLabels = async () => { throw new Error('GitHub answered 502'); };
    try {
      world.context.ownerMessage.id = '9101';
      world.context.ownerMessage.text = 'Create an issue for the login redirect bug.';
      const turn = world.client.openTurn();
      await world.client.find(turn, 'create_issue');
      const call = await world.client.call(turn, 'create_issue', { title: 'Fix the login redirect loop', body: 'After signing in the page redirects to itself. Expected: land on Now.' });
      turn.close();
      expect(call.outcome).toBe('error');
      const reply = JSON.parse(call.raw) as { result: { error: string; outcomeUnknown?: boolean }; confirmation: string };
      expect(reply.result.error).toMatch(/^Issue \S+ was created as P11-\d+, but its jarvis handoff could not be confirmed\./u);
      expect(reply.result.outcomeUnknown).toBe(true);
      expect(reply.confirmation).toBe(reply.result.error);
    } finally {
      github.addLabels = addLabels;
    }
  });
});
