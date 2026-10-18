import type { ProactiveSource, SourceId } from '../types.js';
import type { GoogleApiClient } from '../../google/api-client.js';
import type { TaskStore } from '../../factory/task-store.js';
import type { createGitHubVaultClient } from '../../vault/github-client.js';

type VaultClient = ReturnType<typeof createGitHubVaultClient>;

export interface SourceDependencies {
  googleApiClient?: GoogleApiClient;
  vaultClient?: VaultClient;
  taskStore?: TaskStore;
}

const xSource: ProactiveSource = {
  id: 'x',
  label: 'X',
  async read({ now }) {
    return { source: 'x', state: 'unavailable', reason: 'no_provider', facts: [], observedAt: now.toISOString() };
  },
};

export function buildSourceRegistry(_dependencies: SourceDependencies): ProactiveSource[] {
  void _dependencies;
  const sources: ProactiveSource[] = [];
  sources.push(xSource);
  return sources;
}

export function sourceLabelsById(sources: readonly ProactiveSource[]): Partial<Record<SourceId, string>> {
  return Object.fromEntries(sources.map(({ id, label }) => [id, label]));
}
