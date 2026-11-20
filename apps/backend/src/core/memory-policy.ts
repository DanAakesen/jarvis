import type { MemoryRecord } from '../database/memory-store.js';

const credentialTerms = String.raw`(?:password|passphrase|passcode|secret|(?:api|auth|authorization|private)[ -]?key|(?:(?:api|access|auth|authentication|authorization|bearer|refresh|session|client|id|oauth|private|public|personal|service|account|device|csrf|xsrf|jwt)[ -]?token)|credential|seed[ -]?phrase|recovery[ -]?phrase|otp|one[ -]?time[ -]?(?:password|passcode|code)|verification[ -]?(?:code|pin)|security[ -]?(?:code|pin)|authentication[ -]?code|two[ -]?factor[ -]?code|2fa[ -]?code|mfa[ -]?code|cvv2?|cvc2?|card[ -]?(?:security[ -]?code|verification[ -]?(?:value|code))|engangskode|bekraeftelseskode|verifikationskode|sikkerhedskode)`;
const credentialPattern = new RegExp(String.raw`\b${credentialTerms}\b`, 'iu');
const tokenFamilyPattern = /(?:api|access|auth|authentication|authorization|bearer|refresh|session|client|id|oauth|private|public|personal|service|account|device|csrf|xsrf|jwt)[ -]?token/iu;
const sensitivePattern = new RegExp(
  String.raw`\b(?:${credentialTerms}|bank(?:ing)?|bank[ -]?accounts?|accounts?|account[ -]?(?:numbers?|balance|details|statement|holder)|credit[ -]?cards?|debit[ -]?cards?|payment[ -]?cards?|card[ -]?(?:numbers?|no)|iban|routing[ -]?number|swift[ -]?code|balance|salary|income|tax[ -]?(?:id|number|return)|passport(?:[ -]?numbers?)?|national[ -]?id|government[ -]?id|driver(?:'s)?[ -]?(?:licen[cs]e)(?:[ -]?numbers?)?|date[ -]?of[ -]?birth|birth[ -]?date|dob|personal[ -]?(?:id|numbers?)|social[ -]?security(?:[ -]?numbers?)?|ssn|cpr(?:[ -]?numbers?)?|personnummer|health(?:care)?|medical|medicine|medications?|diagnos(?:is|es)|symptoms?|patients?|clinics?|therap(?:y|ies)|prescriptions?|sundhed|medicin|diagnose|sygehus|bankkonto|kontonummer|kreditkort|kortnummer|saldo|foedselsdato|fødselsdato)\b`,
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

export function containsSensitiveOwnerData(value: string): boolean {
  return hasSensitiveMarker(value);
}

export function hasCredentialMarkerDeep(value: unknown): boolean {
  if (typeof value === 'string') return hasCredentialMarker(value);
  if (Array.isArray(value)) return value.some(hasCredentialMarkerDeep);
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some(hasCredentialMarkerDeep);
  }
  return false;
}

export function memoryContainsCredential(
  record: Pick<MemoryRecord, 'category' | 'key' | 'content' | 'sourceText'>,
): boolean {
  return hasCredentialMarker(
    `${record.category}\n${record.key}\n${record.content}\n${record.sourceText}`,
  );
}
