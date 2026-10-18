import type { ReactNode } from 'react';

type WorkoutKind = 'running' | 'walking' | 'hiking' | 'cycling' | 'swimming' | 'strength' | 'hiit' |
  'rowing' | 'yoga' | 'pilates' | 'elliptical' | 'stairs' | 'dance' | 'racket' | 'ball' | 'golf' |
  'combat' | 'cardio' | 'other';

function kindFor(value: string): WorkoutKind {
  const type = value.replace(/^HKWorkoutActivityType[._ -]*/iu, '').replace(/[\s_.-]/gu, '').toLowerCase();
  if (type.includes('highintensityinterval') || type === 'hiit') return 'hiit';
  if (type.includes('hiking') || type.includes('hike')) return 'hiking';
  if (type.includes('rowing')) return 'rowing';
  if (type.includes('yoga')) return 'yoga';
  if (type.includes('pilates')) return 'pilates';
  if (type.includes('elliptical')) return 'elliptical';
  if (type.includes('stair')) return 'stairs';
  if (type.includes('danc')) return 'dance';
  if (type.includes('badminton') || type.includes('tennis') || type.includes('racket')) return 'racket';
  if (type.includes('basketball') || type === 'soccer' || type === 'football' || type.includes('americanfootball')) return 'ball';
  if (type.includes('golf')) return 'golf';
  if (type.includes('boxing') || type.includes('martialarts')) return 'combat';
  if (type.includes('flexibility') || type.includes('mindandbody')) return 'yoga';
  if (type.includes('run')) return 'running';
  if (type.includes('walk')) return 'walking';
  if (type.includes('cycl') || type.includes('bik')) return 'cycling';
  if (type.includes('swim')) return 'swimming';
  if (type.includes('strength') || type.includes('weight') || type.includes('resistance') || type.includes('core')) return 'strength';
  if (type.includes('cooldown')) return 'cardio';
  if (type.includes('cardio') || type.includes('cross') || type.includes('mixed')) return 'cardio';
  return 'other';
}

const paths: Record<WorkoutKind, ReactNode> = {
  running: <><circle cx="15.5" cy="4.5" r="2.5" /><path d="m13 9 4 3 4 1M14 10l-4 5-5 1m8-5 1 6-4 6m4-6 6 5" /></>,
  walking: <><circle cx="15.5" cy="4.5" r="2.5" /><path d="m14 9 4 3 4 1m-8-4-3 6-5 2m8-5 1 6-4 6m4-6 6 5" /></>,
  hiking: <><path d="m2 22 7-12 4 6 3-5 10 11H2Z" /><circle cx="16" cy="5" r="2" /><path d="m15 8-2 5 4 2 2 5m-6-6-4 2" /></>,
  cycling: <><circle cx="7" cy="18" r="4" /><circle cx="21" cy="18" r="4" /><path d="m7 18 5-8 5 8H7l4-6h6m-2-5h3" /></>,
  swimming: <><path d="M4 16c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2M4 20c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2M10 9l3-3 5 2-2 4-5-1-2 3" /></>,
  strength: <><path d="M5 9v6m3-9v12m8-12v12m3-9v6M8 12h8" /></>,
  hiit: <><path d="m15 2-9 14h7l-1 10 10-15h-7l1-9Z" /></>,
  rowing: <><path d="M4 19h20l-3 4H8l-4-4Zm3-2 5-9m10 9-5-9M9 6l3 2m7-2-3 2" /><circle cx="12" cy="6" r="1.5" /><circle cx="16" cy="6" r="1.5" /></>,
  yoga: <><circle cx="14" cy="5" r="2" /><path d="m13 8-3 5-5 2m5-2 5 2 4 5m-4-5 1-5 5-2M7 23c2-4 5-5 8-4s5 2 7 4m-16 0h16" /></>,
  pilates: <><circle cx="7" cy="8" r="2" /><path d="m9 10 6 2 4 5m-8-5-4 5-4 1m8-1 4 3 5-1m-17 5h22" /></>,
  elliptical: <><circle cx="9" cy="5" r="2" /><path d="m9 8 4 4-2 5-5 4m7-9 5-2 3 5m-9 0 5 2 2 5m-15 2h18" /></>,
  stairs: <><path d="M3 22h6v-5h6v-5h6V7h4M3 22V3" /></>,
  dance: <><circle cx="14" cy="5" r="2" /><path d="m13 8-4 5 4 3 2 7m-5-10-6-2m10 2 5-4 4 2m-10 5-5 6-4 1" /></>,
  racket: <><ellipse cx="16" cy="9" rx="5" ry="7" transform="rotate(35 16 9)" /><path d="m12 14-7 9m5-7 4 3" /><circle cx="6" cy="5" r="2" /></>,
  ball: <><circle cx="14" cy="14" r="9" /><path d="M8 7c4 2 6 6 6 12m6-12c-4 2-6 6-6 12M5 14h18" /></>,
  golf: <><circle cx="19" cy="22" r="1" /><path d="M18 20 9 4v16m0-16 10 3-6 5m-8 9h16" /></>,
  combat: <><path d="M7 11V7a2 2 0 0 1 4 0v3-5a2 2 0 0 1 4 0v5-4a2 2 0 0 1 4 0v6l2-2a2 2 0 0 1 3 3l-5 7H9l-5-5a2 2 0 0 1 3-3l2 2" /></>,
  cardio: <><path d="M3 14h5l3-7 5 14 3-7h6" /></>,
  other: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
};

export function WorkoutGlyph({ type, className = '' }: { type: string; className?: string }) {
  const kind = kindFor(type);
  return <svg className={`daily-workout-glyph daily-workout-glyph--${kind}${className ? ` ${className}` : ''}`} viewBox="0 0 28 28"
    aria-hidden="true" focusable="false" data-kind={kind}>
    {paths[kind]}
  </svg>;
}
