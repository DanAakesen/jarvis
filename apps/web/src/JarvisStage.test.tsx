import { useContext } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JarvisStageOptions } from './jarvis-stage-scene';
import { JarvisActivityProvider } from './activity-provider';
import { useJarvisActivity } from './activity-context';
import { PlaybackAudioLevelContext } from './playback-audio-context';
import { JarvisStage } from './JarvisStage';

const { createScene } = vi.hoisted(() => ({ createScene: vi.fn() }));
vi.mock('./jarvis-stage-scene', () => ({ createJarvisStageScene: createScene }));

describe('JarvisStage', () => {
  const update = vi.fn();
  const dispose = vi.fn();
  const setAudioLevel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    createScene.mockReturnValue({ update, dispose, setAudioLevel });
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
      working: false,
      activityState: null,
      audioLevel: 0,
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
      working: false,
      activityState: null,
      audioLevel: 0,
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
      working: false,
      activityState: null,
      audioLevel: 0,
    }));

    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps the Jarvis interface usable when WebGL scene creation fails', async () => {
    createScene.mockImplementation(() => { throw new Error('WebGL unavailable'); });

    const { container } = render(
      <JarvisStage theme="dark">
        <button type="button">Send message</button>
      </JarvisStage>,
    );

    expect((await screen.findByRole('status')).textContent)
      .toBe('The 3D room is unavailable. Chat and voice controls are still available.');
    expect(container.querySelector('.jarvis-stage')?.getAttribute('data-failed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Send message' })).not.toBeNull();
  });

  it('keeps a lost renderer available for context restoration and clears its fallback', async () => {
    let loseContext = () => {};
    let restoreContext = () => {};
    createScene.mockImplementation((_element, onLost, _options, onRestored) => {
      loseContext = onLost;
      restoreContext = onRestored;
      return { update, dispose, setAudioLevel };
    });

    const { container, unmount } = render(<JarvisStage theme="dark" />);
    await waitFor(() => expect(createScene).toHaveBeenCalledTimes(1));
    const stage = container.querySelector<HTMLElement>('.jarvis-stage')!;

    act(() => loseContext());
    expect(stage.dataset.ready).toBe('false');
    expect(stage.dataset.failed).toBe('true');
    expect(screen.getByRole('status').textContent)
      .toBe('The 3D room is unavailable. Chat and voice controls are still available.');
    expect(dispose).not.toHaveBeenCalled();

    act(() => restoreContext());
    expect(stage.dataset.ready).toBe('true');
    expect(stage.dataset.failed).toBe('false');
    expect(screen.queryByRole('status')).toBeNull();
    expect(createScene).toHaveBeenCalledTimes(1);

    unmount();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('removes a partially attached canvas when scene creation fails', async () => {
    createScene.mockImplementation((element: HTMLElement) => {
      element.appendChild(document.createElement('canvas'));
      throw new Error('Scene initialization failed');
    });

    const { container } = render(<JarvisStage theme="dark" />);

    expect((await screen.findByRole('status')).textContent)
      .toBe('The 3D room is unavailable. Chat and voice controls are still available.');
    expect(container.querySelector('.jarvis-stage canvas')).toBeNull();
  });

  it('updates the renderer when the reduced-motion preference changes', async () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const media = {
      matches: false,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    };
    vi.stubGlobal('matchMedia', () => media);
    render(<JarvisStage theme="dark" />);
    await waitFor(() => expect(createScene).toHaveBeenCalledTimes(1));

    act(() => {
      media.matches = true;
      listeners.forEach((listener) => listener({ matches: true } as MediaQueryListEvent));
    });

    await waitFor(() => expect(update).toHaveBeenLastCalledWith({
      theme: 'dark',
      reducedMotion: true,
      voiceActive: false,
      hasWindows: false,
      working: false,
      activityState: null,
      audioLevel: 0,
    }));
  });

  it('keeps one scene mounted while observed activity and playback audio update it', async () => {
    function ActivityControls() {
      const activity = useJarvisActivity();
      return (
        <>
          <button type="button" onClick={() => activity.applyRuntimeActivity({
            type: 'thinking',
            activityId: '11111111-1111-4111-8111-111111111111',
            source: 'chat',
          })}>Start thinking</button>
          <button type="button" onClick={activity.clearRuntimeActivities}>Clear activity</button>
        </>
      );
    }
    function AudioProbe() {
      const setAudioLevel = useContext(PlaybackAudioLevelContext);
      return <button type="button" onClick={() => setAudioLevel(0.65)}>Playback level</button>;
    }
    const { container } = render(
      <JarvisActivityProvider>
        <div className="app-shell" data-voice-active="false" data-voice-has-windows="false">
          <JarvisStage theme="dark">
            <AudioProbe />
          </JarvisStage>
          <ActivityControls />
        </div>
      </JarvisActivityProvider>,
    );
    await waitFor(() => expect(createScene).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Start thinking' }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(expect.objectContaining({
      working: true,
      activityState: 'thinking',
    })));
    fireEvent.click(screen.getByRole('button', { name: 'Playback level' }));
    expect(setAudioLevel).toHaveBeenCalledWith(0.65);
    fireEvent.click(screen.getByRole('button', { name: 'Clear activity' }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(expect.objectContaining({
      working: false,
      activityState: null,
    })));
    expect(createScene).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.jarvis-stage')).not.toBeNull();
  });
});
