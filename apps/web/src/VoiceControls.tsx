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
  const { voiceActivity } = useJarvisActivity();
  const client = useRef<BrowserVoiceClient | null>(null);
  const screenSessionIdRef = useRef<string | null>(null);
  const [clientStatus, setClientStatus] = useState<VoiceStatus>('stopped');
  const [clientMessage, setClientMessage] = useState(initialMessage);
  const [audioLevel, setAudioLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const stopButton = useRef<HTMLButtonElement>(null);
  const [screenSessionId, setScreenSessionId] = useState<string | null>(null);
  const [screenError, setScreenError] = useState('');
  const runtimeVoiceActivity = voiceActivity?.source === 'voice' ? voiceActivity : null;
  const runtimeStatus = runtimeVoiceActivity?.type === 'tool-call-started' ||
      runtimeVoiceActivity?.type === 'tool-call-finished' ? 'tool_call'
    : runtimeVoiceActivity?.type === 'interrupted' ? 'interrupted'
      : runtimeVoiceActivity?.type === 'failed' && clientStatus === 'error' ? 'error'
        : runtimeVoiceActivity?.type === 'listening' || runtimeVoiceActivity?.type === 'thinking' ||
            runtimeVoiceActivity?.type === 'speaking' || runtimeVoiceActivity?.type === 'reconnecting'
          ? runtimeVoiceActivity.type
          : null;
  const status = runtimeStatus ?? clientStatus;
  const message = runtimeVoiceActivity?.type === 'tool-call-started'
    ? `Jarvis is using ${runtimeVoiceActivity.toolName}.`
    : runtimeVoiceActivity?.type === 'tool-call-finished'
      ? `${runtimeVoiceActivity.toolName} ${runtimeVoiceActivity.outcome}.`
      : runtimeVoiceActivity?.type === 'interrupted'
        ? 'Jarvis’s response was interrupted.'
        : runtimeVoiceActivity?.type === 'failed'
          ? 'Voice activity failed.'
          : runtimeVoiceActivity?.type === 'listening'
            ? 'Listening for your voice.'
            : runtimeVoiceActivity?.type === 'thinking'
              ? 'Jarvis is thinking.'
              : runtimeVoiceActivity?.type === 'speaking'
                ? 'Jarvis is speaking.'
                : runtimeVoiceActivity?.type === 'reconnecting'
                  ? 'Voice connection ended. Reconnecting…'
                  : clientMessage;
  const active = status !== 'stopped' && status !== 'error';
  const pending = status === 'connecting' || status === 'reconnecting' || status === 'stopping';

  useEffect(() => () => {
    client.current?.stop();
    client.current = null;
  }, []);

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
        .filter((details) => !details.closest('[hidden]'));
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
        setClientStatus(nextStatus);
        setClientMessage(nextMessage);
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
      {active && <VoiceOrb status={status} message={message} audioLevel={audioLevel} />}
      {status === 'error' && <p className="voice-error" role="alert">{message}</p>}
      {!active && <p id="voice-start-guidance" className="visually-hidden">{initialMessage}</p>}
      {active && (
        <button ref={stopButton} className="secondary-button voice-end-control" type="button"
          onClick={stop} disabled={status === 'stopping'} aria-describedby="voice-status">
          End voice
        </button>
      )}
      <div className="action-row">
        {active
          ? null
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
        {active && (
          <>
            <button className="secondary-button" type="button" onClick={() => void inspectAndSendVision('screen')}
              disabled={!screenShare?.sharing || !screenSessionId || pending || Boolean(screenShare.inspecting)}>
              Look at screen
            </button>
            <button className="secondary-button" type="button" onClick={() => void inspectAndSendVision('camera')}
              disabled={!camera?.sharing || !screenSessionId || pending || Boolean(camera?.inspecting)}
              aria-describedby="voice-camera-guidance">
              Look at camera
            </button>
          </>
        )}
      </div>
      <span id="voice-camera-guidance" className="visually-hidden">
        Turn on the camera from the top bar before asking Jarvis to inspect a frame.
      </span>
      {screenError && <p role="alert">{screenError}</p>}
    </div>
  );
}
