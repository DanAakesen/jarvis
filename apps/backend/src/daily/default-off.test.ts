import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const switchName = /\b(?:JARVIS|VITE)_DAILY_ENABLED\b/u;
// Production switches Daily on for the owner in exactly these two files; no other configuration may mention a switch.
const filesAllowedToSetTheSwitches: readonly string[] = ['.github/workflows/deploy.yml', 'infra/main.bicep'];
const skippedDirectories = new Set(['node_modules', '.git', 'dist', 'coverage', '__pycache__']);
const searchedDirectories = ['.github', 'infra', 'agents', 'runner', 'pc-bridge', 'scripts', 'apps', 'packages'];
const configurationFile = /\.(?:ya?ml|json|bicep|bicepparam|sh|ps1|toml|mjs|cjs)$|^\.env|^Dockerfile/u;
const generatedFile = /^(?:package-lock\.json|tsconfig(?:\.[\w-]+)?\.json)$/u;

const isConfiguration = (name: string) => configurationFile.test(name) && !generatedFile.test(name);
const read = (file: string) => readFileSync(join(root, file), 'utf8').replace(/\r\n/gu, '\n');

// The web job runs from its header to the next job header, so a switch set elsewhere in the workflow cannot satisfy the check.
function webJob(workflow: string): string {
  const start = workflow.indexOf('\n  web:\n');
  expect(start).toBeGreaterThan(-1);
  const next = /\n {2}[\w-]+:\n/u.exec(workflow.slice(start + 1));
  return next ? workflow.slice(start, start + 1 + next.index) : workflow.slice(start);
}

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

describe('Daily is switched on only by the two reviewed deployment files', () => {
  it('scans the workflow, infrastructure, package and container files that could set a switch', () => {
    expect(scannedFiles()).toEqual(expect.arrayContaining([
      '.github/workflows/deploy.yml', 'infra/main.bicep', 'apps/web/config.json', 'apps/backend/Dockerfile', 'package.json',
    ]));
  });

  it('mentions JARVIS_DAILY_ENABLED and VITE_DAILY_ENABLED only in the files that are reviewed to set them', () => {
    const mentioning = scannedFiles().filter((file) => switchName.test(read(file)));
    expect(mentioning).toEqual([...filesAllowedToSetTheSwitches].sort());
  });

  // Anything other than the exact string true crashes the backend at start-up or fails the web build.
  it('sets the backend switch once, to the exact string true, and never sets the web switch in Bicep', () => {
    const bicep = read('infra/main.bicep');
    expect(bicep.match(/name: 'JARVIS_DAILY_ENABLED'/gu)).toHaveLength(1);
    expect(bicep.match(/name: 'JARVIS_DAILY_ENABLED'\n\s+value: 'true'\n/gu)).toHaveLength(1);
    expect(bicep).not.toMatch(/name: 'VITE_DAILY_ENABLED'/u);
  });

  it('sets the web switch once, to the exact string true, on the web build step only, and never sets the backend switch in the workflow', () => {
    const workflow = read('.github/workflows/deploy.yml');
    expect(workflow.match(/^\s+VITE_DAILY_ENABLED:/gmu)).toHaveLength(1);
    const buildStep = webJob(workflow).split('\n      - ').find((step) => step.startsWith('name: Build the web app against the production backend'));
    expect(buildStep).toBeDefined();
    expect(buildStep!.match(/^\s+VITE_DAILY_ENABLED: 'true'$/gmu)).toHaveLength(1);
    expect(workflow).not.toMatch(/^\s+JARVIS_DAILY_ENABLED:/mu);
  });
});
