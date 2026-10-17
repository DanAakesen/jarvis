import { z } from 'zod';
import { validateCalendarRange } from './calendars.js';

const key = z.string().min(1).max(256).refine(value => Buffer.from(value, 'utf8').toString('utf8') === value);
const boundary = z.string().max(64);
const refresh = z.object({ operation: z.literal('refresh'), from: boundary, to: boundary }).strict()
  .refine(value => {
    try { validateCalendarRange({ from: value.from, to: value.to }); return true; }
    catch { return false; }
  });
export const dailyFeedInput = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('read_attention') }).strict(),
  z.object({ operation: z.literal('read_suppressions') }).strict(),
  refresh,
  z.object({ operation: z.literal('dismiss_thread'), id: key }).strict(),
  z.object({ operation: z.literal('receive_order'), id: key }).strict(),
  z.object({ operation: z.literal('clear_suppression'), type: z.enum(['thread', 'order']), key }).strict(),
]);
// The shared dispatcher checks extra fields before Ajv; the service enforces the exact operation shape.
export const dailyFeedInputSchema = z.toJSONSchema(z.object({
  operation: z.enum(['read_attention', 'read_suppressions', 'refresh', 'dismiss_thread', 'receive_order', 'clear_suppression']),
  from: boundary.optional(), to: boundary.optional(), id: key.optional(),
  type: z.enum(['thread', 'order']).optional(), key: key.optional(),
}).strict(), { target: 'draft-7', io: 'input' });
