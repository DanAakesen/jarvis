import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isProactiveEnabled } from './proactive-switch';

const root = resolve(process.cwd(), '../..');
const proactiveSwitch = /\bVITE_PROACTIVE_ENABLED\b/gu;
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

// The echo lines of every `{ ... } >>"$GITHUB_ENV"` group, which is how deploy.yml hands settings to the web build.
function environmentGroups(workflow: string): string[] {
  return [...workflow.matchAll(/^ +\{\n((?: +echo [^\n]*\n)+) +\} >>"\$GITHUB_ENV"$/gmu)].map((match) => match[1]!);
}

describe('Proactive web switch', () => {
  it('is on only for the exact string true', () => {
    expect(isProactiveEnabled('true')).toBe(true);
    for (const value of [undefined, null, true, 'TRUE', '1', ' true', 'true ']) {
      expect(isProactiveEnabled(value)).toBe(false);
    }
  });

  it('scans the workflow, infrastructure, package and container files that could set a switch', () => {
    expect(scannedFiles()).toEqual(expect.arrayContaining([
      '.github/workflows/deploy.yml', 'infra/main.bicep', 'apps/web/config.json', 'apps/backend/Dockerfile', 'package.json',
    ]));
  });

  it('is switched on once, in the production web build settings, and named in no other configuration file (P13-14)', () => {
    const mentions: Record<string, string[]> = {};
    for (const file of scannedFiles()) {
      const names = read(file).match(proactiveSwitch);
      if (names) mentions[file] = names;
    }
    // Switching Proactive off means reverting the whole P13-14 change (it removes the two gate lines and the pin tests
    // together), or setting both values to false AND updating the pin tests in the same commit. Removing only the lines
    // fails here, as does naming the switch in any other file. The backend half is pinned in
    // apps/backend/src/proactive/enabled-switch.test.ts.
    expect(mentions).toEqual({ '.github/workflows/deploy.yml': ['VITE_PROACTIVE_ENABLED'] });
    const web = environmentGroups(read('.github/workflows/deploy.yml'))
      .filter((group) => group.includes('echo "VITE_BACKEND_URL='));
    expect(web, 'deploy.yml has one settings group that carries VITE_BACKEND_URL for the web build').toHaveLength(1);
    expect(web[0]).toMatch(/^ +echo "VITE_PROACTIVE_ENABLED=true"$/mu);
  });
});
