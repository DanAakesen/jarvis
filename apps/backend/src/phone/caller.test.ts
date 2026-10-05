import { describe, expect, it } from 'vitest';
import { parsePhoneAllowlist, trustedPhoneCaller } from './caller.js';

const ownerObjectId = '12bcfab7-49ba-4cf7-8be7-780a13911f93';

describe('phone caller verification', () => {
  it('accepts only a bounded JSON allow-list of Entra object IDs', () => {
    expect([...parsePhoneAllowlist(`{"entraObjectIds":["${ownerObjectId}"]}`).entraObjectIds])
      .toEqual([ownerObjectId]);
    for (const value of [
      '',
      '[]',
      '{"entraObjectIds":[]}',
      '{"entraObjectIds":["not-an-id"]}',
      `{"entraObjectIds":["${ownerObjectId}"],"owner":"Dan"}`,
      '{"entraObjectIds":["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\\n"]}',
    ]) {
      expect(() => parsePhoneAllowlist(value)).toThrow();
    }
  });

  it('accepts Dan only by his exact Teams Entra object ID', () => {
    const allowlist = parsePhoneAllowlist(`{"entraObjectIds":["${ownerObjectId}"]}`);
    expect(trustedPhoneCaller(
      { microsoftTeamsUser: { userId: ownerObjectId, isAnonymous: false } },
      ownerObjectId,
      allowlist,
    )).toEqual({ kind: 'entra', id: ownerObjectId });
    expect(trustedPhoneCaller(
      { phoneNumber: { value: '+4512345678' } },
      ownerObjectId,
      allowlist,
    )).toBeUndefined();
  });

  it('fails closed for unknown, anonymous, malformed, and raw-ID-only callers', () => {
    const allowlist = parsePhoneAllowlist(`{"entraObjectIds":["${ownerObjectId}"]}`);
    for (const caller of [
      { microsoftTeamsUser: { userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } },
      { microsoftTeamsUser: { userId: ownerObjectId, isAnonymous: true } },
      { phoneNumber: { value: '+4599999999' } },
      { rawId: `4:+4512345678` },
      null,
    ]) {
      expect(trustedPhoneCaller(caller, ownerObjectId, allowlist)).toBeUndefined();
    }
    expect(trustedPhoneCaller(
      { microsoftTeamsUser: { userId: ownerObjectId } },
      ownerObjectId,
      parsePhoneAllowlist('{"entraObjectIds":["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]}'),
    )).toBeUndefined();
  });
});
