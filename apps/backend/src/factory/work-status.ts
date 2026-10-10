import type { FastifyInstance } from 'fastify';
import type { WorkStatus, WorkStatusInput } from '@jarvis/contracts';
import type { GitHubIssue } from '../github/issues.js';
import { createGitHubActionsRunClient } from '../github/actions-runs.js';
import type { TaskRecord } from './task-store.js';
import type { WorkPullRequest } from './board.js';

const taskCode = (title: string) => /\bP\d{1,2}-\d{2,3}\b/u.exec(title)?.[0];
function sameWork(left: string, right: string): boolean {
  return left.trim() === right.trim() || Boolean(taskCode(left) && taskCode(left) === taskCode(right));
}

export const workStatusSchema = {
  type: 'object',
  properties: {
    issueNumber: { type: 'integer', minimum: 1, maximum: 2_147_483_647 },
    taskId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$', maxLength: 19 },
    query: { type: 'string', minLength: 1, maxLength: 100 },
    project: { type: 'string', minLength: 1, maxLength: 140 },
  },
  additionalProperties: false,
};

export async function getWorkStatus(app: FastifyInstance, input: WorkStatusInput,
  signal: AbortSignal = AbortSignal.timeout(60_000)): Promise<WorkStatus> {
  const status = await readWorkStatus(app, input, signal);
  app.systemHealthDiagnostics.recordWork(status);
  return status;
}

async function readWorkStatus(app: FastifyInstance, input: WorkStatusInput,
  signal: AbortSignal = AbortSignal.timeout(60_000)): Promise<WorkStatus> {
  signal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  const warnings: string[] = [];
  const result: WorkStatus = { verdict: 'needs_attention', project: null, issue: null, tasks: [],
    pullRequests: [], deployments: [], warnings, partial: false };
  const warn = (warning: string) => { warnings.push(warning); result.partial = true; };
  async function read<T>(operation: () => Promise<T>, warning: string): Promise<T | null> {
    try {
      signal.throwIfAborted();
      let abort: (() => void) | undefined;
      try {
        return await Promise.race([operation(), new Promise<never>((_resolve, reject) => {
          abort = () => reject(new Error('Work status deadline exceeded'));
          signal.addEventListener('abort', abort, { once: true });
        })]);
      } finally {
        if (abort) signal.removeEventListener('abort', abort);
      }
    } catch { if (!warnings.includes(warning)) warn(warning); return null; }
  }
  if (Object.keys(input).some((key) => !['issueNumber', 'taskId', 'query', 'project'].includes(key)) ||
      [input.issueNumber, input.taskId, input.query].filter((value) => value !== undefined).length !== 1 ||
      (input.query !== undefined && (!input.query.trim() || input.query.length > 100)) ||
      (input.issueNumber !== undefined && (!Number.isSafeInteger(input.issueNumber) ||
        input.issueNumber < 1 || input.issueNumber > 2_147_483_647)) ||
      (input.taskId !== undefined && (!/^[1-9][0-9]{0,18}$/u.test(input.taskId) ||
        BigInt(input.taskId) > 9_223_372_036_854_775_807n))) {
    warn('Invalid work selector.'); return result;
  }
  const selectedTask = input.taskId ? await read(() => app.taskStore!.get(input.taskId!, 1, 0),
    'Task lookup unavailable.') : null;
  if (input.taskId && !selectedTask) {
    warn('Task not found or unavailable.'); return result;
  }
  const projects = await read(() => app.projectStore!.list(), 'Project lookup unavailable.');
  const candidates = (projects ?? []).filter((project) =>
    (!selectedTask || project.id === selectedTask.projectId) &&
    (input.project ? [project.id, project.name.toLowerCase(), project.repo.toLowerCase()]
      .includes(input.project.toLowerCase()) : selectedTask ? true : project.active));
  if (candidates.length !== 1) {
    warn(candidates.length ? 'Ambiguous project; supply a project selector.' : 'Project not found.');
    return result;
  }
  const project = candidates[0]!;
  result.project = { id: project.id, name: project.name, repo: project.repo };
  // Enumerate a bounded project snapshot, not a fuzzy search that could miss linked peers.
  const allTasks: TaskRecord[] = [];
  for (let page = 0; page < 10; page++) {
    const tasks = await read(() => app.taskStore!.list({ projectId: project.id, limit: 100, offset: page * 100 }),
      'Task list unavailable or incomplete.');
    if (!tasks) break;
    allTasks.push(...tasks.filter((task) => task.projectId === project.id));
    if (tasks.length < 100) break;
    if (page === 9) warn('Task result limit reached; peers may be missing.');
  }
  if (selectedTask && !allTasks.some(({ id }) => id === selectedTask.id)) allTasks.push(selectedTask);
  let token: string | null = null;
  async function repositoryToken() {
    token ??= await app.githubAppTokenIssuer!.issueForRepositoryRead(project.repo);
    return token;
  }
  let issueNumber = input.issueNumber ?? selectedTask?.issueNumber ?? undefined;
  let matched: TaskRecord[] = selectedTask ? [selectedTask] : [];
  if (input.query) {
    matched = allTasks.filter((task) => sameWork(task.title, input.query!));
    const numbers = [...new Set(matched.flatMap((task) => task.issueNumber ? [task.issueNumber] : []))];
    if (numbers.length === 1) issueNumber = numbers[0];
    else if (numbers.length > 1) warn('Ambiguous work query; use an exact issue number.');
    else {
      const search = await read(async () => app.factoryBoardReader.searchIssues!(project.repo,
        await repositoryToken(), input.query!), 'Issue search unavailable.');
      if (search?.incomplete) warn('Issue search incomplete; use an exact issue number.');
      if (search?.numbers.length === 1 && !search.incomplete) issueNumber = search.numbers[0];
      else if (search && search.numbers.length > 1) warn('Ambiguous work query; use an exact issue number.');
    }
  }
  let issue: GitHubIssue | null = null;
  if (issueNumber) {
    issue = await read(() => app.githubIssueClient!.readIssue(project.repo, issueNumber!), 'Issue lookup unavailable.');
    if (!issue || issue.isPullRequest) {
      warn('Issue not found or not an issue.'); issue = null;
    } else {
      result.issue = { number: issue.number, url: issue.url, title: issue.title, state: issue.state,
        labels: [...issue.labels] };
      matched = allTasks.filter((task) => task.issueNumber === issueNumber ||
        (!task.issueNumber && sameWork(task.title, issue!.title)));
    }
  } else if (selectedTask) {
    warnings.push('Legacy task has no issue link; title/task-code matches are advisory only.');
    matched = allTasks.filter((task) => sameWork(task.title, selectedTask.title));
    const peers = matched.filter((task) => task.issueNumber);
    if (peers.length) warnings.push('Legacy task has linked peers; check for superseded work before restarting.');
  }
  result.tasks = matched.slice(0, 100).map((task) => ({
    id: task.id, issueNumber: task.issueNumber ?? null, title: task.title, state: task.state,
    activity: task.activity, attemptCount: task.attemptCount, linked: Boolean(task.issueNumber),
  }));
  if (matched.length > 100) warn('Task output truncated.');
  if (matched.some((task) => !task.issueNumber)) {
    warnings.push('Unlinked legacy tasks are advisory matches, not issue links.');
  }
  if (selectedTask && !selectedTask.issueNumber) {
    const peers = matched.filter((task) => task.id !== selectedTask.id && task.issueNumber);
    if (peers.length > 20) warn('Legacy peer evidence limit reached.');
    for (const peer of peers.slice(0, 20)) {
      const peerIssue = await read(() => app.githubIssueClient!.readIssue(project.repo, peer.issueNumber!),
        'Legacy peer issue lookup unavailable.');
      if (!peerIssue || peerIssue.isPullRequest) warn('Legacy peer issue not found.');
      if (peerIssue?.state === 'closed' && !peerIssue.isPullRequest) {
        warnings.push(`Legacy task may be superseded: peer task ${peer.id} links closed issue #${peer.issueNumber}.`);
      }
    }
  }
  const prNumbers = new Set(matched.flatMap((task) => task.pullRequest ? [task.pullRequest.number] : []));
  const records = issue || prNumbers.size ? await read(() => app.releaseViewStore!.read(project.id),
    'Release records unavailable.') : null;
  for (const pull of records?.pullRequests ?? []) {
    if (pull.taskId && matched.some((task) => task.id === pull.taskId)) prNumbers.add(pull.number);
  }
  if (selectedTask && !selectedTask.issueNumber) {
    // A literal, same-repository body reference is evidence, never an instruction or a durable link.
    const search = await read(async () => app.factoryBoardReader.searchIssues!(project.repo,
      await repositoryToken(), `Supersedes Factory task ${selectedTask.id}`, 'body'),
    'Explicit legacy supersession lookup unavailable.');
    if (search?.incomplete) warn('Explicit legacy supersession search incomplete.');
    for (const number of (search?.numbers ?? []).slice(0, 10)) {
      const replacement = await read(() => app.githubIssueClient!.readIssue(project.repo, number),
        'Explicit legacy supersession issue unavailable.');
      if (!replacement || replacement.isPullRequest ||
          !new RegExp(`\\bSupersedes\\s+Factory\\s+task\\s+${selectedTask.id}(?![0-9])\\b`, 'iu')
            .test(replacement.body)) continue;
      warnings.push(`Explicit supersession reference: issue #${number} supersedes Factory task ${selectedTask.id}.`);
      if (replacement.state === 'closed') {
        warnings.push(`Legacy task may be superseded: closed issue #${number} explicitly references task ${selectedTask.id}.`);
      }
      const references = await read(async () => app.factoryBoardReader.issuePullRequests!(project.repo,
        await repositoryToken(), number), 'Explicit supersession pull request links unavailable.');
      for (const prNumber of (references ?? []).slice(0, 20)) {
        const replacementPull = await read(async () => app.factoryBoardReader.readPullRequest!(project.repo,
          await repositoryToken(), prNumber), 'Explicit supersession pull request unavailable.');
        if (replacementPull?.linkedIssues.includes(number) && replacementPull.state === 'merged') {
          warnings.push(`Legacy task may be superseded: merged PR #${prNumber} closes replacement issue #${number}.`);
        }
      }
    }
  }
  if (issue) {
    const linked = await read(async () => app.factoryBoardReader.issuePullRequests!(project.repo,
      await repositoryToken(), issueNumber!), 'Historical pull request links unavailable.');
    for (const number of linked ?? []) prNumbers.add(number);
  }
  const pulls: WorkPullRequest[] = [];
  if (prNumbers.size > 20) warn('Pull request result limit reached.');
  for (const number of [...prNumbers].slice(0, 20)) {
    const pull = await read(async () => app.factoryBoardReader.readPullRequest!(project.repo,
      await repositoryToken(), number), 'Pull request or checks unavailable.');
    if (pull?.checksIncomplete) warn('Pull request checks unavailable or incomplete.');
    if (pull && (matched.some((task) => task.pullRequest?.number === number) ||
      records?.pullRequests.some((record) => record.number === number &&
        matched.some((task) => task.id === record.taskId)) ||
      pull.linkedIssues.includes(issueNumber ?? 0))) pulls.push(pull);
  }
  result.pullRequests = pulls.map((pull) => ({
    number: pull.number, url: pull.url, state: pull.state, draft: pull.draft,
    merged: pull.state === 'merged',
    checks: pull.checks, mergeSha: pull.mergeSha,
  }));
  const merged = pulls.filter((pull) => pull.state === 'merged');
  const deliveryMerged = merged.filter((pull) => pull.linkedIssues.includes(issueNumber ?? 0) ||
    matched.some((task) => task.issueNumber === issueNumber && (task.pullRequest?.number === pull.number ||
      records?.pullRequests.some((record) => record.number === pull.number && record.taskId === task.id))));
  for (const sha of [...new Set(merged.flatMap((pull) => pull.mergeSha ? [pull.mergeSha] : []))]) {
    const release = records?.releases.filter((item) => item.sha.toLowerCase() === sha.toLowerCase())
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
    const deployments = release ? records?.deployments.filter((item) => item.releaseId === release.id &&
      item.environment.toLowerCase() === 'production').sort((left, right) => Date.parse(right.at) - Date.parse(left.at)) : [];
    const deployed = deployments?.[0];
    if (release?.status === 'failed' || (release && deployed)) {
      result.deployments.push({ sha, status: release.status === 'released' && deployed?.status === 'success'
        ? 'verified' : deployed?.status === 'failure' || release.status === 'failed' ? 'failed' : 'pending',
      source: 'release', url: null });
    } else {
      const run = await read(() => createGitHubActionsRunClient(app.githubAppTokenIssuer!)
        .latestDeployment(project.repo, project.default_branch, signal, sha), 'Exact-commit deployment lookup unavailable.');
      result.deployments.push({ sha, status: run?.headSha.toLowerCase() === sha.toLowerCase() &&
        run.status === 'completed' && run.conclusion === 'success' ? 'verified' :
        run?.status === 'completed' && run.conclusion !== 'success' ? 'failed' : run ? 'pending' : 'unknown',
      source: 'actions', url: run?.url ?? null });
    }
  }
  if (issue?.state === 'closed') warnings.push('Issue is closed; do not restart without Dan confirmation.');
  if (merged.length) warnings.push('A linked pull request is merged; do not restart without Dan confirmation.');
  if (pulls.some((pull) => pull.state === 'closed')) warnings.push('A pull request was closed without merging; delivery is not verified.');
  if (result.deployments.some((deployment) => deployment.status === 'failed')) {
    warnings.push('Deployment of the exact merge commit failed.');
  }
  if (merged.some((pull) => !pull.mergeSha)) warn('Merged pull request has no verified merge commit SHA.');
  if (result.deployments.some((deployment) => deployment.status === 'unknown')) {
    warn('No deployment evidence found for the exact merge commit.');
  }
  const verified = deliveryMerged.length > 0 && deliveryMerged.every((pull) => pull.mergeSha &&
    result.deployments.some((deployment) => deployment.status === 'verified' &&
      pull.mergeSha!.toLowerCase() === deployment.sha.toLowerCase()));
  if (issue?.state === 'closed' && deliveryMerged.length && verified && !result.partial) result.verdict = 'delivered';
  else if (result.partial || (selectedTask && !selectedTask.issueNumber) || issue?.state === 'closed' || merged.length ||
      pulls.some((pull) => pull.state === 'closed' || pull.checks === 'failed') ||
      matched.some((task) => ['NeedsAttention', 'Cancelled', 'Paused', 'PauseRequested', 'Done'].includes(task.state)) ||
      issue?.labels.some((label) => ['needs-decision', 'blocked'].includes(label.toLowerCase()))) {
    result.verdict = 'needs_attention';
  } else if (pulls.length || matched.some((task) => task.state !== 'Ready' || task.attemptCount > 0) ||
      issue?.labels.some((label) => ['jarvis', 'copilot', 'codex', 'dan'].includes(label.toLowerCase()))) {
    result.verdict = 'in_progress';
  } else if (issue || matched.length) result.verdict = 'not_started';
  else warn('Work not found.');
  return result;
}

export async function taskRestartReason(app: FastifyInstance, taskId: string): Promise<string | null> {
  try {
    if (app.taskStore && !await app.taskStore.get(taskId, 1, 0)) return 'task_not_found';
  } catch { return 'work_status_unverified'; }
  const status = await getWorkStatus(app, { taskId });
  if (status.issue?.state === 'closed') return 'issue_closed';
  if (status.pullRequests.some((pull) => pull.state === 'merged')) return 'pull_request_merged';
  const task = status.tasks.find((item) => item.id === taskId);
  if (!task?.linked && status.tasks.some((peer) => peer.id !== taskId && peer.state === 'Done')) {
    return 'superseded_legacy_task';
  }
  if (task && !task.linked) {
    if (status.warnings.some((warning) => warning.startsWith('Legacy task may be superseded:'))) {
      return 'superseded_legacy_task';
    }
  }
  if (status.partial) return 'work_status_unverified';
  return null;
}

export async function steeringRestartsTask(app: FastifyInstance, taskId: string): Promise<boolean> {
  if (!app.taskStore) throw new Error('Task safety unavailable');
  const task = await app.taskStore.get(taskId, 1, 0);
  return task?.latestSessionEndReason === 'idle_expired';
}
