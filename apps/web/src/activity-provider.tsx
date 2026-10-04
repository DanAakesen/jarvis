import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { JarvisActivityContext, type ActivitySource } from './activity-context';

export function JarvisActivityProvider({ children }: { children: ReactNode }) {
  const [activeSources, setActiveSources] = useState<ReadonlySet<ActivitySource>>(() => new Set());
  const [activeOperations, setActiveOperations] = useState<ReadonlyMap<symbol, ActivitySource>>(() => new Map());
  const setWorking = useCallback((source: ActivitySource, active: boolean) => {
    setActiveSources((current) => {
      if (current.has(source) === active) return current;
      const next = new Set(current);
      if (active) next.add(source);
      else next.delete(source);
      return next;
    });
  }, []);
  const beginWorking = useCallback((source: ActivitySource) => {
    const operation = Symbol(source);
    setActiveOperations((current) => new Map(current).set(operation, source));
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      setActiveOperations((current) => {
        if (!current.has(operation)) return current;
        const next = new Map(current);
        next.delete(operation);
        return next;
      });
    };
  }, []);
  const value = useMemo(() => ({
    working: activeSources.size > 0 || activeOperations.size > 0,
    setWorking,
    beginWorking,
  }), [activeSources, activeOperations, setWorking, beginWorking]);

  return <JarvisActivityContext.Provider value={value}>{children}</JarvisActivityContext.Provider>;
}
