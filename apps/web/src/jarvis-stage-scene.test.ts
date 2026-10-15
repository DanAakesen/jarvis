import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJarvisStageScene, type JarvisStageOptions, type JarvisStageScene } from './jarvis-stage-scene';

const probe = vi.hoisted(() => ({
  operations: [] as { kind: 'resize' | 'main' | 'reflection'; at: number }[],
  sizes: [] as { width: number; height: number; ratio: number }[],
  scene: null as THREE.Scene | null,
  canvas: null as HTMLCanvasElement | null,
  parameters: null as THREE.WebGLRendererParameters | null,
  xrEnabled: true,
  shadowAutoUpdate: true,
  targetRestored: true,
  disposed: vi.fn(),
  forceContextLoss: vi.fn(),
}));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof THREE>();
  return {
    ...actual,
    // Only the GPU boundary is fake: construction, geometry, Reflector and scene scheduler are real.
    WebGLRenderer: class {
      domElement = document.createElement('canvas');
      capabilities = { maxTextureSize: 8192 };
      xr = { enabled: true };
      shadowMap = { autoUpdate: true };
      state = { buffers: { depth: { setMask: vi.fn() } }, viewport: vi.fn() };
      autoClear = true;
      private target: THREE.WebGLRenderTarget | null = null;
      private renderGroup = new actual.Group();
      constructor(parameters: THREE.WebGLRendererParameters) {
        probe.parameters = parameters;
        probe.canvas = this.domElement;
      }
      setClearColor() {}
      setDrawingBufferSize(width: number, height: number, ratio: number) {
        this.domElement.width = Math.floor(width * ratio);
        this.domElement.height = Math.floor(height * ratio);
        probe.sizes.push({ width, height, ratio });
        probe.operations.push({ kind: 'resize', at: performance.now() });
      }
      getRenderTarget() { return this.target; }
      setRenderTarget(target: THREE.WebGLRenderTarget | null) { this.target = target; }
      render(scene: THREE.Scene, camera: THREE.Camera) {
        probe.operations.push({ kind: this.target ? 'reflection' : 'main', at: performance.now() });
        probe.scene = scene;
        scene.updateMatrixWorld();
        camera.updateMatrixWorld();
        scene.traverse((object) => {
          if ('isReflector' in object && object.visible && object instanceof actual.Mesh) {
            object.onBeforeRender(this as unknown as THREE.WebGLRenderer, scene, camera,
              object.geometry, object.material, this.renderGroup);
          }
        });
        probe.xrEnabled = this.xr.enabled;
        probe.shadowAutoUpdate = this.shadowMap.autoUpdate;
        probe.targetRestored = this.target === null;
      }
      dispose = probe.disposed;
      forceContextLoss = probe.forceContextLoss;
    },
  };
});

const options: JarvisStageOptions = {
  theme: 'dark', active: true, reducedMotion: false, voiceActive: false, hasWindows: false, orbState: 'idle',
};
let clock = 0;
let nextId = 0;
let callbacks: Map<number, FrameRequestCallback>;
let bounds: { width: number; height: number };
let host: HTMLDivElement;
let scene: JarvisStageScene | null;
let resizeObserved = () => {};
let viewport: EventTarget;

function advance(hz: number, seconds: number) {
  const end = clock + seconds * 1000;
  const step = 1000 / hz;
  while (clock + step <= end + 0.001) {
    clock += step;
    const batch = [...callbacks.values()];
    callbacks.clear();
    batch.forEach((callback) => callback(clock));
  }
}

function draws(kind: 'main' | 'reflection') {
  return probe.operations.filter((operation) => operation.kind === kind).length;
}

function create(initial = options) {
  scene = createJarvisStageScene(host, vi.fn(), initial);
  probe.operations.length = 0;
  return scene;
}

beforeEach(() => {
  vi.clearAllMocks();
  probe.operations.length = 0;
  probe.sizes.length = 0;
  probe.scene = null;
  probe.canvas = null;
  scene = null;
  clock = 0;
  callbacks = new Map();
  bounds = { width: 1440, height: 900 };
  viewport = new EventTarget();
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('CSS', { supports: () => false });
  vi.stubGlobal('devicePixelRatio', 2);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('visualViewport', viewport);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextId;
    callbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resizeObserved = callback; }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const colors = ['background', 'floor', 'wall', 'inset', 'metal', 'seam', 'amber', 'hemisphere',
    'ground', 'key', 'rim', 'orb', 'reflector'];
  colors.forEach((role) => document.documentElement.style.setProperty(`--stage-${role}`, '#526677'));
  const parent = document.createElement('div');
  parent.className = 'app-shell';
  host = document.createElement('div');
  vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => DOMRect.fromRect(bounds));
  parent.append(host);
  document.body.append(parent);
});

afterEach(() => {
  scene?.dispose();
  host.parentElement?.remove();
  document.documentElement.removeAttribute('style');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Jarvis stage fixed render budget', () => {
  it.each([60, 144, 165])('caps actual ambient/voice draws on a %s Hz display and caches the real mirror', (hz) => {
    const room = create();
    advance(hz, 3);
    expect(draws('main')).toBeGreaterThanOrEqual(89);
    expect(draws('main')).toBeLessThanOrEqual(90);
    expect(draws('reflection')).toBeGreaterThanOrEqual(35);
    expect(draws('reflection')).toBeLessThanOrEqual(45);
    expect(probe.parameters?.powerPreference).toBe('low-power');

    probe.operations.length = 0;
    room.update({ ...options, voiceActive: true, orbState: 'speaking' });
    room.setSignals({ inputLevel: () => 0.2, playbackLevel: () => 0.6 });
    advance(hz, 3);
    expect(draws('main')).toBeGreaterThanOrEqual(179);
    expect(draws('main')).toBeLessThanOrEqual(180);
    expect(draws('reflection')).toBeGreaterThanOrEqual(35);
    expect(draws('reflection')).toBeLessThanOrEqual(45);
    expect(probe.sizes).toEqual([{ width: 1440, height: 900, ratio: 1 }]);
    expect(probe.xrEnabled).toBe(true);
    expect(probe.shadowAutoUpdate).toBe(true);
    expect(probe.targetRestored).toBe(true);
  });

  it('coalesces resize sources, skips unchanged buffers and resizes only before drawing', () => {
    create({ ...options, active: false });
    probe.sizes.length = 0;
    window.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('resize'));
    resizeObserved();
    expect(probe.operations).toHaveLength(0);
    advance(60, 1);
    expect(draws('main')).toBe(1);
    expect(probe.sizes).toHaveLength(0);

    probe.operations.length = 0;
    bounds = { width: 390, height: 844 };
    window.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('resize'));
    resizeObserved();
    advance(60, 1);
    expect(probe.sizes).toEqual([{ width: 390, height: 844, ratio: 1 }]);
    expect(probe.operations.map(({ kind }) => kind)).toEqual(['resize', 'main', 'reflection']);
    expect(host.parentElement?.style.getPropertyValue('--jarvis-orb-x')).toBe('195px');
  });

  it('holds inactive and reduced-motion frames, redraws real changes once and resumes the same canvas', () => {
    const room = create();
    const canvas = probe.canvas;
    const reads = vi.spyOn(window, 'getComputedStyle');
    advance(60, 2);
    expect(reads).not.toHaveBeenCalled();
    room.update({ ...options, active: false });
    advance(60, 1);
    probe.operations.length = 0;
    advance(60, 5);
    expect(probe.operations).toHaveLength(0);
    expect(callbacks.size).toBe(0);

    room.update({ ...options, active: false, orbState: 'thinking' });
    room.update({ ...options, active: false, orbState: 'tool' });
    advance(60, 1);
    expect(draws('main')).toBe(1);
    expect(draws('reflection')).toBe(1);
    probe.operations.length = 0;
    room.update({ ...options, reducedMotion: true });
    advance(60, 2);
    expect(draws('main')).toBe(1);
    expect(callbacks.size).toBe(0);
    room.update(options);
    probe.operations.length = 0;
    advance(60, 1);
    expect(draws('main')).toBe(30);
    expect(probe.canvas).toBe(canvas);
    expect(reads).not.toHaveBeenCalled();
  });

  it('pauses hidden/lost contexts and restores a populated frame before clearing the fallback', () => {
    const restored = vi.fn(() => expect(draws('main')).toBeGreaterThan(0));
    const lost = vi.fn();
    scene = createJarvisStageScene(host, lost, options, restored);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    probe.operations.length = 0;
    advance(60, 2);
    expect(probe.operations).toHaveLength(0);
    expect(callbacks.size).toBe(0);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    advance(60, 1);
    expect(draws('main')).toBe(30);

    probe.canvas!.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(lost).toHaveBeenCalledOnce();
    probe.operations.length = 0;
    advance(60, 1);
    expect(probe.operations).toHaveLength(0);
    probe.canvas!.dispatchEvent(new Event('webglcontextrestored'));
    expect(restored).toHaveBeenCalledOnce();
    expect(draws('reflection')).toBe(1);
    scene.dispose();
    scene.dispose();
    expect(probe.disposed).toHaveBeenCalledOnce();
    expect(probe.forceContextLoss).toHaveBeenCalledOnce();
    expect(callbacks.size).toBe(0);
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('refreshes a still mirror when measured phone dock lengths change without new option values', () => {
    bounds = { width: 390, height: 844 };
    const shell = host.parentElement!;
    shell.style.setProperty('--jarvis-orb-dock-radius', '40px');
    shell.style.setProperty('--jarvis-orb-dock-bottom', '100px');
    const stillVoice = { ...options, reducedMotion: true, voiceActive: true };
    const room = create(stillVoice);
    expect(shell.style.getPropertyValue('--jarvis-orb-y')).toBe('704px');
    shell.style.setProperty('--jarvis-orb-dock-bottom', '200px');
    room.update(stillVoice);
    advance(60, 1);
    expect(shell.style.getPropertyValue('--jarvis-orb-y')).toBe('604px');
    expect(draws('main')).toBe(1);
    expect(draws('reflection')).toBe(1);
  });

  it('retains the room and single-pass orb inside the reduced authored-geometry budget', () => {
    create();
    let meshes = 0;
    let triangles = 0;
    let ribbons = 0;
    probe.scene!.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      meshes += 1;
      const vertices = object.geometry.index?.count ?? object.geometry.getAttribute('position').count;
      triangles += vertices / 3 * (object instanceof THREE.InstancedMesh ? object.count : 1);
      if (!Array.isArray(object.material) && object.material.transparent && object.material.side === THREE.DoubleSide) {
        ribbons += 1;
        expect(object.material.forceSinglePass).toBe(true);
        expect(object.geometry.index?.count).toBe(9 * 128 * 6);
      }
    });
    expect(meshes).toBeLessThan(125);
    expect(triangles).toBeLessThan(80_000);
    expect(ribbons).toBe(1);
    const mirror = probe.scene!.children.find((child): child is Reflector => child instanceof Reflector)!;
    expect(mirror.getRenderTarget().width).toBe(384);
    expect((mirror.material as THREE.ShaderMaterial).polygonOffset).toBe(true);
  });
});
