import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const iosSources = join(import.meta.dirname, '../../../ios/Packages/JarvisCore/Sources');
const healthSources = import.meta.dirname;

function files(directory: string, extension: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return files(path, extension);
    return path.endsWith(extension) && !path.endsWith('.test.ts') ? [path] : [];
  });
}

// The iOS client builds URLs from literal segment arrays such as `path: ["health", "capabilities"]`.
function clientPaths(): string[][] {
  const paths: string[][] = [];
  for (const file of files(iosSources, '.swift')) {
    for (const match of readFileSync(file, 'utf8').matchAll(/path: \[((?:"[a-z-]+"(?:, )?)+)\]/gu)) {
      paths.push([...match[1]!.matchAll(/"([a-z-]+)"/gu)].map(segment => segment[1]!));
    }
  }
  return paths;
}

describe('iOS client and backend agree on health routes', () => {
  const backend = files(healthSources, '.ts').map(file => readFileSync(file, 'utf8')).join('\n');
  const health = clientPaths().filter(path => path[0] === 'health' || path[0] === 'daily');

  it('finds the client health requests', () => {
    expect(health.length).toBeGreaterThan(5);
  });

  it('never requests the retired /daily prefix', () => {
    expect(health.filter(path => path[0] === 'daily')).toEqual([]);
  });

  it.each(health.map(path => ['/' + path.join('/')]))('serves %s', route => {
    expect(backend.includes(`'${route}'`) || backend.includes(`'/api${route}'`)).toBe(true);
  });
});
