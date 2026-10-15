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
    // One fixed budget, including large monitors; frame timings never change the backing scale.
    pixelRatio: Math.min(ratio, 1, Math.sqrt(2_073_600 / (safeWidth * safeHeight)),
      textureLimit / safeWidth, textureLimit / safeHeight),
    reflectionSize: Math.min(384, textureLimit),
  };
}
