import type { DailySourceId } from '@jarvis/contracts';
import type { DailySectionDefinition } from './types';

export async function loadDailySectionModules(
  modules: Record<string, () => Promise<{ section: DailySectionDefinition }>>,
) {
  const loaded = await Promise.all(Object.entries(modules).map(async ([path, load]) => [path, await load()] as const));
  return Object.fromEntries(loaded);
}

export function discoverDailySections(
  modules: Record<string, { section: DailySectionDefinition }>,
  sources: readonly DailySourceId[],
) {
  return Object.entries(modules)
    .filter(([path]) => /^\.\/sections\/[^/]+\/index\.tsx$/u.test(path))
    .map(([, module]) => module.section)
    .filter(section => section.requiredSources.every(source => sources.includes(source)))
    .sort((first, second) => first.order - second.order);
}
