import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppearancePreferences, ThemeMode } from './theme-preference-context';
import type { JarvisStageOptions, JarvisStageScene } from './jarvis-stage-scene';
import { useJarvisActivity } from './activity-context';
import { PlaybackAudioLevelContext } from './playback-audio-context';
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
  const activityState = latestActivity?.type ?? null;
  const options = useRef<JarvisStageOptions>({
    theme,
    reducedMotion: false,
    voiceActive: false,
    hasWindows: false,
    working,
    activityState,
    audioLevel: 0,
  });
  const [failure, setFailure] = useState('');
  const themeMotion = useRef(appearance?.motion);
  const setAudioLevel = useCallback((level: number) => {
    const audioLevel = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
    options.current = { ...options.current, audioLevel };
    scene.current?.setAudioLevel(audioLevel);
  }, []);

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
    options.current = { ...options.current, working, activityState };
    scene.current?.update(options.current);
  }, [activityState, working]);

  useEffect(() => {
    themeMotion.current = appearance?.motion;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    options.current = { ...options.current, theme, reducedMotion: reducedMotion || themeMotion.current === 'reduced' };
    scene.current?.update(options.current);
  }, [appearance, theme]);

  return (
    <PlaybackAudioLevelContext.Provider value={setAudioLevel}>
      <div ref={host} className="jarvis-stage" data-ready="false" data-failed="false" aria-hidden="true" />
      {children}
      {failure && <p className="jarvis-stage-fallback" role="status">{failure}</p>}
    </PlaybackAudioLevelContext.Provider>
  );
}
