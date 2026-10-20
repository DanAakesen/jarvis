import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Loader } from '../../../Loader';
import { DailyUnavailable } from '../../ui/DailyUnavailable';
import type { BlockState } from './block-state';

export type { BlockState };

function Chevron() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>;
}

/**
 * One card. The heading opens what is behind it: a link to a section, or a button that expands a panel on this page.
 * The body is laid out by the caller and keeps its size.
 */
export function TopCard({ title, to, panel, state, onRetry, stale = false, children }: {
  title: string;
  to?: string;
  panel?: { expanded: boolean; controls: string; onToggle: () => void };
  state: BlockState;
  onRetry?: () => void;
  /** A read failed but the values it had already returned are still shown. */
  stale?: boolean;
  children: ReactNode;
}) {
  const failed = state === 'error' || stale;
  return <article className="daily-top-card" data-card={title.toLowerCase()} aria-busy={state === 'loading' || undefined}>
    <header>
      <h3>{panel
        ? <button className="daily-top-card-toggle" type="button" aria-expanded={panel.expanded} aria-controls={panel.controls}
          onClick={panel.onToggle}>{title}<Chevron /></button>
        : <Link to={to ?? '.'}>{title}<Chevron /></Link>}</h3>
      {failed && onRetry && <div className="daily-top-card-recovery">
        {stale && state !== 'error' && <span role="status">Could not refresh</span>}
        <button className="ghost-button" type="button" onClick={onRetry}>Retry</button>
      </div>}
    </header>
    {state === 'loading' && <span className="visually-hidden" role="status">Loading {title.toLowerCase()}</span>}
    {children}
  </article>;
}

/**
 * A label, one value and one line under it. The three slots are always mounted and reserve their height.
 * A null value in a ready tile is a figure that was not recorded: a quiet dash, spoken as "Not recorded".
 */
export function Tile({ label, state, value, note, chart, unavailable }: {
  label: string;
  state: BlockState;
  value: ReactNode;
  note?: ReactNode;
  /** A trend under the value. Passing it, even as null, reserves its height. */
  chart?: ReactNode;
  unavailable: string;
}) {
  return <div className="daily-top-tile" data-state={state} role="group" aria-label={label}>
    <p className="daily-top-tile-label">{label}</p>
    <p className="daily-top-tile-value">
      {state === 'ready' ? value === null
        ? <><span className="daily-top-tile-none" aria-hidden="true" title="Not recorded">—</span><span className="visually-hidden">Not recorded</span></>
        : value : state === 'loading' ? <Loader label={`Loading ${label.toLowerCase()}`} variant="inline" announce={false} /> : '—'}
    </p>
    {chart !== undefined && <div className="daily-top-tile-chart">{state === 'ready' ? chart : null}</div>}
    <div className="daily-top-tile-note">
      {state === 'ready' ? note : state === 'error' ? 'Could not load'
        : state === 'unavailable' ? <DailyUnavailable>{unavailable}</DailyUnavailable> : null}
    </div>
  </div>;
}
