import { describe, expect, it, vi } from 'vitest';
import { createAzureSpeechSynthesizer } from './speech.js';

describe('Azure Speech F0 synthesizer', () => {
  it('requests a managed-identity token and safely encodes bounded SSML', async () => {
    const getToken = vi.fn(async () => 'speech-token');
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const speech = createAzureSpeechSynthesizer('westeurope', getToken, fetcher);
    await expect(speech.synthesize('Use <Jarvis> & "Dan".')).resolves.toEqual(Buffer.from([1, 2, 3]));
    expect(getToken).toHaveBeenCalledWith('https://cognitiveservices.azure.com/.default', expect.any(AbortSignal));
    expect(fetcher).toHaveBeenCalledWith(
      'https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1',
      expect.objectContaining({
        redirect: 'error',
        body: expect.stringContaining('Use &lt;Jarvis&gt; &amp; &quot;Dan&quot;.'),
      }),
    );
  });

  it('never retries quota failures against a paid tier and rejects malformed text or oversized responses', async () => {
    const getToken = vi.fn(async () => 'token');
    const quota = createAzureSpeechSynthesizer('westeurope', getToken, vi.fn(async () =>
      new Response(null, { status: 429 })));
    await expect(quota.synthesize('A short message')).rejects.toThrow('Speech synthesis failed');
    await expect(quota.synthesize('')).resolves.toBeNull();

    const oversized = createAzureSpeechSynthesizer('westeurope', getToken, vi.fn(async () =>
      new Response(new Uint8Array(1_500_001), { status: 200 })));
    await expect(oversized.synthesize('A short message')).rejects.toThrow('Speech synthesis failed');
  });

  it('rejects non-region endpoint input', () => {
    expect(() => createAzureSpeechSynthesizer('https://example.com', async () => 'token'))
      .toThrow('Invalid Speech region');
  });
});
