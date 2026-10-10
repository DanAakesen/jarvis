import { describe, expect, it } from 'vitest';
import { initialJarvisStageQualityLevel, nextJarvisStageQualityLevel, resolveJarvisStageQuality } from './jarvis-stage-quality';

describe('Jarvis stage render quality', () => {
  it('starts compact viewports in the low-work tier and retains the low-texture fallback', () => {
    expect(initialJarvisStageQualityLevel(8192, true)).toBe(2);
    expect(initialJarvisStageQualityLevel(2048, false)).toBe(1);
    expect(initialJarvisStageQualityLevel(8192, false)).toBe(0);
  });

  it('caps pixel ratio and reflection size for compact viewports', () => {
    expect(resolveJarvisStageQuality(390, 844, 3, 8192, 0)).toEqual({
      pixelRatio: 1,
      reflectionSize: 512,
      particleScale: 1,
    });
    expect(resolveJarvisStageQuality(844, 390, 2, 8192, 0)).toEqual({
      pixelRatio: 1,
      reflectionSize: 512,
      particleScale: 1,
    });
  });

  it('caps desktop pixel ratio at 1.2', () => {
    expect(resolveJarvisStageQuality(1280, 900, 3, 8192, 0).pixelRatio).toBe(1.2);
  });

  it('reduces effects and renderer resolution at lower quality levels', () => {
    expect(resolveJarvisStageQuality(390, 844, 3, 8192, 2)).toEqual({
      pixelRatio: 0.7,
      reflectionSize: 256,
      particleScale: 0.35,
    });
    expect(resolveJarvisStageQuality(1440, 900, 2, 4096, 2)).toEqual({
      pixelRatio: 0.84,
      reflectionSize: 384,
      particleScale: 0.35,
    });
    expect(resolveJarvisStageQuality(390, 844, 3, 1024, 2).reflectionSize).toBe(256);
  });

  it('downshifts on slow frames and only restores quality after fast frames', () => {
    expect(nextJarvisStageQualityLevel(0, 28)).toBe(1);
    expect(nextJarvisStageQualityLevel(1, 28)).toBe(2);
    expect(nextJarvisStageQualityLevel(2, 28)).toBe(2);
    expect(nextJarvisStageQualityLevel(2, 16)).toBe(1);
    expect(nextJarvisStageQualityLevel(0, 16)).toBe(0);
    expect(nextJarvisStageQualityLevel(1, Number.NaN)).toBe(1);
  });
});
