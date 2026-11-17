import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import { createAzureSpeechConfig, createAzureSpeechEndpoint, SPEECH_AUTH_SCOPE } from './speech-recognizer.js';

export type WatchTranscriptionStage = 'token_requested' | 'token_acquired' | 'recognizer_started' | 'audio_written' |
  'session_started' | 'speech_start_detected' | 'speech_end_detected' | 'first_recognizing' |
  'first_recognized' | 'recognizer_stopped' | 'recognizer_cancelled' | 'cleanup_started' | 'cleanup_finished' |
  'recognizer_starting' | 'recognizer_start_failed' | 'recognizer_start_timeout' | 'service_connected' | 'service_disconnected';
export type WatchTranscriptionReason = 'end_of_stream' | 'provider_cancelled' | 'stop_awaiting_cancellation' |
  'early_stop' | 'stop_grace_elapsed' | 'stop_without_result';
// Numeric SDK codes only; never provider text, which can echo request details.
export interface WatchTranscriptionDetail { readonly errorCode?: number }
export type WatchTranscriptionStageListener = (
  stage: WatchTranscriptionStage, reason?: WatchTranscriptionReason, detail?: WatchTranscriptionDetail,
) => void;
export type WatchTranscriber = (audio: Buffer, signal: AbortSignal, stage?: WatchTranscriptionStageListener) => Promise<string>;

// The SDK normally follows a stopped session with an end-of-stream cancellation within milliseconds.
const STOP_GRACE_MS = 2_000;
// A healthy start takes about a second. Without this bound a Speech connection that never opens holds the
// request until the client gives up, and nothing says where it stopped (17 Nov: no stage after audio_received).
const RECOGNIZER_START_MS = 6_000;

export function createAzureWatchTranscriber(
  runtimeEndpoint: string,
  getToken: (scope: string, signal: AbortSignal) => Promise<string>,
): WatchTranscriber {
  return async (audio, signal, stage = () => {}) => {
    signal.throwIfAborted();
    stage('token_requested');
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
      config.setProperty(SpeechSDK.PropertyId.Recognizer_StopTimeoutMs, '2000');
      // SDK 1.52.0 throttles buffered audio after 5s by default. Its internal,
      // intentionally misspelled property covers the bounded 60s clip; live service latency is unverified.
      config.setProperty('SPEECH-TransmitLengthBeforThrottleMs', '60000');
      stream = SpeechSDK.AudioInputStream.createPushStream(
        SpeechSDK.AudioStreamFormat.getWaveFormatPCM(24_000, 16, 1),
      );
      const inputStream = stream;
      audioConfig = SpeechSDK.AudioConfig.fromStreamInput(stream);
      // The universal v2 endpoint is only proven with language identification (the live partial recognizer, L111);
      // a fixed language never produced a session. Danish and English match the voice languages.
      const autoDetect = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(['da-DK', 'en-GB']);
      recognizer = SpeechSDK.SpeechRecognizer.FromConfig(config, autoDetect, audioConfig);
      const activeRecognizer = recognizer;
      return await new Promise<string>((resolve, reject) => {
        const segments: string[] = [];
        let settled = false;
        let audioWritten = false;
        let firstRecognizing = false;
        let stopGrace: ReturnType<typeof setTimeout> | undefined;
        let startTimer: ReturnType<typeof setTimeout> | undefined;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(stopGrace);
          clearTimeout(startTimer);
          signal.removeEventListener('abort', abort);
          if (error) reject(error);
          else resolve(segments.join(' '));
        };
        const abort = () => finish(new Error('Speech recognition cancelled'));
        signal.addEventListener('abort', abort, { once: true });
        try {
          const connection = SpeechSDK.Connection.fromRecognizer(activeRecognizer);
          connection.connected = () => { if (!settled) stage('service_connected'); };
          connection.disconnected = () => { if (!settled) stage('service_disconnected'); };
        } catch { /* Connection events are diagnostics only. */ }
        activeRecognizer.sessionStarted = () => { if (!settled) stage('session_started'); };
        activeRecognizer.speechStartDetected = () => { if (!settled) stage('speech_start_detected'); };
        activeRecognizer.speechEndDetected = () => { if (!settled) stage('speech_end_detected'); };
        activeRecognizer.recognizing = () => {
          if (settled || firstRecognizing) return;
          firstRecognizing = true;
          stage('first_recognizing');
        };
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
            ? 'end_of_stream' : 'provider_cancelled',
          typeof event.errorCode === 'number' ? { errorCode: event.errorCode } : undefined);
          if (event.reason === SpeechSDK.CancellationReason.EndOfStream) {
            finish(audioWritten ? undefined : new Error('Speech recognition ended early'));
          } else {
            finish(new Error('Speech recognition failed'));
          }
        };
        activeRecognizer.sessionStopped = () => {
          if (settled) return;
          stage('recognizer_stopped', audioWritten ? 'stop_awaiting_cancellation' : 'early_stop');
          if (!audioWritten) {
            finish(new Error('Speech recognition ended early'));
            return;
          }
          // A stop without the usual end-of-stream event would otherwise hold the request until the deadline.
          stopGrace ??= setTimeout(() => {
            if (settled) return;
            if (segments.length > 0) {
              stage('recognizer_stopped', 'stop_grace_elapsed');
              finish();
            } else {
              stage('recognizer_stopped', 'stop_without_result');
              finish(new Error('Speech recognition ended without a result'));
            }
          }, STOP_GRACE_MS);
        };
        if (signal.aborted) {
          abort();
          return;
        }
        try {
          stage('recognizer_starting');
          startTimer = setTimeout(() => {
            if (settled) return;
            stage('recognizer_start_timeout');
            finish(new Error('Speech recognition could not start'));
          }, RECOGNIZER_START_MS);
          activeRecognizer.startContinuousRecognitionAsync(() => {
            if (settled) return;
            clearTimeout(startTimer);
            stage('recognizer_started');
            try {
              inputStream.write(Uint8Array.from(audio).buffer);
              inputStream.close();
              audioWritten = true;
              stage('audio_written');
            } catch {
              finish(new Error('Speech audio input failed'));
            }
          }, () => {
            stage('recognizer_start_failed');
            finish(new Error('Speech recognition could not start'));
          });
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
