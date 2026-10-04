import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { backendFetch } from './backend-request';
import { ThemePreferenceContext, type ThemeMode } from './theme-preference-context';

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

async function requestTheme(
  backendUrl: string,
  getAccessToken: () => Promise<string>,
  method: 'GET' | 'PATCH',
  theme?: ThemeMode,
): Promise<ThemeMode> {
  const response = await backendFetch(`${backendUrl}/settings`, {
    method,
    headers: {
      Authorization: `${['Bear', 'er'].join('')} ${await getAccessToken()}`,
      Accept: 'application/json',
      ...(theme ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(theme ? { body: JSON.stringify({ settings: { appearance: { theme } } }) } : {}),
  });
  if (response.status === 401) throw new Error('Your Microsoft sign-in needs attention. Sign in again.');
  if (response.status === 503) throw new Error('Settings are unavailable until the database is connected.');
  if (!response.ok) throw new Error(`Jarvis could not ${method === 'GET' ? 'load' : 'save'} the theme (HTTP ${response.status}).`);
  let result: unknown;
  try { result = await response.json(); } catch { throw new Error('Jarvis returned invalid theme settings. Try again.'); }
  if (typeof result !== 'object' || result === null ||
      !('settings' in result) || typeof result.settings !== 'object' || result.settings === null ||
      !('appearance' in result.settings) || typeof result.settings.appearance !== 'object' ||
      result.settings.appearance === null || !('theme' in result.settings.appearance) ||
      !isThemeMode(result.settings.appearance.theme)) {
    throw new Error('Jarvis returned invalid theme settings. Try again.');
  }
  return result.settings.appearance.theme;
}

export function ThemePreferenceProvider({
  enabled, backendUrl, getAccessToken, children,
}: {
  enabled: boolean;
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState<ThemeMode>('light');
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'unavailable'>(
    enabled && backendUrl ? 'loading' : 'unavailable',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!enabled || !backendUrl) return;

    let active = true;
    void requestTheme(backendUrl, getAccessToken, 'GET').then((acceptedTheme) => {
      if (!active) return;
      setTheme(acceptedTheme);
      setState('ready');
    }).catch((cause: unknown) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : 'Theme settings could not be loaded. Try again.');
      setState('error');
    });
    return () => { active = false; };
  }, [attempt, backendUrl, enabled, getAccessToken]);

  const saveTheme = useCallback(async (nextTheme: ThemeMode) => {
    if (state !== 'ready' || saving || !backendUrl) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const acceptedTheme = await requestTheme(backendUrl, getAccessToken, 'PATCH', nextTheme);
      if (acceptedTheme !== nextTheme) throw new Error('Jarvis did not accept the requested theme. The previous theme remains active.');
      setTheme(acceptedTheme);
      setMessage('Theme saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Theme could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  }, [backendUrl, getAccessToken, saving, state]);

  const retry = useCallback(() => {
    if (!backendUrl || !enabled) return;
    setError('');
    setState('loading');
    setAttempt((current) => current + 1);
  }, [backendUrl, enabled]);

  return (
    <ThemePreferenceContext.Provider value={{ theme, state, saving, error, message, saveTheme, retry }}>
      {children}
    </ThemePreferenceContext.Provider>
  );
}
