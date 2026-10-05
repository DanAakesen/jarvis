import { useEffect, useRef, useState } from 'react';
import type { ThemeMode } from './theme-preference-context';
import type { JarvisStageOptions, JarvisStageScene } from './jarvis-stage-scene';
import './JarvisStage.css';

export function JarvisStage({ theme }: { theme: ThemeMode }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<JarvisStageScene | null>(null);
  const options = useRef<JarvisStageOptions>({
    theme,
    reducedMotion: false,
    voiceActive: false,
    hasWindows: false,
  });
  const [failure, setFailure] = useState('');

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
        reducedMotion: reduce,
        voiceActive: appShell?.dataset.voiceActive === 'true',
        hasWindows: appShell?.dataset.voiceHasWindows === 'true',
      };
      scene.current?.update(options.current);
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
        scene.current = createJarvisStageScene(element, () => {
          if (active) {
            scene.current = null;
            element.dataset.ready = 'false';
            setFailure('The 3D room is unavailable. Chat and voice controls are still available.');
          }
        }, options.current);
        element.dataset.ready = 'true';
      } catch {
        if (!active) return;
        scene.current?.dispose();
        scene.current = null;
        element.replaceChildren();
        element.dataset.ready = 'false';
        setFailure('The 3D room is unavailable. Chat and voice controls are still available.');
      }
    }).catch(() => {
      if (!active) return;
      element.dataset.ready = 'false';
      setFailure('The 3D room is unavailable. Chat and voice controls are still available.');
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
    options.current = { ...options.current, theme };
    scene.current?.update(options.current);
  }, [theme]);

  return (
    <>
      <div ref={host} className="jarvis-stage" data-ready="false" aria-hidden="true" />
      {failure && <p className="jarvis-stage-fallback" role="status">{failure}</p>}
    </>
  );
}
