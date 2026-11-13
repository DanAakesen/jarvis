import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import { createAzureSpeechConfig, createAzureSpeechEndpoint, SPEECH_AUTH_SCOPE } from './speech-recognizer.js';

export type WatchTranscriptionStage = 'token_acquired' | 'recognizer_started' | 'audio_written' |
  'first_recognized' | 'recognizer_stopped' | 'recognizer_cancelled' | 'cleanup_started' | 'cleanup_finished';
export type WatchTranscriptionReason = 'end_of_stream' | 'provider_cancelled' | 'stop_awaiting_cancellation' | 'early_stop';
export type WatchTranscriber = (
  audio: Buffer, signal: AbortSignal, stage?: (stage: WatchTranscriptionStage, reason?: WatchTranscriptionReason) => void,
) => Promise<string>;

export function createAzureWatchTranscriber(
  runtimeEndpoint: string,
  getToken: (scope: string, signal: AbortSignal) => Promise<string>,
): WatchTranscriber {
  return async (audio, signal, stage = () => {}) => {
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
    stage('token_acquired');

    const config = createAzureSpeechConfig(createAzureSpeechEndpoint(runtimeEndpoint), token);
    let stream: SpeechSDK.PushAudioInputStream | undefined;
    let audioConfig: SpeechSDK.AudioConfig | undefined;
    let recognizer: SpeechSDK.SpeechRecognizer | undefined;
    try {
      config.speechRecognitionLanguage = 'en-GB';
      config.setProperty(SpeechSDK.PropertyId.Recognizer_StopTimeoutMs, '2000');
      // SDK 1.52.0 throttles buffered audio after 5s by default. Its internal,
      // intentionally misspelled property covers the bounded 60s clip; live service latency is unverified.
      config.setProperty('SPEECH-TransmitLengthBeforThrottleMs', '60000');
      stream = SpeechSDK.AudioInputStream.createPushStream(
        SpeechSDK.AudioStreamFormat.getWaveFormatPCM(24_000, 16, 1),
      );
      const inputStream = stream;
      audioConfig = SpeechSDK.AudioConfig.fromStreamInput(stream);
      recognizer = new SpeechSDK.SpeechRecognizer(config, audioConfig);
      const activeRecognizer = recognizer;
      return await new Promise<string>((resolve, reject) => {
        const segments: string[] = [];
        let settled = false;
        let audioWritten = false;
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
          if (settled) return;
          if (event.result.reason === SpeechSDK.ResultReason.RecognizedSpeech && event.result.text.trim()) {
            if (segments.length === 0) stage('first_recognized');
            segments.push(event.result.text.trim());
          }
        };
        activeRecognizer.canceled = (_sender, event) => {
          if (settled) return;
          stage('recognizer_cancelled', event.reason === SpeechSDK.CancellationReason.EndOfStream
            ? 'end_of_stream' : 'provider_cancelled');
          if (event.reason === SpeechSDK.CancellationReason.EndOfStream) {
            finish(audioWritten ? undefined : new Error('Speech recognition ended early'));
          } else {
            finish(new Error('Speech recognition failed'));
          }
        };
        activeRecognizer.sessionStopped = () => {
          if (settled) return;
          stage('recognizer_stopped', audioWritten ? 'stop_awaiting_cancellation' : 'early_stop');
          if (!audioWritten) finish(new Error('Speech recognition ended early'));
        };
        if (signal.aborted) {
          abort();
          return;
        }
        try {
          activeRecognizer.startContinuousRecognitionAsync(() => {
            if (settled) return;
            stage('recognizer_started');
            try {
              inputStream.write(Uint8Array.from(audio).buffer);
              inputStream.close();
              audioWritten = true;
              stage('audio_written');
            } catch {
              finish(new Error('Speech audio input failed'));
            }
          }, () => finish(new Error('Speech recognition could not start')));
        } catch {
          finish(new Error('Speech recognition could not start'));
        }
      });
    } finally {
      stage('cleanup_started');
      try { stream?.close(); } catch { /* Already closed or failed. */ }
      if (recognizer) {
        try { recognizer.stopContinuousRecognitionAsync(() => {}, () => {}); } catch { /* Close still required. */ }
        try { recognizer.close(() => {}, () => {}); } catch { /* Cleanup is best effort. */ }
      }
      try { audioConfig?.close(); } catch { /* Cleanup is best effort. */ }
      try { config.close(); } catch { /* Cleanup is best effort. */ }
      stage('cleanup_finished');
    }
  };
}
