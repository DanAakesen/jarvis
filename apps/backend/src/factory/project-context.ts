import { ToolRefusal } from '../core/tool-registry.js';
import type { Project, ProjectStore } from './projects.js';

export const JARVIS_REPOSITORY = process.env.JARVIS_REPOSITORY ?? 'DanAakesen/jarvis';

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

export async function resolveRepository(
  project: string | undefined,
  projectStore: ProjectStore | null,
): Promise<string> {
  if (project === undefined) {
    if (!repositoryPattern.test(JARVIS_REPOSITORY)) throw new Error('JARVIS_REPOSITORY is invalid');
    return JARVIS_REPOSITORY;
  }
  if (!projectStore) throw new Error('Project service unavailable');

  const projects: readonly Project[] = await projectStore.list();
  const match = /^[1-9][0-9]{0,18}$/u.test(project)
    ? projects.find(({ id }) => id === project)
    : repositoryPattern.test(project)
      ? projects.find(({ repo }) => repo.toLowerCase() === project.toLowerCase())
      : undefined;
  if (!match) throw new ToolRefusal('That project is not available.');
  return match.repo;
}
