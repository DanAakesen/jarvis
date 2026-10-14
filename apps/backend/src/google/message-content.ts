import { defaultTreeAdapter, parse, type DefaultTreeAdapterMap } from 'parse5';
import type { GoogleApiClient } from './api-client.js';

const maxBodyCharacters = 6000;
const maxEncodedCharacters = 1_000_000;

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** Static text only: no script execution, browser, links, images or remote resources. */
function htmlText(html: string): string {
  const stack: DefaultTreeAdapterMap['node'][] = [parse(html)];
  const text: string[] = [];
  while (stack.length) {
    const node = stack.pop()!;
    if (defaultTreeAdapter.isElementNode(node) &&
        ['head', 'script', 'style', 'template', 'noscript'].includes(node.tagName)) continue;
    if (defaultTreeAdapter.isTextNode(node)) text.push(node.value);
    if ('childNodes' in node) stack.push(...[...node.childNodes].reverse());
  }
  return text.join(' ').replace(/\s+/gu, ' ').trim();
}

export async function gmailMessageContent(
  google: GoogleApiClient,
  messageId: string,
  message: Record<string, unknown>,
  signal: AbortSignal,
) {
  const warnings = new Set<string>();
  const plain: string[] = [];
  const html: string[] = [];
  const stack: { value: unknown; depth: number }[] = [{ value: message.payload, depth: 0 }];
  let inspected = 0;
  let fetched = 0;
  while (stack.length) {
    signal.throwIfAborted();
    const entry = stack.pop()!;
    if (++inspected > 100 || entry.depth > 20) {
      warnings.add('MIME content exceeds the supported part or nesting limit.');
      break;
    }
    const part = object(entry.value);
    if (!part) { warnings.add('Message content is missing or malformed.'); continue; }
    if (typeof part.filename === 'string' && part.filename) {
      warnings.add('File attachments are not read; they may contain additional details.');
      continue;
    }
    if (Array.isArray(part.parts)) {
      if (part.parts.length > 100) warnings.add('MIME content exceeds the supported part limit.');
      stack.push(...part.parts.slice(0, 100).reverse().map((value) => ({ value, depth: entry.depth + 1 })));
    }
    if (typeof part.mimeType === 'string' && part.mimeType.startsWith('multipart/')) continue;
    if (part.mimeType !== 'text/plain' && part.mimeType !== 'text/html') {
      warnings.add('Non-text content (including images and encrypted content) is unsupported.');
      continue;
    }
    let body = object(part.body);
    if (body?.data === undefined && typeof body?.attachmentId === 'string' && body.attachmentId) {
      if (++fetched > 4 || typeof body.size === 'number' && body.size > 750_000) {
        warnings.add('Text-body retrieval exceeds the supported size or request limit.');
        continue;
      }
      body = await google.request('gmail',
        `/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(body.attachmentId)}`,
        { signal });
    }
    const data = body?.data;
    if (typeof data !== 'string' || data.length > maxEncodedCharacters ||
        !/^[A-Za-z0-9_-]*={0,2}$/u.test(data) || data.replace(/=+$/u, '').length % 4 === 1) {
      warnings.add('Text-body data is missing, malformed or exceeds the supported size.');
      continue;
    }
    let decoded: string;
    try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(data, 'base64url')); }
    catch { warnings.add('Text-body encoding is unsupported; only UTF-8 is supported.'); continue; }
    (part.mimeType === 'text/plain' ? plain : html).push(decoded);
  }
  const plainBody = plain.join('\n').trim();
  const htmlBody = html.length ? htmlText(html.join('\n')) : '';
  const source = plainBody ? 'plain-text' : htmlBody ? 'html-text' :
    typeof message.snippet === 'string' && message.snippet ? 'snippet' : 'unavailable';
  const text = plainBody || htmlBody || (typeof message.snippet === 'string' ? message.snippet : '');
  if (source === 'snippet' || source === 'unavailable') {
    warnings.add('Full message text is unavailable; a preview cannot establish missing reservation details.');
  }
  if (text.length > maxBodyCharacters) warnings.add('Message text is truncated at 6000 characters.');
  return {
    body: text.slice(0, maxBodyCharacters),
    bodySource: source,
    bodyTruncated: text.length > maxBodyCharacters,
    contentWarnings: [...warnings],
  };
}
