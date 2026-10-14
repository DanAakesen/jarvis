import { describe, expect, it, vi } from 'vitest';
import { gmailMessageContent } from './message-content.js';
import { GoogleApiError } from './api-client.js';

const signal = () => new AbortController().signal;
const encoded = (text: string) => Buffer.from(text).toString('base64url');
const part = (mimeType: string, text: string) => ({ mimeType, body: { data: encoded(text) } });

describe('direct Gmail message content', () => {
  it('reads reservation dates from HTML without loading remote content', async () => {
    const request = vi.fn();
    const content = await gmailMessageContent({ request }, 'message-1', {
      snippet: 'Your booking is confirmed',
      payload: { mimeType: 'multipart/alternative', parts: [part('text/html',
        '<style>hidden</style><script>openGmail()</script><p>Check-in: 14 October 2026</p><p>Check-out: 17 October 2026 &amp; breakfast</p><img src="https://example.com/track">')] },
    }, signal());
    expect(content).toMatchObject({ bodySource: 'html-text', bodyTruncated: false, contentWarnings: [] });
    expect(content.body).toBe('Check-in: 14 October 2026 Check-out: 17 October 2026 & breakfast');
    expect(request).not.toHaveBeenCalled();
  });

  it('retains reservation details from nested HTML when plain text is only an introduction', async () => {
    const request = vi.fn();
    const content = await gmailMessageContent({ request }, 'reservation', {
      payload: { mimeType: 'multipart/mixed', parts: [{ mimeType: 'multipart/alternative', parts: [
        part('text/plain', 'Thank you for your reservation.'),
        part('text/html', `<div style="display:none">${'&#8203;&nbsp;'.repeat(8000)}</div>
          <p>Thank you for your reservation.</p><table><tr><td>Hotel</td><td>Copenhagen Marriott</td></tr>
          <tr><td>Check-in</td><td>14 October 2026, 15:00</td></tr>
          <tr><td>Check-out</td><td>17 October 2026, 11:00</td></tr></table>`),
      ] }] },
    }, signal());
    expect(content).toMatchObject({ bodySource: 'plain-text', body: 'Thank you for your reservation.',
      bodyTruncated: false, alternateBodyTruncated: false, contentWarnings: [] });
    expect(content.alternateBody).toContain('Copenhagen Marriott');
    expect(content.alternateBody).toContain('Check-in 14 October 2026, 15:00');
    expect(content.alternateBody).toContain('Check-out 17 October 2026, 11:00');
    expect(request).not.toHaveBeenCalled();
  });

  it('removes invisible padding before applying the body limit', async () => {
    const content = await gmailMessageContent({ request: vi.fn() }, 'm', {
      payload: part('text/html', `<div hidden>Invisible preheader</div><div style="visibility: hidden !important">Tracking</div>
        <p>${'&#8203;&#847;'.repeat(8000)}Check-in: 14 October; Check-out: 17 October</p>`),
    }, signal());
    expect(content).toMatchObject({ body: 'Check-in: 14 October; Check-out: 17 October', bodySource: 'html-text',
      bodyTruncated: false, contentWarnings: [] });
  });

  it('prefers plain text in multipart alternatives', async () => {
    const content = await gmailMessageContent({ request: vi.fn() }, 'm', {
      payload: { mimeType: 'multipart/alternative', parts: [part('text/html', '<p>Alternative</p>'), part('text/plain', 'Booking dates')] },
    }, signal());
    expect(content).toMatchObject({ body: 'Booking dates', bodySource: 'plain-text', alternateBody: 'Alternative', alternateBodyTruncated: false });
  });

  it('retrieves externalized text bodies only through the Gmail API', async () => {
    const request = vi.fn(async () => ({ data: encoded('Check-in 2026-10-14'), size: 19 }));
    expect(await gmailMessageContent({ request }, 'm/id', {
      payload: { mimeType: 'text/plain', body: { attachmentId: 'a/id', size: 19 } },
    }, signal())).toMatchObject({ body: 'Check-in 2026-10-14', bodySource: 'plain-text' });
    expect(request).toHaveBeenCalledExactlyOnceWith('gmail', '/users/me/messages/m%2Fid/attachments/a%2Fid', { signal: expect.any(AbortSignal) });
  });

  it.each(['forbidden', 'credentials-expired', 'unavailable'] as const)('propagates %s without an alternate access path', async (kind) => {
    const request = vi.fn(async () => { throw new GoogleApiError(kind); });
    await expect(gmailMessageContent({ request }, 'm', {
      payload: { mimeType: 'text/html', body: { attachmentId: 'a' } },
    }, signal())).rejects.toMatchObject({ kind });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, { mimeType: 'application/pkcs7-mime' }, part('text/plain', '')])('labels incomplete content instead of presenting a preview as full text', async (payload) => {
    const content = await gmailMessageContent({ request: vi.fn() }, 'm', { payload, snippet: 'Booking confirmed' }, signal());
    expect(content).toMatchObject({ body: 'Booking confirmed', bodySource: 'snippet' });
    expect(content.contentWarnings.join(' ')).toContain('Full message text is unavailable');
  });

  it('reports attachments and truncation explicitly', async () => {
    const content = await gmailMessageContent({ request: vi.fn() }, 'm', {
      payload: { mimeType: 'multipart/mixed', parts: [part('text/plain', 'x'.repeat(6001)), { filename: 'reservation.pdf', mimeType: 'application/pdf', body: { attachmentId: 'a' } }] },
    }, signal());
    expect(content.body).toHaveLength(6000);
    expect(content.bodyTruncated).toBe(true);
    expect(content.contentWarnings).toHaveLength(2);
  });

  it('bounds MIME traversal and externalized text requests', async () => {
    const request = vi.fn(async () => ({ data: encoded('text') }));
    const content = await gmailMessageContent({ request }, 'm', { payload: {
      mimeType: 'multipart/mixed', parts: Array.from({ length: 150 }, () => ({ mimeType: 'text/plain', body: { attachmentId: 'a' } })),
    } }, signal());
    expect(request).toHaveBeenCalledTimes(4);
    expect(content.contentWarnings.join(' ')).toContain('limit');
  });

  it('reports malformed encodings and missing bodies', async () => {
    const request = vi.fn();
    for (const data of ['!', 'a', '_w', undefined]) {
      const content = await gmailMessageContent({ request }, 'm', { payload: { mimeType: 'text/plain', body: { data } } }, signal());
      expect(content.bodySource).toBe('unavailable');
      expect(content.contentWarnings.length).toBeGreaterThan(0);
    }
    expect(request).not.toHaveBeenCalled();
  });
});


it('reports a declared unsupported charset even when its bytes happen to be ASCII', async () => {
  const content = await gmailMessageContent({ request: vi.fn() }, 'm', { payload: {
    ...part('text/plain', 'Booking'), headers: [{ name: 'Content-Type', value: 'text/plain; charset=iso-8859-1' }],
  } }, signal());
  expect(content.bodySource).toBe('unavailable');
  expect(content.contentWarnings.join(' ')).toContain('encoding is unsupported');
});
