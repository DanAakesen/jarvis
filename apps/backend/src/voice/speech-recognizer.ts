import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';

export const SPEECH_AUTH_SCOPE = 'https://cognitiveservices.azure.com/.default';
export const VOICE_PHRASE_HINTS = [
  'Jarvis',
  'Google',
  'København',
  'Chrome',
  'GitHub',
  'Copilot',
  'Codex',
  'Teams',
] as const;

const MAX_PHRASE_HINTS = 32;
const MAX_PHRASE_LENGTH = 64;
const MAX_TOKEN_LENGTH = 10_000;

export interface PartialSpeechRecognizer {
  write(audio: Uint8Array): void;
  stop(): Promise<void>;
}

export interface PartialSpeechRecognizerOptions {
  readonly language: 'da' | 'en';
  readonly phraseHints: readonly string[];
  readonly onRecognizing: (text: string) => void;
  readonly onFailure: () => void;
}

export type PartialSpeechRecognizerFactory = (
  options: PartialSpeechRecognizerOptions,
  signal: AbortSignal,
) => Promise<PartialSpeechRecognizer>;

export function createAzureSpeechEndpoint(runtimeEndpoint: string): URL {
  let resource: URL;
  try {
    resource = new URL(runtimeEndpoint);
  } catch {
    throw new TypeError('Foundry runtime endpoint must be a valid URL');
  }
  if (resource.protocol !== 'https:' || resource.port ||
      !resource.hostname.endsWith('.cognitiveservices.azure.com') ||
      !/^\/api\/projects\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(resource.pathname) ||
      resource.username || resource.password || resource.search || resource.hash) {
    throw new TypeError('Foundry runtime endpoint must be a secure Azure AI resource URL');
  }
  return new URL(`wss://${resource.hostname}/speech/universal/v2`);
}

function safePhraseHints(phrases: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const phrase of phrases) {
    const normalized = phrase.trim();
    if (normalized.length > 0 && normalized.length <= MAX_PHRASE_LENGTH &&
        ![...normalized].some((character) => {
          const code = character.codePointAt(0) ?? 0;
          return code < 0x20 || (code >= 0x7f && code <= 0x9f);
        })) {
      unique.add(normalized);
    }
    if (unique.size >= MAX_PHRASE_HINTS) break;
  }
  return [...unique];
}

function stopRecognizer(recognizer: SpeechSDK.SpeechRecognizer): Promise<void> {
  return new Promise((resolve) => {
    recognizer.stopContinuousRecognitionAsync(resolve, () => resolve());
  });
}

function startRecognizer(recognizer: SpeechSDK.SpeechRecognizer, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', abort);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      void stopRecognizer(recognizer).finally(() => {
        recognizer.close();
        reject(signal.reason ?? new Error('Speech recognition stopped'));
      });
    };
    signal.addEventListener('abort', abort, { once: true });
    recognizer.startContinuousRecognitionAsync(
      () => finish(),
      () => finish(new Error('Speech recognition could not start')),
    );
    if (signal.aborted) abort();
  });
}

export function createAzureSpeechPartialRecognizerFactory(
  runtimeEndpoint: string,
  getToken: (scope: string, signal: AbortSignal) => Promise<string>,
): PartialSpeechRecognizerFactory {
  const endpoint = createAzureSpeechEndpoint(runtimeEndpoint);
  return async ({ language, phraseHints, onRecognizing, onFailure }, signal) => {
    const token = await getToken(SPEECH_AUTH_SCOPE, AbortSignal.any([signal, AbortSignal.timeout(10_000)]));
    if (!token || token.length > MAX_TOKEN_LENGTH || /[\r\n]/u.test(token)) {
      throw new Error('Speech authentication unavailable');
    }
    if (signal.aborted) throw signal.reason;

    const speechConfig = SpeechSDK.SpeechConfig.fromEndpoint(endpoint, '');
    speechConfig.authorizationToken = token;
    speechConfig.speechRecognitionLanguage = language === 'da' ? 'da-DK' : 'en-GB';
    const streamFormat = SpeechSDK.AudioStreamFormat.getWaveFormatPCM(24_000, 16, 1);
    const inputStream = SpeechSDK.AudioInputStream.createPushStream(streamFormat);
    const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(inputStream);
    const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
    SpeechSDK.PhraseListGrammar.fromRecognizer(recognizer).addPhrases(safePhraseHints(phraseHints));
    recognizer.recognizing = (_sender, event) => {
      const text = event.result.text;
      if (typeof text === 'string' && text.trim()) onRecognizing(text.trim());
    };
    recognizer.canceled = () => onFailure();

    try {
      await startRecognizer(recognizer, signal);
      if (signal.aborted) {
        await stopRecognizer(recognizer);
        recognizer.close();
        inputStream.close();
        throw signal.reason;
      }
    } catch (error) {
      recognizer.close();
      inputStream.close();
      throw error;
    }

    let stopPromise: Promise<void> | undefined;
    return {
      write(audio) {
        if (!stopPromise && audio.byteLength > 0 && audio.byteLength % 2 === 0) {
          inputStream.write(Uint8Array.from(audio).buffer);
        }
      },
      stop() {
        if (!stopPromise) {
          inputStream.close();
          stopPromise = stopRecognizer(recognizer).finally(() => recognizer.close());
        }
        return stopPromise;
      },
    };
  };
}
