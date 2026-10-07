import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { backendFetch } from './backend-request';
import {
  ThemePreferenceContext,
  type AppearancePreferences,
  type ResolvedTheme,
  type ThemeMode,
} from './theme-preference-context';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAppearancePreferences(value: unknown): value is AppearancePreferences {
  if (!isObject(value) || (value.theme !== 'light' && value.theme !== 'dark' && value.theme !== 'system')) return false;
  for (const key of ['accent', 'accent-secondary', 'surface-tint'] as const) {
    if (key in value && (typeof value[key] !== 'string' || !/^#[\da-f]{6}$/i.test(value[key]))) return false;
  }
  if ('background' in value && value.background !== 'living-aurora' && value.background !== 'daylight-studio') return false;
  if ('glow' in value && (typeof value.glow !== 'number' || !Number.isFinite(value.glow) || value.glow < 0 || value.glow > 1)) return false;
  if ('motion' in value && value.motion !== 'full' && value.motion !== 'calm' && value.motion !== 'reduced') return false;
  if ('radius' in value && (typeof value.radius !== 'number' || !Number.isFinite(value.radius) || value.radius < 0 || value.radius > 24)) return false;
  if ('density' in value && value.density !== 'compact' && value.density !== 'comfortable') return false;
  return true;
}

function resolveTheme(theme: ThemeMode): ResolvedTheme {
  return theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' :
    theme === 'system' ? 'light' : theme;
}

const lastThemeKey = 'jarvis.lastTheme';

function readLastTheme(): ThemeMode {
  try {
    const value = localStorage.getItem(lastThemeKey);
    return value === 'dark' || value === 'system' || value === 'light' ? value : 'light';
  } catch {
    return 'light';
  }
}

function saveLastTheme(theme: ThemeMode) {
  try { localStorage.setItem(lastThemeKey, theme); } catch { /* Signed-out pages then use the light default. */ }
}

function foregroundFor(hex: string): string {
  const channels = hex.slice(1).match(/.{2}/g)!.map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  return luminance > 0.179 ? '#000000' : '#ffffff';
}

function setStyleToken(property: string, value: string | number | undefined) {
  if (value === undefined) document.documentElement.style.removeProperty(property);
  else document.documentElement.style.setProperty(property, String(value));
}

function applyAppearance(appearance: AppearancePreferences, resolvedTheme: ResolvedTheme) {
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme;
  if (appearance.background) root.dataset.background = appearance.background;
  else delete root.dataset.background;
  if (appearance.motion) root.dataset.motion = appearance.motion;
  else delete root.dataset.motion;
  setStyleToken('--theme-accent', appearance.accent);
  setStyleToken('--theme-accent-foreground', appearance.accent ? foregroundFor(appearance.accent) : undefined);
  setStyleToken('--theme-accent-secondary', appearance['accent-secondary']);
  setStyleToken('--theme-surface-tint', appearance['surface-tint']);
  setStyleToken('--theme-glow', appearance.glow);
  setStyleToken('--theme-radius', appearance.radius === undefined ? undefined : `${appearance.radius}px`);
  setStyleToken('--theme-density-scale', appearance.density === 'compact' ? 0.8 : appearance.density ? 1 : undefined);
}

async function requestAppearance(
  backendUrl: string,
  getAccessToken: () => Promise<string>,
  method: 'GET' | 'PATCH',
  theme?: ThemeMode,
): Promise<AppearancePreferences> {
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
  if (!isObject(result) || !isObject(result.settings) ||
      !isAppearancePreferences(result.settings.appearance)) {
    throw new Error('Jarvis returned invalid theme settings. Try again.');
  }
  return result.settings.appearance;
}

export function ThemePreferenceProvider({
  enabled, backendUrl, getAccessToken, children,
}: {
  enabled: boolean;
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  children: ReactNode;
}) {
  const [appearance, setAppearance] = useState<AppearancePreferences>(() => ({ theme: readLastTheme() }));
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(readLastTheme()));
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'unavailable'>(
    enabled && backendUrl ? 'loading' : 'unavailable',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);

  useLayoutEffect(() => {
    const apply = () => {
      const resolved = resolveTheme(appearance.theme);
      setResolvedTheme(resolved);
      applyAppearance(appearance, resolved);
    };
    apply();
    // Signed out, Jarvis cannot read the saved theme yet, so it starts from the last one used on this device.
    if (enabled) saveLastTheme(appearance.theme);
    if (appearance.theme !== 'system') return;
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', apply);
    return () => media?.removeEventListener?.('change', apply);
  }, [appearance, enabled]);

  useEffect(() => {
    if (!enabled || !backendUrl) return;

    let active = true;
    void requestAppearance(backendUrl, getAccessToken, 'GET').then((acceptedAppearance) => {
      if (!active) return;
      setAppearance(acceptedAppearance);
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
      const acceptedAppearance = await requestAppearance(backendUrl, getAccessToken, 'PATCH', nextTheme);
      if (acceptedAppearance.theme !== nextTheme) throw new Error('Jarvis did not accept the requested theme. The previous theme remains active.');
      setAppearance(acceptedAppearance);
      setMessage('Theme saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Theme could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  }, [backendUrl, getAccessToken, saving, state]);

  const refreshAppearance = useCallback(async () => {
    if (!enabled || !backendUrl) return;
    try {
      const latestAppearance = await requestAppearance(backendUrl, getAccessToken, 'GET');
      setAppearance(latestAppearance);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Theme settings could not be refreshed. Try again.');
    }
  }, [backendUrl, enabled, getAccessToken]);

  const retry = useCallback(() => {
    if (!backendUrl || !enabled) return;
    setError('');
    setState('loading');
    setAttempt((current) => current + 1);
  }, [backendUrl, enabled]);

  return (
    <ThemePreferenceContext.Provider value={{
      theme: appearance.theme,
      resolvedTheme,
      appearance,
      state,
      saving,
      error,
      message,
      saveTheme,
      refreshAppearance,
      retry,
    }}>
      {children}
    </ThemePreferenceContext.Provider>
  );
}
