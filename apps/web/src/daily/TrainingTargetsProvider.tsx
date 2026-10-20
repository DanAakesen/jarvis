import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTrainingTargets } from './training-targets';
import { TrainingTargetsContext, type TrainingTargetsShared } from './training-targets-context';

/** Reads the owner's training targets once per visit to the Health area, and only when a view needs them. */
export function TrainingTargetsProvider({ backendUrl, getAccessToken, children }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  children: ReactNode;
}) {
  const [wanted, setWanted] = useState(false);
  const read = useTrainingTargets(backendUrl, getAccessToken, wanted);
  const want = useCallback(() => setWanted(true), []);
  const { retry, apply } = read;
  const value = useMemo<TrainingTargetsShared>(
    () => ({ view: wanted ? read.view : { status: 'loading' }, retry, apply, want }),
    [wanted, read.view, retry, apply, want],
  );
  return <TrainingTargetsContext.Provider value={value}>{children}</TrainingTargetsContext.Provider>;
}
