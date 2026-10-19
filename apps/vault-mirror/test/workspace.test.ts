import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMirrorWorkspace } from '../src/runner/production.js';
import { deleteWorkspaceFile, snapshotWorkspace, writeWorkspaceFile } from '../src/runner/workspace.js';

describe('mirror workspace', () => {
  it('creates private roots and snapshots, writes and deletes regular files', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'mirror-workspace-test-'));
    const root = resolve(parent, 'workspace');
    const workspace = await createMirrorWorkspace(root);
    try {
      expect((await stat(root)).mode & 0o777).toBe(0o700);
      expect((await stat(workspace.workingCopy)).mode & 0o777).toBe(0o700);
      await writeWorkspaceFile(workspace.workingCopy, 'Notes/item.md', 'hello');
      const snapshot = await snapshotWorkspace(workspace.workingCopy);
      expect(snapshot.files.get('Notes/item.md')?.text).toBe('hello');
      expect(snapshot.bytes.get('Notes/item.md')).toEqual(Buffer.from('hello'));
      await deleteWorkspaceFile(workspace.workingCopy, 'Notes/item.md');
      expect((await snapshotWorkspace(workspace.workingCopy)).files.size).toBe(0);
    } finally {
      await workspace.cleanup();
      await rm(parent, { recursive: true, force: true });
    }
  });

  it.each(['../outside.md', 'Notes/CON.md', 'Notes/trailing. ', 'Notes/bad:name.md'])(
    'refuses unsafe workspace path %s', async path => {
      const root = await mkdtemp(join(tmpdir(), 'mirror-workspace-path-'));
      try {
        await expect(writeWorkspaceFile(root, path, 'unsafe')).rejects.toThrow('Unsafe vault path');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it('refuses symbolic links while snapshotting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mirror-workspace-link-'));
    try {
      await writeFile(join(root, 'outside.md'), 'outside');
      await symlink(join(root, 'outside.md'), join(root, 'linked.md'));
      await expect(snapshotWorkspace(root)).rejects.toThrow('Unsafe working-copy entry');
      await expect(readFile(join(root, 'outside.md'), 'utf8')).resolves.toBe('outside');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
