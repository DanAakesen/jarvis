import { describe, expect, it } from 'vitest';
import { businessDaysElapsed, classifyGmailThread, mergeOrders, orderIdentityKey, orderMerchantKey, threadRevives, type Thread, type Order } from './attention.js';
export const syntheticThread: Thread = { type: 'thread', id: '01', threadId: '01', title: 'Synthetic question', latestMessageId: 'message-01',
  latestMessageAt: '2026-10-09T10:00:00Z', latestIncomingAt: '2026-10-09T10:00:00Z', latestDirection: 'incoming', senderName: 'Synthetic sender',
  senderEmail: 'sender@example.invalid', senderIsHuman: true, excludedCategory: null, semanticState: 'new_question', semanticEvidence: 'A factual synthetic question.',
  sentRequestAt: null, waitingSince: null, snippet: null, labels: [] };
export const syntheticOrder: Order = { id: 'order:synthetic:12345', company: 'Synthetic Shop Ltd', orderNumber: '12345', status: 'shipped', statusLabel: 'Shipped', deliveryDetail: null, updatedAt: '2026-10-09T10:00:00Z' };
describe('verified source attention selectors', () => {
  it('gates all seven semantic states across direction, age and waiting timestamp precedence', () => {
    const now = '2026-10-13T10:00:00Z';
    const old = '2026-10-08T10:00:00Z'; // Exactly three Danish business days.
    const recent = '2026-10-12T10:00:00Z'; // One Danish business day.
    const ages = [
      { latest: '2026-10-12T10:00:01Z', incomingEligible: false, fallbackEligible: false },
      { latest: recent, incomingEligible: true, fallbackEligible: false },
      { latest: old, incomingEligible: true, fallbackEligible: true },
    ];
    const timestamps = [
      { waitingSince: null, sentRequestAt: null, replyEligible: false, deferralEligible: null },
      { waitingSince: null, sentRequestAt: old, replyEligible: true, deferralEligible: null },
      { waitingSince: null, sentRequestAt: recent, replyEligible: false, deferralEligible: null },
      { waitingSince: '2026-10-09T10:00:00Z', sentRequestAt: old, replyEligible: false, deferralEligible: false }, // Two business days.
      { waitingSince: recent, sentRequestAt: old, replyEligible: false, deferralEligible: false },
      { waitingSince: old, sentRequestAt: recent, replyEligible: true, deferralEligible: true },
    ];
    const states = [
      ['new_question','incoming'], ['direct_request','incoming'], ['ambiguous','incoming'],
      ['awaiting_reply','reply'], ['deferral','deferral'], ['resolved','excluded'], ['none','excluded'],
    ] as const;
    for (const [semanticState,kind] of states) for (const latestDirection of ['incoming','outgoing'] as const) {
      for (const age of ages) for (const timestampsCase of timestamps) {
        const thread: Thread = { ...syntheticThread,semanticState,latestDirection,latestMessageAt: age.latest,
          latestIncomingAt: age.latest,waitingSince: timestampsCase.waitingSince,sentRequestAt: timestampsCase.sentRequestAt };
        const expected = kind === 'incoming' && latestDirection === 'incoming' && age.incomingEligible ? 'waiting_for_you'
          : kind === 'reply' && timestampsCase.replyEligible ? 'waiting_on_others'
          : kind === 'deferral' && (timestampsCase.deferralEligible ?? age.fallbackEligible) ? 'waiting_on_others' : null;
        const context = JSON.stringify({ semanticState,latestDirection,age,timestampsCase });
        expect(classifyGmailThread(thread,now)?.bucket ?? null,context).toBe(expected);
        expect(classifyGmailThread({ ...thread,senderIsHuman: false },now),context).toBeNull();
        expect(classifyGmailThread({ ...thread,excludedCategory: 'newsletter' },now),context).toBeNull();
      }
    }
  });
  it('uses exactly 24 real hours for incoming attention, labels ambiguity Review and excludes closed/nonhuman states', () => {
    expect(classifyGmailThread(syntheticThread,'2026-10-10T09:59:59Z')).toBeNull();
    expect(classifyGmailThread(syntheticThread,'2026-10-10T10:00:00Z')).toMatchObject({ bucket: 'waiting_for_you', label: '24h' });
    expect(classifyGmailThread({ ...syntheticThread,semanticState: 'ambiguous' },'2026-10-10T10:00:00Z')?.label).toBe('Review');
    for (const patch of [{ senderIsHuman: false },{ excludedCategory: 'newsletter' },{ semanticState: 'resolved' as const },{ semanticState: 'none' as const }]) expect(classifyGmailThread({ ...syntheticThread,...patch },'2026-10-20T10:00:00Z')).toBeNull();
  });
  it.each([
    ['2026-04-01T12:00:00Z','2026-04-07T12:00:00Z',1],
    ['2026-05-13T12:00:00Z','2026-05-18T12:00:00Z',2],
    ['2026-05-22T12:00:00Z','2026-05-26T12:00:00Z',1],
    ['2025-12-24T12:00:00Z','2025-12-29T12:00:00Z',1],
    ['2025-12-31T12:00:00Z','2026-01-02T12:00:00Z',1],
    ['2026-10-22T23:30:00Z','2026-10-27T23:30:00Z',3],
    ['2026-03-29T21:30:00Z','2026-03-29T22:30:00Z',1],
  ])('counts Danish weekdays/holidays/local date boundaries %s to %s', (start,end,expected) => { expect(businessDaysElapsed(start,end)).toBe(expected); });
  it('requires three business days, uses deferral promise and rejects invalid/reversed dates', () => {
    const thread = { ...syntheticThread,latestDirection: 'outgoing' as const,semanticState: 'awaiting_reply' as const,sentRequestAt: '2026-10-08T10:00:00Z' };
    expect(classifyGmailThread(thread,'2026-10-12T10:00:00Z')).toBeNull();
    expect(classifyGmailThread(thread,'2026-10-13T10:00:00Z')?.bucket).toBe('waiting_on_others');
    expect(classifyGmailThread({ ...thread,semanticState: 'deferral',waitingSince: '2026-10-12T10:00:00Z' },'2026-10-13T10:00:00Z')).toBeNull();
    expect(classifyGmailThread({ ...thread,sentRequestAt: null },'2026-10-20T10:00:00Z')).toBeNull();
    expect(businessDaysElapsed('invalid','2026-10-13T10:00:00Z')).toBe(0);
    expect(businessDaysElapsed('2026-10-13T10:00:00Z','2026-10-08T10:00:00Z')).toBe(0);
    expect(businessDaysElapsed('2020-01-01T00:00:00Z','2026-10-13T10:00:00Z')).toBeGreaterThan(1000);
  });
  it('merges consumer-visible order updates, retains factual details/source IDs and treats received as terminal', () => {
    expect(orderMerchantKey('www.Synthetic.dk ApS (sales@example.invalid)')).toBe('synthetic');
    const first = { ...syntheticOrder,deliveryDetail: 'Synthetic pickup point' };
    const newer = { ...syntheticOrder,id: 'source-id-kept',updatedAt: '2026-10-10T10:00:00Z' };
    expect(mergeOrders([first,newer])).toEqual([{ ...newer,deliveryDetail: first.deliveryDetail }]);
    expect(mergeOrders([first,{ ...newer,status: 'received' }])).toEqual([]);
    expect(mergeOrders([first,{ ...newer,orderNumber: '67890' }])).toHaveLength(2);
  });
  it('preserves exact legacy punctuation keys separately from raw grouping and producer compact IDs', () => {
    const order = { ...syntheticOrder,company: 'Acme ApS',orderNumber: ' DK-12/34 ' };
    expect(orderIdentityKey(order)).toBe('acme:dk 12 34');
    expect(orderIdentityKey({ ...order,orderNumber: 'DK1234' })).toBe('acme:dk1234');
    expect(orderIdentityKey({ ...order,orderNumber: null,deliveryDetail: 'Parcel #12, Door A' })).toBe('acme:parcel 12 door a');
    expect(orderMerchantKey('Acme AS (sales@example.invalid) Shop.dk')).toBe('acme shop');
    expect(orderIdentityKey({ ...order,company: 'ÆØÅ',orderNumber: '12345' })).toBe('');
    expect(mergeOrders([order,{ ...order,id: 'other-source-id',orderNumber: 'DK1234' }])).toHaveLength(2);
    expect(mergeOrders([order,{ ...order,id: 'new-source-id',orderNumber: ' dk-12/34 ',updatedAt: '2026-10-10T10:00:00Z' }])[0]?.id).toBe('new-source-id');
    expect(mergeOrders([{ ...order,status: ' RECEIVED ' }])).toEqual([]);
  });
  it('revives only a different message with newer incoming data, never mere outgoing IDs', () => {
    const saved = { messageId: syntheticThread.latestMessageId,incomingAt: syntheticThread.latestIncomingAt };
    expect(threadRevives({ ...syntheticThread,latestMessageId: 'outgoing-new' },saved)).toBe(false);
    expect(threadRevives({ ...syntheticThread,latestIncomingAt: null,latestMessageId: 'new' },saved)).toBe(false);
    expect(threadRevives({ ...syntheticThread,latestMessageId: 'incoming-new',latestIncomingAt: '2026-10-10T10:00:00Z' },saved)).toBe(true);
    expect(threadRevives({ ...syntheticThread,latestMessageId: 'new' },{ ...saved,incomingAt: null })).toBe(true);
  });
});
