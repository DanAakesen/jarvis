import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader } from '../Loader';
import { formatDateOnly, formatTimeOnly } from '../format/date-time';
import { loadVaultTasks, VaultTasksUnavailable, vaultTaskRecovery, type VaultTask, type VaultTaskRead } from './tasks-data';
import './TasksPanel.css';

type LoadState = 'loading' | 'loaded' | 'error';

const glyph = { 'aria-hidden': true as const, fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

function dueLabel(task: VaultTask): string | null {
  if (!task.dueDate) return null;
  const date = formatDateOnly(task.dueDate, { timeZone: 'UTC' });
  const time = task.dueAt ? formatTimeOnly(task.dueAt) : task.dueTime;
  return time ? `${date}, ${time}` : date;
}

function failureMessage(error: unknown): string {
  if (error instanceof VaultTasksUnavailable) return vaultTaskRecovery(error.reason);
  if (error instanceof TypeError) return 'Jarvis could not reach the backend. Check your connection and try again.';
  return error instanceof Error ? error.message : 'Tasks could not be loaded. Try again.';
}

const sourceName = (path: string) => path.split('/').at(-1)?.replace(/\.md$/iu, '') || path;

function sortByDue(left: VaultTask, right: VaultTask): number {
  return (left.dueDate ?? '').localeCompare(right.dueDate ?? '') ||
    (left.dueTime ?? '').localeCompare(right.dueTime ?? '') ||
    left.path.localeCompare(right.path) || left.line - right.line;
}

function TaskRow({ task, onOpenNote }: { task: VaultTask; onOpenNote: (path: string) => void }) {
  const due = dueLabel(task);
  return <li className="tasks-panel-row" data-done={task.done || undefined}>
    <span className="tasks-panel-state">
      <svg {...glyph} viewBox="0 0 20 20" strokeWidth="1.7">
        {task.done ? <><rect x="2.75" y="2.75" width="14.5" height="14.5" rx="3" /><path d="m6.5 10 2.2 2.2 4.8-5" /></>
          : <rect x="3" y="3" width="14" height="14" rx="3" />}
      </svg>
      <span className="visually-hidden">{task.done ? 'Done' : 'Open'}</span>
    </span>
    <div className="tasks-panel-task">
      <p>{task.text}</p>
      <div className="tasks-panel-meta">
        {due && <time dateTime={task.dueAt ?? task.dueDate ?? undefined}>{due}</time>}
        <a href={`/notes?${new URLSearchParams({ note: task.path })}`} aria-label={`Open source note ${task.path}, line ${task.line}`}
          onClick={(event) => {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onOpenNote(task.path);
          }}>{sourceName(task.path)}</a>
      </div>
    </div>
    {task.priority === 'high' && <span className="tasks-panel-priority" title="High priority">
      <svg {...glyph} viewBox="0 0 20 20" strokeWidth="1.6"><path d="m10 2.5 2.2 4.4 4.9.7-3.6 3.5.8 4.9-4.3-2.3-4.3 2.3.8-4.9L2.9 7.6l4.9-.7Z" /></svg>
      <span className="visually-hidden">High priority</span>
    </span>}
  </li>;
}

function TaskGroup({ title, tasks, onOpenNote }: { title: string; tasks: readonly VaultTask[]; onOpenNote: (path: string) => void }) {
  if (!tasks.length) return null;
  return <div className="tasks-panel-group">
    <h2>{title}</h2>
    <ul>{tasks.map((task) => <TaskRow key={task.id} task={task} onOpenNote={onOpenNote} />)}</ul>
  </div>;
}

/** The vault's checkbox tasks as a quiet panel over the Notes graph (one page for notes and tasks, #1085). Read-only. */
export function TasksPanel({ id, backendUrl, getAccessToken, initialQuery = '', onOpenNote, onClose }: {
  id: string;
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  initialQuery?: string;
  onOpenNote: (path: string) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [query, setQuery] = useState(() => initialQuery.slice(0, 200));
  const [showCompleted, setShowCompleted] = useState(false);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<VaultTaskRead | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');

  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, []);
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
  const refresh = () => setRevision((value) => value + 1);
  const readAt = result ? formatTimeOnly(result.readAt) : '';

  return <section ref={panel} id={id} className="tasks-panel luminous-glass" aria-label="Task list" aria-busy={state === 'loading'} tabIndex={-1}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
    <div className="tasks-panel-bar">
      <label className="tasks-panel-search">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
        <span className="visually-hidden">Search tasks</span>
        <input type="search" value={query} maxLength={200} autoComplete="off" placeholder="Search tasks"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); } }} />
      </label>
      <button className="tasks-panel-refresh" type="button" aria-label="Refresh tasks" title="Refresh tasks"
        aria-busy={state === 'loading'} disabled={state === 'loading'} onClick={refresh}>
        <svg {...glyph} viewBox="0 0 24 24" strokeWidth="2"><path d="M19 12a7 7 0 1 1-2.05-4.95" /><path d="M19 4.5V8h-3.5" /></svg>
      </button>
      <button className="tasks-panel-toggle" type="button" aria-pressed={showCompleted} onClick={() => setShowCompleted((value) => !value)}>Completed</button>
      {result && <time className="tasks-panel-read" dateTime={result.readAt} title={`Read from your vault at ${readAt}`}>{readAt}</time>}
    </div>
    {state === 'loading' && <Loader variant="rows" label="Loading tasks" />}
    {error && <div className="tasks-panel-error" role="alert">
      <p>{error}</p>
      <button type="button" onClick={refresh}>Retry</button>
    </div>}
    {result?.truncated && <p className="tasks-panel-note" role="status">First {result.items.length} of {result.total}</p>}
    {result && !noMatches && <div className="tasks-panel-groups">
      <TaskGroup title="Overdue" tasks={groups.overdue} onOpenNote={onOpenNote} />
      <TaskGroup title="Today" tasks={groups.today} onOpenNote={onOpenNote} />
      <TaskGroup title="Upcoming" tasks={groups.upcoming} onOpenNote={onOpenNote} />
      <TaskGroup title="No date" tasks={groups.noDate} onOpenNote={onOpenNote} />
      {showCompleted && <TaskGroup title="Done" tasks={groups.done} onOpenNote={onOpenNote} />}
    </div>}
    {result && noMatches && <p className="tasks-panel-empty" role="status">
      {query.trim() ? 'No matches' : showCompleted ? 'No tasks' : 'No open tasks'}
    </p>}
  </section>;
}
