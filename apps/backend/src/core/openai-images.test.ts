import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { createOpenAIImageGenerator } from './openai-images.js';
const model = 'gpt-image-2.6-sunburst';
const signal = () => new AbortController().signal;
async function png() { return sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).png().toBuffer(); }
function fixture(response: Response) {
  const fetcher = vi.fn(async () => response);
  const logger = { warn: vi.fn() };
  return { fetcher, logger, generator: createOpenAIImageGenerator({ model, getApiKey: async () => 'test-key', fetcher, logger }) };
}
describe('OpenAI Images API', () => {
  it('calls the documented 2.6 Images endpoint once and decodes a real PNG', async () => {
    const bytes = await png(); const s = fixture(Response.json({ data: [{ b64_json: bytes.toString('base64') }] }));
    await expect(s.generator.generate('a widget', signal())).resolves.toEqual({ contentType: 'image/png', bytes });
    expect(s.fetcher).toHaveBeenCalledWith('https://api.openai.com/v1/images/generations', expect.objectContaining({
      method: 'POST', redirect: 'error', body: JSON.stringify({ model, prompt: 'a widget', n: 1, size: 'auto', quality: 'medium', output_format: 'png' }),
    }));
    expect(s.fetcher).toHaveBeenCalledOnce();
  });
  it.each([[401, 'credential'], [403, 'access'], [429, 'quota'], [404, 'unavailable'], [400, 'rejected'], [500, 'failed']] as const)(
    'classifies HTTP %s without leaking its body or retrying', async (status, reason) => {
      const s = fixture(new Response('private upstream body', { status }));
      await expect(s.generator.generate('private prompt', signal())).rejects.toThrow(reason);
      expect(s.fetcher).toHaveBeenCalledOnce();
      expect(JSON.stringify(s.logger.warn.mock.calls)).not.toMatch(/private|test-key/);
    });
  it.each([{}, { data: [] }, { data: [{ url: 'https://untrusted/image.png' }] }, { data: [{ b64_json: 'invalid' }] },
    { data: [{ b64_json: Buffer.from('not a PNG').toString('base64') }] }])('rejects malformed image data', async body => {
      const s = fixture(Response.json(body));
      await expect(s.generator.generate('image', signal())).rejects.toThrow('valid image');
    });
  it('bounds response bytes and cancels the body', async () => {
    const cancel = vi.fn();
    const s = fixture(new Response(new ReadableStream({ cancel }), { headers: { 'content-length': '100000000' } }));
    await expect(s.generator.generate('image', signal())).rejects.toThrow('valid image');
    expect(cancel).toHaveBeenCalled();
  });
  it('does not call OpenAI when the key is missing or unavailable', async () => {
    const fetcher = vi.fn();
    for (const getApiKey of [async () => undefined, async (): Promise<string> => { throw new Error('private key vault error'); }]) {
      const generator = createOpenAIImageGenerator({ model, fetcher, getApiKey });
      await expect(generator.generate('image', signal())).rejects.toThrow('credential');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps an interrupted request uncertain and never retries it', async () => {
    const fetcher = vi.fn(async (): Promise<Response> => { throw new Error('socket'); });
    const generator = createOpenAIImageGenerator({ model, getApiKey: async () => 'test-key', fetcher });
    await expect(generator.generate('image', signal())).rejects.toThrow('result is unknown');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('stops reading on cancellation', async () => {
    const controller = new AbortController(); const cancel = vi.fn();
    const s = fixture(new Response(new ReadableStream({ cancel })));
    const pending = s.generator.generate('image', controller.signal);
    const assertion = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(s.fetcher).toHaveBeenCalled());
    controller.abort(); await assertion; expect(cancel).toHaveBeenCalled();
  });
});
