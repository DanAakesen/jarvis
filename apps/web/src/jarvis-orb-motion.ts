import type { JarvisOrbState } from './voice-presentation';

/** Seconds for the dormant-to-awake sequence and for settling back to dormancy. */
export const wakeDuration = 1.05;
export const sleepDuration = 0.7;

export type OrbMotionInput = {
  /** 0 dormant, 1 fully awake voice, intermediate for chat-only work. */
  awake: number;
  state: JarvisOrbState;
  /** Audible decoded playback level now, 0–1. */
  playback: number;
  /** Live microphone input level now, 0–1. */
  input: number;
  reducedMotion: boolean;
};

export type OrbMotionFrame = {
  /** Settled overall wakefulness, 0–1. */
  awake: number;
  /** Amber core ignition, leading the sequence. */
  ignite: number;
  /** Position of the energy front travelling from the core to the shell edge, 0–1. */
  wave: number;
  /** Visibility of that front; only present while waking. */
  waveStrength: number;
  /** Expansion and light surge that settles into the active form. */
  surge: number;
  listen: number;
  think: number;
  tool: number;
  speak: number;
  /** Smoothed audible speech envelope. */
  speech: number;
  /** Smoothed microphone input envelope. */
  input: number;
};

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Exponential attack/release follower; frame-rate independent. */
export function followEnvelope(current: number, target: number, delta: number, attack: number, release: number) {
  const goal = clamp01(target);
  const rate = goal > current ? attack : release;
  return current + (goal - current) * (1 - Math.exp(-rate * Math.max(0, delta)));
}

/**
 * Pure orb motion model shared by the scene and its tests. The wake timeline is continuous, so
 * ending, reversing or restarting voice mid-sequence settles smoothly without restarting or flashing.
 */
export function createOrbMotion() {
  let timeline = 0;
  let rising = false;
  let surge = 0;
  let waveStrength = 0;
  const weights = { listen: 0, think: 0, tool: 0, speak: 0 };
  let speech = 0;
  let input = 0;

  return {
    step(delta: number, options: OrbMotionInput): OrbMotionFrame {
      const target = clamp01(options.awake);
      const dt = Math.max(0, Math.min(delta, 0.12));
      if (options.reducedMotion) {
        timeline = target;
        rising = false;
        surge = 0;
        waveStrength = 0;
        for (const key of Object.keys(weights) as (keyof typeof weights)[]) {
          weights[key] = options.state === stateFor(key) ? 1 : 0;
        }
        speech = 0;
        input = 0;
      } else {
        rising = target > timeline + 1e-4;
        if (rising) timeline = Math.min(target, timeline + dt / wakeDuration);
        else timeline = Math.max(target, timeline - dt / sleepDuration);
        const surgeTarget = rising ? smoothstep(0.45, 0.85, timeline) : 0;
        surge = followEnvelope(surge, surgeTarget, dt, 14, 3.2);
        const waveTarget = rising ? Math.sin(Math.PI * smoothstep(0.12, 0.8, timeline)) : 0;
        waveStrength = followEnvelope(waveStrength, waveTarget, dt, 18, 5);
        for (const key of Object.keys(weights) as (keyof typeof weights)[]) {
          weights[key] = followEnvelope(weights[key], options.state === stateFor(key) ? 1 : 0, dt, 7, 4.5);
        }
        // Speech follows decoded playback at actual playback time; silence or interruption resets it.
        speech = options.state === 'speaking'
          ? followEnvelope(speech, options.playback, dt, 28, 7)
          : followEnvelope(speech, 0, dt, 28, 16);
        input = options.state === 'listening'
          ? followEnvelope(input, options.input, dt, 22, 6)
          : 0;
      }
      return {
        awake: smoothstep(0.2, 1, timeline),
        ignite: smoothstep(0, 0.35, timeline),
        wave: smoothstep(0.12, 0.8, timeline),
        waveStrength,
        surge,
        ...weights,
        speech,
        input,
      };
    },
  };
}

function stateFor(key: 'listen' | 'think' | 'tool' | 'speak'): JarvisOrbState {
  return key === 'listen' ? 'listening' : key === 'think' ? 'thinking' : key === 'tool' ? 'tool' : 'speaking';
}
