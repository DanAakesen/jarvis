import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { JarvisActivityEvent } from '@jarvis/contracts';
import { JarvisActivityContext } from './activity-context';

function isWorkingEvent(event: JarvisActivityEvent): boolean {
  return event.type === 'thinking' || event.type === 'speaking' || event.type === 'tool-call-started';
}

export function JarvisActivityProvider({ children }: { children: ReactNode }) {
  const [runtimeOperations, setRuntimeOperations] = useState<ReadonlyMap<string, JarvisActivityEvent>>(() => new Map());
  const [voiceActivity, setVoiceActivity] = useState<JarvisActivityEvent | null>(null);
  const [latestActivity, setLatestActivity] = useState<JarvisActivityEvent | null>(null);
  const activityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyRuntimeActivity = useCallback((event: JarvisActivityEvent) => {
    if (activityTimer.current) clearTimeout(activityTimer.current);
    setLatestActivity(event);
    setRuntimeOperations((current) => {
      const next = new Map(current);
      if (isWorkingEvent(event)) next.set(event.activityId, event);
      else next.delete(event.activityId);
      return next;
    });
    if (event.source === 'voice') {
      setVoiceActivity(event.type === 'ended' ? null : event);
    }
    if (event.type === 'ended' || event.type === 'interrupted' || event.type === 'failed' ||
        event.type === 'tool-call-finished') {
      activityTimer.current = setTimeout(() => {
        activityTimer.current = null;
        setLatestActivity((current) => current === event ? null : current);
        if (event.source === 'voice') {
          setVoiceActivity((current) => current === event ? null : current);
        }
      }, 3_000);
    }
  }, []);
  const clearRuntimeActivities = useCallback(() => {
    if (activityTimer.current) clearTimeout(activityTimer.current);
    activityTimer.current = null;
    setRuntimeOperations(new Map());
    setVoiceActivity(null);
    setLatestActivity(null);
  }, []);
  useEffect(() => () => {
    if (activityTimer.current) clearTimeout(activityTimer.current);
  }, []);
  const value = useMemo(() => ({
    working: [...runtimeOperations.values()].some(isWorkingEvent),
    voiceActivity,
    latestActivity,
    applyRuntimeActivity,
    clearRuntimeActivities,
  }), [runtimeOperations, voiceActivity, latestActivity,
    applyRuntimeActivity, clearRuntimeActivities]);

  return <JarvisActivityContext.Provider value={value}>{children}</JarvisActivityContext.Provider>;
}
