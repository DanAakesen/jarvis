import { createContext, useContext } from 'react';

export type ThemeMode = 'light' | 'dark';

export interface ThemePreference {
  theme: ThemeMode;
  state: 'loading' | 'ready' | 'error' | 'unavailable';
  saving: boolean;
  error: string;
  message: string;
  saveTheme: (theme: ThemeMode) => Promise<void>;
  retry: () => void;
}

export const ThemePreferenceContext = createContext<ThemePreference | null>(null);

export function useThemePreference() {
  const preference = useContext(ThemePreferenceContext);
  if (!preference) throw new Error('ThemePreferenceProvider is missing.');
  return preference;
}
