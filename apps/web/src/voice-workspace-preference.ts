export interface VoiceWorkspacePreference {
  voice: {
    minimizeWindowsOnVoiceStart: boolean;
  };
}

const storageKey = 'jarvis.voice-workspace-preference';

export function readVoiceWorkspacePreference(): VoiceWorkspacePreference {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const value: unknown = JSON.parse(stored);
      if (typeof value === 'object' && value !== null &&
        'voice' in value && typeof value.voice === 'object' && value.voice !== null &&
        'minimizeWindowsOnVoiceStart' in value.voice &&
        typeof value.voice.minimizeWindowsOnVoiceStart === 'boolean') {
        return { voice: { minimizeWindowsOnVoiceStart: value.voice.minimizeWindowsOnVoiceStart } };
      }
    }
  } catch {
    // Storage may be unavailable or contain malformed data; keep the safe default.
  }
  return { voice: { minimizeWindowsOnVoiceStart: false } };
}

export function saveVoiceWorkspacePreference(minimizeWindowsOnVoiceStart: boolean): VoiceWorkspacePreference {
  const preference = { voice: { minimizeWindowsOnVoiceStart } };
  localStorage.setItem(storageKey, JSON.stringify(preference));
  return preference;
}
