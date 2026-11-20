import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useJarvisActivity } from './activity-context';
import { backendFetch } from './backend-request';
import { StateMessage } from './StateMessage';
import { formatDateTime } from './format/date-time';

interface MemoryItem { id: string; kind: 'memory'; title: string; folder: string; text: string; updatedAt: string | null; githubUrl: string | null }
interface MemoryDetail extends MemoryItem { history: { at: string | null; text: string; url: string | null }[] }
interface MemoryPage { items: MemoryItem[]; offset: number; nextOffset: number; limit: number; hasMore: boolean }

type Load<T> = { status: 'loading' } | { status: 'unavailable' } | { status: 'error'; message: string } | { status: 'ready'; value: T };

const unavailableStatuses = new Set([404, 405, 501]);
const maxText = 20_000;

class Unavailable extends Error {}

const record = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
const text = (value: unknown, max = maxText) => typeof value === 'string' ? value.slice(0, max) : '';
const date = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
const formatDate = (value: string | null) => value ? formatDateTime(value) : 'Not reported';
const githubUrl = (value: unknown) => typeof value === 'string' && /^https:\/\/github\.com\//u.test(value) ? value : null;
const maxDurableText = 2_000;

async function errorMessage(response: Response, fallback: string) {
  const body = record(await response.json().catch(() => null));
  return typeof body?.error === 'string' && body.error.length < 200 ? `${fallback} (${body.error})` : fallback;
}

function readItem(value: unknown): MemoryItem | null {
  const item = record(value);
  if (!item || item.type !== 'memory') return null;
  const id = typeof item.id === 'string' || typeof item.id === 'number' ? String(item.id) : '';
  if (!id || id.length > 200) return null;
  const body = text(item.content ?? item.snippet);
  const source = record(item.source);
  return {
    id,
    kind: 'memory',
    title: text(item.title ?? item.key ?? item.path, 200) || body.slice(0, 80) || `Memory ${id}`,
    folder: text(item.folder, 40) || 'General',
    text: body,
    updatedAt: date(item.updatedAt),
    githubUrl: source?.type === 'github' ? githubUrl(source.url) : null,
  };
}

function readPage(value: unknown): MemoryPage {
  const container = record(value);
  const list = container && Array.isArray(container.items) ? container.items : null;
  if (!list) throw new Error('Memory returned an unexpected list.');
  const offset = typeof container?.offset === 'number' ? container.offset : -1;
  const limit = typeof container?.limit === 'number' ? container.limit : -1;
  const count = typeof container?.count === 'number' ? container.count : -1;
  const rawItems = list.slice(0, limit);
  if (!Number.isInteger(offset) || offset < 0 ||
      !Number.isInteger(limit) || limit < 1 || limit > 50 ||
      !Number.isInteger(count) || count < 0 || count > limit ||
      count !== list.length || rawItems.length !== list.length) {
    throw new Error('Memory returned an invalid page.');
  }
  return {
    items: rawItems.flatMap((entry) => { const item = readItem(entry); return item ? [item] : []; }),
    offset,
    nextOffset: offset + count,
    limit,
    hasMore: container?.hasMore === true,
  };
}

function readDetail(value: unknown): MemoryDetail {
  const container = record(value);
  const item = readItem(value);
  if (!item) throw new Error('Memory returned an unexpected entry.');
  // Durable memories report source-linked SQL revisions.
  const history = Array.isArray(container?.history) ? container.history.slice(0, 10).flatMap((entry) => {
    const change = record(entry);
    if (!change) return [];
    const revision = typeof change.revision === 'number' ? `Revision ${change.revision}` : '';
    return [{ at: date(change.changedAt ?? change.updatedAt), text: text(change.message, 300) || revision || 'Earlier version', url: githubUrl(change.url) }];
  }) : [];
  return { ...item, history };
}

/** Settings → Memory: search, read, correct and forget what Jarvis remembers about Dan. Contracts: #469/#1968. */
export function MemorySettings({ backendUrl, getAccessToken }: { backendUrl: string | null; getAccessToken: () => Promise<string> }) {
  const ids = useId();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [list, setList] = useState<Load<MemoryPage>>({ status: 'loading' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Load<MemoryDetail> | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'' | 'saving' | 'forgetting'>('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const listGeneration = useRef(0);
  const lastMemoryWrite = useRef<string | null>(null);
  const { latestActivity } = useJarvisActivity();

  const call = useCallback(async (path: string, init?: { method: 'PATCH' | 'DELETE'; body?: unknown }) => {
    if (!backendUrl) throw new Unavailable();
    const token = await getAccessToken();
    const response = await backendFetch(`${backendUrl.replace(/\/+$/u, '')}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `${['Bear', 'er'].join('')} ${token}`,
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
      cache: 'no-store',
    });
    if (unavailableStatuses.has(response.status) && !init) throw new Unavailable();
    return response;
  }, [backendUrl, getAccessToken]);

  const loadPage = useCallback(async (search: string, offset: number) => {
    const params = new URLSearchParams({
      folder: 'General',
      limit: '50',
      offset: String(offset),
    });
    if (search) params.set('query', search);
    const response = await call(`/memory?${params}`);
    if (!response.ok) throw new Error(await errorMessage(response, 'Memories could not be loaded. Try again.'));
    const page = readPage(await response.json());
    if (page.offset !== offset || page.limit !== 50) throw new Error('Memory returned the wrong page. Try again.');
    if (page.hasMore && page.nextOffset <= offset) throw new Error('Memory pagination did not advance. Try again.');
    return page;
  }, [call]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim().slice(0, 200)), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const generation = ++listGeneration.current;
    void loadPage(debounced, 0).then((value) => {
      if (listGeneration.current === generation) setList({ status: 'ready', value });
    }).catch((reason: unknown) => {
      if (listGeneration.current !== generation) return;
      setList(reason instanceof Unavailable
        ? { status: 'unavailable' }
        : { status: 'error', message: reason instanceof Error ? reason.message : 'Memories could not be loaded. Try again.' });
    });
    return () => { listGeneration.current += 1; };
  }, [debounced, loadPage, reload]);

  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) setReload((value) => value + 1);
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  const memoryWrite = latestActivity?.type === 'tool-call-finished' &&
    latestActivity.outcome === 'ok' &&
    ['memory_remember', 'memory_correct', 'memory_forget'].includes(latestActivity.toolName)
    ? latestActivity.activityId : null;
  useEffect(() => {
    if (!memoryWrite || lastMemoryWrite.current === memoryWrite) return;
    lastMemoryWrite.current = memoryWrite;
    setSelectedId(null);
    setDetail(null);
    setReload((value) => value + 1);
  }, [memoryWrite]);

  useEffect(() => {
    let active = true;
    if (!selectedId) return () => { active = false; };
    void call(`/memory/${encodeURIComponent(selectedId)}`).then(async (response) => {
      if (!response.ok) throw new Error('This memory could not be opened.');
      const value = readDetail(await response.json());
      if (!active) return;
      setDetail({ status: 'ready', value });
      setDraft(value.text);
    }).catch((reason: unknown) => {
      if (active) setDetail({ status: 'error', message: reason instanceof Error ? reason.message : 'This memory could not be opened.' });
    });
    return () => { active = false; };
  }, [call, selectedId]);

  // Opening an entry resets its pane here rather than in the fetch effect, so the effect only synchronises with the API.
  const openMemory = (id: string) => {
    if (id === selectedId) return;
    setDetail({ status: 'loading' });
    setNotice('');
    setError('');
    setSelectedId(id);
  };
  const current = detail?.status === 'ready' ? detail.value : null;
  const draftLimit = maxDurableText;
  const redacted = current?.text === '[redacted]';

  async function saveCorrection() {
    if (!current || busy || draft.trim() === current.text.trim() || !draft.trim() || draft.length > draftLimit) return;
    setBusy('saving');
    setNotice('');
    setError('');
    try {
      const response = await call(`/memory/${encodeURIComponent(current.id)}`, { method: 'PATCH', body: { text: draft.trim() } });
      if (!response.ok) throw new Error(await errorMessage(response, 'The correction could not be saved.'));
      const body = record(await response.json().catch(() => null));
      const value = { ...current, text: draft.trim(), updatedAt: date(record(body?.item)?.updatedAt) ?? current.updatedAt };
      setDetail({ status: 'ready', value });
      setList((items) => items.status === 'ready'
        ? { status: 'ready', value: { ...items.value, items: items.value.items.map((item) =>
          item.id === value.id ? { ...item, text: value.text.slice(0, 240), updatedAt: value.updatedAt } : item) } }
        : items);
      setReload((count) => count + 1);
      setNotice('Correction saved. Jarvis uses it from the next reply.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The correction could not be saved. Try again.');
    } finally {
      setBusy('');
    }
  }

  async function forget() {
    if (!current || busy) return;
    setBusy('forgetting');
    setNotice('');
    setError('');
    try {
      const response = await call(`/memory/${encodeURIComponent(current.id)}`, { method: 'DELETE' });
      if (response.status === 202) {
        setNotice('The deletion request is pending. Refresh to check its result.');
      } else if (response.status === 409) {
        throw new Error('The memory changed or could not be deleted. Refresh and try again.');
      } else if (response.status === 503) {
        throw new Error('Memory deletion is unavailable right now. Try again shortly.');
      } else if (response.ok) {
        setList((items) => items.status === 'ready'
          ? { status: 'ready', value: { ...items.value, items: items.value.items.filter((item) => item.id !== current.id) } }
          : items);
        setSelectedId(null);
        setDetail(null);
        setReload((count) => count + 1);
        setNotice('Memory forgotten.');
      } else {
        throw new Error('Jarvis could not forget this memory. Try again.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Jarvis could not forget this memory. Try again.');
    } finally {
      setBusy('');
    }
  }

  async function loadMore() {
    if (list.status !== 'ready' || !list.value.hasMore || loadingMore) return;
    const generation = listGeneration.current;
    const offset = list.value.nextOffset;
    setLoadingMore(true);
    setError('');
    try {
      const next = await loadPage(debounced, offset);
      if (listGeneration.current !== generation) return;
      setList((currentList) => {
        if (currentList.status !== 'ready') return currentList;
        const seen = new Set(currentList.value.items.map((item) => item.id));
        return {
          status: 'ready',
          value: {
            ...next,
            items: [...currentList.value.items, ...next.items.filter((item) => !seen.has(item.id))],
            offset: currentList.value.offset,
            nextOffset: next.nextOffset,
          },
        };
      });
    } catch (reason) {
      if (listGeneration.current === generation) {
        setError(reason instanceof Error ? reason.message : 'More memories could not be loaded. Try again.');
      }
    } finally {
      if (listGeneration.current === generation) setLoadingMore(false);
    }
  }

  const unavailable = list.status === 'unavailable';
  return (
    <div className="memory-settings">
      <h3 className="settings-subheading">What Jarvis remembers about you</h3>
      {unavailable ? (
        <p className="settings-unavailable" role="status">Memory unavailable.</p>
      ) : (
        <>
          <div className="settings-field memory-search">
            <label className="visually-hidden" htmlFor={`${ids}-query`}>Search memory</label>
            <input id={`${ids}-query`} type="search" placeholder="Search what Jarvis remembers…" value={query} maxLength={200}
              onChange={(event) => {
                setQuery(event.target.value);
                setList({ status: 'loading' });
                setLoadingMore(false);
                setSelectedId(null);
                setDetail(null);
              }}
              onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} />
          </div>
          <div className="memory-browser">
            <div className="memory-results">
              {list.status === 'loading' && <StateMessage variant="loading" loaderVariant="rows" message="Loading memories" />}
              {list.status === 'error' && <StateMessage variant="error" className="settings-feedback" message="Memories could not be loaded."
                actionLabel="Retry" onAction={() => { setList({ status: 'loading' }); setReload((value) => value + 1); }} />}
              {list.status === 'ready' && list.value.items.length === 0 && (
                <StateMessage variant="empty" className="settings-explanation"
                  message={debounced ? 'No matches' : 'No memories'} />
              )}
              {list.status === 'ready' && list.value.items.length > 0 && (
                <ul className="memory-list" aria-label="Memories">
                  {list.value.items.map((item) => (
                    <li key={item.id}>
                      <button type="button" className="memory-item" aria-pressed={selectedId === item.id} onClick={() => openMemory(item.id)}>
                        <span className="memory-item-text">{item.text.slice(0, 160) || item.title}</span>
                        {item.updatedAt && <span className="memory-item-meta">{formatDate(item.updatedAt)}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {list.status === 'ready' && list.value.hasMore && (
                <div className="button-group button-group--space-3">
                  <button className="secondary-button" type="button" disabled={loadingMore}
                    onClick={() => { void loadMore(); }}>{loadingMore ? 'Loading…' : 'Load more'}</button>
                </div>
              )}
            </div>
            {detail && (
              <div className="memory-detail" aria-live="polite">
                {detail.status === 'loading' && <StateMessage variant="loading" loaderVariant="lines" message="Opening memory" />}
                {detail.status === 'error' && <StateMessage variant="error" className="settings-validation-error" message="This memory could not be opened." />}
                {current && (
                  <>
                    <p className="memory-item-meta">Remembered {formatDate(current.updatedAt)}</p>
                    {redacted && <p className="settings-explanation">Text hidden: it looks like a credential.</p>}
                    <div className="settings-field memory-text">
                      <label className="visually-hidden" htmlFor={`${ids}-text`}>Memory text</label>
                      <textarea id={`${ids}-text`} rows={4} value={draft} disabled={busy !== '' || redacted} maxLength={draftLimit}
                        onChange={(event) => setDraft(event.target.value)} />
                    </div>
                    <div className="memory-actions">
                      <button className="primary-button" type="button" disabled={busy !== '' || redacted || !draft.trim() || draft.trim() === current.text.trim()}
                        onClick={() => { void saveCorrection(); }}>{busy === 'saving' ? 'Saving…' : 'Save correction'}</button>
                      <button className="secondary-button danger-button" type="button" disabled={busy !== ''} onClick={() => { void forget(); }}>Forget</button>
                      <span className="memory-item-meta">{draft.length} / 2,000</span>
                    </div>
                    {notice && <p className="settings-feedback" role="status">{notice}</p>}
                    {error && <p className="settings-validation-error" role="alert">{error}</p>}

                  </>
                )}
              </div>
            )}
          </div>
          {!detail && notice && <p className="settings-feedback" role="status">{notice}</p>}
          {!detail && error && <p className="settings-validation-error" role="alert">{error}</p>}
        </>
      )}
    </div>
  );
}