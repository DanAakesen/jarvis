import { canTransitionTask, type TaskState } from '../../../factory/task-lifecycle.js';
import { ProjectConflictError, type CreateProject, type Project, type ProjectStore, type UpdateProject } from '../../../factory/projects.js';
import type {
  CreateTaskInput, RecordTaskEventInput, TaskControlCommand, TaskController, TaskControlResult, TaskDetail, TaskEventHub, TaskEventMessage,
  TaskEventRecord, TaskListFilters, TaskRecord, TaskStore, TaskTransitionResult, TaskUsageRecord,
} from '../../../factory/task-store.js';
import type { ReleaseGraphReader, ReleaseViewRecords, ReleaseViewStore } from '../../../factory/release-view.js';
import type { FactoryBoardReader, WorkPullRequest } from '../../../factory/board.js';
import type { RepositoryCreationInput, RepositoryCreator } from '../../../factory/new-project.js';
import type { GitHubAppTokenIssuer, GitHubRepository, GitHubRepositoryCatalog } from '../../../github-app.js';
import type { FakeGitHub } from './factory-github.testkit.js';
import { timestamps } from './factory-github.testkit.js';

/** In-memory stand-ins for the Factory's own stores and its GitHub App collaborators. */

// ---- Projects ----------------------------------------------------------------------------------------------------------

export function createFakeProjectStore(seed: readonly Project[]): ProjectStore & { readonly projects: Project[] } {
  const projects = [...seed];
  let next = Math.max(0, ...projects.map((project) => Number(project.id))) + 1;
  const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
  return {
    projects,
    async list() {
      return projects.filter((project) => project.active).sort((left, right) => left.name.localeCompare(right.name) || Number(left.id) - Number(right.id)).map((project) => ({ ...project }));
    },
    async create(input: CreateProject) {
      if (projects.some((project) => project.active && same(project.repo, input.repo))) throw new ProjectConflictError();
      const project: Project = {
        id: String(next), name: input.name, description: input.description ?? null, repo: input.repo, default_branch: input.default_branch,
        default_agent: input.default_agent, policy: input.policy, merge_rules: input.merge_rules ?? null, sandbox_size: input.sandbox_size,
        tech: input.tech, max_parallel_tasks: input.max_parallel_tasks ?? 1, active: true,
      };
      next += 1;
      projects.push(project);
      return { ...project };
    },
    async update(id: string, change: UpdateProject) {
      const index = projects.findIndex((project) => project.id === id && project.active);
      if (index < 0) return null;
      const current = projects[index]!;
      if (change.repo !== undefined && projects.some((project) => project.id !== id && project.active && same(project.repo, change.repo!))) throw new ProjectConflictError();
      const updated = { ...current, ...Object.fromEntries(Object.entries(change).filter(([, value]) => value !== undefined)) } as Project;
      projects[index] = updated;
      return { ...updated };
    },
    async archive(id: string) {
      const project = projects.find((candidate) => candidate.id === id && candidate.active);
      if (!project) return false;
      projects[projects.indexOf(project)] = { ...project, active: false };
      return true;
    },
  };
}

// ---- Tasks -------------------------------------------------------------------------------------------------------------

export interface FakeTaskEventSeed extends Pick<TaskEventRecord, 'type' | 'summary' | 'source'> { readonly payload?: unknown }

export interface FakeTaskSeed {
  readonly task: Partial<TaskRecord> & Pick<TaskRecord, 'id' | 'projectId' | 'title' | 'state'>;
  readonly events?: readonly FakeTaskEventSeed[];
  readonly usage?: readonly TaskUsageRecord[];
}

export interface FakeTaskStore extends TaskStore {
  readonly tasks: Map<string, TaskRecord>;
  readonly events: Map<string, TaskEventRecord[]>;
}

export function createFakeTaskStore(options: { readonly projects: ProjectStore; readonly hub: TaskEventHub; readonly seed: readonly FakeTaskSeed[] }): FakeTaskStore {
  const tasks = new Map<string, TaskRecord>();
  const events = new Map<string, TaskEventRecord[]>();
  const usage = new Map<string, TaskUsageRecord[]>();
  const origins = new Map<string, string>();
  let nextTask = 100;
  let nextEvent = 1_000;
  let clock = Date.parse(timestamps.late);
  const tick = () => new Date(clock += 1_000).toISOString();

  const record = (taskId: string, input: Omit<RecordTaskEventInput, 'taskId'>): TaskEventMessage => {
    nextEvent += 1;
    const event: TaskEventMessage = { id: String(nextEvent), taskId, type: input.type, summary: input.summary ?? null, payload: input.payload ?? null, payloadTruncated: false, source: input.source, at: tick() };
    events.set(taskId, [...(events.get(taskId) ?? []), event]);
    options.hub.publish(event);
    return event;
  };

  for (const entry of options.seed) {
    const task: TaskRecord = {
      issueNumber: null, originMessageId: null, request: `Do the work for ${entry.task.title}.`, source: 'board', agent: 'codex', modelOverride: null,
      reasoningOverride: null, activity: null, priority: 0, attemptCount: 0, nextAttemptAt: null, branch: null, pullRequest: null, checks: null,
      checkConclusion: null, usageSummary: null, latestSessionEndReason: null, createdAt: tick(), startedAt: null, finishedAt: null, ...entry.task,
    };
    tasks.set(task.id, task);
    for (const event of entry.events ?? [{ type: 'created', summary: 'Task created from the board', source: 'backend' as const }]) record(task.id, event);
    usage.set(task.id, [...(entry.usage ?? [])]);
    nextTask = Math.max(nextTask, Number(task.id) + 1);
  }

  const summary = (task: TaskRecord): TaskRecord => ({ ...task });
  const transitionTask = (task: TaskRecord, state: TaskState): TaskRecord => {
    const updated: TaskRecord = { ...task, state, ...(state === 'Running' && !task.startedAt ? { startedAt: tick() } : {}), ...(state === 'Done' || state === 'Cancelled' ? { finishedAt: tick() } : {}) };
    tasks.set(task.id, updated);
    return updated;
  };

  const store: FakeTaskStore = {
    tasks,
    events,
    async rememberIssueOrigin(repository, issueNumber, messageId) {
      const key = `${repository.toLowerCase()}#${issueNumber}`;
      if (!origins.has(key)) origins.set(key, messageId);
    },
    async getIssueOrigin(repository, issueNumber) { return origins.get(`${repository.toLowerCase()}#${issueNumber}`) ?? null; },
    async findByIssueDelivery() { return null; },
    async create(input: CreateTaskInput) {
      const source = input.source ?? 'board';
      if ((source === 'chat' && input.originMessageId === undefined) || (source === 'board' && input.originMessageId !== undefined)) throw new Error('Invalid task input');
      const project = (await options.projects.list()).find(({ id }) => id === input.projectId);
      if (!project) return null;
      const task: TaskRecord = {
        id: String(nextTask), projectId: project.id, issueNumber: input.issueNumber ?? null, originMessageId: input.originMessageId ?? null,
        title: input.title, request: input.request, source, agent: input.agent ?? project.default_agent, modelOverride: input.modelOverride ?? null,
        reasoningOverride: input.reasoningOverride ?? null, state: 'Ready', activity: null, priority: input.priority ?? 0, attemptCount: 0,
        nextAttemptAt: null, branch: null, pullRequest: null, checks: null, checkConclusion: null, usageSummary: null, latestSessionEndReason: null,
        createdAt: tick(), startedAt: null, finishedAt: null,
      };
      nextTask += 1;
      tasks.set(task.id, task);
      usage.set(task.id, []);
      record(task.id, {
        type: 'created', source: 'backend', payload: { state: 'Ready' },
        summary: input.issueNumber !== undefined ? `Task started from GitHub issue #${input.issueNumber}` : source === 'chat' ? 'Task created from chat' : 'Task created from the board',
      });
      return summary(task);
    },
    async findActiveByIssue(projectId, issueNumber) {
      const found = [...tasks.values()].find((task) => task.projectId === projectId && task.issueNumber === issueNumber && task.state !== 'Done' && task.state !== 'Cancelled');
      return found ? summary(found) : null;
    },
    async linkIssueNumberIfUnlinked(taskId, issueNumber) {
      const task = tasks.get(taskId);
      if (!task) return null;
      if (task.issueNumber == null) tasks.set(taskId, { ...task, issueNumber });
      return tasks.get(taskId)!.issueNumber ?? null;
    },
    async list(filters: TaskListFilters) {
      const needle = filters.search?.toLowerCase();
      return [...tasks.values()]
        .filter((task) => (filters.projectId === undefined || task.projectId === filters.projectId)
          && (filters.agent === undefined || task.agent === filters.agent)
          && (filters.state === undefined || task.state === filters.state)
          && (filters.createdAfter === undefined || Date.parse(task.createdAt) >= Date.parse(filters.createdAfter))
          && (filters.createdBefore === undefined || Date.parse(task.createdAt) < Date.parse(filters.createdBefore))
          && (needle === undefined || task.title.toLowerCase().includes(needle) || task.request.toLowerCase().includes(needle)))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || Number(right.id) - Number(left.id))
        .slice(filters.offset, filters.offset + filters.limit).map(summary);
    },
    async get(id, eventLimit, eventOffset): Promise<TaskDetail | null> {
      const task = tasks.get(id);
      if (!task) return null;
      return { ...summary(task), events: (events.get(id) ?? []).slice(eventOffset, eventOffset + eventLimit).map((event) => ({ ...event })), usage: [...(usage.get(id) ?? [])] };
    },
    async updateModelConfig(id, config) {
      const task = tasks.get(id);
      if (!task) return { kind: 'not-found' };
      if (task.state !== 'Ready') return { kind: 'not-ready' };
      const updated: TaskRecord = { ...task, agent: config.agent, modelOverride: config.modelOverride, reasoningOverride: config.reasoningOverride };
      tasks.set(id, updated);
      record(id, { type: 'model_changed', summary: 'Coding agent settings changed', source: 'backend', payload: { agent: updated.agent, model: updated.modelOverride, reasoning: updated.reasoningOverride } });
      return { kind: 'ok', task: summary(updated) };
    },
    async retry(id): Promise<TaskTransitionResult> {
      const task = tasks.get(id);
      if (!task) return { kind: 'not-found' };
      const history = (events.get(id) ?? []).some((event) => event.source === 'runner');
      const startRefused = (events.get(id) ?? []).some((event) => event.type === 'state_changed'
        && ['credential_unavailable', 'foundry_start_rejected'].includes(String((event.payload as { reason?: unknown } | null)?.reason)));
      if (task.state !== 'NeedsAttention' || task.attemptCount === 0 || history || !startRefused) return { kind: 'invalid-transition' };
      const updated: TaskRecord = { ...task, state: 'Ready', attemptCount: 0, nextAttemptAt: null, startedAt: null, finishedAt: null, activity: 'Task queued for another sandbox start attempt' };
      tasks.set(id, updated);
      record(id, { type: 'state_changed', source: 'dan', summary: updated.activity, payload: { from: 'NeedsAttention', to: 'Ready', reason: 'start_retry', attemptCount: 0 } });
      return { kind: 'ok', task: summary(updated) };
    },
    async getActiveRepository() { return null; },
    async getEventsAfter(taskId, eventId, limit) {
      return (events.get(taskId) ?? []).filter((event) => Number(event.id) > Number(eventId)).slice(0, limit).map((event) => ({ ...event, taskId }));
    },
    async getRunningContext() {
      const running = [...tasks.values()].filter((task) => task.state === 'Running');
      const projects = await options.projects.list();
      return {
        truncated: false,
        runningTasks: running.map((task) => ({
          id: task.id, projectId: task.projectId, projectName: projects.find(({ id }) => id === task.projectId)?.name ?? 'Unknown project', title: task.title,
          agent: task.agent, state: task.state, activity: task.activity, startedAt: task.startedAt,
          recentEvents: (events.get(task.id) ?? []).slice(-3).map((event) => ({ type: event.type, summary: event.summary, summaryTruncated: false, source: event.source, at: event.at })),
        })),
      };
    },
    async getProactiveSnapshot() {
      const projects = await options.projects.list();
      const all = [...tasks.values()];
      return {
        runningCount: all.filter((task) => task.state === 'Running').length,
        tasks: all.slice(0, 100).map((task) => {
          const project = projects.find(({ id }) => id === task.projectId);
          return {
            id: task.id, projectName: project?.name ?? 'Unknown project', projectPolicy: project?.policy ?? 'deliver_pr', title: task.title, state: task.state,
            createdAt: task.createdAt, startedAt: task.startedAt, pullRequestState: task.pullRequest?.state ?? null, pullRequestOpenedAt: null,
            checks: task.checks ?? null, latestSessionEndReason: task.latestSessionEndReason ?? null,
          };
        }),
      };
    },
    async transition(id, state, completionVerified, eventReason, eventSummary, expectedState) {
      const task = tasks.get(id);
      if (!task) return { kind: 'not-found' };
      if (expectedState !== undefined && task.state !== expectedState) return { kind: 'invalid-transition' };
      if (!canTransitionTask(task.state, state, completionVerified === true)) return { kind: 'invalid-transition' };
      const from = task.state;
      const updated = transitionTask(task, state);
      record(id, { type: 'state_changed', source: 'backend', summary: eventSummary ?? `Task is now ${state}`, payload: { from, to: state, ...(eventReason ? { reason: eventReason } : {}) } });
      return { kind: 'ok', task: summary(updated) };
    },
    async withNoActiveTasks(operation) {
      if ([...tasks.values()].some((task) => ['Ready', 'Running', 'PauseRequested'].includes(task.state))) return { kind: 'active' };
      return { kind: 'idle', value: await operation() };
    },
    async recordEvent(input) { return record(input.taskId, input); },
  };
  return store;
}

/** What the Factory's runtime does for pause, resume, cancel, steer and recover, reduced to the task states. */
export function createFakeTaskController(store: FakeTaskStore): TaskController & { readonly steered: { taskId: string; message: string }[] } {
  const steered: { taskId: string; message: string }[] = [];
  return {
    steered,
    async control(taskId: string, command: TaskControlCommand): Promise<TaskControlResult> {
      const task = store.tasks.get(taskId);
      if (!task) return { kind: 'not-found' };
      if (task.state === 'Done' || task.state === 'Cancelled') return { kind: 'invalid-transition', reason: `Task is already ${task.state}` };
      if (command.action === 'steer') {
        if (task.state !== 'Running') return { kind: 'invalid-transition', reason: 'Only a running task can be steered' };
        steered.push({ taskId, message: command.message });
        await store.recordEvent({ taskId, type: 'steered', summary: 'Dan sent a correction', source: 'dan', payload: { chars: command.message.length } });
        return { kind: 'ok', task: store.tasks.get(taskId)! };
      }
      const target: TaskState = command.action === 'pause' ? 'Paused' : command.action === 'resume' ? 'Running' : command.action === 'cancel' ? 'Cancelled' : 'Ready';
      if (command.action === 'recover' && task.state !== 'NeedsAttention') return { kind: 'invalid-transition' };
      if (command.action === 'recover') {
        const updated: TaskRecord = { ...task, state: 'Ready' };
        store.tasks.set(taskId, updated);
        return { kind: 'ok', task: updated };
      }
      if (command.action === 'pause') {
        // A running task asks to pause first, then the runtime acknowledges it, as in the real lifecycle.
        const requested = await store.transition(taskId, 'PauseRequested', false, 'pause');
        if (requested.kind !== 'ok') return { kind: 'invalid-transition' };
      }
      const result = await store.transition(taskId, target, false, command.action);
      return result.kind === 'ok' ? { kind: 'ok', task: result.task } : result.kind === 'not-found' ? { kind: 'not-found' } : { kind: 'invalid-transition' };
    },
  };
}

// ---- Releases and the pull-request board -------------------------------------------------------------------------------------

export function createFakeReleaseViewStore(byProject: Readonly<Record<string, ReleaseViewRecords>>): ReleaseViewStore {
  const empty: ReleaseViewRecords = { releases: [], pullRequests: [], workflowRuns: [], deployments: [] };
  return {
    async read(projectId) { return byProject[projectId] ?? empty; },
    async projectForRelease(releaseId) {
      return Object.entries(byProject).find(([, records]) => records.releases.some((release) => release.id === releaseId))?.[0] ?? null;
    },
  };
}

export function createFakeReleaseGraphReader(github: FakeGitHub): ReleaseGraphReader {
  return {
    async read(repository) {
      const repo = github.repository(repository);
      return {
        fetchedAt: timestamps.now, truncated: false,
        branches: [...repo.branches].map(([name, head]) => ({ name, commits: [head] })),
        commits: repo.commits.map((commit, index) => ({
          sha: commit.sha, message: commit.message, author: commit.author, committedAt: commit.date, parents: repo.commits[index + 1] ? [repo.commits[index + 1]!.sha] : [],
        })),
      };
    },
  };
}

const workerLabels = ['Jarvis', 'Copilot', 'Codex', 'Dan'] as const;

/** The pull-request and issue evidence Factory work status reads, answered from the fake GitHub. */
export function createFakeBoardReader(github: FakeGitHub): FactoryBoardReader {
  const readPull = (repository: string, number: number): WorkPullRequest => {
    const repo = github.repository(repository);
    const item = repo.items.get(number);
    if (!item?.pull) throw new Error('Invalid pull request');
    const runs = repo.checkRuns.get(item.pull.head.sha) ?? [];
    const failed = runs.some((run) => ['failure', 'cancelled', 'timed_out', 'action_required'].includes(run.conclusion ?? ''));
    const passed = runs.length > 0 && runs.every((run) => run.status === 'completed' && ['success', 'neutral', 'skipped'].includes(run.conclusion ?? ''));
    return {
      number, url: `https://github.com/${repository}/pull/${number}`, state: item.pull.merged ? 'merged' : item.state, draft: item.pull.draft,
      checks: failed ? 'failed' : passed ? 'passed' : 'pending', mergeSha: item.pull.merged ? item.pull.mergeSha : null, linkedIssues: [...item.pull.closes],
    };
  };
  return {
    async read(repository) {
      const repo = github.repository(repository);
      const items = [...repo.items.values()];
      return {
        issues: items.filter((item) => !item.pull).map((item) => ({
          number: item.number, url: `https://github.com/${repository}/issues/${item.number}`, title: item.title,
          taskCode: /\bP\d{1,2}-\d{2,3}\b/u.exec(item.title)?.[0] ?? null, labels: [...item.labels],
          worker: workerLabels.find((worker) => item.labels.includes(worker)) ?? null, state: item.state, updatedAt: item.updatedAt, closedAt: item.closedAt,
          blockedBy: [], blockedByCount: 0, body: item.body,
        })),
        pullRequests: items.filter((item) => item.pull && item.state === 'open').map((item) => ({ number: item.number, body: item.body, url: `https://github.com/${repository}/pull/${item.number}`, draft: item.pull!.draft })),
      };
    },
    async searchIssues(repository, _token, query, field = 'title') {
      const needle = query.toLowerCase();
      const numbers = [...github.repository(repository).items.values()]
        .filter((item) => !item.pull && (field === 'body' ? item.body : item.title).toLowerCase().includes(needle)).map((item) => item.number);
      return { numbers: numbers.slice(0, 10), incomplete: numbers.length > 10 };
    },
    async issuePullRequests(repository, _token, issue) {
      return [...github.repository(repository).items.values()].filter((item) => item.pull?.closes.includes(issue)).map((item) => item.number);
    },
    async readPullRequest(repository, _token, number) { return readPull(repository, number); },
  };
}

// ---- The GitHub App ----------------------------------------------------------------------------------------------------------

export const appToken = 'ghs_conformance0000000000000000000000';

/** A healthy installation: it can read and write everything the Factory tools ask for. `down` makes minting a token fail, as it does when GitHub is out. */
export function createFakeTokenIssuer(down: () => boolean = () => false): GitHubAppTokenIssuer & { readonly permissions: Record<string, 'read' | 'write' | 'admin'> } {
  const permissions: Record<string, 'read' | 'write' | 'admin'> = {
    metadata: 'read', contents: 'write', issues: 'write', pull_requests: 'write', checks: 'read', statuses: 'read', actions: 'write',
  };
  const token = async () => {
    if (down()) throw new TypeError('fetch failed');
    return appToken;
  };
  return {
    permissions,
    issue: token, issueWithPermissions: token, issueForActions: token, issueForChecks: token, issueForContents: token,
    issueForRepositoryRead: token, issueForContentsWrite: token, issueForIssuesWrite: token,
    async readInstallationPermissions() {
      if (down()) throw new TypeError('fetch failed');
      return { ...permissions };
    },
  };
}

export function createFakeRepositoryCatalog(github: FakeGitHub, extra: readonly GitHubRepository[], down: () => boolean = () => false): GitHubRepositoryCatalog {
  return {
    async list(owner) {
      if (down()) throw new TypeError('fetch failed');
      const known = [...github.repos.values()].map((repo): GitHubRepository => ({
        fullName: repo.fullName, name: repo.fullName.split('/')[1]!, defaultBranch: repo.defaultBranch, pushedAt: timestamps.now, language: 'TypeScript',
      }));
      const repositories = [...known, ...extra.filter((candidate) => !known.some((repo) => repo.fullName.toLowerCase() === candidate.fullName.toLowerCase()))]
        .filter((repo) => repo.fullName.toLowerCase().startsWith(`${owner.toLowerCase()}/`));
      return { repositories, fetchedAt: timestamps.now };
    },
    async detectTech() { return 'node'; },
  };
}

/** Creating a repository adds it to the fake GitHub; a name that is taken is a conflict, as on GitHub. */
export function createFakeRepositoryCreator(github: FakeGitHub, down: () => boolean = () => false): RepositoryCreator {
  return {
    async create(input: RepositoryCreationInput) {
      if (down()) throw new TypeError('fetch failed');
      const fullName = `${input.owner}/${input.name}`;
      if (github.repos.has(fullName.toLowerCase())) throw Object.assign(new Error('Repository exists'), { kind: 'conflict' });
      github.addRepository(fullName, { defaultBranch: input.defaultBranch, isPrivate: input.visibility === 'private' });
      return `https://github.com/${fullName}`;
    },
  };
}
