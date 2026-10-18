import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));

describe('Health upload remains default-off in deployment', () => {
  it('does not set the runtime switch in infrastructure or deployment workflows', () => {
    for (const path of ['infra/main.bicep', '.github/workflows/deploy.yml']) {
      expect(readFileSync(`${root}/${path}`, 'utf8')).not.toContain('JARVIS_HEALTH_UPLOAD_ENABLED');
    }
  });
});
