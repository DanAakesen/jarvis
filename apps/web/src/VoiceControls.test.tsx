import type { PublicClientApplication } from '@azure/msal-browser';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '../config/public-config';
import { useJarvisActivity } from './activity-context';
import { JarvisActivityProvider } from './activity-provider';
import { PlaybackAudioLevelContext } from './playback-audio-context';
import { VoiceControls } from './VoiceControls';

const clients = vi.hoisted(() => ({
  instances: [] as Array<{
    options: unknown;
    client: {
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      setMuted: ReturnType<typeof vi.fn>;
      sendScreenContext: ReturnType<typeof vi.fn>;
      enableMicrophone: ReturnType<typeof vi.fn>;
    };
  }>,
}));

vi.mock('./voice-client', () => ({
  BrowserVoiceClient: class {
    readonly start = vi.fn();
    readonly setMuted = vi.fn();
    readonly sendScreenContext = vi.fn();
    readonly enableMicrophone = vi.fn(async () => {});
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
    </>
  );
}

beforeEach(() => {
  clients.instances.length = 0;
});

describe('VoiceControls', () => {
  it('starts the selected language, mutes and stops the active session', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    const instance = clients.instances[0];
    if (!instance) throw new Error('Voice client was not created.');
    expect(instance.client.start).toHaveBeenCalledOnce();
    expect(instance.options).toMatchObject({
      backendUrl: 'https://api.example.com',
      language: 'en',
    });

    const options = instance.options as {
      onStatus: (status: 'ready' | 'listening', message: string) => void;
    };
    act(() => options.onStatus('ready', 'Microphone is off.'));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'End voice' }));
    expect(document.getElementById('voice-status')?.textContent).toBe('Ready');
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.queryByRole('menuitem', { name: 'Mute microphone' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(instance.client.enableMicrophone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Enable microphone' }));
    expect(instance.client.enableMicrophone).toHaveBeenCalledOnce();
    act(() => options.onStatus('listening', 'Listening for your voice.'));
    expect(screen.getByLabelText('Jarvis work state').textContent).toBe('idle');
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    const mute = screen.getByRole('menuitem', { name: 'Mute microphone' });
    expect(mute.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(mute);
    expect(instance.client.setMuted).toHaveBeenCalledWith(true);
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

  it('renders one compact bar with More, the runtime status and End voice, keeping vision in More', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    const instance = clients.instances[0];
    if (!instance) throw new Error('Voice client was not created.');
    const options = instance.options as {
      onSessionReady: (sessionId: string) => void;
      onStatus: (status: 'listening', message: string) => void;
    };
    act(() => {
      options.onSessionReady('42');
      options.onStatus('listening', 'Listening for your voice.');
    });

    const bar = screen.getByRole('group', { name: 'Voice controls' });
    expect(bar.classList.contains('luminous-glass')).toBe(true);
    expect(bar.getAttribute('data-state')).toBe('listening');
    expect(screen.queryByRole('heading')).toBeNull();
    const buttons = Array.from(bar.querySelectorAll('button')).map((button) => button.getAttribute('aria-label') ?? button.textContent);
    expect(buttons).toEqual(['More options', 'End voice']);
    expect(screen.getByRole('status').textContent).toContain('Listening');

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Language', 'Mute microphone', 'Look at screen', 'Look at camera',
    ]);
    expect(screen.getByRole('menuitem', { name: 'Look at screen' }).getAttribute('aria-disabled')).toBeNull();
    const cameraItem = screen.getByRole('menuitem', { name: 'Look at camera' });
    expect(cameraItem.getAttribute('aria-disabled')).toBe('true');
    expect(cameraItem.getAttribute('title')).toBe('Turn on the camera from the top bar before asking Jarvis to inspect a frame.');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Look at screen' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screenShare.inspect).toHaveBeenCalledWith('42');
  });

  it('closes an open menu with Escape before Escape ends voice', () => {
    render(<VoiceControls client={{} as PublicClientApplication} config={config} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    const instance = clients.instances[0];
    if (!instance) throw new Error('Voice client was not created.');
    const options = instance.options as { onStatus: (status: 'listening', message: string) => void };
    act(() => options.onStatus('listening', 'Listening for your voice.'));

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

  it('never shows listening while the transport is reconnecting', () => {
    render(
      <JarvisActivityProvider>
        <VoiceControls client={{} as PublicClientApplication} config={config} />
        <WorkingProbe />
      </JarvisActivityProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    const instance = clients.instances[0];
    if (!instance) throw new Error('Voice client was not created.');
    const options = instance.options as {
      onStatus: (status: 'listening' | 'reconnecting' | 'ready', message: string) => void;
    };
    act(() => options.onStatus('listening', 'Listening for your voice.'));
    fireEvent.click(screen.getByRole('button', { name: 'Publish listening' }));
    act(() => options.onStatus('reconnecting', 'Voice connection ended. Reconnecting…'));

    const bar = screen.getByRole('group', { name: 'Voice controls' });
    expect(bar.getAttribute('data-state')).toBe('reconnecting');
    expect(screen.getByText('Reconnecting')).not.toBeNull();
    expect(screen.queryByText('Listening')).toBeNull();
    expect(screen.getByRole('button', { name: 'End voice' })).toHaveProperty('disabled', false);

    act(() => options.onStatus('ready', 'Voice is ready. Microphone is off; enable it when you want to speak.'));
    expect(bar.getAttribute('data-state')).toBe('ready');
    expect(screen.queryByText('Listening')).toBeNull();
  });

  it('applies a language change to the next session and says the active session keeps its language', () => {
    const onLanguageChange = vi.fn();
    const { rerender } = render(
      <VoiceControls client={{} as PublicClientApplication} config={config} language="da" onLanguageChange={onLanguageChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    const first = clients.instances[0];
    if (!first) throw new Error('Voice client was not created.');
    const options = first.options as { onStatus: (status: 'listening' | 'stopped', message: string) => void };
    act(() => options.onStatus('listening', 'Listening for your voice.'));

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Language' }));
    expect(screen.getByRole('menuitemradio', { name: 'Danish' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'English' }));
    expect(onLanguageChange).toHaveBeenCalledWith('en');
    rerender(
      <VoiceControls client={{} as PublicClientApplication} config={config} language="en" onLanguageChange={onLanguageChange} />,
    );
    expect(screen.getByText('English is selected for chat and your next voice session. This session continues in Danish.'))
      .not.toBeNull();

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
    fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    const instance = clients.instances[0];
    if (!instance) throw new Error('Voice client was not created.');
    const options = instance.options as {
      onStatus: (status: 'ready', message: string) => void;
    };

    act(() => options.onStatus('ready', 'Microphone is off.'));
    fireEvent.click(screen.getByRole('button', { name: 'Publish thinking' }));
    expect(screen.getByLabelText('Jarvis work state').textContent).toBe('working');
    fireEvent.click(screen.getByRole('button', { name: 'Publish speaking' }));
    expect(screen.getByLabelText('Jarvis work state').textContent).toBe('working');
    fireEvent.click(screen.getByRole('button', { name: 'Publish listening' }));
    expect(screen.getByLabelText('Jarvis work state').textContent).toBe('idle');
  });

  it('forwards the existing decoded playback level without enabling microphone capture', () => {
    const setPlaybackAudioLevel = vi.fn();
    render(
      <PlaybackAudioLevelContext.Provider value={setPlaybackAudioLevel}>
        <VoiceControls client={{} as PublicClientApplication} config={config} />
      </PlaybackAudioLevelContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    const instance = clients.instances[0];
    if (!instance) throw new Error('Voice client was not created.');
    const options = instance.options as {
      onAudioLevel: (level: number) => void;
      onStatus: (status: 'ready', message: string) => void;
    };

    act(() => options.onStatus('ready', 'Microphone is off.'));
    expect(instance.client.enableMicrophone).not.toHaveBeenCalled();
    expect(setPlaybackAudioLevel).not.toHaveBeenCalled();

    act(() => options.onAudioLevel(0.65));
    expect(setPlaybackAudioLevel).toHaveBeenLastCalledWith(0.65);
    act(() => options.onAudioLevel(0));
    expect(setPlaybackAudioLevel).toHaveBeenLastCalledWith(0);
  });

  it('does not carry pending microphone permission into a new session', async () => {
    render(<VoiceControls client={{} as PublicClientApplication} config={config} />);
    const startSession = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
      const instance = clients.instances.at(-1);
      if (!instance) throw new Error('Voice client was not created.');
      const options = instance.options as { onStatus: (status: 'ready', message: string) => void };
      act(() => options.onStatus('ready', 'Microphone is off.'));
      return instance;
    };
    const first = startSession();
    let finishFirst!: () => void;
    first.client.enableMicrophone.mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Enable microphone' }));
    fireEvent.click(screen.getByRole('button', { name: 'End voice' }));

    const second = startSession();
    expect(screen.getByRole('button', { name: 'Enable microphone' })).toHaveProperty('disabled', false);
    let finishSecond!: () => void;
    second.client.enableMicrophone.mockImplementationOnce(() => new Promise<void>((resolve) => { finishSecond = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Enable microphone' }));
    await act(async () => { finishFirst(); });
    expect(screen.getByRole('button', { name: 'Enabling microphone…' })).toHaveProperty('disabled', true);
    await act(async () => { finishSecond(); });
    expect(screen.getByRole('button', { name: 'Enable microphone' })).toHaveProperty('disabled', false);
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

    await waitFor(() => expect(camera.inspect).toHaveBeenCalledWith('42'));
    expect(instance.client.sendScreenContext).toHaveBeenCalledWith('A red mug.', undefined);
    act(() => options.onStatus('stopped', 'Voice is off.'));
    expect(camera.stop).toHaveBeenCalledOnce();
  });
});
