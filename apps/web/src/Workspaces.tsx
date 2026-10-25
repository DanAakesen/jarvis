import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { backendFetch } from './backend-request';
import { StateMessage } from './StateMessage';
import { workspaceItemKinds as kinds, workspaceItemPageSize as pageSize, groupWorkspaceItems, isWorkspaceItem, type WorkspaceItem, type WorkspaceItemKind } from './workspaces-data';
import { formatDateOnly, formatTimeOnly } from './format/date-time';

/**
 * Workspaces (P9-25, #519): saved reports and views Jarvis can reopen from the left pane. Search and kind chips filter;
 * pinned items come first, then Today, This week and Earlier. Opening goes through the backend, which sends the window
 * back through the workspace broker like any other Jarvis window.
 */
function formatWhen(iso: string, now = new Date()) {
  const date = new Date(iso);
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? formatTimeOnly(date)
    : formatDateOnly(date);
}

function KindIcon({ kind }: { kind: WorkspaceItemKind }) {
  const common = { 'aria-hidden': true as const, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'research': return <svg {...common}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 12h5m-5 4h5" /></svg>;
    case 'html_app': return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M3 8.5h18M9.5 13l-2 2 2 2m5-4 2 2-2 2" /></svg>;
    case 'image': return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="m4 18 5.5-5 4 3.5L16 14l4 4" /></svg>;
    case 'knowledge_graph': return <svg {...common}><circle cx="6" cy="7" r="2" /><circle cx="17.5" cy="6" r="1.7" /><circle cx="12" cy="14" r="2.2" /><circle cx="18" cy="18.5" r="1.8" /><path d="m7.7 8.3 2.8 3.9m5.9-4.8-3.1 4.7m1.4 3.3 2.2 1.8" /></svg>;
  }
}

function WorkspacePaneIcon({ name }: { name: 'pin' | 'rename' | 'delete' | 'close' | 'search' }) {
  const common = { 'aria-hidden': true as const, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'pin': return <svg {...common}><path d="m14.5 3.5 6 6-3 1.5-3.5 3.5.5 4-1.5 1.5-3.5-3.5L5 21l-.5-.5L9 16l-3.5-3.5L7 11l4 .5 3.5-3.5z" /></svg>;
    case 'rename': return <svg {...common}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></svg>;
    case 'delete': return <svg {...common}><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13" /></svg>;
    case 'close': return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
    case 'search': return <svg {...common}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>;
  }
}

type ListState =
  | { status: 'loading' }
  | { status: 'ready'; items: WorkspaceItem[]; more: boolean }
  | { status: 'error'; message: string };

export function WorkspacesPane({ backendUrl, getAccessToken, open, onClose, refreshKey }: {
  backendUrl?: string | null;
  getAccessToken: () => Promise<string>;
  open: boolean;
  onClose: () => void;
  /** Changes when workspace windows come and go, so new items appear while the pane is open. */
  refreshKey: number;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [kind, setKind] = useState<WorkspaceItemKind | null>(null);
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState<{ id?: string; text: string; tone: 'info' | 'error' } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);

  const call = useCallback(async (path: string, init?: { method?: 'POST' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal }) => {
    if (!backendUrl) throw new Error('Workspaces are unavailable.');
    const token = await getAccessToken();
    return backendFetch(`${backendUrl.replace(/\/+$/u, '')}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `${['Bear', 'er'].join('')} ${token}`,
        Accept: 'application/json',
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      ...(init?.signal ? { signal: init.signal } : {}),
      cache: 'no-store',
    });
  }, [backendUrl, getAccessToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim().slice(0, 120)), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const fetchPage = useCallback(async (before: string | null, signal: AbortSignal) => {
    const params = new URLSearchParams();
    if (debounced) params.set('q', debounced);
    if (kind) params.set('kind', kind);
    if (before) params.set('before', before);
    const response = await call(`/folio${params.size ? `?${params}` : ''}`, { signal });
    if (response.status === 404) throw new Error('Workspaces are unavailable.');
    if (!response.ok) throw new Error(response.status === 503 ? 'Workspaces are unavailable right now.' : `Workspaces could not be loaded (${response.status}).`);
    const body: unknown = await response.json();
    const items = typeof body === 'object' && body !== null && Array.isArray((body as { items?: unknown }).items)
      ? (body as { items: unknown[] }).items : null;
    if (!items || !items.every(isWorkspaceItem)) throw new Error('Jarvis returned an invalid Workspaces list.');
    return items as WorkspaceItem[];
  }, [call, debounced, kind]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetchPage(null, controller.signal)
      .then((items) => setList({ status: 'ready', items, more: items.length >= pageSize }))
      .catch(() => {
        if (controller.signal.aborted) return;
        setList({ status: 'error', message: 'Workspaces could not be loaded.' });
      });
    return () => controller.abort();
  }, [fetchPage, open, reload, refreshKey]);

  const loadOlder = async () => {
    if (list.status !== 'ready' || !list.items.length) return;
    const oldest = list.items.reduce((min, item) => Date.parse(item.createdAt) < Date.parse(min.createdAt) ? item : min);
    try {
      const older = await fetchPage(oldest.createdAt, new AbortController().signal);
      setList((current) => current.status === 'ready'
        ? { status: 'ready', items: [...current.items, ...older.filter((item) => !current.items.some((known) => known.id === item.id))], more: older.length >= pageSize }
        : current);
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'Older items could not be loaded.', tone: 'error' });
    }
  };

  const replace = (item: WorkspaceItem) => setList((current) => current.status === 'ready'
    ? { ...current, items: current.items.map((known) => known.id === item.id ? item : known) } : current);
  const remove = (id: string) => setList((current) => current.status === 'ready'
    ? { ...current, items: current.items.filter((known) => known.id !== id) } : current);

  const reopen = async (item: WorkspaceItem) => {
    setBusy(item.id);
    setNotice(null);
    try {
      const response = await call(`/folio/${encodeURIComponent(item.id)}/open`, { method: 'POST', body: {} });
      if (response.status === 404) {
        remove(item.id);
        setNotice({ text: `“${item.title}” is no longer available.`, tone: 'error' });
      } else if (response.status === 409) {
        const body = await response.json().catch(() => null) as { error?: unknown } | null;
        setNotice({ id: item.id, text: typeof body?.error === 'string' ? body.error : 'Jarvis declined to open it.', tone: 'error' });
      } else if (!response.ok) {
        setNotice({ id: item.id, text: 'It could not be opened. Try again in a moment.', tone: 'error' });
      } else {
        setOpened(item.id);
        window.setTimeout(() => setOpened((current) => current === item.id ? null : current), 1600);
      }
    } catch {
      setNotice({ id: item.id, text: 'It could not be opened. Check the connection and try again.', tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const patch = async (item: WorkspaceItem, change: { title?: string; pinned?: boolean }) => {
    setBusy(item.id);
    try {
      const response = await call(`/folio/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: change });
      const body: unknown = response.ok ? await response.json() : null;
      if (response.status === 404) { remove(item.id); setNotice({ text: `“${item.title}” is no longer available.`, tone: 'error' }); return false; }
      if (!response.ok || !isWorkspaceItem(body)) { setNotice({ id: item.id, text: 'The change could not be saved.', tone: 'error' }); return false; }
      replace(body);
      return true;
    } catch {
      setNotice({ id: item.id, text: 'The change could not be saved.', tone: 'error' });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const submitRename = async (event: FormEvent, item: WorkspaceItem) => {
    event.preventDefault();
    const title = renaming?.title.trim() ?? '';
    if (!title || title === item.title) { setRenaming(null); return; }
    if (await patch(item, { title: title.slice(0, 200) })) setRenaming(null);
  };

  const confirmRemove = async (item: WorkspaceItem) => {
    setBusy(item.id);
    try {
      const response = await call(`/folio/${encodeURIComponent(item.id)}`, { method: 'DELETE', body: { confirm: true } });
      if (response.ok || response.status === 404) {
        remove(item.id);
        setNotice({ text: `Removed “${item.title}” from Workspaces.`, tone: 'info' });
      } else {
        setNotice({ id: item.id, text: 'It could not be removed.', tone: 'error' });
      }
    } catch {
      setNotice({ id: item.id, text: 'It could not be removed.', tone: 'error' });
    } finally {
      setBusy(null);
      setConfirmDelete(null);
    }
  };

  const groups = useMemo(() => list.status === 'ready' ? groupWorkspaceItems(list.items) : [], [list]);
  const filtered = Boolean(debounced || kind);

  return (
    <aside id="workspaces-pane" className="area-sidebar workspaces-pane" hidden={!open} aria-labelledby="workspaces-heading"
      onKeyDown={(event) => { if (event.key === 'Escape' && !renaming && !confirmDelete) onClose(); }}>
      <div className="sidebar-heading">
        <span id="workspaces-heading">Workspaces</span>
        <button className="sidebar-close" type="button" aria-label="Close Workspaces" onClick={onClose}><WorkspacePaneIcon name="close" /></button>
      </div>
      <div className="workspaces-body">
        <label className="workspaces-search">
          <WorkspacePaneIcon name="search" />
          <span className="visually-hidden">Search Workspaces</span>
          <input ref={search} type="search" value={query} maxLength={120} placeholder="Search reports, apps, images…"
            onChange={(event) => setQuery(event.target.value)} />
        </label>
        <div className="workspaces-kinds" role="group" aria-label="Show only">
          {kinds.map((entry) => (
            <button key={entry.kind} type="button" className="workspaces-kind" aria-pressed={kind === entry.kind}
              onClick={() => setKind((current) => current === entry.kind ? null : entry.kind)}>
              {entry.label}
            </button>
          ))}
        </div>
        {notice && !notice.id && <p className="workspaces-notice" role={notice.tone === 'error' ? 'alert' : 'status'} data-tone={notice.tone}>{notice.text}</p>}
        <div className="workspaces-results">
          {list.status === 'loading' && <StateMessage variant="loading" loaderVariant="rows" message="Loading Workspaces" />}
          {list.status === 'error' && <StateMessage variant="error" className="workspaces-state" message={list.message}
            actionLabel="Retry" onAction={() => { setList({ status: 'loading' }); setReload((value) => value + 1); }} />}
          {list.status === 'ready' && !list.items.length && (filtered ? (
            <StateMessage variant="empty" className="workspaces-state"
              message={`Nothing matches${debounced ? ` “${debounced}”` : ''}${kind ? ` in ${kinds.find((entry) => entry.kind === kind)?.label}` : ''}.`}
              actionLabel="Clear search" onAction={() => { setQuery(''); setDebounced(''); setKind(null); search.current?.focus(); }} />
          ) : (
            <StateMessage variant="empty" className="workspaces-state" message="No saved items." />
          ))}
          {groups.map((group) => (
            <section key={group.label} className="workspaces-group" aria-label={group.label}>
              <h3>{group.label}</h3>
              <ul>
                {group.items.map((item) => (
                  <li key={item.id} className="workspaces-item" data-opened={opened === item.id || undefined} data-busy={busy === item.id || undefined}>
                    {renaming?.id === item.id ? (
                      <form className="workspaces-rename" onSubmit={(event) => { void submitRename(event, item); }}>
                        <label className="visually-hidden" htmlFor={`workspaces-rename-${item.id}`}>New title</label>
                        <input id={`workspaces-rename-${item.id}`} autoFocus value={renaming.title} maxLength={200}
                          onChange={(event) => setRenaming({ id: item.id, title: event.target.value })}
                          onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setRenaming(null); } }} />
                        <button className="secondary-button" type="submit" disabled={busy === item.id}>Save</button>
                      </form>
                    ) : confirmDelete === item.id ? (
                      <div className="workspaces-confirm" role="group" aria-label={`Remove ${item.title}`}>
                        <span>Remove “{item.title}”?</span>
                        <button className="secondary-button danger-button" type="button" disabled={busy === item.id} onClick={() => { void confirmRemove(item); }}>Remove</button>
                        <button className="secondary-button" type="button" onClick={() => setConfirmDelete(null)}>Keep</button>
                      </div>
                    ) : (
                      <>
                        <button className="workspaces-open" type="button" disabled={busy === item.id} onClick={() => { void reopen(item); }}
                          aria-label={`Open ${item.title}`} aria-describedby={`workspaces-summary-${item.id}`}>
                          <span className="workspaces-kind-icon" data-kind={item.kind}><KindIcon kind={item.kind} /></span>
                          <span className="workspaces-title">{item.title}</span>
                          <time className="workspaces-time" dateTime={item.createdAt}>{formatWhen(item.createdAt)}</time>
                          <span id={`workspaces-summary-${item.id}`} className="workspaces-summary">{item.promptSummary}</span>
                        </button>
                        <span className="workspaces-actions">
                          <button type="button" className="workspaces-action" aria-pressed={item.pinned} disabled={busy === item.id}
                            aria-label={item.pinned ? `Unpin ${item.title}` : `Pin ${item.title}`} title={item.pinned ? 'Unpin' : 'Pin'}
                            onClick={() => { void patch(item, { pinned: !item.pinned }); }}><WorkspacePaneIcon name="pin" /></button>
                          <button type="button" className="workspaces-action" aria-label={`Rename ${item.title}`} title="Rename"
                            onClick={() => setRenaming({ id: item.id, title: item.title })}><WorkspacePaneIcon name="rename" /></button>
                          <button type="button" className="workspaces-action" aria-label={`Remove ${item.title}`} title="Remove"
                            onClick={() => setConfirmDelete(item.id)}><WorkspacePaneIcon name="delete" /></button>
                        </span>
                      </>
                    )}
                    {notice?.id === item.id && <p className="workspaces-notice" role="alert" data-tone={notice.tone}>{notice.text}</p>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {list.status === 'ready' && list.more && (
            <button className="secondary-button workspaces-more" type="button" onClick={() => { void loadOlder(); }}>Show older</button>
          )}
        </div>
      </div>
    </aside>
  );
}
