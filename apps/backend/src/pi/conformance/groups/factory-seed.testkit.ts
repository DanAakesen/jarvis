import { JARVIS_REPOSITORY } from '../../../factory/project-context.js';
import type { Project } from '../../../factory/projects.js';
import type { ReleaseViewRecords } from '../../../factory/release-view.js';
import type { FakeGitHub, FakeItem, FakePull, FakeRepo } from './factory-github.testkit.js';
import { sha, timestamps } from './factory-github.testkit.js';
import type { FakeTaskSeed } from './factory-stores.testkit.js';

/** The seeded world of the Factory conformance group: Dan's projects, their GitHub repositories, tasks and releases. */

export const projectIds = { jarvis: '1', garden: '2', old: '3' } as const;

export function seedProjects(): Project[] {
  const base = { merge_rules: null, sandbox_size: '1x2', tech: 'node', active: true } as const;
  return [
    { ...base, id: projectIds.jarvis, name: 'Jarvis', description: 'Jarvis’s own source code and the Software Factory that builds it.', repo: JARVIS_REPOSITORY, default_branch: 'main', default_agent: 'codex', policy: 'deliver_pr', max_parallel_tasks: 2 },
    { ...base, id: projectIds.garden, name: 'Garden Notes', description: 'A small site with Dan’s plant care notes.', repo: 'DanAakesen/garden-notes', default_branch: 'main', default_agent: 'copilot', policy: 'deliver_pr', max_parallel_tasks: 1 },
    { ...base, id: projectIds.old, name: 'Old Experiments', description: 'Throwaway experiments that can be archived.', repo: 'DanAakesen/old-experiments', default_branch: 'main', default_agent: 'copilot', policy: 'complete_without_deployment', max_parallel_tasks: 1 },
  ];
}

function addIssue(repo: FakeRepo, number: number, title: string, options: { body?: string; labels?: string[]; state?: 'open' | 'closed'; comments?: string[]; pull?: FakePull } = {}): FakeItem {
  const item: FakeItem = {
    number, title, body: options.body ?? `${title}\n\nAcceptance: the change works and the checks pass.`, state: options.state ?? 'open',
    stateReason: options.state === 'closed' ? 'completed' : null, labels: options.labels ?? ['P11', 'enhancement'], assignees: [], user: 'DanAakesen', milestone: null,
    comments: (options.comments ?? []).map((body, index) => ({ id: number * 10 + index, user: 'DanAakesen', body, createdAt: timestamps.middle })),
    createdAt: timestamps.middle, updatedAt: timestamps.late, closedAt: options.state === 'closed' ? timestamps.late : null,
    ...(options.pull ? { pull: options.pull } : {}),
  };
  repo.items.set(number, item);
  repo.nextNumber = Math.max(repo.nextNumber, number + 1);
  return item;
}

function addPull(repo: FakeRepo, number: number, title: string, options: { branch: string; head: number; closes?: number[]; draft?: boolean; merged?: boolean; checks?: { name: string; status: string; conclusion: string | null }[]; threads?: FakePull['threads']; files?: FakePull['files'] }): FakeItem {
  const head = sha(options.head);
  repo.branches.set(options.branch, head);
  repo.commits.push({ sha: head, message: title, author: 'Jarvis', date: timestamps.late, files: (options.files ?? []).map(({ filename, status, additions, deletions }) => ({ filename, status, additions, deletions })) });
  repo.checkRuns.set(head, (options.checks ?? [{ name: 'backend', status: 'completed', conclusion: 'success' }]).map((check, index) => ({ id: number * 10 + index, suiteId: 7000 + number, ...check })));
  const pull: FakePull = {
    head: { ref: options.branch, sha: head }, base: { ref: repo.defaultBranch }, draft: options.draft ?? false, merged: options.merged ?? false,
    mergeSha: options.merged ? sha(0x691) : null, mergeable: options.merged ? null : true, closes: options.closes ?? [], files: options.files ?? [], reviewComments: [], threads: options.threads ?? [],
  };
  return addIssue(repo, number, title, {
    body: `${title}\n\n${(options.closes ?? []).map((issue) => `Fixes #${issue}`).join('\n')}`, labels: [], state: options.merged ? 'closed' : 'open', pull,
  });
}

const jarvisFiles: Record<string, string> = {
  'README.md': '# Jarvis\n\nJarvis is Dan’s personal assistant. This repository holds its backend, web app and iOS app.\n\n## Where things live\n\n- apps/backend: the Fastify backend and the tool registry\n- apps/web: the web app\n- docs: architecture, features and decisions\n',
  'AGENTS.md': '# Agent rules\n\nRun the checks before opening a pull request.\n',
  'PRODUCT.md': '# Product\n\n## Purpose\n\nA personal assistant for Dan.\n',
  'PLAN.md': '# Plan\n\nTestFlight 42 is available for internal testing. [Apple readback](https://github.com/DanAakesen/jarvis/actions/runs/9042).\n\n## Current focus\n\nSoftware Factory tool conformance.\n',
  'DESIGN.md': '# Design\n\n## Look\n\nCalm glass surfaces.\n',
  'docs/features.md': '# Features\n\n## Software Factory\n\n| Feature | Status |\n| --- | --- |\n| Projects | Done |\n| Tasks | Done |\n| Pull request review | Planned |\n',
  'docs/architecture.md': '# Architecture\n\n## Backend\n\nA Fastify backend with a tool registry.\n',
  'docs/decisions.md': '# Decisions\n\n## 2026-11-20\n\nThe Factory builds Jarvis itself.\n',
  'apps/backend/src/factory/tools.ts': 'export const factoryTools = [];\n// Factory tools: create_issue, start_issue and get_work_status.\n',
  'apps/backend/src/index.ts': 'import { factoryModule } from \'./factory/index.js\';\nconsole.info(factoryModule.id);\n',
  'apps/web/src/Now.tsx': 'export function Now() { return null; }\n',
};

const failingLog = [
  '2026-11-21T09:50:01Z ##[group]Run npm test',
  'FAIL src/factory/tools.test.ts > get_task > returns the task',
  'AssertionError: expected \'Running\' to be \'Done\'',
  'Authorization: Bearer abcdef0123456789abcdef',
  'Tests: 1 failed, 41 passed',
  '##[error]Process completed with exit code 1.',
].join('\n');

/** Dan’s repositories on the fake GitHub, with the issues, pull requests, checks and runs the Factory tools read. */
export function seedGitHub(github: FakeGitHub): void {
  const jarvis = github.addRepository(JARVIS_REPOSITORY, { defaultBranch: 'main', isPrivate: true, files: jarvisFiles });
  const mainHead = sha(0x691);
  jarvis.branches.set('main', mainHead);
  jarvis.commits.unshift({ sha: mainHead, message: 'Merge pull request #691 from DanAakesen/jarvis/p11-01', author: 'Dan Aakesen', date: timestamps.late, files: [{ filename: 'apps/web/src/Factory.tsx', status: 'added', additions: 40, deletions: 0 }] });
  for (const [name, color] of [['P11', '5319e7'], ['bug', 'd73a4a'], ['enhancement', 'a2eeef'], ['Jarvis', '0e8a16'], ['Copilot', '1d76db'], ['needs-decision', 'fbca04']] as const) {
    jarvis.labels.set(name.toLowerCase(), { name, color, description: '' });
  }
  jarvis.milestones.push({ number: 1, title: 'November release', state: 'open', dueOn: '2026-11-30T00:00:00Z' });

  addIssue(jarvis, 690, 'P11-01: Ship the first Factory board', { state: 'closed', labels: ['P11', 'Jarvis'] });
  addIssue(jarvis, 700, 'Deploy smoke test issue', { body: 'A fixed issue the deploy smoke check reads.', labels: ['P11'], comments: ['This issue must stay open.'] });
  addIssue(jarvis, 701, 'P11-02: Show running work in the Now view', { labels: ['P11', 'Jarvis', 'enhancement'] });
  addIssue(jarvis, 702, 'P11-03: Add a quiet mode to the chat', { labels: ['P11'] });
  addIssue(jarvis, 703, 'P11-04: Tidy the settings page', { labels: ['P11'] });
  addIssue(jarvis, 704, 'P11-05: Fix the login redirect loop', { labels: ['P11', 'bug'], body: 'After signing in the browser keeps redirecting between the sign-in page and the chat.' });
  addIssue(jarvis, 710, 'P11-10: Group the settings by area', { labels: ['P11', 'Jarvis'] });
  addIssue(jarvis, 711, 'P11-11: Export a chat as markdown', { labels: ['P11', 'Jarvis'] });
  addIssue(jarvis, 712, 'P11-12: Retry the sandbox start', { labels: ['P11', 'Jarvis'] });
  addIssue(jarvis, 713, 'P11-13: Long refactor of the reminders list', { labels: ['P11', 'Jarvis'] });
  addIssue(jarvis, 714, 'P11-14: Tune the reminders list', { labels: ['P11', 'Jarvis'] });
  addIssue(jarvis, 715, 'P11-15: Improve the search results', { labels: ['P11', 'Jarvis'] });
  addIssue(jarvis, 716, 'Throwaway issue for write checks', { labels: ['bug'] });

  addPull(jarvis, 691, 'P11-01: Ship the first Factory board', { branch: 'jarvis/p11-01', head: 0xb01, closes: [690], merged: true });
  addPull(jarvis, 705, 'P11-02: Show running work in the Now view', {
    branch: 'jarvis/p11-02', head: 0xb05, closes: [701], checks: [{ name: 'backend', status: 'completed', conclusion: 'success' }, { name: 'web', status: 'completed', conclusion: 'success' }],
    files: [
      { filename: 'apps/web/src/Now.tsx', status: 'modified', additions: 12, deletions: 1, patch: '@@ -1,1 +1,12 @@\n-export function Now() { return null; }\n+export function Now() {\n+  return <section aria-label="Running work" />;\n+}' },
      { filename: 'apps/backend/src/factory/tools.ts', status: 'modified', additions: 4, deletions: 0, patch: '@@ -1,2 +1,6 @@\n+// Report the running work.' },
    ],
    threads: [
      { resolved: false, path: 'apps/web/src/Now.tsx', line: 3, comments: [{ author: 'DanAakesen', body: 'Can this show the task title as well?', createdAt: timestamps.late }] },
      { resolved: true, path: 'apps/backend/src/factory/tools.ts', line: 4, comments: [{ author: 'DanAakesen', body: 'Rename this helper.', createdAt: timestamps.middle }, { author: 'jarvis-app[bot]', body: 'Renamed.', createdAt: timestamps.late }] },
    ],
  });
  jarvis.items.get(705)!.pull!.reviewComments.push({ id: 7_050, user: 'DanAakesen', body: 'Can this show the task title as well?', createdAt: timestamps.late, path: 'apps/web/src/Now.tsx', line: 3 });
  addPull(jarvis, 706, 'P11-06: Add mailbox shortcuts', { branch: 'jarvis/p11-06', head: 0xb06 });
  addPull(jarvis, 707, 'P11-07: Calendar polish', { branch: 'jarvis/p11-07', head: 0xb07, draft: true, checks: [{ name: 'backend', status: 'in_progress', conclusion: null }] });
  addPull(jarvis, 708, 'P11-08: Update the contributor docs', { branch: 'jarvis/p11-08', head: 0xb08 });
  addPull(jarvis, 709, 'P11-09: Fix the broken build', { branch: 'jarvis/p11-09', head: 0xb09, checks: [{ name: 'backend tests', status: 'completed', conclusion: 'failure' }] });
  jarvis.checkRuns.set(mainHead, [{ id: 8_041, name: 'deploy checks', status: 'completed', conclusion: 'success', suiteId: 7_003 }]);

  const run = (id: number, name: string, path: string, branch: string, head: string, conclusion: string, suiteId: number) => jarvis.runs.push({
    id, name, displayTitle: `${name} on ${branch}`, path, status: 'completed', conclusion, branch, sha: head, suiteId, createdAt: timestamps.late, updatedAt: timestamps.late,
  });
  run(9_000, 'CI', '.github/workflows/ci.yml', 'jarvis/p11-02', sha(0xb05), 'success', 7_705);
  run(9_001, 'CI', '.github/workflows/ci.yml', 'jarvis/p11-09', sha(0xb09), 'failure', 7_709);
  run(9_002, 'Deploy', '.github/workflows/deploy.yml', 'main', mainHead, 'success', 7_003);
  jarvis.runs.unshift(
    { id: 9_044, runNumber: 44, name: 'iOS TestFlight', displayTitle: 'Check TestFlight build 43', path: '.github/workflows/ios-testflight.yml', status: 'completed', conclusion: 'success', branch: 'main', sha: mainHead, suiteId: 7_044, createdAt: timestamps.late, updatedAt: timestamps.late },
    { id: 9_043, runNumber: 43, name: 'iOS TestFlight', displayTitle: 'Upload TestFlight build 43', path: '.github/workflows/ios-testflight.yml', status: 'completed', conclusion: 'success', branch: 'main', sha: mainHead, suiteId: 7_043, createdAt: timestamps.late, updatedAt: timestamps.late },
  );
  jarvis.jobs.push(
    { id: 9_143, runId: 9_043, name: 'Archive and upload to TestFlight', status: 'completed', conclusion: 'success', log: '', steps: [{ name: 'Apple confirmed availability for internal testing', conclusion: 'skipped' }] },
    { id: 9_144, runId: 9_044, name: 'Read-only TestFlight receipt', status: 'completed', conclusion: 'success', log: '', steps: [{ name: 'Apple confirmed availability for internal testing', conclusion: 'success' }] },
    { id: 9_100, runId: 9_000, name: 'build', status: 'completed', conclusion: 'success', log: 'Build finished.' },
    { id: 9_101, runId: 9_001, name: 'backend tests', status: 'completed', conclusion: 'failure', log: failingLog },
    { id: 9_102, runId: 9_001, name: 'lint', status: 'completed', conclusion: 'success', log: 'No lint problems.' },
  );

  const garden = github.addRepository('DanAakesen/garden-notes', { defaultBranch: 'main', isPrivate: true, files: { 'README.md': '# Garden Notes\n\nPlant care notes.\n', 'AGENTS.md': '# Agent rules\n\nKeep pages small.\n' } });
  addIssue(garden, 1, 'P11-01: Add a watering schedule page', { labels: ['P11'] });
  addIssue(garden, 2, 'Fix a typo on the home page', { labels: ['bug'], state: 'closed' });
}

export function seedTasks(): FakeTaskSeed[] {
  const pull = (number: number, state: 'open' | 'merged') => ({ number, url: `https://github.com/${JARVIS_REPOSITORY}/pull/${number}`, state });
  const runner = (summary: string) => ({ type: 'runner_message', summary, source: 'runner' as const });
  const base = { projectId: projectIds.jarvis, source: 'chat' as const, originMessageId: '30' };
  return [
    { task: { ...base, id: '100', issueNumber: 690, title: 'P11-01: Ship the first Factory board', state: 'Done', branch: 'jarvis/p11-01', pullRequest: pull(691, 'merged'), checks: 'passed', attemptCount: 1, startedAt: timestamps.middle, finishedAt: timestamps.late, latestSessionEndReason: 'done' },
      events: [{ type: 'created', summary: 'Task started from GitHub issue #690', source: 'backend' }, runner('Board is ready'), { type: 'state_changed', summary: 'Task is now Done', source: 'backend', payload: { from: 'Running', to: 'Done' } }] },
    { task: { ...base, id: '101', issueNumber: 701, title: 'P11-02: Show running work in the Now view', state: 'Running', branch: 'jarvis/p11-02', pullRequest: pull(705, 'open'), checks: 'passed', activity: 'Running the web tests', attemptCount: 1, startedAt: timestamps.late },
      events: [{ type: 'created', summary: 'Task started from GitHub issue #701', source: 'backend' }, { type: 'state_changed', summary: 'Task is now Running', source: 'backend', payload: { from: 'Ready', to: 'Running' } }, runner('Reading the Now view code'), runner('Opened pull request #705')],
      usage: [{ id: '1', source: 'sandbox', metric: 'minutes', quantity: 12, costDkk: 1.2, sandboxSessionId: null, at: timestamps.late, estimated: false }] },
    { task: { ...base, id: '102', issueNumber: 710, title: 'P11-10: Group the settings by area', state: 'Running', agent: 'codex', activity: 'Editing the settings page', attemptCount: 1, startedAt: timestamps.late } },
    { task: { ...base, id: '103', issueNumber: 711, title: 'P11-11: Export a chat as markdown', state: 'Paused', agent: 'codex', activity: 'Paused by Dan', attemptCount: 1, startedAt: timestamps.late } },
    { task: { ...base, id: '104', issueNumber: 712, title: 'P11-12: Retry the sandbox start', state: 'NeedsAttention', agent: 'codex', activity: 'The sandbox could not start', attemptCount: 3 },
      events: [{ type: 'created', summary: 'Task started from GitHub issue #712', source: 'backend' }, { type: 'state_changed', summary: 'The sandbox start was rejected', source: 'backend', payload: { from: 'Ready', to: 'NeedsAttention', reason: 'foundry_start_rejected' } }] },
    { task: { ...base, id: '105', issueNumber: 713, title: 'P11-13: Long refactor of the reminders list', state: 'Running', agent: 'codex', activity: 'Refactoring', attemptCount: 1, startedAt: timestamps.late } },
    { task: { ...base, id: '106', issueNumber: 714, title: 'P11-14: Tune the reminders list', state: 'Ready', agent: 'codex' } },
    { task: { ...base, id: '107', issueNumber: 715, title: 'P11-15: Improve the search results', state: 'Running', agent: 'codex', activity: 'Reading the search code', attemptCount: 1, startedAt: timestamps.late } },
  ];
}

export function seedReleases(): Record<string, ReleaseViewRecords> {
  return {
    [projectIds.jarvis]: {
      releases: [{ id: '11', version: '2026.11.20.1', sha: sha(0x691), status: 'released', createdAt: timestamps.late, releasedAt: timestamps.late }],
      pullRequests: [
        { id: '21', number: 691, branch: 'jarvis/p11-01', headSha: sha(0xb01), state: 'merged', checks: 'passed', taskId: '100' },
        { id: '22', number: 705, branch: 'jarvis/p11-02', headSha: sha(0xb05), state: 'open', checks: 'passed', taskId: '101' },
      ],
      workflowRuns: [{ id: '31', workflow: 'deploy.yml', trigger: 'push', headSha: sha(0x691), status: 'completed', conclusion: 'success', startedAt: timestamps.late, completedAt: timestamps.late, releaseId: '11', pullRequestNumber: null, taskId: null }],
      deployments: [{ id: '41', releaseId: '11', environment: 'production', status: 'success', at: timestamps.late }],
    },
  };
}
