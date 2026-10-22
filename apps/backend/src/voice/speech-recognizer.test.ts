import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAzureSpeechConfig,
  createAzureSpeechEndpoint,
  createAzureSpeechPartialRecognizerFactory,
} from './speech-recognizer.js';

const endpoint = createAzureSpeechEndpoint(
  'https://jarvis-resource.cognitiveservices.azure.com/api/projects/jarvis',
);

afterEach(() => vi.restoreAllMocks());

describe('Azure Speech endpoint', () => {
  it('uses the custom subdomain universal Speech endpoint of the Foundry resource', () => {
    expect(createAzureSpeechEndpoint(
      'https://jarvis-resource.cognitiveservices.azure.com/api/projects/jarvis',
    ).href).toBe('wss://jarvis-resource.cognitiveservices.azure.com/stt/speech/universal/v2');
  });

  it.each([
    'http://jarvis-resource.cognitiveservices.azure.com/api/projects/jarvis',
    'https://example.com/api/projects/jarvis',
    'https://jarvis-resource.cognitiveservices.azure.com/api/projects/../secret',
    'https://credentials@jarvis-resource.cognitiveservices.azure.com/api/projects/jarvis',
    'https://jarvis-resource.cognitiveservices.azure.com/api/projects/jarvis?key=secret',
  ])('rejects an unsafe runtime endpoint', (endpoint) => {
    expect(() => createAzureSpeechEndpoint(endpoint)).toThrow(
      'Foundry runtime endpoint must be a secure Azure AI resource URL',
    );
  });
});

describe('Azure Speech configuration', () => {
  it.each([
    ['da', 'da-DK'],
    ['en', 'en-GB'],
  ] as const)('configures the real SDK for %s with token authentication', (language, locale) => {
    const token = 'fake-speech-token';
    const speechConfig = createAzureSpeechConfig(endpoint, token, language);

    expect(speechConfig.properties.getProperty(
      SpeechSDK.PropertyId.SpeechServiceConnection_Endpoint,
    )).toBe(endpoint.href);
    expect(speechConfig.authorizationToken).toBe(token);
    expect(speechConfig.speechRecognitionLanguage).toBe(locale);
  });

  it('forwards installed SDK recognizing events and ignores blank hypotheses', async () => {
    const phrase = 'Jarvis, pause task 12.';
    vi.spyOn(SpeechSDK.SpeechRecognizer.prototype, 'startContinuousRecognitionAsync')
      .mockImplementation(function (this: SpeechSDK.SpeechRecognizer, started) {
        const result = (text: string) => new SpeechSDK.SpeechRecognitionResult(
          'fake-result',
          SpeechSDK.ResultReason.RecognizingSpeech,
          text,
        );
        this.recognizing(this, new SpeechSDK.SpeechRecognitionEventArgs(result(phrase)));
        this.recognizing(this, new SpeechSDK.SpeechRecognitionEventArgs(result('   ')));
        this.canceled(this, new SpeechSDK.SpeechRecognitionCanceledEventArgs(
          SpeechSDK.CancellationReason.Error,
          'token expired',
          SpeechSDK.CancellationErrorCode.AuthenticationFailure,
        ));
        started?.();
      });
    vi.spyOn(SpeechSDK.SpeechRecognizer.prototype, 'stopContinuousRecognitionAsync')
      .mockImplementation((stopped) => stopped?.());

    const onRecognizing = vi.fn();
    const onFailure = vi.fn();
    const factory = createAzureSpeechPartialRecognizerFactory(
      'https://jarvis-resource.cognitiveservices.azure.com/api/projects/jarvis',
      async () => 'fake-speech-token',
    );
    const recognizer = await factory({
      language: 'en',
      phraseHints: [],
      onRecognizing,
      onFailure,
    }, new AbortController().signal);

    expect(onRecognizing).toHaveBeenCalledExactlyOnceWith(phrase);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith('Speech canceled: AuthenticationFailure: token expired');
    await recognizer.stop();
  });

  it('closes the real SDK recognizer when startup fails', async () => {
    const close = vi.spyOn(SpeechSDK.SpeechRecognizer.prototype, 'close');
    vi.spyOn(SpeechSDK.SpeechRecognizer.prototype, 'startContinuousRecognitionAsync')
      .mockImplementation((_started, failed) => failed?.('synthetic startup failure'));
    const factory = createAzureSpeechPartialRecognizerFactory(
      'https://jarvis-resource.cognitiveservices.azure.com/api/projects/jarvis',
      async () => 'fake-speech-token',
    );

    await expect(factory({
      language: 'da',
      phraseHints: [],
      onRecognizing: vi.fn(),
      onFailure: vi.fn(),
    }, new AbortController().signal)).rejects.toThrow('Speech recognition could not start: synthetic startup failure');
    expect(close).toHaveBeenCalledOnce();
  });

  it('stops and closes the real SDK recognizer when startup is aborted', async () => {
    const started = vi.spyOn(SpeechSDK.SpeechRecognizer.prototype, 'startContinuousRecognitionAsync')
      .mockImplementation(() => {});
    const stopped = vi.spyOn(SpeechSDK.SpeechRecognizer.prototype, 'stopContinuousRecognitionAsync')
      .mockImplementation((complete) => complete?.());
    const close = vi.spyOn(SpeechSDK.SpeechRecognizer.prototype, 'close');
    const factory = createAzureSpeechPartialRecognizerFactory(
      'https://jarvis-resource.cognitiveservices.azure.com/api/projects/jarvis',
      async () => 'fake-speech-token',
    );
    const controller = new AbortController();
    const creating = factory({
      language: 'en',
      phraseHints: [],
      onRecognizing: vi.fn(),
      onFailure: vi.fn(),
    }, controller.signal);

    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
    controller.abort(new Error('synthetic abort'));

    await expect(creating).rejects.toThrow('synthetic abort');
    expect(stopped).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
