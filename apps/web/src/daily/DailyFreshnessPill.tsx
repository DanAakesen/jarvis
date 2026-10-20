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
  // A failed refresh keeps the previous data, so say it is stale in words rather than looking current.
  const stale = query.data && query.error ? ', refresh failed' : '';
  const label = query.data
    ? `${contact ? `Phone contact ${formatTime(contact)}` : 'No phone contact yet'}${stale}`
    : query.error ? 'Sync status unavailable' : 'Checking sync';

  return <div className="daily-freshness-pill" ref={root}>
    <button ref={trigger} type="button" className="daily-freshness-trigger" aria-expanded={open} aria-controls={panelId}
      aria-haspopup="true" data-state={query.error ? 'error' : query.data ? 'ready' : 'pending'} onClick={() => setOpen(value => !value)}>
      {label}
    </button>
    {open && <div id={panelId} className="daily-freshness-panel" role="group" aria-label="Sync details">
      {query.error && <p className="error-text" role="alert">{query.error}</p>}
      {query.data
        ? <dl className="daily-facts">
          <div><dt>Phone last contacted</dt><dd>{contact ? formatTime(contact) : 'Never'}</dd></div>
          <div><dt>Accepted uploads</dt><dd>{count(inbox?.accepted ?? inbox?.pending)}</dd></div>
          <div><dt>Processing uploads</dt><dd>{count(inbox?.processing)}</dd></div>
          <div><dt>Quarantined uploads</dt><dd>{count(inbox?.quarantined)}</dd></div>
        </dl>
        : !query.error && <p>Reading sync status.</p>}
      <button type="button" className="secondary-button" onClick={() => query.reload()}>Check again</button>
    </div>}
  </div>;
}
