import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export const healthPanelId = 'health-panel';

/** The Health panel opens from the Health card. The address holds the state, so it survives a reload and Back closes it. */
export function useHealthPanel() {
  const [params, setParams] = useSearchParams();
  const expanded = params.get('panel') === 'health';
  const toggle = useCallback(() => setParams(previous => {
    const copy = new URLSearchParams(previous);
    if (copy.get('panel') === 'health') copy.delete('panel');
    else copy.set('panel', 'health');
    return copy;
  }), [setParams]);
  return { expanded, toggle };
}
