import { describe, expect, it } from 'vitest';
import { detectLanguage } from './language.js';

describe('proactive language detection', () => {
  it('detects Danish function words and letters', () => {
    expect(detectLanguage(['Jeg har en opgave, og den er på min liste.'])).toBe('da');
    expect(detectLanguage(['Mødet er på torsdag, og jeg skal være klar.'])).toBe('da');
  });

  it('detects English and defaults ties or empty input to English', () => {
    expect(detectLanguage(['I have a task and it is on the list.'])).toBe('en');
    expect(detectLanguage([])).toBe('en');
    expect(detectLanguage(['and the', 'og det'])).toBe('en');
  });

  it('uses only the most recent messages', () => {
    expect(detectLanguage(['Jeg har en dansk besked.','The latest message is in English.'])).toBe('en');
  });
});
