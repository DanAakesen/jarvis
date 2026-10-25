import { describe, expect, it } from 'vitest';
import { htmlAppCsp, htmlAppDocument, readHtmlAppMessage } from './html-app-document';

const theme = { scheme: 'dark' as const, tokens: { '--text': '#fff', '--evil': 'red; } body { display: none' } };

describe('html app document', () => {
  it('puts the CSP before anything the app wrote and keeps the doctype first', () => {
    const doc = htmlAppDocument('<!DOCTYPE html><script>steal()</script><html><head><title>R</title></head><body>Hi</body></html>', theme);
    expect(doc.startsWith('<!DOCTYPE html><meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(doc.indexOf(htmlAppCsp)).toBeLessThan(doc.indexOf('steal()'));
    expect(doc).toContain("connect-src 'none'");
    expect(doc).toContain('--jarvis-text: #fff !important;');
    expect(doc).not.toContain('} body {');
    expect(doc).toContain('--jarvis-evil: red  body  display: none !important;');
  });

  it('joins authored document backgrounds to the host without flattening content sections', () => {
    const html = '<!doctype html><html><body style="background:#000"><main><section style="border:1px solid red">Findings</section></main></body></html>';
    const doc = htmlAppDocument(html, { scheme: 'light', tokens: { '--background': '#f0f5f7', '--text': '#17202a' } });
    expect(doc).toContain('--jarvis-background: #f0f5f7 !important;');
    expect(doc).toContain('html, body { background: var(--jarvis-background) !important;');
    expect(doc).toContain('html, body { min-width: 0 !important; max-width: 100% !important; overflow-wrap: anywhere !important; }');
    expect(doc).toContain('img, video, svg, canvas { max-width: 100% !important; height: auto; }');
    expect(doc).toContain('[data-jarvis-document-root] { background: transparent !important; border: 0 !important;');
    expect(doc).toContain('<section style="border:1px solid red">Findings</section>');
    expect(doc).toContain("event.source !== parent");
    expect(doc).toContain("theme.jarvisHostTheme !== 1");
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