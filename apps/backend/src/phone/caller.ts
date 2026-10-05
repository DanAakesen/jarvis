export interface PhoneAllowlist {
  readonly entraObjectIds: ReadonlySet<string>;
}

export type TrustedPhoneCaller = { readonly kind: 'entra'; readonly id: string };

const uuidPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function teamsUserObjectId(value: unknown): string | undefined {
  const identifier = record(value);
  if (!identifier) return undefined;

  const teamsUser = record(identifier.microsoftTeamsUser);
  if (teamsUser && teamsUser.isAnonymous !== true &&
      typeof teamsUser.userId === 'string' && uuidPattern.test(teamsUser.userId)) {
    return teamsUser.userId.toLowerCase();
  }

  const communicationUser = record(identifier.communicationUser);
  const id = communicationUser?.id;
  const match = typeof id === 'string' ? /^8:orgid:([\da-f-]{36})$/iu.exec(id) : null;
  return match?.[1] && uuidPattern.test(match[1]) ? match[1].toLowerCase() : undefined;
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
  if (!root || Object.keys(root).length !== 1 || !Array.isArray(root.entraObjectIds) ||
      root.entraObjectIds.length > 64) {
    throw new TypeError('Phone allow-list is invalid');
  }
  const ids = new Set<string>();
  for (const id of root.entraObjectIds) {
    if (typeof id !== 'string' || !uuidPattern.test(id)) {
      throw new TypeError('Phone allow-list is invalid');
    }
    ids.add(id.toLowerCase());
  }
  if (ids.size === 0) throw new TypeError('Phone allow-list is empty');
  return { entraObjectIds: ids };
}

export function trustedPhoneCaller(
  value: unknown,
  ownerObjectId: string,
  allowlist: PhoneAllowlist,
): TrustedPhoneCaller | undefined {
  if (!uuidPattern.test(ownerObjectId) || !allowlist.entraObjectIds.has(ownerObjectId.toLowerCase())) {
    return undefined;
  }
  const callerId = teamsUserObjectId(value);
  return callerId === ownerObjectId.toLowerCase()
    ? { kind: 'entra', id: callerId }
    : undefined;
}
