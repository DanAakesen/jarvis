import { describe, expect, it } from 'vitest';
import { workspaceHtmlSizeLimit } from '../database/workspace-html-artifact-store.js';
import { validateHtmlApp } from './html-artifact-validation.js';

const validHtml = '<!doctype html><html><head><title>Example</title></head><body><h1>Example</h1></body></html>';
const sources = [{ title: 'Example', url: 'https://example.com/research' }];

describe('HTML app validation', () => {
  it('accepts valid full HTML documents and bounded HTTPS sources', () => {
    expect(validateHtmlApp('Example', validHtml, sources)).toBe(true);
  });

  it.each([
    '<html><head></head><body>Missing doctype</body></html>',
    '<!doctype html><html><head><base href="https://example.com"></head><body></body></html>',
    '<!doctype html><html><head><script src="/app.js"></script></head><body></body></html>',
    '<!doctype html><html><head><script SRC="https://example.com/app.js"></script></head><body></body></html>',
  ])('rejects invalid HTML or forbidden elements', (html) => {
    expect(validateHtmlApp('Example', html, sources)).toBe(false);
  });

  it('rejects oversized UTF-8, malformed Unicode, and invalid source URLs', () => {
    expect(validateHtmlApp('Example', `${'a'.repeat(workspaceHtmlSizeLimit + 1)}`, sources)).toBe(false);
    expect(validateHtmlApp('Example', `${validHtml}\ud800`, sources)).toBe(false);
    expect(validateHtmlApp('Example', validHtml, [{ title: 'Local', url: 'http://example.com' }])).toBe(false);
    expect(validateHtmlApp('Example', validHtml, Array.from({ length: 51 }, () => sources[0]))).toBe(false);
  });

  it('rejects invalid titles, source fields, and more than 512 KiB of UTF-8', () => {
    expect(validateHtmlApp(' Example ', validHtml, sources)).toBe(false);
    expect(validateHtmlApp('Example', validHtml, [{ ...sources[0]!, extra: true }])).toBe(false);
    expect(validateHtmlApp('Example', `<!doctype html><p>${'界'.repeat(workspaceHtmlSizeLimit / 2)}</p>`, [])).toBe(false);
  });
});
