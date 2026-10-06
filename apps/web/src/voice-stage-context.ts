import { createContext } from 'react';
import type { JarvisOrbState } from './voice-presentation';

/** Live audio signals read by the stage at render time; microphone input and playback stay distinct. */
export type VoiceSignals = {
  /** Audible decoded playback level now, 0–1. */
  playbackLevel(): number;
  /** Live unmuted microphone input level now, 0–1. */
  inputLevel(): number;
};

/** Lets the active voice controls drive the persistent Jarvis orb without owning the scene. */
export type VoiceStageLink = {
  /** The voice presentation's orb state, or null when no voice session is active. */
  setOrbState(state: JarvisOrbState | null): void;
  setSignals(signals: VoiceSignals | null): void;
};

export const VoiceStageContext = createContext<VoiceStageLink>({
  setOrbState: () => {},
  setSignals: () => {},
});
