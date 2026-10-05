import type { PublicClientApplication } from '@azure/msal-browser';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '../config/public-config';
import { useJarvisActivity } from './activity-context';
import { JarvisActivityProvider } from './activity-provider';
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
  const { working } = useJarvisActivity();
  return <output aria-label="Jarvis work state">{working ? 'working' : 'idle'}</output>;
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
    expect(screen.queryByRole('button', { name: 'Mute' })).toBeNull();
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
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Stop voice' }));
    expect(instance.client.enableMicrophone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Enable microphone' }));
    expect(instance.client.enableMicrophone).toHaveBeenCalledOnce();
    act(() => options.onStatus('listening', 'Listening for your voice.'));
    expect(screen.getByLabelText('Jarvis work state').textContent).toBe('idle');
    const mute = screen.getByRole('button', { name: 'Mute' });
    expect(mute).toHaveProperty('disabled', false);
    fireEvent.click(mute);
    expect(instance.client.setMuted).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { name: 'Unmute' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Stop voice' }));
    expect(instance.client.stop).toHaveBeenCalledOnce();
    expect(onSessionEnded).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Start voice' })).not.toBeNull();
    expect(screen.getByLabelText('Jarvis work state').textContent).toBe('idle');
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
      onStatus: (status: 'listening' | 'thinking' | 'speaking', message: string) => void;
    };

    act(() => options.onStatus('thinking', 'Jarvis is thinking.'));
    expect(screen.getByLabelText('Jarvis work state').textContent).toBe('working');
    act(() => options.onStatus('speaking', 'Jarvis is speaking.'));
    expect(screen.getByLabelText('Jarvis work state').textContent).toBe('working');
    act(() => options.onStatus('listening', 'Listening for your voice.'));
    expect(screen.getByLabelText('Jarvis work state').textContent).toBe('idle');
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
    fireEvent.click(screen.getByRole('button', { name: 'Stop voice' }));

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
      inspect: vi.fn(async () => 'A red mug.'),
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
    expect(instance.client.sendScreenContext).toHaveBeenCalledWith('A red mug.');
    act(() => options.onStatus('stopped', 'Voice is off.'));
    expect(camera.stop).toHaveBeenCalledOnce();
  });
});
