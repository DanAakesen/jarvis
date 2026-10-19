import { describe, expect, it } from 'vitest';
import { isApprovedPath, validatePolicy } from '../src/engine/index.js';
import { policyData } from './fixtures.js';

describe('policy validation', () => {
  it.each([undefined, null, '', '{', '{}', {}, [], { ...policyData, unexpected: true }])(
    'missing, unparsable or empty policy fails closed: %j', value => {
      expect(validatePolicy(value)).toEqual({ success: false, reason: 'policy-missing', error: 'invalid-policy' });
    },
  );
  it.each(['allowedRoots', 'allowedExtensions', 'excludedPrefixes', 'excludedNames', 'secretPatterns'] as const)(
    '%s requires an array of nonempty strings', key => {
      for (const value of [undefined, 'not-an-array', [3], [''], ['  ']]) {
        expect(validatePolicy({ ...policyData, [key]: value }).success).toBe(false);
      }
    },
  );
  it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '100'])(
    'maxNoteBytes is a positive safe integer: %j', maxNoteBytes => {
      expect(validatePolicy({ ...policyData, maxNoteBytes }).success).toBe(false);
    },
  );
  it('compiles all patterns with only the i flag', () => {
    const result = validatePolicy(JSON.stringify(policyData));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.policy.excludedNamePattern.flags).toBe('i');
    expect(result.policy.secretPatterns.map(pattern => pattern.flags)).toEqual(['i']);
  });
  it.each([{ excludedNamePattern: '[' }, { secretPatterns: ['['] }])(
    'a failing pattern is a fixed policy-missing error, not a silent skip', patch => {
      expect(validatePolicy({ ...policyData, ...patch })).toEqual({
        success: false, reason: 'policy-missing', error: 'invalid-pattern',
      });
    },
  );
  it('empty allowlists approve no matching files rather than broadening scope', () => {
    const result = validatePolicy({ ...policyData, allowedRoots: [], allowedExtensions: [] });
    expect(result.success && isApprovedPath(result.policy, 'root.md')).toBe(false);
  });
});

describe('path approval rules (every comparison ignores case)', () => {
  const result = validatePolicy(policyData);
  if (!result.success) throw new Error('fixture-invalid');
  const policy = result.policy;
  it.each([
    ['vault root skips allowedRoots', 'Root.MD', true],
    ['nested first segment is in allowedRoots', 'nOtEs/deep/note.Md', true],
    ['unapproved root', 'Other/note.md', false],
    ['hidden segment', 'Notes/.hidden/note.md', false],
    ['hidden root file', '.note.md', false],
    ['agent log segment', 'Notes/_AGENT-LOG/note.md', false],
    ['excluded prefix', 'NOTES/ARCHIVE/note.md', false],
    ['excluded filename', 'Notes/PRIVATE.MD', false],
    ['excluded filename regex', 'Notes/RESTRICTED-note.md', false],
    ['unapproved extension', 'Notes/note.txt', false],
    ['missing extension', 'Notes/note', false],
    ['filename pattern does not test its directory', 'Notes/restricted/note.md', true],
    ['parent traversal', 'Notes/../note.md', false],
    ['current directory segment', 'Notes/./note.md', false],
    ['absolute path', '/Notes/note.md', false],
    ['Windows path', 'Notes\\note.md', false],
    ['drive path', 'C:/Notes/note.md', false],
    ['empty segment', 'Notes//note.md', false],
    ['control character', 'Notes/note\0.md', false],
  ])('%s', (_rule, path, approved) => {
    expect(isApprovedPath(policy, path as string)).toBe(approved);
  });
  it('normalizes NFC policy values and paths', () => {
    const custom = validatePolicy({ ...policyData, allowedRoots: ['Café'] });
    expect(custom.success && isApprovedPath(custom.policy, 'Cafe\u0301/élève.md')).toBe(true);
  });
});
