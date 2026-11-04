import { useEffect, useState } from 'react';
import { loadNutritionTargets, nutritionTargetsFailureMessage, NutritionTargetsError, type NutritionTargetsState } from '../../nutrition-targets';

export function useNutritionTargets(backendUrl: string | null, getAccessToken: () => Promise<string>, enabled: boolean) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; state: NutritionTargetsState | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let active = true;
    void loadNutritionTargets(backendUrl, getAccessToken,
      AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)])).then(
      state => { if (active) setResult({ attempt, state, error: null }); },
      error => {
        if (!active || controller.signal.aborted) return;
        const kind = error instanceof NutritionTargetsError ? error.kind : 'failed';
        setResult({ attempt, state: null, error: nutritionTargetsFailureMessage(kind, 'load') });
      },
    );
    return () => { active = false; controller.abort(); };
  }, [backendUrl, getAccessToken, attempt, enabled]);
  return { current: result?.attempt === attempt ? result : null, retry: () => setAttempt(value => value + 1) };
}

export type NutritionTargetsLoad = ReturnType<typeof useNutritionTargets>;
