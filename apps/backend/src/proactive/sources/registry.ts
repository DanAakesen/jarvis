import type { ProactiveSource, SourceId } from '../types.js';
import type { GoogleApiClient } from '../../google/api-client.js';
import type { TaskStore } from '../../factory/task-store.js';
import type { SettingsStore } from '../../core/settings.js';
import type { createGitHubVaultClient } from '../../vault/github-client.js';
import { createCalendarSource } from './calendar.js';
import { createFactorySource } from './factory.js';
import { createMailSource } from './mail.js';
import { createNewsSource } from './news.js';
import { createTodosSource } from './todos.js';
import { createTravelSource } from './travel.js';
import { createWeatherSource } from './weather.js';

type VaultClient = ReturnType<typeof createGitHubVaultClient>;

export interface SourceDependencies {
  googleApiClient?: GoogleApiClient;
  vaultClient?: VaultClient;
  taskStore?: TaskStore;
  settingsStore?: SettingsStore;
}

const xSource: ProactiveSource = {
  id: 'x',
  label: 'X',
  async read({ now }) {
    return { source: 'x', state: 'unavailable', reason: 'no_provider', facts: [], observedAt: now.toISOString() };
  },
};

export function buildSourceRegistry(dependencies: SourceDependencies): ProactiveSource[] {
  const sources: ProactiveSource[] = [
    createCalendarSource(dependencies.googleApiClient),
    createFactorySource(dependencies.taskStore),
    createMailSource(dependencies.googleApiClient),
    createNewsSource(),
    createTodosSource(dependencies.vaultClient),
    createTravelSource(dependencies.googleApiClient),
    createWeatherSource(dependencies.settingsStore),
  ];
  sources.push(xSource);
  return sources;
}

export function sourceLabelsById(sources: readonly ProactiveSource[]): Partial<Record<SourceId, string>> {
  return Object.fromEntries(sources.map(({ id, label }) => [id, label]));
}
