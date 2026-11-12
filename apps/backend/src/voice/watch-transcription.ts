import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import { createAzureSpeechConfig, createAzureSpeechEndpoint, SPEECH_AUTH_SCOPE } from './speech-recognizer.js';

export type WatchTranscriber = (audio: Buffer, signal: AbortSignal) => Promise<string>;

export function createAzureWatchTranscriber(
  runtimeEndpoint: string,
  getToken: (scope: string, signal: AbortSignal) => Promise<string>,
): WatchTranscriber {
  return async (audio, signal) => {
    signal.throwIfAborted();
    const tokenSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    const token = await new Promise<string>((resolve, reject) => {
      const finish = (error?: unknown, value?: string) => {
        tokenSignal.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(value ?? '');
      };
      const abort = () => finish(new Error('Speech authentication cancelled'));
      tokenSignal.addEventListener('abort', abort, { once: true });
      if (tokenSignal.aborted) abort();
      else void Promise.resolve().then(() => {
        tokenSignal.throwIfAborted();
        return getToken(SPEECH_AUTH_SCOPE, tokenSignal);
      }).then((value) => finish(undefined, value), (error: unknown) => finish(error ?? new Error('Speech authentication failed')));
    });
    tokenSignal.throwIfAborted();
    if (!token || token.length > 10_000 || /[\r\n]/u.test(token)) throw new Error('Speech authentication unavailable');

    const config = createAzureSpeechConfig(createAzureSpeechEndpoint(runtimeEndpoint), token);
    let stream: SpeechSDK.PushAudioInputStream | undefined;
    let audioConfig: SpeechSDK.AudioConfig | undefined;
    let recognizer: SpeechSDK.SpeechRecognizer | undefined;
    try {
      config.setProperty(SpeechSDK.PropertyId.SpeechServiceConnection_LanguageIdMode, 'Continuous');
      config.setProperty(SpeechSDK.PropertyId.Recognizer_StopTimeoutMs, '2000');
      stream = SpeechSDK.AudioInputStream.createPushStream(
        SpeechSDK.AudioStreamFormat.getWaveFormatPCM(24_000, 16, 1),
      );
      const inputStream = stream;
      audioConfig = SpeechSDK.AudioConfig.fromStreamInput(stream);
      const languages = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(['da-DK', 'en-GB']);
      recognizer = SpeechSDK.SpeechRecognizer.FromConfig(config, languages, audioConfig);
      const activeRecognizer = recognizer;
      return await new Promise<string>((resolve, reject) => {
        const segments: string[] = [];
        let settled = false;
        let endOfStream = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', abort);
          if (error) reject(error);
          else resolve(segments.join(' '));
        };
        const abort = () => finish(new Error('Speech recognition cancelled'));
        signal.addEventListener('abort', abort, { once: true });
        activeRecognizer.recognized = (_sender, event) => {
          if (event.result.reason === SpeechSDK.ResultReason.RecognizedSpeech && event.result.text.trim()) {
            segments.push(event.result.text.trim());
          }
        };
        activeRecognizer.canceled = (_sender, event) => {
          if (event.reason === SpeechSDK.CancellationReason.EndOfStream) {
            endOfStream = true;
          } else {
            finish(new Error('Speech recognition failed'));
          }
        };
        activeRecognizer.sessionStopped = () => finish(endOfStream ? undefined : new Error('Speech recognition ended early'));
        if (signal.aborted) {
          abort();
          return;
        }
        try {
          activeRecognizer.startContinuousRecognitionAsync(() => {
            if (settled) return;
            try {
              inputStream.write(Uint8Array.from(audio).buffer);
              inputStream.close();
            } catch {
              finish(new Error('Speech audio input failed'));
            }
          }, () => finish(new Error('Speech recognition could not start')));
        } catch {
          finish(new Error('Speech recognition could not start'));
        }
      });
    } finally {
      try { stream?.close(); } catch { /* Already closed or failed. */ }
      if (recognizer) {
        try { recognizer.stopContinuousRecognitionAsync(() => {}, () => {}); } catch { /* Close still required. */ }
        try { recognizer.close(() => {}, () => {}); } catch { /* Cleanup is best effort. */ }
      }
      try { audioConfig?.close(); } catch { /* Cleanup is best effort. */ }
      try { config.close(); } catch { /* Cleanup is best effort. */ }
    }
  };
}
