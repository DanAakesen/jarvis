import { useEffect, useId, useRef, useState } from 'react';
import { dailyQuerySources, type DailyJson, type DailyQuery } from '@jarvis/contracts';
import { useDailyQuery } from './useDailyQuery';
import { formatTime } from './ui/formatters';

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
  return best?.at ?? null;
}

export function DailyFreshnessPill({ backendUrl, getAccessToken, enabled, refreshVersion }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  enabled: boolean;
  refreshVersion: number;
}) {
  const query = useDailyQuery(backendUrl, getAccessToken, enabled ? syncQuery : null, refreshVersion);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

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
  const upload = newestUpload(item?.feeds);
  const storage = stored(inbox);
  const inProgress = positive(inbox?.pending) || positive(inbox?.processing);
  // A failed refresh keeps the previous data, so say it is stale in words rather than looking current.
  const stale = query.data && query.error ? ', refresh failed' : '';
  const state = upload ? `Last upload ${formatTime(upload)}` : inProgress ? 'Upload being processed' : 'No uploads yet';
  const label = query.data ? `${state}${stale}` : query.error ? 'Sync status unavailable' : 'Checking sync';

  return <div className="daily-freshness-pill" ref={root}>
    <button ref={trigger} type="button" className="daily-freshness-trigger" aria-expanded={open} aria-controls={panelId}
      aria-haspopup="true" data-state={query.error ? 'error' : query.data ? 'ready' : 'pending'} onClick={() => setOpen(value => !value)}>
      {label}
    </button>
    {open && <div id={panelId} className="daily-freshness-panel" role="group" aria-label="Sync details">
      {query.error && <p className="error-text" role="alert">{query.error}</p>}
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
