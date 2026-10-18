import { describe, expect, it } from 'vitest';
import { validateFeedUrl } from './news-url.js';

describe('validateFeedUrl', () => {
  it.each([
    'http://example.com/feed.xml',
    `https://${['user', 'pass'].join(':')}@example.com/feed.xml`,
    'https://example.com:8443/feed.xml',
    'https://localhost/feed.xml',
    'https://updates.local./feed.xml',
    'https://updates.local/feed.xml',
    'https://updates.internal/feed.xml',
    'https://127.0.0.1/feed.xml',
    'https://2130706433/feed.xml',
    'https://0x7f.1/feed.xml',
    'https://127.1/feed.xml',
    'https://[2001:4860:4860::8888]/feed.xml',
    'https://example/feed.xml',
    `https://${'a'.repeat(250)}.example/feed.xml`,
    `https://feeds.example.com/${'a'.repeat(300)}`,
    'https://updates.localdomain/feed.xml',
    'https://updates.lan/feed.xml',
    'https://updates.home/feed.xml',
    'https://updates.corp/feed.xml',
    'https://updates.intranet/feed.xml',
    'https://updates.home.arpa/feed.xml',
  ])('rejects %s', (value) => {
    expect(validateFeedUrl(value)).toBeNull();
  });

  it('keeps the query and removes the fragment', () => {
    const url = validateFeedUrl('https://feeds.example.com/rss?token=kept#private-fragment');
    expect(url?.href).toBe('https://feeds.example.com/rss?token=kept');
  });

  it('accepts the default feed URLs and an explicit HTTPS port', () => {
    expect(validateFeedUrl('https://github.blog/changelog/feed/')).not.toBeNull();
    expect(validateFeedUrl('https://openai.com/news/rss.xml')).not.toBeNull();
    expect(validateFeedUrl('https://feeds.example.com:443/rss')).not.toBeNull();
  });
});
