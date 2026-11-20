import type { MemoryRecord } from '../database/memory-store.js';

const credentialTerms = String.raw`(?:password|passphrase|secret|(?:api|auth|authorization|private)[ -]?key|(?:(?:api|access|auth|authorization|bearer|refresh|session|client|id|oauth)[ -]?token)|credential|seed[ -]?phrase|recovery[ -]?phrase)`;
const credentialPattern = new RegExp(String.raw`\b${credentialTerms}\b`, 'iu');
const tokenFamilyPattern = /(?:api|access|auth|authorization|bearer|refresh|session|client|id|oauth)[ -]?token/iu;
const sensitivePattern = new RegExp(
  String.raw`\b(?:${credentialTerms}|bank(?:ing)?|bank account|credit card|debit card|account number|iban|routing number|swift code|health|medical|diagnosis|medication|symptom|patient|clinic|therapy|prescription|social security|ssn)\b`,
  'iu',
);
const secretValuePattern = new RegExp(
  String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{20,})\b|(?:password|client[_ -]?secret|${credentialTerms})\s*[:=]\s*["']?[^\s"']{8,}`,
  'iu',
);

export function normalizeMemoryPolicyText(value: string): string {
  return value.normalize('NFKC')
    .replace(/([\p{Ll}\p{Nd}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
    .replace(/[._-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function hasCredentialMarker(value: string): boolean {
  const normalized = normalizeMemoryPolicyText(value);
  return credentialPattern.test(normalized) ||
    tokenFamilyPattern.test(normalized) ||
    secretValuePattern.test(value) ||
    secretValuePattern.test(normalized);
}

export function hasSensitiveMarker(value: string): boolean {
  return sensitivePattern.test(normalizeMemoryPolicyText(value));
}

export function memoryContainsCredential(
  record: Pick<MemoryRecord, 'category' | 'key' | 'content' | 'sourceText'>,
): boolean {
  return hasCredentialMarker(
    `${record.category}\n${record.key}\n${record.content}\n${record.sourceText}`,
  );
}
