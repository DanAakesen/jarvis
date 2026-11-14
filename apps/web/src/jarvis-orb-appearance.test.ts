import { describe, expect, it } from 'vitest';
import { orbAppearance } from './jarvis-orb-appearance';
import { createJarvisStageOrb } from './JarvisStageOrb';

describe('orb appearance', () => {
  it('uses the shared cyan, blue and amber of the cognitive lattice', () => {
    expect(orbAppearance).toEqual({ cool: '#52dcfa', deep: '#247af2', warm: '#ffa62e', hot: '#ffdc8e' });
  });

  it('starts the stage orb in the shared cool colour until the theme tints its lights', () => {
    expect(createJarvisStageOrb().uniforms.uColor.value.getHexString()).toBe('52dcfa');
  });
});
