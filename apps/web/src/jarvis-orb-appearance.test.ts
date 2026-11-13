import { describe, expect, it } from 'vitest';
import { orbAppearance } from './jarvis-orb-appearance';
import { createJarvisStageOrb } from './JarvisStageOrb';

describe('orb appearance', () => {
  it('uses the shared orange core and restrained glow', () => {
    expect(orbAppearance).toEqual({
      cool: '#52dcfa', warm: '#ff8738', glowRadius: 0.52, glowOpacity: 0.12,
    });
    const stage = createJarvisStageOrb();
    expect(stage.uniforms.uWarm.value.getHexString()).toBe('ff8738');
  });
});
