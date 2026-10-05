import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JarvisStageOptions } from './jarvis-stage-scene';
import { JarvisStage } from './JarvisStage';

const { createScene } = vi.hoisted(() => ({ createScene: vi.fn() }));
vi.mock('./jarvis-stage-scene', () => ({ createJarvisStageScene: createScene }));

describe('JarvisStage', () => {
  const update = vi.fn();
  const dispose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    createScene.mockReturnValue({ update, dispose });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tracks the Jarvis route state and disposes the scene when unmounted', async () => {
    const { container, rerender, unmount } = render(
      <div className="app-shell" data-voice-active="false" data-voice-has-windows="false">
        <JarvisStage theme="dark" />
      </div>,
    );
    const shell = container.querySelector<HTMLElement>('.app-shell')!;
    await waitFor(() => expect(createScene).toHaveBeenCalledTimes(1));
    expect(createScene.mock.calls[0]?.[2]).toEqual({
      theme: 'dark',
      reducedMotion: false,
      voiceActive: false,
      hasWindows: false,
    } satisfies JarvisStageOptions);
    expect(container.querySelector('.jarvis-stage')?.getAttribute('data-ready')).toBe('true');

    act(() => {
      shell.dataset.voiceActive = 'true';
      shell.dataset.voiceHasWindows = 'true';
    });
    await waitFor(() => expect(update).toHaveBeenLastCalledWith({
      theme: 'dark',
      reducedMotion: false,
      voiceActive: true,
      hasWindows: true,
    }));

    rerender(
      <div className="app-shell" data-voice-active="true" data-voice-has-windows="true">
        <JarvisStage theme="light" />
      </div>,
    );
    await waitFor(() => expect(update).toHaveBeenLastCalledWith({
      theme: 'light',
      reducedMotion: false,
      voiceActive: true,
      hasWindows: true,
    }));

    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps the Jarvis interface usable when WebGL scene creation fails', async () => {
    createScene.mockImplementation(() => { throw new Error('WebGL unavailable'); });

    render(<JarvisStage theme="dark" />);

    expect((await screen.findByRole('status')).textContent)
      .toBe('The 3D room is unavailable. Chat and voice controls are still available.');
  });
});
