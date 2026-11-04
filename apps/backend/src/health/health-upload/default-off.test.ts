import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config.js';

describe('Health upload remains opt-in in runtime configuration', () => {
  it('defaults off unless the exact true string is configured', () => {
    expect(loadConfig({}).healthUploadEnabled).toBe(false);
    expect(loadConfig({ JARVIS_HEALTH_UPLOAD_ENABLED: 'false' }).healthUploadEnabled).toBe(false);
    expect(() => loadConfig({ JARVIS_HEALTH_UPLOAD_ENABLED: 'TRUE' }))
      .toThrow('JARVIS_HEALTH_UPLOAD_ENABLED must be true or false');
    expect(loadConfig({ JARVIS_HEALTH_UPLOAD_ENABLED: 'true' }).healthUploadEnabled).toBe(true);
  });
});
