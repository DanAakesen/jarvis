import { copenhagenDate, instant, text } from '../nutrition/model.js';

export const semanticStates = ['new_question','direct_request','ambiguous','awaiting_reply','deferral','resolved','none'] as const;
export type SemanticState = typeof semanticStates[number];
export interface Thread {
  type: 'thread'; id: string; title: string; threadId: string; latestMessageId: string; latestMessageAt: string;
  latestIncomingAt: string | null; latestDirection: 'incoming' | 'outgoing'; senderName: string | null; senderEmail: string | null;
  senderIsHuman: boolean; excludedCategory: string | null; semanticState: SemanticState; semanticEvidence: string;
  sentRequestAt: string | null; waitingSince: string | null; snippet: string | null; labels: string[];
}
export interface Waiting { thread: Thread; bucket: 'waiting_for_you' | 'waiting_on_others'; label: string }
export function validateThread(thread: Thread): void {
  const fields = ['type','id','title','threadId','latestMessageId','latestMessageAt','latestIncomingAt','latestDirection','senderName','senderEmail','senderIsHuman','excludedCategory','semanticState','semanticEvidence','sentRequestAt','waitingSince','snippet','labels'];
  if (!thread || Object.keys(thread).length !== fields.length || Object.keys(thread).some((field) => !fields.includes(field)) || thread.type !== 'thread' ||
      !semanticStates.includes(thread.semanticState) || !['incoming','outgoing'].includes(thread.latestDirection) || typeof thread.senderIsHuman !== 'boolean') throw new TypeError('Invalid thread DTO');
  text(thread.id); text(thread.threadId); text(thread.latestMessageId); text(thread.title,4000); text(thread.semanticEvidence,2000);
  for (const value of [thread.latestMessageAt,thread.latestIncomingAt,thread.sentRequestAt,thread.waitingSince]) if (value !== null) instant(value);
  for (const [value,max] of [[thread.senderName,2000],[thread.senderEmail,320],[thread.snippet,2000]] as const) if (value !== null && (typeof value !== 'string' || value.length > max)) throw new TypeError('Invalid thread text');
  if (thread.excludedCategory !== null && !['newsletter','marketing','receipt','automated','calendar_notification','non_human'].includes(thread.excludedCategory)) throw new TypeError('Invalid excluded category');
  if (!Array.isArray(thread.labels) || thread.labels.length > 30 || thread.labels.some((label) => typeof label !== 'string' || label.length > 256)) throw new TypeError('Invalid thread labels');
  if (thread.latestIncomingAt !== null && Date.parse(thread.latestIncomingAt) > Date.parse(thread.latestMessageAt)) throw new TypeError('Invalid incoming chronology');
}
function easter(year: number): Date {
  const a = year % 19; const b = Math.floor(year / 100); const c = year % 100; const d = Math.floor(b / 4); const e = b % 4;
  const f = Math.floor((b + 8) / 25); const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7; const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  const result = new Date(0); result.setUTCFullYear(year, Math.floor(n / 31) - 1, n % 31 + 1); result.setUTCHours(0,0,0,0); return result;
}
/** Exact source Danish date/holiday semantics, not elapsed-hour approximations. */
export function businessDaysElapsed(start: string, end: string): number {
  try { instant(start); instant(end); } catch { return 0; }
  if (Date.parse(end) < Date.parse(start)) return 0;
  const first = copenhagenDate(start); const last = copenhagenDate(end); const day = new Date(`${first}T00:00:00Z`);
  const elapsed = Math.round((Date.parse(`${last}T00:00:00Z`) - day.getTime()) / 86400_000);
  let count = Math.floor(elapsed / 7) * 5;
  for (let offset = 1; offset <= elapsed % 7; offset++) if (![0,6].includes((day.getUTCDay() + offset) % 7)) count++;
  const holidays = new Set<string>();
  for (let year = day.getUTCFullYear(); year <= Number(last.slice(0, 4)); year++) {
    for (const suffix of ['01-01','12-25','12-26']) holidays.add(`${String(year).padStart(4,'0')}-${suffix}`);
    const base = easter(year).getTime();
    for (const offset of [-3,-2,0,1,39,49,50]) holidays.add(new Date(base + offset * 86400_000).toISOString().slice(0, 10));
  }
  for (const holiday of holidays) if (holiday > first && holiday <= last && ![0,6].includes(new Date(`${holiday}T00:00:00Z`).getUTCDay())) count--;
  return count;
}
export function classifyGmailThread(thread: Thread, now: string): Waiting | null {
  instant(now); validateThread(thread);
  if (thread.excludedCategory || !thread.senderIsHuman || ['resolved','none'].includes(thread.semanticState)) return null;
  const hours = (Date.parse(now) - Date.parse(thread.latestMessageAt)) / 3600000;
  if (thread.latestDirection === 'incoming' && ['new_question','direct_request','ambiguous'].includes(thread.semanticState)) {
    return hours >= 24 ? { thread, bucket: 'waiting_for_you', label: thread.semanticState === 'ambiguous' ? 'Review' : `${Math.floor(hours)}h` } : null;
  }
  if (!['awaiting_reply','deferral'].includes(thread.semanticState)) return null;
  const since = thread.semanticState === 'deferral' ? thread.waitingSince || thread.latestMessageAt : thread.waitingSince || thread.sentRequestAt;
  if (!since) return null;
  const days = businessDaysElapsed(since, now);
  return days >= 3 ? { thread, bucket: 'waiting_on_others', label: `${days} business days` } : null;
}

export interface Order { id: string; company: string; orderNumber: string | null; status: string; statusLabel: string | null; deliveryDetail: string | null; updatedAt: string }
export function validateOrder(order: Order): void {
  text(order.id); text(order.company,300); instant(order.updatedAt); text(order.status,256);
  if (!['received','processing','shipped','ready_for_pickup','delayed','delivered','collected','completed','cancelled','refunded','unknown'].includes(order.status.trim().toLowerCase())) throw new TypeError('Invalid order status');
  for (const [value,max] of [[order.orderNumber,200],[order.statusLabel,120],[order.deliveryDetail,300]] as const) if (value !== null && (typeof value !== 'string' || value.length > max)) throw new TypeError('Invalid order field');
  if (Object.keys(order).some((key) => !['id','company','orderNumber','status','statusLabel','deliveryDetail','updatedAt','type','title'].includes(key))) throw new TypeError('Invalid order DTO');
}
export function orderMerchantKey(value: string): string {
  return value.toLowerCase().replace(/\([^)]*@[^)]*\)/gu, ' ').replace(/\bwww\./gu, '')
    .replace(/\.(?:com|dk|se|no|de|eu)\b/gu, ' ').replace(/\b(?:a\/?s|aps|ab|ltd|limited|inc)\b/gu, ' ').replace(/[^a-z0-9]+/gu, ' ').trim();
}
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim();
export function orderIdentityKey(order: Order): string {
  const merchant = orderMerchantKey(order.company);
  const number = normalize(order.orderNumber || ''); const delivery = normalize(order.deliveryDetail || '');
  return merchant && number ? `${merchant}:${number}` : merchant && delivery ? `${merchant}:${delivery}` : '';
}
export const terminalOrders = new Set(['received','delivered','collected','completed','cancelled','refunded']);
/** Preserve source IDs separately from consumer suppression keys. */
export function mergeOrders(orders: readonly Order[], suppressed: ReadonlySet<string> = new Set()): Order[] {
  if (orders.length > 1000) throw new TypeError('Order range exceeds limits');
  const merged: Order[] = [];
  for (const input of orders) {
    validateOrder(input);
    const order = structuredClone(input); const merchant = orderMerchantKey(order.company);
    const index = merged.findIndex((existing) => Boolean(merchant) && orderMerchantKey(existing.company) === merchant &&
      (Boolean(existing.orderNumber?.trim() && order.orderNumber?.trim()) && existing.orderNumber!.trim().toLowerCase() === order.orderNumber!.trim().toLowerCase() ||
       Boolean(normalize(existing.deliveryDetail || '')) && normalize(existing.deliveryDetail || '') === normalize(order.deliveryDetail || '')));
    if (index < 0) merged.push(order);
    else {
      const old = merged[index]!;
      if (Date.parse(order.updatedAt) >= Date.parse(old.updatedAt)) merged[index] = { ...order, deliveryDetail: order.deliveryDetail || old.deliveryDetail };
      else if (!old.deliveryDetail && order.deliveryDetail) old.deliveryDetail = order.deliveryDetail;
    }
  }
  return merged.filter((order) => !terminalOrders.has(order.status.trim().toLowerCase()) && (!suppressed.size || !suppressed.has(orderIdentityKey(order))));
}
export function threadRevives(thread: Thread, saved: { messageId: string; incomingAt: string | null }): boolean {
  return thread.latestIncomingAt !== null && thread.latestMessageId !== saved.messageId &&
    (saved.incomingAt === null || Date.parse(thread.latestIncomingAt) > Date.parse(saved.incomingAt));
}
