import type { PublicClientApplication } from '@azure/msal-browser';
import { useEffect, useRef, useState } from 'react';
import type { PublicConfig } from '../config/public-config';
import { useJarvisActivity } from './activity-context';
import { VoiceOrb } from './VoiceOrb';
import { BrowserVoiceClient, type VoiceLanguage, type VoiceStatus } from './voice-client';
import type { CameraController, ScreenShareController } from './screen-sharing';

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
  camera,
}: {
  client: PublicClientApplication;
  config: PublicConfig;
  language?: VoiceLanguage;
  onSessionEnded?: () => void;
  onActiveChange?: (active: boolean) => void;
  disabled?: boolean;
  screenShare?: ScreenShareController;
  camera?: CameraController;
}) {
  const { setWorking } = useJarvisActivity();
  const client = useRef<BrowserVoiceClient | null>(null);
  const screenSessionIdRef = useRef<string | null>(null);
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

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
      if (dialog) {
        event.preventDefault();
        dialog.close();
        return;
      }
      const openDetails = Array.from(document.querySelectorAll<HTMLDetailsElement>('details[open]'))
        .filter((details) => !details.closest('[hidden], [inert]'));
      const focusedDetails = document.activeElement instanceof HTMLElement
        ? document.activeElement.closest<HTMLDetailsElement>('details[open]')
        : null;
      const details = focusedDetails && openDetails.includes(focusedDetails)
        ? focusedDetails
        : openDetails.at(-1);
      if (details) {
        event.preventDefault();
        details.open = false;
        details.querySelector('summary')?.focus();
        return;
      }
      event.preventDefault();
      client.current?.stop();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active]);

  const start = () => {
    if (client.current || disabled) return;
    onActiveChange?.(true);
    screenSessionIdRef.current = null;
    setScreenSessionId(null);
    const voice = new BrowserVoiceClient({
      backendUrl: config.backendUrl,
      getAccessToken: () => accessToken(authClient, config),
      language,
      ...(onSessionEnded ? { onSessionEnded } : {}),
      onAudioLevel: (level) => setAudioLevel(Math.max(0, Math.min(1, level))),
      onSessionReady: (sessionId) => {
        screenSessionIdRef.current = sessionId;
        setScreenSessionId(sessionId);
      },
      onVisionRequest: (source) => { void inspectAndSendVision(source); },
      onStatus: (nextStatus, nextMessage) => {
        setStatus(nextStatus);
        setMessage(nextMessage);
        setWorking('voice-turn', nextStatus === 'thinking' || nextStatus === 'speaking');
        if (nextStatus === 'stopped' || nextStatus === 'error') {
          client.current = null;
          screenSessionIdRef.current = null;
          setScreenSessionId(null);
          screenShare?.stop();
          camera?.stop();
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

  const inspectAndSendVision = async (source: 'camera' | 'screen') => {
    const capture = source === 'camera' ? camera : screenShare;
    const sessionId = screenSessionIdRef.current;
    if (!sessionId || !client.current) return;
    setScreenError('');
    if (!capture?.sharing) {
      setScreenError(source === 'camera'
        ? 'Turn on the camera from the top bar before asking Jarvis to inspect a frame.'
        : 'Start screen sharing before asking Jarvis to inspect a frame.');
      return;
    }
    try {
      const description = await capture.inspect(sessionId);
      client.current.sendScreenContext(description);
    } catch (reason) {
      setScreenError(reason instanceof Error ? reason.message : 'Jarvis could not inspect the visual frame.');
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
      {status === 'error' && <p className="voice-error" role="alert">{message}</p>}
      {!active && <p id="voice-start-guidance" className="visually-hidden">{initialMessage}</p>}
      {active ? (
        <VoiceOrb status={status} message={message} audioLevel={audioLevel}>
          <div className="voice-action-group">
            <div className="voice-icon-controls" role="group" aria-label="Voice controls">
              {status === 'ready' ? (
                <button className="primary-button" type="button" onClick={() => void enableMicrophone()}
                  disabled={enabling} aria-describedby="voice-status-detail">
                  {enabling ? 'Enabling microphone…' : 'Enable microphone'}
                </button>
              ) : (
              <button className="voice-icon-button" type="button" onClick={toggleMute}
                disabled={pending} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute microphone' : 'Mute microphone'}
                aria-describedby="voice-status-detail" aria-pressed={muted}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  {muted
                    ? <><path d="M12 3a3 3 0 0 0-3 3v4m6 0V6a3 3 0 0 0-4.8-2.4M5 10v2a7 7 0 0 0 12 4.9M19 10v2a7 7 0 0 1-.5 2.6M12 19v3m-4 0h8M3 3l18 18" /></>
                    : <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8" /></>}
                </svg>
              </button>
              )}
              <button className="voice-icon-button" type="button" aria-label="Look at screen"
                title={screenShare?.sharing ? 'Look at screen' : 'Start screen sharing before asking Jarvis to look at the screen.'}
                onClick={() => void inspectAndSendVision('screen')}
                disabled={!screenShare?.sharing || !screenSessionId || pending || Boolean(screenShare.inspecting)}
                aria-describedby={!screenShare?.sharing ? 'voice-screen-guidance' : 'voice-status-detail'}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" />
                </svg>
              </button>
              <button className="voice-icon-button" type="button" aria-label="Look at camera"
                title={camera?.sharing ? 'Look at camera' : 'Turn on the camera before asking Jarvis to look at it.'}
                onClick={() => void inspectAndSendVision('camera')}
                disabled={!camera?.sharing || !screenSessionId || pending || Boolean(camera?.inspecting)}
                aria-describedby={!camera?.sharing ? 'voice-camera-guidance' : 'voice-status-detail'}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" />
                </svg>
              </button>
            </div>
            <button ref={stopButton} className="secondary-button voice-end-control" type="button"
              onClick={stop} disabled={status === 'stopping'} aria-describedby="voice-status-detail">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
              End voice
            </button>
          </div>
        </VoiceOrb>
      ) : (
        <div className="action-row">
          <button className="input-orb" type="button" onClick={start} disabled={disabled} aria-label="Start voice" aria-describedby="voice-start-guidance" title="Start voice"><span aria-hidden="true" /></button>
          <span className="voice-start-label" aria-hidden="true">Start voice</span>
        </div>
      )}
      <span id="voice-camera-guidance" className="visually-hidden">
        Turn on the camera from the top bar before asking Jarvis to inspect a frame.
      </span>
      <span id="voice-screen-guidance" className="visually-hidden">
        Start screen sharing from Activity, sharing and backend before asking Jarvis to inspect a frame.
      </span>
      {screenError && <p role="alert">{screenError}</p>}
    </div>
  );
}
