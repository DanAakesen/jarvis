const speechScope = 'https://cognitiveservices.azure.com/.default';
const maxResponseBytes = 1_500_000;
const requestTimeoutMs = 12_000;

export interface SpeechSynthesizer {
  synthesize(text: string, signal?: AbortSignal): Promise<Uint8Array | null>;
}

function xmlText(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;')
    .split('')
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d || codePoint >= 0x20;
    })
    .join('');
}

async function responseBytes(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Speech synthesis failed');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Speech synthesis failed');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

export function createAzureSpeechSynthesizer(
  region: string,
  getToken: (scope: string, signal: AbortSignal) => Promise<string>,
  fetcher: typeof fetch = fetch,
): SpeechSynthesizer {
  if (!/^[a-z0-9-]{2,64}$/iu.test(region)) throw new TypeError('Invalid Speech region');
  const endpoint = `https://${region.toLowerCase()}.tts.speech.microsoft.com/cognitiveservices/v1`;
  return {
    async synthesize(text, signal) {
      if (typeof text !== 'string' || !text.trim() || text.length > 4000) return null;
      const requestSignal = AbortSignal.any([
        signal ?? new AbortController().signal,
        AbortSignal.timeout(requestTimeoutMs),
      ]);
      try {
        const token = await getToken(speechScope, requestSignal);
        if (!token || /[\r\n]/u.test(token)) return null;
        const response = await fetcher(endpoint, {
          method: 'POST',
          redirect: 'error',
          headers: {
            Authorization: ['Bearer', token].join(' '),
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
            'User-Agent': 'Jarvis-backend',
          },
          body: `<speak version="1.0" xml:lang="en-GB"><voice name="en-GB-RyanNeural">${xmlText(text)}</voice></speak>`,
          signal: requestSignal,
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw new Error('Speech synthesis failed');
        }
        return await responseBytes(response);
      } catch {
        throw new Error('Speech synthesis failed');
      }
    },
  };
}
