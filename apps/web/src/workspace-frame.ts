import { isHtmlArtifactFrame, type HtmlArtifactFrame } from '@jarvis/contracts';
import { PHONE_LAYOUT_MEDIA_QUERY } from './Workspace';

// The theme tokens a generated report or app needs to look native in Jarvis's glass windows.
const tokenNames = [
  '--text', '--text-muted', '--surface', '--surface-muted', '--rule', '--focus',
  '--stage-background', '--stage-slab', '--stage-glass', '--board-slab', '--glass-hover', '--glass-selected',
  '--glass-rim-light', '--glass-edge-cool', '--glass-glow-warm', '--primary-action',
  '--success', '--warning', '--error', '--radius-window', '--radius-panel', '--radius-control', '--radius-pill',
] as const;

/**
 * Describes the window a generated report or HTML app will open in, so Jarvis can design for its real size, theme
 * and motion settings. The size is the workspace area a new window gets: its width capped at the 1,180 px used for
 * windows off the home page, and most of its height (windows open just below the top of the area).
 */
export function readWorkspaceFrame(): HtmlArtifactFrame | null {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return null;
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  const area = document.querySelector<HTMLElement>('.workspace-canvas')?.getBoundingClientRect();
  const areaWidth = area && area.width > 0 ? area.width : window.innerWidth - 120;
  const areaHeight = area && area.height > 120 ? area.height : window.innerHeight - 180;
  const phone = window.matchMedia?.(PHONE_LAYOUT_MEDIA_QUERY).matches ?? false;
  const designTokens: Record<string, string> = {};
  for (const name of tokenNames) {
    const value = styles.getPropertyValue(name).trim();
    if (value) designTokens[name] = value.slice(0, 200);
  }
  const font = (name: string, fallback: string) => (styles.getPropertyValue(name).trim() || fallback).slice(0, 120);
  const density = Number.parseFloat(styles.getPropertyValue('--theme-density-scale'));
  const frame: HtmlArtifactFrame = {
    widthPx: Math.max(1, Math.min(8192, Math.round(phone ? areaWidth : Math.min(areaWidth, 1180)))),
    heightPx: Math.max(1, Math.min(8192, Math.round(phone ? areaHeight : areaHeight * 0.9))),
    device: phone ? 'phone' : 'desktop',
    theme: root.dataset.theme === 'light' ? 'light' : 'dark',
    reducedMotion: root.dataset.motionPreference === 'reduced' || root.dataset.motion === 'reduced',
    density: Number.isFinite(density) && density < 1 ? 'compact' : 'comfortable',
    designTokens,
    fonts: {
      body: font('--font-body', 'system-ui, sans-serif'),
      heading: font('--font-heading', 'system-ui, sans-serif'),
      mono: font('--font-mono', 'ui-monospace, monospace'),
    },
    layout: document.querySelector('.workspace-canvas')?.getAttribute('data-arrangement') === 'layered' ? 'layered' : 'tiled',
    pinned: false,
  };
  return isHtmlArtifactFrame(frame) ? frame : null;
}
