import { latticeRadiusFraction } from './jarvis-lattice-painter';

export function resolveJarvisStageQuality(
  width: number,
  height: number,
  devicePixelRatio: number,
  maxTextureSize: number,
) {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const textureLimit = Number.isFinite(maxTextureSize) ? Math.max(256, maxTextureSize) : 256;
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 1;

  return {
    // One fixed budget of about 1080p of pixels, including large monitors; frame timings never change the backing
    // scale. Small and high-density screens may render up to twice their CSS size so the orb's lattice stays sharp.
    pixelRatio: Math.min(ratio, 2, Math.sqrt(2_073_600 / (safeWidth * safeHeight)),
      textureLimit / safeWidth, textureLimit / safeHeight),
    reflectionSize: Math.min(384, textureLimit),
  };
}

/** Side of the square the orb's lattice is painted at: about one texel per drawing-buffer pixel of the orb. */
export function resolveJarvisOrbTextureSize(pixelRadius: number, maxTextureSize: number) {
  const radius = Number.isFinite(pixelRadius) && pixelRadius > 0 ? pixelRadius : 1;
  const limit = Number.isFinite(maxTextureSize) ? Math.max(128, maxTextureSize) : 128;
  return Math.min(1024, limit, Math.max(128, Math.ceil(radius * 2 / latticeRadiusFraction)));
}
