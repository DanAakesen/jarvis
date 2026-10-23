import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const flag = /\bJARVIS_OWNER_SESSION_ENABLED\b/gu;
const skip = new Set(['node_modules', '.git', 'dist', 'coverage', '__pycache__', 'agents']);
const configName = /\.(?:ya?ml|json|bicep|bicepparam|sh|ps1|toml|mjs|cjs)$|^\.env|^Dockerfile/u;
const ignored = /^(?:package-lock\.json|tsconfig(?:\.[\w-]+)?\.json)$/u;

function* configurationFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!skip.has(entry.name)) yield* configurationFiles(path);
    } else if (entry.isFile() && configName.test(entry.name) && !ignored.test(entry.name)) {
      yield path;
    }
  }
}

describe('owner sessions are enabled only by the reviewed backend setting', () => {
  it('pins one exact true value in the backend container and nowhere else in configuration', () => {
    const files = [
      ...readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isFile() && configName.test(entry.name) && !ignored.test(entry.name))
        .map(entry => join(root, entry.name)),
      ...['.github', 'infra', 'agents', 'runner', 'pc-bridge', 'scripts', 'apps', 'packages']
        .flatMap(name => [...configurationFiles(join(root, name))]),
    ];
    const references = files
      .map(file => [relative(root, file).split(sep).join('/'), readFileSync(file, 'utf8').match(flag)] as const)
      .filter(([, matches]) => matches);
    expect(references).toEqual([['infra/main.bicep', ['JARVIS_OWNER_SESSION_ENABLED']]]);

    const backendApp = readFileSync(join(root, 'infra/main.bicep'), 'utf8')
      .split(/^resource /mu).find(block => block.startsWith('backendApp '));
    expect(backendApp).toMatch(/name: 'JARVIS_OWNER_SESSION_ENABLED'\s+value: 'true'\s+\}/u);
  });
});
