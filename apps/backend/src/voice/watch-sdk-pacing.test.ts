import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import { ServiceRecognizerBase } from 'microsoft-cognitiveservices-speech-sdk/distrib/lib/src/common.speech/ServiceRecognizerBase.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('installed Speech SDK buffered audio pacing', () => {
  afterEach(() => vi.useRealTimers());

  it('sends a 60-second PCM clip without pacing when configured with the SDK fast-lane property', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const config = SpeechSDK.SpeechConfig.fromEndpoint(new URL('wss://fixture.invalid/stt'));
    config.setProperty('SPEECH-TransmitLengthBeforThrottleMs', '60000');
    const stream = SpeechSDK.AudioInputStream.createPushStream(
      SpeechSDK.AudioStreamFormat.getWaveFormatPCM(24_000, 16, 1),
    );
    const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(stream);
    const recognizer = new SpeechSDK.SpeechRecognizer(config, audioConfig);
    const properties = recognizer.properties;
    expect(properties.getProperty('SPEECH-TransmitLengthBeforThrottleMs')).toBe('60000');

    const simulate = async (parameters: SpeechSDK.PropertyCollection) => {
      const session = {
        bytesSent: 0, isSpeechEnded: false, isRecognizing: true, recogNumber: 1, requestId: 'fixture',
        onAudioSent(bytes: number) { this.bytesSent += bytes; },
      };
      const send = vi.fn(async () => {});
      const delay = vi.fn(async () => {});
      const fakeService = {
        audioSource: { format: Promise.resolve({ avgBytesPerSec: 48_000 }) },
        privRecognizerConfig: { parameters }, privRequestSession: session,
        privIsDisposed: false, privIsLiveAudio: true,
        fetchConnection: async () => ({ send }), delay,
      };
      let chunks = 0;
      const input = {
        read: async () => ++chunks <= 600
          ? { buffer: new ArrayBuffer(4_800), isEnd: false }
          : { isEnd: true },
      };
      const sendAudio = (ServiceRecognizerBase.prototype as unknown as {
        sendAudio(this: typeof fakeService, source: typeof input): Promise<void>;
      }).sendAudio;
      await sendAudio.call(fakeService, input);
      return { session, send, delay };
    };

    try {
      const unpaced = await simulate(properties);
      expect(unpaced.session.bytesSent).toBe(2_880_000);
      expect(unpaced.send).toHaveBeenCalledTimes(601);
      expect(unpaced.delay).not.toHaveBeenCalled();

      const defaultConfig = SpeechSDK.SpeechConfig.fromEndpoint(new URL('wss://fixture.invalid/stt'));
      const defaultRecognizer = new SpeechSDK.SpeechRecognizer(defaultConfig, audioConfig);
      try {
        const paced = await simulate(defaultRecognizer.properties);
        expect(paced.delay).toHaveBeenCalled();
      } finally {
        defaultRecognizer.close();
        defaultConfig.close();
      }
    } finally {
      recognizer.close();
      stream.close();
      try { audioConfig.close(); } catch { /* The SDK push stream's turnOff is synchronous. */ }
      config.close();
    }
  });
});
