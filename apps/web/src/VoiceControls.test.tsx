import type { PublicClientApplication } from '@azure/msal-browser';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '../config/public-config';
import { useJarvisActivity } from './activity-context';
import { JarvisActivityProvider } from './activity-provider';
import { VoiceStageContext } from './voice-stage-context';
import { VoiceControls } from './VoiceControls';
import { SessionCommandRegistryContext, applySessionCommand, createSessionCommandRegistry } from './session-commands';
import { publishVoiceWake, resetWakeForTests, useWakeStatus } from './wake-store';
import type { VisualResult } from './visual-context';
import { VisionInspectionError } from './screen-sharing';

const clients = vi.hoisted(() => ({
  instances: [] as Array<{
    options: unknown;
    client: {
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      setMuted: ReturnType<typeof vi.fn>;
      setCameraState: ReturnType<typeof vi.fn>;
      sendScreenContext: ReturnType<typeof vi.fn>;
      sendScreenContextUnavailable: ReturnType<typeof vi.fn>;
      retryMicrophone: ReturnType<typeof vi.fn>;
      playbackLevel: ReturnType<typeof vi.fn>;
      inputLevel: ReturnType<typeof vi.fn>;
    };
  }>,
}));

vi.mock('./voice-client', () => ({
  BrowserVoiceClient: class {
    readonly start = vi.fn();
    readonly setMuted = vi.fn();
    readonly setCameraState = vi.fn();
    readonly sendScreenContext = vi.fn();
    readonly sendScreenContextUnavailable = vi.fn();
    readonly retryMicrophone = vi.fn(async () => {});
    readonly playbackLevel = vi.fn(() => 0.4);
    readonly inputLevel = vi.fn(() => 0.2);
    readonly stop: ReturnType<typeof vi.fn>;

    constructor(options: unknown) {
      const onStatus = (options as {
        onStatus?: (status: 'stopped', message: string) => void;
        onSessionEnded?: () => void;
      }).onStatus;
      const onSessionEnded = (options as { onSessionEnded?: () => void }).onSessionEnded;
      this.stop = vi.fn(() => {
        onStatus?.('stopped', 'Voice is off.');
        onSessionEnded?.();
      });
      clients.instances.push({ options, client: this });
    }
  },
}));

const config = {
  backendUrl: 'https://api.example.com',
  apiScope: 'api://jarvis/.default',
} as PublicConfig;

function WorkingProbe() {
  const { working, applyRuntimeActivity } = useJarvisActivity();
  const activityId = '11111111-1111-4111-8111-111111111111';
  const publish = (type: 'thinking' | 'speaking' | 'listening') => applyRuntimeActivity({
    type, activityId, source: 'voice',
  });
  return (
    <>
      <output aria-label="Jarvis work state">{working ? 'working' : 'idle'}</output>
      <button type="button" onClick={() => publish('thinking')}>Publish thinking</button>
      <button type="button" onClick={() => publish('speaking')}>Publish speaking</button>
      <button type="button" onClick={() => publish('listening')}>Publish listening</button>
      <button type="button" onClick={() => applyRuntimeActivity({
        type: 'tool-call-started', activityId, source: 'voice', toolName: 'open_window',
      })}>Publish tool</button>
    </>
  );
}

type Options = {
  onStatus: (status: string, message: string) => void;
  onMicrophoneState: (state: string) => void;
  onSessionReady: (sessionId: string) => void;
  onVisionRequest: (source: 'camera' | 'screen', transcript: string, itemId?: string) => void;
  onVisionLimit: (limit: { itemId: string; code: 'frame_rate_limited' | 'daily_limit' | 'budget_exhausted' | 'budget_unavailable' }) => void;
  onVisualResult: (result: VisualResult & { itemId?: string }) => void;
  onVisualResultError: (itemId?: string) => void;
};

function startVoice() {
  fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
  const instance = clients.instances.at(-1);
  if (!instance) throw new Error('Voice client was not created.');
  const options = instance.options as Options;
  const listen = () => act(() => {
    options.onMicrophoneState('requesting');
    options.onMicrophoneState('granted');
    options.onMicrophoneState('live');
    options.onStatus('listening', 'Listening for your voice.');
  });
  return { instance, options, listen };
}

beforeEach(() => {
  clients.instances.length = 0;
});

describe('VoiceControls', () => {
  it('reports only matching voice visual-path evidence and ignores stale or uncorrelated results', async () => {
    const camera = { sharing: true, conversation: true, starting: false, inspecting: false, error: '',
      start: vi.fn(async () => {}), stop: vi.fn(), inspect: vi.fn(), inspectTurn: vi.fn(async () => ({
        source: 'camera' as const, capturedAt: '2026-10-11T19:23:33.000Z', question: 'And now?',
        description: 'Current caption.', frameId: 'private_handle',
      })) };
    const props = { client: {} as PublicClientApplication, config };
    const view = render(<VoiceControls {...props} camera={camera} />);
    const { options, listen } = startVoice();
    listen();
    act(() => options.onSessionReady('42'));
    await act(async () => { options.onVisionRequest('camera', 'And now?', 'current-item'); });
    expect(screen.queryByText('Image supplied to Jarvis for this turn.')).toBeNull();
    act(() => options.onVisualResult({ visualPath: 'image', itemId: 'stale-item' }));
    act(() => options.onVisualResult({ visualPath: 'image' }));
    expect(screen.queryByText('Image supplied to Jarvis for this turn.')).toBeNull();
    act(() => options.onVisualResultError('stale-item'));
    expect(screen.queryByText('Jarvis could not confirm the visual input for this turn.')).toBeNull();
    act(() => options.onVisualResultError('current-item'));
    expect(screen.getByText('Jarvis could not confirm the visual input for this turn.')).not.toBeNull();
    act(() => options.onVisualResult({ visualPath: 'caption', visualReason: 'image_input_unverified', itemId: 'current-item' }));
    expect(screen.getByText('Caption only - no image supplied to Jarvis for this turn. Model image support has not been verified.')).not.toBeNull();
    act(() => options.onVisualResult({ visualPath: 'image', itemId: 'current-item' }));
    expect(screen.queryByText('Image supplied to Jarvis for this turn.')).toBeNull();
    await act(async () => { options.onVisionRequest('camera', 'And now?', 'next-item'); });
    view.rerender(<VoiceControls {...props} camera={{ ...camera, sharing: false }} />);
    view.rerender(<VoiceControls {...props} camera={camera} />);
    act(() => options.onVisualResult({ visualPath: 'image', itemId: 'next-item' }));
    expect(screen.queryByText('Image supplied to Jarvis for this turn.')).toBeNull();
  });

  it.each(['switch', 'reconnect'] as const)('ignores visual evidence after a camera %s', async transition => {
    const camera = { sharing: true, conversation: true, starting: false, inspecting: false, error: '',
      start: vi.fn(async () => {}), stop: vi.fn(), inspect: vi.fn(), inspectTurn: vi.fn(async () => ({
        source: 'camera' as const, capturedAt: '2026-10-11T19:23:33.000Z', description: 'Current caption.',
      })) };
    const props = { client: {} as PublicClientApplication, config };
    const view = render(<VoiceControls {...props} camera={camera} />);
    const { options, listen } = startVoice();
    listen();
    act(() => options.onSessionReady('42'));
    await act(async () => { options.onVisionRequest('camera', 'And now?', 'current-item'); });
    if (transition === 'switch') {
      const previewStream: MediaStream = Object.assign(new EventTarget(), {
        id: 'switched-stream', active: true, onaddtrack: null, onremovetrack: null,
        addTrack: vi.fn(), removeTrack: vi.fn(), clone: vi.fn<() => MediaStream>(),
        getAudioTracks: () => [], getVideoTracks: () => [], getTracks: () => [], getTrackById: () => null,
      });
      view.rerender(<VoiceControls {...props} camera={{ ...camera, previewStream }} />);
    }
    else act(() => options.onStatus('reconnecting', 'Reconnecting.'));
    act(() => options.onVisualResult({ visualPath: 'image', itemId: 'current-item' }));
    expect(screen.queryByText('Image supplied to Jarvis for this turn.')).toBeNull();
  });

  it.each(['en', 'da'] as const)('attaches fresh image context to correlated %s turns and synchronises camera state', async (language) => {
    const visual = { source: 'camera' as const, capturedAt: '2026-10-11T19:23:33.000Z',
      question: 'And now?', description: 'Four fingers.', frameId: 'single_use_fixture' };
    const camera = { sharing: false, conversation: true, starting: false, inspecting: false, error: '',
      start: vi.fn(async () => {}), stop: vi.fn(), inspect: vi.fn(), inspectTurn: vi.fn(async () => visual) };
    const props = { client: {} as PublicClientApplication, config, language };
    const view = render(<VoiceControls {...props} camera={camera} />);
    const { instance, options, listen } = startVoice();
    expect(instance.client.setCameraState).toHaveBeenLastCalledWith(false);
    listen();
    act(() => options.onSessionReady('42'));
    view.rerender(<VoiceControls {...props} camera={{ ...camera, sharing: true }} />);
    expect(instance.client.setCameraState).toHaveBeenLastCalledWith(true);
    await act(async () => { options.onVisionRequest('camera', 'And now?', 'item-1'); });
    expect(camera.inspectTurn).toHaveBeenCalledWith('42', 'And now?', expect.any(AbortSignal), 'item-1');
    expect(instance.client.sendScreenContext).toHaveBeenCalledWith('Four fingers.', undefined, 'item-1', visual);
    expect(camera.inspect).not.toHaveBeenCalled();
    act(() => options.onVisionLimit({ itemId: 'item-1', code: 'frame_rate_limited' }));
    expect(screen.getByText('Voice camera is rate-limited. Jarvis has no fresh frame for this turn.')).not.toBeNull();
    act(() => options.onVisionLimit({ itemId: 'obsolete-item', code: 'daily_limit' }));
    expect(screen.queryByText('Camera capture limit reached in voice. Jarvis has no fresh frame for this turn.')).toBeNull();
    await act(async () => { options.onVisionRequest('camera', 'And now?', 'item-1'); });
    expect(camera.inspectTurn).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.queryByRole('menuitem', { name: 'Look at camera' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    view.rerender(<VoiceControls {...props} camera={camera} />);
    expect(instance.client.setCameraState).toHaveBeenLastCalledWith(false);
  });

  it.each(['budget_exhausted', 'budget_unavailable'] as const)('shows only the current camera item %s without echoing a relay event', async code => {
    const camera = { sharing: true, conversation: true, starting: false, inspecting: false, error: '',
      start: vi.fn(async () => {}), stop: vi.fn(), inspect: vi.fn(), inspectTurn: vi.fn(async () => ({
        source: 'camera' as const, capturedAt: '2026-10-11T19:23:33.000Z', description: 'Current caption.',
      })) };
    render(<VoiceControls client={{} as PublicClientApplication} config={config} camera={camera} />);
    const { instance, options, listen } = startVoice();
    listen();
    act(() => options.onSessionReady('42'));
    await act(async () => { options.onVisionRequest('camera', 'And now?', 'current-item'); });
    const text = code === 'budget_exhausted'
      ? 'Camera image budget reached in voice. No image was supplied for this turn.'
      : 'Camera image budget could not be checked. No image was supplied for this turn.';
    act(() => options.onVisionLimit({ itemId: 'obsolete-item', code }));
    expect(screen.queryByText(text)).toBeNull();
    act(() => options.onVisionLimit({ itemId: 'current-item', code }));
    expect(screen.getByText(text)).not.toBeNull();
    expect(instance.client.sendScreenContextUnavailable).not.toHaveBeenCalled();
    expect(instance.client.sendScreenContext).toHaveBeenCalledOnce();
    act(() => options.onVisualResult({ itemId: 'current-item', visualPath: 'caption', visualReason: code }));
    act(() => options.onVisionLimit({ itemId: 'current-item', code }));
    expect(screen.queryByText(text)).toBeNull();
  });

  it('releases a voice hold with the typed capture budget denial and no cached image', async () => {
    const camera = { sharing: true, conversation: true, starting: false, inspecting: false, error: '',
      start: vi.fn(async () => {}), stop: vi.fn(), inspect: vi.fn(),
      inspectTurn: vi.fn(async () => { throw new VisionInspectionError('Vision budget reached.', 429, 'budget_exhausted'); }) };
    render(<VoiceControls client={{} as PublicClientApplication} config={config} camera={camera} />);
    const { instance, options, listen } = startVoice();
    listen();
    act(() => options.onSessionReady('42'));
    await act(async () => { options.onVisionRequest('camera', 'And now?', 'budget-item'); });
    expect(instance.client.sendScreenContextUnavailable).toHaveBeenCalledExactlyOnceWith({
      itemId: 'budget-item', reason: 'budget_exhausted',
    });
    expect(instance.client.sendScreenContext).not.toHaveBeenCalled();
    expect(screen.getByText('Vision budget reached.')).not.toBeNull();
  });

  it('releases a correlated voice hold after ten seconds and ignores a late frame', async () => {
    vi.useFakeTimers();
    try {
      let finish!: (value: { source: 'camera'; description: string; capturedAt: string }) => void;
      const camera = { sharing: true, conversation: true, starting: false, inspecting: false, error: '',
        start: vi.fn(async () => {}), stop: vi.fn(), inspect: vi.fn(),
        inspectTurn: vi.fn(() => new Promise<{ source: 'camera'; description: string; capturedAt: string }>((resolve) => { finish = resolve; })) };
      render(<VoiceControls client={{} as PublicClientApplication} config={config} camera={camera} />);
      const { instance, options, listen } = startVoice();
      listen();
      act(() => options.onSessionReady('42'));
      act(() => options.onVisionRequest('camera', 'And now?', 'item-timeout'));
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(instance.client.sendScreenContextUnavailable).toHaveBeenCalledWith({ itemId: 'item-timeout', reason: 'timeout' });
      expect(screen.getByText('Camera inspection timed out. Jarvis has no fresh frame for this turn.')).not.toBeNull();
      await act(async () => { finish({ source: 'camera', description: 'Too late.', capturedAt: '2026-10-11T19:23:33.000Z' }); });
      expect(instance.client.sendScreenContext).not.toHaveBeenCalled();
      expect(instance.client.sendScreenContextUnavailable).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a camera-on voice turn intact when screen inspection is requested', async () => {
    const visual = { source: 'camera' as const, question: 'And now?', capturedAt: '2026-10-11T19:23:33.000Z', description: 'Current frame.' };
    let finish!: (value: typeof visual) => void;
    const camera = { sharing: true, conversation: true, starting: false, inspecting: false, error: '',
      start: vi.fn(async () => {}), stop: vi.fn(), inspect: vi.fn(),
      inspectTurn: vi.fn<(session: string, question: string, signal?: AbortSignal) => Promise<typeof visual>>(() =>
        new Promise<typeof visual>((resolve) => { finish = resolve; })) };
    const screenShare = { sharing: true, starting: false, inspecting: false, error: '',
      start: vi.fn(async () => {}), stop: vi.fn(), inspect: vi.fn(async () => ({ description: 'Shared screen.' })) };
    render(<VoiceControls client={{} as PublicClientApplication} config={config} camera={camera} screenShare={screenShare} />);
    const { instance, options, listen } = startVoice();
    listen();
    act(() => options.onSessionReady('42'));
    act(() => options.onVisionRequest('camera', 'And now?', 'camera-turn'));
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getByRole('menuitem', { name: 'Look at screen' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Turn off the camera to inspect the shared screen in voice.')).not.toBeNull();
    await act(async () => { options.onVisionRequest('screen', 'Look at screen', 'screen-turn'); });
    expect(screenShare.inspect).not.toHaveBeenCalled();
    expect(camera.inspectTurn.mock.calls[0]?.[2]?.aborted).toBe(false);
    await act(async () => { finish(visual); });
    expect(instance.client.sendScreenContext).toHaveBeenCalledWith('Current frame.', undefined, 'camera-turn', visual);
    expect(instance.client.sendScreenContextUnavailable).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'] as const)('cancels legacy screen inspection on camera activation without sending late %s', async outcome => {
    let finish!: (value: { description: string }) => void;
    let fail!: (reason: Error) => void;
    const screenShare = { sharing: true, starting: false, inspecting: false, error: '',
      start: vi.fn(async () => {}), stop: vi.fn(), inspect: vi.fn<(session: string, feedback?: string, signal?: AbortSignal) => Promise<{ description: string }>>(() =>
        new Promise<{ description: string }>((resolve, reject) => { finish = resolve; fail = reject; })) };
    const camera = { sharing: false, conversation: true, starting: false, inspecting: false, error: '',
      start: vi.fn(async () => {}), stop: vi.fn(), inspect: vi.fn() };
    const props = { client: {} as PublicClientApplication, config, screenShare };
    const view = render(<VoiceControls {...props} camera={camera} />);
    const { instance, options, listen } = startVoice();
    listen();
    act(() => options.onSessionReady('42'));
    act(() => options.onVisionRequest('screen', 'Look at screen', 'screen-turn'));
    view.rerender(<VoiceControls {...props} camera={{ ...camera, sharing: true }} />);
    expect(screenShare.inspect.mock.calls[0]?.[2]?.aborted).toBe(true);
    await act(async () => {
      if (outcome === 'success') finish({ description: 'Obsolete screen.' });
      else fail(new Error('Obsolete screen failure.'));
    });
    expect(instance.client.sendScreenContext).not.toHaveBeenCalled();
    expect(instance.client.sendScreenContextUnavailable).not.toHaveBeenCalled();
    expect(screen.queryByText('Obsolete screen failure.')).toBeNull();
  });

  it('cancels obsolete voice inspection and refuses missing item correlation', async () => {
    const visual = { source: 'camera' as const, capturedAt: '2026-10-11T19:23:33.000Z', description: 'Current frame.' };
    let late!: (value: typeof visual) => void;
    const camera = { sharing: true, conversation: true, starting: false, inspecting: false, error: '',
      start: vi.fn(async () => {}), stop: vi.fn(), inspect: vi.fn(),
      inspectTurn: vi.fn().mockImplementationOnce(() => new Promise<typeof visual>((resolve) => { late = resolve; }))
        .mockResolvedValueOnce(visual) };
    render(<VoiceControls client={{} as PublicClientApplication} config={config} camera={camera} />);
    const { instance, options, listen } = startVoice();
    listen();
    act(() => options.onSessionReady('42'));
    act(() => options.onVisionRequest('camera', 'First?', 'item-old'));
    await act(async () => { options.onVisionRequest('camera', 'Next?', 'item-new'); });
    expect(camera.inspectTurn.mock.calls[0]?.[2].aborted).toBe(true);
    await act(async () => { late(visual); });
    expect(instance.client.sendScreenContext).toHaveBeenCalledOnce();
    expect(instance.client.sendScreenContext.mock.calls[0]?.[2]).toBe('item-new');
    expect(instance.client.sendScreenContextUnavailable).not.toHaveBeenCalled();
    await act(async () => { options.onVisionRequest('camera', 'Duplicate old turn?', 'item-old'); });
    expect(camera.inspectTurn).toHaveBeenCalledTimes(2);
    await act(async () => { options.onVisionRequest('camera', 'Missing?'); });
    expect(screen.getByText('The voice turn has no camera correlation ID or question. No frame was sent.')).not.toBeNull();
    expect(camera.inspectTurn).toHaveBeenCalledTimes(2);
  });

  it('ends the running voice session from an agent session command and refuses when none is running', async () => {
    const registry = createSessionCommandRegistry();
    const end = { commandId: 'end-1', operation: 'session', action: 'voice', value: 'end' } as const;
    render(
      <SessionCommandRegistryContext.Provider value={registry}>
        <JarvisActivityProvider>
          <VoiceControls client={{} as PublicClientApplication} config={config} language="en" />
        </JarvisActivityProvider>
      </SessionCommandRegistryContext.Provider>,
    );
    expect(await applySessionCommand(end, registry, undefined)).toMatchObject({ applied: false });
    const { instance, listen } = startVoice();
    listen();
    await expect(act(() => applySessionCommand(end, registry, undefined))).resolves.toEqual({ applied: true });
    expect(instance.client.stop).toHaveBeenCalledOnce();
    expect(screen.queryByRole('group', { name: 'Voice controls' })).toBeNull();
    expect(await applySessionCommand(end, registry, undefined)).toMatchObject({ applied: false });
  });

  it('starts voice with the microphone in one gesture, mutes and stops the active session', () => {
    const onSessionEnded = vi.fn();
    render(
      <JarvisActivityProvider>
        <VoiceControls
          client={{} as PublicClientApplication}
          config={config}
          language="en"
          onSessionEnded={onSessionEnded}
        />
        <WorkingProbe />
      </JarvisActivityProvider>,
    );

    expect(clients.instances).toHaveLength(0);
    expect(screen.queryByRole('group', { name: 'Voice controls' })).toBeNull();
    const { instance, options, listen } = startVoice();
    expect(instance.client.start).toHaveBeenCalledOnce();
    expect(instance.options).toMatchObject({
      backendUrl: 'https://api.example.com',
      language: 'en',
    });

    act(() => {
      options.onStatus('connecting', 'Connecting to Jarvis voice…');
      options.onMicrophoneState('requesting');
    });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'End voice' }));
    expect(document.getElementById('voice-status')?.textContent).toBe('Connecting');
    expect(screen.queryByRole('button', { name: /Enable microphone/u })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.queryByRole('menuitem', { name: 'Mute microphone' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Retry microphone' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    act(() => options.onStatus('ready', 'Allow microphone access when your browser asks, so Jarvis can hear you.'));
    expect(document.getElementById('voice-status')?.textContent).toBe('Waiting for microphone');
    listen();
    expect(document.getElementById('voice-status')?.textContent).toBe('Listening');
    expect(screen.getByLabelText('Jarvis work state').textContent).toBe('idle');
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    const mute = screen.getByRole('menuitem', { name: 'Mute microphone' });
    expect(mute.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(mute);
    expect(instance.client.setMuted).toHaveBeenCalledWith(true);
    expect(screen.getByText('Microphone muted')).not.toBeNull();
    // A transport reconnect keeps the explicit mute.
    act(() => {
      options.onStatus('reconnecting', 'Voice connection ended. Reconnecting…');
      options.onMicrophoneState('granted');
    });
    listen();
    expect(screen.getByText('Microphone muted')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getByRole('menuitem', { name: 'Unmute microphone' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    fireEvent.click(screen.getByRole('button', { name: 'End voice' }));
    expect(instance.client.stop).toHaveBeenCalledOnce();
    expect(onSessionEnded).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Start voice' })).not.toBeNull();
    expect(screen.getByLabelText('Jarvis work state').textContent).toBe('idle');
  });

  it('offers Retry microphone in More only after a microphone problem', () => {
    render(<VoiceControls client={{} as PublicClientApplication} config={config} />);
    const { instance, options } = startVoice();
    act(() => {
      options.onMicrophoneState('denied');
      options.onStatus('ready', 'Microphone access is blocked. Allow it for this site in your browser settings, then choose Retry microphone in More options.');
    });
    expect(screen.getByRole('alert').textContent).toContain('Microphone blocked');
    expect(screen.queryByText('Listening')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.queryByRole('menuitem', { name: 'Mute microphone' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retry microphone' }));
    expect(instance.client.retryMicrophone).toHaveBeenCalledOnce();
  });

  it('renders one compact bar with only More and End voice, with the status outside it', () => {
    const screenShare = {
      sharing: true,
      starting: false,
      inspecting: false,
      error: '',
      start: vi.fn(async () => {}),
      stop: vi.fn(),
      inspect: vi.fn(async () => ({ description: 'A desk.' })),
    };
    const camera = {
      sharing: false,
      starting: false,
      inspecting: false,
      error: '',
      start: vi.fn(async () => {}),
      stop: vi.fn(),
      inspect: vi.fn(async () => ({ description: 'A mug.' })),
    };
    render(
      <VoiceControls
        client={{} as PublicClientApplication}
        config={config}
        screenShare={screenShare}
        camera={camera}
      />,
    );

    const { options, listen } = startVoice();
    act(() => options.onSessionReady('42'));
    listen();

    const bar = screen.getByRole('group', { name: 'Voice controls' });
    expect(bar.classList.contains('luminous-glass')).toBe(true);
    expect(bar.getAttribute('data-state')).toBe('listening');
    expect(screen.queryByRole('heading')).toBeNull();
    const buttons = Array.from(bar.querySelectorAll('button')).map((button) => button.getAttribute('aria-label') ?? button.textContent);
    expect(buttons).toEqual(['More options', 'End voice']);
    expect(bar.textContent).not.toContain('Listening');
    expect(screen.getByRole('status').textContent).toContain('Listening');

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Language', 'Mute microphone', 'Look at screen', 'Watch the screen', 'Stop sharing screen', 'Turn on camera',
    ]);
    expect(screen.getByRole('menuitem', { name: 'Look at screen' }).getAttribute('aria-disabled')).toBeNull();
    const cameraItem = screen.getByRole('menuitem', { name: 'Turn on camera' });
    expect(cameraItem.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Look at screen' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screenShare.inspect).toHaveBeenCalledWith('42', 'caller', expect.any(AbortSignal));
  });

  it('starts screen and camera capture from More without inspecting a frame, then offers stop controls', async () => {
    const capture = () => ({ sharing: false, starting: false, inspecting: false, error: '',
      start: vi.fn(async () => {}), stop: vi.fn(), inspect: vi.fn(async () => ({ description: 'A desk.' })) });
    const screenShare = capture();
    const camera = capture();
    const props = { client: {} as PublicClientApplication, config, screenShare, camera };
    const { rerender } = render(<VoiceControls {...props} />);
    const { options, listen } = startVoice();
    act(() => options.onSessionReady('42'));
    listen();
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Share screen' }));
    expect(screenShare.start).toHaveBeenCalledOnce();
    expect(screenShare.inspect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Turn on camera' }));
    expect(camera.start).toHaveBeenCalledOnce();
    expect(camera.inspect).not.toHaveBeenCalled();
    rerender(<VoiceControls {...props} screenShare={{ ...screenShare, sharing: true }} camera={{ ...camera, sharing: true }} />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop sharing screen' }));
    expect(screenShare.stop).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Turn off camera' }));
    expect(camera.stop).toHaveBeenCalledOnce();
  });

  it('portals permission failures outside the menu and composer, even after voice ends', () => {
    const camera = { sharing: false, starting: false, inspecting: false, error: '',
      start: vi.fn(async (onError?: (message: string) => void) => {
        onError?.('Camera access was not started. Allow camera access and try again.');
      }), stop: vi.fn(), inspect: vi.fn() };
    const { container } = render(<VoiceControls client={{} as PublicClientApplication} config={config} camera={camera} />);
    startVoice().listen();
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Turn on camera' }));
    const toast = screen.getByRole('alert').closest('.conversation-toast');
    expect(toast?.parentElement?.id).toBe('jarvis-toast-stack');
    expect(container.contains(toast)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getByRole('menu').contains(toast)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'End voice' }));
    expect(container.querySelector('.voice-screen-error')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start voice' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('closes an open menu with Escape before Escape ends voice', () => {
    render(<VoiceControls client={{} as PublicClientApplication} config={config} />);
    const { instance, listen } = startVoice();
    listen();

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Language' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Language' })).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(instance.client.stop).not.toHaveBeenCalled();

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(instance.client.stop).toHaveBeenCalledOnce();
  });

  it('never shows listening while the transport is reconnecting or from stale runtime activity', () => {
    render(
      <JarvisActivityProvider>
        <WorkingProbe />
        <VoiceControls client={{} as PublicClientApplication} config={config} />
      </JarvisActivityProvider>,
    );
    // Activity from before this session started is stale and cannot drive the new session.
    fireEvent.click(screen.getByRole('button', { name: 'Publish tool' }));
    const { options, listen } = startVoice();
    listen();
    expect(screen.queryByText('Using a tool')).toBeNull();
    expect(screen.getByText('Listening')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Publish tool' }));
    expect(screen.getByText('Using a tool')).not.toBeNull();
    act(() => options.onStatus('reconnecting', 'Voice connection ended. Reconnecting…'));

    const bar = screen.getByRole('group', { name: 'Voice controls' });
    expect(bar.getAttribute('data-state')).toBe('reconnecting');
    expect(screen.getByText('Reconnecting')).not.toBeNull();
    expect(screen.queryByText('Listening')).toBeNull();
    expect(screen.getByRole('button', { name: 'End voice' })).toHaveProperty('disabled', false);

    act(() => {
      options.onMicrophoneState('granted');
      options.onStatus('ready', 'Allow microphone access when your browser asks, so Jarvis can hear you.');
    });
    expect(bar.getAttribute('data-state')).toBe('microphone-pending');
    expect(screen.queryByText('Listening')).toBeNull();
  });

  it('applies a language change to the next session and says the active session keeps its language', () => {
    const onLanguageChange = vi.fn();
    const { rerender } = render(
      <VoiceControls client={{} as PublicClientApplication} config={config} language="da" onLanguageChange={onLanguageChange} />,
    );
    const { listen } = startVoice();
    listen();

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Language' }));
    const flyout = screen.getByRole('menu', { name: 'Language' });
    expect(flyout.textContent).toContain('This voice session uses Danish.');
    expect(screen.getByRole('menuitemradio', { name: 'Danish' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'English' }));
    expect(onLanguageChange).toHaveBeenCalledWith('en');
    rerender(
      <VoiceControls client={{} as PublicClientApplication} config={config} language="en" onLanguageChange={onLanguageChange} />,
    );
    const note = 'English is selected for chat and your next voice session. This session continues in Danish.';
    expect(screen.queryByText(note)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Language' }));
    const updated = screen.getByRole('menu', { name: 'Language' });
    expect(screen.getByText(note).id).toBe(updated.getAttribute('aria-describedby'));
    expect(updated.contains(screen.getByText(note))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    fireEvent.click(screen.getByRole('button', { name: 'End voice' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    expect(clients.instances[1]?.options).toMatchObject({ language: 'en' });
    expect(screen.queryByText(/This session continues in/u)).toBeNull();
  });

  it('marks actual thinking and speaking states as active work, then clears on listening', () => {
    render(
      <JarvisActivityProvider>
        <VoiceControls client={{} as PublicClientApplication} config={config} />
        <WorkingProbe />
      </JarvisActivityProvider>,
    );
    startVoice().listen();
    fireEvent.click(screen.getByRole('button', { name: 'Publish thinking' }));
    expect(screen.getByLabelText('Jarvis work state').textContent).toBe('working');
    fireEvent.click(screen.getByRole('button', { name: 'Publish speaking' }));
    expect(screen.getByLabelText('Jarvis work state').textContent).toBe('working');
    fireEvent.click(screen.getByRole('button', { name: 'Publish listening' }));
    expect(screen.getByLabelText('Jarvis work state').textContent).toBe('idle');
  });

  it('drives the stage orb from the one presentation state and distinct live audio signals', () => {
    const stage = { setOrbState: vi.fn(), setSignals: vi.fn() };
    render(
      <VoiceStageContext.Provider value={stage}>
        <JarvisActivityProvider>
          <VoiceControls client={{} as PublicClientApplication} config={config} />
          <WorkingProbe />
        </JarvisActivityProvider>
      </VoiceStageContext.Provider>,
    );

    expect(stage.setSignals).not.toHaveBeenCalled();
    const { instance, options, listen } = startVoice();
    const signals = stage.setSignals.mock.calls.at(-1)?.[0] as { playbackLevel(): number; inputLevel(): number };
    expect(signals.playbackLevel()).toBe(0.4);
    expect(signals.inputLevel()).toBe(0.2);
    expect(instance.client.playbackLevel).toHaveBeenCalled();
    act(() => options.onStatus('connecting', 'Connecting to Jarvis voice…'));
    expect(stage.setOrbState).toHaveBeenLastCalledWith('idle');
    listen();
    expect(stage.setOrbState).toHaveBeenLastCalledWith('listening');
    act(() => options.onStatus('thinking', 'Jarvis is thinking.'));
    expect(stage.setOrbState).toHaveBeenLastCalledWith('thinking');
    fireEvent.click(screen.getByRole('button', { name: 'Publish tool' }));
    expect(stage.setOrbState).toHaveBeenLastCalledWith('tool');
    act(() => options.onStatus('speaking', 'Jarvis is speaking.'));
    expect(stage.setOrbState).toHaveBeenLastCalledWith('tool');
    fireEvent.click(screen.getByRole('button', { name: 'Publish thinking' }));
    expect(stage.setOrbState).toHaveBeenLastCalledWith('speaking');

    fireEvent.click(screen.getByRole('button', { name: 'End voice' }));
    expect(stage.setOrbState).toHaveBeenLastCalledWith(null);
    expect(stage.setSignals).toHaveBeenLastCalledWith(null);
  });

  it('starts each session with a fresh microphone state', () => {
    render(<VoiceControls client={{} as PublicClientApplication} config={config} />);
    const first = startVoice();
    act(() => {
      first.options.onMicrophoneState('denied');
      first.options.onStatus('ready', 'Microphone access is blocked.');
    });
    fireEvent.click(screen.getByRole('button', { name: 'End voice' }));
    // A late callback from the stopped client is ignored.
    act(() => first.options.onMicrophoneState('live'));

    const second = startVoice();
    act(() => second.options.onStatus('connecting', 'Connecting to Jarvis voice…'));
    expect(screen.getByText('Connecting')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.queryByRole('menuitem', { name: 'Retry microphone' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Mute microphone' })).toBeNull();
  });

  it('sends an on-request camera description to voice and turns the camera off when voice ends', async () => {
    const camera = {
      sharing: true,
      starting: false,
      inspecting: false,
      error: '',
      start: vi.fn(async () => {}),
      stop: vi.fn(),
      inspect: vi.fn(async () => ({ description: 'A red mug.' })),
    };
    render(
      <VoiceControls
        client={{} as PublicClientApplication}
        config={config}
        camera={camera}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    const instance = clients.instances[0];
    if (!instance) throw new Error('Voice client was not created.');
    const options = instance.options as {
      onSessionReady: (sessionId: string) => void;
      onVisionRequest: (source: 'camera' | 'screen', transcript: string) => void;
      onStatus: (status: 'stopped', message: string) => void;
    };
    act(() => options.onSessionReady('42'));
    options.onVisionRequest('camera', 'What am I holding?');

    await waitFor(() => expect(camera.inspect).toHaveBeenCalledWith('42', 'caller', expect.any(AbortSignal)));
    expect(instance.client.sendScreenContext).toHaveBeenCalledWith('A red mug.', undefined);
    act(() => options.onStatus('stopped', 'Voice is off.'));
    expect(camera.stop).toHaveBeenCalledOnce();
  });

  it('uses the current camera when it is enabled after voice starts', async () => {
    const initialCamera = { sharing: false, starting: false, inspecting: false, error: '',
      start: vi.fn(async () => {}), stop: vi.fn(), inspect: vi.fn(async () => ({ description: 'Old camera.' })) };
    const enabledCamera = { ...initialCamera, sharing: true, facing: 'environment' as const,
      stop: vi.fn(), inspect: vi.fn(async () => ({ description: 'Current camera.' })) };
    const view = render(<VoiceControls client={{} as PublicClientApplication} config={config} camera={initialCamera} />);
    const { instance, options, listen } = startVoice();
    listen();
    act(() => options.onSessionReady('42'));
    view.rerender(<VoiceControls client={{} as PublicClientApplication} config={config} camera={enabledCamera} />);
    const onVisionRequest = (instance.options as { onVisionRequest: (source: 'camera') => void }).onVisionRequest;
    await act(async () => { onVisionRequest('camera'); });
    expect(enabledCamera.inspect).toHaveBeenCalledWith('42', 'caller', expect.any(AbortSignal));
    expect(initialCamera.inspect).not.toHaveBeenCalled();
    expect(instance.client.sendScreenContext).toHaveBeenCalledWith('Current camera.', undefined);
    expect(screen.queryByText('Back camera on')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Camera off' })).toBeNull();
    act(() => options.onStatus('stopped', 'Voice is off.'));
    expect(enabledCamera.stop).toHaveBeenCalledOnce();
    expect(initialCamera.stop).not.toHaveBeenCalled();
  });

  it('resets camera idle shutdown on speech and unrelated turns using the current capture only', () => {
    const camera = { sharing: true, starting: false, inspecting: false, error: '',
      start: vi.fn(async () => {}), stop: vi.fn(), inspect: vi.fn(), recordActivity: vi.fn() };
    const view = render(<VoiceControls client={{} as PublicClientApplication} config={config} camera={camera} />);
    const { instance, options, listen } = startVoice();
    const onUserTurn = (instance.options as { onUserTurn: (text: string) => void }).onUserTurn;
    listen();
    expect(camera.recordActivity).toHaveBeenCalledOnce();
    act(() => onUserTurn('How is the weather?'));
    expect(camera.recordActivity).toHaveBeenCalledTimes(2);
    const current = { ...camera, recordActivity: vi.fn() };
    view.rerender(<VoiceControls client={{} as PublicClientApplication} config={config} camera={current} />);
    act(() => onUserTurn('Tell me more.'));
    expect(current.recordActivity).toHaveBeenCalledOnce();
    expect(camera.recordActivity).toHaveBeenCalledTimes(2);
    act(() => options.onStatus('stopped', 'Voice is off.'));
    act(() => onUserTurn('Late transcript.'));
    expect(current.recordActivity).toHaveBeenCalledOnce();
  });

  it('reports camera failure to Dan and the voice transport rather than claiming it saw a frame', async () => {
    const camera = { sharing: true, starting: false, inspecting: false, error: '', facing: 'user' as const,
      start: vi.fn(async () => {}), stop: vi.fn(), inspect: vi.fn(async () => { throw new Error('Fixture capture failed.'); }) };
    render(<VoiceControls client={{} as PublicClientApplication} config={config} camera={camera} />);
    const { instance, options, listen } = startVoice();
    listen();
    act(() => options.onSessionReady('42'));
    const onVisionRequest = (instance.options as { onVisionRequest: (source: 'camera') => void }).onVisionRequest;
    act(() => onVisionRequest('camera'));
    expect(await screen.findByText('Fixture capture failed.')).not.toBeNull();
    expect(instance.client.sendScreenContext).not.toHaveBeenCalled();
    expect(instance.client.sendScreenContextUnavailable).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Look now' })).toBeNull();
  });

  it('makes a missing vision session visible instead of silently dropping the request', async () => {
    render(<VoiceControls client={{} as PublicClientApplication} config={config} />);
    const { instance, listen } = startVoice();
    listen();
    const onVisionRequest = (instance.options as { onVisionRequest: (source: 'camera') => void }).onVisionRequest;
    act(() => onVisionRequest('camera'));
    expect(await screen.findByText('Voice is not ready to inspect a frame. Wait for the connection and try again.')).not.toBeNull();
    expect(instance.client.sendScreenContext).not.toHaveBeenCalled();
  });

  it('does not forward an obsolete capture failure after a newer request succeeds', async () => {
    let failFirst!: (reason: Error) => void;
    const camera = { sharing: true, starting: false, inspecting: false, error: '',
      start: vi.fn(async () => {}), stop: vi.fn(),
      inspect: vi.fn().mockImplementationOnce(() => new Promise((_resolve, reject) => { failFirst = reject; }))
        .mockResolvedValueOnce({ description: 'Latest frame.' }) };
    render(<VoiceControls client={{} as PublicClientApplication} config={config} camera={camera} />);
    const { instance, options, listen } = startVoice();
    listen();
    act(() => options.onSessionReady('42'));
    const onVisionRequest = (instance.options as { onVisionRequest: (source: 'camera') => void }).onVisionRequest;
    act(() => onVisionRequest('camera'));
    await act(async () => { onVisionRequest('camera'); });
    await act(async () => { failFirst(new Error('Superseded capture.')); });
    expect(instance.client.sendScreenContext).toHaveBeenCalledOnce();
    expect(instance.client.sendScreenContext).toHaveBeenCalledWith('Latest frame.', undefined);
    expect(instance.client.sendScreenContextUnavailable).not.toHaveBeenCalled();
    expect(screen.queryByText('Superseded capture.')).toBeNull();
  });

  describe('wake word', () => {
    function WakeProbe() {
      const status = useWakeStatus();
      return <output aria-label="Wake status">{status ? `${status.outcome}: ${status.message}` : 'none'}</output>;
    }
    const wake = (offset = 0) => new Date(Date.now() - 1000 + offset).toISOString();

    beforeEach(() => {
      resetWakeForTests();
      Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { hasBeenActive: true, isActive: false } });
    });

    it('starts voice once per detection and reports it', () => {
      render(<JarvisActivityProvider><VoiceControls client={{} as PublicClientApplication} config={config} /><WakeProbe /></JarvisActivityProvider>);
      const at = wake();
      act(() => { publishVoiceWake(at); publishVoiceWake(at); });
      expect(clients.instances).toHaveLength(1);
      expect(clients.instances[0]!.client.start).toHaveBeenCalledOnce();
      expect(screen.getByText('Heard “Wake up Jarvis”.')).not.toBeNull();
      expect(screen.getByLabelText('Wake status').textContent).toBe('started: Voice started.');

      act(() => { publishVoiceWake(wake(1)); });
      expect(clients.instances).toHaveLength(1);
      expect(screen.getByLabelText('Wake status').textContent).toBe('already-active: Voice was already on.');
    });

    it('asks for one click when the browser will not play sound yet, and ignores stale detections', () => {
      Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { hasBeenActive: false, isActive: false } });
      render(<JarvisActivityProvider><VoiceControls client={{} as PublicClientApplication} config={config} /><WakeProbe /></JarvisActivityProvider>);
      act(() => { publishVoiceWake(wake()); });
      expect(clients.instances).toHaveLength(0);
      expect(screen.getByText(/Click the orb to start voice/)).not.toBeNull();
      expect(screen.getByLabelText('Wake status').textContent).toMatch(/^needs-click/);

      act(() => { publishVoiceWake(new Date(Date.now() - 120_000).toISOString()); });
      expect(screen.getByLabelText('Wake status').textContent).toBe('error: Heard too long ago to start voice.');
    });
  });
});