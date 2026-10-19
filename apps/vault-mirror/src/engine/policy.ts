import { z } from 'zod';
import { foldPath, isSafePath, normalizePath } from './normalize.js';

const nonempty = z.string().min(1).refine(value => value.trim().length > 0);
const policySchema = z.strictObject({
  allowedRoots: z.array(nonempty),
  allowedExtensions: z.array(nonempty),
  excludedPrefixes: z.array(nonempty),
  excludedNames: z.array(nonempty),
  excludedNamePattern: z.string(),
  secretPatterns: z.array(nonempty),
  maxNoteBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

export interface ValidatedPolicy {
  readonly allowedRoots: readonly string[];
  readonly allowedExtensions: readonly string[];
  readonly excludedPrefixes: readonly string[];
  readonly excludedNames: readonly string[];
  readonly excludedNamePattern: RegExp;
  readonly secretPatterns: readonly RegExp[];
  readonly maxNoteBytes: number;
}

export type PolicyResult =
  | { success: true; policy: ValidatedPolicy }
  | { success: false; reason: 'policy-missing'; error: 'invalid-policy' | 'invalid-pattern' };

/** Errors deliberately exclude Zod input, policy values and regex source text. */
export function validatePolicy(input: unknown): PolicyResult {
  let value: unknown = input;
  if (typeof input === 'string') {
    try { value = JSON.parse(input); }
    catch { return { success: false, reason: 'policy-missing', error: 'invalid-policy' }; }
  }
  const parsed = policySchema.safeParse(value);
  if (!parsed.success) return { success: false, reason: 'policy-missing', error: 'invalid-policy' };
  const data = parsed.data;
  try {
    return {
      success: true,
      policy: Object.freeze({
        allowedRoots: Object.freeze(data.allowedRoots.map(foldPath)),
        allowedExtensions: Object.freeze(data.allowedExtensions.map(foldPath)),
        excludedPrefixes: Object.freeze(data.excludedPrefixes.map(foldPath)),
        excludedNames: Object.freeze(data.excludedNames.map(foldPath)),
        excludedNamePattern: new RegExp(data.excludedNamePattern, 'i'),
        secretPatterns: Object.freeze(data.secretPatterns.map(pattern => new RegExp(pattern, 'i'))),
        maxNoteBytes: data.maxNoteBytes,
      }),
    };
  } catch {
    return { success: false, reason: 'policy-missing', error: 'invalid-pattern' };
  }
}

export function isApprovedPath(policy: ValidatedPolicy, path: string): boolean {
  const normalized = normalizePath(path);
  if (!isSafePath(normalized)) return false;
  const folded = foldPath(normalized);
  const segments = folded.split('/');
  const name = segments.at(-1)!;
  const extension = name.slice(name.lastIndexOf('.'));
  return !segments.some(segment => segment.startsWith('.') || segment === '_agent-log') &&
    !policy.excludedPrefixes.some(prefix => folded.startsWith(prefix)) &&
    (segments.length === 1 || policy.allowedRoots.includes(segments[0]!)) &&
    name.includes('.') && policy.allowedExtensions.includes(extension) &&
    !policy.excludedNames.includes(name) && !policy.excludedNamePattern.test(normalized.split('/').at(-1)!);
}
