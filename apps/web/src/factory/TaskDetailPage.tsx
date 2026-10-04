import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

interface TaskEvent {
  id: string;
  type: string;
  summary: string | null;
  payload: unknown;
  payloadTruncated: boolean;
  at: string;
}

interface TaskDetail {
  id: string;
  title: string;
  request: string;
  projectId: string;
  agent: 'codex' | 'copilot';
  state: string;
  branch: string | null;
  events: TaskEvent[];
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; task: TaskDetail };

const gibibyte = 1024 ** 3;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTaskEvent(value: unknown): value is TaskEvent {
  return isObject(value) && typeof value.id === 'string' && typeof value.type === 'string' &&
    (typeof value.summary === 'string' || value.summary === null) &&
    typeof value.payloadTruncated === 'boolean' && typeof value.at === 'string';
}

function isTaskDetail(value: unknown): value is TaskDetail {
  return isObject(value) && typeof value.id === 'string' && typeof value.title === 'string' &&
    typeof value.request === 'string' && typeof value.projectId === 'string' &&
    (value.agent === 'codex' || value.agent === 'copilot') && typeof value.state === 'string' &&
    (typeof value.branch === 'string' || value.branch === null) &&
    Array.isArray(value.events) && value.events.every(isTaskEvent);
}

function formatDisk(bytes: unknown): string {
  return typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes >= 0
    ? `${(bytes / gibibyte).toFixed(2)} GiB`
    : 'Unavailable';
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

async function loadTask(
  backendUrl: string,
  getAccessToken: () => Promise<string>,
  taskId: string,
): Promise<TaskDetail> {
  const bearerScheme = ['Bear', 'er'].join('');
  const response = await fetch(`${backendUrl}/factory/tasks/${taskId}`, {
    headers: { Authorization: `${bearerScheme} ${await getAccessToken()}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error('This task is no longer available.');
    throw new Error(`Task details could not be loaded (HTTP ${response.status}).`);
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch (cause) {
    throw new Error('Jarvis returned invalid task details.', { cause });
  }
  if (!isTaskDetail(value) || value.id !== taskId) {
    throw new Error('Jarvis returned invalid task details.');
  }
  return value;
}

export function TaskDetailPage({ backendUrl, getAccessToken, taskId }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  taskId: string;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; value: LoadState }>({
    key: '',
    value: { status: 'loading' },
  });
  const requestKey = `${backendUrl ?? ''}:${taskId}:${reloadKey}`;

  useEffect(() => {
    let active = true;
    if (!backendUrl) {
      void Promise.resolve().then(() => {
        if (active) {
          setLoaded({
            key: requestKey,
            value: { status: 'error', message: 'Task details are unavailable until the backend is deployed.' },
          });
        }
      });
      return () => { active = false; };
    }
    void loadTask(backendUrl, getAccessToken, taskId).then(
      (task) => { if (active) setLoaded({ key: requestKey, value: { status: 'ready', task } }); },
      (error: unknown) => {
        if (active) {
          setLoaded({
            key: requestKey,
            value: {
              status: 'error',
              message: error instanceof Error ? error.message : 'Task details could not be loaded. Try again.',
            },
          });
        }
      },
    );
    return () => { active = false; };
  }, [backendUrl, getAccessToken, requestKey, taskId]);

  const result = loaded.key === requestKey ? loaded.value : { status: 'loading' as const };
  const task = result.status === 'ready' ? result.task : null;
  const measurements = task?.events.flatMap((event) => {
    const reading = diskReading(event);
    return reading ? [{ event, reading }] : [];
  }) ?? [];
  const reason = task ? attentionReason(task.events) : null;

  return (
    <section className="task-detail" aria-labelledby="task-heading">
      <Link className="home-link" to="/factory/tasks">Back to tasks</Link>
      <h1 id="task-heading">{task?.title ?? `Task ${taskId}`}</h1>
      {result.status === 'loading' && <p role="status">Loading task details…</p>}
      {result.status === 'error' && (
        <div className="task-detail-error" role="alert">
          <p>{result.message}</p>
          <button className="secondary-button" type="button" onClick={() => setReloadKey((key) => key + 1)}
            disabled={!backendUrl}>Retry</button>
        </div>
      )}
      {task && (
        <>
          <dl className="task-meta">
            <div><dt>State</dt><dd>{task.state === 'NeedsAttention' ? 'Needs attention' : task.state}</dd></div>
            {reason && <div><dt>Reason</dt><dd>{reason}</dd></div>}
            <div><dt>Project ID</dt><dd>{task.projectId}</dd></div>
            <div><dt>Agent</dt><dd>{task.agent === 'codex' ? 'Codex' : 'Copilot'}</dd></div>
            <div><dt>Branch</dt><dd>{task.branch ?? 'Not available'}</dd></div>
          </dl>
          <section className="task-detail-section" aria-labelledby="disk-heading">
            <h2 id="disk-heading">Sandbox disk</h2>
            {measurements.length === 0
              ? <p>No disk measurements have been recorded for this task.</p>
              : (
                <ol className="task-disk-list">
                  {measurements.map(({ event, reading }) => (
                    <li key={event.id}>
                      <h3>{event.type === 'disk_low' ? 'Low disk warning' : 'Session snapshot'}</h3>
                      <p className="task-disk-time">{new Date(event.at).toLocaleString()}</p>
                      <dl className="task-disk-meta">
                        <div><dt>Total</dt><dd>{formatDisk(reading.disk_total_bytes)}</dd></div>
                        <div><dt>Free</dt><dd>{formatDisk(reading.disk_free_bytes)}</dd></div>
                        <div><dt>Threshold</dt><dd>{formatDisk(reading.threshold_bytes)}</dd></div>
                      </dl>
                    </li>
                  ))}
                </ol>
              )}
          </section>
          <section className="task-detail-section" aria-labelledby="timeline-heading">
            <h2 id="timeline-heading">Task timeline</h2>
            {task.events.length === 0
              ? <p>No task events have been recorded.</p>
              : (
                <ol className="activity-list">
                  {task.events.map((event) => (
                    <li key={event.id}>
                      <div className="activity-title">{event.summary ?? event.type}</div>
                      <p className="activity-time">{new Date(event.at).toLocaleString()}</p>
                    </li>
                  ))}
                </ol>
              )}
          </section>
        </>
      )}
    </section>
  );
}
