import type { FastifyPluginAsync } from 'fastify';
import type { InboxIndex } from './item-index.js';
import { AUDIT_DAY_KEY, NUDGE_STYLE_KEY, WEEKLY_WEEK_KEY, type InboxOpsStore } from './ops.js';
import { dayKey } from '../proactive/time.js';
import { INBOX_DAILY_CEILING_DKK } from './proactive-hook.js';

const day = 24 * 60 * 60 * 1000;
const apiError = { type: 'object', properties: { error: { type: 'string' } }, required: ['error'], additionalProperties: false };

/** Owner-only view of the inbox loop: what is live, what was nudged, what it cost, and when the sweeps last ran. */
export function createInboxStatusRoute(options: {
  readonly ownerObjectId: string;
  readonly index?: InboxIndex | undefined;
  readonly ops?: InboxOpsStore | undefined;
  readonly nudgesEnabled: boolean;
  readonly now?: () => Date;
}): FastifyPluginAsync {
  const now = options.now ?? (() => new Date());
  return async (app) => {
    app.get('/inbox/status', {
      schema: { response: { 200: { type: 'object', additionalProperties: true }, 403: apiError, 503: apiError } },
    }, async (request, reply) => {
      if (request.principal?.objectId.toLowerCase() !== options.ownerObjectId.toLowerCase()) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const signal = AbortSignal.timeout(15_000);
      const at = now();
      // The ledger is written with Copenhagen dates, so it is read with them.
      const today = dayKey(at);
      const from = dayKey(new Date(at.getTime() - 29 * day));
      try {
        const [rows, spend, style, audit, weekly] = await Promise.all([
          options.index?.rows(signal) ?? Promise.resolve([]),
          options.ops?.spendSince(from, signal) ?? Promise.resolve([]),
          options.ops?.getState(NUDGE_STYLE_KEY, signal) ?? Promise.resolve(null),
          options.ops?.getState(AUDIT_DAY_KEY, signal) ?? Promise.resolve(null),
          options.ops?.getState(WEEKLY_WEEK_KEY, signal) ?? Promise.resolve(null),
        ]);
        const live = rows.filter((row) => row.path !== null);
        const byKind: Record<string, { calls: number; dkk: number }> = {};
        for (const row of spend) {
          const entry = byKind[row.kind] ??= { calls: 0, dkk: 0 };
          entry.calls += row.calls;
          entry.dkk = Math.round((entry.dkk + row.estimatedDkk) * 1e6) / 1e6;
        }
        const round = (value: number) => Math.round(value * 1e4) / 1e4;
        return {
          nudgesEnabled: options.nudgesEnabled,
          items: {
            live: live.length,
            nudgedLast7Days: live.filter((row) => row.lastNudgedAt && at.getTime() - row.lastNudgedAt.getTime() < 7 * day).length,
            thumbsUp: live.filter((row) => row.lastFeedback === 'up').length,
            thumbsDown: live.filter((row) => row.lastFeedback === 'down').length,
          },
          spend: {
            currency: 'DKK',
            basis: 'estimated from list prices; not an invoice',
            dailyCeiling: INBOX_DAILY_CEILING_DKK,
            today: round(spend.filter((row) => row.day === today).reduce((sum, row) => sum + row.estimatedDkk, 0)),
            last30Days: round(spend.reduce((sum, row) => sum + row.estimatedDkk, 0)),
            byKindLast30Days: byKind,
          },
          nudgeStyleSet: style !== null,
          lastAuditDay: audit,
          lastWeeklyReviewDay: weekly,
        };
      } catch {
        return reply.code(503).send({ error: 'Inbox status is unavailable right now.' });
      }
    });
  };
}
