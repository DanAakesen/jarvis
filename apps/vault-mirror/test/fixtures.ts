import { contentHash, normalizeContent, planReconcile, validatePolicy } from '../src/engine/index.js';
import type { Action, BaseRecord, FileRecord, ReconcileInput, Side } from '../src/engine/types.js';

export const policyData = {
  allowedRoots: ['Notes'],
  allowedExtensions: ['.md'],
  excludedPrefixes: ['Notes/Archive/'],
  excludedNames: ['private.md'],
  excludedNamePattern: '^restricted',
  secretPatterns: ['synthetic-sensitive'],
  maxNoteBytes: 4096,
};
export const now = 100_000_000;
export const note = 'Notes/Café.md';
export const sensitiveText = 'SYNTHETIC-SENSITIVE: not a real credential';
export const record = (text: string, mode = '100644'): FileRecord => ({
  hash: contentHash(text), size: new TextEncoder().encode(text).byteLength, mode,
});
export type Texts = Record<Side, Map<string, string>>;

export function fixture(ours?: string, theirs?: string, base?: string): { input: ReconcileInput; texts: Texts } {
  const validated = validatePolicy(policyData);
  if (!validated.success) throw new Error('fixture-policy-invalid');
  const texts: Texts = { O: new Map(), G: new Map(), B: new Map() };
  const maps = { O: new Map<string, BaseRecord>(), G: new Map<string, BaseRecord>(), B: new Map<string, BaseRecord>() };
  // A stable base lets individual deletion rows stay below the ratio guards.
  for (let i = 0; i < 40; i++) {
    const path = `Notes/stable-${i}.md`;
    for (const side of ['O', 'G', 'B'] as const) {
      texts[side].set(path, 'unchanged');
      maps[side].set(path, record('unchanged'));
    }
  }
  for (const [side, text] of [['O', ours], ['G', theirs], ['B', base]] as const) {
    if (text !== undefined) { texts[side].set(note, text); maps[side].set(note, record(text)); }
  }
  return {
    texts,
    input: {
      policy: validated.policy, writeBack: 'on', limits: { maxChanged: 25, maxDeletes: 3 },
      now, baseFreshlyInitialized: false, ...maps,
      readContent: (side, path) => {
        const text = texts[side].get(path);
        if (text === undefined) throw new Error('fixture-missing-content');
        return text;
      },
      merge: () => ({ clean: false }),
    },
  };
}

export function apply(input: ReconcileInput, texts: Texts, actions: readonly Action[]): ReconcileInput {
  const maps = { O: new Map(input.O), G: new Map(input.G), B: new Map(input.B) };
  for (const action of actions) {
    if (action.kind === 'forgetBase') { maps.B.delete(action.path); texts.B.delete(action.path); }
    else if (action.kind === 'recordBase') { maps.B.set(action.path, action.record); texts.B.set(action.path, action.text); }
    else {
      const side = action.kind.endsWith('OnG') ? 'G' : 'O';
      if (action.kind.startsWith('delete')) { maps[side].delete(action.path); texts[side].delete(action.path); }
      else if ('text' in action) { maps[side].set(action.path, action.record); texts[side].set(action.path, normalizeContent(action.text)); }
    }
  }
  return { ...input, ...maps };
}

export const kinds = (input: ReconcileInput): string[] => planReconcile(input).actions.map(action => action.kind);
