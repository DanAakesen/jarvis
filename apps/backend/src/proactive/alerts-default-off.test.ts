import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const switchName = /\bJARVIS_PROACTIVE_ALERTS_ENABLED\b/u;
const skippedDirectories = new Set(['node_modules', '.git', 'dist', 'coverage', '__pycache__', 'agents']);
const searchedDirectories = ['.github', 'infra', 'scripts', 'apps', 'packages'];
const configurationFile = /\.(?:ya?ml|json|bicep|bicepparam|sh|ps1|toml|mjs|cjs)$|^\.env|^Dockerfile/u;
const generatedFile = /^(?:package-lock\.json|tsconfig(?:\.[\w-]+)?\.json)$/u;

function* configurationFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) yield* configurationFiles(path);
    } else if (entry.isFile() && configurationFile.test(entry.name) && !generatedFile.test(entry.name)) {
      yield path;
    }
  }
}

function scannedFiles(): string[] {
  const rootFiles = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && configurationFile.test(entry.name) && !generatedFile.test(entry.name))
    .map((entry) => join(root, entry.name));
  const nested = searchedDirectories
    .filter((name) => existsSync(join(root, name)))
    .flatMap((name) => [...configurationFiles(join(root, name))]);
  return [...rootFiles, ...nested].map((path) => relative(root, path).split(sep).join('/')).sort();
}

describe('proactive alerts remain dark until their reviewed enabling change', () => {
  it('scans workflows, infrastructure, environment and build configuration', () => {
    expect(scannedFiles()).toEqual(expect.arrayContaining([
      '.github/workflows/deploy.yml', 'infra/main.bicep', 'apps/backend/Dockerfile', 'package.json',
    ]));
  });

  it('does not set the alert switch in workflow, infrastructure or environment configuration', () => {
    const mentions = scannedFiles().filter((file) => switchName.test(readFileSync(join(root, file), 'utf8')));
    expect(mentions).toEqual([]);
  });
});
