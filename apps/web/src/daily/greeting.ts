const longestFirstName = 40;

/**
 * The first name in a profile display name: "Dan Example" and "Example, Dan" both read "Dan".
 * A missing, empty, address-like or implausibly long name gives null, so the caller shows a plain headline instead.
 */
export function firstName(name: string | null | undefined): string | null {
  const trimmed = name?.trim() ?? '';
  if (!trimmed || trimmed.includes('@')) return null;
  const comma = trimmed.indexOf(',');
  const given = comma >= 0 ? trimmed.slice(comma + 1) : trimmed;
  const first = given.trim().split(/\s+/u)[0] ?? '';
  return first !== '' && first.length <= longestFirstName ? first : null;
}

export function healthHeadline(name: string | null | undefined): string {
  const first = firstName(name);
  return first === null ? 'Health' : `Hey ${first}`;
}
