import { useContext } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JarvisStageOptions } from './jarvis-stage-scene';
import { JarvisActivityProvider } from './activity-provider';
import { useJarvisActivity } from './activity-context';
import { VoiceStageContext } from './voice-stage-context';
import { JarvisStage } from './JarvisStage';

const { createScene } = vi.hoisted(() => ({ createScene: vi.fn() }));
vi.mock('./jarvis-stage-scene', () => ({ createJarvisStageScene: createScene }));

describe('JarvisStage', () => {
  const update = vi.fn();
  const dispose = vi.fn();
  const setSignals = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    createScene.mockReturnValue({ update, dispose, setSignals });
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
      orbState: 'idle',
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
      orbState: 'idle',
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
      orbState: 'idle',
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
    const notice = screen.getByRole('status');
    const send = screen.getByRole('button', { name: 'Send message' });
    expect(send).not.toBeNull();
    expect(notice.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps a lost renderer available for context restoration and clears its fallback', async () => {
    let loseContext = () => {};
    let restoreContext = () => {};
    createScene.mockImplementation((_element, onLost, _options, onRestored) => {
      loseContext = onLost;
      restoreContext = onRestored;
      return { update, dispose, setSignals };
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
      orbState: 'idle',
    }));
  });

  it('keeps one scene mounted while chat activity and the voice presentation drive the orb', async () => {
    function ActivityControls() {
      const activity = useJarvisActivity();
      const activityId = '11111111-1111-4111-8111-111111111111';
      return (
        <>
          <button type="button" onClick={() => activity.applyRuntimeActivity({
            type: 'thinking', activityId, source: 'chat',
          })}>Start thinking</button>
          <button type="button" onClick={() => activity.applyRuntimeActivity({
            type: 'tool-call-started', activityId, source: 'chat', toolName: 'open_window',
          })}>Start tool</button>
          <button type="button" onClick={activity.clearRuntimeActivities}>Clear activity</button>
        </>
      );
    }
    const signals = { playbackLevel: () => 0.5, inputLevel: () => 0.1 };
    function VoiceProbe() {
      const stage = useContext(VoiceStageContext);
      return (
        <>
          <button type="button" onClick={() => { stage.setSignals(signals); stage.setOrbState('speaking'); }}>Voice speaking</button>
          <button type="button" onClick={() => { stage.setSignals(null); stage.setOrbState(null); }}>Voice ended</button>
        </>
      );
    }
    const { container } = render(
      <JarvisActivityProvider>
        <div className="app-shell" data-voice-active="false" data-voice-has-windows="false">
          <JarvisStage theme="dark">
            <VoiceProbe />
          </JarvisStage>
          <ActivityControls />
        </div>
      </JarvisActivityProvider>,
    );
    await waitFor(() => expect(createScene).toHaveBeenCalledTimes(1));
    expect(setSignals).toHaveBeenLastCalledWith(null);

    fireEvent.click(screen.getByRole('button', { name: 'Start thinking' }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ orbState: 'thinking' })));
    fireEvent.click(screen.getByRole('button', { name: 'Start tool' }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ orbState: 'tool' })));
    fireEvent.click(screen.getByRole('button', { name: 'Voice speaking' }));
    expect(setSignals).toHaveBeenLastCalledWith(signals);
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ orbState: 'speaking' })));
    fireEvent.click(screen.getByRole('button', { name: 'Voice ended' }));
    expect(setSignals).toHaveBeenLastCalledWith(null);
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ orbState: 'tool' })));
    fireEvent.click(screen.getByRole('button', { name: 'Clear activity' }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ orbState: 'idle' })));
    expect(createScene).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.jarvis-stage')).not.toBeNull();
  });

  it('clears published orb geometry when the room becomes unavailable', async () => {
    let loseContext = () => {};
    createScene.mockImplementation((_element, onLost) => {
      loseContext = onLost;
      return { update, dispose, setSignals };
    });
    const { container } = render(<div className="jarvis-page"><JarvisStage theme="dark" /></div>);
    await waitFor(() => expect(createScene).toHaveBeenCalledTimes(1));
    const page = container.querySelector<HTMLElement>('.jarvis-page')!;
    page.style.setProperty('--jarvis-orb-x', '400px');
    act(() => loseContext());
    expect(page.style.getPropertyValue('--jarvis-orb-x')).toBe('');
  });
});
