import type { PublicClientApplication } from '@azure/msal-browser';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '../config/public-config';
import { useJarvisActivity } from './activity-context';
import { JarvisActivityProvider } from './activity-provider';
import { VoiceStageContext } from './voice-stage-context';
import { VoiceControls } from './VoiceControls';
import { publishVoiceWake, resetWakeForTests, useWakeStatus } from './wake-store';

const clients = vi.hoisted(() => ({
  instances: [] as Array<{
    options: unknown;
    client: {
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      setMuted: ReturnType<typeof vi.fn>;
      sendScreenContext: ReturnType<typeof vi.fn>;
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
    readonly sendScreenContext = vi.fn();
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
      'Language', 'Mute microphone', 'Look at screen', 'Stop sharing screen', 'Turn on camera',
    ]);
    expect(screen.getByRole('menuitem', { name: 'Look at screen' }).getAttribute('aria-disabled')).toBeNull();
    const cameraItem = screen.getByRole('menuitem', { name: 'Turn on camera' });
    expect(cameraItem.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Look at screen' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screenShare.inspect).toHaveBeenCalledWith('42', 'caller');
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

    await waitFor(() => expect(camera.inspect).toHaveBeenCalledWith('42', 'caller'));
    expect(instance.client.sendScreenContext).toHaveBeenCalledWith('A red mug.', undefined);
    act(() => options.onStatus('stopped', 'Voice is off.'));
    expect(camera.stop).toHaveBeenCalledOnce();
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