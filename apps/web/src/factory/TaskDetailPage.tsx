import { useEffect, useId, useState } from 'react';
import { backendFetch } from '../backend-request';
import { Link } from 'react-router-dom';
import { streamTaskEvents } from '../task-events';
import { fetchReleaseView } from './release-data';
import type { PullRequest, ReleaseView } from './release-data';
import { TaskControls } from './TaskControls';
import { TaskWindowLink } from '../TaskWindowLink';
import { Loader } from '../Loader';

type TaskState = 'Ready' | 'Running' | 'PauseRequested' | 'Paused' | 'NeedsAttention' | 'Done' | 'Cancelled';
type TaskEventSource = 'runner' | 'backend' | 'github' | 'dan';

interface TaskEvent {
  id: string;
  taskId?: string;
  type: string;
  summary: string | null;
  payload: unknown;
  payloadTruncated: boolean;
  source: TaskEventSource;
  at: string;
}

const usageSources = ['sandbox', 'jarvis_model', 'voice', 'codex', 'copilot'] as const;
const usageMetrics = ['minutes', 'input_tokens', 'output_tokens', 'turns', 'premium_requests', 'screen_frames'] as const;

interface TaskUsageRecord {
  id: string | null;
  source: typeof usageSources[number];
  metric: typeof usageMetrics[number];
  quantity: number;
  costDkk: number | null;
  sandboxSessionId: string | null;
  at: string;
  estimated: boolean;
}

interface TaskDetail {
  id: string;
  title: string;
  request: string;
  projectId: string;
  originMessageId: string | null;
  source: 'board' | 'voice' | 'chat';
  agent: 'codex' | 'copilot';
  modelOverride: string | null;
  reasoningOverride: string | null;
  state: TaskState;
  latestSessionEndReason?: 'done' | 'cancelled' | 'crashed' | 'idle' | 'idle_expired' | null;
  attemptCount: number;
  branch: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  events: TaskEvent[];
  usage: TaskUsageRecord[];
}

interface ProjectLink {
  id: string;
  name: string;
  repo: string;
}

interface OriginMessage {
  id: string;
  role: 'dan' | 'jarvis';
  text: string;
  at: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; task: TaskDetail };

type StreamStatus = 'connecting' | 'connected' | 'reconnecting' | 'error';

const gibibyte = 1024 ** 3;
const eventPageSize = 100;
const maxEventOffset = 10_000;
const taskStates: TaskState[] = ['Ready', 'Running', 'PauseRequested', 'Paused', 'NeedsAttention', 'Done', 'Cancelled'];
const taskSources: TaskEventSource[] = ['runner', 'backend', 'github', 'dan'];
const repositoryPattern = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const maxSqlBigInt = 9_223_372_036_854_775_807n;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isSqlId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= maxSqlBigInt;
}

function isTaskEvent(value: unknown): value is TaskEvent {
  return isObject(value) && isSqlId(value.id) &&
    (value.taskId === undefined || typeof value.taskId === 'string') &&
    typeof value.type === 'string' && (typeof value.summary === 'string' || value.summary === null) &&
    typeof value.payloadTruncated === 'boolean' && taskSources.includes(value.source as TaskEventSource) &&
    isDate(value.at);
}

function isTaskUsageRecord(value: unknown): value is TaskUsageRecord {
  return isObject(value) &&
    (value.id === null || (typeof value.id === 'string' && /^[1-9]\d{0,18}$/.test(value.id))) &&
    usageSources.includes(value.source as typeof usageSources[number]) &&
    usageMetrics.includes(value.metric as typeof usageMetrics[number]) &&
    typeof value.quantity === 'number' && Number.isFinite(value.quantity) && value.quantity >= 0 &&
    (value.costDkk === null || (typeof value.costDkk === 'number' && Number.isFinite(value.costDkk) && value.costDkk >= 0)) &&
    (value.sandboxSessionId === null ||
      (typeof value.sandboxSessionId === 'string' && /^[1-9]\d{0,18}$/.test(value.sandboxSessionId))) &&
    typeof value.at === 'string' && Number.isFinite(Date.parse(value.at)) &&
    typeof value.estimated === 'boolean';
}

function isTaskDetail(value: unknown): value is TaskDetail {
  return isObject(value) && isSqlId(value.id) && typeof value.title === 'string' &&
    typeof value.request === 'string' && isSqlId(value.projectId) &&
    (value.originMessageId === null || isSqlId(value.originMessageId)) &&
    ['board', 'voice', 'chat'].includes(String(value.source)) &&
    (value.agent === 'codex' || value.agent === 'copilot') &&
    (value.modelOverride === null || typeof value.modelOverride === 'string') &&
    (value.reasoningOverride === null || typeof value.reasoningOverride === 'string') &&
    taskStates.includes(value.state as TaskState) && typeof value.attemptCount === 'number' &&
    (value.latestSessionEndReason === undefined || value.latestSessionEndReason === null ||
      ['done', 'cancelled', 'crashed', 'idle', 'idle_expired'].includes(String(value.latestSessionEndReason))) &&
    Number.isSafeInteger(value.attemptCount) && value.attemptCount >= 0 &&
    (typeof value.branch === 'string' || value.branch === null) && isDate(value.createdAt) &&
    (value.startedAt === null || isDate(value.startedAt)) &&
    (value.finishedAt === null || isDate(value.finishedAt)) &&
    Array.isArray(value.events) && value.events.every(isTaskEvent) &&
    Array.isArray(value.usage) && value.usage.length <= 1000 && value.usage.every(isTaskUsageRecord);
}

function isProjectLink(value: unknown): value is ProjectLink {
  return isObject(value) && isSqlId(value.id) && typeof value.name === 'string' &&
    typeof value.repo === 'string' && repositoryPattern.test(value.repo);
}

function isPullRequest(value: unknown): value is PullRequest {
  return isObject(value) && typeof value.id === 'string' &&
    typeof value.number === 'number' && Number.isSafeInteger(value.number) && value.number > 0 &&
    typeof value.branch === 'string' && typeof value.headSha === 'string' &&
    ['open', 'merged', 'closed'].includes(String(value.state)) &&
    ['pending', 'passed', 'failed'].includes(String(value.checks)) &&
    (value.taskId === null || isSqlId(value.taskId));
}

function isProjectReleaseData(
  value: unknown,
  projectId: string,
): value is Pick<ReleaseView, 'project' | 'pullRequests'> {
  return isObject(value) && isObject(value.project) && value.project.id === projectId &&
    typeof value.project.name === 'string' && typeof value.project.repo === 'string' &&
    repositoryPattern.test(value.project.repo) && Array.isArray(value.pullRequests) &&
    value.pullRequests.every(isPullRequest);
}

function isOriginMessage(value: unknown): value is OriginMessage {
  return isObject(value) && isSqlId(value.id) && (value.role === 'dan' || value.role === 'jarvis') &&
    typeof value.text === 'string' && isDate(value.at);
}

function formatDisk(bytes: unknown): string {
  return typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes >= 0
    ? `${(bytes / gibibyte).toFixed(2)} GiB`
    : 'Unavailable';
}

function formatDate(value: string | null): string {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not started';
}

function usageLabel(metric: TaskUsageRecord['metric']): string {
  return {
    minutes: 'Sandbox minutes',
    input_tokens: 'Input tokens',
    output_tokens: 'Output tokens',
    turns: 'Agent turns',
    premium_requests: 'Premium requests',
    screen_frames: 'Screen frames',
  }[metric];
}

function sourceLabel(record: TaskUsageRecord): string {
  if (record.source === 'sandbox') {
    return record.sandboxSessionId ? `Sandbox session ${record.sandboxSessionId}` : 'Sandbox';
  }
  return {
    jarvis_model: 'Jarvis model',
    voice: 'Voice',
    codex: 'Codex',
    copilot: 'Copilot',
  }[record.source];
}

function formatQuantity(record: TaskUsageRecord): string {
  const amount = new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: record.metric === 'minutes' ? 2 : 0,
    maximumFractionDigits: record.metric === 'minutes' ? 2 : 0,
  }).format(record.quantity);
  return record.metric === 'minutes' ? `${amount} min` : amount;
}

function diskReading(event: TaskEvent): Record<string, unknown> | null {
  if (event.payloadTruncated || !isObject(event.payload)) return null;
  const data = event.payload.data;
  return (event.type === 'disk_snapshot' || event.type === 'disk_low') && isObject(data) ? data : null;
}

function attentionReason(events: TaskEvent[]): string | null {
  const event = events.find(({ type, payload }) =>
    type === 'state_changed' && isObject(payload) && payload.to === 'NeedsAttention' &&
    typeof payload.reason === 'string');
  return event && isObject(event.payload) && typeof event.payload.reason === 'string'
    ? event.payload.reason
    : null;
}

function mergeEvents(current: TaskEvent[], incoming: TaskEvent[]): TaskEvent[] {
  const events = new Map(current.map((event) => [event.id, event]));
  incoming.forEach((event) => events.set(event.id, event));
  return [...events.values()].sort((left, right) =>
    Date.parse(left.at) - Date.parse(right.at) || (BigInt(left.id) < BigInt(right.id) ? -1 : 1));
}

function branchUrl(project: ProjectLink | null, branch: string | null): string | null {
  if (!project || !branch) return null;
  const path = branch.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${project.repo}/tree/${path}`;
}

async function fetchJson(
  backendUrl: string,
  getAccessToken: () => Promise<string>,
  path: string,
  signal?: AbortSignal,
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
      headers: { Authorization: `${['Bear', 'er'].join('')} ${token}` },
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    throw new Error('Jarvis could not reach the task service. Try again.', { cause });
  }
  if (!response.ok) {
    if (response.status === 404) throw new Error('This task is no longer available.');
    if (response.status === 401) throw new Error('Your Microsoft sign-in needs attention. Sign in again.');
    throw new Error(`Task details could not be loaded (HTTP ${response.status}).`);
  }
  try {
    return await response.json();
  } catch (cause) {
    throw new Error('Jarvis returned invalid task details.', { cause });
  }
}

async function loadTask(
  backendUrl: string,
  getAccessToken: () => Promise<string>,
  taskId: string,
  eventOffset: number,
  signal?: AbortSignal,
): Promise<TaskDetail> {
  const query = new URLSearchParams({ eventLimit: String(eventPageSize), eventOffset: String(eventOffset) });
  const value = await fetchJson(backendUrl, getAccessToken, `/factory/tasks/${taskId}?${query}`, signal);
  if (!isTaskDetail(value) || value.id !== taskId || value.events.some((event) => event.taskId && event.taskId !== taskId)) {
    throw new Error('Jarvis returned invalid task details.');
  }
  return value;
}

async function loadProject(
  backendUrl: string,
  getAccessToken: () => Promise<string>,
  projectId: string,
): Promise<ProjectLink | null> {
  const value = await fetchJson(backendUrl, getAccessToken, '/factory/projects');
  if (!Array.isArray(value) || !value.every(isProjectLink)) {
    throw new Error('Jarvis returned invalid project details.');
  }
  return value.find((project) => project.id === projectId) ?? null;
}

async function loadOriginMessage(
  backendUrl: string,
  getAccessToken: () => Promise<string>,
  messageId: string,
): Promise<OriginMessage | null> {
  const before = BigInt(messageId) + 1n;
  if (before > maxSqlBigInt) return null;
  const query = new URLSearchParams({ limit: '1', before: before.toString() });
  const value = await fetchJson(backendUrl, getAccessToken, `/conversation/history?${query}`);
  if (!isObject(value) || !Array.isArray(value.messages) || !value.messages.every(isOriginMessage)) {
    throw new Error('Jarvis returned invalid conversation history.');
  }
  return value.messages.find((message) => message.id === messageId) ?? null;
}

function eventState(value: unknown): TaskState | null {
  return taskStates.find((state) => state === value) ?? null;
}

function stateLabel(state: TaskState) {
  return state === 'NeedsAttention' ? 'Needs attention' : state === 'PauseRequested' ? 'Pause requested' : state;
}

/** Task details: the compact variant fills the context panel; the full variant is the body of a task window. */
export function TaskDetailPage({ backendUrl, getAccessToken, taskId, compact = false, onTitle }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  taskId: string;
  compact?: boolean;
  /** Reports the loaded task title, so the window and its tab can show it. */
  onTitle?: (title: string) => void;
}) {
  const ids = useId();
  const [reloadKey, setReloadKey] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; value: LoadState }>({
    key: '',
    value: { status: 'loading' },
  });
  const [project, setProject] = useState<ProjectLink | null>(null);
  const [projectKey, setProjectKey] = useState('');
  const [releaseLookup, setReleaseLookup] = useState<{
    key: string;
    value: Pick<ReleaseView, 'project' | 'pullRequests'> | null;
  }>({ key: '', value: null });
  const [originMessage, setOriginMessage] = useState<{ key: string; value: OriginMessage | null }>({
    key: '',
    value: null,
  });
  const [stream, setStream] = useState<{ key: string; status: StreamStatus }>({ key: '', status: 'connecting' });
  const [eventOffset, setEventOffset] = useState(0);
  const [hasMoreEvents, setHasMoreEvents] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState('');
  const [eventType, setEventType] = useState('all');
  const requestKey = `${backendUrl ?? ''}:${taskId}:${reloadKey}`;
  const result = loaded.key === requestKey ? loaded.value : { status: 'loading' as const };
  const task = result.status === 'ready' ? result.task : null;
  const measurements = task?.events.flatMap((event) => {
    const reading = diskReading(event);
    return reading ? [{ event, reading }] : [];
  }) ?? [];
  const reason = task ? attentionReason(task.events) : null;
  const eventTypes = [...new Set(task?.events.map((event) => event.type) ?? [])].sort();
  const visibleEvents = (task?.events ?? []).filter((event) => eventType === 'all' || event.type === eventType);
  const previewEvents = task?.events.slice(-5).reverse() ?? [];
  const projectRequestKey = `${backendUrl ?? ''}:${task?.projectId ?? ''}`;
  const linkedProject = projectKey === projectRequestKey ? project : null;
  const linkedReleaseData = releaseLookup.key === projectRequestKey ? releaseLookup.value : null;
  const currentStreamStatus = stream.key === requestKey ? stream.status : 'connecting';
  const taskProjectId = task?.projectId ?? '';
  const taskOriginMessageId = task?.originMessageId ?? null;
  const originMessageKey = `${requestKey}:${taskOriginMessageId ?? ''}`;
  const sourceMessage = originMessage.key === originMessageKey ? originMessage.value : null;
  const sourceMessageLoading = taskOriginMessageId !== null && originMessage.key !== originMessageKey;
  const taskBranchUrl = branchUrl(linkedReleaseData?.project ?? linkedProject, task?.branch ?? null);
  const linkedPullRequest = linkedReleaseData?.pullRequests.find((pullRequest) => pullRequest.taskId === task?.id);
  const loadedTitle = task?.title;
  useEffect(() => {
    if (loadedTitle) onTitle?.(loadedTitle);
  }, [loadedTitle, onTitle]);
  const pullRequestUrl = linkedPullRequest && linkedReleaseData
    ? `https://github.com/${linkedReleaseData.project.repo}/pull/${linkedPullRequest.number}`
    : null;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (!backendUrl) {
      void Promise.resolve().then(() => {
        if (active) {
          setLoaded({
            key: requestKey,
            value: { status: 'error', message: 'Task details are unavailable until the backend is deployed.' },
          });
        }
      });
      return () => { active = false; controller.abort(); };
    }
    void loadTask(backendUrl, getAccessToken, taskId, 0, controller.signal).then((taskDetail) => {
      if (!active) return;
      setLoaded({ key: requestKey, value: { status: 'ready', task: taskDetail } });
      setEventOffset(taskDetail.events.length);
      setHasMoreEvents(taskDetail.events.length === eventPageSize);
      setEventsError('');
      const lastEventId = taskDetail.events[taskDetail.events.length - 1]?.id;
      void streamTaskEvents<TaskEvent>({
        backendUrl,
        taskId,
        ...(lastEventId ? { lastEventId } : {}),
        getAccessToken,
        signal: controller.signal,
        onStatus: (status) => { if (active) setStream({ key: requestKey, status }); },
        onEvent: (event) => {
          if (!active || !isTaskEvent(event) || event.taskId !== taskId) return;
          setLoaded((current) => {
            if (current.key !== requestKey || current.value.status !== 'ready') return current;
            const changedState = event.type === 'state_changed' && isObject(event.payload)
              ? eventState(event.payload.to)
              : null;
            return {
              ...current,
              value: {
                status: 'ready',
                task: {
                  ...current.value.task,
                  ...(changedState ? { state: changedState } : {}),
                  events: mergeEvents(current.value.task.events, [event]),
                },
              },
            };
          });
        },
      }).catch(() => {
        if (active && !controller.signal.aborted) setStream({ key: requestKey, status: 'error' });
      });
    }).catch((error: unknown) => {
      if (active) {
        setLoaded({
          key: requestKey,
          value: {
            status: 'error',
            message: error instanceof Error ? error.message : 'Task details could not be loaded. Try again.',
          },
        });
      }
    });
    return () => { active = false; controller.abort(); };
  }, [backendUrl, getAccessToken, requestKey, taskId]);

  useEffect(() => {
    let active = true;
    if (!backendUrl || !taskProjectId) {
      return () => { active = false; };
    }
    void loadProject(backendUrl, getAccessToken, taskProjectId).then((value) => {
      if (active) {
        setProject(value);
        setProjectKey(projectRequestKey);
      }
    }).catch(() => {
      if (active) {
        setProject(null);
        setProjectKey(projectRequestKey);
      }
    });
    return () => { active = false; };
  }, [backendUrl, getAccessToken, projectRequestKey, taskProjectId]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (!backendUrl || !taskProjectId) {
      return () => { active = false; controller.abort(); };
    }
    void fetchReleaseView(backendUrl, taskProjectId, getAccessToken, controller.signal).then((value: unknown) => {
      if (active) {
        setReleaseLookup({
          key: projectRequestKey,
          value: isProjectReleaseData(value, taskProjectId) ? value : null,
        });
      }
    }).catch(() => {
      if (active) setReleaseLookup({ key: projectRequestKey, value: null });
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [backendUrl, getAccessToken, projectRequestKey, taskProjectId]);

  useEffect(() => {
    let active = true;
    if (!backendUrl || !taskOriginMessageId) return () => { active = false; };
    void loadOriginMessage(backendUrl, getAccessToken, taskOriginMessageId).then((value) => {
      if (active) setOriginMessage({ key: originMessageKey, value });
    }).catch(() => {
      if (active) setOriginMessage({ key: originMessageKey, value: null });
    });
    return () => { active = false; };
  }, [backendUrl, getAccessToken, originMessageKey, taskOriginMessageId]);

  async function loadMoreEvents() {
    if (!backendUrl || !task || loadingEvents || !hasMoreEvents || eventOffset > maxEventOffset) return;
    setLoadingEvents(true);
    setEventsError('');
    try {
      const page = await loadTask(backendUrl, getAccessToken, taskId, eventOffset);
      setLoaded((current) => {
        if (current.key !== requestKey || current.value.status !== 'ready') return current;
        return {
          ...current,
          value: { status: 'ready', task: { ...current.value.task, events: mergeEvents(current.value.task.events, page.events) } },
        };
      });
      const nextOffset = eventOffset + page.events.length;
      setEventOffset(nextOffset);
      setHasMoreEvents(page.events.length === eventPageSize && nextOffset <= maxEventOffset);
      if (page.events.length === eventPageSize && nextOffset > maxEventOffset) {
        setEventsError('Additional events may be unavailable because the task service caps event offsets at 10,000.');
      }
    } catch (error) {
      setEventsError(error instanceof Error ? error.message : 'More task events could not be loaded. Try again.');
    } finally {
      setLoadingEvents(false);
    }
  }

  const onTaskControlComplete = (state: TaskState) => setLoaded((current) =>
    current.key === requestKey && current.value.status === 'ready'
      ? { ...current, value: { ...current.value, task: { ...current.value.task, state, latestSessionEndReason: null } } }
      : current);

  if (!compact) {
    const latestDisk = measurements.at(-1);
    return (
      <section className="task-detail task-window" data-task-state={task?.state} aria-label={`Task ${taskId}`}>
        {result.status === 'loading' && <Loader variant="panel" label="Loading task details…" />}
        {result.status === 'error' && (
          <div className="task-detail-error" role="alert">
            <p>{result.message}</p>
            <button className="secondary-button" type="button" onClick={() => setReloadKey((key) => key + 1)}
              disabled={!backendUrl}>Retry</button>
          </div>
        )}
        {task && (
          <>
            <div className="task-window-summary">
              <ul className="task-window-chips" aria-label="Task summary">
                <li className="task-state-chip" data-state={task.state}><span className="task-state-dot" aria-hidden="true" />{stateLabel(task.state)}</li>
                <li><Link className="task-chip" to={`/factory/projects/${task.projectId}`}>
                  {linkedReleaseData?.project.name ?? linkedProject?.name ?? `Project ${task.projectId}`}
                </Link></li>
                {task.branch && <li>{taskBranchUrl
                  ? <a className="task-chip task-chip-mono" href={taskBranchUrl} target="_blank" rel="noreferrer">{task.branch}</a>
                  : <span className="task-chip task-chip-mono">{task.branch}</span>}</li>}
                {latestDisk && <li className="task-chip" title="Latest writable disk reading">
                  Disk {formatDisk(latestDisk.reading.disk_free_bytes)} free
                </li>}
              </ul>
              <div className="task-window-actions">
                <TaskControls
                  backendUrl={backendUrl}
                  getAccessToken={getAccessToken}
                  taskId={task.id}
                  state={task.state}
                  latestSessionEndReason={task.latestSessionEndReason}
                  onComplete={onTaskControlComplete}
                />
                {pullRequestUrl
                  ? <a className="secondary-button" href={pullRequestUrl} target="_blank" rel="noreferrer">Open pull request #{linkedPullRequest!.number}</a>
                  : <button className="secondary-button" type="button" disabled aria-describedby={`${ids}-pr-note`}>Open pull request</button>}
                {!pullRequestUrl && <p id={`${ids}-pr-note`} className="task-window-note">No pull request has been reported for this task yet.</p>}
              </div>
            </div>
            <div className="task-window-grid">
              <div className="task-window-main">
                <section className="task-card" aria-labelledby={`${ids}-request`}>
                  <h4 id={`${ids}-request`}>Request</h4>
                  <p className="task-request">{task.request}</p>
                  {reason && <p className="task-attention" role="note">{reason}</p>}
                  {task.originMessageId && (
                    <div className="task-origin">
                      {sourceMessageLoading
                        ? <Loader variant="lines" label="Loading the conversation message…" />
                        : sourceMessage
                          ? <>
                            <blockquote className="task-origin-message">{sourceMessage.text}</blockquote>
                            <p className="task-origin-meta">{sourceMessage.role === 'dan' ? 'Dan' : 'Jarvis'} · {formatDate(sourceMessage.at)}</p>
                          </>
                          : <p className="task-window-note">Message {task.originMessageId} is unavailable.</p>}
                    </div>
                  )}
                </section>
                <section className="task-card task-timeline-card" aria-labelledby={`${ids}-timeline`}>
                  <div className="task-card-head">
                    <h4 id={`${ids}-timeline`}>Timeline</h4>
                    <span className="timeline-stream" role="status" data-stream={currentStreamStatus}>
                      <span className="timeline-stream-dot" aria-hidden="true" />
                      {currentStreamStatus === 'connected' ? 'Live updates connected' :
                        currentStreamStatus === 'reconnecting' ? 'Reconnecting to live updates…' :
                          currentStreamStatus === 'error' ? 'Live updates unavailable; refresh to retry.' : 'Connecting to live updates…'}
                    </span>
                    <label className="visually-hidden" htmlFor={`${ids}-event-type`}>Event type</label>
                    <select id={`${ids}-event-type`} className="task-timeline-filter" value={eventType} onChange={(event) => setEventType(event.target.value)}>
                      <option value="all">All event types</option>
                      {eventTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </div>
                  {task.events.length === 0
                    ? <p className="task-window-note">No task events have been recorded.</p>
                    : visibleEvents.length === 0
                      ? <p className="task-window-note">No events match this event type.</p>
                      : (
                        <ol className="task-trail">
                          {[...visibleEvents].reverse().map((event, index) => (
                            <li key={event.id} data-source={event.source} data-latest={index === 0 || undefined}>
                              <span className="task-trail-dot" aria-hidden="true" />
                              <div className="task-trail-body">
                                <p className="task-trail-title">{event.summary ?? event.type}</p>
                                <p className="task-trail-meta">
                                  <span className="task-trail-type">{event.type}</span>
                                  <span>{event.source}</span>
                                  <time dateTime={event.at}>{formatDate(event.at)}</time>
                                </p>
                                {event.payloadTruncated
                                  ? <p className="timeline-payload-note">Event payload is too large to display.</p>
                                  : event.payload !== null && event.payload !== undefined && (
                                    <details className="timeline-payload">
                                      <summary>View event payload</summary>
                                      <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                                    </details>
                                  )}
                              </div>
                            </li>
                          ))}
                        </ol>
                      )}
                  {hasMoreEvents && (
                    <button className="secondary-button timeline-more" type="button" onClick={() => void loadMoreEvents()} disabled={loadingEvents}>
                      {loadingEvents ? <Loader variant="inline" announce={false} label="Loading events…" /> : 'Load more events'}
                    </button>
                  )}
                  {eventsError && <p className="chat-error" role="alert">{eventsError}</p>}
                </section>
              </div>
              <div className="task-window-side">
                <section className="task-card" aria-labelledby={`${ids}-details`}>
                  <h4 id={`${ids}-details`}>Details</h4>
                  <dl className="task-facts">
                    <div><dt>Agent</dt><dd>{task.agent === 'codex' ? 'Codex' : 'Copilot'}</dd></div>
                    <div><dt>Attempt</dt><dd>{task.attemptCount}</dd></div>
                    <div><dt>Model override</dt><dd>{task.modelOverride ?? 'Provider default'}</dd></div>
                    <div><dt>Reasoning override</dt><dd>{task.reasoningOverride ?? 'Provider default'}</dd></div>
                    <div><dt>Pull request</dt><dd>{pullRequestUrl
                      ? <a href={pullRequestUrl} target="_blank" rel="noreferrer">#{linkedPullRequest!.number}</a>
                      : 'Not reported'}</dd></div>
                    <div><dt>Checks</dt><dd>{linkedPullRequest
                      ? <span className={`release-status state-${linkedPullRequest.checks}`}>{linkedPullRequest.checks}</span>
                      : 'Not reported'}</dd></div>
                    <div><dt>Source</dt><dd>{task.source === 'board' ? 'Board' : task.source === 'voice' ? 'Voice' : 'Chat'}</dd></div>
                    <div><dt>Created</dt><dd>{formatDate(task.createdAt)}</dd></div>
                    <div><dt>Started</dt><dd>{formatDate(task.startedAt)}</dd></div>
                    <div><dt>Finished</dt><dd>{formatDate(task.finishedAt)}</dd></div>
                  </dl>
                </section>
                <section className="task-card" aria-labelledby={`${ids}-disk`}>
                  <h4 id={`${ids}-disk`}>Sandbox disk</h4>
                  {measurements.length === 0
                    ? <p className="task-window-note">No disk measurements have been recorded for this task.</p>
                    : (
                      <ol className="task-disk-readings">
                        {[...measurements].reverse().map(({ event, reading }) => {
                          const total = Number(reading.disk_total_bytes);
                          const free = Number(reading.disk_free_bytes);
                          const used = total > 0 && Number.isFinite(free) ? Math.min(1, Math.max(0, 1 - free / total)) : null;
                          return (
                            <li key={event.id} data-low={event.type === 'disk_low' || undefined}>
                              <p className="task-disk-label">{event.type === 'disk_low' ? 'Low disk warning' : 'Session snapshot'}
                                <time dateTime={event.at}>{formatDate(event.at)}</time></p>
                              {used !== null && <span className="task-disk-gauge" aria-hidden="true"><span style={{ width: `${used * 100}%` }} /></span>}
                              <dl className="task-disk-meta">
                                <div><dt>Free</dt><dd>{formatDisk(reading.disk_free_bytes)}</dd></div>
                                <div><dt>Total</dt><dd>{formatDisk(reading.disk_total_bytes)}</dd></div>
                                <div><dt>Threshold</dt><dd>{formatDisk(reading.threshold_bytes)}</dd></div>
                              </dl>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                </section>
                <section className="task-card" aria-labelledby={`${ids}-usage`}>
                  <h4 id={`${ids}-usage`}>Usage</h4>
                  {task.usage.length === 0
                    ? <p className="task-window-note">No usage has been recorded for this task yet.</p>
                    : (
                      <div className="task-usage-table-wrap">
                        <table className="task-usage-table">
                          <caption className="visually-hidden">Usage entries for task {taskId}</caption>
                          <thead>
                            <tr><th scope="col">Source</th><th scope="col">Usage</th><th scope="col">Quantity</th><th scope="col">Cost</th></tr>
                          </thead>
                          <tbody>
                            {task.usage.map((item, index) => (
                              <tr key={item.id ?? `${item.sandboxSessionId}-${item.metric}-${index}`}>
                                <th scope="row">{sourceLabel(item)}</th>
                                <td>{usageLabel(item.metric)}</td>
                                <td>{formatQuantity(item)}</td>
                                <td>{item.costDkk === null ? '—' : `${item.estimated ? 'Estimated · ' : ''}DKK ${item.costDkk.toFixed(4)}`}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  <p className="task-window-note">Sandbox cost is estimated from session time. Agent usage appears only when the provider reports it.</p>
                </section>
              </div>
            </div>
          </>
        )}
      </section>
    );
  }

  return (
    <section
      className={`task-detail${compact ? ' task-detail-panel' : ''}`}
      data-task-state={task?.state}
      {...(compact ? { 'aria-label': `Details for task ${taskId}` } : { 'aria-labelledby': 'task-heading' })}
    >
      {!compact && <Link className="home-link" to="/factory/kanban">Back to Kanban</Link>}
      {!compact && <h1 id="task-heading">{task?.title ?? `Task ${taskId}`}</h1>}
      {result.status === 'loading' && <Loader variant="panel" label="Loading task details…" />}
      {result.status === 'error' && (
        <div className="task-detail-error" role="alert">
          <p>{result.message}</p>
          <button className="secondary-button" type="button" onClick={() => setReloadKey((key) => key + 1)}
            disabled={!backendUrl}>Retry</button>
        </div>
      )}
      {task && (
        <>
          <p className="task-request">{task.request}</p>
          <dl className="task-meta">
            <div><dt>State</dt><dd>{task.state === 'NeedsAttention' ? 'Needs attention' : task.state === 'PauseRequested' ? 'Pause requested' : task.state}</dd></div>
            {compact && <div><dt>Activity</dt><dd>{task.events.at(-1)?.summary ?? 'Not reported'}</dd></div>}
            {reason && <div><dt>Reason</dt><dd>{reason}</dd></div>}
            <div><dt>Project</dt><dd><Link to={`/factory/projects/${task.projectId}`}>
              {linkedReleaseData?.project.name ?? linkedProject?.name ?? `Project ${task.projectId}`}
            </Link></dd></div>
            <div><dt>Agent</dt><dd>{task.agent === 'codex' ? 'Codex' : 'Copilot'}</dd></div>
            <div><dt>Model override</dt><dd>{task.modelOverride ?? 'Provider default'}</dd></div>
            <div><dt>Reasoning override</dt><dd>{task.reasoningOverride ?? 'Provider default'}</dd></div>
            <div><dt>Branch</dt><dd>{task.branch
              ? taskBranchUrl
                ? <a href={taskBranchUrl} target="_blank" rel="noreferrer">{task.branch}</a>
                : task.branch
              : 'Not available'}</dd></div>
            <div><dt>Pull request</dt><dd>{pullRequestUrl
              ? <a href={pullRequestUrl} target="_blank" rel="noreferrer">#{linkedPullRequest!.number}</a>
              : 'Not reported'}</dd></div>
            <div><dt>Checks</dt><dd>{linkedPullRequest
              ? <span className={`release-status state-${linkedPullRequest.checks}`}>{linkedPullRequest.checks}</span>
              : 'Not reported'}</dd></div>
            <div><dt>Created</dt><dd>{formatDate(task.createdAt)}</dd></div>
            <div><dt>Started</dt><dd>{formatDate(task.startedAt)}</dd></div>
            <div><dt>Finished</dt><dd>{formatDate(task.finishedAt)}</dd></div>
            <div><dt>Attempt</dt><dd>{task.attemptCount}</dd></div>
            <div><dt>Source</dt><dd>{task.source === 'board' ? 'Board' : task.source === 'voice' ? 'Voice' : 'Chat'}</dd></div>
            {task.originMessageId && (
              <div>
                <dt>Conversation message</dt>
                <dd>{sourceMessageLoading
                  ? <Loader variant="inline" label="Loading message…" />
                  : sourceMessage
                    ? <>
                      <blockquote className="task-origin-message">{sourceMessage.text}</blockquote>
                      <p className="task-origin-meta">{sourceMessage.role === 'dan' ? 'Dan' : 'Jarvis'} · {formatDate(sourceMessage.at)}</p>
                    </>
                    : `Message ${task.originMessageId} is unavailable.`}</dd>
              </div>
            )}
          </dl>
          <section className="task-detail-section task-actions" aria-labelledby="actions-heading">
            <h2 id="actions-heading">Task actions</h2>
            {!pullRequestUrl && <p id="pull-request-unavailable">Pull-request links are not reported until the GitHub integration is available.</p>}
            <TaskControls
              backendUrl={backendUrl}
              getAccessToken={getAccessToken}
              taskId={task.id}
              state={task.state}
              latestSessionEndReason={task.latestSessionEndReason}
              onComplete={(state) => setLoaded((current) =>
                current.key === requestKey && current.value.status === 'ready'
                  ? {
                    ...current,
                    value: {
                      ...current.value,
                      task: { ...current.value.task, state, latestSessionEndReason: null },
                    },
                  }
                  : current)}
            />
            {pullRequestUrl
              ? <div className="action-row">
                <a className="secondary-button" href={pullRequestUrl} target="_blank" rel="noreferrer">Open pull request</a>
              </div>
              : <div className="action-row">
                <button className="secondary-button" type="button" disabled aria-describedby="pull-request-unavailable">
                  Open pull request
                </button>
              </div>}
          </section>
          {compact && (
            <dl className="task-meta task-sandbox-summary">
              <div><dt>Sandbox session</dt><dd>
                {task.usage.some((record) => record.sandboxSessionId)
                  ? [...new Set(task.usage.flatMap((record) => record.sandboxSessionId ? [record.sandboxSessionId] : []))].join(', ')
                  : 'Not reported'}
              </dd></div>
              <div><dt>Heartbeat</dt><dd>Not reported</dd></div>
              <div><dt>Writable disk</dt><dd>{measurements.length
                ? <>
                  {formatDisk(measurements.at(-1)!.reading.disk_free_bytes)} free of {formatDisk(measurements.at(-1)!.reading.disk_total_bytes)}
                  <small>Measured {formatDate(measurements.at(-1)!.event.at)} · threshold {formatDisk(measurements.at(-1)!.reading.threshold_bytes)}</small>
                </>
                : 'Not reported'}</dd></div>
            </dl>
          )}
          {!compact && <section className="task-detail-section" aria-labelledby="disk-heading">
            <h2 id="disk-heading">Sandbox disk</h2>
            {measurements.length === 0
              ? <p>No disk measurements have been recorded for this task.</p>
              : (
                <ol className="task-disk-list">
                  {measurements.map(({ event, reading }) => (
                    <li key={event.id}>
                      <h3>{event.type === 'disk_low' ? 'Low disk warning' : 'Session snapshot'}</h3>
                      <p className="task-disk-time">{formatDate(event.at)}</p>
                      <dl className="task-disk-meta">
                        <div><dt>Total</dt><dd>{formatDisk(reading.disk_total_bytes)}</dd></div>
                        <div><dt>Free</dt><dd>{formatDisk(reading.disk_free_bytes)}</dd></div>
                        <div><dt>Threshold</dt><dd>{formatDisk(reading.threshold_bytes)}</dd></div>
                      </dl>
                    </li>
                  ))}
                </ol>
              )}
          </section>}
          <section className="task-detail-section task-usage" aria-labelledby="usage-heading">
            <h2 id="usage-heading">Usage</h2>
            <p className="task-usage-note">
              Sandbox cost is estimated from session time. Agent usage appears only when the provider reports it.
            </p>
            {task.usage.length === 0
              ? <p>No usage has been recorded for this task yet.</p>
              : (
                <div className="task-usage-table-wrap">
                  <table className="task-usage-table">
                    <caption>Usage entries for task {taskId}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Source</th>
                        <th scope="col">Usage</th>
                        <th scope="col">Quantity</th>
                        <th scope="col">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {task.usage.map((item, index) => (
                        <tr key={item.id ?? `${item.sandboxSessionId}-${item.metric}-${index}`}>
                          <th scope="row">{sourceLabel(item)}</th>
                          <td>{usageLabel(item.metric)}</td>
                          <td>{formatQuantity(item)}</td>
                          <td>{item.costDkk === null
                            ? '—'
                            : `${item.estimated ? 'Estimated · ' : ''}DKK ${item.costDkk.toFixed(4)}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </section>
          <section className="task-detail-section" aria-labelledby="timeline-heading">
            <h2 id="timeline-heading">{compact ? 'Recent activity' : 'Task timeline'}</h2>
            {compact ? (
              previewEvents.length === 0
                ? <p>No task events have been recorded.</p>
                : <ol className="task-timeline-preview">
                  {previewEvents.map((event) => (
                    <li key={event.id}>
                      <p>{event.summary ?? event.type}</p>
                      <time dateTime={event.at}>{formatDate(event.at)}</time>
                    </li>
                  ))}
                </ol>
            ) : (
            <>
            <div className="timeline-toolbar">
              <label htmlFor="event-type-filter">Event type</label>
              <select id="event-type-filter" value={eventType} onChange={(event) => setEventType(event.target.value)}>
                <option value="all">All event types</option>
                {eventTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <span className="timeline-stream" role="status">
                {currentStreamStatus === 'connected' ? 'Live updates connected' :
                  currentStreamStatus === 'reconnecting' ? 'Reconnecting to live updates…' :
                    currentStreamStatus === 'error' ? 'Live updates unavailable; refresh to retry.' : 'Connecting to live updates…'}
              </span>
            </div>
            {task.events.length === 0
              ? <p>No task events have been recorded.</p>
              : visibleEvents.length === 0
                ? <p>No events match this event type.</p>
                : (
                  <ol className="activity-list task-timeline">
                    {visibleEvents.map((event) => (
                      <li key={event.id}>
                        <div className="activity-title">{event.summary ?? event.type}</div>
                        <dl className="activity-meta">
                          <dt>Type</dt><dd>{event.type}</dd>
                          <dt>Source</dt><dd>{event.source}</dd>
                          <dt>Time</dt><dd>{formatDate(event.at)}</dd>
                        </dl>
                        {event.payloadTruncated
                          ? <p className="timeline-payload-note">Event payload is too large to display.</p>
                          : event.payload !== null && event.payload !== undefined && (
                            <details className="timeline-payload">
                              <summary>View event payload</summary>
                              <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                            </details>
                          )}
                      </li>
                    ))}
                  </ol>
                )}
            {hasMoreEvents && (
              <button className="secondary-button timeline-more" type="button" onClick={() => void loadMoreEvents()} disabled={loadingEvents}>
                {loadingEvents ? <Loader variant="inline" announce={false} label="Loading events…" /> : 'Load more events'}
              </button>
            )}
            {eventsError && <p className="timeline-error" role="alert">{eventsError}</p>}
            <div className="timeline-artifacts">
              <button className="secondary-button" type="button" disabled aria-describedby="artifacts-unavailable">
                Open artifacts and CI logs
              </button>
              <p id="artifacts-unavailable">Artifact and CI log links are not available yet.</p>
            </div>
            </>
            )}
          </section>
        </>
      )}
      {compact && <TaskWindowLink className="task-open-full" taskId={taskId} {...(task ? { title: task.title } : {})}>Open task window</TaskWindowLink>}
    </section>
  );
}
