import { describe, expect, it, vi } from 'vitest';
import { dailyQuerySources as sources } from '@jarvis/contracts';
import type { DailySectionDefinition } from './types';
import { discoverDailySections, loadDailySectionModules } from './discovery';

const Component = vi.fn();
const fixtureModules = import.meta.glob<{ section: DailySectionDefinition }>('./__fixtures__/*/index.tsx');
const section = (id: string, order: number, requiredSources: DailySectionDefinition['requiredSources'] = []): DailySectionDefinition => ({
  id, label: id, order, usesPeriod: false, requiredSources, Component,
});

describe('Daily section discovery', () => {
  it('discovers a lazily loaded fixture folder and filters unmet source requirements', async () => {
    const unavailable = section('unavailable', 30, [sources.meals]);
    const loadedFixtureModules = await loadDailySectionModules(fixtureModules);
    const modules = Object.fromEntries([
      ...Object.entries(loadedFixtureModules).map(([path, module]) => [`./sections/${path.split('/')[2]}/index.tsx`, module] as const),
      ['./sections/unavailable/index.tsx', { section: unavailable }] as const,
      ['./elsewhere/index.tsx', { section: section('not-a-section', 10) }] as const,
    ]);
    const found = discoverDailySections(modules as Record<string, { section: DailySectionDefinition }>, [sources.metrics]);

    expect(found.map(item => item.id)).toEqual(['fixture']);
  });
});
