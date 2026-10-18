import type { GoogleApiClient } from '../../google/api-client.js';
import { gmailHeaders } from '../../google/tools.js';
import type { ProactiveSource, SourceContext, SourceFact, SourceResult } from '../types.js';
import { cleanSourceText, observedAtOrEpoch, sourceFailureReason, sourceSignal } from './shared.js';

const MAX_MESSAGES = 15;
const MESSAGE_CONCURRENCY = 5;
const METADATA_HEADERS = ['From', 'Subject', 'Date', 'List-Unsubscribe', 'Precedence'] as const;

interface MailFactData {
  sender: string;
  subject: string;
  observedAt: string;
}

function decodeHeaderWords(value: string): string {
  return value.replace(/=\?([^?\s]+)\?([bq])\?([^?]*)\?=/giu, (word, charset: string, encoding: string, data: string) => {
    try {
      let bytes: Buffer;
      if (encoding.toLowerCase() === 'b') {
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(data)) return word;
        bytes = Buffer.from(data, 'base64');
      } else {
        const decoded = data.replace(/_/gu, ' ').replace(/=([A-Fa-f0-9]{2})/gu, (_, hex: string) =>
          String.fromCharCode(Number.parseInt(hex, 16)));
        bytes = Buffer.from(decoded, 'latin1');
      }
      return new TextDecoder(charset, { fatal: true }).decode(bytes);
    } catch {
      return word;
    }
  });
}

function senderName(value: string): string | undefined {
  const match = /^(.*?)\s*<([^<>]+)>$/u.exec(value.trim());
  const address = (match?.[2] ?? value).trim();
  const at = address.lastIndexOf('@');
  if (at <= 0 || at === address.length - 1 || /[\s<>]/u.test(address)) return undefined;
  const domain = address.slice(at + 1);
  const display = match?.[1] ? decodeHeaderWords(match[1]).replace(/^["']|["']$/gu, '').trim() : '';
  const withoutAddresses = display.replace(/\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\b/giu, '').trim();
  return cleanSourceText(withoutAddresses || domain, 120) || cleanSourceText(domain, 120);
}

function messageFact(payload: Record<string, unknown>): MailFactData | undefined {
  const headers = gmailHeaders(payload);
  if (headers['list-unsubscribe']?.trim() ||
      /^(?:bulk|list|junk)$/iu.test(headers.precedence?.trim() ?? '')) return undefined;
  const sender = senderName(headers.from ?? '');
  const timestamp = Date.parse(headers.date ?? '');
  if (!sender || !Number.isFinite(timestamp)) return undefined;
  return {
    sender,
    subject: cleanSourceText(decodeHeaderWords(headers.subject ?? '(no subject)')),
    observedAt: new Date(timestamp).toISOString(),
  };
}

async function readMessage(
  google: GoogleApiClient,
  id: string,
  signal: AbortSignal,
): Promise<MailFactData | undefined> {
  const query = new URLSearchParams({ format: 'metadata' });
  for (const header of METADATA_HEADERS) query.append('metadataHeaders', header);
  query.set('fields', 'id,payload(headers(name,value))');
  const payload = await google.request(
    'gmail',
    `/users/me/messages/${encodeURIComponent(id)}?${query}`,
    { method: 'GET', signal },
  );
  return messageFact(payload);
}

export function createMailSource(google?: GoogleApiClient): ProactiveSource {
  return {
    id: 'mail',
    label: 'Mail',
    async read(context: SourceContext): Promise<SourceResult> {
      const observedAt = observedAtOrEpoch(context.now);
      if (!google) return { source: 'mail', state: 'unavailable', reason: 'not_connected', facts: [], observedAt };
      const signal = sourceSignal(context.signal);
      try {
        const query = new URLSearchParams({
          q: 'in:inbox is:unread category:primary newer_than:2d',
          maxResults: String(MAX_MESSAGES),
          fields: 'messages(id)',
        });
        const listing = await google.request('gmail', `/users/me/messages?${query}`, { method: 'GET', signal });
        const items = Array.isArray(listing.messages) ? listing.messages.slice(0, MAX_MESSAGES) : [];
        if (listing.messages !== undefined && !Array.isArray(listing.messages)) throw new TypeError('Invalid Gmail response');
        const ids = items.map((item) => {
          const message = item !== null && typeof item === 'object' && !Array.isArray(item)
            ? item as Record<string, unknown>
            : undefined;
          return typeof message?.id === 'string' && message.id.length > 0 && message.id.length <= 512
            ? message.id
            : undefined;
        });
        const facts: SourceFact[] = [];
        let failures = ids.filter((id) => !id).length;
        let fatalReason: string | undefined;
        for (let offset = 0; offset < ids.length; offset += MESSAGE_CONCURRENCY) {
          const batch = await Promise.all(ids.slice(offset, offset + MESSAGE_CONCURRENCY).map(async (id) => {
            if (!id) return undefined;
            try {
              return await readMessage(google, id, signal);
            } catch (error) {
              failures += 1;
              const reason = sourceFailureReason(error, signal);
              if (reason !== 'read_failed') fatalReason ??= reason;
              return undefined;
            }
          }));
          for (const fact of batch) {
            if (!fact) continue;
            facts.push({
              ref: `mail:${facts.length + 1}`,
              kind: 'mail',
              label: 'Mail',
              text: cleanSourceText(`From ${fact.sender} | ${fact.subject}`),
              observedAt: fact.observedAt,
            });
          }
          if (fatalReason) break;
        }
        if (fatalReason) {
          return { source: 'mail', state: 'unavailable', reason: fatalReason, facts: [], observedAt };
        }
        if (ids.length > 0 && failures > ids.length / 2) {
          return { source: 'mail', state: 'unavailable', reason: 'read_failed', facts: [], observedAt };
        }
        return { source: 'mail', state: 'ok', reason: null, facts, observedAt };
      } catch (error) {
        return {
          source: 'mail',
          state: 'unavailable',
          reason: sourceFailureReason(error, signal),
          facts: [],
          observedAt,
        };
      }
    },
  };
}
