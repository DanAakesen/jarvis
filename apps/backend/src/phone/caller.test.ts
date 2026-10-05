import { describe, expect, it } from 'vitest';
import { parsePhoneAllowlist, trustedPhoneCaller } from './caller.js';

const ownerObjectId = '12bcfab7-49ba-4cf7-8be7-780a13911f93';

describe('phone caller verification', () => {
  it('accepts only a bounded JSON allow-list of E.164 numbers', () => {
    expect([...parsePhoneAllowlist('{"phoneNumbers":["+4512345678"]}').phoneNumbers])
      .toEqual(['+4512345678']);
    for (const value of [
      '',
      '[]',
      '{"phoneNumbers":[]}',
      '{"phoneNumbers":["4512345678"]}',
      '{"phoneNumbers":["+4512345678"],"owner":"Dan"}',
      '{"phoneNumbers":["+4512345678\n"]}',
    ]) {
      expect(() => parsePhoneAllowlist(value)).toThrow();
    }
  });

  it('accepts Dan by Teams Entra object ID or an exact allow-listed E.164 number', () => {
    const allowlist = parsePhoneAllowlist('{"phoneNumbers":["+4512345678"]}');
    expect(trustedPhoneCaller(
      { microsoftTeamsUser: { userId: ownerObjectId, isAnonymous: false } },
      ownerObjectId,
      allowlist,
    )).toEqual({ kind: 'entra', id: ownerObjectId });
    expect(trustedPhoneCaller(
      { phoneNumber: { value: '+4512345678' } },
      ownerObjectId,
      allowlist,
    )).toEqual({ kind: 'phone', id: '+4512345678' });
  });

  it('fails closed for unknown, anonymous, malformed, and raw-ID-only callers', () => {
    const allowlist = parsePhoneAllowlist('{"phoneNumbers":["+4512345678"]}');
    for (const caller of [
      { microsoftTeamsUser: { userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } },
      { microsoftTeamsUser: { userId: ownerObjectId, isAnonymous: true } },
      { phoneNumber: { value: '+4599999999' } },
      { rawId: `4:+4512345678` },
      null,
    ]) {
      expect(trustedPhoneCaller(caller, ownerObjectId, allowlist)).toBeUndefined();
    }
  });
});
