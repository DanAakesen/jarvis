import { createXSource } from './x.js';
import type { ProactiveSource, SourceId } from '../types.js';
import type { GoogleApiClient } from '../../google/api-client.js';
import type { TaskStore } from '../../factory/task-store.js';
import type { SettingsStore } from '../../core/settings.js';
import type { createGitHubVaultClient } from '../../vault/github-client.js';
import { createContextSources, type ContextDependencies } from './context.js';
import { createCalendarSource } from './calendar.js';
import { createFactorySource } from './factory.js';
import { createMailSource } from './mail.js';
import { createNewsSource } from './news.js';
import { createTodosSource } from './todos.js';
import { createTravelSource } from './travel.js';
import { createDailyWeatherStore } from '../../database/pi-daily-weather.js';
import { dailyWeatherSource } from './daily-weather.js';
import { readTripForecast } from './weather.js';
import { createLocationSource } from './location.js';

type VaultClient = ReturnType<typeof createGitHubVaultClient>;

export interface SourceDependencies extends ContextDependencies {
  googleApiClient?: GoogleApiClient;
  vaultClient?: VaultClient;
  taskStore?: TaskStore;
  xSource?: ProactiveSource;
  settingsStore?: SettingsStore;
}

export function buildSourceRegistry(dependencies: SourceDependencies): ProactiveSource[] {
  const calendar = createCalendarSource(dependencies.googleApiClient);
  const sources: ProactiveSource[] = [
    calendar,
    createFactorySource(dependencies.taskStore),
    createMailSource(dependencies.googleApiClient),
    createNewsSource(),
    createTodosSource(dependencies.vaultClient, true),
    createTravelSource(dependencies.googleApiClient),
    dailyWeatherSource(dependencies.pool && dependencies.ownerObjectId
      ? createDailyWeatherStore(dependencies.pool, dependencies.ownerObjectId) : undefined, readTripForecast, calendar),
    createLocationSource(dependencies.settingsStore),
  ];
  sources.push(...createContextSources(dependencies));
  sources.sort((left, right) => left.id.localeCompare(right.id));
  sources.push(dependencies.xSource ?? createXSource());
  return sources;
}

export function sourceLabelsById(sources: readonly ProactiveSource[]): Partial<Record<SourceId, string>> {
  return Object.fromEntries(sources.map(({ id, label }) => [id, label]));
}
