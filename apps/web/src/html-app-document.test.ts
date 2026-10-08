import { describe, expect, it } from 'vitest';
import { htmlAppCsp, htmlAppDocument, readHtmlAppMessage } from './html-app-document';

const theme = { scheme: 'dark' as const, tokens: { '--text': '#fff', '--evil': 'red; } body { display: none' } };

describe('html app document', () => {
  it('puts the CSP before anything the app wrote and keeps the doctype first', () => {
    const doc = htmlAppDocument('<!DOCTYPE html><script>steal()</script><html><head><title>R</title></head><body>Hi</body></html>', theme);
    expect(doc.startsWith('<!DOCTYPE html><meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(doc.indexOf(htmlAppCsp)).toBeLessThan(doc.indexOf('steal()'));
    expect(doc).toContain("connect-src 'none'");
    expect(doc).toContain('--jarvis-text: #fff;');
    expect(doc).not.toContain('} body {');
    expect(doc).toContain('--jarvis-evil: red  body  display: none;');
  });

  it('accepts only bounded bridge messages', () => {
    expect(readHtmlAppMessage({ jarvisBridge: 1, type: 'open_url', url: 'https://example.com/a' })).toEqual({ type: 'open_url', url: 'https://example.com/a' });
    expect(readHtmlAppMessage({ jarvisBridge: 1, type: 'open_url', url: 'javascript:alert(1)' })).toBeNull();
    expect(readHtmlAppMessage({ jarvisBridge: 1, type: 'open_url', url: 'http://example.com' })).toBeNull();
    expect(readHtmlAppMessage({ jarvisBridge: 1, type: 'ask', text: 'x'.repeat(2_001) })).toBeNull();
    expect(readHtmlAppMessage({ jarvisBridge: 1, type: 'ask', text: '  Why?  ' })).toEqual({ type: 'ask', text: 'Why?' });
    expect(readHtmlAppMessage({ jarvisBridge: 1, type: 'resize', height: 1e9 })).toEqual({ type: 'resize', height: 20_000 });
    expect(readHtmlAppMessage({ jarvisBridge: 1, type: 'navigate', url: 'https://example.com' })).toBeNull();
    expect(readHtmlAppMessage({ type: 'pin' })).toBeNull();
  });
});