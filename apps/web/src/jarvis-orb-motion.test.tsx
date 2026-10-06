import { describe, expect, it } from 'vitest';
import { createOrbMotion, followEnvelope, type OrbMotionInput } from './jarvis-orb-motion';

const dormant: OrbMotionInput = { awake: 0, state: 'idle', playback: 0, input: 0, reducedMotion: false };

function run(motion: ReturnType<typeof createOrbMotion>, seconds: number, input: OrbMotionInput) {
  let frame = motion.step(0, input);
  for (let time = 0; time < seconds; time += 1 / 60) frame = motion.step(1 / 60, input);
  return frame;
}

describe('orb motion', () => {
  it('stages the wake: core ignites first, the wave travels outward, then a surge settles', () => {
    const motion = createOrbMotion();
    const awake = { ...dormant, awake: 1, state: 'listening' as const };
    const early = run(motion, 0.25, awake);
    expect(early.ignite).toBeGreaterThan(0.5);
    expect(early.awake).toBeLessThan(0.1);
    expect(early.wave).toBeLessThan(0.3);

    const middle = run(motion, 0.45, awake);
    expect(middle.wave).toBeGreaterThan(early.wave);
    expect(middle.waveStrength).toBeGreaterThan(0.3);
    expect(middle.surge).toBeGreaterThan(0.2);

    const settled = run(motion, 1.6, awake);
    expect(settled.awake).toBe(1);
    expect(settled.surge).toBeLessThan(0.05);
    expect(settled.waveStrength).toBeLessThan(0.05);
    expect(settled.listen).toBeGreaterThan(0.95);
  });

  it('reverses smoothly when voice ends mid-wake', () => {
    const motion = createOrbMotion();
    const partial = run(motion, 0.5, { ...dormant, awake: 1 });
    const next = motion.step(1 / 60, dormant);
    expect(Math.abs(next.ignite - partial.ignite)).toBeLessThan(0.1);
    const asleep = run(motion, 1, dormant);
    expect(asleep.awake).toBe(0);
    expect(asleep.ignite).toBe(0);
  });

  it('follows audible playback with attack/release and resets on silence or interruption', () => {
    const motion = createOrbMotion();
    const speaking = { ...dormant, awake: 1, state: 'speaking' as const, playback: 0.8 };
    run(motion, 1.2, { ...speaking, playback: 0 });
    const attack = motion.step(0.05, speaking);
    expect(attack.speech).toBeGreaterThan(0.4);
    const held = run(motion, 0.3, speaking);
    expect(held.speech).toBeCloseTo(0.8, 2);
    const interrupted = run(motion, 0.4, { ...speaking, state: 'listening', playback: 0 });
    expect(interrupted.speech).toBeLessThan(0.01);
    expect(interrupted.speak).toBeLessThan(0.2);
  });

  it('keeps microphone input separate from playback', () => {
    const motion = createOrbMotion();
    const frame = run(motion, 0.5, { ...dormant, awake: 1, state: 'listening', input: 0.6, playback: 0.9 });
    expect(frame.input).toBeGreaterThan(0.5);
    expect(frame.speech).toBe(0);
  });

  it('snaps to steady, distinct states under reduced motion', () => {
    const motion = createOrbMotion();
    const frame = motion.step(0, { ...dormant, awake: 1, state: 'tool', playback: 1, reducedMotion: true });
    expect(frame).toMatchObject({ awake: 1, surge: 0, waveStrength: 0, tool: 1, listen: 0, speech: 0 });
  });

  it('follows envelopes frame-rate independently', () => {
    const single = followEnvelope(0, 1, 0.1, 10, 2);
    let stepped = 0;
    for (let index = 0; index < 10; index += 1) stepped = followEnvelope(stepped, 1, 0.01, 10, 2);
    expect(stepped).toBeCloseTo(single, 6);
    expect(followEnvelope(0.5, Number.NaN, 0.1, 10, 2)).toBeLessThan(0.5);
  });
});
