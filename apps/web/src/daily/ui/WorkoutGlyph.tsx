import type { ReactNode } from 'react';

type WorkoutKind = 'running' | 'walking' | 'cycling' | 'swimming' | 'strength' | 'other';

function kindFor(value: string): WorkoutKind {
  const type = value.replace(/^HKWorkoutActivityType[._ -]*/iu, '').replace(/[\s_.-]/gu, '').toLowerCase();
  if (type.includes('run')) return 'running';
  if (type.includes('walk') || type.includes('hike')) return 'walking';
  if (type.includes('cycl') || type.includes('bik')) return 'cycling';
  if (type.includes('swim')) return 'swimming';
  if (type.includes('strength') || type.includes('weight') || type.includes('resistance')) return 'strength';
  return 'other';
}

const paths: Record<WorkoutKind, ReactNode> = {
  running: <><circle cx="15.5" cy="4.5" r="2.5" /><path d="m13 9 4 3 4 1M14 10l-4 5-5 1m8-5 1 6-4 6m4-6 6 5" /></>,
  walking: <><circle cx="15.5" cy="4.5" r="2.5" /><path d="m14 9 4 3 4 1m-8-4-3 6-5 2m8-5 1 6-4 6m4-6 6 5" /></>,
  cycling: <><circle cx="7" cy="18" r="4" /><circle cx="21" cy="18" r="4" /><path d="m7 18 5-8 5 8H7l4-6h6m-2-5h3" /></>,
  swimming: <><path d="M4 16c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2M4 20c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2M10 9l3-3 5 2-2 4-5-1-2 3" /></>,
  strength: <><path d="M5 9v6m3-9v12m8-12v12m3-9v6M8 12h8" /></>,
  other: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
};

export function WorkoutGlyph({ type, className = '' }: { type: string; className?: string }) {
  const kind = kindFor(type);
  return <svg className={`daily-workout-glyph daily-workout-glyph--${kind}${className ? ` ${className}` : ''}`} viewBox="0 0 28 28"
    aria-hidden="true" focusable="false" data-kind={kind}>
    {paths[kind]}
  </svg>;
}
