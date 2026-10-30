import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setPreviewBounds(width: number, height: number) {
  vi.stubGlobal('ResizeObserver', class {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element) {
      const contentRect = { width, height };
      const borderBoxSize: ResizeObserverSize[] = [];
      this.callback([{ target, contentRect, borderBoxSize } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    disconnect() {}
  });
}

describe('Camera preview', () => {
  it.each(['touch', 'mouse'])('moves via %s without consuming overlay controls and restores a cancelled drag', (pointerType) => {
    class TestPointerEvent extends MouseEvent {
      pointerId = 1;
      isPrimary = true;
      pointerType = 'touch';
      constructor(type: string, init: PointerEventInit) { super(type, init); Object.assign(this, { pointerType: init.pointerType }); }
    }
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const controller = camera({ switchCamera: vi.fn(async () => {}) });
    const { container } = render(<CameraPreview camera={controller} />);
    const picture = container.querySelector<HTMLElement>('.camera-preview-picture')!;
    picture.setPointerCapture = vi.fn();
    picture.hasPointerCapture = vi.fn(() => true);
    picture.releasePointerCapture = vi.fn();
    vi.spyOn(picture, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100, right: 300, bottom: 400 } as DOMRect);
    const point = { pointerType, pointerId: 1, isPrimary: true, button: 0 };
    fireEvent.pointerDown(picture, { ...point, clientX: 150, clientY: 180 });
    fireEvent.pointerMove(picture, { ...point, clientX: 200, clientY: 220 });
    fireEvent.pointerUp(picture, point);
    expect(picture.style.translate).toBe('50px 40px');
    const switchButton = screen.getByRole('button', { name: 'Switch to back camera' });
    fireEvent.pointerDown(switchButton, point);
    fireEvent.click(switchButton);
    expect(controller.switchCamera).toHaveBeenCalledOnce();
    expect(picture.setPointerCapture).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(picture, { ...point, clientX: 150, clientY: 180 });
    fireEvent.pointerMove(picture, { ...point, clientX: -900, clientY: -900 });
    expect(picture.style.translate).toBe('-50px -60px');
    fireEvent.pointerCancel(picture, point);
    expect(picture.style.translate).toBe('50px 40px');
    fireEvent.click(screen.getByRole('button', { name: 'Close camera preview' }));
    expect(controller.stop).toHaveBeenCalledOnce();
  });
  it('shows camera limit freshness without changing the composer or pretending a cached image is live', () => {
    const { container } = render(<CameraPreview camera={camera({ conversation: true, observationNotice: 'Camera capture limit reached. Using an observation from 20 seconds ago.' })} />);
    expect(screen.getByText(/Camera capture limit reached/u).getAttribute('role')).toBe('status');
    expect(screen.getByText(/each chat or voice turn/u)).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Look now' })).toBeNull();
    const picture = container.querySelector<HTMLElement>('.camera-preview-picture')!;
    expect(within(picture).getByText(/Camera capture limit reached/u)).not.toBeNull();
    expect(within(picture).getByRole('button', { name: 'Close camera preview' })).not.toBeNull();
  });
  it('overlays switch and close controls on the preview and closes capture', () => {
    const controller = camera({ switchCamera: vi.fn(async () => {}) });
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const { container } = render(<CameraPreview camera={controller} />);
    const picture = container.querySelector<HTMLDivElement>('.camera-preview-picture')!;
    expect(picture.classList.contains('luminous-glass')).toBe(false);
    expect(picture.querySelector('.camera-status')).not.toBeNull();
    fireEvent.click(within(picture).getByRole('button', { name: 'Switch to back camera' }));
    expect(controller.switchCamera).toHaveBeenCalledOnce();
    fireEvent.click(within(picture).getByRole('button', { name: 'Close camera preview' }));
    expect(controller.stop).toHaveBeenCalledOnce();
  });
  it.each([
    { width: 360, height: 640, expectedWidth: '168.75px', expectedHeight: '300px' },
    { width: 640, height: 360, expectedWidth: '400px', expectedHeight: '225px' },
  ])('fits a $width×$height video to the available preview without changing its aspect ratio', ({ width, height, expectedWidth, expectedHeight }) => {
    setPreviewBounds(400, 300);
    const { container } = render(<CameraPreview camera={camera()} />);
    const video = screen.getByLabelText('Live camera preview');
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: width });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: height });
    fireEvent.loadedMetadata(video);
    const picture = container.querySelector<HTMLElement>('.camera-preview-picture')!;
    expect(picture.style.width).toBe(expectedWidth);
    expect(picture.style.height).toBe(expectedHeight);
    expect(picture.querySelector('video')).toBe(video);
  });
  it('resizes the preview when a playing video reports changed dimensions', () => {
    setPreviewBounds(400, 300);
    const { container } = render(<CameraPreview camera={camera()} />);
    const video = screen.getByLabelText('Live camera preview');
    const picture = container.querySelector<HTMLElement>('.camera-preview-picture')!;
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 360, writable: true });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 640, writable: true });
    fireEvent.loadedMetadata(video);
    expect(picture.style.width).toBe('168.75px');
    expect(picture.style.height).toBe('300px');
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640, writable: true });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 360, writable: true });
    fireEvent.resize(video);
    expect(picture.style.width).toBe('400px');
    expect(picture.style.height).toBe('225px');
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 360, writable: true });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 640, writable: true });
    fireEvent.resize(video);
    expect(picture.style.width).toBe('168.75px');
    expect(picture.style.height).toBe('300px');
  });
  it('retains fitted geometry through stream replacement and refreshes dimensions on resumed playback', async () => {
    setPreviewBounds(400, 300);
    const view = render(<CameraPreview camera={camera()} />);
    const video = screen.getByLabelText('Live camera preview');
    const picture = document.querySelector<HTMLElement>('.camera-preview-picture')!;
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 360 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 640 });
    fireEvent.loadedMetadata(video);
    vi.mocked(HTMLMediaElement.prototype.play).mockReturnValueOnce(new Promise(() => {}));
    view.rerender(<CameraPreview camera={camera({ facing: 'environment' })} />);
    expect(picture.style.width).toBe('168.75px');
    expect(picture.style.height).toBe('300px');
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 360 });
    fireEvent.playing(video);
    expect(picture.style.width).toBe('400px');
    expect(picture.style.height).toBe('225px');
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 0 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 0 });
    fireEvent.playing(video);
    expect(picture.style.width).toBe('400px');
    expect(picture.style.height).toBe('225px');
    await act(async () => {});
  });
  it('plays the existing muted stream locally and detaches without stopping capture on unmount', async () => {
    const controller = camera();
    const view = render(<CameraPreview camera={controller} />);
    await act(async () => {});
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
    await act(async () => {});
    await act(async () => { reject(new Error('Old play failed.')); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByLabelText('Live camera preview') as HTMLVideoElement).srcObject).toBe(rear.previewStream);
  });
  it('shows playback failure with a working retry, never claiming Live before playback succeeds', async () => {
    setPreviewBounds(400, 300);
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('Autoplay unavailable.'));
    const controller = camera({ observationNotice: 'Camera capture limit reached. Using an observation from 20 seconds ago.' });
    render(<CameraPreview camera={controller} />);
    await screen.findByRole('alert');
    expect(screen.queryByText('Live')).toBeNull();
    const picture = document.querySelector<HTMLElement>('.camera-preview-picture')!;
    expect(within(picture).getByRole('button', { name: 'Retry preview' })).not.toBeNull();
    expect(within(picture).getByText(/Camera capture limit reached/u)).not.toBeNull();
    const video = screen.getByLabelText('Live camera preview');
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 360 });
    fireEvent.loadedMetadata(video);
    const retryPreview = screen.getByRole('button', { name: 'Retry preview' });
    expect(retryPreview.classList.contains('secondary-button')).toBe(true);
    fireEvent.click(retryPreview);
    await act(async () => {});
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('.camera-preview-picture')?.getAttribute('style')).toContain('width: 400px; height: 225px;');
    expect(controller.start).not.toHaveBeenCalled();
  });
  it('omits live and direction badges while retaining named overlay controls', async () => {
    render(<CameraPreview camera={camera()} />);
    await act(async () => {});
    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.queryByText('Front camera on')).toBeNull();
    expect(document.querySelector('.camera-status-label')).toBeNull();
    expect(screen.getByRole('button', { name: 'Close camera preview' })).not.toBeNull();
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
