import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useParams } from 'react-router-dom';
import { NotFoundPage, PendingPage } from '../pages';
import type { AreaProps } from '../areas';
import { ProjectSettingsPage, ProjectsPage } from './ProjectsPage';

const idPattern = /^[1-9]\d{0,15}$/;
const usageSources = ['sandbox', 'jarvis_model', 'voice', 'codex', 'copilot'] as const;
const usageMetrics = ['minutes', 'input_tokens', 'output_tokens', 'turns', 'premium_requests'] as const;

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

function RecordPage({ param, title, children, back }: {
  param: string;
  title: string;
  children: string;
  back: { to: string; label: string };
}) {
  const id = useParams()[param];
  if (!id || !idPattern.test(id)) return <NotFoundPage />;
  return <PendingPage title={`${title} ${id}`} back={back}>{children}</PendingPage>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUsageRecord(value: unknown): value is TaskUsageRecord {
  if (!isObject(value)) return false;
  return (value.id === null || (typeof value.id === 'string' && /^[1-9]\d{0,18}$/.test(value.id))) &&
    usageSources.includes(value.source as typeof usageSources[number]) &&
    usageMetrics.includes(value.metric as typeof usageMetrics[number]) &&
    typeof value.quantity === 'number' && Number.isFinite(value.quantity) && value.quantity >= 0 &&
    (value.costDkk === null || (typeof value.costDkk === 'number' && Number.isFinite(value.costDkk) && value.costDkk >= 0)) &&
    (value.sandboxSessionId === null ||
      (typeof value.sandboxSessionId === 'string' && /^[1-9]\d{0,18}$/.test(value.sandboxSessionId))) &&
    typeof value.at === 'string' && Number.isFinite(Date.parse(value.at)) &&
    typeof value.estimated === 'boolean';
}

function taskError(status: number): Error {
  if (status === 401) return new Error('Your Microsoft sign-in needs attention. Sign in again.');
  if (status === 404) return new Error('This task is no longer available.');
  if (status === 503) return new Error('Task usage is unavailable until the database is connected.');
  return new Error(`Jarvis could not load task usage (HTTP ${status}).`);
}

function usageLabel(metric: TaskUsageRecord['metric']): string {
  return {
    minutes: 'Sandbox minutes',
    input_tokens: 'Input tokens',
    output_tokens: 'Output tokens',
    turns: 'Agent turns',
    premium_requests: 'Premium requests',
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

function TaskUsagePage({ backendUrl, getAccessToken }: AreaProps) {
  const { taskId } = useParams();
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<
    { taskId: string | null; status: 'loading' } |
    { taskId: string; status: 'error'; message: string } |
    { taskId: string; status: 'ready'; usage: TaskUsageRecord[] }
  >({ taskId: null, status: 'loading' });

  useEffect(() => {
    if (!taskId || !idPattern.test(taskId)) return;
    let current = true;
    void (async () => {
      try {
        if (!backendUrl) throw new Error('Task data is unavailable until the backend is deployed.');
        const response = await fetch(`${backendUrl.replace(/\/+$/, '')}/factory/tasks/${taskId}`, {
          headers: { Authorization: `${['Bear', 'er'].join('')} ${await getAccessToken()}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw taskError(response.status);
        const value: unknown = await response.json();
        if (!isObject(value) || !Array.isArray(value.usage) || value.usage.length > 1000 ||
          !value.usage.every(isUsageRecord)) {
          throw new Error('Jarvis returned invalid task usage. Try again.');
        }
        if (current) setState({ taskId, status: 'ready', usage: value.usage });
      } catch (error) {
        if (current) setState({
          taskId,
          status: 'error',
          message: error instanceof Error ? error.message : 'Jarvis could not load task usage. Try again.',
        });
      }
    })();
    return () => { current = false; };
  }, [backendUrl, getAccessToken, retry, taskId]);

  if (!taskId || !idPattern.test(taskId)) return <NotFoundPage />;
  const currentState = state.taskId === taskId ? state : { taskId, status: 'loading' as const };
  return (
    <section className="task-detail" aria-labelledby="task-heading">
      <h1 id="task-heading">Task {taskId}</h1>
      <Link className="home-link" to="/factory/tasks">Back to tasks</Link>
      <section className="task-usage" aria-labelledby="task-usage-heading">
        <h2 id="task-usage-heading">Usage</h2>
        <p className="task-usage-note">
          Sandbox cost is estimated from session time. Agent usage appears only when the provider reports it.
        </p>
        {currentState.status === 'loading' && <p role="status">Loading task usage…</p>}
        {currentState.status === 'error' && (
          <div className="task-usage-feedback" role="alert">
            <p>{currentState.message}</p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setState({ taskId, status: 'loading' });
                setRetry((value) => value + 1);
              }}
            >
              Retry
            </button>
          </div>
        )}
        {currentState.status === 'ready' && currentState.usage.length === 0 && (
          <p>No usage has been recorded for this task yet.</p>
        )}
        {currentState.status === 'ready' && currentState.usage.length > 0 && (
          <div className="task-usage-table-wrap">
            <table className="task-usage-table">
              <caption>Usage entries for task {taskId}</caption>
              <thead>
                <tr><th scope="col">Source</th><th scope="col">Usage</th><th scope="col">Quantity</th><th scope="col">Cost</th></tr>
              </thead>
              <tbody>
                {currentState.usage.map((item, index) => (
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
    </section>
  );
}

const projectsLink = { to: '/factory/projects', label: 'Back to projects' };

/** The Software Factory area owns its pages; the shell only mounts it under `/factory`. */
export function FactoryArea({ backendUrl, getAccessToken }: AreaProps) {
  return (
    <div className="area">
      <nav className="area-nav" aria-label="Software Factory">
        <NavLink className="nav-link" to="/factory/tasks">Tasks</NavLink>
        <NavLink className="nav-link" to="/factory/projects">Projects</NavLink>
      </nav>
      <Routes>
        <Route index element={<Navigate to="tasks" replace />} />
        <Route path="tasks" element={
          <PendingPage title="Tasks">
            The task board isn&apos;t available yet. It will show tasks in columns by state, with filters
            and a way to create a task.
          </PendingPage>
        } />
        <Route path="tasks/:taskId" element={<TaskUsagePage backendUrl={backendUrl} getAccessToken={getAccessToken} />} />
        <Route path="projects" element={<ProjectsPage backendUrl={backendUrl} getAccessToken={getAccessToken} />} />
        <Route path="projects/new" element={
          <ProjectSettingsPage backendUrl={backendUrl} getAccessToken={getAccessToken} />
        } />
        <Route path="projects/:projectId" element={
          <ProjectSettingsPage backendUrl={backendUrl} getAccessToken={getAccessToken} />
        } />
        <Route path="releases/:releaseId" element={
          <RecordPage param="releaseId" title="Release" back={projectsLink}>Details for this release aren&apos;t available yet.</RecordPage>
        } />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </div>
  );
}
