import type { PublicClientApplication } from '@azure/msal-browser';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '../config/public-config';
import { VoiceControls } from './VoiceControls';

const clients = vi.hoisted(() => ({
  instances: [] as Array<{
    options: unknown;
    client: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; setMuted: ReturnType<typeof vi.fn>; enableMicrophone: ReturnType<typeof vi.fn> };
  }>,
}));

vi.mock('./voice-client', () => ({
  BrowserVoiceClient: class {
    readonly start = vi.fn();
    readonly setMuted = vi.fn();
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

beforeEach(() => {
  clients.instances.length = 0;
});

describe('VoiceControls', () => {
  it('starts the selected language, mutes and stops the active session', () => {
    const onSessionEnded = vi.fn();
    render(
      <VoiceControls
        client={{} as PublicClientApplication}
        config={config}
        language="en"
        onSessionEnded={onSessionEnded}
      />,
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
    const mute = screen.getByRole('button', { name: 'Mute' });
    expect(mute).toHaveProperty('disabled', false);
    fireEvent.click(mute);
    expect(instance.client.setMuted).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { name: 'Unmute' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Stop voice' }));
    expect(instance.client.stop).toHaveBeenCalledOnce();
    expect(onSessionEnded).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Start voice' })).not.toBeNull();
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
});
