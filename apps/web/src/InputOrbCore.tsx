import { useEffect, useRef } from 'react';
import { useJarvisActivity } from './activity-context';
import { getLatticeModel, latticeDetailForSize, makeLatticeScene } from './jarvis-lattice';
import { paintLattice } from './jarvis-lattice-painter';
import { createOrbAnimator } from './jarvis-orb-motion';
import type { JarvisOrbState } from './voice-presentation';

/**
 * The Jarvis orb at small sizes: the same cognitive lattice as the stage orb, painted straight onto a canvas. `orb`
 * is the glass sphere used by the composer's voice button and the rail's chat orb. `core` is the network alone, used
 * as the live "Jarvis is working" mark in the chat; `active` keeps it at full energy. Decorative; the button
 * carries the name.
 */
export function InputOrbCore({ variant = 'orb', active = false }: { variant?: 'orb' | 'core'; active?: boolean } = {}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { working, latestActivity } = useJarvisActivity();
  const busy = working || active;
  const state: JarvisOrbState = !busy ? 'idle' : latestActivity?.type === 'tool-call-started' ? 'tool' : 'thinking';
  const status = useRef({ busy, state });
  const coreOnly = variant === 'core';
  const wake = useRef<() => void>(() => {});
  useEffect(() => {
    status.current = { busy, state };
    wake.current();
  }, [busy, state]);

  useEffect(() => {
    const element = canvas.current;
    const context = typeof element?.getContext === 'function' ? element.getContext('2d') : null;
    if (!element || !context) return;
    const model = getLatticeModel();
    const animator = createOrbAnimator();
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const reduced = () => (motionQuery?.matches ?? false) || document.documentElement.dataset.motion === 'reduced';
    let frame = 0;
    let idleTimer = 0;
    let last = performance.now();
    let onScreen = true;
    const host = element.closest('.input-orb');
    // Hidden orbs (the parked chat bar, a closed menu, off-screen) draw nothing; they look again twice a second.
    const visible = () => onScreen && document.visibilityState !== 'hidden' &&
      (typeof element.checkVisibility !== 'function' || element.checkVisibility({ visibilityProperty: true, opacityProperty: false }));
    const schedule = () => {
      if (visible()) frame = requestAnimationFrame(draw);
      else idleTimer = window.setTimeout(() => { idleTimer = 0; schedule(); }, 500);
    };

    const draw = (time: number) => {
      frame = 0;
      // A small ambient orb needs no more than 30 fps.
      if (!reduced() && time - last < 1000 / 30 - 4) {
        frame = requestAnimationFrame(draw);
        return;
      }
      const size = element.clientWidth || 42;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      if (element.width !== Math.round(size * ratio)) {
        element.width = Math.round(size * ratio);
        element.height = Math.round(size * ratio);
      }
      const delta = Math.min(0.1, (time - last) / 1000);
      last = time;
      const still = reduced();
      // Hover or keyboard focus wakes the orb a little, hinting that it can come alive.
      const hovered = Boolean(host && !(host as HTMLButtonElement).disabled && host.matches(':hover, :focus-visible'));
      const { busy: working, state: orbState } = status.current;
      const orbFrame = animator.step(delta, {
        awake: working ? 1 : hovered ? 0.75 : 0.35,
        state: orbState,
        playback: 0,
        input: 0,
        reducedMotion: still,
      });
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      paintLattice(context, makeLatticeScene(model, orbFrame, latticeDetailForSize(size)), orbFrame, { size, glass: !coreOnly });
      if (!still && document.visibilityState !== 'hidden') schedule();
    };
    const resume = () => {
      if (frame || idleTimer || document.visibilityState === 'hidden') return;
      last = performance.now() - 1000;
      schedule();
    };
    last = performance.now() - 1000;
    schedule();
    wake.current = resume;
    motionQuery?.addEventListener?.('change', resume);
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(resume) : null;
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    const intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      if (onScreen) resume();
    }) : null;
    intersection?.observe(element);
    document.addEventListener('visibilitychange', resume);
    // With reduced motion the orb is drawn once, so hover and focus have to ask for the next pose.
    const hoverEvents = ['pointerenter', 'pointerleave', 'focusin', 'focusout'] as const;
    for (const name of hoverEvents) host?.addEventListener(name, resume);
    return () => {
      wake.current = () => {};
      cancelAnimationFrame(frame);
      window.clearTimeout(idleTimer);
      intersection?.disconnect();
      document.removeEventListener('visibilitychange', resume);
      motionQuery?.removeEventListener?.('change', resume);
      observer?.disconnect();
      for (const name of hoverEvents) host?.removeEventListener(name, resume);
    };
  }, [coreOnly]);

  return <canvas ref={canvas} className="input-orb-core" aria-hidden="true" />;
}
