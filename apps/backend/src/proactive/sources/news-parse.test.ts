import { describe, expect, it } from 'vitest';
import { parseFeed } from './news-parse.js';

const now = new Date('2026-10-18T12:00:00.000Z');

describe('parseFeed', () => {
  it('parses RSS titles including CDATA and skips missing or excessively future dates', () => {
    const xml = `<rss version="2.0"><channel>
      <item><title><![CDATA[Release & tools]]></title><pubDate>Sun, 18 Oct 2026 11:00:00 GMT</pubDate></item>
      <item><title>Missing date</title></item>
      <item><title>Future</title><pubDate>Sun, 18 Oct 2026 14:00:00 GMT</pubDate></item>
    </channel></rss>`;
    expect(parseFeed(xml, now)).toEqual([
      { title: 'Release & tools', publishedAt: new Date('2026-10-18T11:00:00.000Z') },
    ]);
  });

  it('parses Atom plain and HTML-object titles using published or updated', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry><title>Plain title</title><published>2026-10-18T11:00:00Z</published></entry>
      <entry><title type="html">&lt;p&gt;HTML title&lt;/p&gt;</title><updated>2026-10-18T10:00:00Z</updated></entry>
    </feed>`;
    expect(parseFeed(xml, now)).toEqual([
      { title: 'Plain title', publishedAt: new Date('2026-10-18T11:00:00.000Z') },
      { title: '<p>HTML title</p>', publishedAt: new Date('2026-10-18T10:00:00.000Z') },
    ]);
  });

  it.each([
    '<!DOCTYPE rss><rss><channel/></rss>',
    '<!ENTITY unsafe "value"><rss><channel/></rss>',
    '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><rss><channel/></rss>',
  ])('rejects documents containing DTD or entity declarations', (xml) => {
    expect(parseFeed(xml, now)).toBeNull();
  });

  it('returns null for a document that is not an RSS or Atom feed', () => {
    expect(parseFeed('<html><body>not a feed</body></html>', now)).toBeNull();
  });
});
