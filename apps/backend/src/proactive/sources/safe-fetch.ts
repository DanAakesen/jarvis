import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';

export const NEWS_MAX_BYTES = 2 * 1024 * 1024;
const NEWS_TIMEOUT_MS = 10_000;

export type NewsFetchFailure = 'timeout' | 'rate_limited' | 'too_large' | 'read_failed';

export class NewsFetchError extends Error {
  constructor(readonly reason: NewsFetchFailure) {
    super(reason);
    this.name = 'NewsFetchError';
  }
}

export type FeedAddressResolver = (
  hostname: string,
  options: { all: true },
) => Promise<{ address: string; family: number }[]>;

function ipv4Number(ip: string): number | null {
  if (ip.split('.').length !== 4) return null;
  const octets = ip.split('.').map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
  return octets.reduce((value, octet) => ((value << 8) | octet) >>> 0, 0);
}

const blockedIpv4Ranges: readonly [number, number][] = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

function inIpv4Range(address: number, network: number, prefix: number): boolean {
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) === (network & mask);
}

function ipv6Number(ip: string): bigint | null {
  if (ip.includes('%')) return null;

  let value = ip.toLowerCase();
  const ipv4Tail = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(value);
  if (ipv4Tail) {
    const embedded = ipv4Number(ipv4Tail[1]!);
    if (embedded === null) return null;
    value = value.slice(0, -ipv4Tail[1]!.length) +
      `${(embedded >>> 16).toString(16)}:${(embedded & 0xffff).toString(16)}`;
  }

  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0]!.split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1]!.split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[\da-f]{1,4}$/u.test(group))) return null;
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
}

export function isPublicAddress(ip: string): boolean {
  if (!ip.includes(':')) {
    if (isIP(ip) !== 4) return false;
    const address = ipv4Number(ip);
    return address !== null && !blockedIpv4Ranges.some(([network, prefix]) =>
      inIpv4Range(address, network, prefix));
  }

  if (isIP(ip) !== 6) return false;
  const address = ipv6Number(ip);
  if (address === null) return false;

  const ipv4MappedPrefix = address >> 32n;
  if (ipv4MappedPrefix === 0xffffn) {
    const embedded = Number(address & 0xffffffffn);
    return isPublicAddress([24, 16, 8, 0].map((shift) => (embedded >>> shift) & 0xff).join('.'));
  }

  const nat64Prefix = address >> 32n;
  if (nat64Prefix === 0x64ff9bn) {
    const embedded = Number(address & 0xffffffffn);
    return isPublicAddress([24, 16, 8, 0].map((shift) => (embedded >>> shift) & 0xff).join('.'));
  }

  if (address >> 112n === 0x2002n) {
    const embedded = Number((address >> 80n) & 0xffffffffn);
    return isPublicAddress([24, 16, 8, 0].map((shift) => (embedded >>> shift) & 0xff).join('.'));
  }

  if (address >> 96n === 0x20010db8n) return false;
  return address >> 125n === 1n;
}

function resolverError(): NodeJS.ErrnoException {
  const error = new Error('Feed address is not public') as NodeJS.ErrnoException;
  error.code = 'EHOSTUNREACH';
  return error;
}

export function createSafeLookup(resolve: FeedAddressResolver = dnsLookup): LookupFunction {
  return (hostname, options, callback) => {
    void resolve(hostname, { all: true }).then((addresses) => {
      if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
        callback(resolverError(), '');
        return;
      }
      const all = typeof options === 'object' && options !== null && options.all === true;
      if (all) callback(null, addresses);
      else {
        const first = addresses[0]!;
        callback(null, first.address, first.family);
      }
    }).catch(() => callback(resolverError(), ''));
  };
}

function responseFailure(response: IncomingMessage): NewsFetchFailure | null {
  if (response.statusCode !== 200) return response.statusCode === 429 ? 'rate_limited' : 'read_failed';

  const contentType = response.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (!['application/rss+xml', 'application/atom+xml', 'application/xml', 'text/xml'].includes(contentType ?? '')) {
    return 'read_failed';
  }
  const contentEncoding = response.headers['content-encoding']?.trim().toLowerCase();
  if (contentEncoding && contentEncoding !== 'identity') return 'read_failed';
  return null;
}

export async function fetchFeedText(
  url: URL,
  options: { signal: AbortSignal; resolve?: FeedAddressResolver },
): Promise<string> {
  const timeoutSignal = AbortSignal.timeout(NEWS_TIMEOUT_MS);
  const signal = AbortSignal.any([options.signal, timeoutSignal]);
  if (signal.aborted) throw new NewsFetchError('timeout');

  return new Promise<string>((resolve, reject) => {
    let request: ReturnType<typeof httpsRequest>;
    let settled = false;
    const finish = (error?: NewsFetchError, text?: string) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(text ?? '');
    };
    const fail = (reason: NewsFetchFailure) => {
      const error = new NewsFetchError(reason);
      request?.destroy(error);
      finish(error);
    };

    try {
      request = httpsRequest(url, {
        method: 'GET',
        agent: false,
        minVersion: 'TLSv1.2',
        signal,
        lookup: createSafeLookup(options.resolve),
        headers: {
          Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8',
          'Accept-Encoding': 'identity',
          'User-Agent': 'Jarvis-Proactive/1.0',
        },
      }, (response) => {
        const failure = responseFailure(response);
        if (failure) {
          response.destroy();
          fail(failure);
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        response.on('data', (chunk: Buffer | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += bytes.length;
          if (total > NEWS_MAX_BYTES) {
            fail('too_large');
            return;
          }
          chunks.push(bytes);
        });
        response.on('end', () => finish(undefined, Buffer.concat(chunks).toString('utf8')));
        response.on('error', () => finish(new NewsFetchError(signal.aborted ? 'timeout' : 'read_failed')));
      });
      request.setTimeout(NEWS_TIMEOUT_MS, () => fail('timeout'));
      request.on('error', (error: unknown) => {
        if (error instanceof NewsFetchError) finish(error);
        else finish(new NewsFetchError(signal.aborted ? 'timeout' : 'read_failed'));
      });
      request.end();
    } catch {
      finish(new NewsFetchError(signal.aborted ? 'timeout' : 'read_failed'));
    }
  });
}
