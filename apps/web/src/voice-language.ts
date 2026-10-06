import type { VoiceLanguage } from './voice-client';

export const voiceLanguages: ReadonlyArray<{ value: VoiceLanguage; label: string }> = [
  { value: 'da', label: 'Danish' },
  { value: 'en', label: 'English' },
];

export function languageName(language: VoiceLanguage): string {
  return language === 'da' ? 'Danish' : 'English';
}
