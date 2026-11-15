import { describe, expect, it } from 'vitest';
import { createOrbAnimator, createOrbMotion, stillFlow, stillTime, type OrbMotionInput } from './jarvis-orb-motion';

const listening: OrbMotionInput = { awake: 1, state: 'listening', playback: 0, input: 0.8, reducedMotion: false };

describe('orb motion', () => {
  it('releases the microphone envelope after listening instead of snapping it to zero', () => {
    const motion = createOrbMotion();
    let frame = motion.step(0.05, listening);
    for (let index = 0; index < 20; index += 1) frame = motion.step(0.05, listening);
    expect(frame.input).toBeGreaterThan(0.6);
    const released = motion.step(0.05, { ...listening, state: 'idle' });
    expect(released.input).toBeGreaterThan(0.1);
    expect(released.input).toBeLessThan(frame.input);
    for (let index = 0; index < 60; index += 1) frame = motion.step(0.05, { ...listening, state: 'idle' });
    expect(frame.input).toBeLessThan(0.01);
  });

  it('holds a steady pose under reduced motion', () => {
    const motion = createOrbMotion();
    const frame = motion.step(0.05, { ...listening, reducedMotion: true });
    expect(frame.input).toBe(0);
    expect(frame.listen).toBe(1);
  });
});

describe('orb animator', () => {
  const calm: OrbMotionInput = { awake: 0.35, state: 'idle', playback: 0, input: 0, reducedMotion: false };

  it('runs the flow clock at a steady pace when calm and faster while thinking', () => {
    const calmAnimator = createOrbAnimator();
    const busyAnimator = createOrbAnimator();
    let calmFrame = calmAnimator.step(0, calm);
    let busyFrame = busyAnimator.step(0, calm);
    for (let index = 0; index < 120; index += 1) {
      calmFrame = calmAnimator.step(1 / 30, calm);
      busyFrame = busyAnimator.step(1 / 30, { ...calm, awake: 1, state: 'thinking' });
    }
    expect(calmFrame.time).toBeCloseTo(4, 6);
    expect(calmFrame.flow).toBeCloseTo(4, 6);
    expect(busyFrame.time).toBeCloseTo(4, 6);
    expect(busyFrame.flow).toBeGreaterThan(busyFrame.time * 1.5);
  });

  it('never lets a long pause jump the clocks', () => {
    const animator = createOrbAnimator();
    animator.step(0, calm);
    const frame = animator.step(30, calm);
    expect(frame.time).toBeCloseTo(0.12, 6);
    expect(frame.flow).toBeCloseTo(0.12, 6);
  });

  it('draws the still pose under reduced motion', () => {
    const animator = createOrbAnimator();
    animator.step(1, calm);
    const frame = animator.step(1, { ...calm, reducedMotion: true });
    expect(frame.time).toBe(stillTime);
    expect(frame.flow).toBe(stillFlow);
  });
});
