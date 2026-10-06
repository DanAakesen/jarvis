import type { PublicClientApplication } from '@azure/msal-browser';
import { useContext, useEffect, useRef, useState } from 'react';
import type { PublicConfig } from '../config/public-config';
import { useJarvisActivity } from './activity-context';
import { ConversationMoreMenu, type MoreMenuAction } from './ConversationMoreMenu';
import { PlaybackAudioLevelContext } from './playback-audio-context';
import { VoiceBarStatus } from './VoiceBarStatus';
import { BrowserVoiceClient, type VoiceLanguage, type VoiceStatus } from './voice-client';
import { languageName } from './voice-language';
import type { CameraController, ScreenShareController } from './screen-sharing';

const initialMessage = 'Start voice with the input orb. Your microphone stays off until you enable it.';
const cameraGuidance = 'Turn on the camera from the top bar before asking Jarvis to inspect a frame.';
const screenGuidance = 'Start screen sharing from Activity, sharing and backend before asking Jarvis to inspect a frame.';
const sessionPendingGuidance = 'Available once the voice session is connected.';

function MenuGlyph({ name }: { name: 'microphone' | 'microphone-off' | 'screen' | 'camera' }) {
  const common = { 'aria-hidden': true as const, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'microphone':
      return <svg {...common}><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8" /></svg>;
    case 'microphone-off':
      return <svg {...common}><path d="M12 3a3 3 0 0 0-3 3v4m6 0V6a3 3 0 0 0-4.8-2.4M5 10v2a7 7 0 0 0 12 4.9M19 10v2a7 7 0 0 1-.5 2.6M12 19v3m-4 0h8M3 3l18 18" /></svg>;
    case 'screen':
      return <svg {...common}><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></svg>;
    case 'camera':
      return <svg {...common}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></svg>;
  }
}

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
  onLanguageChange,
  onSessionEnded,
  onActiveChange,
  disabled = false,
  screenShare,
  camera,
}: {
  client: PublicClientApplication;
  config: PublicConfig;
  language?: VoiceLanguage;
  onLanguageChange?: (language: VoiceLanguage) => void;
  onSessionEnded?: () => void;
  onActiveChange?: (active: boolean) => void;
  disabled?: boolean;
  screenShare?: ScreenShareController;
  camera?: CameraController;
}) {
  const { voiceActivity } = useJarvisActivity();
  const setPlaybackAudioLevel = useContext(PlaybackAudioLevelContext);
  const client = useRef<BrowserVoiceClient | null>(null);
  const screenSessionIdRef = useRef<string | null>(null);
  const [clientStatus, setClientStatus] = useState<VoiceStatus>('stopped');
  const [clientMessage, setClientMessage] = useState(initialMessage);
  const [audioLevel, setAudioLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const stopButton = useRef<HTMLButtonElement>(null);
  const voiceBar = useRef<HTMLDivElement>(null);
  const [screenSessionId, setScreenSessionId] = useState<string | null>(null);
  const [screenError, setScreenError] = useState('');
  const [localLanguage, setLocalLanguage] = useState<VoiceLanguage>(language);
  const [sessionLanguage, setSessionLanguage] = useState<VoiceLanguage | null>(null);
  const selectedLanguage = onLanguageChange ? language : localLanguage;
  const changeLanguage = onLanguageChange ?? setLocalLanguage;
  const runtimeVoiceActivity = voiceActivity?.source === 'voice' ? voiceActivity : null;
  // The browser's own transport state wins: a stale runtime event must never claim Jarvis is
  // listening while the relay is connecting, reconnecting or ending, or before the microphone is on.
  const transportOwnsStatus = clientStatus === 'stopped' || clientStatus === 'connecting' ||
    clientStatus === 'reconnecting' || clientStatus === 'stopping' || clientStatus === 'error';
  const microphoneOpen = clientStatus === 'listening' || clientStatus === 'thinking' || clientStatus === 'speaking';
  const runtime: { status: VoiceStatus | 'tool_call' | 'interrupted'; message: string } | null =
    transportOwnsStatus || !runtimeVoiceActivity ? null
      : runtimeVoiceActivity.type === 'tool-call-started'
        ? { status: 'tool_call', message: `Jarvis is using ${runtimeVoiceActivity.toolName}.` }
        : runtimeVoiceActivity.type === 'tool-call-finished'
          ? { status: 'tool_call', message: `${runtimeVoiceActivity.toolName} ${runtimeVoiceActivity.outcome}.` }
          : runtimeVoiceActivity.type === 'interrupted'
            ? { status: 'interrupted', message: 'Jarvis’s response was interrupted.' }
            : runtimeVoiceActivity.type === 'failed'
              ? { status: clientStatus, message: 'Voice activity failed.' }
              : runtimeVoiceActivity.type === 'listening'
                ? microphoneOpen ? { status: 'listening', message: 'Listening for your voice.' } : null
                : runtimeVoiceActivity.type === 'thinking'
                  ? { status: 'thinking', message: 'Jarvis is thinking.' }
                  : runtimeVoiceActivity.type === 'speaking'
                    ? { status: 'speaking', message: 'Jarvis is speaking.' }
                    : runtimeVoiceActivity.type === 'reconnecting'
                      ? { status: 'reconnecting', message: 'Voice connection ended. Reconnecting…' }
                      : null;
  const status = runtime?.status ?? clientStatus;
  const message = runtime?.message ?? clientMessage;
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
    const bar = voiceBar.current;
    const appShell = bar?.closest<HTMLElement>('.app-shell');
    if (!active || !bar || !appShell || typeof ResizeObserver !== 'function') return;
    // Phone layouts reserve the bar's real height so workspace windows never sit underneath it.
    const update = () => appShell.style.setProperty('--voice-bar-height', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      appShell.style.removeProperty('--voice-bar-height');
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
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
    setSessionLanguage(selectedLanguage);
    const voice = new BrowserVoiceClient({
      backendUrl: config.backendUrl,
      getAccessToken: () => accessToken(authClient, config),
      language: selectedLanguage,
      ...(onSessionEnded ? { onSessionEnded } : {}),
      onAudioLevel: (level) => {
        const normalized = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
        setAudioLevel(normalized);
        setPlaybackAudioLevel(normalized);
      },
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
          setSessionLanguage(null);
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
      setScreenError(source === 'camera' ? cameraGuidance : screenGuidance);
      if (source === 'screen') {
        try { client.current.sendScreenContextUnavailable(); } catch { /* The voice session may be closing. */ }
      }
      return;
    }
    try {
      const context = await capture.inspect(sessionId);
      client.current.sendScreenContext(
        context.description,
        source === 'screen' ? context.sharedWindowTitle : undefined,
      );
    } catch (reason) {
      setScreenError(reason instanceof Error ? reason.message : 'Jarvis could not inspect the visual frame.');
      if (source === 'screen') {
        try { client.current.sendScreenContextUnavailable(); } catch { /* The voice session may be closing. */ }
      }
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

  const visionUnavailable = (sharing: boolean | undefined, inspecting: boolean | undefined, guidance: string, busy: string) =>
    !sharing ? guidance : !screenSessionId || pending ? sessionPendingGuidance : inspecting ? busy : undefined;
  const screenUnavailable = visionUnavailable(screenShare?.sharing, screenShare?.inspecting, screenGuidance,
    'Jarvis is already looking at the screen.');
  const cameraUnavailable = visionUnavailable(camera?.sharing, camera?.inspecting, cameraGuidance,
    'Jarvis is already looking at the camera.');
  const menuActions: MoreMenuAction[] = [
    ...(status === 'ready' ? [] : [{
      id: 'mute',
      label: muted ? 'Unmute microphone' : 'Mute microphone',
      icon: <MenuGlyph name={muted ? 'microphone' : 'microphone-off'} />,
      onSelect: toggleMute,
      disabled: pending,
      ...(pending ? { description: sessionPendingGuidance } : {}),
    }]),
    {
      id: 'screen',
      label: 'Look at screen',
      icon: <MenuGlyph name="screen" />,
      onSelect: () => void inspectAndSendVision('screen'),
      disabled: Boolean(screenUnavailable),
      ...(screenUnavailable ? { description: screenUnavailable } : {}),
    },
    {
      id: 'camera',
      label: 'Look at camera',
      icon: <MenuGlyph name="camera" />,
      onSelect: () => void inspectAndSendVision('camera'),
      disabled: Boolean(cameraUnavailable),
      ...(cameraUnavailable ? { description: cameraUnavailable } : {}),
    },
  ];
  const languageNote = sessionLanguage && sessionLanguage !== selectedLanguage
    ? `${languageName(selectedLanguage)} is selected for chat and your next voice session. This session continues in ${languageName(sessionLanguage)}.`
    : '';

  return (
    <div className="voice-controls" data-active={active}>
      {status === 'error' && <p className="voice-error" role="alert">{message}</p>}
      {!active && <p id="voice-start-guidance" className="visually-hidden">{initialMessage}</p>}
      {active ? (
        <div ref={voiceBar} className="voice-bar luminous-glass" role="group" aria-label="Voice controls" data-state={status}
          data-language-note={Boolean(languageNote)}>
          <ConversationMoreMenu language={selectedLanguage} onLanguageChange={changeLanguage} actions={menuActions} />
          <span className="voice-bar-divider" aria-hidden="true" />
          <VoiceBarStatus status={status} message={message} muted={muted} audioLevel={audioLevel} />
          {status === 'ready' && (
            <button className="voice-bar-action" type="button" onClick={() => void enableMicrophone()}
              disabled={enabling} aria-describedby="voice-status-detail">
              {enabling ? 'Enabling microphone…' : 'Enable microphone'}
            </button>
          )}
          <span className="voice-bar-divider" aria-hidden="true" />
          <button ref={stopButton} className="voice-end-control" type="button"
            onClick={stop} disabled={status === 'stopping'} aria-describedby="voice-status-detail">
            <span className="voice-end-glyph" aria-hidden="true" />
            End voice
          </button>
          {languageNote && <p className="voice-bar-note" role="status">{languageNote}</p>}
        </div>
      ) : (
        <div className="action-row">
          <button className="input-orb" type="button" onClick={start} disabled={disabled} aria-label="Start voice" aria-describedby="voice-start-guidance" title="Start voice"><span aria-hidden="true" /></button>
          <span className="voice-start-label" aria-hidden="true">Start voice</span>
        </div>
      )}
      {screenError && <p className="voice-screen-error" role="alert">{screenError}</p>}
    </div>
  );
}
