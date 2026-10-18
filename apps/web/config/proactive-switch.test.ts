import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isProactiveEnabled } from './proactive-switch';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('Proactive web switch', () => {
  it('is on only for the exact string true', () => {
    expect(isProactiveEnabled('true')).toBe(true);
    for (const value of [undefined, null, true, 'TRUE', '1', ' true', 'true ']) {
      expect(isProactiveEnabled(value)).toBe(false);
    }
  });

  it('is not enabled by a repository workflow or environment file', () => {
    const files = [
      ...readdirSync(join(root, '.github/workflows')).map((file) => join(root, '.github/workflows', file)),
      ...readdirSync(root).filter((file) => file.startsWith('.env')).map((file) => join(root, file)),
      ...readdirSync(join(root, 'apps/web')).filter((file) => file.startsWith('.env')).map((file) => join(root, 'apps/web', file)),
    ];
    expect(files.filter((file) => /(?:^|\s)(?:export\s+)?VITE_PROACTIVE_ENABLED\s*=\s*true(?:\s|$)/mu.test(readFileSync(file, 'utf8')))).toEqual([]);
  });
});
