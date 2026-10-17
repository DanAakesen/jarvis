import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const switchName = /\b(?:JARVIS|VITE)_DAILY_ENABLED\b/u;
// Turning Daily on is its own reviewed change; it lists exactly the deployment files it edits here.
const filesAllowedToSetTheSwitches: readonly string[] = [];
const skippedDirectories = new Set(['node_modules', '.git', 'dist', 'coverage', '__pycache__']);
const searchedDirectories = ['.github', 'infra', 'agents', 'runner', 'pc-bridge', 'scripts', 'apps', 'packages'];
const configurationFile = /\.(?:ya?ml|json|bicep|bicepparam|sh|ps1|toml|mjs|cjs)$|^\.env|^Dockerfile/u;
const generatedFile = /^(?:package-lock\.json|tsconfig(?:\.[\w-]+)?\.json)$/u;

const isConfiguration = (name: string) => configurationFile.test(name) && !generatedFile.test(name);

function* configurationFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) yield* configurationFiles(path);
    } else if (entry.isFile() && isConfiguration(entry.name)) {
      yield path;
    }
  }
}

function scannedFiles(): string[] {
  const rootFiles = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isConfiguration(entry.name))
    .map((entry) => join(root, entry.name));
  const nested = searchedDirectories
    .filter((name) => existsSync(join(root, name)))
    .flatMap((name) => [...configurationFiles(join(root, name))]);
  return [...rootFiles, ...nested].map((path) => relative(root, path).split(sep).join('/')).sort();
}

describe('Daily stays off in every shipped configuration', () => {
  it('scans the workflow, infrastructure, package and container files that could set a switch', () => {
    expect(scannedFiles()).toEqual(expect.arrayContaining([
      '.github/workflows/deploy.yml', 'infra/main.bicep', 'apps/web/config.json', 'apps/backend/Dockerfile', 'package.json',
    ]));
  });

  it('sets neither JARVIS_DAILY_ENABLED nor VITE_DAILY_ENABLED in any file that is not reviewed to', () => {
    const setting = scannedFiles().filter((file) => switchName.test(readFileSync(join(root, file), 'utf8')));
    expect(setting).toEqual([...filesAllowedToSetTheSwitches].sort());
  });
});
