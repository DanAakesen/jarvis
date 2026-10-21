import { useEffect, useId, useRef, useState } from 'react';
import { dailyQuerySources, type DailyJson, type DailyQuery } from '@jarvis/contracts';
import { useDailyQuery } from './useDailyQuery';
import { formatTime } from './ui/formatters';
import { HealthIcon } from './ui/icons';

const syncQuery: DailyQuery = { source: dailyQuerySources.sync };
type Row = Record<string, DailyJson>;

function row(value: DailyJson | undefined): Row | null {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function count(value: DailyJson | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : 'Unknown';
}

function positive(value: DailyJson | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

const mebibyte = 1024 * 1024;

function usable(value: DailyJson | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

// Stored upload size against the served caps. Missing or non-finite figures read "Unknown", never a made-up number.
function stored(inbox: Row | null) {
  const { retained_bytes: bytes, byte_limit: byteLimit, retained, row_limit: rowLimit } = inbox ?? {};
  if (![bytes, byteLimit, retained, rowLimit].some(usable)) return null;
  const used = usable(bytes) ? (bytes / mebibyte).toFixed(1) : 'Unknown';
  const cap = usable(byteLimit) ? String(Number((byteLimit / mebibyte).toFixed(1))) : 'Unknown';
  const full = (value: DailyJson | undefined, limit: DailyJson | undefined) =>
    usable(value) && usable(limit) && limit > 0 && value / limit >= 0.8;
  return {
    text: `${used} of ${cap} MiB · ${usable(retained) ? retained : 'Unknown'} of ${usable(rowLimit) ? rowLimit : 'Unknown'} uploads`,
    nearlyFull: full(bytes, byteLimit) || full(retained, rowLimit),
  };
}

// Newest processed upload across the feeds; unparseable times are ignored rather than shown.
function newestUpload(feeds: DailyJson | undefined) {
  let best: { at: string; ms: number } | null = null;
  for (const entry of Array.isArray(feeds) ? feeds : []) {
    const at = row(entry)?.accepted_evidence_at;
    const ms = typeof at === 'string' ? Date.parse(at) : Number.NaN;
    if (typeof at === 'string' && Number.isFinite(ms) && (!best || ms > best.ms)) best = { at, ms };
  }
  return best;
}

const sourceNames: Record<string, string> = { metrics: 'Health metrics', workouts: 'Workouts' };

// One row per feed the server reports. A feed with no accepted upload says so instead of showing a time.
function syncRows(feeds: DailyJson | undefined) {
  const rows: { kind: string; source: string; at: string | null }[] = [];
  for (const entry of Array.isArray(feeds) ? feeds : []) {
    const feed = row(entry);
    const kind = typeof feed?.feed_kind === 'string' ? feed.feed_kind : null;
    if (kind === null || kind === '') continue;
    const at = typeof feed?.accepted_evidence_at === 'string' && Number.isFinite(Date.parse(feed.accepted_evidence_at))
      ? feed.accepted_evidence_at : null;
    rows.push({ kind, source: sourceNames[kind] ?? `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`, at });
  }
  return rows;
}

/** An upload older than this reads as behind: the pill's dot turns amber. */
const staleAfterMs = 36 * 60 * 60 * 1000;

export function DailyFreshnessPill({ backendUrl, getAccessToken, enabled, refreshVersion }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  enabled: boolean;
  refreshVersion: number;
}) {
  const query = useDailyQuery(backendUrl, getAccessToken, enabled ? syncQuery : null, refreshVersion);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (root.current && event.target instanceof Node && !root.current.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const focusInside = root.current?.contains(document.activeElement) ?? false;
      setOpen(false);
      if (focusInside) trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  if (!enabled) return null;
  const item = row(query.data?.items[0]);
  const heartbeat = row(item?.heartbeat);
  const inbox = row(item?.inbox);
  const contact = typeof heartbeat?.last_received_at === 'string' ? heartbeat.last_received_at : null;
  const newest = newestUpload(item?.feeds);
  const upload = newest?.at ?? null;
  const storage = stored(inbox);
  const inProgress = positive(inbox?.pending) || positive(inbox?.processing);
  const sources = syncRows(item?.feeds);
  // A failed refresh keeps the previous data, so say it is stale in words rather than looking current.
  const stale = query.data && query.error ? ', refresh failed' : '';
  const state = upload ? `Last upload ${formatTime(upload)}` : inProgress ? 'Upload being processed' : 'No uploads yet';
  const label = query.data ? `${state}${stale}` : query.error ? 'Sync status unavailable' : 'Checking sync';
  // The dot repeats what the words say: amber when the data is behind or could not be checked, green when it is recent.
  const freshness = !query.data && !query.error ? 'pending'
    : query.error || newest === null || now - newest.ms > staleAfterMs ? 'behind' : 'recent';

  return <div className="daily-freshness-pill" ref={root}>
    <button ref={trigger} type="button" className="daily-freshness-trigger" aria-expanded={open} aria-controls={panelId}
      aria-haspopup="true" data-state={query.error ? 'error' : query.data ? 'ready' : 'pending'} data-freshness={freshness}
      onClick={() => setOpen(value => !value)}>
      <span className="daily-freshness-dot" aria-hidden="true" />
      {label}
      <span className="daily-freshness-info" aria-hidden="true"><HealthIcon name="info" /></span>
    </button>
    {open && <div id={panelId} className="daily-freshness-panel" role="group" aria-label="Sync details">
      <p className="daily-freshness-title">Last sync</p>
      {query.error && <p className="error-text" role="alert">{query.error}</p>}
      {sources.length > 0 && <table className="daily-sync-table">
        <caption className="visually-hidden">Last sync by source</caption>
        <thead><tr><th scope="col">Source</th><th scope="col">Last received</th></tr></thead>
        <tbody>{sources.map(({ kind, source, at }) => <tr key={kind}>
          <th scope="row">{source}</th>
          <td>{at ? formatTime(at) : <span className="daily-sync-none">Not received</span>}</td>
        </tr>)}</tbody>
      </table>}
      {query.data
        ? <dl className="daily-facts">
          <div><dt>Last upload</dt><dd>{upload ? formatTime(upload) : inProgress ? 'Being processed' : 'None yet'}</dd></div>
          {contact && <div><dt>Phone last contacted</dt><dd>{formatTime(contact)}</dd></div>}
          <div><dt>Accepted uploads</dt><dd>{count(inbox?.accepted ?? inbox?.pending)}</dd></div>
          <div><dt>Processing uploads</dt><dd>{count(inbox?.processing)}</dd></div>
          <div><dt>Quarantined uploads</dt><dd>{count(inbox?.quarantined)}</dd></div>
          <div><dt>Stored</dt><dd>{storage ? <>{storage.text}{storage.nearlyFull && <> · <strong>nearly full</strong></>}</> : 'Unknown'}</dd></div>
        </dl>
        : !query.error && <p>Reading sync status.</p>}
      <button type="button" className="secondary-button" onClick={() => query.reload()}>Check again</button>
    </div>}
  </div>;
}
