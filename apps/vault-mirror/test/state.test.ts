import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileRecord } from '../src/runner/workspace.js';
import { decodeState, emptyState, encodeState, recordForState } from '../src/runner/state.js';

describe('mirror state compatibility', () => {
  it('loads persisted Windows-incompatible names so the runner can skip them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mirror-state-paths-'));
    const source = resolve(root, 'source');
    const sourceConfig = resolve(root, 'source-config');
    const restored = resolve(root, 'restored');
    const restoredConfig = resolve(root, 'restored-config');
    await Promise.all([
      mkdir(source, { recursive: true }),
      mkdir(sourceConfig, { recursive: true }),
    ]);
    const state = emptyState();
    const record = recordForState('legacy note', fileRecord('legacy note'));
    state.base['Notes/CON.md'] = record;
    state.pendingWriteBack['Notes/CON.md'] = { kind: 'write', file: record };
    state.conflictFirstSeenAt['Notes/trailing. '] = 1;

    try {
      const archive = await encodeState(state, source, sourceConfig);
      const decoded = await decodeState(archive, restored, restoredConfig);
      expect(decoded.base['Notes/CON.md']).toEqual(record);
      expect(decoded.pendingWriteBack['Notes/CON.md']).toEqual({ kind: 'write', file: record });
      expect(decoded.conflictFirstSeenAt['Notes/trailing. ']).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
