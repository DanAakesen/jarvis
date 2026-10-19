import { describe, expect, it } from 'vitest';
import { contentHash, planReconcile } from '../src/engine/index.js';
import { fixture, kinds, note, now, record, sensitiveText } from './fixtures.js';

describe('decision table', () => {
  it.each([
    ['O equals G: record base', 'same', 'same', undefined, ['recordBase']],
    ['O equals G and base: no redundant state write', 'same', 'same', 'same', []],
    ['both absent: forget base', undefined, undefined, 'base', ['forgetBase']],
    ['both absent without base: no action', undefined, undefined, undefined, []],
    ['O present, G absent, no base: create on G', 'ours', undefined, undefined, ['createOnG', 'recordBase']],
    ['G deleted unchanged O: delete on O', 'base', undefined, 'base', ['deleteOnO', 'forgetBase']],
    ['O edited after G deletion: recreate on G', 'ours', undefined, 'base', ['createOnG', 'recordBase']],
    ['G present, O absent, no base: create on O', undefined, 'theirs', undefined, ['createOnO', 'recordBase']],
    ['O deleted unchanged G: delete on G', undefined, 'base', 'base', ['deleteOnG', 'forgetBase']],
    ['G edited after O deletion: recreate on O', undefined, 'theirs', 'base', ['createOnO', 'recordBase']],
    ['both present different, no base: conflict', 'ours', 'theirs', undefined, []],
    ['only G changed: write back G', 'base', 'theirs', 'base', ['updateOnO', 'recordBase']],
    ['only O changed: push O', 'ours', 'base', 'base', ['updateOnG', 'recordBase']],
    ['both changed: conflicting merge skips', 'ours', 'theirs', 'base', []],
  ] as const)('%s', (_row, ours, theirs, base, expected) => {
    expect(kinds(fixture(ours, theirs, base).input)).toEqual(expected);
  });
  it('both changed: clean three-way merge writes identical text to both sides', () => {
    const { input } = fixture('ours', 'theirs', 'base');
    const plan = planReconcile({ ...input, merge: (base, ours, theirs) => {
      expect([base, ours, theirs]).toEqual(['base', 'ours', 'theirs']);
      return { clean: true, text: 'merged\r\n' };
    } });
    expect(plan.actions.map(action => action.kind)).toEqual(['updateOnG', 'updateOnO', 'recordBase']);
    expect(plan.actions.every(action => 'text' in action && action.text === 'merged\n')).toBe(true);
    expect(plan.counters).toMatchObject({ pushed: 1, writtenBack: 1 });
  });
});

describe('conflict policy', () => {
  it('unresolved conflict never modifies Obsidian and returns first-seen time', () => {
    const { input } = fixture('ours', 'theirs', 'base');
    const plan = planReconcile(input);
    expect(plan.actions).toEqual([]);
    expect(plan.skipped).toEqual([{ path: note, reason: 'conflict', conflictFirstSeenAt: now }]);
  });
  it.each([false, true])('24-hour conflict resolves in Obsidian favour (base present: %s)', withBase => {
    const { input } = fixture('ours', 'theirs', withBase ? 'base' : undefined);
    const firstSeen = now - 24 * 60 * 60 * 1000;
    const plan = planReconcile({ ...input, conflictFirstSeenAt: new Map([[note, firstSeen]]) });
    expect(plan.actions.map(action => action.kind)).toEqual(['updateOnG', 'recordBase']);
    expect(plan.counters).toMatchObject({ resolvedInObsidianFavor: 1, conflicts: 0, writtenBack: 0 });
  });
  it('a conflict one millisecond younger than 24 hours still skips', () => {
    const { input } = fixture('ours', 'theirs', 'base');
    const plan = planReconcile({ ...input, conflictFirstSeenAt: new Map([[note, now - 86_400_000 + 1]]) });
    expect(plan.skipped[0]?.reason).toBe('conflict');
  });
  it('uses conflict time stored in base and clears it only after reconciliation', () => {
    const { input } = fixture('ours', 'theirs', 'base');
    const B = new Map(input.B).set(note, { ...record('base'), conflictFirstSeenAt: now - 86_400_000 });
    expect(planReconcile({ ...input, B }).counters.resolvedInObsidianFavor).toBe(1);
  });
  it('rejects future or invalid conflict timestamps', () => {
    const { input } = fixture('ours', 'theirs', 'base');
    for (const time of [NaN, Infinity, -1, now + 1]) {
      expect(planReconcile({ ...input, conflictFirstSeenAt: new Map([[note, time]]) }).skipped[0]?.reason).toBe('invalid-record');
    }
  });
});

describe('normalisation and collisions', () => {
  it('SHA-256 compares UTF-8 CRLF and LF equally without dropping accents', () => {
    expect(contentHash('élève\r\n')).toBe(contentHash('élève\n'));
    expect(contentHash('élève\n')).not.toBe(contentHash('eleve\n'));
    expect(kinds(fixture('élève\r\n', 'élève\n').input)).toEqual(['recordBase']);
  });
  it('NFD on one side and NFC on the other represent the same path', () => {
    const { input, texts } = fixture('same', 'same');
    const nfd = note.normalize('NFD');
    const G = new Map(input.G);
    G.delete(note); G.set(nfd, record('same'));
    texts.G.delete(note); texts.G.set(nfd, 'same');
    const plan = planReconcile({ ...input, G });
    expect(plan.skipped).toEqual([]);
    expect(plan.actions[0]?.path).toBe(note);
  });
  it.each([
    ['case-only paths', 'Notes/CAFÉ.md'],
    ['NFC/NFD collision within a side', note.normalize('NFD')],
  ])('%s are skipped, counted and never merged', (_rule, otherPath) => {
    const { input } = fixture('ours');
    const O = new Map(input.O).set(otherPath, record('another'));
    const plan = planReconcile({ ...input, O, merge: () => { throw new Error('must-not-merge'); } });
    expect(plan.actions).toEqual([]);
    expect(plan.skipped.every(entry => entry.reason === 'path-collision')).toBe(true);
    expect(plan.counters.skipped).toBeGreaterThan(0);
  });
  it('case-only variants across sides are skipped, not treated as a deletion/create', () => {
    const { input } = fixture('ours');
    const G = new Map(input.G).set('Notes/CAFÉ.md', record('theirs'));
    expect(planReconcile({ ...input, G }).counters.skipReasons['path-collision']).toBe(2);
  });
  it('Unicode caseless collisions are conservative (sharp s and SS)', () => {
    const { input } = fixture();
    const O = new Map(input.O).set('Notes/straße.md', record('a')).set('Notes/STRASSE.md', record('b'));
    expect(planReconcile({ ...input, O }).counters.skipReasons['path-collision']).toBe(2);
  });
  it('file/descendant collisions across sides skip both instead of planning impossible writes', () => {
    const { input } = fixture();
    const O = new Map(input.O).set('Notes/parent.md', record('parent'));
    const G = new Map(input.G).set('Notes/parent.md/child.md', record('child'));
    const plan = planReconcile({ ...input, O, G });
    expect(plan.actions).toEqual([]);
    expect(plan.counters.skipReasons['path-collision']).toBe(2);
  });
  it('an excluded ancestor file still blocks writes to its approved descendants', () => {
    const { input } = fixture();
    const O = new Map(input.O).set('Notes/PRIVATE.MD', record('excluded'));
    const G = new Map(input.G).set('Notes/private.md/child.md', record('child'));
    const plan = planReconcile({ ...input, O, G });
    expect(plan.actions).toEqual([]);
    expect(plan.skipped).toEqual([{ path: 'Notes/private.md/child.md', reason: 'path-collision' }]);
  });
});

describe('per-path safety', () => {
  it.each(['100755', '120000', '040000', 'unknown'])('non-regular, executable or symlinked mode %s skips', mode => {
    const { input } = fixture('ours');
    const O = new Map(input.O).set(note, record('ours', mode));
    expect(planReconcile({ ...input, O }).skipped).toEqual([{ path: note, reason: 'non-regular' }]);
  });
  it('oversized entries skip without aborting other eligible paths', () => {
    const { input, texts } = fixture('x'.repeat(4097));
    const path = 'Notes/safe.md';
    texts.O.set(path, 'safe');
    const O = new Map(input.O).set(path, record('safe'));
    const plan = planReconcile({ ...input, O });
    expect(plan.skipped).toEqual([{ path: note, reason: 'oversized' }]);
    expect(plan.counters.pushed).toBe(1);
  });
  it('maxNoteBytes includes UTF-8 bytes, not character count', () => {
    expect(planReconcile(fixture('é'.repeat(2049)).input).skipped[0]?.reason).toBe('oversized');
    expect(planReconcile(fixture('é'.repeat(2048)).input).counters.pushed).toBe(1);
  });
  it.each(['O', 'G'] as const)('secret-match outgoing from %s skips and flags needs-attention without the match', side => {
    const { input } = fixture(side === 'O' ? sensitiveText : undefined, side === 'G' ? sensitiveText : undefined);
    const plan = planReconcile(input);
    expect(plan.actions).toEqual([]);
    expect(plan).toMatchObject({ verdict: 'needs-attention', reason: 'secret-match' });
    expect(plan.counters.credentialMatches).toBe(1);
    expect(JSON.stringify(plan)).not.toContain(sensitiveText);
  });
  it.each([sensitiveText, 'x'.repeat(4097)])('merged outgoing content must pass policy', text => {
    const { input } = fixture('ours', 'theirs', 'base');
    const plan = planReconcile({ ...input, merge: () => ({ clean: true, text }) });
    expect(plan.actions).toEqual([]);
    expect(plan.counters.skipped).toBe(1);
  });
  it('content reader failure is sanitized and never becomes false success', () => {
    const { input } = fixture('ours');
    const plan = planReconcile({ ...input, readContent: () => { throw new Error(sensitiveText); } });
    expect(plan.skipped[0]?.reason).toBe('content-unavailable');
    expect(JSON.stringify(plan)).not.toContain(sensitiveText);
  });
  it('content/hash/size mismatch refuses writes', () => {
    const { input } = fixture('ours');
    expect(planReconcile({ ...input, readContent: () => 'wrong' }).skipped[0]?.reason).toBe('content-mismatch');
  });
  it.each([{ hash: 'invalid', size: 1, mode: '100644' }, { ...record('ours'), size: -1 }])(
    'invalid inventory records skip', invalid => {
      const { input } = fixture('ours');
      expect(planReconcile({ ...input, O: new Map(input.O).set(note, invalid) }).skipped[0]?.reason).toBe('invalid-record');
    },
  );
  it('counters and reason codes carry only numbers and fixed reasons, no paths/content', () => {
    const { input } = fixture(sensitiveText);
    const plan = planReconcile(input);
    const summary = JSON.stringify({ counters: plan.counters, reason: plan.reason, verdict: plan.verdict });
    expect(summary).not.toContain(note);
    expect(summary).not.toContain(sensitiveText);
    expect(Object.values(plan.counters).every(value => typeof value === 'number' ||
      Object.values(value).every(count => Number.isInteger(count)))).toBe(true);
  });
  it('does not mutate input records, maps or policy', () => {
    const { input } = fixture('ours', 'base', 'base');
    const before = JSON.stringify([...input.O, ...input.G, ...input.B]);
    for (const value of [...input.O.values(), ...input.G.values(), ...input.B.values()]) Object.freeze(value);
    expect(planReconcile(input)).toEqual(planReconcile(input));
    expect(JSON.stringify([...input.O, ...input.G, ...input.B])).toBe(before);
  });
});

describe('write-back switch', () => {
  it.each([
    ['create', undefined, 'theirs', undefined],
    ['update', 'base', 'theirs', 'base'],
    ['delete', 'base', undefined, 'base'],
  ] as const)('dry-run suppresses %s OnO and never advances its base', (_row, o, g, b) => {
    const { input } = fixture(o, g, b);
    const plan = planReconcile({ ...input, writeBack: 'dry-run' });
    expect(plan.actions).toEqual([]);
    expect(plan.counters.pendingWriteBack).toBe(1);
  });
  it('dry-run still pushes Obsidian changes to GitHub', () => {
    const { input } = fixture('ours');
    expect(kinds({ ...input, writeBack: 'dry-run' })).toEqual(['createOnG', 'recordBase']);
  });
  it('freshly initialized base suppresses write-back even when mode is on', () => {
    const { input } = fixture(undefined, 'theirs');
    const plan = planReconcile({ ...input, baseFreshlyInitialized: true });
    expect(plan.actions).toEqual([]);
    expect(plan.counters.pendingWriteBack).toBe(1);
  });
  it('dry-run merge preserves G changes but does not prematurely record the base', () => {
    const { input } = fixture('ours', 'theirs', 'base');
    const plan = planReconcile({ ...input, writeBack: 'dry-run', merge: () => ({ clean: true, text: 'merged' }) });
    expect(plan.actions.map(action => action.kind)).toEqual(['updateOnG']);
    expect(plan.counters.pendingWriteBack).toBe(1);
  });
});
