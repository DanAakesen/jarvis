import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isProactiveEnabled } from './proactive-switch';

const root = resolve(process.cwd(), '../..');

function* policyFiles(directory: string, inWorkflows = false): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist', 'coverage'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* policyFiles(path, inWorkflows || path === join(root, '.github/workflows'));
    } else if (entry.isFile() &&
        (entry.name.startsWith('.env') || inWorkflows && /\.ya?ml$/u.test(entry.name))) {
      yield path;
    }
  }
}

describe('Proactive web switch', () => {
  it('is on only for the exact string true', () => {
    expect(isProactiveEnabled('true')).toBe(true);
    for (const value of [undefined, null, true, 'TRUE', '1', ' true', 'true ']) {
      expect(isProactiveEnabled(value)).toBe(false);
    }
  });

  it('is not enabled by a repository workflow or environment file', () => {
    const files = [...policyFiles(root)];
    expect(files.filter((file) => /\bVITE_PROACTIVE_ENABLED\b/u.test(readFileSync(file, 'utf8')))).toEqual([]);
  });
});
