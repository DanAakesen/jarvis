import { afterEach, describe, expect, it } from 'vitest';
import { isHtmlArtifactFrame } from '@jarvis/contracts';
import { readWorkspaceFrame } from './workspace-frame';

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.cssText = '';
  document.body.innerHTML = '';
});

describe('workspace frame', () => {
  it('describes the window generated content opens in with the contract shape', () => {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.style.setProperty('--text', '#111111');
    document.documentElement.style.setProperty('--font-body', 'Segoe UI, sans-serif');
    document.body.innerHTML = '<div class="workspace-canvas" data-arrangement="layered"></div>';

    const frame = readWorkspaceFrame();

    expect(frame && isHtmlArtifactFrame(frame)).toBe(true);
    expect(frame).toMatchObject({ theme: 'light', layout: 'layered', pinned: false, designTokens: { '--text': '#111111' } });
    expect(frame?.fonts.body).toBe('Segoe UI, sans-serif');
    expect(frame?.widthPx).toBeGreaterThan(0);
  });
});
