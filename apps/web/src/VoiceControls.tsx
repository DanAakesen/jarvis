import type { PublicClientApplication } from '@azure/msal-browser';
import type { JarvisActivityEvent } from '@jarvis/contracts';
import { useContext, useEffect, useRef, useState } from 'react';
import type { PublicConfig } from '../config/public-config';
import { useJarvisActivity } from './activity-context';
import { ConversationMoreMenu, type MoreMenuAction } from './ConversationMoreMenu';
import { VoiceOrbStatus } from './VoiceOrbStatus';
import { BrowserVoiceClient, type MicrophoneState, type VoiceLanguage, type VoiceStatus } from './voice-client';
import { languageName } from './voice-language';
import { voicePresentation } from './voice-presentation';
import { VoiceStageContext } from './voice-stage-context';
import type { CameraController, ScreenShareController } from './screen-sharing';
import './VoiceControls.css';

const initialMessage = 'Start voice with the input orb. Your browser asks for microphone access when voice starts; Jarvis only hears you after the voice session is connected.';
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
  const stage = useContext(VoiceStageContext);
  const client = useRef<BrowserVoiceClient | null>(null);
  const screenSessionIdRef = useRef<string | null>(null);
  const [clientStatus, setClientStatus] = useState<VoiceStatus>('stopped');
  const [clientMessage, setClientMessage] = useState(initialMessage);
  const [microphone, setMicrophone] = useState<MicrophoneState>('off');
  const [muted, setMuted] = useState(false);
  const stopButton = useRef<HTMLButtonElement>(null);
  const voiceBar = useRef<HTMLDivElement>(null);
  const voiceStatus = useRef<HTMLDivElement>(null);
  const [screenSessionId, setScreenSessionId] = useState<string | null>(null);
  const [screenError, setScreenError] = useState('');
  const [localLanguage, setLocalLanguage] = useState<VoiceLanguage>(language);
  const [sessionLanguage, setSessionLanguage] = useState<VoiceLanguage | null>(null);
  // Runtime activity that already existed when this session started belongs to an earlier session.
  const [staleActivity, setStaleActivity] = useState<JarvisActivityEvent | null>(null);
  const selectedLanguage = onLanguageChange ? language : localLanguage;
  const changeLanguage = onLanguageChange ?? setLocalLanguage;
  const sessionActivity = voiceActivity?.source === 'voice' && voiceActivity !== staleActivity ? voiceActivity : null;
  const presentation = voicePresentation({
    status: clientStatus,
    message: clientMessage,
    microphone,
    muted,
    activity: sessionActivity,
  });
  const active = clientStatus !== 'stopped' && clientStatus !== 'error';
  const pending = clientStatus === 'connecting' || clientStatus === 'reconnecting' || clientStatus === 'stopping';
  const orbState = active ? presentation.orb : null;

  useEffect(() => {
    stage.setOrbState(orbState);
  }, [orbState, stage]);

  useEffect(() => () => {
    stage.setOrbState(null);
    stage.setSignals(null);
  }, [stage]);

  useEffect(() => () => {
    client.current?.stop();
    client.current = null;
  }, []);

  useEffect(() => {
    if (active) stopButton.current?.focus();
  }, [active]);

  useEffect(() => {
    const bar = voiceBar.current;
    const status = voiceStatus.current;
    const appShell = bar?.closest<HTMLElement>('.app-shell');
    if (!active || !bar || !status || !appShell || typeof ResizeObserver !== 'function') return;
    // Phone layouts reserve the bar's and docked status's real heights so windows never sit underneath them.
    const update = () => {
      appShell.style.setProperty('--voice-bar-height', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
      appShell.style.setProperty('--voice-status-height', `${Math.ceil(status.getBoundingClientRect().height)}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    observer.observe(status);
    return () => {
      observer.disconnect();
      appShell.style.removeProperty('--voice-bar-height');
      appShell.style.removeProperty('--voice-status-height');
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
    setStaleActivity(voiceActivity);
    setMuted(false);
    setMicrophone('off');
    const voice = new BrowserVoiceClient({
      backendUrl: config.backendUrl,
      getAccessToken: () => accessToken(authClient, config),
      language: selectedLanguage,
      ...(onSessionEnded ? { onSessionEnded } : {}),
      onSessionReady: (sessionId) => {
        screenSessionIdRef.current = sessionId;
        setScreenSessionId(sessionId);
      },
      onVisionRequest: (source) => { void inspectAndSendVision(source); },
      onMicrophoneState: (state) => {
        if (client.current === voice) setMicrophone(state);
      },
      onStatus: (nextStatus, nextMessage) => {
        if (client.current !== voice) return;
        setClientStatus(nextStatus);
        setClientMessage(nextMessage);
        if (nextStatus === 'stopped' || nextStatus === 'error') {
          client.current = null;
          stage.setSignals(null);
          setSessionLanguage(null);
          screenSessionIdRef.current = null;
          setScreenSessionId(null);
          screenShare?.stop();
          camera?.stop();
          setMuted(false);
          setMicrophone('off');
          onActiveChange?.(false);
        }
      },
    });
    client.current = voice;
    stage.setSignals({
      playbackLevel: () => voice.playbackLevel(),
      inputLevel: () => voice.inputLevel(),
    });
    // Called synchronously inside the Start voice gesture: browser audio and the native microphone
    // prompt are requested now, while audio is only sent after the authenticated handshake.
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
  const microphoneReady = microphone === 'live' || microphone === 'granted';
  const menuActions: MoreMenuAction[] = [
    ...(presentation.canRetryMicrophone ? [{
      id: 'retry-microphone',
      label: 'Retry microphone',
      icon: <MenuGlyph name="microphone" />,
      onSelect: () => { void client.current?.retryMicrophone(); },
    }] : []),
    ...(microphoneReady ? [{
      id: 'mute',
      label: muted ? 'Unmute microphone' : 'Mute microphone',
      icon: <MenuGlyph name={muted ? 'microphone' : 'microphone-off'} />,
      onSelect: toggleMute,
      disabled: pending,
      ...(pending ? { description: sessionPendingGuidance } : {}),
    }] : []),
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
  const languageNote = !sessionLanguage ? ''
    : sessionLanguage !== selectedLanguage
      ? `${languageName(selectedLanguage)} is selected for chat and your next voice session. This session continues in ${languageName(sessionLanguage)}.`
      : `This voice session uses ${languageName(sessionLanguage)}. A new choice applies to chat now and to your next voice session.`;

  return (
    <div className="voice-controls" data-active={active}>
      {clientStatus === 'error' && <p className="voice-error" role="alert">{clientMessage}</p>}
      {!active && <p id="voice-start-guidance" className="visually-hidden">{initialMessage}</p>}
      {active ? (
        <>
          <div ref={voiceStatus} className="voice-status-region">
            <VoiceOrbStatus presentation={presentation} />
          </div>
          <div ref={voiceBar} className="voice-bar luminous-glass" role="group" aria-label="Voice controls"
            data-state={presentation.state}>
            <ConversationMoreMenu language={selectedLanguage} onLanguageChange={changeLanguage} actions={menuActions}
              {...(languageNote ? { languageNote } : {})} />
            <span className="voice-bar-divider" aria-hidden="true" />
            <button ref={stopButton} className="voice-end-control" type="button"
              onClick={stop} disabled={clientStatus === 'stopping'} aria-describedby="voice-status voice-status-detail">
              <span className="voice-end-glyph" aria-hidden="true" />
              End voice
            </button>
          </div>
        </>
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
