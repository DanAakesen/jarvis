import { contentHash, contentSize, foldPath, normalizeContent, normalizePath } from './normalize.js';
import { isApprovedPath } from './policy.js';
import type { Action, BaseRecord, FileRecord, GuardReason, Plan, ReconcileInput, Side, SkipReason } from './types.js';

export { validatePolicy, isApprovedPath } from './policy.js';
export { contentHash, normalizeContent, normalizePath } from './normalize.js';
export type * from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
type Entry = { sourcePath: string; record: BaseRecord };
type Index = Map<string, Entry>;

/** All dependencies, content and time are supplied; this function performs no I/O. */
export function planReconcile(input: ReconcileInput): Plan {
  const plan: Plan = {
    actions: [], skipped: [], verdict: 'ok',
    counters: {
      approved: 0, pushed: 0, writtenBack: 0, deleted: 0, conflicts: 0,
      skipped: 0, credentialMatches: 0, pendingWriteBack: 0,
      resolvedInObsidianFavor: 0, excluded: 0,
      changedOnG: 0, changedOnO: 0, deletedOnG: 0, deletedOnO: 0,
      skipReasons: {}, guardReasons: {},
    },
  };
  const counts = plan.counters;
  const guard = (reason: GuardReason): void => { counts.guardReasons[reason] = 1; };
  if (!Number.isFinite(input.now) || input.now < 0 ||
    !Number.isInteger(input.limits.maxChanged) || input.limits.maxChanged < 0 || input.limits.maxChanged > 100 ||
    !Number.isInteger(input.limits.maxDeletes) || input.limits.maxDeletes < 0 || input.limits.maxDeletes > 10 ||
    !['on', 'dry-run'].includes(input.writeBack) || typeof input.baseFreshlyInitialized !== 'boolean') {
    guard('invalid-input');
    return { ...plan, verdict: 'guard-tripped', reason: 'guard-tripped' };
  }

  const spellings = new Map<string, Set<string>>();
  const collisions = new Set<string>();
  const index = (files: ReadonlyMap<string, FileRecord>): Index => {
    const result: Index = new Map();
    for (const [sourcePath, record] of files) {
      const path = normalizePath(sourcePath);
      if (!isApprovedPath(input.policy, path)) { counts.excluded++; continue; }
      const folded = foldPath(path);
      const variants = spellings.get(folded) ?? new Set<string>();
      variants.add(path);
      spellings.set(folded, variants);
      if (variants.size > 1 || result.has(path)) collisions.add(folded);
      result.set(path, { sourcePath, record });
    }
    return result;
  };
  const O = index(input.O);
  const G = index(input.G);
  const B = index(input.B);
  const paths = [...new Set([...O.keys(), ...G.keys(), ...B.keys()])].sort();
  counts.approved = new Set([...O.keys(), ...G.keys()]).size;
  if ((O.size === 0 && G.size >= 10) || (G.size === 0 && O.size >= 10)) guard('empty-side');
  if (B.size > 0) {
    const missing = (side: Index): number => [...B.keys()].filter(path => !side.has(path)).length;
    if (missing(O) / B.size > 0.2) guard('missing-base-O');
    if (missing(G) / B.size > 0.2) guard('missing-base-G');
  }

  const skip = (path: string, reason: SkipReason, firstSeen?: number): void => {
    plan.skipped.push({ path, reason, ...(firstSeen === undefined ? {} : { conflictFirstSeenAt: firstSeen }) });
    counts.skipped++;
    counts.skipReasons[reason] = (counts.skipReasons[reason] ?? 0) + 1;
    if (reason === 'secret-match') counts.credentialMatches++;
    if (reason === 'conflict') counts.conflicts++;
  };
  const read = (side: Side, entry: Entry): string => {
    const text = input.readContent(side, entry.sourcePath);
    if (typeof text !== 'string' || contentSize(text) !== entry.record.size ||
      contentHash(text) !== entry.record.hash) throw new Error('content-mismatch');
    return normalizeContent(text);
  };
  const recordFor = (text: string): FileRecord => ({
    hash: contentHash(text), size: contentSize(text), mode: '100644',
  });
  const writeBackEnabled = input.writeBack === 'on' && !input.baseFreshlyInitialized;
  const candidates: Action[] = [];

  for (const path of paths) {
    if (collisions.has(foldPath(path))) { skip(path, 'path-collision'); continue; }
    const o = O.get(path);
    const g = G.get(path);
    const b = B.get(path);
    const records = [o, g, b].filter((entry): entry is Entry => entry !== undefined);
    if (records.some(({ record }) => !/^[a-f0-9]{64}$/.test(record.hash) ||
      !Number.isSafeInteger(record.size) || record.size < 0)) {
      skip(path, 'invalid-record'); continue;
    }
    if (records.some(({ record }) => record.mode !== '100644')) { skip(path, 'non-regular'); continue; }
    if (records.some(({ record }) => record.size > input.policy.maxNoteBytes)) { skip(path, 'oversized'); continue; }
    const equal = (left: Entry | undefined, right: Entry | undefined): boolean =>
      left !== undefined && right !== undefined && left.record.hash === right.record.hash;
    const firstSeen = input.conflictFirstSeenAt?.get(path) ?? b?.record.conflictFirstSeenAt ?? input.now;
    if (!Number.isFinite(firstSeen) || firstSeen < 0 || firstSeen > input.now) {
      skip(path, 'invalid-record'); continue;
    }
    const pathActions: Action[] = [];
    let resolved = false;
    try {
      const propagate = (text: string, sides: readonly ('O' | 'G')[]): void => {
        const normalized = normalizeContent(text);
        if (contentSize(normalized) > input.policy.maxNoteBytes) throw new Error('oversized');
        if (input.policy.secretPatterns.some(pattern => pattern.test(normalized))) throw new Error('secret-match');
        const record = recordFor(normalized);
        for (const side of sides) {
          const present = side === 'O' ? o : g;
          pathActions.push({ kind: present ? `updateOn${side}` : `createOn${side}`, path, text: normalized, record });
        }
        pathActions.push({ kind: 'recordBase', path, record, text: normalized });
      };
      const conflict = (): void => {
        if (o && input.now - firstSeen >= DAY_MS) {
          propagate(read('O', o), ['G']);
          resolved = true;
        } else {
          skip(path, 'conflict', firstSeen);
        }
      };
      if (!o && !g) {
        if (b) pathActions.push({ kind: 'forgetBase', path });
      } else if (equal(o, g)) {
        if (!equal(o, b) || b?.record.conflictFirstSeenAt !== undefined ||
          input.conflictFirstSeenAt?.has(path)) propagate(read('O', o!), []);
      } else if (o && !g) {
        if (equal(o, b)) pathActions.push({ kind: 'deleteOnO', path }, { kind: 'forgetBase', path });
        else propagate(read('O', o), ['G']);
      } else if (!o && g) {
        if (equal(g, b)) pathActions.push({ kind: 'deleteOnG', path }, { kind: 'forgetBase', path });
        else propagate(read('G', g), ['O']);
      } else if (!b) {
        conflict();
      } else if (equal(o, b)) {
        propagate(read('G', g!), ['O']);
      } else if (equal(g, b)) {
        propagate(read('O', o!), ['G']);
      } else {
        const merged = input.merge(read('B', b), read('O', o!), read('G', g!));
        if (merged.clean) {
          if (typeof merged.text !== 'string') throw new Error('content-mismatch');
          propagate(merged.text, ['G', 'O']);
        } else conflict();
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      skip(path, reason === 'secret-match' || reason === 'oversized' || reason === 'content-mismatch'
        ? reason : 'content-unavailable');
      continue;
    }
    if (resolved) counts.resolvedInObsidianFavor++;
    candidates.push(...pathActions);
  }

  for (const action of candidates) {
    if (action.kind.endsWith('OnG')) counts.changedOnG++;
    if (action.kind.endsWith('OnO')) counts.changedOnO++;
    if (action.kind === 'deleteOnG') counts.deletedOnG++;
    if (action.kind === 'deleteOnO') counts.deletedOnO++;
  }
  if (counts.changedOnG > input.limits.maxChanged) guard('max-changed-G');
  if (counts.changedOnO > input.limits.maxChanged) guard('max-changed-O');
  if (counts.deletedOnG > input.limits.maxDeletes) guard('max-deletes-G');
  if (counts.deletedOnO > input.limits.maxDeletes) guard('max-deletes-O');
  const deletions = new Set(candidates.filter(action =>
    action.kind === 'deleteOnG' || action.kind === 'deleteOnO').map(action => action.path)).size;
  if (B.size > 0 && deletions / B.size > 0.1) guard('base-deletion-ratio');
  const tripped = Object.keys(counts.guardReasons).length > 0;
  counts.pendingWriteBack = !writeBackEnabled || tripped ? counts.changedOnO : 0;
  if (tripped) {
    plan.verdict = 'guard-tripped';
    plan.reason = 'guard-tripped';
    return plan;
  }
  const pendingPaths = new Set(candidates.filter(action => action.kind.endsWith('OnO')).map(action => action.path));
  plan.actions = candidates.filter(action => writeBackEnabled || (
    !action.kind.endsWith('OnO') &&
    !((action.kind === 'recordBase' || action.kind === 'forgetBase') && pendingPaths.has(action.path))
  ));
  for (const action of plan.actions) {
    if (action.kind === 'createOnG' || action.kind === 'updateOnG') counts.pushed++;
    if (action.kind === 'createOnO' || action.kind === 'updateOnO') counts.writtenBack++;
    if (action.kind === 'deleteOnG' || action.kind === 'deleteOnO') counts.deleted++;
  }
  if (counts.skipped > 0) {
    plan.verdict = 'needs-attention';
    if (counts.credentialMatches > 0) plan.reason = 'secret-match';
    else if (counts.conflicts > 0) plan.reason = 'conflict';
  }
  return plan;
}
