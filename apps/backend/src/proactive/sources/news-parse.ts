import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '#cdata',
});

export interface ParsedNewsItem {
  title: string;
  publishedAt: Date;
  identity?: string;
}

function asArray(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const text = record['#text'] ?? record['#cdata'];
  if (typeof text === 'string' || typeof text === 'number') return String(text);
  return null;
}

function dateValue(value: unknown): Date | null {
  const text = textValue(value);
  if (!text) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function identityValue(record: Record<string, unknown>): string | undefined {
  for (const key of ['guid', 'id', 'link']) {
    const value = record[key];
    const candidate = textValue(value) ??
      (typeof value === 'object' && value !== null && !Array.isArray(value) &&
        typeof (value as Record<string, unknown>)['@_href'] === 'string'
        ? (value as Record<string, unknown>)['@_href'] as string
        : null);
    if (candidate?.trim()) return candidate.trim().slice(0, 1_000);
  }
  return undefined;
}

function entries(value: unknown, titleKey: string, dateKeys: string[], now: Date): ParsedNewsItem[] {
  const items: ParsedNewsItem[] = [];
  for (const entry of asArray(value)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const title = textValue(record[titleKey]);
    const publishedAt = dateKeys.map((key) => dateValue(record[key])).find((date) => date !== null) ?? null;
    if (!title || !publishedAt || publishedAt.getTime() > now.getTime() + 60 * 60_000) continue;
    const identity = identityValue(record);
    items.push({ title, publishedAt, ...(identity ? { identity } : {}) });
  }
  return items;
}

export function parseFeed(xml: string, now: Date): ParsedNewsItem[] | null {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(xml)) return null;

  let document: unknown;
  try {
    document = parser.parse(xml);
  } catch {
    return null;
  }
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return null;
  const root = document as Record<string, unknown>;

  const rss = root.rss;
  if (typeof rss === 'object' && rss !== null && !Array.isArray(rss)) {
    const channel = (rss as Record<string, unknown>).channel;
    if (channel === '') return [];
    if (typeof channel !== 'object' || channel === null || Array.isArray(channel)) return null;
    return entries((channel as Record<string, unknown>).item, 'title', ['pubDate'], now);
  }

  const feed = root.feed;
  if (typeof feed === 'object' && feed !== null && !Array.isArray(feed)) {
    return entries((feed as Record<string, unknown>).entry, 'title', ['published', 'updated'], now);
  }

  return null;
}
