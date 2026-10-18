import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const pushSwitch = /\b(?:JARVIS|VITE)_PUSH_ENABLED\b/gu;
const skippedDirectories = new Set(['node_modules', '.git', 'dist', 'coverage', '__pycache__']);
const searchedDirectories = ['.github', 'infra', 'agents', 'runner', 'pc-bridge', 'scripts', 'apps', 'packages'];
const configurationFile = /\.(?:ya?ml|json|bicep|bicepparam|sh|ps1|toml|mjs|cjs)$|^\.env|^Dockerfile/u;
const generatedFile = /^(?:package-lock\.json|tsconfig(?:\.[\w-]+)?\.json)$/u;

const isConfiguration = (name: string) => configurationFile.test(name) && !generatedFile.test(name);
const read = (file: string) => readFileSync(join(root, file), 'utf8');

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

describe('Web Push is switched on in exactly the two reviewed deployment files (P13-03)', () => {
  it('scans the workflow, infrastructure, package and container files that could set a switch', () => {
    expect(scannedFiles()).toEqual(expect.arrayContaining([
      '.github/workflows/deploy.yml', 'infra/main.bicep', 'apps/web/config.json', 'apps/backend/Dockerfile', 'package.json',
    ]));
  });

  it('names each switch once, in the Bicep backend settings and the web build step, and nowhere else', () => {
    const mentions: Record<string, string[]> = {};
    for (const file of scannedFiles()) {
      const names = read(file).match(pushSwitch);
      if (names) mentions[file] = names;
    }
    // Switching push off again is a revert of these two lines; any further place that sets a switch is a reviewed change.
    expect(mentions).toEqual({
      '.github/workflows/deploy.yml': ['VITE_PUSH_ENABLED'],
      'infra/main.bicep': ['JARVIS_PUSH_ENABLED'],
    });
  });

  it('gives the backend container the exact string true and builds the web app with the same gate', () => {
    const backendApp = read('infra/main.bicep').split(/^resource /mu).find((block) => block.startsWith('backendApp '));
    expect(backendApp, 'infra/main.bicep declares the backendApp resource').toBeDefined();
    expect(backendApp).toMatch(/name: 'JARVIS_PUSH_ENABLED'\s+value: 'true'\s+\}/u);
    expect(read('.github/workflows/deploy.yml')).toMatch(/echo "VITE_BACKEND_URL=[^"\n]+"\s+echo "VITE_PUSH_ENABLED=true"/u);
  });
});
