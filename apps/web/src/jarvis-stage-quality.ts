export type JarvisStageQualityLevel = 0 | 1 | 2;

export function resolveJarvisStageQuality(
  width: number,
  height: number,
  devicePixelRatio: number,
  maxTextureSize: number,
  level: JarvisStageQualityLevel,
) {
  const compact = width <= 700 || height <= 500;
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const textureLimit = Number.isFinite(maxTextureSize) ? Math.max(256, maxTextureSize) : 256;
  const baseReflection = Math.min(compact ? 512 : 768, textureLimit);
  const ratios = [1, 0.84, 0.7] as const;
  const reflectionScales = [1, 0.75, 0.5] as const;
  const particleScales = [1, 0.65, 0.35] as const;

  return {
    pixelRatio: Math.max(0.6, Math.min(ratio, compact ? 1 : 1.2) * ratios[level]),
    reflectionSize: Math.max(256, Math.floor((baseReflection * reflectionScales[level]) / 64) * 64),
    particleScale: particleScales[level],
  };
}

export function nextJarvisStageQualityLevel(
  level: JarvisStageQualityLevel,
  averageFrameTime: number,
): JarvisStageQualityLevel {
  if (!Number.isFinite(averageFrameTime)) return level;
  if (averageFrameTime > 24) return Math.min(2, level + 1) as JarvisStageQualityLevel;
  if (averageFrameTime < 17) return Math.max(0, level - 1) as JarvisStageQualityLevel;
  return level;
}
