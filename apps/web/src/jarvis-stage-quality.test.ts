import { describe, expect, it } from 'vitest';
import { resolveJarvisStageQuality } from './jarvis-stage-quality';

describe('Jarvis stage render quality', () => {
  it('uses one fixed reflection and pixel-density budget on phone and desktop', () => {
    expect(resolveJarvisStageQuality(390, 844, 3, 8192)).toEqual({
      pixelRatio: 1,
      reflectionSize: 384,
    });
    expect(resolveJarvisStageQuality(1440, 900, 2, 8192)).toEqual({
      pixelRatio: 1,
      reflectionSize: 384,
    });
  });

  it('caps the drawing buffer at two full-HD megapixels on large monitors', () => {
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160], [7680, 4320]]) {
      const { pixelRatio } = resolveJarvisStageQuality(width!, height!, 3, 8192);
      expect(width! * height! * pixelRatio ** 2).toBeLessThanOrEqual(2_073_601);
    }
    expect(resolveJarvisStageQuality(3840, 2160, 2, 8192).pixelRatio).toBe(0.5);
  });

  it('retains device and maximum-texture limits without adding quality levels', () => {
    expect(resolveJarvisStageQuality(1440, 900, 0.8, 256)).toEqual({
      pixelRatio: 256 / 1440,
      reflectionSize: 256,
    });
    expect(resolveJarvisStageQuality(800, 600, 0.8, 4096).pixelRatio).toBe(0.8);
  });

  it('keeps malformed browser dimensions and capabilities finite', () => {
    expect(resolveJarvisStageQuality(Number.NaN, 0, Number.NaN, Number.NaN)).toEqual({
      pixelRatio: 1,
      reflectionSize: 256,
    });
  });
});
