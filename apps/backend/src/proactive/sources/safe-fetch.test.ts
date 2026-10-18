import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('node:https', () => ({ request: requestMock }));

import {
  createSafeLookup,
  fetchFeedText,
  isPublicAddress,
  NEWS_MAX_BYTES,
  NewsFetchError,
  type FeedAddressResolver,
} from './safe-fetch.js';

const feedUrl = new URL('https://feeds.example.com/rss');

function ipv4Number(ip: string): number {
  return ip.split('.').map(Number).reduce((value, octet) => ((value << 8) | octet) >>> 0, 0);
}

function ipv4Text(address: number): string {
  return [24, 16, 8, 0].map((shift) => (address >>> shift) & 0xff).join('.');
}

function configureResponse(
  body: string | Buffer,
  { statusCode = 200, headers = { 'content-type': 'application/rss+xml; charset=UTF-8' } } = {},
) {
  let idleTimeout: (() => void) | undefined;
  const request = Object.assign(new EventEmitter(), {
    setTimeout: vi.fn((_milliseconds: number, callback: () => void) => { idleTimeout = callback; }),
    destroy: vi.fn((error?: Error) => {
      if (error) queueMicrotask(() => request.emit('error', error));
      return request;
    }),
    end: vi.fn(() => {
      const response = Readable.from([body]) as Readable & { statusCode?: number; headers?: Record<string, string> };
      response.statusCode = statusCode;
      response.headers = headers;
      const callback = requestMock.mock.calls.at(-1)?.[2] as ((response: unknown) => void) | undefined;
      callback?.(response);
    }),
  });
  requestMock.mockReturnValue(request);
  return { request, triggerIdleTimeout: () => idleTimeout?.() };
}

function lookupResult(lookup: ReturnType<typeof createSafeLookup>, options: { all: boolean }) {
  return new Promise<{ error: NodeJS.ErrnoException | null; address: unknown; family?: number }>((resolve) => {
    lookup('feed.example.com', options, (error, address, family) => resolve({ error, address, family }));
  });
}

describe('isPublicAddress', () => {
  const ranges: [string, number][] = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ];

  it('blocks both ends of each listed IPv4 range', () => {
    for (const [networkText, prefix] of ranges) {
      const network = ipv4Number(networkText);
      const size = 2 ** (32 - prefix);
      expect(isPublicAddress(ipv4Text(network)), `${networkText}/${prefix} start`).toBe(false);
      expect(isPublicAddress(ipv4Text((network + size - 1) >>> 0)), `${networkText}/${prefix} end`).toBe(false);
    }
  });

  it('allows addresses immediately outside the ordinary blocked ranges', () => {
    const ordinaryRanges = ranges.slice(0, 13);
    for (const [networkText, prefix] of ordinaryRanges) {
      const network = ipv4Number(networkText);
      const size = 2 ** (32 - prefix);
      if (network > 0) expect(isPublicAddress(ipv4Text((network - 1) >>> 0))).toBe(true);
      if (network + size < 0x1_0000_0000) expect(isPublicAddress(ipv4Text(network + size))).toBe(true);
    }
    expect(isPublicAddress('223.255.255.255')).toBe(true);
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('invalid')).toBe(false);
  });

  it('judges mapped, NAT64, and 6to4 addresses by their embedded IPv4 address', () => {
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true);
    expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicAddress('64:ff9b::808:808')).toBe(true);
    expect(isPublicAddress('64:ff9b::a00:1')).toBe(false);
    expect(isPublicAddress('2002:808:808::')).toBe(true);
    expect(isPublicAddress('2002:a00:1::')).toBe(false);
  });

  it('allows only IPv6 global unicast outside the documentation range', () => {
    expect(isPublicAddress('2000::1')).toBe(true);
    expect(isPublicAddress('3fff::1')).toBe(true);
    expect(isPublicAddress('2001:db8::1')).toBe(false);
    expect(isPublicAddress('1fff::1')).toBe(false);
    expect(isPublicAddress('fc00::1')).toBe(false);
  });
});

describe('createSafeLookup', () => {
  it('rejects a mixed public and private DNS answer', async () => {
    const resolve: FeedAddressResolver = async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ];
    const lookup = createSafeLookup(resolve);
    expect((await lookupResult(lookup, { all: true })).error?.code).toBe('EHOSTUNREACH');
    expect((await lookupResult(lookup, { all: false })).error?.code).toBe('EHOSTUNREACH');
  });

  it('returns only vetted addresses with both Node callback shapes', async () => {
    const resolve: FeedAddressResolver = async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '1.1.1.1', family: 4 },
    ];
    const lookup = createSafeLookup(resolve);
    const all = await lookupResult(lookup, { all: true });
    expect(all).toMatchObject({ error: null, address: [{ address: '8.8.8.8', family: 4 }, { address: '1.1.1.1', family: 4 }] });
    const one = await lookupResult(lookup, { all: false });
    expect(one).toMatchObject({ error: null, address: '8.8.8.8', family: 4 });
  });
});

describe('fetchFeedText', () => {
  beforeEach(() => requestMock.mockReset());

  it.each([301, 302, 307, 308])('rejects redirect status %i', async (statusCode) => {
    configureResponse('', { statusCode });
    await expect(fetchFeedText(feedUrl, { signal: new AbortController().signal }))
      .rejects.toMatchObject({ reason: 'read_failed' });
  });

  it('requires an XML feed content type and identity encoding', async () => {
    configureResponse('', { headers: { 'content-type': 'text/html' } });
    await expect(fetchFeedText(feedUrl, { signal: new AbortController().signal }))
      .rejects.toMatchObject({ reason: 'read_failed' });

    configureResponse('', { headers: { 'content-type': 'application/xml', 'content-encoding': 'gzip' } });
    await expect(fetchFeedText(feedUrl, { signal: new AbortController().signal }))
      .rejects.toMatchObject({ reason: 'read_failed' });

    configureResponse('valid', { headers: { 'content-type': 'application/xml; charset=UTF-8', 'content-encoding': 'identity' } });
    await expect(fetchFeedText(feedUrl, { signal: new AbortController().signal })).resolves.toBe('valid');
  });

  it('destroys an oversized response and accepts a body one byte below the limit', async () => {
    const tooLarge = configureResponse(Buffer.alloc(NEWS_MAX_BYTES + 1, 0x61));
    await expect(fetchFeedText(feedUrl, { signal: new AbortController().signal }))
      .rejects.toMatchObject({ reason: 'too_large' });
    expect(tooLarge.request.destroy).toHaveBeenCalledWith(expect.objectContaining({ reason: 'too_large' }));

    configureResponse(Buffer.alloc(NEWS_MAX_BYTES - 1, 0x61));
    const text = await fetchFeedText(feedUrl, { signal: new AbortController().signal });
    expect(text).toHaveLength(NEWS_MAX_BYTES - 1);
  });

  it('maps idle timeout and abort to timeout', async () => {
    const timed = configureResponse('');
    const pending = fetchFeedText(feedUrl, { signal: new AbortController().signal });
    timed.triggerIdleTimeout();
    await expect(pending).rejects.toBeInstanceOf(NewsFetchError);
    await expect(pending).rejects.toMatchObject({ reason: 'timeout' });

    const controller = new AbortController();
    controller.abort();
    await expect(fetchFeedText(feedUrl, { signal: controller.signal })).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('uses the pinned HTTPS request options and does not call global fetch', async () => {
    const globalFetch = vi.fn();
    vi.stubGlobal('fetch', globalFetch);
    configureResponse('<rss/>');
    await fetchFeedText(feedUrl, {
      signal: new AbortController().signal,
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    });
    const requestOptions = requestMock.mock.calls[0]?.[1] as {
      agent: unknown;
      minVersion: string;
      method: string;
      headers: Record<string, string>;
      lookup: ReturnType<typeof createSafeLookup>;
    };
    expect(requestOptions).toMatchObject({
      agent: false,
      minVersion: 'TLSv1.2',
      method: 'GET',
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8',
        'Accept-Encoding': 'identity',
        'User-Agent': 'Jarvis-Proactive/1.0',
      },
    });
    expect(requestOptions).not.toHaveProperty('rejectUnauthorized');
    expect(requestOptions.headers).not.toHaveProperty('Cookie');
    expect(requestOptions.headers).not.toHaveProperty('Authorization');
    const checked = await lookupResult(requestOptions.lookup, { all: false });
    expect(checked).toMatchObject({ error: null, address: '8.8.8.8', family: 4 });
    expect(globalFetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('maps 429 to rate_limited', async () => {
    configureResponse('', { statusCode: 429 });
    await expect(fetchFeedText(feedUrl, { signal: new AbortController().signal }))
      .rejects.toMatchObject({ reason: 'rate_limited' });
  });
});
