import type { ApprovalNotificationPushResult } from '../push/approval-notifications.js';

export const ownerReminderApnsFixtures: ReadonlyArray<{
  readonly name: string;
  readonly result?: ApprovalNotificationPushResult;
  readonly throws?: true;
  readonly expectedState: 'accepted' | 'retrying' | 'failed' | 'invalid_token';
  readonly expectedReason: string;
  readonly retry: boolean;
}> = [
  {
    name: 'Apple accepts the exact reminder occurrence',
    result: { accepted: true, invalidToken: false, statusCode: 200 },
    expectedState: 'accepted',
    expectedReason: 'provider_accepted',
    retry: false,
  },
  {
    name: 'Apple rate-limits the send transiently',
    result: { accepted: false, invalidToken: false, retryable: true, statusCode: 429 },
    expectedState: 'retrying',
    expectedReason: 'provider_unavailable',
    retry: true,
  },
  {
    name: 'APNs transport resets without a response',
    throws: true,
    expectedState: 'retrying',
    expectedReason: 'provider_unavailable',
    retry: true,
  },
  {
    name: 'Apple permanently rejects the request',
    result: { accepted: false, invalidToken: false, retryable: false, statusCode: 403 },
    expectedState: 'failed',
    expectedReason: 'provider_rejected',
    retry: false,
  },
  {
    name: 'Apple rejects the registered token',
    result: { accepted: false, invalidToken: true, statusCode: 410 },
    expectedState: 'invalid_token',
    expectedReason: 'apns_invalid_token',
    retry: false,
  },
];
