export interface PhoneAllowlist {
  readonly phoneNumbers: ReadonlySet<string>;
}

export type TrustedPhoneCaller =
  | { readonly kind: 'entra'; readonly id: string }
  | { readonly kind: 'phone'; readonly id: string };

const e164Pattern = /^\+[1-9]\d{7,14}$/u;
const uuidPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function parsePhoneAllowlist(secret: string): PhoneAllowlist {
  if (secret.length > 4096) throw new TypeError('Phone allow-list is invalid');
  let value: unknown;
  try {
    value = JSON.parse(secret) as unknown;
  } catch {
    throw new TypeError('Phone allow-list is invalid');
  }
  const root = record(value);
  if (!root || Object.keys(root).length !== 1 || !Array.isArray(root.phoneNumbers) ||
      root.phoneNumbers.length > 64) {
    throw new TypeError('Phone allow-list is invalid');
  }
  const numbers = new Set<string>();
  for (const number of root.phoneNumbers) {
    if (typeof number !== 'string' || !e164Pattern.test(number)) {
      throw new TypeError('Phone allow-list is invalid');
    }
    numbers.add(number);
  }
  if (numbers.size === 0) throw new TypeError('Phone allow-list is empty');
  return { phoneNumbers: numbers };
}

export function trustedPhoneCaller(
  value: unknown,
  ownerObjectId: string,
  allowlist: PhoneAllowlist,
): TrustedPhoneCaller | undefined {
  if (!uuidPattern.test(ownerObjectId)) return undefined;
  const identifier = record(value);
  if (!identifier) return undefined;

  const teamsUser = record(identifier.microsoftTeamsUser);
  if (teamsUser && teamsUser.isAnonymous !== true &&
      typeof teamsUser.userId === 'string' && uuidPattern.test(teamsUser.userId) &&
      teamsUser.userId.toLowerCase() === ownerObjectId.toLowerCase()) {
    return { kind: 'entra', id: ownerObjectId.toLowerCase() };
  }

  const phone = record(identifier.phoneNumber);
  if (phone && typeof phone.value === 'string' && e164Pattern.test(phone.value) &&
      allowlist.phoneNumbers.has(phone.value)) {
    return { kind: 'phone', id: phone.value };
  }
  return undefined;
}
