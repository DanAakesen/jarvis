import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import {
  isFactoryBoard,
  type BoardCard, type FactoryBoard, type FactoryBoardColumnId, type FactoryBoardTask,
} from '@jarvis/contracts';
import { TaskWindowLink } from '../TaskWindowLink';
import { Modal } from '../Modal';
import { awaitWithSignal, backendFetch } from '../backend-request';
import { useFactoryBoardLiveState } from '../factory-board-store';
import { useContextPanel } from '../context-panel-state';
import { TaskDetailPage } from './TaskDetailPage';
import { TaskReleaseBar } from './TaskReleaseBar';
import { TaskControls } from './TaskControls';
import { CreateProjectDialog } from './ProjectsPage';
import { Loader } from '../Loader';

interface Project {
  id: string;
  name: string;
  default_agent: 'codex' | 'copilot';
}

type TaskState = FactoryBoardTask['state'];
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

interface TaskFilters {
  projectId: string;
  agent: string;
  state: string;
  period: string;
  search: string;
}

type PageState = 'loading' | 'ready' | 'error';
type Props = { backendUrl: string | null; getAccessToken: () => Promise<string> };

const taskStates: TaskState[] = ['Ready', 'Running', 'PauseRequested', 'Paused', 'NeedsAttention', 'Done', 'Cancelled'];
const columnLabels: Record<FactoryBoardColumnId, string> = {
  backlog: 'Backlog',
  needs_dan: 'Needs Dan',
  ready: 'Ready',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
};
const maxCardsPerColumn = 100;
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

async function request(
  backendUrl: string,
  getAccessToken: () => Promise<string>,
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const resource = path.startsWith('/factory/board') ? 'board' : 'task';
  let token: string;
  try {
    token = signal ? await awaitWithSignal(getAccessToken, signal) : await getAccessToken();
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
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    throw new Error(`Jarvis could not reach the ${resource} service. Try again.`, { cause });
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Your Microsoft sign-in needs attention. Sign in again.');
    if (response.status === 503) throw new Error(`${resource === 'board' ? 'Board' : 'Task'} data could not be loaded. Try again.`);
    throw new Error(`Jarvis could not ${method === 'GET' ? 'load' : 'create'} ${resource} data (HTTP ${response.status}).`);
  }
  try {
    return await response.json();
  } catch (cause) {
    throw new Error(`Jarvis returned invalid ${resource} data. Try again.`, { cause });
  }
}

async function loadProjects(backendUrl: string, getAccessToken: () => Promise<string>): Promise<Project[]> {
  const value: unknown = await request(backendUrl, getAccessToken, '/factory/projects');
  if (!Array.isArray(value) || !value.every(isProject)) throw new Error('Jarvis returned invalid project data. Try again.');
  return value;
}

function matchesFilters(card: BoardCard, filters: TaskFilters, updatedAfter: number | null): boolean {
  const agent = card.task?.agent ?? card.issue.worker?.toLowerCase();
  if (filters.agent && agent !== filters.agent) return false;
  if (filters.state && card.task?.state !== filters.state) return false;
  if (updatedAfter !== null && Date.parse(card.issue.updatedAt) < updatedAfter) return false;
  const search = filters.search.trim().toLowerCase();
  return !search || [
    card.issue.title, `#${card.issue.number}`, card.issue.taskCode ?? '',
    ...card.issue.labels, card.task?.branch ?? '',
  ].join(' ').toLowerCase().includes(search);
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

const collapsedColumnsKey = 'jarvis.kanban.collapsedColumns';
const filtersOpenKey = 'jarvis.kanban.filtersOpen';
function readStoredList(key: string): ReadonlySet<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 12) : []);
  } catch {
    return new Set();
  }
}
function readStoredFlag(key: string, fallback: boolean) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === '1';
  } catch {
    return fallback;
  }
}
function writeStored(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Storage can be blocked; the board then simply forgets. */ }
}

function KanbanIcon({ name }: { name: 'search' | 'plus' | 'clock' | 'branch' | 'chevron' }) {
  const common = { 'aria-hidden': true as const, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'search': return <svg {...common}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>;
    case 'chevron': return <svg {...common}><path d="m8 10 4 4 4-4" /></svg>;
    case 'plus': return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case 'clock': return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;
    case 'branch': return <svg {...common}><circle cx="7" cy="5.5" r="2" /><circle cx="7" cy="18.5" r="2" /><circle cx="17" cy="8" r="2" /><path d="M7 7.5v9M17 10c0 4-10 2.5-10 6.5" /></svg>;
  }
}

/** Kanban column dots use one class per column; the column name is always shown beside the dot. */
function columnTone(label: string): string {
  return label.replace(/\W+/g, '-').toLowerCase();
}

/** What the card says when the runtime has not reported an activity line; derived only from the task state. */
function stateSummary(task: FactoryBoardTask): string {
  switch (task.state) {
    case 'Ready': return task.startedAt ? 'Waiting to continue' : 'Not started';
    case 'Running': return 'Working';
    case 'PauseRequested': return 'Pause requested';
    case 'Paused': return 'Paused';
    case 'NeedsAttention': return 'Needs your attention';
    case 'Done': return 'Completed';
    case 'Cancelled': return 'Cancelled';
  }
}

/** The Software Factory Kanban board: the only task list, with create-task and create-project dialogs. */
export function TasksPage({ backendUrl, getAccessToken }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectState, setProjectState] = useState<PageState>(backendUrl ? 'loading' : 'error');
  const [projectError, setProjectError] = useState(backendUrl ? '' : 'Projects unavailable.');
  const [projectRetry, setProjectRetry] = useState(0);
  const [settledProjectKey, setSettledProjectKey] = useState('');
  const [snapshot, setSnapshot] = useState<{ key: string; board: FactoryBoard } | null>(null);
  const [taskState, setTaskState] = useState<PageState>(backendUrl ? 'loading' : 'error');
  const [error, setError] = useState(backendUrl ? '' : 'Board unavailable.');
  const [settledTaskKey, setSettledTaskKey] = useState('');
  const [settledReloadKey, setSettledReloadKey] = useState(-1);
  const [filters, setFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);
  // Space on the board (Dan, 8 October): columns and the search/filter section collapse, remembered on this device.
  const [collapsedColumns, setCollapsedColumns] = useState<ReadonlySet<string>>(() => readStoredList(collapsedColumnsKey));
  const [filtersOpen, setFiltersOpen] = useState(() => readStoredFlag(filtersOpenKey, !(window.matchMedia?.('(max-width: 700px)').matches ?? false)));
  useEffect(() => { writeStored(collapsedColumnsKey, JSON.stringify([...collapsedColumns])); }, [collapsedColumns]);
  useEffect(() => { writeStored(filtersOpenKey, filtersOpen ? '1' : '0'); }, [filtersOpen]);
  const toggleColumn = (label: string) => setCollapsedColumns((current) => {
    const next = new Set(current);
    if (next.has(label)) next.delete(label); else next.add(label);
    return next;
  });
  const [reloadKey, setReloadKey] = useState(0);
  const liveState = useFactoryBoardLiveState();
  const previousLiveState = useRef(liveState);
  const [notice, setNotice] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createProjectId, setCreateProjectId] = useState('');
  const [createAgent, setCreateAgent] = useState<Agent>('copilot');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const selectedTaskIdRef = useRef('');
  const contextPanel = useContextPanel();
  const closeContextPanel = contextPanel.close;
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const createProjectButtonRef = useRef<HTMLButtonElement>(null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectRequestKey = `${backendUrl ?? ''}:${projectRetry}`;
  // Live refreshes change reloadKey, not the dataset identity: keep the board mounted while fetching.
  const taskRequestKey = `${backendUrl ?? ''}:${filters.projectId}`;
  const board = snapshot?.key === taskRequestKey ? snapshot.board : null;
  const visibleProjectState: PageState = !backendUrl ? 'error' :
    settledProjectKey === projectRequestKey ? projectState : 'loading';
  const visibleProjectError = backendUrl ? projectError : 'Projects unavailable.';
  const visibleTaskState: PageState = !backendUrl ? 'error' :
    !filters.projectId ? (visibleProjectState === 'loading' ? 'loading' : 'ready') :
      settledTaskKey === taskRequestKey ? taskState : 'loading';
  const visibleTaskError = backendUrl ? error : 'Board unavailable.';
  const refreshing = !!backendUrl && !!filters.projectId &&
    (settledTaskKey !== taskRequestKey || settledReloadKey !== reloadKey);

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
      const chooseProject = (current: TaskFilters) => ({
        ...current,
        projectId: loaded.some((project) => project.id === current.projectId) ? current.projectId : loaded[0]?.id ?? '',
      });
      setFilters(chooseProject);
      setAppliedFilters(chooseProject);
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
    const controller = new AbortController();
    if (!backendUrl || !filters.projectId) return () => { active = false; controller.abort(); };
    const query = new URLSearchParams({ project: filters.projectId });
    void request(backendUrl, getAccessToken, `/factory/board?${query}`, 'GET', undefined, controller.signal).then((value) => {
      if (!active) return;
      if (!isFactoryBoard(value) || value.project.id !== filters.projectId) {
        throw new Error('Jarvis returned invalid board data for this project. Try again.');
      }
      setSnapshot({ key: taskRequestKey, board: value });
      setTaskState('ready');
      setError('');
      setSettledTaskKey(taskRequestKey);
      setSettledReloadKey(reloadKey);
    }).catch((reason: unknown) => {
      if (!active) return;
      setTaskState('error');
      setError(taskError(reason));
      setSettledTaskKey(taskRequestKey);
      setSettledReloadKey(reloadKey);
    });
    return () => { active = false; controller.abort(); };
  }, [backendUrl, getAccessToken, filters.projectId, reloadKey, taskRequestKey]);

  useEffect(() => {
    const previous = previousLiveState.current;
    previousLiveState.current = liveState;
    if (!backendUrl || liveState.backendUrl !== backendUrl || !filters.projectId) return;
    const update = liveState.update;
    const boardChanged = update !== previous.update && update?.projectId === filters.projectId;
    const reconnected = liveState.status === 'connected' &&
      (previous.status !== 'connected' || previous.backendUrl !== backendUrl);
    if (!boardChanged && !reconnected) return;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => setReloadKey((value) => value + 1), 150);
  }, [backendUrl, filters.projectId, liveState]);

  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = null;
  }, [taskRequestKey]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    applyNow(filters);
  };

  // Kanban applies filters as they change; search waits for a short pause in typing.
  function applyNow(next: TaskFilters) {
    setFilters(next);
    if (next.projectId !== filters.projectId && selectedTaskIdRef.current) {
      closeContextPanel();
      selectedTaskIdRef.current = '';
      setSelectedTaskId('');
    }
    setAppliedFilters({ ...next });
  }
  const pendingSearch = filters.search !== appliedFilters.search ? filters.search : null;
  useEffect(() => {
    if (pendingSearch === null) return undefined;
    const timer = setTimeout(() => {
      setAppliedFilters((current) => ({ ...current, search: pendingSearch }));
    }, 350);
    return () => clearTimeout(timer);
  }, [pendingSearch]);

  const selectTask = (task: FactoryBoardTask, title: string, issueNumber: number, trigger: HTMLElement) => {
    selectedTaskIdRef.current = task.id;
    setSelectedTaskId(task.id);
    contextPanel.show({
      title,
      status: 'custom',
      content: <TaskDetailPage
        key={task.id}
        backendUrl={backendUrl}
        getAccessToken={getAccessToken}
        taskId={task.id}
        compact
      />,
    }, () => {
      if (trigger.isConnected && !trigger.closest('[hidden],[inert]')) return trigger;
      const replacement = document.getElementById(`issue-title-${issueNumber}`)?.querySelector<HTMLElement>('.task-card-title');
      return replacement && !replacement.closest('[hidden],[inert]') ? replacement : createProjectButtonRef.current;
    });
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
      setCreateError('Task creation unavailable.');
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
      setNotice('Task created. Linked issues appear in their GitHub Project column.');
      setDialogOpen(false);
      setReloadKey((current) => current + 1);
      window.setTimeout(() => createButtonRef.current?.focus(), 0);
    } catch (reason) {
      setCreateError(taskError(reason));
    } finally {
      setCreating(false);
    }
  };

  const createDialog = dialogOpen && (
    <Modal title="Create task" titleId="create-task-heading" onClose={closeDialog} busy={creating} className="task-dialog">
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
    </Modal>
  );
  const openCreateDialog = () => {
    const selected = projects.find((project) => project.id === filters.projectId) ?? projects[0];
    if (selected) {
      setCreateProjectId(selected.id);
      setCreateAgent(selected.default_agent);
    }
    setDialogOpen(true);
    setCreateError('');
  };
  const activeFilterCount = [filters.search.trim(), filters.agent, filters.state, filters.period].filter(Boolean).length;
  const createUnavailable = !backendUrl || visibleProjectState !== 'ready' || projects.length === 0;
  const createHelp = visibleProjectState === 'loading' ? 'Loading projects before task creation is available.' :
    visibleProjectState === 'error' ? 'Retry project loading before creating a task.' :
      projects.length === 0 ? 'No active projects are available. Project registration is managed by Jarvis.' :
        'Create a task on an active project. Model and reasoning overrides apply to this task only.';
  const liveStatus = liveState.backendUrl === backendUrl ? liveState.status : 'unavailable';
  const liveStatusText = liveStatus === 'connected' ? 'Live board updates connected.' :
    liveStatus === 'reconnecting' ? 'Reconnecting to live board updates. The board may be out of date.' :
      liveStatus === 'connecting' ? 'Connecting to live board updates…' :
        'Live board updates are unavailable. Refresh the board to check for changes.';
  const updatedAfter = board && appliedFilters.period ? Date.parse(board.fetchedAt) - Number(appliedFilters.period) * 86_400_000 : null;
  const columns = board?.columns.map((column) => ({
    ...column,
    label: columnLabels[column.id],
    cards: column.cards.filter((card) => matchesFilters(card, appliedFilters, updatedAfter)),
  })) ?? [];

  {
    return (
      <section className="tasks-page kanban-page" aria-labelledby="tasks-heading">
        <header className="kanban-header">
          <h1 id="tasks-heading">Kanban</h1>
          {board && (
            <ul className="kanban-pulse" aria-label="Board summary">
              <li data-tone="running"><span aria-hidden="true" />{columns.find((column) => column.id === 'in_progress')?.cards.length ?? 0} in progress</li>
              <li data-tone="needs-attention"><span aria-hidden="true" />{columns.find((column) => column.id === 'needs_dan')?.cards.length ?? 0} needs Dan</li>
              <li data-tone="done"><span aria-hidden="true" />{columns.find((column) => column.id === 'done')?.cards.length ?? 0} done</li>
            </ul>
          )}
          <div className="kanban-header-actions">
          <button className="secondary-button" type="button" disabled={!backendUrl || !filters.projectId || refreshing}
            onClick={() => setReloadKey((value) => value + 1)}>{refreshing ? 'Refreshing board…' : 'Refresh board'}</button>
          <button className="secondary-button kanban-create kanban-create-project" type="button" ref={createProjectButtonRef}
            onClick={() => setProjectDialogOpen(true)} disabled={!backendUrl}>
            <KanbanIcon name="plus" />
            <span>Create project</span>
          </button>
          <button ref={createButtonRef} className="primary-button kanban-create" type="button" onClick={openCreateDialog}
            disabled={createUnavailable} aria-describedby="create-task-help">
            <KanbanIcon name="plus" />
            <span>Create task</span>
          </button>
          </div>
        </header>
        <p id="create-task-help" className={createUnavailable ? 'tasks-help' : 'visually-hidden'}>{createHelp}</p>
        {visibleProjectState === 'error' && (
          <div className="tasks-feedback" role="alert">
            <p>{visibleProjectError}</p>
            <button className="secondary-button" type="button" onClick={() => setProjectRetry((value) => value + 1)}>Retry projects</button>
          </div>
        )}
        {notice && <p className="tasks-feedback" role="status">{notice}</p>}

        <section className="kanban-filter-panel" data-open={filtersOpen} aria-label="Search and filters">
        <button className="kanban-filter-toggle" type="button" aria-expanded={filtersOpen} aria-controls="kanban-filter-body"
          onClick={() => setFiltersOpen((open) => !open)}>
          <KanbanIcon name="search" />
          <span>Search and filters</span>
          {activeFilterCount > 0 && <span className="kanban-filter-badge">{activeFilterCount} active</span>}
          <span className="kanban-chevron" aria-hidden="true"><KanbanIcon name="chevron" /></span>
        </button>
        <div id="kanban-filter-body" className="kanban-filter-body" inert={!filtersOpen}>
        <form className="kanban-filters" role="search" aria-label="Filter issues" onSubmit={applyFilters}>
          <label className="kanban-search">
            <KanbanIcon name="search" />
            <span className="visually-hidden">Search issues</span>
            <input id="filter-search" type="search" placeholder="Search issues…" value={filters.search} maxLength={100}
              onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
          </label>
          <label className="kanban-select">
            <span className="visually-hidden">Project</span>
            <select id="filter-project" value={filters.projectId} disabled={visibleProjectState !== 'ready' || projects.length === 0}
              onChange={(event) => applyNow({ ...filters, projectId: event.target.value })}>
              {!filters.projectId && <option value="">Select a project</option>}
              {projects.map((project) => <option key={project.id} value={project.id}>Project: {project.name}</option>)}
            </select>
          </label>
          <label className="kanban-select">
            <span className="visually-hidden">Agent</span>
            <select id="filter-agent" value={filters.agent} onChange={(event) => applyNow({ ...filters, agent: event.target.value })}>
              <option value="">Agent: All</option>
              <option value="codex">Agent: Codex</option>
              <option value="copilot">Agent: Copilot</option>
            </select>
          </label>
          <label className="kanban-select">
            <span className="visually-hidden">Task state</span>
            <select id="filter-state" value={filters.state} onChange={(event) => applyNow({ ...filters, state: event.target.value })}>
              <option value="">Task state: All</option>
              {taskStates.map((state) => <option key={state} value={state}>State: {stateLabel(state)}</option>)}
            </select>
          </label>
          <label className="kanban-select">
            <span className="visually-hidden">Updated</span>
            <select id="filter-period" value={filters.period} onChange={(event) => applyNow({ ...filters, period: event.target.value })}>
              <option value="">Updated: Any time</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </label>
        </form>
        </div>
        </section>

        <TaskReleaseBar backendUrl={backendUrl} getAccessToken={getAccessToken} projectId={filters.projectId} variant="trail" />

        {visibleTaskState === 'loading' && <Loader variant="cards" label="Loading GitHub board…" />}
        {visibleProjectState === 'ready' && projects.length === 0 &&
          <p className="tasks-feedback">No active projects are available for a GitHub board. Create a project to begin.</p>}
        {visibleTaskState === 'error' && (
          <div className="tasks-feedback" role="alert">
            <p>{visibleTaskError}</p>
            <button className="secondary-button" type="button" disabled={refreshing}
              onClick={() => setReloadKey((value) => value + 1)}>Retry board</button>
          </div>
        )}
        {board && (
          <>
            <p className="tasks-help">
              <a href={`https://github.com/${board.project.repo}`} target="_blank" rel="noopener noreferrer">{board.project.repo}</a>
              {' · '}Fetched <time dateTime={board.fetchedAt}>{new Date(board.fetchedAt).toLocaleString()}</time>.
              {' '}Open issues and issues closed in the last 14 days.
            </p>
            <div className="task-live-status kanban-live-status" role="status" aria-live="polite">{liveStatusText}</div>
            {visibleTaskState === 'error' &&
              <p className="tasks-feedback" role="status">Showing the last loaded board because refresh failed.</p>}
            {board.stale &&
              <p className="tasks-feedback" role="status">GitHub is unavailable. Showing a cached board; placement may be out of date.</p>}
            <div className="task-board kanban-board" role="region" aria-label="Issues by GitHub Project column"
              style={{ '--kanban-columns': columns.map((column) => collapsedColumns.has(column.label) ? '52px' : 'minmax(240px, 1fr)').join(' ') } as CSSProperties}>
              {columns.map((column) => {
                const items = column.cards;
                const headingId = `column-${columnTone(column.label)}`;
                return (
                  <section className="task-column kanban-column" key={column.label} aria-labelledby={headingId}
                    data-collapsed={collapsedColumns.has(column.label) || undefined}>
                    <header className="kanban-column-heading">
                      <h2 id={headingId}>
                        <button className="kanban-column-toggle" type="button" aria-expanded={!collapsedColumns.has(column.label)}
                          aria-controls={`${headingId}-cards`} onClick={() => toggleColumn(column.label)}>
                          <span className={`kanban-dot kanban-dot-${columnTone(column.label)}`} aria-hidden="true" />
                          <span className="kanban-column-label">{column.label}</span>
                          <span className="kanban-chevron" aria-hidden="true"><KanbanIcon name="chevron" /></span>
                        </button>
                      </h2>
                      <span className="kanban-count" aria-label={`${items.length} issues`}>{items.length}</span>
                    </header>
                    <div id={`${headingId}-cards`} className="kanban-column-body" hidden={collapsedColumns.has(column.label)}>
                    {items.length === 0
                      ? <p className="task-column-empty">No matching issues.</p>
                      : <ul className="task-card-list">
                        {items.slice(0, maxCardsPerColumn).map((card, index) => (
                          <li key={card.issue.number} style={{ '--i': index } as CSSProperties}>
                            <article className="task-card kanban-card" data-state={card.task?.state}
                              data-selected={!!card.task && selectedTaskId === card.task.id || undefined} aria-labelledby={`issue-title-${card.issue.number}`}>
                              <h3 id={`issue-title-${card.issue.number}`}>
                                {card.task ? <button className="task-card-title" type="button" aria-pressed={selectedTaskId === card.task.id}
                                  aria-controls="context-panel" onClick={(event) => {
                                    if (card.task) selectTask(card.task, card.issue.title, card.issue.number, event.currentTarget);
                                  }}>{card.issue.title}</button> :
                                  <a className="task-card-title" href={card.issue.url} target="_blank" rel="noopener noreferrer">{card.issue.title}</a>}
                              </h3>
                              <p className="kanban-meta">
                                <a href={card.issue.url} target="_blank" rel="noopener noreferrer">#{card.issue.number}</a>
                                {card.issue.taskCode && <span>{card.issue.taskCode}</span>}
                              </p>
                              {(card.task || card.issue.worker) && <ul className="kanban-chips" aria-label="Worker and task state">
                                {card.task ? <>
                                  <li>{agentLabel(card.task.agent)}</li>
                                  <li>{stateLabel(card.task.state)}</li>
                                </> : card.issue.worker && <li>{card.issue.worker}</li>}
                              </ul>}
                              <p className="kanban-activity">{card.task ? card.task.activity || stateSummary(card.task) : 'No Factory task linked.'}</p>
                              {card.issue.blockedBy.length > 0 &&
                                <p className="kanban-meta">Blocked by {card.issue.blockedBy.map((number) => `#${number}`).join(', ')}</p>}
                              {card.pr && <p className="kanban-meta">
                                <a href={card.pr.url} target="_blank" rel="noopener noreferrer">PR #{card.pr.number}</a>
                                <span>{card.pr.draft ? 'Draft · ' : ''}Checks: {card.pr.checks}</span>
                              </p>}
                              {card.task && <>
                                <p className="kanban-meta">
                                  <KanbanIcon name="clock" />
                                  <span>{card.task.attemptCount} attempt{card.task.attemptCount === 1 ? '' : 's'}
                                    {' · '}{card.task.startedAt ? <>Started <time dateTime={card.task.startedAt}>{new Date(card.task.startedAt).toLocaleString()}</time></> : 'Start not reported'}</span>
                                </p>
                                <p className="kanban-meta">
                                  <KanbanIcon name="branch" />
                                  {card.task.branch ? <code>{card.task.branch}</code> : <span className="kanban-muted">Branch not reported</span>}
                                </p>
                              <TaskControls
                                backendUrl={backendUrl}
                                getAccessToken={getAccessToken}
                                taskId={card.task.id}
                                state={card.task.state}
                                latestSessionEndReason={card.task.latestSessionEndReason}
                                onComplete={() => setReloadKey((value) => value + 1)}
                              />
                              <div className="kanban-card-actions">
                                <button className="kanban-card-action" type="button" aria-controls="context-panel"
                                  onClick={(event) => {
                                    if (card.task) selectTask(card.task, card.issue.title, card.issue.number, event.currentTarget);
                                  }}>
                                  View details
                                </button>
                                <TaskWindowLink className="kanban-card-action kanban-card-open" taskId={card.task.id} title={card.issue.title}
                                  aria-label={`Open ${card.issue.title} in a window`}>
                                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="3.5" y="5" width="17" height="14" rx="2.5" /><path d="M3.5 9h17M7 7h.01M9.5 7h.01" />
                                  </svg>
                                </TaskWindowLink>
                              </div>
                              </>}
                            </article>
                          </li>
                        ))}
                      </ul>}
                    {items.length > maxCardsPerColumn &&
                      <p className="task-limit-note">Showing {maxCardsPerColumn} of {items.length} matching issues. Refine the filters to find another issue.</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}

        {createDialog}
        {projectDialogOpen && (
          <CreateProjectDialog
            backendUrl={backendUrl}
            getAccessToken={getAccessToken}
            onClose={() => {
              setProjectDialogOpen(false);
              window.setTimeout(() => createProjectButtonRef.current?.focus(), 0);
            }}
            onAdded={(repository) => {
              setProjectDialogOpen(false);
              setNotice(`Added ${repository} as a project.`);
              setProjectRetry((value) => value + 1);
              window.setTimeout(() => createProjectButtonRef.current?.focus(), 0);
            }}
          />
        )}
      </section>
    );
  }

}
