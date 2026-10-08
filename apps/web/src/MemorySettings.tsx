import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { backendFetch } from './backend-request';
import { Loader } from './Loader';

// Only memories Jarvis keeps from conversations are shown here; vault notes live in Knowledge (Dan, 8 October).
// The memory API files them under General and lists them before vault notes (docs/architecture.md, P7-40/P7-42).

interface MemoryItem { id: string; kind: 'memory' | 'vault_note'; title: string; folder: string; text: string; updatedAt: string | null; githubUrl: string | null }
interface MemoryDetail extends MemoryItem { history: { at: string | null; text: string; url: string | null }[] }

type Load<T> = { status: 'loading' } | { status: 'unavailable' } | { status: 'error'; message: string } | { status: 'ready'; value: T };

const unavailableStatuses = new Set([404, 405, 501]);
const maxText = 20_000;

class Unavailable extends Error {}

const record = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
const text = (value: unknown, max = maxText) => typeof value === 'string' ? value.slice(0, max) : '';
const date = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
const formatDate = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not reported';
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

function readList(value: unknown): MemoryItem[] {
  const container = record(value);
  const list = container && Array.isArray(container.items) ? container.items : null;
  if (!list) throw new Error('Memory returned an unexpected list.');
  return list.slice(0, 200).flatMap((entry) => { const item = readItem(entry); return item ? [item] : []; });
}

function readDetail(value: unknown): MemoryDetail {
  const container = record(value);
  const item = readItem(value);
  if (!item) throw new Error('Memory returned an unexpected entry.');
  // Durable memories report revisions; vault notes report their GitHub commits.
  const history = Array.isArray(container?.history) ? container.history.slice(0, 10).flatMap((entry) => {
    const change = record(entry);
    if (!change) return [];
    const revision = typeof change.revision === 'number' ? `Revision ${change.revision}` : '';
    return [{ at: date(change.changedAt ?? change.updatedAt), text: text(change.message, 300) || revision || 'Earlier version', url: githubUrl(change.url) }];
  }) : [];
  return { ...item, history };
}

/** Settings → Memory: search, read, correct and forget what Jarvis remembers about Dan. Contracts: #469 (P7-42). */
export function MemorySettings({ backendUrl, getAccessToken }: { backendUrl: string | null; getAccessToken: () => Promise<string> }) {
  const ids = useId();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [list, setList] = useState<Load<MemoryItem[]>>({ status: 'loading' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Load<MemoryDetail> | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'' | 'saving' | 'forgetting'>('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [confirmForget, setConfirmForget] = useState(false);
  const [reload, setReload] = useState(0);
  const forgetDialog = useRef<HTMLDialogElement>(null);

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

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim().slice(0, 200)), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (debounced) params.set('query', debounced);
    params.set('folder', 'General');
    params.set('limit', '50');
    void call(`/memory?${params}`).then(async (response) => {
      if (!response.ok) throw new Error(await errorMessage(response, 'Memories could not be loaded. Try again.'));
      const value = readList(await response.json()).filter((item) => item.kind === 'memory');
      if (active) setList({ status: 'ready', value });
    }).catch((reason: unknown) => {
      if (active) setList(reason instanceof Unavailable ? { status: 'unavailable' } : { status: 'error', message: reason instanceof Error ? reason.message : 'Memories could not be loaded. Try again.' });
    });
    return () => { active = false; };
  }, [call, debounced, reload]);

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

  useEffect(() => {
    const dialog = forgetDialog.current;
    if (!dialog) return;
    if (confirmForget && !dialog.open) dialog.showModal?.();
    if (!confirmForget && dialog.open) dialog.close();
  }, [confirmForget]);

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
      setList((items) => items.status === 'ready' ? { status: 'ready', value: items.value.map((item) => item.id === value.id ? { ...item, text: value.text.slice(0, 240) } : item) } : items);
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
        setNotice('Approval pending in Jarvis: approve the request in the conversation to delete this note from your vault.');
      } else if (response.status === 409) {
        throw new Error('Jarvis is away, so it cannot ask for approval in the browser. Switch to Present and try again.');
      } else if (response.status === 503) {
        throw new Error('Approval in the browser is unavailable right now, so nothing was deleted. Try again shortly.');
      } else if (response.ok) {
        setList((items) => items.status === 'ready' ? { status: 'ready', value: items.value.filter((item) => item.id !== current.id) } : items);
        setSelectedId(null);
        setDetail(null);
        setNotice('Memory forgotten.');
      } else {
        throw new Error('Jarvis could not forget this memory. Try again.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Jarvis could not forget this memory. Try again.');
    } finally {
      setBusy('');
      setConfirmForget(false);
    }
  }

  const unavailable = list.status === 'unavailable';
  return (
    <div className="memory-settings">
      <h3 className="settings-subheading">What Jarvis remembers about you</h3>
      {unavailable ? (
        <p className="settings-unavailable" role="status">Memory is not available yet. It appears here once the memory service is deployed.</p>
      ) : (
        <>
          <div className="settings-field memory-search">
            <label className="visually-hidden" htmlFor={`${ids}-query`}>Search memory</label>
            <input id={`${ids}-query`} type="search" placeholder="Search what Jarvis remembers…" value={query} maxLength={200}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} />
          </div>
          <div className="memory-browser">
            <div className="memory-results">
              {list.status === 'loading' && <Loader variant="rows" label="Loading memories…" />}
              {list.status === 'error' && (
                <div className="settings-feedback" role="alert">
                  <p>{list.message}</p>
                  <button className="secondary-button" type="button" onClick={() => { setList({ status: 'loading' }); setReload((value) => value + 1); }}>Retry</button>
                </div>
              )}
              {list.status === 'ready' && list.value.length === 0 && (
                <p className="settings-explanation">{debounced ? 'Nothing matches this search.' : 'Jarvis has not remembered anything about you yet.'}</p>
              )}
              {list.status === 'ready' && list.value.length > 0 && (
                <ul className="memory-list" aria-label="Memories">
                  {list.value.map((item) => (
                    <li key={item.id}>
                      <button type="button" className="memory-item" aria-pressed={selectedId === item.id} onClick={() => openMemory(item.id)}>
                        <span className="memory-item-text">{item.text.slice(0, 160) || item.title}</span>
                        {item.updatedAt && <span className="memory-item-meta">{formatDate(item.updatedAt)}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {detail && (
              <div className="memory-detail" aria-live="polite">
                {detail.status === 'loading' && <Loader variant="lines" label="Opening memory…" />}
                {detail.status === 'error' && <p className="settings-validation-error" role="alert">{detail.message}</p>}
                {current && (
                  <>
                    <p className="memory-item-meta">Remembered {formatDate(current.updatedAt)}</p>
                    {redacted && <p className="settings-explanation">This memory looks like it contains a credential, so its text is hidden and cannot be edited here.</p>}
                    <div className="settings-field memory-text">
                      <label className="visually-hidden" htmlFor={`${ids}-text`}>Memory text</label>
                      <textarea id={`${ids}-text`} rows={4} value={draft} disabled={busy !== '' || redacted} maxLength={draftLimit}
                        onChange={(event) => setDraft(event.target.value)} />
                    </div>
                    <div className="memory-actions">
                      <button className="primary-button" type="button" disabled={busy !== '' || redacted || !draft.trim() || draft.trim() === current.text.trim()}
                        onClick={() => { void saveCorrection(); }}>{busy === 'saving' ? 'Saving…' : 'Save correction'}</button>
                      <button className="secondary-button memory-forget" type="button" disabled={busy !== ''} onClick={() => setConfirmForget(true)}>Forget…</button>
                      <span className="memory-item-meta">{draft.length.toLocaleString()} / 2,000</span>
                    </div>
                    {notice && <p className="settings-feedback" role="status">{notice}</p>}
                    {error && <p className="settings-validation-error" role="alert">{error}</p>}
                    <dialog ref={forgetDialog} className="memory-forget-dialog luminous-glass" aria-labelledby={`${ids}-forget`}
                      onCancel={(event) => { event.preventDefault(); setConfirmForget(false); }}>
                      <h3 id={`${ids}-forget`}>Forget this memory?</h3>
                      <p>Jarvis forgets it straight away; it cannot be restored.</p>
                      <div className="settings-actions">
                        <button className="primary-button memory-forget-confirm" type="button" disabled={busy !== ''} onClick={() => { void forget(); }}>
                          {busy === 'forgetting' ? 'Forgetting…' : 'Forget memory'}
                        </button>
                        <button className="secondary-button" type="button" onClick={() => setConfirmForget(false)}>Keep it</button>
                      </div>
                    </dialog>
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