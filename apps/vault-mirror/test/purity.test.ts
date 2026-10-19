import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const engine = fileURLToPath(new URL('../src/engine/', import.meta.url));

function violations(text: string, file = resolve(engine, 'example.ts')): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const errors: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const specifier = ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '';
      if (specifier === 'node:crypto') {
        const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : undefined;
        if (!bindings || !ts.isNamedImports(bindings) ||
          bindings.elements.some(element => (element.propertyName ?? element.name).text !== 'createHash') ||
          (ts.isImportDeclaration(node) && node.importClause?.name)) errors.push('crypto-only-createHash');
      } else if (specifier !== 'zod' &&
        !(specifier.startsWith('./') && resolve(dirname(file), specifier).startsWith(engine))) {
        errors.push('forbidden-import');
      }
    }
    if (ts.isImportEqualsDeclaration(node) ||
      (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)) errors.push('dynamic-import');
    if (ts.isIdentifier(node) && [
      'Date', 'process', 'performance', 'fetch', 'crypto', 'console', 'globalThis',
      'setTimeout', 'setInterval', 'require', 'eval', 'Function',
    ].includes(node.text)) errors.push('ambient-effect');
    if (ts.isPropertyAccessExpression(node) && node.expression.getText(source) === 'Math' && node.name.text === 'random') {
      errors.push('random');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return errors;
}

describe('engine purity boundary', () => {
  it('all engine imports stay in engine or use Zod / SHA-256 only; no ambient I/O, time or random', () => {
    const files = readdirSync(engine, { recursive: true }).filter((path): path is string =>
      typeof path === 'string' && path.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const path = resolve(engine, file);
      expect(violations(readFileSync(path, 'utf8'), path), file.split(sep).join('/')).toEqual([]);
    }
  });
  it.each([
    "import fs from 'node:fs';",
    "import 'fs/promises';",
    "import http from 'node:https';",
    "import { exec } from 'node:child_process';",
    "import process from 'node:process';",
    "import { performance } from 'node:perf_hooks';",
    "import { randomBytes } from 'node:crypto';",
    "import * as crypto from 'node:crypto';",
    "export { read } from '../io.js';",
    "const load = import('node:fs');",
    "const load = require('fs');",
    'const time = Date.now();',
    'const random = Math.random();',
    'globalThis.fetch("https://example.invalid");',
  ])('purity check rejects %s', source => {
    expect(violations(source).length).toBeGreaterThan(0);
  });
});
