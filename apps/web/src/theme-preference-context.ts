import { createContext, useContext } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = Exclude<ThemeMode, 'system'>;

export interface AppearancePreferences {
  theme: ThemeMode;
  accent?: string;
  'accent-secondary'?: string;
  'surface-tint'?: string;
  background?: 'living-aurora' | 'daylight-studio';
  glow?: number;
  motion?: 'full' | 'calm' | 'reduced';
  radius?: number;
  density?: 'compact' | 'comfortable';
}

export interface ThemePreference {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  appearance: AppearancePreferences;
  state: 'loading' | 'ready' | 'error' | 'unavailable';
  saving: boolean;
  error: string;
  message: string;
  saveTheme: (theme: ThemeMode) => Promise<void>;
  refreshAppearance: () => Promise<void>;
  retry: () => void;
}

export const ThemePreferenceContext = createContext<ThemePreference | null>(null);

export function useThemePreference() {
  const preference = useContext(ThemePreferenceContext);
  if (!preference) throw new Error('ThemePreferenceProvider is missing.');
  return preference;
}
