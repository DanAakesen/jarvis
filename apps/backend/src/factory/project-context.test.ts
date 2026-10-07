import { describe, expect, it } from 'vitest';
import { JARVIS_REPOSITORY, projectAwarenessInstructions } from './project-context.js';

describe('project awareness', () => {
  it('names the Jarvis repository, lists added projects and requires confirmation before adding', () => {
    const text = projectAwarenessInstructions([
      { id: '2', name: 'jarvis', repo: 'DanAakesen/jarvis' },
      { id: '1', name: 'jarvis-test-target', repo: 'DanAakesen/jarvis-test-target' },
    ]);
    expect(JARVIS_REPOSITORY).toBe('DanAakesen/jarvis');
    expect(text).toContain('already added as project "jarvis" (project ID 2)');
    expect(text).toContain('- jarvis-test-target (DanAakesen/jarvis-test-target, project ID 1)');
    expect(text).toContain('ask him to confirm before adding it');
    expect(text).toContain('do not add it again');
  });

  it('says when Jarvis itself is not added yet', () => {
    const text = projectAwarenessInstructions([]);
    expect(text).toContain('which is not added as a project yet');
    expect(text).toContain('No projects are added yet.');
  });
});
