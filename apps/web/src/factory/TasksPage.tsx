import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { backendFetch } from '../backend-request';
import { useConversationIntents } from '../conversation-intents';
import { streamTaskEvents } from '../task-events';
import { useContextPanel } from '../context-panel-state';
import { TaskDetailPage } from './TaskDetailPage';
import { TaskReleaseBar } from './TaskReleaseBar';
import { TaskControls } from './TaskControls';

interface Project {
  id: string;
  name: string;
  default_agent: 'codex' | 'copilot';
}

type TaskState = 'Ready' | 'Running' | 'PauseRequested' | 'Paused' | 'NeedsAttention' | 'Done' | 'Cancelled';
type Agent = 'codex' | 'copilot';

interface Task {
  id: string;
  projectId: string;
  title: string;
  request: string;
  agent: Agent;
  state: TaskState;
  latestSessionEndReason?: 'done' | 'cancelled' | 'crashed' | 'idle' | 'idle_expired' | null;
  activity: string | null;
  attemptCount: number;
  branch: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface TaskEvent {
  id: string;
  taskId: string;
  type: string;
  summary: string | null;
  at: string;
}

interface TaskFilters {
  projectId: string;
  agent: string;
  state: string;
  period: string;
  search: string;
}

type PageState = 'loading' | 'ready' | 'error';
type StreamStatus = 'connecting' | 'connected' | 'reconnecting' | 'error';
type Props = { backendUrl: string | null; getAccessToken: () => Promise<string> };

const taskStates: TaskState[] = ['Ready', 'Running', 'PauseRequested', 'Paused', 'NeedsAttention', 'Done', 'Cancelled'];
const columns: { label: string; states: TaskState[] }[] = [
  { label: 'Ready', states: ['Ready'] },
  { label: 'Running', states: ['Running'] },
  { label: 'Paused', states: ['PauseRequested', 'Paused'] },
  { label: 'Needs attention', states: ['NeedsAttention'] },
  { label: 'Done', states: ['Done'] },
  { label: 'Cancelled', states: ['Cancelled'] },
];
const emptyFilters: TaskFilters = { projectId: '', agent: '', state: '', period: '', search: '' };
const taskIdPattern = /^[1-9]\d{0,18}$/;
const maxSqlBigInt = 9_223_372_036_854_775_807n;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isProject(value: unknown): value is Project {
  return isObject(value) && typeof value.id === 'string' && taskIdPattern.test(value.id) &&
    BigInt(value.id) <= maxSqlBigInt && typeof value.name === 'string' &&
    (value.default_agent === 'codex' || value.default_agent === 'copilot');
}

function isTask(value: unknown): value is Task {
  return isObject(value) && typeof value.id === 'string' && taskIdPattern.test(value.id) &&
    BigInt(value.id) <= maxSqlBigInt && typeof value.projectId === 'string' &&
    taskIdPattern.test(value.projectId) && BigInt(value.projectId) <= maxSqlBigInt &&
    typeof value.title === 'string' && typeof value.request === 'string' &&
    (value.agent === 'codex' || value.agent === 'copilot') &&
    taskStates.includes(value.state as TaskState) &&
    (value.latestSessionEndReason === undefined || value.latestSessionEndReason === null ||
      ['done', 'cancelled', 'crashed', 'idle', 'idle_expired'].includes(String(value.latestSessionEndReason))) &&
    (typeof value.activity === 'string' || value.activity === null) &&
    typeof value.attemptCount === 'number' && Number.isSafeInteger(value.attemptCount) &&
    value.attemptCount >= 0 && (typeof value.branch === 'string' || value.branch === null) &&
    isDate(value.createdAt) && (value.startedAt === null || isDate(value.startedAt)) &&
    (value.finishedAt === null || isDate(value.finishedAt));
}

function isTaskList(value: unknown): value is { tasks: Task[] } {
  return isObject(value) && Array.isArray(value.tasks) && value.tasks.every(isTask);
}

function isTaskEvent(value: unknown): value is TaskEvent {
  return isObject(value) && typeof value.id === 'string' && typeof value.taskId === 'string' &&
    typeof value.type === 'string' && (typeof value.summary === 'string' || value.summary === null) &&
    isDate(value.at);
}

async function request(
  backendUrl: string,
  getAccessToken: () => Promise<string>,
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
): Promise<unknown> {
  let token: string;
  try {
    token = await getAccessToken();
  } catch (cause) {
    throw new Error('Your Microsoft sign-in needs attention. Sign in again.', { cause });
  }

  let response: Response;
  try {
    response = await backendFetch(`${backendUrl.replace(/\/+$/, '')}${path}`, {
      method,
      headers: {
        Authorization: `${['Bear', 'er'].join('')} ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (cause) {
    throw new Error('Jarvis could not reach the task service. Try again.', { cause });
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Your Microsoft sign-in needs attention. Sign in again.');
    if (response.status === 503) throw new Error('Task data is unavailable until the database is connected.');
    throw new Error(`Jarvis could not ${method === 'GET' ? 'load' : 'create'} task data (HTTP ${response.status}).`);
  }
  try {
    return await response.json();
  } catch (cause) {
    throw new Error('Jarvis returned invalid task data. Try again.', { cause });
  }
}

async function loadProjects(backendUrl: string, getAccessToken: () => Promise<string>): Promise<Project[]> {
  const value: unknown = await request(backendUrl, getAccessToken, '/factory/projects');
  if (!Array.isArray(value) || !value.every(isProject)) throw new Error('Jarvis returned invalid project data. Try again.');
  return value;
}

function taskQuery(filters: TaskFilters): string {
  const query = new URLSearchParams({ limit: '100', offset: '0' });
  if (filters.projectId) query.set('projectId', filters.projectId);
  if (filters.agent) query.set('agent', filters.agent);
  if (filters.state) query.set('state', filters.state);
  if (filters.search.trim()) query.set('search', filters.search.trim());
  if (filters.period) {
    const days = Number(filters.period);
    if ([7, 30, 90].includes(days)) query.set('createdAfter', new Date(Date.now() - days * 86_400_000).toISOString());
  }
  return query.toString();
}

function taskError(error: unknown): string {
  return error instanceof Error ? error.message : 'Task data could not be loaded. Try again.';
}

function agentLabel(agent: Agent): string {
  return agent === 'codex' ? 'Codex' : 'Copilot';
}

function stateLabel(state: TaskState): string {
  return state === 'PauseRequested' ? 'Pause requested' :
    state === 'NeedsAttention' ? 'Needs attention' : state;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatDuration(task: Task, now: number): string {
  if (!task.startedAt) return 'Not started';
  const end = task.finishedAt ? Date.parse(task.finishedAt) : now;
  const totalMinutes = Math.max(0, Math.floor((end - Date.parse(task.startedAt)) / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function projectName(projects: Project[], projectId: string): string {
  return projects.find((project) => project.id === projectId)?.name ?? `Unavailable project (${projectId})`;
}

export function TasksPage({ backendUrl, getAccessToken }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectState, setProjectState] = useState<PageState>(backendUrl ? 'loading' : 'error');
  const [projectError, setProjectError] = useState(backendUrl ? '' : 'Projects are unavailable until the backend is deployed.');
  const [projectRetry, setProjectRetry] = useState(0);
  const [settledProjectKey, setSettledProjectKey] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskState, setTaskState] = useState<PageState>(backendUrl ? 'loading' : 'error');
  const [error, setError] = useState(backendUrl ? '' : 'Tasks are unavailable until the backend is deployed.');
  const [settledTaskKey, setSettledTaskKey] = useState('');
  const [filters, setFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);
  const [reloadKey, setReloadKey] = useState(0);
  const [streamKey, setStreamKey] = useState(0);
  const [liveStatuses, setLiveStatuses] = useState<Record<string, StreamStatus>>({});
  const [lastUpdated, setLastUpdated] = useState<Record<string, string>>({});
  const [lastActivity, setLastActivity] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createProjectId, setCreateProjectId] = useState('');
  const [createAgent, setCreateAgent] = useState<Agent>('copilot');
  const [now, setNow] = useState(0);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const selectedTaskIdRef = useRef('');
  const [conversationDraft, setConversationDraft] = useState('');
  const conversationIntents = useConversationIntents();
  const navigate = useNavigate();
  const contextPanel = useContextPanel();
  const closeContextPanel = contextPanel.close;
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const lastEventIds = useRef(new Map<string, string>());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskIds = tasks.filter((task) => task.state !== 'Done' && task.state !== 'Cancelled').map((task) => task.id).join(',');
  const filterKey = JSON.stringify(appliedFilters);
  const projectRequestKey = `${backendUrl ?? ''}:${projectRetry}`;
  const taskRequestKey = `${backendUrl ?? ''}:${filterKey}:${reloadKey}`;
  const visibleProjectState: PageState = !backendUrl ? 'error' :
    settledProjectKey === projectRequestKey ? projectState : 'loading';
  const visibleProjectError = backendUrl ? projectError : 'Projects are unavailable until the backend is deployed.';
  const visibleTaskState: PageState = !backendUrl ? 'error' :
    settledTaskKey === taskRequestKey ? taskState : 'loading';
  const visibleTaskError = backendUrl ? error : 'Tasks are unavailable until the backend is deployed.';

  useEffect(() => () => {
    if (selectedTaskIdRef.current) closeContextPanel();
  }, [closeContextPanel]);

  useEffect(() => {
    let active = true;
    if (!backendUrl) return () => { active = false; };
    void loadProjects(backendUrl, getAccessToken).then((loaded) => {
      if (!active) return;
      setProjects(loaded);
      setProjectState('ready');
      setProjectError('');
      setSettledProjectKey(projectRequestKey);
    }).catch((reason: unknown) => {
      if (!active) return;
      setProjectState('error');
      setProjectError(taskError(reason));
      setSettledProjectKey(projectRequestKey);
    });
    return () => { active = false; };
  }, [backendUrl, getAccessToken, projectRequestKey]);

  useEffect(() => {
    let active = true;
    if (!backendUrl) return () => { active = false; };
    void request(backendUrl, getAccessToken, `/factory/tasks?${taskQuery(appliedFilters)}`).then((value) => {
      if (!active) return;
      if (!isTaskList(value)) throw new Error('Jarvis returned invalid task data. Try again.');
      setTasks(value.tasks);
      setTaskState('ready');
      setError('');
      setSettledTaskKey(taskRequestKey);
    }).catch((reason: unknown) => {
      if (!active) return;
      setTaskState('error');
      setError(taskError(reason));
      setSettledTaskKey(taskRequestKey);
    });
    return () => { active = false; };
  }, [backendUrl, getAccessToken, appliedFilters, reloadKey, taskRequestKey]);

  useEffect(() => {
    if (!tasks.some((task) => task.startedAt && !task.finishedAt)) return undefined;
    const initialTimer = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(timer);
    };
  }, [tasks]);

  useEffect(() => {
    if (!backendUrl || !taskIds) return undefined;
    const controllers = new Map<string, AbortController>();
    const ids = taskIds.split(',');
    for (const taskId of ids) {
      const controller = new AbortController();
      const lastEventId = lastEventIds.current.get(taskId);
      controllers.set(taskId, controller);
      void streamTaskEvents<TaskEvent>({
        backendUrl,
        taskId,
        ...(lastEventId ? { lastEventId } : {}),
        getAccessToken,
        signal: controller.signal,
        onStatus: (status) => setLiveStatuses((current) => ({ ...current, [taskId]: status })),
        onEvent: (event) => {
          if (!isTaskEvent(event) || event.taskId !== taskId) return;
          lastEventIds.current.set(taskId, event.id);
          setLastUpdated((current) => {
            const previous = current[taskId];
            return !previous || Date.parse(event.at) > Date.parse(previous)
              ? { ...current, [taskId]: event.at } : current;
          });
          if (event.summary) setLastActivity((current) => ({ ...current, [taskId]: event.summary as string }));
          if (refreshTimer.current) clearTimeout(refreshTimer.current);
          refreshTimer.current = setTimeout(() => setReloadKey((value) => value + 1), 150);
        },
      }).catch(() => {
        if (!controller.signal.aborted) setLiveStatuses((current) => ({ ...current, [taskId]: 'error' }));
      });
    }
    return () => {
      for (const controller of controllers.values()) controller.abort();
    };
  }, [backendUrl, getAccessToken, taskIds, streamKey]);

  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTasks([]);
    setLiveStatuses({});
    setLastUpdated({});
    setLastActivity({});
    setAppliedFilters({ ...filters });
    setReloadKey((value) => value + 1);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setCreateError('');
    window.setTimeout(() => createButtonRef.current?.focus(), 0);
  };

  const createTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const title = String(values.get('title') ?? '').trim();
    const requestText = String(values.get('request') ?? '').trim();
    const modelOverride = String(values.get('modelOverride') ?? '').trim();
    const reasoningOverride = String(values.get('reasoningOverride') ?? '').trim();
    if (!createProjectId || !title || title.length > 200 || !requestText || requestText.length > 50_000 ||
      modelOverride.length > 100 || reasoningOverride.length > 32) {
      setCreateError('Enter a project, task title, and request within the stated limits.');
      return;
    }
    setCreating(true);
    setCreateError('');
    if (!backendUrl) {
      setCreating(false);
      setCreateError('Task creation is unavailable until the backend is deployed.');
      return;
    }
    const body = {
      projectId: createProjectId,
      title,
      request: requestText,
      agent: createAgent,
      ...(modelOverride ? { modelOverride } : {}),
      ...(reasoningOverride ? { reasoningOverride } : {}),
    };

    try {
      const value = await request(backendUrl, getAccessToken, '/factory/tasks', 'POST', body);
      if (!isTask(value)) throw new Error('Jarvis returned invalid task data. Try again.');
      setNotice('Task created and added to Ready.');
      setDialogOpen(false);
      setTasks([]);
      setReloadKey((current) => current + 1);
      window.setTimeout(() => createButtonRef.current?.focus(), 0);
    } catch (reason) {
      setCreateError(taskError(reason));
    } finally {
      setCreating(false);
    }
  };

  const sendToJarvis = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = conversationDraft.trim();
    if (!message || message.length > 20_000) return;
    conversationIntents.sendMessage(message);
    setConversationDraft('');
    navigate('/');
  };

  const openVoiceStart = () => {
    conversationIntents.focusVoiceStart();
    navigate('/');
  };

  const streamValues = taskIds.split(',').filter(Boolean).map((id) => liveStatuses[id] ?? 'connecting');
  const streamErrorCount = streamValues.filter((status) => status === 'error').length;
  const allConnected = streamValues.length > 0 && streamValues.every((status) => status === 'connected');
  const anyReconnecting = streamValues.some((status) => status === 'reconnecting');

  return (
    <section className="tasks-page" aria-labelledby="tasks-heading">
      <h1 id="tasks-heading">Tasks</h1>
      <p>Follow task state and progress, or create a task for an active project.</p>
      <div className="tasks-toolbar">
        <button
          ref={createButtonRef}
          className="primary-button"
          type="button"
          onClick={() => {
            const selected = projects.find((project) => project.id === createProjectId) ?? projects[0];
            if (selected) {
              setCreateProjectId(selected.id);
              setCreateAgent(selected.default_agent);
            }
            setDialogOpen(true);
            setCreateError('');
          }}
          disabled={!backendUrl || visibleProjectState !== 'ready' || projects.length === 0}
          aria-describedby="create-task-help"
        >
          Create task
        </button>
        <button className="secondary-button" type="button" onClick={() => setReloadKey((value) => value + 1)} disabled={!backendUrl}>
          Refresh tasks
        </button>
      </div>
      <p id="create-task-help" className="tasks-help">
        {visibleProjectState === 'loading' ? 'Loading projects before task creation is available.' :
          visibleProjectState === 'error' ? 'Retry project loading before creating a task.' :
            projects.length === 0 ? 'No active projects are available. Project registration is managed by Jarvis.' :
              'Create a task on an active project. Model and reasoning overrides apply to this task only.'}
      </p>
      {visibleProjectState === 'error' && (
        <div className="tasks-feedback" role="alert">
          <p>{visibleProjectError}</p>
          <button className="secondary-button" type="button" onClick={() => setProjectRetry((value) => value + 1)}>Retry projects</button>
        </div>
      )}
      {notice && <p className="tasks-feedback" role="status">{notice}</p>}

      <form className="task-filters" onSubmit={applyFilters}>
        <div className="task-filter-field">
          <label htmlFor="filter-project">Project</label>
          <select id="filter-project" value={filters.projectId} onChange={(event) => setFilters({ ...filters, projectId: event.target.value })}>
            <option value="">All projects</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </div>
        <div className="task-filter-field">
          <label htmlFor="filter-agent">Agent</label>
          <select id="filter-agent" value={filters.agent} onChange={(event) => setFilters({ ...filters, agent: event.target.value })}>
            <option value="">All agents</option>
            <option value="codex">Codex</option>
            <option value="copilot">Copilot</option>
          </select>
        </div>
        <div className="task-filter-field">
          <label htmlFor="filter-state">State</label>
          <select id="filter-state" value={filters.state} onChange={(event) => setFilters({ ...filters, state: event.target.value })}>
            <option value="">All states</option>
            {taskStates.map((state) => <option key={state} value={state}>{stateLabel(state)}</option>)}
          </select>
        </div>
        <div className="task-filter-field">
          <label htmlFor="filter-period">Period</label>
          <select id="filter-period" value={filters.period} onChange={(event) => setFilters({ ...filters, period: event.target.value })}>
            <option value="">Any time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>
        <div className="task-filter-field task-search-field">
          <label htmlFor="filter-search">Search</label>
          <input
            id="filter-search"
            type="search"
            value={filters.search}
            maxLength={100}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          />
        </div>
        <button className="secondary-button" type="submit">Apply filters</button>
      </form>

      <TaskReleaseBar
        backendUrl={backendUrl}
        getAccessToken={getAccessToken}
        projectId={appliedFilters.projectId}
      />

      {visibleTaskState === 'loading' && <p className="tasks-feedback" role="status">Loading tasks…</p>}
      {visibleTaskState === 'error' && (
        <div className="tasks-feedback" role="alert">
          <p>{visibleTaskError}</p>
          <button className="secondary-button" type="button" onClick={() => setReloadKey((value) => value + 1)}>Retry tasks</button>
        </div>
      )}
      {(visibleTaskState === 'ready' || tasks.length > 0) && (
        <>
          <div className="task-live-status" role="status" aria-live="polite">
            {streamErrorCount > 0
              ? <><span>Live updates need attention for {streamErrorCount} task{streamErrorCount === 1 ? '' : 's'}.</span> <button type="button" className="task-inline-button" onClick={() => setStreamKey((value) => value + 1)}>Reconnect</button></>
              : allConnected ? 'Live updates connected.' :
                anyReconnecting ? 'Reconnecting to live task updates…' :
                  streamValues.length > 0 ? 'Connecting to live task updates…' : 'Live updates connect while tasks are active.'}
          </div>
          {visibleTaskState === 'error' && tasks.length > 0 &&
            <p className="tasks-feedback" role="status">Showing the last loaded tasks because refresh failed.</p>}
          {tasks.length === 100 && <p className="task-limit-note">Showing the 100 most recent matching tasks. Refine filters to narrow the list.</p>}
          <div className="task-board" role="region" aria-label="Tasks by state">
            {columns.map((column) => {
              const items = tasks.filter((task) => column.states.includes(task.state));
              return (
                <section className="task-column" key={column.label} aria-labelledby={`column-${column.label.replace(/\W/g, '-').toLowerCase()}`}>
                  <header className="task-column-heading">
                    <h2 id={`column-${column.label.replace(/\W/g, '-').toLowerCase()}`}>{column.label}</h2>
                    <span aria-label={`${items.length} tasks`}>{items.length}</span>
                  </header>
                  {items.length === 0
                    ? <p className="task-column-empty">No matching tasks.</p>
                    : <ul className="task-card-list">
                      {items.map((task) => (
                        <li key={task.id}>
                          <article className="task-card" data-state={task.state} data-selected={selectedTaskId === task.id || undefined}
                            aria-labelledby={`task-title-${task.id}`}>
                            <h3 id={`task-title-${task.id}`}>
                              <button
                                className="task-card-title"
                                type="button"
                                aria-pressed={selectedTaskId === task.id}
                                aria-controls="context-panel"
                                onClick={(event) => {
                                  const trigger = event.currentTarget;
                                  selectedTaskIdRef.current = task.id;
                                  setSelectedTaskId(task.id);
                                  contextPanel.show({
                                    title: task.title,
                                    status: 'custom',
                                    content: <TaskDetailPage
                                      key={task.id}
                                      backendUrl={backendUrl}
                                      getAccessToken={getAccessToken}
                                      taskId={task.id}
                                      compact
                                    />,
                                  }, trigger);
                                }}
                              >
                                {task.title}
                              </button>
                            </h3>
                            <dl className="task-card-details">
                              <div><dt>Project</dt><dd>{projectName(projects, task.projectId)}</dd></div>
                              <div><dt>Agent</dt><dd>{agentLabel(task.agent)}</dd></div>
                              <div><dt>State</dt><dd><span className={`task-state task-state-${task.state.toLowerCase()}`}>{stateLabel(task.state)}</span></dd></div>
                              <div><dt>Activity</dt><dd>{task.activity || lastActivity[task.id] || 'No activity reported.'}</dd></div>
                              <div><dt>Last updated</dt><dd>{formatDate(lastUpdated[task.id] ?? task.finishedAt ?? task.createdAt)}</dd></div>
                              <div><dt>Duration</dt><dd>{formatDuration(task, now)}</dd></div>
                              <div><dt>Attempts</dt><dd>{task.attemptCount}</dd></div>
                              {task.branch && <div><dt>Branch</dt><dd><code>{task.branch}</code></dd></div>}
                              <div><dt>Pull request</dt><dd>Not reported</dd></div>
                              <div><dt>Checks</dt><dd>Not reported</dd></div>
                              <div><dt>Usage</dt><dd>Not reported</dd></div>
                            </dl>
                            <TaskControls
                              backendUrl={backendUrl}
                              getAccessToken={getAccessToken}
                              taskId={task.id}
                              state={task.state}
                              latestSessionEndReason={task.latestSessionEndReason}
                              onComplete={() => setReloadKey((value) => value + 1)}
                            />
                          </article>
                        </li>
                      ))}
                    </ul>}
                </section>
              );
            })}
          </div>
          <p className="task-data-note">Pull request, checks, and usage details will appear when those data sources are connected.</p>
        </>
      )}

      <form className="factory-composer" onSubmit={sendToJarvis}>
        <label className="visually-hidden" htmlFor="factory-ask-jarvis">Ask Jarvis</label>
        <textarea
          id="factory-ask-jarvis"
          rows={1}
          maxLength={20_000}
          placeholder="Ask Jarvis"
          value={conversationDraft}
          onChange={(event) => setConversationDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          aria-describedby="factory-composer-guidance"
        />
        <button className="primary-button" type="submit" disabled={!conversationDraft.trim()}>
          Send
        </button>
        <button className="secondary-button" type="button" onClick={openVoiceStart}>
          Start voice in Jarvis
        </button>
        <p id="factory-composer-guidance">
          Sending opens the conversation and uses its normal message queue. Voice opens Jarvis with its explicit Start voice control focused; the microphone stays off until you activate it.
        </p>
      </form>

      {dialogOpen && (
        <div className="task-dialog-backdrop">
          <section
            className="task-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-task-heading"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !creating) {
                event.preventDefault();
                closeDialog();
                return;
              }
              if (event.key === 'Tab') {
                const controls = event.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]',
                );
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <h2 id="create-task-heading">Create task</h2>
            <p>Choose the project and agent, then describe the work.</p>
            <form className="task-create-form" onSubmit={(event) => { void createTask(event); }}>
              <div className="task-form-field">
                <label htmlFor="create-project">Project</label>
                <select
                  id="create-project"
                  name="projectId"
                  required
                  autoFocus
                  value={createProjectId}
                  onChange={(event) => {
                    const selected = projects.find((project) => project.id === event.target.value);
                    setCreateProjectId(event.target.value);
                    if (selected) setCreateAgent(selected.default_agent);
                  }}
                >
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </div>
              <div className="task-form-field">
                <label htmlFor="create-agent">Agent</label>
                <select id="create-agent" name="agent" value={createAgent} onChange={(event) => setCreateAgent(event.target.value as Agent)}>
                  <option value="codex">Codex</option>
                  <option value="copilot">Copilot</option>
                </select>
              </div>
              <div className="task-form-field">
                <label htmlFor="create-title">Task title</label>
                <input id="create-title" name="title" required maxLength={200} />
              </div>
              <div className="task-form-field">
                <label htmlFor="create-request">Request</label>
                <textarea id="create-request" name="request" required maxLength={50_000} rows={5} />
              </div>
              <div className="task-form-field">
                <label htmlFor="create-model">Model override (optional)</label>
                <input id="create-model" name="modelOverride" maxLength={100} />
              </div>
              <div className="task-form-field">
                <label htmlFor="create-reasoning">Reasoning override (optional)</label>
                <input id="create-reasoning" name="reasoningOverride" maxLength={32} />
              </div>
              {createError && <p className="tasks-feedback" role="alert">{createError}</p>}
              <div className="task-dialog-actions">
                <button className="primary-button" type="submit" disabled={creating || !backendUrl}>
                  {creating ? 'Creating task…' : 'Create task'}
                </button>
                <button className="secondary-button" type="button" onClick={closeDialog} disabled={creating}>Cancel</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
