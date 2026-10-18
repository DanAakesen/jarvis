import type { ProactiveSource, SourceFact, SourceContext } from '../types.js';
import { NewsFetchError, fetchFeedText, type NewsFetchFailure } from './safe-fetch.js';
import { parseFeed, type ParsedNewsItem } from './news-parse.js';
import { validateFeedUrl } from './news-url.js';

export const NEWS_MAX_AGE_HOURS = 48;
const MAX_FEEDS = 10;
const MAX_ITEMS_PER_FEED = 8;
const MAX_ITEMS_TOTAL = 30;

type FeedFetcher = (url: URL, options: { signal: AbortSignal }) => Promise<string>;
type FailureReason = NewsFetchFailure | 'invalid_feed';

interface FeedItems {
  hostname: string;
  items: ParsedNewsItem[];
}

function cleanTitle(value: string): string {
  return value
    .replace(/\p{Cc}/gu, '')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/!?\[([^\]]*)\]\((?:<[^>]*>|[^)]*)\)/gu, '$1')
    .replace(/!?\[([^\]]*)\](?:\[[^\]]*\])?/gu, '$1')
    .replace(/https?:\/\/\S+/giu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function truncate(value: string, limit: number): string {
  let result = value.slice(0, limit);
  if (/[\uD800-\uDBFF]$/u.test(result)) result = result.slice(0, -1);
  return result;
}

function failureCode(error: unknown): FailureReason {
  if (error instanceof NewsFetchError) return error.reason;
  if (typeof error === 'object' && error !== null && 'reason' in error &&
      ['timeout', 'rate_limited', 'too_large', 'read_failed', 'invalid_feed'].includes(String(error.reason))) {
    return error.reason as FailureReason;
  }
  return 'read_failed';
}

function observedAt(now: Date): string {
  return Number.isFinite(now.getTime()) ? now.toISOString() : new Date().toISOString();
}

export function createNewsSource(
  { fetchFeed = fetchFeedText }: { fetchFeed?: FeedFetcher } = {},
): ProactiveSource {
  return {
    id: 'news',
    label: 'News',
    async read(context: SourceContext) {
      const checkedAt = observedAt(context.now);
      try {
        const configuredFeeds = Array.isArray(context.settings.newsFeeds)
          ? context.settings.newsFeeds.slice(0, MAX_FEEDS)
          : [];
        if (configuredFeeds.length === 0) {
          return { source: 'news', state: 'unavailable', reason: 'no_feeds', facts: [], observedAt: checkedAt };
        }

        const results = await Promise.allSettled(configuredFeeds.map(async (value): Promise<FeedItems> => {
          const url = typeof value === 'string' ? validateFeedUrl(value) : null;
          if (!url) throw new NewsFetchError('read_failed');
          const xml = await fetchFeed(url, { signal: context.signal });
          const items = parseFeed(xml, context.now);
          if (items === null) throw { reason: 'invalid_feed' };
          return { hostname: url.hostname, items };
        }));

        const successfulFeeds: { feedIndex: number; feed: FeedItems }[] = [];
        const failedFeeds: { feedIndex: number; reason: FailureReason }[] = [];
        results.forEach((result, feedIndex) => {
          if (result.status === 'fulfilled') successfulFeeds.push({ feedIndex, feed: result.value });
          else {
            const value = configuredFeeds[feedIndex];
            const reason = typeof value === 'string' && !validateFeedUrl(value)
              ? 'invalid_feed'
              : failureCode(result.reason);
            failedFeeds.push({ feedIndex, reason });
          }
        });

        if (successfulFeeds.length === 0) {
          return {
            source: 'news',
            state: 'unavailable',
            reason: failedFeeds[0]?.reason ?? 'read_failed',
            facts: [],
            observedAt: checkedAt,
          };
        }

        const oldestAllowed = context.now.getTime() - NEWS_MAX_AGE_HOURS * 60 * 60_000;
        const items = successfulFeeds.flatMap(({ feedIndex, feed }) =>
          feed.items
            .filter(({ publishedAt }) => publishedAt.getTime() >= oldestAllowed)
            .sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime())
            .slice(0, MAX_ITEMS_PER_FEED)
            .map((item, itemIndex) => ({ ...item, feedIndex, itemIndex, hostname: feed.hostname })));

        items.sort((left, right) =>
          right.publishedAt.getTime() - left.publishedAt.getTime() ||
          left.feedIndex - right.feedIndex ||
          left.itemIndex - right.itemIndex);

        const seenTitles = new Set<string>();
        const facts: SourceFact[] = [];
        for (const item of items) {
          const title = cleanTitle(item.title);
          const normalizedTitle = title.replace(/\s+/gu, ' ').toLowerCase();
          if (!title || seenTitles.has(normalizedTitle)) continue;
          seenTitles.add(normalizedTitle);

          const titleLimit = Math.min(200, Math.max(0, 297 - item.hostname.length));
          facts.push({
            ref: `news:${facts.length + 1}`,
            kind: 'news',
            label: 'News',
            observedAt: item.publishedAt.toISOString(),
            text: `${truncate(title, titleLimit)} (${item.hostname})`,
          });
          if (facts.length >= MAX_ITEMS_TOTAL) break;
        }

        return {
          source: 'news',
          state: 'ok',
          reason: failedFeeds.length > 0 ? 'some_feeds_failed' : null,
          facts,
          observedAt: checkedAt,
        };
      } catch {
        return { source: 'news', state: 'unavailable', reason: 'read_failed', facts: [], observedAt: checkedAt };
      }
    },
  };
}
