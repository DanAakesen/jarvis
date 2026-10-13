import { describe,expect,it } from 'vitest';
import { readHealthHostConfig } from './host-config.js';

export const syntheticHostEnvironment = {
  DAILY_HEALTH_UPLOAD_ENABLED: 'true',DAILY_HEALTH_RECOVERY_ENABLED: 'true',DAILY_HEALTH_HOST: '127.0.0.1',
  DAILY_HEALTH_OWNER_OBJECT_ID: '11111111-1111-4111-8111-111111111111',
  DAILY_HEALTH_MANAGED_IDENTITY_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
  DAILY_HEALTH_BLOB_URL: 'https://syntheticaccount.blob.core.windows.net/',DAILY_HEALTH_QUEUE_URL: 'https://syntheticaccount.queue.core.windows.net/',
  DAILY_HEALTH_RAW_CONTAINER: 'synthetic-raw',DAILY_HEALTH_DEVICE_CONTAINER: 'synthetic-devices',DAILY_HEALTH_QUEUE_NAME: 'synthetic-pointers',
};
describe('dedicated health host nonsecret configuration',() => {
  it('defaults to inactive without requiring or inspecting credentials',() => {
    expect(readHealthHostConfig({})).toMatchObject({ enabled: false,recoveryEnabled: false,mode: 'serve',port: 3001,managedIdentityClientId: '' });
    expect(readHealthHostConfig({ DAILY_HEALTH_UPLOAD_ENABLED: 'false',DAILY_HEALTH_BLOB_URL: 'synthetic-secret-marker' }).enabled).toBe(false);
  });
  it.each([
    { DAILY_HEALTH_UPLOAD_ENABLED: 'yes' },{ DAILY_HEALTH_RECOVERY_ENABLED: '1' },{ DAILY_HEALTH_PORT: '3001junk' },
    { DAILY_HEALTH_PORT: '80' },{ DAILY_HEALTH_RECOVERY_PAGE_SIZE: '101' },{ DAILY_HEALTH_RECOVERY_DEADLINE_MS: '20001' },
    { DAILY_HEALTH_SHUTDOWN_MS: '35001' },{ DAILY_HEALTH_HOST: 'untrusted.example' },{ DAILY_HEALTH_MODE: 'process' },
    { DAILY_HEALTH_MANAGED_IDENTITY_CLIENT_ID: '' },{ DAILY_HEALTH_OWNER_OBJECT_ID: 'client-email@example.invalid' },
    { DAILY_HEALTH_BLOB_URL: 'http://127.0.0.1:10000/' },{ DAILY_HEALTH_BLOB_URL: 'https://syntheticaccount.blob.core.windows.net/?secret=synthetic' },
    { DAILY_HEALTH_QUEUE_URL: 'https://differentaccount.queue.core.windows.net/' },{ DAILY_HEALTH_DEVICE_CONTAINER: 'synthetic-raw' },
    { DAILY_HEALTH_RAW_CONTAINER: 'Bad/Container' },{ DAILY_HEALTH_QUEUE_NAME: 'invalid--queue' },{ DAILY_HEALTH_REPLAY_QUEUED: 'true' },
    { DAILY_HEALTH_RATE_PER_CLIENT: '1001' },{ DAILY_HEALTH_RATE_PER_INSTANCE: '1' },{ DAILY_HEALTH_RATE_WINDOW_MS: '999' },
    { DAILY_HEALTH_TRUSTED_PROXY_CIDRS: '0.0.0.0/0' },{ DAILY_HEALTH_TRUSTED_PROXY_CIDRS: '::/0' },{ DAILY_HEALTH_TRUSTED_PROXY_CIDRS: 'proxy.example' },
    { DAILY_HEALTH_TRUSTED_PROXY_CIDRS: '::ffff:0.0.0.0/96' },{ DAILY_HEALTH_TRUSTED_PROXY_CIDRS: 'fe80::1%eth0/128' },
    { DAILY_HEALTH_TRUSTED_PROXY_CIDRS: Array.from({ length: 9 },() => '127.0.0.1/32').join(',') },
  ])('rejects invalid/broad configuration before a host or credential is constructed: %j',value => {
    expect(() => readHealthHostConfig({ ...syntheticHostEnvironment,...value })).toThrow();
  });
  it('requires explicit enablement and recovery for operator mode and restricts replay to that mode',() => {
    expect(() => readHealthHostConfig({ DAILY_HEALTH_MODE: 'recover-once' })).toThrow();
    expect(() => readHealthHostConfig({ DAILY_HEALTH_RECOVERY_ENABLED: 'true' })).toThrow();
    expect(readHealthHostConfig({ ...syntheticHostEnvironment,DAILY_HEALTH_MODE: 'recover-once',DAILY_HEALTH_REPLAY_QUEUED: 'true' })).toMatchObject({ mode: 'recover-once',replayQueued: true });
  });
});
