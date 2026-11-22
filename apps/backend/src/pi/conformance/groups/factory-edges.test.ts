import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { coreModule } from '../../../core/index.js';
import type { OwnerInteractionService } from '../../../core/owner-interactions.js';
import { factoryModule } from '../../../factory/index.js';
import { executeCase, turnKindFor } from '../callable.testkit.js';
import type { ConformanceWorld } from '../world.testkit.js';
import { buildConformanceWorld } from '../world.testkit.js';
import type { GroupFactory } from '../types.testkit.js';
import { factoryCases, factoryEdgeCases, factoryGroup } from './factory.testkit.js';

/**
 * What the Factory group's `ok` cases cannot say. The suite reports a tool as `ok` only when every case of it is, so the calls
 * that must be refused (a task that does not exist, a repository that is taken), the Factory tools while GitHub is down, and the
 * Factory tools with no service behind them are checked here, in a world with only the dispatcher (core) and the Factory tools.
 * Every answer must be a typed, plain-English refusal or failure, never the dispatcher's generic "Tool execution failed".
 */
const core: GroupFactory = () => ({ id: 'core', covers: ['core'], modules: [coreModule] });
// Adding a repository and creating a project read the settings and ask the owner-interaction service; the core group owns those.
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

const tool = (name: string) => world.app.jarvisTools.get(name)!;
const firstCase = (name: string) => factoryCases[name]![0]!;

describe('calls that must be refused or fail in plain English', () => {
  const edges = Object.entries(factoryEdgeCases).flatMap(([name, list]) => list.map((edge) => [`${name}: ${edge.label}`, name, edge] as const));
  it.each(edges)('%s', async (_title, name, edge) => {
    const done = await executeCase(world, tool(name), turnKindFor(name), edge);
    expect(done.outcome).toBe(edge.expect);
  });
});

/** Every Factory tool that reaches GitHub, directly or through the GitHub App. */
const githubTools = [
  'create_issue', 'issue_comment', 'start_issue', 'get_deployment_status', 'create_task', 'resume_task', 'repo_overview', 'repo_list', 'repo_read',
  'repo_search', 'repo_issues', 'pr_get', 'pr_diff', 'pr_reviews', 'checks_list', 'ci_log', 'github_capabilities', 'github_read', 'github_write',
  'create_project', 'manage_repository',
];

describe.each([['the network is gone', 'github'], ['GitHub answers 503', 'github-503']] as const)('GitHub is down: %s', (_title, token) => {
  it.each(githubTools.filter((name) => token === 'github' || !['github_capabilities', 'create_project', 'manage_repository'].includes(name)))('%s fails in plain English', async (name) => {
    world.context.down.add(token);
    try {
      const { arguments: args } = firstCase(name);
      const done = await executeCase(world, tool(name), turnKindFor(name), { label: token, arguments: args });
      expect(['refused', 'error'], `${name} answered ${done.outcome} while GitHub was down`).toContain(done.outcome);
    } finally {
      world.context.down.delete(token);
    }
  });

  it('get_work_status still answers, and says the evidence is incomplete', async () => {
    world.context.down.add(token);
    try {
      const done = await executeCase(world, tool('get_work_status'), 'chat', { label: token, arguments: { project: 'Jarvis', issueNumber: 701 } });
      expect(done.outcome).toBe('ok');
      expect(done.result).toMatchObject({ partial: true });
    } finally {
      world.context.down.delete(token);
    }
  });
});

describe('a Factory service is missing', () => {
  let bare: ConformanceWorld;
  const blocked = globalThis.fetch;
  beforeAll(async () => {
    // No stub answers for the bare world: a tool that reached for the network would fail loudly instead of calling out.
    globalThis.fetch = (async () => { throw new TypeError('The conformance suite blocks network calls.'); }) as typeof fetch;
    bare = await buildConformanceWorld({ groups: [core, () => ({ id: 'factory', covers: ['factory'], modules: [factoryModule] })] });
  });
  afterAll(async () => {
    await bare.close();
    globalThis.fetch = blocked;
  });

  // These two read their evidence defensively: they answer, with warnings, when a store is missing.
  const answersAnyway = new Set(['get_work_status', 'list_capabilities']);
  it.each(Object.keys(factoryCases).filter((name) => !answersAnyway.has(name)))('%s says so plainly', async (name) => {
    const { arguments: args } = firstCase(name);
    const done = await executeCase(bare, bare.app.jarvisTools.get(name)!, turnKindFor(name), { label: 'no service', arguments: args });
    expect(['refused', 'error'], `${name} answered ${done.outcome} with no service behind it`).toContain(done.outcome);
  });
});
