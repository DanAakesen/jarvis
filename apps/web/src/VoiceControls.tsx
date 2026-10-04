import type { PublicClientApplication } from '@azure/msal-browser';
import { useEffect, useRef, useState } from 'react';
import type { PublicConfig } from '../config/public-config';
import { VoiceOrb } from './VoiceOrb';
import { BrowserVoiceClient, type VoiceLanguage, type VoiceStatus } from './voice-client';

const initialMessage = 'Start voice to speak with Jarvis. Your microphone opens after the voice session is ready.';

async function accessToken(client: PublicClientApplication, config: PublicConfig): Promise<string> {
  const account = client.getActiveAccount() ?? client.getAllAccounts()[0];
  if (!account) throw new Error('Your Microsoft sign-in needs attention. Sign in again.');
  try {
    const result = await client.acquireTokenSilent({ scopes: [config.apiScope], account });
    if (result.accessToken) return result.accessToken;
  } catch {
    throw new Error('Your Microsoft sign-in needs attention. Sign in again.');
  }
  throw new Error('Microsoft sign-in did not return an API token.');
}

export function VoiceControls({
  client: authClient,
  config,
  language = 'da',
  onSessionEnded,
}: {
  client: PublicClientApplication;
  config: PublicConfig;
  language?: VoiceLanguage;
  onSessionEnded?: () => void;
}) {
  const client = useRef<BrowserVoiceClient | null>(null);
  const [status, setStatus] = useState<VoiceStatus>('stopped');
  const [message, setMessage] = useState(initialMessage);
  const [muted, setMuted] = useState(false);
  const active = status !== 'stopped' && status !== 'error';
  const pending = status === 'connecting' || status === 'reconnecting' || status === 'stopping';

  useEffect(() => () => {
    client.current?.stop();
    client.current = null;
  }, []);

  const start = () => {
    const voice = new BrowserVoiceClient({
      backendUrl: config.backendUrl,
      getAccessToken: () => accessToken(authClient, config),
      language,
      ...(onSessionEnded ? { onSessionEnded } : {}),
      onStatus: (nextStatus, nextMessage) => {
        setStatus(nextStatus);
        setMessage(nextMessage);
        if (nextStatus === 'stopped' || nextStatus === 'error') {
          client.current = null;
          setMuted(false);
        }
      },
    });
    client.current = voice;
    voice.start();
  };

  const stop = () => {
    client.current?.stop();
    client.current = null;
    setMuted(false);
  };

  const toggleMute = () => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    client.current?.setMuted(nextMuted);
  };

  return (
    <>
      <VoiceOrb status={status} message={message} />
      <div className="action-row">
        {active
          ? <button className="secondary-button" type="button" onClick={stop} disabled={status === 'stopping'}>Stop voice</button>
          : <button className="primary-button" type="button" onClick={start} disabled={pending}>Start voice</button>}
        <button
          className="secondary-button"
          type="button"
          onClick={toggleMute}
          disabled={!active || pending}
          aria-describedby="voice-status"
          aria-pressed={muted}
        >
          {muted ? 'Unmute' : 'Mute'}
        </button>
      </div>
    </>
  );
}
