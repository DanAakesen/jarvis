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

/** A partial appearance update; colours may be null to clear an override. */
export type AppearanceChange = Partial<Omit<AppearancePreferences, 'accent' | 'accent-secondary' | 'surface-tint'>> & {
  accent?: string | null; 'accent-secondary'?: string | null; 'surface-tint'?: string | null;
};

export interface ThemePreference {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  appearance: AppearancePreferences;
  state: 'loading' | 'ready' | 'error' | 'unavailable';
  saving: boolean;
  error: string;
  message: string;
  saveTheme: (theme: ThemeMode) => Promise<void>;
  /** Saves appearance details; null removes an override so the theme default applies. Resolves false if refused. */
  saveAppearance?: (change: AppearanceChange) => Promise<boolean>;
  refreshAppearance: () => Promise<void>;
  retry: () => void;
}

export const ThemePreferenceContext = createContext<ThemePreference | null>(null);

export function useThemePreference() {
  const preference = useContext(ThemePreferenceContext);
  if (!preference) throw new Error('ThemePreferenceProvider is missing.');
  return preference;
}
