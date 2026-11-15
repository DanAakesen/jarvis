import { describe, expect, it } from 'vitest';
import { resolveJarvisOrbTextureSize, resolveJarvisStageQuality } from './jarvis-stage-quality';

describe('orb texture size', () => {
  it('paints about one texel per drawing-buffer pixel of the orb', () => {
    expect(resolveJarvisOrbTextureSize(300, 8192)).toBe(619);
  });

  it('stays within a usable range and the device limit', () => {
    expect(resolveJarvisOrbTextureSize(10, 8192)).toBe(128);
    expect(resolveJarvisOrbTextureSize(900, 8192)).toBe(1024);
    expect(resolveJarvisOrbTextureSize(900, 512)).toBe(512);
    expect(resolveJarvisOrbTextureSize(Number.NaN, Number.NaN)).toBe(128);
  });
});

describe('stage quality', () => {
  it('keeps the drawing buffer within one fixed pixel budget', () => {
    const phone = resolveJarvisStageQuality(390, 844, 3, 8192);
    expect(phone.pixelRatio).toBe(2);
    const monitor = resolveJarvisStageQuality(3840, 2160, 2, 8192);
    expect(3840 * 2160 * monitor.pixelRatio ** 2).toBeLessThanOrEqual(2_073_600 + 1);
    expect(resolveJarvisStageQuality(1280, 720, 1, 8192).pixelRatio).toBe(1);
  });
});
