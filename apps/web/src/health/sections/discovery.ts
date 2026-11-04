import type { HealthSourceId } from '@jarvis/contracts';
import type { HealthSectionDefinition } from './types';

export async function loadHealthSectionModules(
  modules: Record<string, () => Promise<{ section: HealthSectionDefinition }>>,
) {
  const loaded = await Promise.all(Object.entries(modules).map(async ([path, load]) => [path, await load()] as const));
  return Object.fromEntries(loaded);
}

export function discoverHealthSections(
  modules: Record<string, { section: HealthSectionDefinition }>,
  sources: readonly HealthSourceId[],
) {
  return Object.entries(modules)
    .filter(([path]) => /^\.\/sections\/[^/]+\/index\.tsx$/u.test(path))
    .map(([, module]) => module.section)
    .filter(section => section.requiredSources.every(source => sources.includes(source)) &&
      (section.isAvailable?.(sources) ?? true))
    .sort((first, second) => first.order - second.order);
}
