import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Loader } from '../Loader';
import { copenhagenDate } from '../daily/period';
import { formatDateOnly, formatTimeOnly } from '../format/date-time';
import {
  addVaultTask, loadVaultTasks, setVaultTaskDone, VaultTaskConflict, VaultTasksUnavailable, vaultTaskRecovery,
  type VaultTask, type VaultTaskRead,
} from './tasks-data';
import './TasksPanel.css';

type LoadState = 'loading' | 'loaded' | 'error';

/** A ticked task stays in the open list for a moment, with Undo, so a mistaken tick is never a loss. */
const lingerMs = 4000;
const leaveMs = 400;

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

type Scope = 'all' | 'personal' | 'work';
const scopes: ReadonlyArray<{ id: Scope; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'personal', label: 'Personal' },
  { id: 'work', label: 'Work' },
];

/** A task is Work when it lives under Work/, or (in the root task file) under a Work heading; everything else is Personal. */
function isWork(task: VaultTask): boolean {
  const root = task.path.split('/')[0] ?? '';
  if (/^work$/iu.test(root)) return true;
  if (/^personal$/iu.test(root)) return false;
  return /^\s*work\b/iu.test(task.heading ?? '');
}

type Phase = 'shown' | 'leaving';
interface RowActions {
  onToggle: (task: VaultTask, done: boolean) => void;
  onOpenNote: (path: string) => void;
}
interface RowState { done: Map<string, boolean>; lingering: Map<string, Phase>; pending: ReadonlySet<string>; fresh: string | null }

function TaskRow({ task, done, phase, pending, fresh, showScope, onToggle, onOpenNote }: RowActions & {
  task: VaultTask; done: boolean; phase: Phase | undefined; pending: boolean; fresh: boolean; showScope: boolean;
}) {
  const due = dueLabel(task);
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => { if (fresh) row.current?.scrollIntoView?.({ block: 'nearest' }); }, [fresh]);
  return <li ref={row} className="tasks-panel-row" data-scope={isWork(task) ? 'work' : 'personal'} data-priority={task.priority === 'normal' ? undefined : task.priority} data-done={done || undefined} data-phase={phase} data-fresh={fresh || undefined}>
    <button className="tasks-panel-check" type="button" role="checkbox" aria-checked={done} aria-label={task.text} disabled={pending}
      onClick={() => onToggle(task, !done)}>
      <svg {...glyph} viewBox="0 0 20 20" strokeWidth="1.7">
        {done ? <><rect x="2.75" y="2.75" width="14.5" height="14.5" rx="3" /><path d="m6.5 10 2.2 2.2 4.8-5" /></>
          : <rect x="3" y="3" width="14" height="14" rx="3" />}
      </svg>
    </button>
    <div className="tasks-panel-task">
      <p>{task.text}</p>
      <div className="tasks-panel-meta">
        {due && <time className="tasks-panel-due" dateTime={task.dueAt ?? task.dueDate ?? undefined}>
          <svg {...glyph} viewBox="0 0 20 20" strokeWidth="1.6"><rect x="3" y="4.5" width="14" height="12.5" rx="3" /><path d="M3 8.5h14M7 2.75v3M13 2.75v3" /></svg>
          {due}
        </time>}
        <a href={`/notes?${new URLSearchParams({ note: task.path })}`} aria-label={`Open source note ${task.path}, line ${task.line}`}
          onClick={(event) => {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onOpenNote(task.path);
          }}><span className="tasks-panel-dot" aria-hidden="true" />{showScope && <span className="tasks-panel-scope">{isWork(task) ? 'Work' : 'Personal'} ·</span>}{sourceName(task.path)}</a>
      </div>
    </div>
    {phase ? <button className="tasks-panel-undo" type="button" disabled={pending} onClick={() => onToggle(task, false)}>Undo</button>
      : task.priority !== 'normal' && <span className="tasks-panel-priority">{task.priority === 'high' ? 'High' : 'Medium'}<span className="visually-hidden"> priority</span></span>}
  </li>;
}

function TaskGroup({ title, tasks, rows, showScope, onToggle, onOpenNote }: RowActions & {
  title: string; tasks: readonly VaultTask[]; rows: RowState; showScope: boolean;
}) {
  if (!tasks.length) return null;
  return <div className="tasks-panel-group" data-group={title === 'Overdue' ? 'overdue' : undefined}>
    <h2>{title}</h2>
    <ul>{tasks.map((task) => <TaskRow key={task.id} task={task} done={rows.done.get(task.id) ?? task.done}
      phase={rows.lingering.get(task.id)} pending={rows.pending.has(task.id)} fresh={rows.fresh === task.id} showScope={showScope}
      onToggle={onToggle} onOpenNote={onOpenNote} />)}</ul>
  </div>;
}

/**
 * The vault's checkbox tasks as a quiet panel over the Notes graph (one page for notes and tasks, #1085).
 * Open tasks are listed by due date and filtered by an All / Personal / Work switch; completed tasks appear only in search results.
 * Ticking a box completes the task in the vault (with a short Undo) and "+" adds one to the Personal or Work Inbox note.
 */
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
  const [scope, setScope] = useState<Scope>('all');
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<VaultTaskRead | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [doneOverride, setDoneOverride] = useState<Map<string, boolean>>(() => new Map());
  const [lingering, setLingering] = useState<Map<string, Phase>>(() => new Map());
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [notice, setNotice] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftScope, setDraftScope] = useState<'personal' | 'work'>('personal');
  const [draftDate, setDraftDate] = useState('');
  const [draftTime, setDraftTime] = useState('');
  const [addError, setAddError] = useState('');
  const pendingRef = useRef(new Set<string>());
  const versions = useRef(new Map<string, string>());
  const timers = useRef(new Map<string, number[]>());
  const quietReload = useRef(false);
  const writes = useRef(new AbortController());
  const addButton = useRef<HTMLButtonElement>(null);
  const draftInput = useRef<HTMLInputElement>(null);

  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const running = timers.current;
    const controller = new AbortController();
    writes.current = controller;
    return () => {
      controller.abort();
      for (const handles of running.values()) handles.forEach((handle) => window.clearTimeout(handle));
      running.clear();
    };
  }, []);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!fresh) return undefined;
    const timer = window.setTimeout(() => setFresh(null), 6000);
    return () => window.clearTimeout(timer);
  }, [fresh]);
  useEffect(() => { if (adding) draftInput.current?.focus(); }, [adding]);

  const searching = query.trim() !== '';
  useEffect(() => {
    const controller = new AbortController();
    const quiet = quietReload.current;
    quietReload.current = false;
    const timer = window.setTimeout(() => {
      if (!quiet) {
        setState('loading');
        setResult(null);
      }
      setError('');
      void loadVaultTasks(backendUrl, getAccessToken, query, searching ? 'all' : 'open', controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) {
            setResult(value);
            versions.current.clear();
            setState('loaded');
            // A fresh read is the truth again, except for writes still in flight.
            setDoneOverride((current) => new Map([...current].filter(([key]) => pendingRef.current.has(key))));
            setLingering((current) => new Map([...current].filter(([key]) => pendingRef.current.has(key))));
          }
        }).catch((cause: unknown) => {
          if (!controller.signal.aborted) {
            setError(failureMessage(cause));
            setState('error');
          }
        });
    }, query && !quiet ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [backendUrl, getAccessToken, query, revision, searching]);

  const groups = useMemo(() => {
    const items = (result?.items ?? []).filter((task) => scope === 'all' || isWork(task) === (scope === 'work'));
    const open = items.filter((task) => !(doneOverride.get(task.id) ?? task.done) || lingering.has(task.id));
    return {
      overdue: open.filter((task) => task.dueDate !== null && task.dueDate < (result?.today ?? '')).sort(sortByDue),
      today: open.filter((task) => task.dueDate === result?.today).sort(sortByDue),
      upcoming: open.filter((task) => task.dueDate !== null && task.dueDate > (result?.today ?? '')).sort(sortByDue),
      noDate: open.filter((task) => task.dueDate === null).sort(sortByDue),
      done: searching ? items.filter((task) => (doneOverride.get(task.id) ?? task.done) && !lingering.has(task.id)).sort(sortByDue) : [],
    };
  }, [result, scope, doneOverride, lingering, searching]);
  const shown = groups.overdue.length + groups.today.length + groups.upcoming.length + groups.noDate.length + groups.done.length;
  const noMatches = result !== null && shown === 0;
  const retry = () => setRevision((value) => value + 1);

  const markPending = (key: string, on: boolean) => {
    if (on) pendingRef.current.add(key); else pendingRef.current.delete(key);
    setPending(new Set(pendingRef.current));
  };
  const stopLinger = (key: string) => {
    timers.current.get(key)?.forEach((handle) => window.clearTimeout(handle));
    timers.current.delete(key);
    setLingering((current) => {
      if (!current.has(key)) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  };
  const startLinger = (key: string) => {
    stopLinger(key);
    setLingering((current) => new Map(current).set(key, 'shown'));
    timers.current.set(key, [
      window.setTimeout(() => setLingering((current) => current.has(key) ? new Map(current).set(key, 'leaving') : current), lingerMs - leaveMs),
      window.setTimeout(() => stopLinger(key), lingerMs),
    ]);
  };

  const toggle = (task: VaultTask, done: boolean) => {
    if (pendingRef.current.has(task.id)) return;
    setNotice('');
    markPending(task.id, true);
    setDoneOverride((current) => new Map(current).set(task.id, done));
    if (done) startLinger(task.id); else stopLinger(task.id);
    const { signal } = writes.current;
    // After our own write the line changed, so the next change (Undo) must carry the version that write returned.
    const current = { ...task, version: versions.current.get(task.id) ?? task.version };
    void setVaultTaskDone(backendUrl, getAccessToken, current, done, signal)
      .then((write) => { versions.current.set(task.id, write.version); })
      .catch((cause: unknown) => {
        if (signal.aborted) return;
        setDoneOverride((current) => {
          const next = new Map(current);
          next.delete(task.id);
          return next;
        });
        stopLinger(task.id);
        if (cause instanceof VaultTaskConflict) {
          setNotice('That task changed in your vault, so the list was refreshed. Nothing was saved.');
          retry();
        } else {
          setNotice(failureMessage(cause));
        }
      })
      .finally(() => { if (!signal.aborted) markPending(task.id, false); });
  };

  const openAdd = () => {
    setDraftScope(scope === 'work' ? 'work' : 'personal');
    setAddError('');
    setAdding(true);
  };
  const closeAdd = () => {
    setAdding(false);
    setAddError('');
    addButton.current?.focus();
  };
  const submitAdd = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text.length < 2 || saving) return;
    const due = draftDate || (draftTime ? (result?.today ?? copenhagenDate()) : '');
    const { signal } = writes.current;
    setSaving(true);
    setAddError('');
    void addVaultTask(backendUrl, getAccessToken, {
      text, scope: draftScope, ...(due ? { due } : {}), ...(due && draftTime ? { time: draftTime } : {}),
    }, signal)
      .then((created) => {
        if (signal.aborted) return;
        setDraft('');
        setDraftDate('');
        setDraftTime('');
        setFresh(created.id);
        if (scope !== 'all') setScope(draftScope);
        setAdding(false);
        addButton.current?.focus();
        quietReload.current = true;
        retry();
      })
      .catch((cause: unknown) => {
        if (!signal.aborted) setAddError(failureMessage(cause));
      })
      .finally(() => { if (!signal.aborted) setSaving(false); });
  };

  const rows: RowState = { done: doneOverride, lingering, pending, fresh };
  const actions = { onToggle: toggle, onOpenNote, showScope: scope === 'all' };

  return <section ref={panel} id={id} className="tasks-panel luminous-glass" aria-label="Task list" aria-busy={state === 'loading'} tabIndex={-1}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
    <div className="tasks-panel-bar">
      <div className="tasks-panel-find">
        <label className="tasks-panel-search">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <span className="visually-hidden">Search tasks</span>
          <input type="search" value={query} maxLength={200} autoComplete="off" placeholder="Search tasks"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); } }} />
        </label>
        <button ref={addButton} className="tasks-panel-add-toggle" type="button" aria-expanded={adding} aria-controls={`${id}-add`}
          aria-label={adding ? 'Cancel new task' : 'Add a task'} onClick={() => adding ? closeAdd() : openAdd()}>
          <svg {...glyph} viewBox="0 0 20 20" strokeWidth="1.8"><path d="M10 4.5v11M4.5 10h11" /></svg>
        </button>
      </div>
      {adding && <form id={`${id}-add`} className="tasks-panel-add" onSubmit={submitAdd}
        onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeAdd(); } }}>
        <div className="tasks-panel-draft">
          <label className="tasks-panel-draft-field">
            <span className="visually-hidden">New task</span>
            <input ref={draftInput} type="text" value={draft} maxLength={200} autoComplete="off" placeholder="New task" disabled={saving}
              onChange={(event) => setDraft(event.target.value)} />
          </label>
          <button className="tasks-panel-save" type="submit" disabled={saving || draft.trim().length < 2}>{saving ? 'Adding' : 'Add'}</button>
        </div>
        <div className="tasks-panel-add-options">
          <div className="tasks-panel-choice" role="group" aria-label="Save to">
            {(['personal', 'work'] as const).map((key) => <button key={key} className="tasks-panel-toggle" type="button" disabled={saving}
              aria-pressed={draftScope === key} onClick={() => setDraftScope(key)}>{key === 'work' ? 'Work' : 'Personal'}</button>)}
          </div>
          <div className="tasks-panel-when">
            <label className="tasks-panel-when-field">
              <span className="visually-hidden">Due date</span>
              <input type="date" value={draftDate} disabled={saving} onChange={(event) => setDraftDate(event.target.value)} />
            </label>
            <label className="tasks-panel-when-field">
              <span className="visually-hidden">Due time</span>
              <input type="time" value={draftTime} disabled={saving} onChange={(event) => setDraftTime(event.target.value)} />
            </label>
          </div>
        </div>
        {addError && <p className="tasks-panel-notice" role="alert">{addError}</p>}
      </form>}
      <div className="tasks-panel-scope" role="group" aria-label="Show tasks from">
        {scopes.map(({ id: key, label }) => <button key={key} className="tasks-panel-toggle" type="button" aria-pressed={scope === key}
          onClick={() => setScope(key)}>{label}</button>)}
      </div>
    </div>
    {notice && <p className="tasks-panel-notice" role="alert">{notice}</p>}
    {state === 'loading' && <Loader variant="rows" label="Loading tasks" />}
    {error && <div className="tasks-panel-error" role="alert">
      <p>{error}</p>
      <button className="tasks-panel-retry" type="button" onClick={retry}>Retry</button>
    </div>}
    {result?.truncated && <p className="tasks-panel-note" role="status">First {result.items.length} of {result.total}</p>}
    {result && !noMatches && <div className="tasks-panel-groups">
      <TaskGroup title="Overdue" tasks={groups.overdue} rows={rows} {...actions} />
      <TaskGroup title="Today" tasks={groups.today} rows={rows} {...actions} />
      <TaskGroup title="Upcoming" tasks={groups.upcoming} rows={rows} {...actions} />
      <TaskGroup title="No date" tasks={groups.noDate} rows={rows} {...actions} />
      <TaskGroup title="Done" tasks={groups.done} rows={rows} {...actions} />
    </div>}
    {result && noMatches && <p className="tasks-panel-empty" role="status">{searching ? 'No matches' : 'No open tasks'}</p>}
  </section>;
}
