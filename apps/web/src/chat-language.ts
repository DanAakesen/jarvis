export type ChatLanguage = 'da' | 'en';

export const chatLanguages: ReadonlyArray<{ value: ChatLanguage; label: string }> = [
  { value: 'da', label: 'Danish' },
  { value: 'en', label: 'English' },
];
