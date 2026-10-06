import { describe, expect, it } from 'vitest';
import {
  createHtmlAppDocument,
  validateHtmlAppBridgeMessage,
  type HtmlAppEnvironment,
} from './html-app-bridge';

const environment: HtmlAppEnvironment = {
  theme: 'dark',
  tokens: {
    '--page': '#101820',
    '--surface': '#18232c',
    '--surface-muted': '#25323a',
    '--text': '#f5f7f8',
    '--text-muted': '#c2cbd0',
    '--primary-action': '#52c7c3',
    '--font-body': 'system-ui, sans-serif',
    '--font-heading': 'system-ui, sans-serif',
    '--line-body': '1.55',
    '--radius-control': '10px',
  },
};

describe('HTML app iframe bridge', () => {
  it('creates a sandbox-oriented document with a restrictive CSP and injected theme', () => {
    const document = createHtmlAppDocument('<main>untrusted app</main>', environment, 'channel-1');

    expect(document).toContain("default-src 'none'");
    expect(document).toContain("script-src 'unsafe-inline'");
    expect(document).toContain('img-src data: https:');
    expect(document).toContain("connect-src 'none'");
    expect(document).toContain("base-uri 'none'");
    expect(document).toContain("form-action 'none'");
    expect(document).toContain("frame-src 'none'");
    expect(document).toContain('--jarvis-page:#101820');
    expect(document).toContain('color-scheme:dark');
    expect(document).toContain('<main>untrusted app</main>');
    expect(document).toContain("Object.defineProperty(window,'jarvis'");
  });

  it('accepts only bounded messages from the expected channel', () => {
    expect(validateHtmlAppBridgeMessage(
      { type: 'open_url', channel: 'channel-1', url: 'https://example.com/path' }, 'channel-1',
    )).toEqual({ type: 'open_url', url: 'https://example.com/path' });
    expect(validateHtmlAppBridgeMessage(
      { type: 'ask', channel: 'channel-1', text: 'Please explain this.' }, 'channel-1',
    )).toEqual({ type: 'ask', text: 'Please explain this.' });
    expect(validateHtmlAppBridgeMessage({ type: 'pin', channel: 'channel-1' }, 'channel-1'))
      .toEqual({ type: 'pin' });
    expect(validateHtmlAppBridgeMessage(
      { type: 'resize', channel: 'channel-1', height: 480 }, 'channel-1',
    )).toEqual({ type: 'resize', height: 480 });
    expect(validateHtmlAppBridgeMessage(
      { type: 'ask', channel: 'another-channel', text: 'Hello' }, 'channel-1',
    )).toBeNull();
    expect(validateHtmlAppBridgeMessage(
      { type: 'ask', channel: 'channel-1', text: 'x'.repeat(2_001) }, 'channel-1',
    )).toBeNull();
    expect(validateHtmlAppBridgeMessage(
      { type: 'open_url', channel: 'channel-1', url: 'javascript:alert(1)' }, 'channel-1',
    )).toBeNull();
    expect(validateHtmlAppBridgeMessage(
      { type: 'open_url', channel: 'channel-1', url: 'http://example.com' }, 'channel-1',
    )).toBeNull();
    expect(validateHtmlAppBridgeMessage(
      { type: 'resize', channel: 'channel-1', height: 1_201 }, 'channel-1',
    )).toBeNull();
    expect(validateHtmlAppBridgeMessage(
      { type: 'pin', channel: 'channel-1', extra: true }, 'channel-1',
    )).toBeNull();
    expect(validateHtmlAppBridgeMessage(null, 'channel-1')).toBeNull();
  });
});
