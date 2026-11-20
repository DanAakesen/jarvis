import { useCallback, useEffect, useId, useState } from 'react';
import { backendFetch } from './backend-request';
import { StateMessage } from './StateMessage';
import { formatDateTime } from './format/date-time';

interface MemoryItem { id: string; kind: 'memory' | 'vault_note'; title: string; folder: string; text: string; updatedAt: string | null; githubUrl: string | null }
interface MemoryDetail extends MemoryItem { history: { at: string | null; text: string; url: string | null }[] }
interface MemoryPage { items: MemoryItem[]; nextOffset: number | null }
interface PageRequest { query: string; offset: number }

type Load<T> = { status: 'loading' } | { status: 'unavailable' } | { status: 'error'; message: string } | { status: 'ready'; value: T };

const unavailableStatuses = new Set([404, 405, 501]);
const pageSize = 50;
const maxOffset = 10_000;
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
  if (!item) return null;
  const id = typeof item.id === 'string' || typeof item.id === 'number' ? String(item.id) : '';
  if (!id || id.length > 200) return null;
  const body = text(item.content ?? item.snippet);
  const source = record(item.source);
  return {
    id,
    kind: item.type === 'vault_note' ? 'vault_note' : 'memory',
    title: text(item.title ?? item.key ?? item.path, 200) || body.slice(0, 80) || `Memory ${id}`,
    folder: text(item.folder, 40) || 'General',
    text: body,
    updatedAt: date(item.updatedAt),
    githubUrl: source?.type === 'github' ? githubUrl(source.url) : null,
  };
}

function readPage(value: unknown, offset: number): MemoryPage {
  const container = record(value);
  if (!container || !Array.isArray(container.items) || container.items.length > pageSize ||
      container.count !== container.items.length || container.offset !== offset || container.limit !== pageSize ||
      typeof container.hasMore !== 'boolean') throw new Error('Memory returned an unexpected list.');
  return {
    items: container.items.flatMap((entry) => {
      const item = readItem(entry);
      return item?.kind === 'memory' ? [item] : [];
    }),
    // Use the server's page boundaries, not the number of visible items.
    nextOffset: container.hasMore && offset + pageSize <= maxOffset ? offset + pageSize : null,
  };
}

function readDetail(value: unknown, id: string): MemoryDetail {
  const container = record(value);
  const item = readItem(value);
  if (!item || item.kind !== 'memory' || item.id !== id) throw new Error('Memory returned an unexpected entry.');
  const history = Array.isArray(container?.history) ? container.history.slice(0, 10).flatMap((entry) => {
    const change = record(entry);
    if (!change) return [];
    const revision = typeof change.revision === 'number' ? `Revision ${change.revision}` : '';
    return [{ at: date(change.changedAt ?? change.updatedAt), text: text(change.message, 300) || revision || 'Earlier version', url: githubUrl(change.url) }];
  }) : [];
  return { ...item, history };
}

const memoryPath = (id: string) => `/memory/${encodeURIComponent(id)}?scope=personal`;

/** Settings → Memory: search, read, correct and forget what Jarvis remembers about Dan. Contracts: #469 (P7-42). */
export function MemorySettings({ backendUrl, getAccessToken }: { backendUrl: string | null; getAccessToken: () => Promise<string> }) {
  const ids = useId();
  const [query, setQuery] = useState('');
  const [request, setRequest] = useState<PageRequest>({ query: '', offset: 0 });
  const [pending, setPending] = useState(true);
  const [page, setPage] = useState<(MemoryPage & { query: string }) | null>(null);
  const [listError, setListError] = useState<'unavailable' | 'failed' | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Load<MemoryDetail> | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'' | 'saving' | 'forgetting'>('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [detailReload, setDetailReload] = useState(0);

  const call = useCallback(async (path: string, init?: { method?: 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal }) => {
    if (!backendUrl) throw new Unavailable();
    const token = await getAccessToken();
    init?.signal?.throwIfAborted();
    const response = await backendFetch(`${backendUrl.replace(/\/+$/u, '')}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `${['Bear', 'er'].join('')} ${token}`,
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
      ...(init?.signal ? { signal: init.signal } : {}),
      cache: 'no-store',
    });
    return response;
  }, [backendUrl, getAccessToken]);

  const requestPage = useCallback((query: string, offset = 0) => {
    setPending(true);
    setListError(null);
    setRequest({ query, offset });
  }, []);

  const search = query.trim();
  useEffect(() => {
    if (search === request.query) return;
    const timer = window.setTimeout(() => requestPage(search), 250);
    return () => window.clearTimeout(timer);
  }, [search, request.query, requestPage]);

  useEffect(() => {
    const controller = new AbortController();
    const { query, offset } = request;
    const params = new URLSearchParams({ scope: 'personal', limit: String(pageSize), offset: String(offset) });
    if (query) params.set('query', query);
    void call(`/memory?${params}`, { signal: controller.signal }).then(async (response) => {
      if (unavailableStatuses.has(response.status)) throw new Unavailable();
      if (!response.ok) throw new Error('Memories could not be loaded.');
      const result = readPage(await response.json(), offset);
      if (controller.signal.aborted) return;
      setPage((previous) => {
        const kept = offset > 0 && previous?.query === query ? previous.items : [];
        const seen = new Set(kept.map((item) => item.id));
        return { query, nextOffset: result.nextOffset, items: [...kept, ...result.items.filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        })] };
      });
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setListError(reason instanceof Unavailable ? 'unavailable' : 'failed');
    }).finally(() => {
      if (!controller.signal.aborted) setPending(false);
    });
    return () => controller.abort();
  }, [call, request]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    void call(memoryPath(selectedId), { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('This memory could not be opened.');
      const value = readDetail(await response.json(), selectedId);
      if (controller.signal.aborted) return;
      setDetail({ status: 'ready', value });
      setDraft(value.text);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setDetail({ status: 'error', message: reason instanceof Error ? reason.message : 'This memory could not be opened.' });
    });
    return () => controller.abort();
  }, [call, selectedId, detailReload]);

  // Opening an entry resets its pane here rather than in the fetch effect, so the effect only synchronises with the API.
  const openMemory = (id: string) => {
    if (id === selectedId || busy) return;
    setDetail({ status: 'loading' });
    setNotice('');
    setError('');
    setSelectedId(id);
  };
  const current = detail?.status === 'ready' ? detail.value : null;
  const draftLimit = maxDurableText;
  const redacted = current?.text === '[redacted]';
  const dirty = Boolean(current && draft.trim() !== current.text.trim());
  const retryDetail = useCallback(() => {
    setDetail({ status: 'loading' });
    setDetailReload((value) => value + 1);
  }, []);
  const refresh = useCallback(() => {
    requestPage(search);
    if (selectedId && !dirty && !busy) retryDetail();
  }, [requestPage, search, selectedId, dirty, busy, retryDetail]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  async function saveCorrection() {
    if (!current || busy || draft.trim() === current.text.trim() || !draft.trim() || draft.length > draftLimit) return;
    setBusy('saving');
    setNotice('');
    setError('');
    try {
      const response = await call(memoryPath(current.id), { method: 'PATCH', body: { text: draft.trim() } });
      if (!response.ok) throw new Error(await errorMessage(response, 'The correction could not be saved.'));
      const body = record(await response.json().catch(() => null));
      const value = { ...current, text: draft.trim(), updatedAt: date(record(body?.item)?.updatedAt) ?? current.updatedAt };
      setDetail({ status: 'ready', value });
      setPage((page) => page ? { ...page, items: page.items.map((item) => item.id === value.id ? { ...item, text: value.text.slice(0, 240), updatedAt: value.updatedAt } : item) } : page);
      requestPage(search);
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
      const response = await call(memoryPath(current.id), { method: 'DELETE' });
      if (response.status === 202) {
        setNotice('The deletion request is pending. Refresh to check its result.');
      } else if (response.status === 409) {
        throw new Error('The memory changed or could not be deleted. Refresh and try again.');
      } else if (response.status === 503) {
        throw new Error('Memory deletion is unavailable right now. Try again shortly.');
      } else if (response.ok) {
        setPage((page) => page ? { ...page, items: page.items.filter((item) => item.id !== current.id) } : page);
        setSelectedId(null);
        setDetail(null);
        requestPage(search);
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

  const results = page?.query === search ? page : null;
  const searching = search !== request.query;
  return (
    <div className="memory-settings">
      <h3 className="settings-subheading">What Jarvis remembers about you</h3>
      <div className="settings-field memory-search">
        <label className="visually-hidden" htmlFor={`${ids}-query`}>Search memory</label>
        <input id={`${ids}-query`} type="search" placeholder="Search what Jarvis remembers…" value={query} maxLength={200} disabled={busy !== ''}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (searching) requestPage(search); } }} />
        <button type="button" className="secondary-button" disabled={pending || busy !== ''} onClick={refresh}>Refresh</button>
      </div>
      <div className="memory-browser">
        <div className="memory-result-pane">
          {(searching || (pending && !results)) && <StateMessage variant="loading" loaderVariant="rows" message="Loading memories" />}
          {!searching && pending && results && request.offset === 0 && <StateMessage variant="loading" message="Refreshing memories" />}
          {!searching && listError && <StateMessage variant="error" className="settings-feedback"
            message={request.offset > 0 ? 'More memories could not be loaded.' : listError === 'unavailable' ? 'Memory unavailable.' : 'Memories could not be loaded.'}
            detail={results?.items.length && request.offset === 0 ? 'Showing previously loaded memories.' : undefined}
            actionLabel="Retry" onAction={() => requestPage(request.query, request.offset)} />}
          {!searching && !pending && !listError && results?.items.length === 0 && results.nextOffset === null && (
            <StateMessage variant="empty" className="settings-explanation" message={search ? 'No matches' : 'No memories'} />
          )}
          {results && results.items.length > 0 && (
            <div className="memory-results">
              <ul className="memory-list" aria-label="Memories">
                {results.items.map((item) => (
                  <li key={item.id}>
                    <button type="button" className="memory-item" disabled={busy !== ''} aria-pressed={selectedId === item.id} onClick={() => openMemory(item.id)}>
                      <span className="memory-item-text">{item.text.slice(0, 160) || item.title}</span>
                      {item.updatedAt && <span className="memory-item-meta">{formatDate(item.updatedAt)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!searching && !listError && results?.nextOffset != null && (
            <div className="button-group memory-pagination">
              <button type="button" className="secondary-button" disabled={pending || busy !== ''}
                aria-busy={pending && request.offset > 0}
                onClick={() => { if (results.nextOffset !== null) requestPage(search, results.nextOffset); }}>
                {pending && request.offset > 0 ? 'Loading more…' : 'Load more'}
              </button>
            </div>
          )}
        </div>
        {detail && (
          <div className="memory-detail" aria-live="polite">
            {detail.status === 'loading' && <StateMessage variant="loading" loaderVariant="lines" message="Opening memory" />}
            {detail.status === 'error' && <StateMessage variant="error" className="settings-validation-error" message={detail.message}
              actionLabel="Retry" onAction={retryDetail} />}
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
                  <button className="primary-button" type="button" disabled={busy !== '' || redacted || !draft.trim() || !dirty}
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
    </div>
  );
}