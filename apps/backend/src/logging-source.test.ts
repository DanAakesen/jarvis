import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { isRegisteredLogEvent } from './logging.js';

function findUnregisteredMessages(text: string): string[] {
  const source = ts.createSourceFile('source.ts', text, ts.ScriptTarget.Latest, true);
  const messages: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ['warn', 'error', 'info'].includes(node.expression.name.text)) {
      const first = node.arguments[0];
      const message = first && ts.isStringLiteral(first) ? first : node.arguments[1];
      if (message && ts.isStringLiteral(message) && !isRegisteredLogEvent(message.text)) messages.push(message.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return messages;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

describe('registered logging events', () => {
  it('detects a deliberately unregistered literal message', () => {
    expect(findUnregisteredMessages("request.log.warn('deliberately.unregistered');"))
      .toEqual(['deliberately.unregistered']);
  });

  it('registers every literal message passed to backend info, warn, and error calls', () => {
    const directory = fileURLToPath(new URL('.', import.meta.url));
    const unknown = sourceFiles(directory).flatMap((path) =>
      findUnregisteredMessages(readFileSync(path, 'utf8')).map((message) => `${path}: ${message}`));
    expect(unknown).toEqual([]);
  });
});
