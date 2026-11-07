// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { APP_URL, assetPath, CSP, DEV_URL, isTrustedPage } from './security.js';

describe('local renderer boundary', () => {
  it('trusts only the exact entry page in the selected mode', () => {
    expect(isTrustedPage(APP_URL, false)).toBe(true);
    expect(isTrustedPage(DEV_URL, true)).toBe(true);
    for (const url of [APP_URL + 'assets/a.js', APP_URL + '?spoof=1', 'https://app/', 'file:///tmp/index.html', DEV_URL]) {
      expect(isTrustedPage(url, false)).toBe(false);
    }
    expect(isTrustedPage(APP_URL, true)).toBe(false);
    expect(isTrustedPage('http://127.0.0.1:5183.evil.test/', true)).toBe(false);
  });
  it('serves only the entry page and generated script/style assets', () => {
    expect(assetPath(APP_URL)).toBe('index.html');
    expect(assetPath(APP_URL + 'assets/index-A_b123.js')).toBe('assets/index-A_b123.js');
    expect(assetPath(APP_URL + 'assets/index-A_b123.css')).toBe('assets/index-A_b123.css');
    for (const path of ['../electron/main.js', '%2e%2e/electron/main.js', 'assets/%2e%2e/secret',
      'assets/nested/secret.js', 'assets/a.js?extra=1', 'assets/a.map', 'package.json', '%2fetc%2fpasswd']) {
      expect(assetPath(APP_URL + path)).toBeNull();
    }
    expect(assetPath('jarvis-widget://evil/assets/a.js')).toBeNull();
    expect(assetPath('file:///assets/a.js')).toBeNull();
  });
  it('denies network, frames, forms and dynamic script evaluation in production', () => {
    expect(CSP).toContain("connect-src 'none'");
    expect(CSP).toContain("script-src 'self';");
    expect(CSP).toContain("frame-ancestors 'none'");
    expect(CSP).not.toContain('unsafe-eval');
  });
});
