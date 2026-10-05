import { beforeEach, describe, expect, it } from 'vitest';
import { readVoiceWorkspacePreference, saveVoiceWorkspacePreference } from './voice-workspace-preference';

const storageKey = 'jarvis.voice-workspace-preference';

describe('voice workspace preference', () => {
  beforeEach(() => localStorage.clear());

  it('defaults window minimisation off and saves the documented voice setting shape', () => {
    expect(readVoiceWorkspacePreference()).toEqual({ voice: { minimizeWindowsOnVoiceStart: false } });

    expect(saveVoiceWorkspacePreference(true)).toEqual({ voice: { minimizeWindowsOnVoiceStart: true } });
    expect(localStorage.getItem(storageKey)).toBe('{"voice":{"minimizeWindowsOnVoiceStart":true}}');
    expect(readVoiceWorkspacePreference()).toEqual({ voice: { minimizeWindowsOnVoiceStart: true } });
  });

  it('ignores malformed or unrelated stored preferences', () => {
    localStorage.setItem(storageKey, '{');
    expect(readVoiceWorkspacePreference()).toEqual({ voice: { minimizeWindowsOnVoiceStart: false } });

    localStorage.setItem(storageKey, JSON.stringify({ voice: { minimizeWindowsOnVoiceStart: 'yes' } }));
    expect(readVoiceWorkspacePreference()).toEqual({ voice: { minimizeWindowsOnVoiceStart: false } });
  });
});
