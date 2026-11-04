import { describe, expect, it, vi } from 'vitest';
import { healthQuerySources as sources } from '@jarvis/contracts';
import type { HealthSectionDefinition } from './types';
import { discoverHealthSections, loadHealthSectionModules } from './discovery';

const Component = vi.fn();
const fixtureModules = import.meta.glob<{ section: HealthSectionDefinition }>('./__fixtures__/*/index.tsx');
const section = (id: string, order: number, requiredSources: HealthSectionDefinition['requiredSources'] = []): HealthSectionDefinition => ({
  id, label: id, order, usesPeriod: false, requiredSources, Component,
});

describe('Health section discovery', () => {
  it('preserves required-source filtering when no availability predicate is defined', () => {
    const modules = {
      './sections/available/index.tsx': { section: section('available', 10, [sources.sleep]) },
      './sections/unavailable/index.tsx': { section: section('unavailable', 20, [sources.metrics]) },
    };
    expect(discoverHealthSections(modules, [sources.sleep]).map(item => item.id)).toEqual(['available']);
  });

  it('requires both required sources and a true availability predicate', () => {
    const accepts = vi.fn(() => true);
    const rejects = vi.fn(() => false);
    const modules = {
      './sections/accepted/index.tsx': { section: { ...section('accepted', 10, [sources.sleep]), isAvailable: accepts } },
      './sections/rejected/index.tsx': { section: { ...section('rejected', 20), isAvailable: rejects } },
      './sections/missing/index.tsx': { section: { ...section('missing', 30, [sources.metrics]), isAvailable: accepts } },
    };
    expect(discoverHealthSections(modules, [sources.sleep]).map(item => item.id)).toEqual(['accepted']);
    expect(accepts).toHaveBeenCalledExactlyOnceWith([sources.sleep]);
    expect(rejects).toHaveBeenCalledExactlyOnceWith([sources.sleep]);
  });

  it('discovers a lazily loaded fixture folder and filters unmet source requirements', async () => {
    const unavailable = section('unavailable', 30, [sources.meals]);
    const loadedFixtureModules = await loadHealthSectionModules(fixtureModules);
    const modules = Object.fromEntries([
      ...Object.entries(loadedFixtureModules).map(([path, module]) => [`./sections/${path.split('/')[2]}/index.tsx`, module] as const),
      ['./sections/unavailable/index.tsx', { section: unavailable }] as const,
      ['./elsewhere/index.tsx', { section: section('not-a-section', 10) }] as const,
    ]);
    const found = discoverHealthSections(modules as Record<string, { section: HealthSectionDefinition }>, [sources.metrics]);

    expect(found.map(item => item.id)).toEqual(['fixture']);
  });
});
