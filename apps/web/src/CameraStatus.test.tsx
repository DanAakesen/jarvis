import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraStatus } from './CameraStatus';
import type { CameraController } from './screen-sharing';

function camera(overrides: Partial<CameraController> = {}): CameraController {
  return { sharing: true, starting: false, inspecting: false, error: '', facing: 'user',
    start: vi.fn(async () => {}), stop: vi.fn(), inspect: vi.fn(async () => ({ description: 'Fixture.' })),
    switchCamera: vi.fn(async () => {}), ...overrides };
}

describe('camera status', () => {
  beforeEach(() => vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }))));
  afterEach(() => vi.unstubAllGlobals());
  it('has a short status and only switch/off icon controls, without requesting a frame', () => {
    const controller = camera();
    render(<CameraStatus camera={controller} />);
    expect(screen.getByText('Front camera on')).not.toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    const change = screen.getByRole('button', { name: 'Switch to back camera' });
    const off = screen.getByRole('button', { name: 'Camera off' });
    expect(change.textContent).toBe('Switch');
    expect(off.textContent).toBe('Turn off');
    fireEvent.click(change);
    fireEvent.click(off);
    expect(controller.switchCamera).toHaveBeenCalledOnce();
    expect(controller.stop).toHaveBeenCalledOnce();
    expect(controller.inspect).not.toHaveBeenCalled();
  });

  it('shows back facing, keeps off usable while inspecting and disables switching', () => {
    render(<CameraStatus camera={camera({ facing: 'environment', inspecting: true })} />);
    expect(screen.getByText('Back camera on')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Switch to front camera' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Camera off' }).hasAttribute('disabled')).toBe(false);
  });

  it('keeps failed switching visible when the camera is off', () => {
    render(<CameraStatus camera={camera({ sharing: false, error: 'The back camera is not available.' })} />);
    expect(screen.getByRole('alert').textContent).toBe('The back camera is not available.');
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('omits camera switching on desktop, including a narrow desktop window', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const controller = camera();
    render(<CameraStatus camera={controller} />);
    expect(screen.queryByRole('button', { name: /Switch/ })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Camera off' }));
    expect(controller.stop).toHaveBeenCalledOnce();
    expect(controller.switchCamera).not.toHaveBeenCalled();
  });
  it('updates switching when the primary input changes and releases its listener', () => {
    const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    const view = render(<CameraStatus camera={camera()} />);
    expect(screen.queryByRole('button', { name: /Switch/ })).toBeNull();
    const update = media.addEventListener.mock.calls[0]?.[1] as () => void;
    act(() => { media.matches = true; update(); });
    expect(screen.getByRole('button', { name: 'Switch to back camera' })).not.toBeNull();
    act(() => { media.matches = false; update(); });
    expect(screen.queryByRole('button', { name: /Switch/ })).toBeNull();
    view.unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith('change', update);
  });
});
