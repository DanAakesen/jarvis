import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CameraController } from './screen-sharing';
import { applySessionCommand, openCameraPreview, createSessionCommandRegistry, type SessionCommand } from './session-commands';

const originalPermissions = Object.getOwnPropertyDescriptor(navigator, 'permissions');

function permission(state: PermissionState | 'throws' | 'missing') {
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: state === 'missing' ? undefined : {
      query: state === 'throws' ? vi.fn().mockRejectedValue(new TypeError('unsupported')) : vi.fn().mockResolvedValue({ state }),
    },
  });
}

function camera(overrides: Partial<CameraController> = {}): CameraController {
  return {
    sharing: false, starting: false, inspecting: false, error: '',
    start: vi.fn(), stop: vi.fn(), inspect: vi.fn(),
    selectFacing: vi.fn(async () => true),
    ...overrides,
  };
}

const command = (action: string, value: string) => ({ commandId: 'c1', operation: 'session', action, value }) as SessionCommand;

afterEach(() => {
  if (originalPermissions) Object.defineProperty(navigator, 'permissions', originalPermissions);
  else delete (navigator as { permissions?: unknown }).permissions;
});

describe('session commands', () => {
  it('opens the preview without requiring a reported facing direction or starting another live capture', async () => {
    permission('granted');
    const off = camera({ start: vi.fn(async () => true) });
    expect(await openCameraPreview(off)).toEqual({ applied: true });
    expect(off.start).toHaveBeenCalledOnce();
    expect(off.selectFacing).not.toHaveBeenCalled();
    const live = camera({ sharing: true });
    expect(await openCameraPreview(live)).toEqual({ applied: true });
    expect(live.start).not.toHaveBeenCalled();
  });
  it.each(['prompt', 'denied', 'throws', 'missing'] as const)('refuses to open a preview when camera permission is %s', async (state) => {
    permission(state);
    const off = camera();
    expect(await openCameraPreview(off)).toMatchObject({ applied: false, reason: expect.stringContaining('Camera access') });
    expect(off.start).not.toHaveBeenCalled();
  });
  it('reports preview startup failure or cancellation and refuses duplicate pending starts', async () => {
    permission('granted');
    const busy = camera({ starting: true });
    expect(await openCameraPreview(busy)).toMatchObject({ applied: false });
    expect(busy.start).not.toHaveBeenCalled();
    expect(await openCameraPreview(camera({ start: vi.fn(async () => false) })))
      .toEqual({ applied: false, reason: 'The camera did not start.' });
    const failed = camera({ start: vi.fn(async (onError) => { onError?.('No camera available.'); return false; }) });
    expect(await openCameraPreview(failed)).toEqual({ applied: false, reason: 'No camera available.' });
  });
  it('changes the chat language through the registered handler and refuses unknown values or no conversation', async () => {
    const registry = createSessionCommandRegistry();
    const setLanguage = vi.fn();
    const unregister = registry.register({ setLanguage });
    await expect(applySessionCommand(command('language', 'da'), registry, undefined)).resolves.toEqual({ applied: true });
    expect(setLanguage).toHaveBeenCalledWith('da');
    const refused = await applySessionCommand(command('language', 'de'), registry, undefined);
    expect(refused).toMatchObject({ applied: false });
    expect(setLanguage).toHaveBeenCalledTimes(1);
    unregister();
    expect(await applySessionCommand(command('language', 'en'), registry, undefined)).toMatchObject({ applied: false });
    expect(await applySessionCommand(command('language', 'en'), null, undefined)).toMatchObject({ applied: false });
  });

  it('keeps a newer handler when an older registration is cleaned up', () => {
    const registry = createSessionCommandRegistry();
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = registry.register({ setLanguage: first });
    registry.register({ setLanguage: second });
    unregisterFirst();
    expect(registry.handlers.setLanguage).toBe(second);
  });

  it('ends voice only after the session has stopped and refuses when none is running', async () => {
    const registry = createSessionCommandRegistry();
    let resolveStop: () => void = () => {};
    const endVoice = vi.fn(() => new Promise<boolean>((resolve) => { resolveStop = () => resolve(true); }));
    registry.register({ endVoice });
    let settled = false;
    const pending = applySessionCommand(command('voice', 'end'), registry, undefined).then((result) => { settled = true; return result; });
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveStop();
    await expect(pending).resolves.toEqual({ applied: true });
    registry.register({ endVoice: async () => false });
    expect(await applySessionCommand(command('voice', 'end'), registry, undefined)).toMatchObject({ applied: false });
    expect(await applySessionCommand(command('voice', 'end'), createSessionCommandRegistry(), undefined)).toMatchObject({ applied: false });
    expect(await applySessionCommand(command('voice', 'start'), registry, undefined)).toMatchObject({ applied: false });
  });

  it('turns the camera off and faces it front or rear while already sharing', async () => {
    const live = camera({ sharing: true });
    await expect(applySessionCommand(command('camera', 'off'), null, live)).resolves.toEqual({ applied: true });
    expect(live.stop).toHaveBeenCalled();
    permission('prompt');
    await expect(applySessionCommand(command('camera', 'rear'), null, live)).resolves.toEqual({ applied: true });
    expect(live.selectFacing).toHaveBeenCalledWith('environment', expect.any(Function));
    await applySessionCommand(command('camera', 'front'), null, live);
    expect(live.selectFacing).toHaveBeenLastCalledWith('user', expect.any(Function));
  });

  it.each(['prompt', 'denied', 'throws', 'missing'] as const)('refuses to start the camera when permission is %s, without asking', async (state) => {
    permission(state);
    const off = camera();
    const result = await applySessionCommand(command('camera', 'front'), null, off);
    expect(result).toMatchObject({ applied: false, reason: expect.stringContaining('Camera access') });
    expect(off.selectFacing).not.toHaveBeenCalled();
  });

  it('starts the camera when permission was already granted and reports a capture failure as a reason', async () => {
    permission('granted');
    const off = camera();
    await expect(applySessionCommand(command('camera', 'front'), null, off)).resolves.toEqual({ applied: true });
    const failing = camera({
      selectFacing: vi.fn(async (_facing, onError) => { onError?.('No live camera video is available.'); return false; }),
    });
    await expect(applySessionCommand(command('camera', 'rear'), null, failing))
      .resolves.toEqual({ applied: false, reason: 'No live camera video is available.' });
  });

  it('refuses unknown camera values and a missing or busy camera', async () => {
    permission('granted');
    expect(await applySessionCommand(command('camera', 'sideways'), null, camera())).toMatchObject({ applied: false });
    expect(await applySessionCommand(command('camera', 'front'), null, undefined)).toMatchObject({ applied: false });
    expect(await applySessionCommand(command('camera', 'front'), null, camera({ starting: true }))).toMatchObject({ applied: false });
    expect(await applySessionCommand(command('microphone', 'on'), null, camera())).toMatchObject({ applied: false });
  });
});
