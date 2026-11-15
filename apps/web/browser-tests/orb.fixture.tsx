import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JarvisActivityContext, type JarvisActivity } from '../src/activity-context';
import { InputOrbCore } from '../src/InputOrbCore';
import { JarvisStage } from '../src/JarvisStage';
import { VoiceStageContext } from '../src/voice-stage-context';
import { WorkingCore } from '../src/ToolCallChip';
import type { JarvisOrbState } from '../src/voice-presentation';
import type { ThemeMode } from '../src/theme-preference-context';
import '../src/styles.css';
import '../src/ConversationHistory.css';

/*
 * The Jarvis orb in the real stage scene and at its small sizes, without signing in or calling a backend.
 * Query: theme=dark|light, motion=reduced, state=idle|listening|thinking|tool|speaking, voice=1 (voice awake),
 * stage=0 (small orbs only, for timing the heart pulse without the 3D room).
 * The buttons drive the same VoiceStageContext link the voice controls use.
 */
const params = new URLSearchParams(window.location.search);
const theme: ThemeMode = params.get('theme') === 'light' ? 'light' : 'dark';
const reduced = params.get('motion') === 'reduced';
const voice = params.get('voice') === '1';
const stage = params.get('stage') !== '0';
const states: JarvisOrbState[] = ['idle', 'listening', 'thinking', 'tool', 'speaking'];
const initialState = states.find((state) => state === params.get('state')) ?? 'idle';

document.documentElement.dataset.theme = theme;
document.documentElement.style.colorScheme = theme;
if (reduced) document.documentElement.dataset.motion = 'reduced';

const idleActivity: JarvisActivity = {
  working: false, workText: null, voiceActivity: null, latestActivity: null,
  applyRuntimeActivity: () => {}, clearRuntimeActivities: () => {},
};

function Controls() {
  const link = useContext(VoiceStageContext);
  const [state, setState] = useState<JarvisOrbState>(initialState);
  const time = useRef(0);
  useEffect(() => {
    link.setOrbState(state === 'idle' ? null : state);
    // Synthetic levels stand in for the microphone and for decoded playback.
    link.setSignals({
      playbackLevel: () => 0.25 + 0.6 * (0.5 + 0.5 * Math.sin((time.current += 0.033) * 7.3)),
      inputLevel: () => 0.2 + 0.5 * (0.5 + 0.5 * Math.sin(time.current * 5.1)),
    });
    return () => link.setSignals(null);
  }, [link, state]);
  return (
    <div className="orb-fixture-controls" role="group" aria-label="Orb state">
      {states.map((name) => (
        <button key={name} type="button" className="secondary-button" aria-pressed={state === name}
          onClick={() => setState(name)}>{name}</button>
      ))}
    </div>
  );
}

function Gallery() {
  return (
    <div className="orb-fixture-gallery">
      <button className="input-orb" type="button" aria-label="Start voice"><span aria-hidden="true"><InputOrbCore /></span></button>
      <button className="input-orb rail-chat-orb" type="button" aria-label="Open chat"><span aria-hidden="true"><InputOrbCore /></span></button>
      <WorkingCore />
      <span className="live-turn-status"><WorkingCore /></span>
    </div>
  );
}

function Fixture() {
  const shell = useRef<HTMLDivElement>(null);
  const appearance = useMemo(() => ({ theme, motion: reduced ? 'reduced' as const : 'full' as const }), []);
  const busy = initialState === 'thinking' || initialState === 'tool';
  const activity = useMemo<JarvisActivity>(() => ({ ...idleActivity, working: busy }), [busy]);
  return (
    <JarvisActivityContext.Provider value={activity}>
      <div ref={shell} className="app app-shell" data-voice-active={voice}>
        <main className="shell-main jarvis-page">
          {stage ? (
            <JarvisStage theme={theme} appearance={appearance}>
              <Controls />
              <Gallery />
            </JarvisStage>
          ) : <Gallery />}
        </main>
      </div>
    </JarvisActivityContext.Provider>
  );
}

const style = document.createElement('style');
style.textContent = `
  .orb-fixture-controls { position: fixed; z-index: 5; top: 12px; left: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
  .orb-fixture-gallery { position: fixed; z-index: 5; bottom: 16px; left: 12px; display: flex; align-items: center; gap: 20px; }
`;
document.head.append(style);
createRoot(document.getElementById('root')!).render(<Fixture />);
