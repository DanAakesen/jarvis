import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppearancePreferences, ThemeMode } from './theme-preference-context';
import type { JarvisStageOptions, JarvisStageScene } from './jarvis-stage-scene';
import { useJarvisActivity } from './activity-context';
import type { JarvisOrbState } from './voice-presentation';
import { VoiceStageContext, type VoiceSignals, type VoiceStageLink } from './voice-stage-context';
import './JarvisStage.css';

export function JarvisStage({
  theme,
  appearance,
  children,
}: {
  theme: ThemeMode;
  appearance?: AppearancePreferences;
  children?: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<JarvisStageScene | null>(null);
  const { working, latestActivity } = useJarvisActivity();
  // Without an active voice session, chat runtime work still drives the orb truthfully.
  const chatOrbState: JarvisOrbState = !working ? 'idle'
    : latestActivity?.type === 'tool-call-started' ? 'tool' : 'thinking';
  const [voiceOrbState, setVoiceOrbState] = useState<JarvisOrbState | null>(null);
  const orbState = voiceOrbState ?? chatOrbState;
  const options = useRef<JarvisStageOptions>({
    theme,
    reducedMotion: false,
    voiceActive: false,
    hasWindows: false,
    orbState,
  });
  const signals = useRef<VoiceSignals | null>(null);
  const [failure, setFailure] = useState('');
  const themeMotion = useRef(appearance?.motion);
  const voiceLink = useMemo<VoiceStageLink>(() => ({
    setOrbState: setVoiceOrbState,
    setSignals: (next) => {
      signals.current = next;
      scene.current?.setSignals(next);
    },
  }), []);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const appShell = element.closest<HTMLElement>('.app-shell');
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let active = true;
    let reduce = reducedMotion?.matches ?? false;
    const update = () => {
      options.current = {
        ...options.current,
        reducedMotion: reduce || themeMotion.current === 'reduced',
        voiceActive: appShell?.dataset.voiceActive === 'true',
        hasWindows: appShell?.dataset.voiceHasWindows === 'true',
      };
      scene.current?.update(options.current);
    };
    const markUnavailable = () => {
      if (!active) return;
      for (const key of ['x', 'y', 'radius']) element.parentElement?.style.removeProperty(`--jarvis-orb-${key}`);
      element.dataset.ready = 'false';
      element.dataset.failed = 'true';
      setFailure('The 3D room is unavailable. Chat and voice controls are still available.');
    };
    const markRestored = () => {
      if (!active) return;
      element.dataset.ready = 'true';
      element.dataset.failed = 'false';
      setFailure('');
    };

    update();

    const observer = appShell && typeof MutationObserver === 'function'
      ? new MutationObserver(update)
      : null;
    observer?.observe(appShell!, {
      attributes: true,
      attributeFilter: ['data-voice-active', 'data-voice-has-windows'],
    });
    const onMotionChange = (event: MediaQueryListEvent) => {
      reduce = event.matches;
      update();
    };
    reducedMotion?.addEventListener?.('change', onMotionChange);

    void import('./jarvis-stage-scene').then(({ createJarvisStageScene }) => {
      if (!active) return;
      try {
        scene.current = createJarvisStageScene(element, markUnavailable, options.current, markRestored);
        scene.current.setSignals(signals.current);
        element.dataset.ready = 'true';
        element.dataset.failed = 'false';
      } catch {
        if (!active) return;
        scene.current?.dispose();
        scene.current = null;
        element.replaceChildren();
        markUnavailable();
      }
    }).catch(() => {
      markUnavailable();
    });

    return () => {
      active = false;
      observer?.disconnect();
      reducedMotion?.removeEventListener?.('change', onMotionChange);
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    options.current = { ...options.current, orbState };
    scene.current?.update(options.current);
  }, [orbState]);

  useEffect(() => {
    themeMotion.current = appearance?.motion;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    options.current = { ...options.current, theme, reducedMotion: reducedMotion || themeMotion.current === 'reduced' };
    scene.current?.update(options.current);
  }, [appearance, theme]);

  return (
    <VoiceStageContext.Provider value={voiceLink}>
      <div ref={host} className="jarvis-stage" data-ready="false" data-failed="false" aria-hidden="true" />
      {failure && <p className="jarvis-stage-fallback" role="status">{failure}</p>}
      {children}
    </VoiceStageContext.Provider>
  );
}
