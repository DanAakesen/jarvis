import type { ActivityAlert } from '../../alerts.js';
import type { SystemPushOutcome, SystemPushRequest } from '../push-delivery.js';
import type { ChannelOutcome, OutreachChannel, OutreachRecord, OutreachTier } from './types.js';

/** Low: a card in the Now feed, written as an activity row like the other Now cards. */
export function createNowCardChannel(feed: { record(alert: ActivityAlert): Promise<boolean> }): OutreachChannel {
  return {
    id: 'now_card',
    tiers: ['low'],
    async deliver(outreach): Promise<ChannelOutcome> {
      const title = Array.from(`${outreach.title}: ${outreach.body}`).slice(0, 400).join('');
      const created = await feed.record({
        type: 'proactive_outreach', dedupeKey: `outreach:${outreach.id}`, title,
        // The card opens the finding, where the thumbs live.
        link: outreach.itemId ? `proactive:${outreach.itemId}` : null,
      });
      return { channel: 'now_card', status: created ? 'sent' : 'skipped', reason: created ? null : 'already_shown' };
    },
  };
}

/** Medium and high: a push. Both tiers share this channel; they differ only once a call channel is added. */
export function createPushChannel(send: (request: SystemPushRequest, signal: AbortSignal) => Promise<SystemPushOutcome>): OutreachChannel {
  return {
    id: 'push',
    tiers: ['medium', 'high'],
    async deliver(outreach, signal): Promise<ChannelOutcome> {
      if (!outreach.itemId) return { channel: 'push', status: 'skipped', reason: 'no_item' };
      const outcome = await send({
        kind: 'insight', count: 1, itemId: outreach.itemId, origin: 'proactive_alert', bypassQuietHours: true,
        details: [{ title: outreach.title, body: outreach.body, dueAt: null }],
      }, signal);
      return { channel: 'push', status: outcome.status, reason: outcome.reason };
    },
  };
}

/*
 * Extension point for the later phone call: implement OutreachChannel with `tiers: ['high']`
 * (a VoIP provider adapter whose deliver() places the call) and add it to the list passed to
 * createEventPipeline. The tier policy, the outreach ledger and the thumbs feedback need no change.
 */
export async function deliverThroughChannels(
  channels: readonly OutreachChannel[],
  tier: OutreachTier,
  outreach: OutreachRecord,
  signal: AbortSignal,
): Promise<ChannelOutcome[]> {
  const selected = channels.filter((channel) => channel.tiers.includes(tier));
  if (selected.length === 0) return [{ channel: 'none', status: 'skipped', reason: 'no_channel_for_tier' }];
  return Promise.all(selected.map(async (channel): Promise<ChannelOutcome> => {
    try { return await channel.deliver(outreach, signal); }
    catch { return { channel: channel.id, status: 'failed', reason: 'channel_error' }; }
  }));
}
