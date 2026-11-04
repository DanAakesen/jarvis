import { useEffect, useState } from 'react';
import { copenhagenDate } from '../../period';
import { copenhagenHour } from './overview-values';

function snapshot() {
  const now = new Date();
  return { today: copenhagenDate(now), hour: copenhagenHour(now) };
}

// The Copenhagen date and hour, advanced at midnight, on focus and on becoming visible. Queries are keyed by the date, so
// every refresh after a rollover asks for the new day instead of re-reading the old one under today's label.
export function useToday() {
  const [clock, setClock] = useState(snapshot);
  useEffect(() => {
    const advance = () => setClock(current => {
      const next = snapshot();
      return next.today === current.today && next.hour === current.hour ? current : next;
    });
    const timer = setInterval(advance, 60_000);
    window.addEventListener('focus', advance);
    document.addEventListener('visibilitychange', advance);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', advance);
      document.removeEventListener('visibilitychange', advance);
    };
  }, []);
  return clock;
}
