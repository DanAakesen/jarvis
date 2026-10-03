import { describe, expect, it } from 'vitest';
import { createPublicConfig } from './public-config';

const applicationId = '11111111-1111-4111-8111-111111111111';
const bootstrap = {
  tenantId: applicationId,
  web: { appId: applicationId },
  api: { appId: applicationId, scope: `api://${applicationId}/access_as_user` },
  deploy: { appId: 'do-not-bundle' },
  ownerObjectId: 'do-not-bundle',
};

describe('public configuration boundary', () => {
  it('includes only browser configuration and normalizes the backend origin', () => {
    expect(createPublicConfig(bootstrap, 'https://api.example.com/')).toEqual({
      tenantId: applicationId, webClientId: applicationId,
      apiScope: `api://${applicationId}/access_as_user`, backendUrl: 'https://api.example.com',
    });
  });

  it.each([null, undefined, ''])('allows a pending first deployment (%s)', (backendUrl) => {
    expect(createPublicConfig(bootstrap, backendUrl).backendUrl).toBeNull();
  });

  it.each(['bad-url', 'http://api.example.com', 'https://user:password@api.example.com',
    'https://api.example.com/path', 'https://api.example.com/?token=private',
    'https://api.example.com/#fragment', 'https://localhost', 'https://127.0.0.1', 123])(
    'rejects invalid production configuration (%s)', (url) => {
      expect(() => createPublicConfig(bootstrap, url)).toThrow('production HTTPS origin');
    },
  );

  it('rejects missing identity and incorrect API scope', () => {
    expect(() => createPublicConfig({ ...bootstrap, tenantId: '' }, null)).toThrow('tenant ID');
    expect(() => createPublicConfig({ ...bootstrap, api: { appId: applicationId, scope: 'wrong' } }, null)).toThrow('API scope');
  });
});
