import type { PublicClientApplication } from '@azure/msal-browser';
import { useEffect, useRef, useState } from 'react';
import type { PublicConfig } from '../config/public-config';
import { useJarvisActivity } from './activity-context';
import { VoiceOrb } from './VoiceOrb';
import { BrowserVoiceClient, type VoiceLanguage, type VoiceStatus } from './voice-client';
import type { ScreenShareController } from './screen-sharing';

const initialMessage = 'Start voice with the input orb. Your microphone stays off until you enable it.';

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
  onActiveChange,
  disabled = false,
  screenShare,
}: {
  client: PublicClientApplication;
  config: PublicConfig;
  language?: VoiceLanguage;
  onSessionEnded?: () => void;
  onActiveChange?: (active: boolean) => void;
  disabled?: boolean;
  screenShare?: ScreenShareController;
}) {
  const { setWorking } = useJarvisActivity();
  const client = useRef<BrowserVoiceClient | null>(null);
  const [status, setStatus] = useState<VoiceStatus>('stopped');
  const [message, setMessage] = useState(initialMessage);
  const [audioLevel, setAudioLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const stopButton = useRef<HTMLButtonElement>(null);
  const [screenSessionId, setScreenSessionId] = useState<string | null>(null);
  const [screenError, setScreenError] = useState('');
  const active = status !== 'stopped' && status !== 'error';
  const pending = status === 'connecting' || status === 'reconnecting' || status === 'stopping';

  useEffect(() => () => {
    client.current?.stop();
    client.current = null;
    setWorking('voice-turn', false);
  }, [setWorking]);

  useEffect(() => {
    if (active) stopButton.current?.focus();
  }, [active]);

  const start = () => {
    if (client.current || disabled) return;
    onActiveChange?.(true);
    setScreenSessionId(null);
    const voice = new BrowserVoiceClient({
      backendUrl: config.backendUrl,
      getAccessToken: () => accessToken(authClient, config),
      language,
      ...(onSessionEnded ? { onSessionEnded } : {}),
      onAudioLevel: (level) => setAudioLevel(Math.max(0, Math.min(1, level))),
      onSessionReady: setScreenSessionId,
      onScreenRequest: () => { void inspectAndSendScreen(); },
      onStatus: (nextStatus, nextMessage) => {
        setStatus(nextStatus);
        setMessage(nextMessage);
        setWorking('voice-turn', nextStatus === 'thinking' || nextStatus === 'speaking');
        if (nextStatus === 'stopped' || nextStatus === 'error') {
          client.current = null;
          setScreenSessionId(null);
          screenShare?.stop();
          setMuted(false);
          setEnabling(false);
          onActiveChange?.(false);
        } else if (nextStatus === 'ready') {
          setMuted(false);
        }
      },
    });
    client.current = voice;
    voice.start();
  };

  const inspectAndSendScreen = async () => {
    if (!screenShare || !screenSessionId || !client.current) return;
    setScreenError('');
    try {
      const description = await screenShare.inspect(screenSessionId);
      client.current.sendScreenContext(description);
    } catch (reason) {
      setScreenError(reason instanceof Error ? reason.message : 'Jarvis could not inspect the shared screen.');
    }
  };

  const stop = () => {
    client.current?.stop();
  };

  const enableMicrophone = async () => {
    const voice = client.current;
    if (!voice || enabling) return;
    setEnabling(true);
    try {
      await voice.enableMicrophone();
    } finally {
      if (client.current === voice) setEnabling(false);
    }
  };

  const toggleMute = () => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    client.current?.setMuted(nextMuted);
  };

  return (
    <div className="voice-controls" data-active={active}>
      {active && <VoiceOrb status={status} message={message} audioLevel={audioLevel} />}
      {status === 'error' && <p className="voice-error" role="alert">{message}</p>}
      {!active && <p id="voice-start-guidance" className="visually-hidden">{initialMessage}</p>}
      <div className="action-row">
        {active
          ? <button ref={stopButton} className="secondary-button" type="button" onClick={stop} disabled={status === 'stopping'}>Stop voice</button>
          : <>
              <button className="input-orb" type="button" onClick={start} disabled={disabled} aria-label="Start voice" aria-describedby="voice-start-guidance" title="Start voice"><span aria-hidden="true" /></button>
              <span className="voice-start-label" aria-hidden="true">Start voice</span>
            </>}
        {active && (status === 'ready' ? (
          <button className="primary-button" type="button" onClick={() => void enableMicrophone()} disabled={enabling} aria-describedby="voice-status">
            {enabling ? 'Enabling microphone…' : 'Enable microphone'}
          </button>
        ) : <button
          className="secondary-button"
          type="button"
          onClick={toggleMute}
          disabled={pending}
          aria-describedby="voice-status"
          aria-pressed={muted}
        >
          {muted ? 'Unmute' : 'Mute'}
        </button>)}
        {active && <button className="secondary-button" type="button" onClick={() => void inspectAndSendScreen()}
          disabled={!active || !screenShare?.sharing || !screenSessionId || pending}>
          Look at screen
        </button>}
      </div>
      {screenError && <p role="alert">{screenError}</p>}
    </div>
  );
}
