import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const skippedDirectories = new Set(['.git', 'node_modules', 'dist', 'coverage', '.venv']);
const flag = /\bJARVIS_PROACTIVE_TODO_WRITES_ENABLED\b/gu;

const read = (file: string) => readFileSync(join(root, file), 'utf8').replace(/\r\n/gu, '\n');

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

function scannedFiles(): string[] {
  const environmentFiles = ['.env', '.env.local', '.env.production']
    .filter((name) => existsSync(join(root, name)))
    .map((name) => join(root, name));
  const paths = new Set([...deploymentFiles(root), ...environmentFiles]);
  return [...paths].map((path) => relative(root, path).split(sep).join('/')).sort();
}

describe('proactive todo writes are switched on in exactly one reviewed backend setting (P13-15)', () => {
  it('scans workflows, infrastructure and environment files', () => {
    expect(scannedFiles()).toEqual(expect.arrayContaining(['.github/workflows/deploy.yml', 'infra/main.bicep']));
  });

  it('names the writer switch once, in the Bicep backend settings, and in no other deployment file', () => {
    const mentions: Record<string, string[]> = {};
    for (const file of scannedFiles()) {
      const names = read(file).match(flag);
      if (names) mentions[file] = names;
    }
    // Switching todo writes off means reverting the whole P13-15 change (it removes the gate lines and the pin test
    // updates together), or setting the value to false AND updating this pin in the same commit. Removing only the line
    // fails here, as does naming the switch in any other deployment file. The checks switch (enabled-switch.test.ts)
    // and the alert switch (alerts-default-off.test.ts) keep their own pins.
    expect(mentions).toEqual({ 'infra/main.bicep': ['JARVIS_PROACTIVE_TODO_WRITES_ENABLED'] });
  });

  it('gives the backend container the exact string true', () => {
    const backendApp = read('infra/main.bicep').split(/^resource /mu).find((block) => block.startsWith('backendApp '));
    expect(backendApp, 'infra/main.bicep declares the backendApp resource').toBeDefined();
    expect(backendApp).toMatch(/name: 'JARVIS_PROACTIVE_TODO_WRITES_ENABLED'\s+value: 'true'\s+\}/u);
  });
});
