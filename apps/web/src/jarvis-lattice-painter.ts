import { orbAppearance } from './jarvis-orb-appearance';
import { latticeLineScale, detailMinimal, type LatticeScene, type SceneDot } from './jarvis-lattice';
import { smoothstep, type OrbFrame } from './jarvis-orb-motion';

/*
 * Canvas 2D painter for a posed lattice (see jarvis-lattice.ts). It is a port of JarvisLatticePainter in JarvisCore:
 * dark glass, an amber heart haze, additive connections merged into a few paths by colour and brightness, dots with
 * halos, travelling signals, the hot heart, the glass rim and two highlight arcs. It draws into any square canvas
 * at any size, so the composer button, the working mark and the stage texture share one drawing.
 */

type RGB = readonly [number, number, number];

const edgeCool: RGB = [0.22, 0.70, 1.0];
const edgeWarm: RGB = [1.0, 0.5, 0.07];
const nodeCool: RGB = [0.58, 0.92, 1.0];
const edgeMiddle: RGB = [0.45, 0.78, 0.62];
const nodeMiddle: RGB = [0.72, 0.9, 0.55];
const nodeWarm: RGB = [1.0, 0.64, 0.16];
const haze: RGB = [1.0, 0.42, 0.06];
const spark: RGB = [1.0, 0.93, 0.78];
const signalCool: RGB = [0.45, 0.85, 1.0];
const signalWarm: RGB = [1.0, 0.8, 0.4];
const warmBuckets = 6;
const alphaBuckets = 12;
const alphaStep = 0.07;

/** Share of half the canvas the glass sphere fills; the rest is a margin for antialiasing. */
export const latticeRadiusFraction = 0.97;

export type LatticePaintOptions = {
  /** Side of the square to paint, in CSS pixels. The caller sets the canvas transform for device pixels. */
  size: number;
  /** Draw the dark glass, rim and highlights. Without it only the network is drawn, at full brightness. */
  glass?: boolean;
};

const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Cool to warm through a teal-green middle, so the transition never washes out to grey. */
const blend = (cool: RGB, middle: RGB, warm: RGB, t: number): RGB => (t < 0.5 ? mix(cool, middle, t * 2) : mix(middle, warm, t * 2 - 1));

function rgba(color: RGB, opacity: number) {
  const channel = (value: number) => Math.round(clamp(value) * 255);
  return `rgba(${channel(color[0])},${channel(color[1])},${channel(color[2])},${clamp(opacity).toFixed(3)})`;
}

function hexToRgb(hex: string): RGB {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255];
}

const appearance = {
  cool: hexToRgb(orbAppearance.cool),
  deep: hexToRgb(orbAppearance.deep),
  warm: hexToRgb(orbAppearance.warm),
  hot: hexToRgb(orbAppearance.hot),
};

export function paintLattice(
  context: CanvasRenderingContext2D,
  scene: LatticeScene,
  frame: OrbFrame,
  { size, glass = true }: LatticePaintOptions,
) {
  const half = size / 2;
  const radius = half * latticeRadiusFraction;
  const px = (x: number) => half + x * radius;
  const py = (y: number) => half - y * radius;

  context.save();
  context.clearRect(0, 0, size, size);
  if (glass) {
    context.beginPath();
    context.arc(half, half, radius, 0, Math.PI * 2);
    context.clip();
    paintGlass(context, half, radius);
  }
  context.globalCompositeOperation = 'lighter';
  paintHeartGlow(context, scene, px, py, radius);
  paintEdges(context, scene, px, py, radius);
  paintDots(context, scene, px, py, radius);
  paintSignals(context, scene.signals, px, py, radius);
  paintHeartCore(context, scene, px, py, radius);
  if (glass) {
    paintRim(context, scene, frame, half, radius);
    paintLimb(context, scene, frame, half, radius);
  }
  context.restore();
}

function paintGlass(context: CanvasRenderingContext2D, half: number, radius: number) {
  const shading = context.createRadialGradient(half, half, 0, half, half, radius);
  shading.addColorStop(0, 'rgba(3,8,19,0.92)');
  shading.addColorStop(0.72, 'rgba(4,13,31,0.92)');
  shading.addColorStop(1, 'rgba(6,26,62,0.95)');
  context.fillStyle = shading;
  context.beginPath();
  context.arc(half, half, radius, 0, Math.PI * 2);
  context.fill();
}

function paintHeartGlow(
  context: CanvasRenderingContext2D,
  scene: LatticeScene,
  px: (x: number) => number,
  py: (y: number) => number,
  radius: number,
) {
  const { heart } = scene;
  const x = px(heart.x);
  const y = py(heart.y);
  // A wide orange haze under a tighter amber glow: the warmth spreads outward from the heart.
  const wide = heart.radius * radius * 2;
  const haziness = context.createRadialGradient(x, y, 0, x, y, wide);
  haziness.addColorStop(0, rgba(haze, heart.intensity * 0.38));
  haziness.addColorStop(0.5, rgba(haze, heart.intensity * 0.17));
  haziness.addColorStop(1, rgba(haze, 0));
  context.fillStyle = haziness;
  context.beginPath();
  context.arc(x, y, wide, 0, Math.PI * 2);
  context.fill();
  const reach = heart.radius * radius * 1.05;
  const shading = context.createRadialGradient(x, y, 0, x, y, reach);
  shading.addColorStop(0, rgba(edgeWarm, heart.intensity * 0.55));
  shading.addColorStop(0.5, rgba(edgeWarm, heart.intensity * 0.2));
  shading.addColorStop(1, rgba(edgeWarm, 0));
  context.fillStyle = shading;
  context.beginPath();
  context.arc(x, y, reach, 0, Math.PI * 2);
  context.fill();
}

/** The heart: an amber glow with only a tiny pale spark at its centre. */
function paintHeartCore(
  context: CanvasRenderingContext2D,
  scene: LatticeScene,
  px: (x: number) => number,
  py: (y: number) => number,
  radius: number,
) {
  const { heart } = scene;
  const x = px(heart.x);
  const y = py(heart.y);
  const reach = radius * 0.1 * (1 + heart.heat);
  const shading = context.createRadialGradient(x, y, 0, x, y, reach);
  shading.addColorStop(0, rgba(appearance.hot, heart.heat * 0.7));
  shading.addColorStop(0.4, rgba(appearance.warm, heart.heat * 0.3));
  shading.addColorStop(1, rgba(appearance.warm, 0));
  context.fillStyle = shading;
  context.beginPath();
  context.arc(x, y, reach, 0, Math.PI * 2);
  context.fill();
  const point = radius * 0.02 * (1 + 0.5 * heart.heat);
  const flare = context.createRadialGradient(x, y, 0, x, y, point);
  flare.addColorStop(0, rgba(spark, heart.heat * 0.85));
  flare.addColorStop(1, rgba(spark, 0));
  context.fillStyle = flare;
  context.beginPath();
  context.arc(x, y, point, 0, Math.PI * 2);
  context.fill();
}

/** Connections are merged into a few paths by colour and brightness, so a frame costs a few dozen strokes. */
function paintEdges(
  context: CanvasRenderingContext2D,
  scene: LatticeScene,
  px: (x: number) => number,
  py: (y: number) => number,
  radius: number,
) {
  const width = Math.max(0.5, radius * 0.004 * latticeLineScale(scene.detail));
  const lines = new Map<number, Path2D>();
  const glows = new Map<number, Path2D>();
  const bucket = (map: Map<number, Path2D>, key: number) => {
    let path = map.get(key);
    if (!path) {
      path = new Path2D();
      map.set(key, path);
    }
    return path;
  };
  for (const edge of scene.edges) {
    const warm = Math.min(warmBuckets - 1, Math.trunc(edge.warmth * warmBuckets));
    const alpha = Math.min(alphaBuckets - 1, Math.trunc(edge.alpha / alphaStep));
    const line = bucket(lines, warm * alphaBuckets + alpha);
    line.moveTo(px(edge.ax), py(edge.ay));
    line.quadraticCurveTo(px(edge.cx), py(edge.cy), px(edge.bx), py(edge.by));
    if (edge.light > 0.12) {
      const glow = bucket(glows, warm * 4 + Math.min(3, Math.trunc(edge.light * 4)));
      glow.moveTo(px(edge.ax), py(edge.ay));
      glow.quadraticCurveTo(px(edge.cx), py(edge.cy), px(edge.bx), py(edge.by));
    }
  }
  context.lineCap = 'round';
  for (const [key, path] of lines) {
    const warm = Math.trunc(key / alphaBuckets) % warmBuckets + 0.5;
    const alpha = (key % alphaBuckets + 0.5) * alphaStep;
    const tone = blend(edgeCool, edgeMiddle, edgeWarm, warm / warmBuckets);
    context.lineWidth = width;
    context.strokeStyle = rgba(tone, alpha);
    context.stroke(path);
    if (scene.detail !== detailMinimal) {
      context.lineWidth = width * 4.5;
      context.strokeStyle = rgba(tone, alpha * (0.1 + 0.26 * warm / warmBuckets));
      context.stroke(path);
    }
  }
  context.lineWidth = width * 2.4;
  for (const [key, path] of glows) {
    const warm = Math.trunc(key / 4) + 0.5;
    const light = (key % 4 + 0.5) / 4;
    context.strokeStyle = rgba(blend(edgeCool, edgeMiddle, edgeWarm, warm / warmBuckets), light * 0.22);
    context.stroke(path);
  }
}

function addCircle(path: Path2D, x: number, y: number, radius: number) {
  path.moveTo(x + radius, y);
  path.arc(x, y, radius, 0, Math.PI * 2);
}

function paintHalo(context: CanvasRenderingContext2D, x: number, y: number, radius: number, tone: RGB, strength: number) {
  const shading = context.createRadialGradient(x, y, 0, x, y, radius);
  shading.addColorStop(0, rgba(tone, strength));
  shading.addColorStop(1, rgba(tone, 0));
  context.fillStyle = shading;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
}

function paintDots(
  context: CanvasRenderingContext2D,
  scene: LatticeScene,
  px: (x: number) => number,
  py: (y: number) => number,
  radius: number,
) {
  const bodies = new Map<number, Path2D>();
  for (const dot of scene.dots) {
    const r = Math.max(0.6, dot.radius * radius);
    const x = px(dot.x);
    const y = py(dot.y);
    if (dot.halo > 0.05) paintHalo(context, x, y, r * 3.6, blend(nodeCool, nodeMiddle, nodeWarm, dot.warmth), dot.halo * 0.42);
    const key = Math.min(3, Math.trunc(dot.warmth * 4)) * 6 + Math.min(5, Math.trunc(dot.alpha * 6));
    let path = bodies.get(key);
    if (!path) {
      path = new Path2D();
      bodies.set(key, path);
    }
    addCircle(path, x, y, r);
  }
  for (const [key, path] of bodies) {
    const warm = (Math.trunc(key / 6) + 0.5) / 4;
    const alpha = (key % 6 + 0.5) / 6;
    context.fillStyle = rgba(blend(nodeCool, nodeMiddle, nodeWarm, warm), alpha);
    context.fill(path);
  }
}

function paintSignals(
  context: CanvasRenderingContext2D,
  signals: SceneDot[],
  px: (x: number) => number,
  py: (y: number) => number,
  radius: number,
) {
  for (const dot of signals) {
    const r = Math.max(0.6, dot.radius * radius);
    const x = px(dot.x);
    const y = py(dot.y);
    const tone = mix(signalCool, signalWarm, dot.warmth);
    if (dot.halo > 0.05) paintHalo(context, x, y, r * 3, tone, dot.halo * 0.35);
    context.fillStyle = rgba(tone, dot.alpha);
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    context.fill();
  }
}

/** The glass body's soft blue falloff, answering to the wake front, listening ripples, thinking tides and speech. */
function paintRim(context: CanvasRenderingContext2D, scene: LatticeScene, frame: OrbFrame, half: number, radius: number) {
  const m = frame.motion;
  const time = frame.time;
  const breathing = 0.5 + 0.5 * Math.sin(time * 1.7);
  let lively = 1 + m.surge * 0.9;
  lively += m.speak * m.speech * 1.1;
  lively += m.listen * breathing * 0.18;
  const strength = (0.62 + 0.53 * m.awake) * lively * clamp(0.6 + 0.4 * scene.outerGain, 0, 1.3);
  const { deep, cool, warm } = appearance;
  const shading = context.createRadialGradient(half, half, 0, half, half, radius);
  const steps = 48;
  for (let step = 0; step <= steps; step += 1) {
    const rho = step / steps;
    const edge = Math.pow(1 - Math.sqrt(1 - rho * rho), 2.7);
    const front = Math.exp(-Math.pow((edge - m.wave) * 7, 2)) * m.waveStrength;
    const ripple = Math.pow(0.5 + 0.5 * Math.sin(edge * 19 - time * 3.4), 10) * m.listen * (0.28 + m.input * 1.6);
    const inward = Math.pow(0.5 + 0.5 * Math.sin(edge * 15 + time * 2.7), 12) * m.think * 0.55;
    const voiceRing = Math.pow(0.5 + 0.5 * Math.sin(edge * 10 - time * 5.2), 6) * m.speak * m.speech * 1.4;
    const glow = edge * 1.5 * strength * (0.62 + 0.38 * m.awake);
    let r = deep[0] * glow * 0.9;
    let g = deep[1] * glow * 1.1;
    let b = deep[2] * glow;
    const ring = (ripple + voiceRing) * (0.35 + edge * 0.8);
    r += cool[0] * ring;
    g += cool[1] * ring;
    b += cool[2] * ring;
    const wave = smoothstep(0.1, 0.7, m.wave);
    const frontMix = front * 1.6;
    r += (warm[0] * (1 - wave) + 0.62 * wave) * frontMix;
    g += (warm[1] * (1 - wave) + 0.9 * wave) * frontMix;
    b += (warm[2] * (1 - wave) + 1.0 * wave) * frontMix;
    const tide = inward * (1 - edge * 0.4);
    r += (cool[0] * 0.65 + warm[0] * 0.35) * tide;
    g += (cool[1] * 0.65 + warm[1] * 0.35) * tide;
    b += (cool[2] * 0.65 + warm[2] * 0.35) * tide;
    const alpha = edge * 0.3 + 0.004 + front * 0.5 + (ripple + voiceRing + inward) * 0.22;
    const peak = Math.max(r, g, b, 1);
    shading.addColorStop(rho, rgba([r / peak, g / peak, b / peak], clamp(alpha, 0, 0.86)));
  }
  context.fillStyle = shading;
  context.beginPath();
  context.arc(half, half, radius, 0, Math.PI * 2);
  context.fill();
}

/**
 * The lit edge of the glass: cyan along the upper left, a warm amber rim on the lower right and a soft inner
 * highlight, as if one cool and one warm light were catching it. Conic angles run clockwise from three o'clock.
 */
function paintLimb(context: CanvasRenderingContext2D, scene: LatticeScene, frame: OrbFrame, half: number, radius: number) {
  if (typeof context.createConicGradient !== 'function') return;
  const m = frame.motion;
  const lift = (0.55 + 0.45 * m.awake) * (1 + 0.25 * m.surge + 0.2 * m.listen * m.input)
    * clamp(0.7 + 0.3 * scene.outerGain, 0, 1.3);
  const cyan: RGB = [0.42, 0.88, 1.0];
  const blue: RGB = [0.16, 0.5, 0.95];
  const amber: RGB = [1.0, 0.44, 0.06];
  const stops: [number, RGB, number][] = [
    [0, blue, 0.34], [22, amber, 0.45], [40, amber, 0.95], [60, amber, 1.0], [84, amber, 0.9], [108, amber, 0.4], [132, cyan, 0.36], [160, cyan, 0.6],
    [185, cyan, 0.9], [212, cyan, 1.0], [245, cyan, 0.8], [285, cyan, 0.45], [330, blue, 0.28], [360, blue, 0.34],
  ];
  const ring = (inset: number, thickness: number, strength: number) => {
    const shading = context.createConicGradient(0, half, half);
    for (const [angle, tone, level] of stops) shading.addColorStop(angle / 360, rgba(tone, level * strength * lift));
    context.strokeStyle = shading;
    context.lineWidth = radius * thickness;
    context.beginPath();
    context.arc(half, half, radius * (1 - inset), 0, Math.PI * 2);
    context.stroke();
  };
  if (scene.detail !== detailMinimal) {
    ring(0.05, 0.08, 0.3);
    ring(0.02, 0.034, 0.7);
  }
  ring(0.006, 0.014, 1);
  ring(0.003, 0.005, 0.9);
  if (scene.detail !== detailMinimal) {
    // The soft inner highlight sits just inside the cyan side.
    const sheen = context.createConicGradient(0, half, half);
    sheen.addColorStop(0, rgba(cyan, 0));
    sheen.addColorStop(150 / 360, rgba(cyan, 0));
    sheen.addColorStop(215 / 360, rgba([0.8, 0.95, 1.0], 0.2 * lift));
    sheen.addColorStop(275 / 360, rgba(cyan, 0));
    sheen.addColorStop(1, rgba(cyan, 0));
    context.strokeStyle = sheen;
    context.lineWidth = radius * 0.1;
    context.beginPath();
    context.arc(half, half, radius * 0.93, 0, Math.PI * 2);
    context.stroke();
  }
}
