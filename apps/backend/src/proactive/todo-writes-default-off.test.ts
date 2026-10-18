import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const skippedDirectories = new Set(['.git', 'node_modules', 'dist', 'coverage', '.venv']);

function* deploymentFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) yield* deploymentFiles(path);
    } else if (entry.isFile()) {
      const relativePath = relative(root, path).split(sep).join('/');
      if (relativePath.startsWith('.github/') || relativePath.startsWith('infra/') ||
          /\.(?:bicep|bicepparam)$/iu.test(entry.name) || /^\.env(?:\.|$)/u.test(entry.name)) {
        yield path;
      }
    }
  }
}

describe('proactive todo writes remain default-off', () => {
  it('does not set or mention the writer flag in workflows, Bicep, infrastructure, or environment files', () => {
    const flag = 'JARVIS_PROACTIVE_TODO_WRITES_ENABLED';
    const files = [
      ...deploymentFiles(root),
      ...['.env', '.env.local', '.env.production'].filter((name) => existsSync(join(root, name))).map((name) => join(root, name)),
    ];
    expect(files.some((file) => readFileSync(file, 'utf8').includes(flag))).toBe(false);
  });
});
