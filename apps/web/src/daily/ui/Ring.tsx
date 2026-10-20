import type { ReactNode } from 'react';
import { IconChip, type HealthIconName } from './icons';

export function Ring({ label, value, target, centre, caption, reserveCaption = false, summary, tone, icon }: {
  label: string;
  value: number | null | undefined;
  target: number | null | undefined;
  centre: string;
  /** Text, or a link to where a missing target is set. */
  caption?: ReactNode;
  /** Keeps the caption line in place before the text is known, so the ring does not move when it arrives. */
  reserveCaption?: boolean;
  summary: string;
  /** Colours the ring for the class it counts, in the places that use class colours. */
  tone?: 'gym' | 'run' | 'activity';
  icon?: HealthIconName;
}) {
  // A target of 0 is a real target, so the ring is known; only null, a missing value or a negative number is not.
  const known = typeof value === 'number' && Number.isFinite(value) && value >= 0 &&
    typeof target === 'number' && Number.isFinite(target) && target >= 0;
  const ratio = known ? (target === 0 ? (value > 0 ? 1 : 0) : Math.min(1, value / target)) : 0;
  return <figure className={`daily-ring${tone ? ` daily-ring--${tone}` : ''}`}>
    <div className="daily-ring-graphic" role="img" aria-label={`${label}: ${summary}`}>
      <svg aria-hidden="true" viewBox="0 0 100 100">
        <circle className={`daily-ring-track${known ? '' : ' daily-ring-track--unavailable'}`} cx="50" cy="50" r="42" pathLength="100" />
        {known && ratio > 0 && <circle className="daily-ring-fill" cx="50" cy="50" r="42" pathLength="100"
          strokeDasharray={`${ratio * 100} 100`} />}
      </svg>
      <span className="daily-ring-centre" aria-hidden="true">{centre}</span>
    </div>
    <figcaption><span className="daily-ring-label">{icon && <IconChip name={icon} />}{label}</span>
      {caption ? <span className="daily-ring-caption">{caption}</span>
        : reserveCaption && <span className="daily-ring-caption" aria-hidden="true">{'\u00a0'}</span>}</figcaption>
  </figure>;
}
