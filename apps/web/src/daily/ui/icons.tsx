import type { ReactNode } from 'react';

export type HealthIconName = 'gym' | 'run' | 'steps' | 'protein' | 'flame' | 'heart' | 'moon' | 'pulse' | 'info';

const glyphs: Record<HealthIconName, ReactNode> = {
  gym: <path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12" />,
  run: <><circle cx="14.5" cy="4.5" r="1.8" /><path d="m14 8-2 6 3 2.5.5 4.5M12 14l-3.5 5M13.5 9.5 17 12M13.2 9 9.5 10.5" /></>,
  steps: <><ellipse cx="8" cy="8.5" rx="2.6" ry="4" /><circle cx="8" cy="16.6" r="1.7" /><ellipse cx="16" cy="6.5" rx="2.6" ry="4" /><circle cx="16" cy="14.6" r="1.7" /></>,
  protein: <path d="M5 3v6a3 3 0 0 0 6 0V3M8 3v18M17 3c-2 2-2.5 5-2.5 8H17v10" />,
  flame: <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" />,
  heart: <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7ZM3.2 12h6.3l.5-1 2 4.5 2-7 1.5 3.5h5.3" />,
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  pulse: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></>,
};

/** A decorative stroke icon. It carries no name: whatever it sits beside already says what it is. */
export function HealthIcon({ name }: { name: HealthIconName }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24">{glyphs[name]}</svg>;
}

/** An icon on a tinted round chip; the tone is set by the surrounding card or ring. */
export function IconChip({ name }: { name: HealthIconName }) {
  return <span className="daily-icon-chip" aria-hidden="true"><HealthIcon name={name} /></span>;
}
