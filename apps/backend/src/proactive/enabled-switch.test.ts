import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const proactiveSwitch = /\bJARVIS_PROACTIVE_ENABLED\b/gu;
const skippedDirectories = new Set(['node_modules', '.git', 'dist', 'coverage', '__pycache__']);
const searchedDirectories = ['.github', 'infra', 'agents', 'runner', 'pc-bridge', 'scripts', 'apps', 'packages'];
const configurationFile = /\.(?:ya?ml|json|bicep|bicepparam|sh|ps1|toml|mjs|cjs)$|^\.env|^Dockerfile/u;
const generatedFile = /^(?:package-lock\.json|tsconfig(?:\.[\w-]+)?\.json)$/u;

const isConfiguration = (name: string) => configurationFile.test(name) && !generatedFile.test(name);
const read = (file: string) => readFileSync(join(root, file), 'utf8').replace(/\r\n/gu, '\n');

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

describe('Proactive checks are switched on in exactly one reviewed backend setting (P13-14)', () => {
  it('scans the workflow, infrastructure, package and container files that could set a switch', () => {
    expect(scannedFiles()).toEqual(expect.arrayContaining([
      '.github/workflows/deploy.yml', 'infra/main.bicep', 'apps/web/config.json', 'apps/backend/Dockerfile', 'package.json',
    ]));
  });

  it('names the checks switch once, in the Bicep backend settings, and in no other configuration file', () => {
    const mentions: Record<string, string[]> = {};
    for (const file of scannedFiles()) {
      const names = read(file).match(proactiveSwitch);
      if (names) mentions[file] = names;
    }
    // Switching proactive checks off means reverting the whole P13-14 change (it removes the two gate lines and the pin
    // tests together), or setting both values to false AND updating the pin tests in the same commit. Removing only the
    // lines fails here, as does naming the switch in any other file. The alert switch keeps its own pin in
    // alerts-default-off.test.ts. The web half is pinned in apps/web/config/proactive-switch.test.ts.
    expect(mentions).toEqual({ 'infra/main.bicep': ['JARVIS_PROACTIVE_ENABLED'] });
  });

  it('gives the backend container the exact string true', () => {
    const backendApp = read('infra/main.bicep').split(/^resource /mu).find((block) => block.startsWith('backendApp '));
    expect(backendApp, 'infra/main.bicep declares the backendApp resource').toBeDefined();
    expect(backendApp).toMatch(/name: 'JARVIS_PROACTIVE_ENABLED'\s+value: 'true'\s+\}/u);
  });
});
