import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { JarvisActivityContext, type ActivitySource } from './activity-context';

export function JarvisActivityProvider({ children }: { children: ReactNode }) {
  const [activeSources, setActiveSources] = useState<ReadonlySet<ActivitySource>>(() => new Set());
  const setWorking = useCallback((source: ActivitySource, active: boolean) => {
    setActiveSources((current) => {
      if (current.has(source) === active) return current;
      const next = new Set(current);
      if (active) next.add(source);
      else next.delete(source);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ working: activeSources.size > 0, setWorking }), [activeSources, setWorking]);

  return <JarvisActivityContext.Provider value={value}>{children}</JarvisActivityContext.Provider>;
}
