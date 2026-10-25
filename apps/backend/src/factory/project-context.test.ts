import { describe, expect, it, vi } from 'vitest';
import { ToolFailure, ToolRefusal } from '../core/tool-registry.js';
import type { Project, ProjectStore } from './projects.js';
import {
  JARVIS_REPOSITORY,
  projectAwarenessInstructions,
  requiresProjectSelector,
  resolveProject,
  resolveProjectForMessage,
  revalidateProject,
} from './project-context.js';

function registeredProject(overrides: Partial<Project> = {}): Project {
  return {
    id: '31',
    name: 'Greeting Runner',
    description: 'test project for hello-world changes',
    repo: 'synthetic/hello-world',
    default_branch: 'main',
    default_agent: 'codex',
    policy: 'deliver_pr',
    merge_rules: null,
    sandbox_size: '1x2',
    tech: 'node',
    max_parallel_tasks: 1,
    active: true,
    ...overrides,
  };
}

describe('project awareness', () => {
  it('names the Jarvis repository, lists added projects and requires confirmation before adding', () => {
    const text = projectAwarenessInstructions([
      { id: '2', name: 'jarvis', repo: 'DanAakesen/jarvis' },
      { id: '1', name: 'jarvis-test-target', repo: 'DanAakesen/jarvis-test-target' },
    ]);
    expect(JARVIS_REPOSITORY).toBe('DanAakesen/jarvis');
    expect(text).toContain('already added as project "jarvis" (project ID 2)');
    expect(text).toContain('When Dan says "your code"');
    expect(text).toContain('my own code');
    expect(text).toContain('Its code, PRs, issues');
    expect(text).toContain('the Software Factory is how I build and');
    expect(text).toContain('use create_issue');
    expect(text).toContain('I found a bug in my code');
    expect(text).toContain('Jeg fandt en fejl i min kode');
    expect(text).toContain('- jarvis-test-target (DanAakesen/jarvis-test-target, project ID 1)');
    expect(text).toContain('ask him to confirm before adding it');
    expect(text).toContain('do not add it again');
    expect(text).toContain('"Mener du projekt X?"');
    expect(text).toContain('Do not use create_task for code changes.');
  });

  it('does not infer that an empty context proves the registry is empty', () => {
    const text = projectAwarenessInstructions([]);
    expect(text).toContain('which is not listed as an active project in this context');
    expect(text).toContain('No active projects are listed in this context');
    expect(text).toContain('the registry may be unavailable or empty');
  });
});

describe('active project resolution', () => {
  it('requires a selector when a message names a project, except for explicit own-code requests', () => {
    expect(requiresProjectSelector('Add a hello-world file to the test project')).toBe(true);
    expect(requiresProjectSelector('Tilføj en fil til testprojektet')).toBe(true);
    expect(requiresProjectSelector('Improve your code')).toBe(false);
    expect(requiresProjectSelector('Fix the Jarvis repository')).toBe(false);
  });

  it('resolves IDs, full repositories, and normalized display names exactly', async () => {
    const project = registeredProject({ name: '  Greeting   Runner  ' });
    const store = { list: vi.fn(async () => [project]) } as unknown as ProjectStore;

    expect((await resolveProject('31', store)).id).toBe('31');
    expect((await resolveProject('  SYNTHETIC/HELLO-WORLD  ', store)).id).toBe('31');
    expect((await resolveProject(' greeting runner ', store)).id).toBe('31');
    expect(store.list).toHaveBeenCalledTimes(3);
  });

  it('accepts a unique natural reference present in the request without repeating the registered name', async () => {
    const project = registeredProject();
    const store = { list: vi.fn(async () => [project]) } as unknown as ProjectStore;
    const resolved = await resolveProjectForMessage(
      'hello world project', 'Add a file to the hello world project.', store,
    );
    expect(resolved).toMatchObject({ id: project.id, repo: project.repo });
  });

  it('asks before using a weak description-only reference in English or Danish', async () => {
    const project = registeredProject();
    const store = { list: vi.fn(async () => [project]) } as unknown as ProjectStore;

    await expect(resolveProject('the test project', store)).rejects.toThrow('Do you mean project Greeting Runner');
    await expect(resolveProject('testprojektet', store)).rejects.toThrow('Do you mean project Greeting Runner');
    const negated = { list: vi.fn(async () => [
      registeredProject({ description: 'not a test project' }),
    ]) } as unknown as ProjectStore;
    await expect(resolveProject('the test project', negated)).rejects.toThrow("couldn't match");
  });

  it('refuses multiple plausible projects and duplicate normalized display names', async () => {
    const first = registeredProject({ id: '31', name: 'Test fixture' });
    const second = registeredProject({ id: '32', name: 'Greeting fixture', repo: 'synthetic/other', description: 'test project' });
    const store = { list: vi.fn(async () => [first, second]) } as unknown as ProjectStore;

    const ambiguous = await resolveProject('the test project', store).catch((error: unknown) => error);
    expect(ambiguous).toBeInstanceOf(ToolRefusal);
    expect((ambiguous as Error).message).toContain('Greeting fixture — synthetic/other #32');
    expect((ambiguous as Error).message).toContain('Test fixture — synthetic/hello-world #31');

    const duplicateNames = { list: vi.fn(async () => [
      first,
      registeredProject({ id: '32', name: ' test   FIXTURE ', repo: 'synthetic/other' }),
    ]) } as unknown as ProjectStore;
    await expect(resolveProject('Test fixture', duplicateNames)).rejects.toBeInstanceOf(ToolRefusal);
  });

  it('distinguishes an unknown or inactive ID from a registry read failure', async () => {
    const inactive = registeredProject({ active: false });
    const store = { list: vi.fn(async () => [inactive]) } as unknown as ProjectStore;
    const unavailableProject = await resolveProject(inactive.id, store).catch((error: unknown) => error);
    expect(unavailableProject).toBeInstanceOf(ToolRefusal);
    expect((unavailableProject as Error).message).toContain('not in the active project registry');
    expect((unavailableProject as Error).message).not.toMatch(/archived/iu);

    const unavailable = { list: vi.fn(async () => { throw new Error('private database detail'); }) } as unknown as ProjectStore;
    const registryError = await resolveProject('the test project', unavailable).catch((error: unknown) => error);
    expect(registryError).toBeInstanceOf(ToolFailure);
    expect((registryError as Error).message).toContain('couldn’t read the active project registry');
    expect((registryError as Error).message).not.toContain('private database detail');
  });

  it('revalidates the same active project and rejects archive or repository changes', async () => {
    const project = registeredProject();
    const archived = { list: vi.fn(async () => []) } as unknown as ProjectStore;
    await expect(revalidateProject(project.id, project.repo, archived)).rejects.toThrow('no longer active');

    const renamed = { list: vi.fn(async () => [{ ...project, repo: 'synthetic/renamed' }]) } as unknown as ProjectStore;
    await expect(revalidateProject(project.id, project.repo, renamed)).rejects.toThrow('repository changed');
  });
});
