import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => {
  const state = {
    recognizer: undefined as FakeRecognizer | undefined,
    config: undefined as { authorizationToken: string; speechRecognitionLanguage: string; setProperty: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } | undefined,
    stream: { write: vi.fn(), close: vi.fn() },
    audioConfig: { close: vi.fn() },
    startAutomatically: true,
  };
  class FakeRecognizer {
    recognized?: (_sender: unknown, event: { result: { reason: number; text: string } }) => void;
    canceled?: (_sender: unknown, event: { reason: number }) => void;
    sessionStopped?: () => void;
    startContinuousRecognitionAsync = vi.fn((success: () => void) => { if (state.startAutomatically) success(); });
    stopContinuousRecognitionAsync = vi.fn();
    close = vi.fn();
    constructor() { state.recognizer = this; }
  }
  return { state, FakeRecognizer };
});

vi.mock('microsoft-cognitiveservices-speech-sdk', () => ({
  SpeechConfig: { fromEndpoint: () => {
    sdk.state.config = { authorizationToken: '', speechRecognitionLanguage: '', setProperty: vi.fn(), close: vi.fn() };
    return sdk.state.config;
  } },
  PropertyId: { Recognizer_StopTimeoutMs: 1 },
  AudioStreamFormat: { getWaveFormatPCM: vi.fn() },
  AudioInputStream: { createPushStream: () => sdk.state.stream },
  AudioConfig: { fromStreamInput: () => sdk.state.audioConfig },
  SpeechRecognizer: sdk.FakeRecognizer,
  ResultReason: { RecognizedSpeech: 1 },
  CancellationReason: { EndOfStream: 1 },
}));

import { createAzureWatchTranscriber } from './watch-transcription.js';
import { SPEECH_AUTH_SCOPE } from './speech-recognizer.js';

const endpoint = 'https://fixture.cognitiveservices.azure.com/api/projects/test';

describe('Watch transcription', () => {
  beforeEach(() => {
    sdk.state.recognizer = undefined;
    sdk.state.config = undefined;
    sdk.state.startAutomatically = true;
    vi.clearAllMocks();
  });

  it('uses English continuous recognition and completes on end of stream without waiting for sessionStopped', async () => {
    const token = vi.fn(async () => 'private-token');
    const stages: string[] = [];
    const reasons: string[] = [];
    const promise = createAzureWatchTranscriber(endpoint, token)(Buffer.from([0, 0]), new AbortController().signal, (stage, reason) => {
      stages.push(stage);
      if (reason) reasons.push(reason);
    });
    await vi.waitFor(() => expect(sdk.state.recognizer).toBeDefined());
    const recognizer = sdk.state.recognizer!;
    expect(token).toHaveBeenCalledWith(SPEECH_AUTH_SCOPE, expect.any(AbortSignal));
    expect(sdk.state.config?.speechRecognitionLanguage).toBe('en-GB');
    expect(sdk.state.config?.setProperty).toHaveBeenCalledWith('SPEECH-TransmitLengthBeforThrottleMs', '60000');
    recognizer.recognized?.(null, { result: { reason: 1, text: ' private speech ' } });
    recognizer.recognized?.(null, { result: { reason: 1, text: ' next segment ' } });
    recognizer.canceled?.(null, { reason: 1 });
    await expect(promise).resolves.toBe('private speech next segment');
    expect(stages).toEqual(['token_acquired', 'recognizer_started', 'audio_written', 'first_recognized',
      'recognizer_cancelled', 'cleanup_started', 'cleanup_finished']);
    expect(reasons).toEqual(['end_of_stream']);
    expect(recognizer.stopContinuousRecognitionAsync).toHaveBeenCalledOnce();
    expect(recognizer.close).toHaveBeenCalledOnce();
    expect(sdk.state.audioConfig.close).toHaveBeenCalledOnce();
    expect(sdk.state.config?.close).toHaveBeenCalledOnce();
  });

  it('writes the entire maximum 60-second recording and retains all recognized segments', async () => {
    const audio = Buffer.alloc(2_880_000, 42);
    const promise = createAzureWatchTranscriber(endpoint, async () => 'token')(audio, new AbortController().signal);
    await vi.waitFor(() => expect(sdk.state.recognizer).toBeDefined());
    const recognizer = sdk.state.recognizer!;
    expect(recognizer.startContinuousRecognitionAsync).toHaveBeenCalledOnce();
    expect(sdk.state.stream.write).toHaveBeenCalledOnce();
    expect(Buffer.from(sdk.state.stream.write.mock.calls[0]![0] as ArrayBuffer).equals(audio)).toBe(true);
    recognizer.recognized?.(null, { result: { reason: 1, text: 'first segment' } });
    recognizer.recognized?.(null, { result: { reason: 1, text: 'last segment' } });
    recognizer.canceled?.(null, { reason: 1 });
    await expect(promise).resolves.toBe('first segment last segment');
  });

  it('aborts and cleans up when recognition never completes, without awaiting SDK callbacks', async () => {
    const controller = new AbortController();
    const promise = createAzureWatchTranscriber(endpoint, async () => 'token')(Buffer.from([0, 0]), controller.signal);
    await vi.waitFor(() => expect(sdk.state.recognizer).toBeDefined());
    const recognizer = sdk.state.recognizer!;
    controller.abort();
    await expect(promise).rejects.toThrow('Speech recognition cancelled');
    expect(recognizer.stopContinuousRecognitionAsync).toHaveBeenCalledOnce();
    expect(recognizer.close).toHaveBeenCalledOnce();
  });

  it('waits after sessionStopped for end of stream and preserves recognized segments', async () => {
    const stages: string[] = [];
    const transcribe = createAzureWatchTranscriber(endpoint, async () => 'token');
    const first = transcribe(Buffer.from([0, 0]), new AbortController().signal, (stage) => stages.push(stage));
    let settled = false;
    void first.then(() => { settled = true; }, () => { settled = true; });
    await vi.waitFor(() => expect(sdk.state.recognizer).toBeDefined());
    sdk.state.recognizer!.recognized?.(null, { result: { reason: 1, text: 'first segment' } });
    sdk.state.recognizer!.recognized?.(null, { result: { reason: 1, text: 'second segment' } });
    sdk.state.recognizer!.sessionStopped?.();
    await Promise.resolve();
    expect(settled).toBe(false);
    sdk.state.recognizer!.canceled?.(null, { reason: 1 });
    await expect(first).resolves.toBe('first segment second segment');
    expect(stages).toContain('recognizer_stopped');
  });

  it('fails rather than returning partial speech when provider cancellation follows sessionStopped', async () => {
    const stages: Array<[string, string | undefined]> = [];
    const promise = createAzureWatchTranscriber(endpoint, async () => 'token')(
      Buffer.from([0, 0]), new AbortController().signal, (stage, reason) => stages.push([stage, reason]),
    );
    await vi.waitFor(() => expect(sdk.state.recognizer).toBeDefined());
    const recognizer = sdk.state.recognizer!;
    recognizer.recognized?.(null, { result: { reason: 1, text: 'partial speech' } });
    recognizer.sessionStopped?.();
    await Promise.resolve();
    recognizer.canceled?.(null, { reason: 2 });
    await expect(promise).rejects.toThrow('Speech recognition failed');
    expect(stages).toContainEqual(['recognizer_stopped', 'stop_awaiting_cancellation']);
    expect(stages).toContainEqual(['recognizer_cancelled', 'provider_cancelled']);
  });

  it('aborts if sessionStopped is not followed by a cancellation', async () => {
    const controller = new AbortController();
    const promise = createAzureWatchTranscriber(endpoint, async () => 'token')(Buffer.from([0, 0]), controller.signal);
    await vi.waitFor(() => expect(sdk.state.recognizer).toBeDefined());
    sdk.state.recognizer!.sessionStopped?.();
    controller.abort();
    await expect(promise).rejects.toThrow('Speech recognition cancelled');
  });

  it('rejects a stopped session before audio is written', async () => {
    sdk.state.startAutomatically = false;
    const stages: Array<[string, string | undefined]> = [];
    const promise = createAzureWatchTranscriber(endpoint, async () => 'token')(
      Buffer.from([0, 0]), new AbortController().signal, (stage, reason) => stages.push([stage, reason]),
    );
    await vi.waitFor(() => expect(sdk.state.recognizer).toBeDefined());
    sdk.state.recognizer!.sessionStopped?.();
    await expect(promise).rejects.toThrow('Speech recognition ended early');
    expect(sdk.state.stream.write).not.toHaveBeenCalled();
    expect(stages).toContainEqual(['recognizer_stopped', 'early_stop']);
  });

  it('aborts token acquisition even when the credential provider never settles', async () => {
    const controller = new AbortController();
    const promise = createAzureWatchTranscriber(endpoint, () => new Promise(() => {}))(Buffer.from([0, 0]), controller.signal);
    controller.abort();
    await expect(promise).rejects.toThrow('Speech authentication cancelled');
    expect(sdk.state.recognizer).toBeUndefined();
  });
});
