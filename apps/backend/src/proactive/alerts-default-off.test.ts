import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const switchName = /\bJARVIS_PROACTIVE_ALERTS_ENABLED\b/gu;
const skippedDirectories = new Set(['node_modules', '.git', 'dist', 'coverage', '__pycache__', 'agents']);
const searchedDirectories = ['.github', 'infra', 'scripts', 'apps', 'packages'];
const configurationFile = /\.(?:ya?ml|json|bicep|bicepparam|sh|ps1|toml|mjs|cjs)$|^\.env|^Dockerfile/u;
const generatedFile = /^(?:package-lock\.json|tsconfig(?:\.[\w-]+)?\.json)$/u;

const read = (file: string) => readFileSync(join(root, file), 'utf8').replace(/\r\n/gu, '\n');

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

describe('proactive alerts and reminders are switched on in exactly one reviewed backend setting (P13-15)', () => {
  it('scans workflows, infrastructure, environment and build configuration', () => {
    expect(scannedFiles()).toEqual(expect.arrayContaining([
      '.github/workflows/deploy.yml', 'infra/main.bicep', 'apps/backend/Dockerfile', 'package.json',
    ]));
  });

  it('names the alert switch once, in the Bicep backend settings, and in no other configuration file', () => {
    const mentions: Record<string, string[]> = {};
    for (const file of scannedFiles()) {
      const names = read(file).match(switchName);
      if (names) mentions[file] = names;
    }
    // Alerts and reminders share this one switch. Switching them off means reverting the whole P13-15 change (it
    // removes the gate lines and the pin test updates together), or setting the value to false AND updating this pin in
    // the same commit. Removing only the line fails here, as does naming the switch in any other file. The checks
    // switch (enabled-switch.test.ts) and the todo-writes switch (todo-writes-default-off.test.ts) keep their own pins.
    expect(mentions).toEqual({ 'infra/main.bicep': ['JARVIS_PROACTIVE_ALERTS_ENABLED'] });
  });

  it('gives the backend container the exact string true', () => {
    const backendApp = read('infra/main.bicep').split(/^resource /mu).find((block) => block.startsWith('backendApp '));
    expect(backendApp, 'infra/main.bicep declares the backendApp resource').toBeDefined();
    expect(backendApp).toMatch(/name: 'JARVIS_PROACTIVE_ALERTS_ENABLED'\s+value: 'true'\s+\}/u);
  });
});
