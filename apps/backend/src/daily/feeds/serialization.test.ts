import { describe,expect,it } from 'vitest';
import { canonicalJson } from '../nutrition/model.js';
import { boundedSource,canonicalFeedRun,MAX_SOURCE_BYTES,type FeedItem,type SourceAttempt } from './store.js';

const now = '2026-10-12T12:00:00Z';
function events(count: number): SourceAttempt {
  return { source: 'GoogleCalendar',status: 'ok',errorCode: null,items: Array.from({ length: count },(_,i): FeedItem => ({
    type: 'event',id: `synthetic:${i}`,title: 'Synthetic',content: {
      type: 'event',id: `synthetic:${i}`,calendarId: 'synthetic',providerEventId: String(i),title: 'Synthetic',calendarName: 'Synthetic',
      location: null,status: 'confirmed',start: { date: '2026-10-12' },end: { date: '2026-10-13' },
      startsAt: '2026-10-12T00:00:00Z',endsAt: '2026-10-13T00:00:00Z',allDay: true,
    },
  })) };
}
describe('independent bounded canonical feed serialization', () => {
  it('converts a sub-item/byte-limit calendar node overflow into a sanitized source failure', () => {
    const source = events(600);
    expect(source.items.length).toBeLessThan(1000);
    expect(Buffer.byteLength(JSON.stringify(source),'utf8')).toBeLessThan(MAX_SOURCE_BYTES);
    expect(() => canonicalJson(source)).toThrow('JSON exceeds limits');
    expect(boundedSource(source,now)).toEqual({ source: 'GoogleCalendar',status: 'error',items: [],errorCode: 'coverage-limit' });
  });
  it.each(['depth','cycle','undefined','nonfinite'])('fails closed independently for unsupported JSON %s', (kind) => {
    const source = events(1); const content = source.items[0]!.content as Record<string,unknown>;
    if (kind === 'depth') { let value: unknown = 'Synthetic'; for (let i = 0; i < 17; i++) value = { nested: value }; content.start = value; }
    if (kind === 'cycle') content.start = content;
    if (kind === 'undefined') content.location = undefined;
    if (kind === 'nonfinite') content.location = Infinity;
    expect(() => canonicalJson(source)).toThrow();
    expect(boundedSource(source,now)).toEqual({ source: 'GoogleCalendar',status: 'error',items: [],errorCode: 'coverage-limit' });
  });
  it('retains canonical bytes/checksums for already-supported runs', () => {
    const run = { runId: '01',capturedAt: now,sources: [events(1),{ source: 'Gmail' as const,status: 'ok' as const,errorCode: null,items: [] }] };
    expect(canonicalFeedRun(run)).toBe(canonicalJson(run));
  });
  it('composes two independently valid budgets without imposing nutrition aggregate limits', () => {
    const first = events(350);
    const second: SourceAttempt = { source: 'Gmail',status: 'ok',errorCode: null,items: Array.from({ length: 120 },(_,i) => ({
      type: 'thread',id: String(i),title: 'Synthetic',content: {
        type: 'thread',id: String(i),threadId: String(i),title: 'Synthetic',latestMessageId: `message-${i}`,latestMessageAt: '2026-10-09T10:00:00Z',
        latestIncomingAt: '2026-10-09T10:00:00Z',latestDirection: 'incoming',senderName: null,senderEmail: 'sender@example.invalid',senderIsHuman: true,
        excludedCategory: null,semanticState: 'new_question',semanticEvidence: 'Synthetic factual question',sentRequestAt: null,waitingSince: null,snippet: null,
        labels: Array.from({ length: 30 },(_,label) => `synthetic-${label}`),
      },
    })) };
    expect(() => canonicalJson(first)).not.toThrow(); expect(() => canonicalJson(second)).not.toThrow();
    expect(boundedSource(first,now)).toBe(first); expect(boundedSource(second,now)).toBe(second);
    const run = { runId: 'large',capturedAt: now,sources: [first,second] };
    expect(() => canonicalJson(run)).toThrow('JSON exceeds limits');
    const serialized = canonicalFeedRun(run);
    expect(JSON.parse(serialized)).toEqual(run);
    expect(Buffer.byteLength(serialized,'utf8')).toBeLessThan(1024 * 1024);
  });
});
