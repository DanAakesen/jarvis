import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraPreview } from './CameraPreview';
import type { CameraController } from './screen-sharing';

function camera(overrides: Partial<CameraController> = {}): CameraController {
  return { sharing: true, starting: false, inspecting: false, error: '', facing: 'user',
    previewStream: {} as MediaStream, start: vi.fn(async () => true), stop: vi.fn(),
    inspect: vi.fn(async () => ({ description: 'Fixture.' })), ...overrides };
}
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('Camera preview', () => {
  it('shows camera limit freshness without changing the composer or pretending a cached image is live', () => {
    render(<CameraPreview camera={camera({ conversation: true, observationNotice: 'Daily camera limit reached. Using an observation from 20 seconds ago.' })} />);
    expect(screen.getByText(/Daily camera limit reached/u).getAttribute('role')).toBe('status');
    expect(screen.getByText(/each chat or voice turn/u)).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Look now' })).toBeNull();
  });
  it('plays the existing muted stream locally and detaches without stopping capture on unmount', async () => {
    const controller = camera();
    const view = render(<CameraPreview camera={controller} />);
    await screen.findByText('Live');
    const video = screen.getByLabelText('Live camera preview') as HTMLVideoElement;
    expect(video.srcObject).toBe(controller.previewStream);
    expect(video.muted).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(controller.start).not.toHaveBeenCalled();
    expect(controller.inspect).not.toHaveBeenCalled();
    expect(controller.stop).not.toHaveBeenCalled();
    view.unmount();
    expect(video.srcObject).toBeNull();
    expect(video.pause).toHaveBeenCalled();
    expect(controller.stop).not.toHaveBeenCalled();
  });
  it('replaces the stream on switching and ignores a stale playback failure', async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(HTMLMediaElement.prototype.play).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    const view = render(<CameraPreview camera={camera()} />);
    const rear = camera({ facing: 'environment' });
    view.rerender(<CameraPreview camera={rear} />);
    await screen.findByText('Live');
    await act(async () => { reject(new Error('Old play failed.')); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByLabelText('Live camera preview') as HTMLVideoElement).srcObject).toBe(rear.previewStream);
  });
  it('shows playback failure with a working retry, never claiming Live before playback succeeds', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('Autoplay unavailable.'));
    const controller = camera();
    render(<CameraPreview camera={controller} />);
    await screen.findByRole('alert');
    expect(screen.queryByText('Live')).toBeNull();
    const retryPreview = screen.getByRole('button', { name: 'Retry preview' });
    expect(retryPreview.classList.contains('secondary-button')).toBe(true);
    fireEvent.click(retryPreview);
    await screen.findByText('Live');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(controller.start).not.toHaveBeenCalled();
  });
  it('keeps startup and capture failures visible with retry, without a manual inspection button', () => {
    const controller = camera({ sharing: false, previewStream: null, error: 'No camera available.' });
    render(<CameraPreview camera={controller} />);
    expect(screen.getByRole('alert').textContent).toBe('No camera available.');
    expect(screen.getByText('No camera frame available.')).not.toBeNull();
    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Look now' })).toBeNull();
    const retryCamera = screen.getByRole('button', { name: 'Retry camera' });
    expect(retryCamera.classList.contains('secondary-button')).toBe(true);
    fireEvent.click(retryCamera);
    expect(controller.start).toHaveBeenCalledOnce();
  });
});
