import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AreaProps } from '../areas';
import { Loader } from '../Loader';
import { loadVaultTasks, VaultTasksUnavailable, vaultTaskRecovery, type VaultTask, type VaultTaskRead } from './tasks-data';
import './TasksArea.css';

type LoadState = 'loading' | 'loaded' | 'error';
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const clockFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function taskDueLabel(task: VaultTask): string {
  if (!task.dueDate) return 'No due date';
  const [year, month, day] = task.dueDate.split('-').map(Number);
  const date = dateFormat.format(new Date(Date.UTC(year!, month! - 1, day!, 12)));
  const time = task.dueAt ? timeFormat.format(new Date(task.dueAt)) : task.dueTime;
  return time ? `${date}, ${time}` : date;
}

function failureMessage(error: unknown): string {
  if (error instanceof VaultTasksUnavailable) return vaultTaskRecovery(error.reason);
  if (error instanceof TypeError) return 'Jarvis could not reach the backend. Check your connection and try again.';
  return error instanceof Error ? error.message : 'Tasks could not be loaded. Try again.';
}

function TaskState({ done }: { done: boolean }) {
  return <span className="vault-task-state">
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {done ? <><rect x="2.75" y="2.75" width="14.5" height="14.5" rx="3" /><path d="m6.5 10 2.2 2.2 4.8-5" /></>
        : <rect x="3" y="3" width="14" height="14" rx="3" />}
    </svg>
    {done ? 'Done' : 'Open'}
  </span>;
}

function Priority({ priority }: { priority: VaultTask['priority'] }) {
  return priority === 'high' ? <span className="vault-task-priority">
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="m10 2.5 2.2 4.4 4.9.7-3.6 3.5.8 4.9-4.3-2.3-4.3 2.3.8-4.9L2.9 7.6l4.9-.7Z" />
    </svg>
    High priority
  </span> : null;
}

function TaskRow({ task }: { task: VaultTask }) {
  return <li className="vault-task-row">
    <div className="vault-task-row-main">
      <TaskState done={task.done} />
      <p>{task.text}</p>
      <Priority priority={task.priority} />
    </div>
    <div className="vault-task-row-meta">
      <time dateTime={task.dueAt ?? task.dueDate ?? undefined}>{taskDueLabel(task)}</time>
      <a href={`/notes?${new URLSearchParams({ note: task.path })}`}
        aria-label={`Open source note ${task.path}, line ${task.line}`}>
        {task.path} · line {task.line}
      </a>
    </div>
  </li>;
}

function sortByDue(left: VaultTask, right: VaultTask): number {
  return (left.dueDate ?? '').localeCompare(right.dueDate ?? '') ||
    (left.dueTime ?? '').localeCompare(right.dueTime ?? '') ||
    left.path.localeCompare(right.path) || left.line - right.line;
}

function TaskGroup({ title, tasks }: { title: string; tasks: readonly VaultTask[] }) {
  if (!tasks.length) return null;
  return <section className="vault-task-group" aria-label={title}>
    <h2>{title}</h2>
    <ul>{tasks.map((task) => <TaskRow key={task.id} task={task} />)}</ul>
  </section>;
}

export function TasksArea({ backendUrl, getAccessToken }: AreaProps) {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get('q')?.slice(0, 200) ?? '');
  const [showCompleted, setShowCompleted] = useState(false);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<VaultTaskRead | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState('loading');
      setError('');
      setResult(null);
      void loadVaultTasks(backendUrl, getAccessToken, query, showCompleted ? 'all' : 'open', controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) {
            setResult(value);
            setState('loaded');
          }
        }).catch((cause: unknown) => {
          if (!controller.signal.aborted) {
            setError(failureMessage(cause));
            setState('error');
          }
        });
    }, query ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [backendUrl, getAccessToken, query, revision, showCompleted]);

  const groups = useMemo(() => {
    const items = result?.items ?? [];
    const open = items.filter((task) => !task.done);
    return {
      overdue: open.filter((task) => task.dueDate !== null && task.dueDate < (result?.today ?? '')).sort(sortByDue),
      today: open.filter((task) => task.dueDate === result?.today).sort(sortByDue),
      upcoming: open.filter((task) => task.dueDate !== null && task.dueDate > (result?.today ?? '')).sort(sortByDue),
      noDate: open.filter((task) => task.dueDate === null).sort(sortByDue),
      done: items.filter((task) => task.done).sort(sortByDue),
    };
  }, [result]);
  const noMatches = result?.total === 0;

  return <section className="area vault-tasks-page">
    <div className="vault-tasks-content" aria-busy={state === 'loading'}>
      <header className="vault-tasks-header">
        <div>
          <h1>Tasks</h1>
          <p>Tasks come from checkbox items in your Personal and Work notes. Complete them in Obsidian. Agent work lives on the Software Factory board.</p>
        </div>
        <button className="secondary-button" type="button" disabled={state === 'loading'}
          onClick={() => setRevision((value) => value + 1)}>
          {state === 'loading' ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>
      <div className="vault-task-controls">
        <label className="task-filter-field">
          <span>Search tasks</span>
          <input className="form-control" type="search" value={query} maxLength={200} autoComplete="off"
            placeholder="Search your vault tasks…" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label className="choice">
          <input type="checkbox" checked={showCompleted} onChange={(event) => setShowCompleted(event.target.checked)} />
          <span>Show completed</span>
        </label>
      </div>
      {result && <div className="vault-task-freshness">
        <p>Read from your vault at <time dateTime={result.readAt}>{clockFormat.format(new Date(result.readAt))}</time></p>
        {result.truncated && <p role="status">Showing the first {result.items.length} of {result.total} matching tasks. Search to narrow the results.</p>}
      </div>}
      {error && <p className="vault-task-error" role="alert">{error}</p>}
      {state === 'loading' && !result && <Loader variant="text" label="Reading tasks from your vault…" />}
      {state === 'error' && !result && <button className="secondary-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>}
      {result && !noMatches && <div className="vault-task-groups">
        <TaskGroup title="Overdue" tasks={groups.overdue} />
        <TaskGroup title="Today" tasks={groups.today} />
        <TaskGroup title="Upcoming" tasks={groups.upcoming} />
        <TaskGroup title="No date" tasks={groups.noDate} />
        {showCompleted && <TaskGroup title="Done" tasks={groups.done} />}
      </div>}
      {result && noMatches && <p className="vault-task-empty" role="status">
        {query.trim() ? `No tasks match “${query.trim()}”.` : showCompleted ? 'No tasks in your vault.' : 'No open tasks.'}
      </p>}
      {state === 'error' && result && <button className="secondary-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>}
    </div>
  </section>;
}
