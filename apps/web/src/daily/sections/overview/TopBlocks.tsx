import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Loader } from '../../../Loader';
import { DailyUnavailable } from '../../ui/DailyUnavailable';
import type { BlockState } from './block-state';

export type { BlockState };

function Chevron() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>;
}

/** One card. The heading is the link to the section behind it; the body is laid out by the caller and keeps its size. */
export function TopCard({ title, to, state, onRetry, children }: {
  title: string;
  to: string;
  state: BlockState;
  onRetry?: () => void;
  children: ReactNode;
}) {
  return <article className="daily-top-card" data-card={title.toLowerCase()} aria-busy={state === 'loading' || undefined}>
    <header>
      <h3><Link to={to}>{title}<Chevron /></Link></h3>
      {state === 'error' && onRetry && <button className="ghost-button" type="button" onClick={onRetry}>Retry</button>}
    </header>
    {state === 'loading' && <span className="visually-hidden" role="status">Loading {title.toLowerCase()}</span>}
    {children}
  </article>;
}

/** A label, one value and one line under it. The three slots are always mounted and reserve their height. */
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
      {state === 'ready' ? value : state === 'loading' ? <Loader label={`Loading ${label.toLowerCase()}`} variant="inline" announce={false} /> : '—'}
    </p>
    {chart !== undefined && <div className="daily-top-tile-chart">{state === 'ready' ? chart : null}</div>}
    <div className="daily-top-tile-note">
      {state === 'ready' ? note : state === 'error' ? 'Could not load'
        : state === 'unavailable' ? <DailyUnavailable>{unavailable}</DailyUnavailable> : null}
    </div>
  </div>;
}
