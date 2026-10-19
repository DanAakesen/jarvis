import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { KnowledgeGraph } from './knowledge-data';
import { createKnowledgeLayout } from './knowledge-layout';

export interface KnowledgeSceneCallbacks {
  onSelect: (id: string) => void;
  onHover: (hover: { id: string; x: number; y: number } | null) => void;
  /** Screen positions of labelled stars (highlights and the selection), refreshed after each rendered frame. */
  onLabels: (labels: { id: string; x: number; y: number }[]) => void;
}

const frameInterval = 1000 / 30;

// Feel of the idle map. Drift is the orbit radius as a share of the cloud's spread; sparks are the links that light up.
const driftShare = 0.03;
const sparkGap = [140, 420] as const;
const sparkLife = [1300, 2300] as const;
const maxSparks = 14;
// The map opens fitted to the window: the notes fill this share of the limiting dimension.
const fitFill = 0.8;
// A click or hover finds the nearest star within this many pixels.
const pickRadius = 9;

function folderColours(element: HTMLElement): Map<string, THREE.Color> {
  const styles = getComputedStyle(element);
  const read = (name: string, fallback: string) => new THREE.Color(styles.getPropertyValue(name).trim() || fallback);
  return new Map([
    ['People', read('--graph-people', '#4aa8ff')],
    ['Work', read('--graph-work', '#ffb45c')],
    ['Personal', read('--graph-personal', '#3ddc97')],
    ['General', read('--graph-general', '#b69cff')],
    ['', read('--text-muted', '#a4b5bb')],
  ]);
}

// Idle life on a flat map (Dan, 8 October, 19 October): each note floats on its own orbit while a soft swell runs through
// the whole cloud; links follow. driftAt mirrors this, so a star is picked where it is drawn.
const driftChunk = `vec2 float_drift(vec2 at, float phase, float time) {
  vec2 own = vec2(sin(time * (0.55 + phase * 0.45) + phase * 6.2831), cos(time * (0.5 + phase * 0.4) + phase * 9.1));
  vec2 swell = vec2(sin(at.y * 0.3 + time * 0.6), cos(at.x * 0.27 + time * 0.5)) * 0.7;
  return own + swell;
}`;

function driftAt(x: number, y: number, phase: number, time: number, out: { x: number; y: number }) {
  out.x = Math.sin(time * (0.55 + phase * 0.45) + phase * 6.2831) + 0.7 * Math.sin(y * 0.3 + time * 0.6);
  out.y = Math.cos(time * (0.5 + phase * 0.4) + phase * 9.1) + 0.7 * Math.cos(x * 0.27 + time * 0.5);
}

const lineVertex = `attribute vec3 lineColour;
attribute float phase;
uniform float time;
uniform float drift;
varying vec3 vColour;
${driftChunk}
void main() {
  vColour = lineColour;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position + vec3(float_drift(position.xy, phase, time) * drift, 0.0), 1.0);
}`;

const lineFragment = `varying vec3 vColour;
void main() { gl_FragColor = vec4(vColour, 1.0); }`;

const pointVertex = `
attribute float size;
attribute vec3 colour;
attribute float lit;
attribute float shown;
attribute float phase;
attribute float flare;
uniform float dimOthers;
uniform float pixelRatio;
uniform float time;
uniform float drift;
varying vec3 vColour;
varying float vAlpha;
${driftChunk}
void main() {
  vec4 view = modelViewMatrix * vec4(position + vec3(float_drift(position.xy, phase, time) * drift, 0.0), 1.0);
  float emphasis = mix(1.0 - dimOthers * 0.82, 1.0, lit);
  // Idle life: every star breathes on its own rhythm and flares briefly when a spark reaches it.
  float breath = sin(time * (0.9 + phase * 0.7) + phase * 6.2831);
  vColour = colour * mix(1.0, 1.6, lit) * (0.82 + 0.18 * breath) * (1.0 + flare * 1.3);
  vAlpha = emphasis * shown;
  gl_PointSize = shown * size * pixelRatio * (1.0 + lit * 0.7) * (1.0 + 0.12 * breath) * (1.0 + flare * 0.55) * (400.0 / max(1.0, -view.z));
  gl_Position = projectionMatrix * view;
}`;

const pointFragment = `
varying vec3 vColour;
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float distance = length(uv);
  if (distance > 0.5) discard;
  // A crisp core with only a faint halo, so dense areas stay legible instead of blooming.
  float core = smoothstep(0.3, 0.12, distance);
  float glow = pow(smoothstep(0.5, 0.0, distance), 2.4) * 0.28;
  gl_FragColor = vec4(vColour * (core + glow), (core + glow) * vAlpha);
}`;

/**
 * The knowledge map, drawn flat with WebGL: one draw call for every note, one for every link. It opens centred on the notes
 * and fitted to the window, following while the layout settles until the first pan or zoom. At 30 fps its stars breathe and
 * drift, and pulses run along links and flare the notes they reach; dragging pans and the wheel zooms; it stops drawing
 * when off-screen or hidden, and stays still with reduced motion.
 */
export function createKnowledgeScene(host: HTMLElement, graph: KnowledgeGraph, callbacks: KnowledgeSceneCallbacks, reducedMotion: boolean) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(pixelRatio);
  host.appendChild(renderer.domElement);
  renderer.domElement.className = 'knowledge-canvas';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2000);
  const layout = createKnowledgeLayout(graph);
  if (reducedMotion) layout.settle();
  const spread = 26 * Math.cbrt(Math.max(graph.nodes.length, 8) / 400);
  // A flat map seen straight on (Dan, 8 October): no perspective tilt or rotation, only pan and zoom.
  camera.position.set(0, 0, spread * 2.4);

  const colours = folderColours(host);
  const count = graph.nodes.length;
  const colourArray = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const lit = new Float32Array(count);
  graph.nodes.forEach((node, index) => {
    const colour = colours.get(node.folder) ?? colours.get('')!;
    colourArray.set([colour.r, colour.g, colour.b], index * 3);
    sizes[index] = 1.9 + Math.min(3, Math.sqrt(node.degree) * 0.7);
  });
  const pointGeometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(layout.positions, 3);
  pointGeometry.setAttribute('position', positionAttribute);
  pointGeometry.setAttribute('colour', new THREE.BufferAttribute(colourArray, 3));
  pointGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  const litAttribute = new THREE.BufferAttribute(lit, 1);
  pointGeometry.setAttribute('lit', litAttribute);
  const shown = new Float32Array(count).fill(1);
  const shownAttribute = new THREE.BufferAttribute(shown, 1);
  pointGeometry.setAttribute('shown', shownAttribute);
  const flares = new Float32Array(count);
  const flareAttribute = new THREE.BufferAttribute(flares, 1);
  pointGeometry.setAttribute('flare', flareAttribute);
  const phases = new Float32Array(count);
  for (let index = 0; index < count; index += 1) phases[index] = Math.abs(Math.sin(index * 12.9898) * 43758.5453) % 1;
  pointGeometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
  const pointMaterial = new THREE.ShaderMaterial({
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
    uniforms: { dimOthers: { value: 0 }, pixelRatio: { value: pixelRatio }, time: { value: 0 }, drift: { value: reducedMotion ? 0 : spread * driftShare } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(pointGeometry, pointMaterial);
  scene.add(points);

  const indexOf = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const edgePairs = graph.edges.flatMap((edge) => {
    const source = indexOf.get(edge.source);
    const target = indexOf.get(edge.target);
    return source === undefined || target === undefined ? [] : [{ source, target, similar: edge.type === 'similar', score: edge.score ?? 0.4 }];
  });
  const linePositions = new Float32Array(edgePairs.length * 6);
  const lineColours = new Float32Array(edgePairs.length * 6);
  const baseLineColours = new Float32Array(edgePairs.length * 6);
  edgePairs.forEach(({ source, target, similar, score }, edge) => {
    // Links are firm; similarity lines brighten with their score (median about 0.32).
    const strength = similar ? 0.06 + 0.42 * score : 0.5;
    for (const [end, node] of [[0, source], [1, target]] as const) {
      const colour = colours.get(graph.nodes[node]!.folder) ?? colours.get('')!;
      baseLineColours.set([colour.r * strength, colour.g * strength, colour.b * strength], edge * 6 + end * 3);
    }
  });
  lineColours.set(baseLineColours);
  // Current brightness factor per link (search and folder emphasis), so the idle sparks can brighten on top of it.
  const edgeFactor = new Float32Array(edgePairs.length).fill(1);
  const lineGeometry = new THREE.BufferGeometry();
  const linePositionAttribute = new THREE.BufferAttribute(linePositions, 3);
  const lineColourAttribute = new THREE.BufferAttribute(lineColours, 3);
  lineGeometry.setAttribute('position', linePositionAttribute);
  lineGeometry.setAttribute('lineColour', lineColourAttribute);
  const linePhases = new Float32Array(edgePairs.length * 2);
  edgePairs.forEach(({ source, target }, edge) => { linePhases[edge * 2] = phases[source]!; linePhases[edge * 2 + 1] = phases[target]!; });
  lineGeometry.setAttribute('phase', new THREE.BufferAttribute(linePhases, 1));
  const lineMaterial = new THREE.ShaderMaterial({
    vertexShader: lineVertex,
    fragmentShader: lineFragment,
    uniforms: { time: pointMaterial.uniforms.time!, drift: pointMaterial.uniforms.drift! },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
  scene.add(lines);

  const syncLines = () => {
    edgePairs.forEach(({ source, target }, edge) => {
      linePositions.set(layout.positions.subarray(source * 3, source * 3 + 3), edge * 6);
      linePositions.set(layout.positions.subarray(target * 3, target * 3 + 3), edge * 6 + 3);
    });
    linePositionAttribute.needsUpdate = true;
    positionAttribute.needsUpdate = true;
    pointGeometry.computeBoundingSphere();
  };
  syncLines();

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !reducedMotion;
  controls.dampingFactor = 0.08;
  controls.minDistance = spread * 0.15;
  controls.maxDistance = spread * 6;
  controls.enableRotate = false;
  controls.screenSpacePanning = true;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.autoRotate = false;

  let highlighted: string[] = [];
  let selected: string | null = null;
  let settling = !reducedMotion;
  let flight: { from: THREE.Vector3; to: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; start: number; duration: number } | null = null;
  let frame = 0;
  let last = 0;
  let disposed = false;
  // The map opens fitted and keeps following the cloud while it settles, until the user (or a search) takes the camera.
  let following = true;
  const fitTarget = new THREE.Vector3(0, 0, spread * 2.4);
  const fitCentre = new THREE.Vector3();
  // Between interactions the stars breathe and drift, and links light up one after another: a pulse runs from one note
  // to the next, and the note it reaches flares.
  const sparks: { edge: number; start: number; life: number }[] = [];
  const flaring: number[] = [];
  let nextSpark = performance.now() + 300;
  let onScreen = true;
  const paintEdge = (edge: number, boostSource: number, boostTarget = boostSource) => {
    const factor = edgeFactor[edge]!;
    for (let channel = 0; channel < 3; channel += 1) {
      lineColours[edge * 6 + channel] = baseLineColours[edge * 6 + channel]! * factor * (1 + boostSource);
      lineColours[edge * 6 + 3 + channel] = baseLineColours[edge * 6 + 3 + channel]! * factor * (1 + boostTarget);
    }
  };
  const clearFlares = () => {
    for (const node of flaring) flares[node] = 0;
    flaring.length = 0;
  };
  const flare = (node: number, value: number) => {
    if (value < 0.02 || value <= flares[node]!) return;
    flares[node] = value;
    flaring.push(node);
  };
  const bell = (t: number, from: number, to: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, (t - from) / (to - from))));
  const stepSparks = (now: number) => {
    if (!edgePairs.length) return;
    if (now >= nextSpark) {
      const edge = Math.floor(Math.random() * edgePairs.length);
      const pair = edgePairs[edge]!;
      if (sparks.length < maxSparks && shown[pair.source] === 1 && shown[pair.target] === 1 && !sparks.some((spark) => spark.edge === edge)) {
        sparks.push({ edge, start: now, life: sparkLife[0] + Math.random() * (sparkLife[1] - sparkLife[0]) });
      }
      nextSpark = now + sparkGap[0] + Math.random() * (sparkGap[1] - sparkGap[0]);
    }
    clearFlares();
    for (let index = sparks.length - 1; index >= 0; index -= 1) {
      const spark = sparks[index]!;
      const pair = edgePairs[spark.edge]!;
      const t = (now - spark.start) / spark.life;
      if (t >= 1) { paintEdge(spark.edge, 0); sparks.splice(index, 1); continue; }
      const gain = pair.similar ? 2.6 : 1.1;
      const leaving = bell(t, 0, 0.6);
      const arriving = bell(t, 0.4, 1);
      paintEdge(spark.edge, leaving * gain, arriving * gain);
      flare(pair.source, leaving * 0.4);
      flare(pair.target, arriving * 0.9);
    }
    lineColourAttribute.needsUpdate = true;
    flareAttribute.needsUpdate = true;
  };
  const driftScratch = { x: 0, y: 0 };
  const probe = new THREE.Vector3();
  // Where a star is drawn right now: its layout position plus the idle drift the shader applies (none under reduced motion).
  const drawnAt = (index: number) => {
    const x = layout.positions[index * 3]!;
    const y = layout.positions[index * 3 + 1]!;
    driftAt(x, y, phases[index]!, pointMaterial.uniforms.time!.value as number, driftScratch);
    const amount = pointMaterial.uniforms.drift!.value as number;
    return probe.set(x + driftScratch.x * amount, y + driftScratch.y * amount, layout.positions[index * 3 + 2]!);
  };

  const labelled = () => [...new Set([...highlighted.slice(0, 12), ...(selected ? [selected] : [])])];
  const project = (id: string) => {
    const index = indexOf.get(id);
    if (index === undefined) return null;
    const vector = drawnAt(index).project(camera);
    if (vector.z > 1) return null;
    const bounds = renderer.domElement.getBoundingClientRect();
    return { id, x: (vector.x + 1) / 2 * bounds.width, y: (1 - vector.y) / 2 * bounds.height };
  };

  const render = () => {
    renderer.render(scene, camera);
    callbacks.onLabels(labelled().flatMap((id) => project(id) ?? []));
  };

  // The middle of the visible notes and how far they reach (98th percentile, so a few strays do not shrink the map) give the framing.
  const measureFit = () => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let index = 0; index < count; index += 1) {
      if (shown[index] !== 1) continue;
      xs.push(layout.positions[index * 3]!);
      ys.push(layout.positions[index * 3 + 1]!);
    }
    if (!xs.length) return null;
    const middle = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const reach = (values: number[], centre: number) => {
      const away = values.map((value) => Math.abs(value - centre)).sort((a, b) => a - b);
      return away[Math.min(away.length - 1, Math.floor(away.length * 0.98))]!;
    };
    const cx = middle(xs);
    const cy = middle(ys);
    const half = Math.tan((camera.fov * Math.PI) / 360);
    const pad = spread * 0.06;
    const need = Math.max((reach(ys, cy) + pad) / half, (reach(xs, cx) + pad) / (half * camera.aspect)) / fitFill;
    return { centre: new THREE.Vector3(cx, cy, 0), to: new THREE.Vector3(cx, cy, Math.min(spread * 4.5, Math.max(spread * 1.2, need))) };
  };
  const aimAtCloud = (snap: boolean) => {
    const fit = measureFit();
    if (!fit) return;
    fitCentre.copy(fit.centre);
    fitTarget.copy(fit.to);
    if (!snap) return;
    camera.position.copy(fit.to);
    controls.target.copy(fit.centre);
    controls.update();
  };
  const followCloud = () => {
    camera.position.lerp(fitTarget, 0.14);
    controls.target.lerp(fitCentre, 0.14);
  };

  // One chain of frames only: OrbitControls fires change while the loop updates it, and that must not start another.
  let inLoop = false;
  const loop = (now: number) => {
    frame = 0;
    if (disposed) return;
    if (document.hidden || !onScreen) return;
    if (now - last < frameInterval - 4) { frame = requestAnimationFrame(loop); return; }
    last = now;
    let moving = false;
    if (settling) {
      settling = layout.step();
      syncLines();
      if (following) aimAtCloud(false);
      moving = true;
    }
    if (following) followCloud();
    if (flight) {
      const t = Math.min(1, (now - flight.start) / flight.duration);
      const eased = 1 - Math.pow(1 - t, 3);
      camera.position.lerpVectors(flight.from, flight.to, eased);
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, eased);
      if (t >= 1) flight = null;
      moving = true;
    }
    if (!reducedMotion) {
      pointMaterial.uniforms.time!.value = now / 1000;
      stepSparks(now);
      // Breathing stars and sparks keep the map alive between interactions.
      moving = true;
    }
    inLoop = true;
    if (controls.update() || controls.autoRotate) moving = true;
    inLoop = false;
    render();
    if (moving) frame = requestAnimationFrame(loop);
  };
  const wake = () => { if (!frame && !disposed && !inLoop) frame = requestAnimationFrame(loop); };

  const resize = () => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (following) aimAtCloud(true);
    wake();
    if (reducedMotion) render();
  };
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(host);
  const intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
    onScreen = entries.some((entry) => entry.isIntersecting);
    if (onScreen) wake();
  }) : null;
  intersection?.observe(host);
  resize();

  // Finds the star nearest the pointer, at the position it is drawn (drift included).
  const pick = (event: PointerEvent) => {
    const bounds = renderer.domElement.getBoundingClientRect();
    const px = event.clientX - bounds.left;
    const py = event.clientY - bounds.top;
    let best = -1;
    let bestDistance = pickRadius * pickRadius;
    for (let index = 0; index < count; index += 1) {
      if (shown[index] !== 1) continue;
      const star = drawnAt(index).project(camera);
      if (star.z > 1) continue;
      const dx = (star.x + 1) / 2 * bounds.width - px;
      const dy = (1 - star.y) / 2 * bounds.height - py;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) { bestDistance = distance; best = index; }
    }
    return best < 0 ? null : graph.nodes[best] ?? null;
  };
  let downAt: { x: number; y: number } | null = null;
  let hoverTimer = 0;
  const onPointerDown = (event: PointerEvent) => { downAt = { x: event.clientX, y: event.clientY }; };
  const onPointerUp = (event: PointerEvent) => {
    // A click (not the end of an orbit drag) opens the star under the pointer.
    if (downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) < 5) {
      const node = pick(event);
      if (node) callbacks.onSelect(node.id);
    }
    downAt = null;
  };
  const onPointerMove = (event: PointerEvent) => {
    if (hoverTimer) return;
    hoverTimer = window.setTimeout(() => { hoverTimer = 0; }, 60);
    const node = pick(event);
    const bounds = renderer.domElement.getBoundingClientRect();
    renderer.domElement.style.cursor = node ? 'pointer' : 'grab';
    callbacks.onHover(node ? { id: node.id, x: event.clientX - bounds.left, y: event.clientY - bounds.top } : null);
  };
  const onLeave = () => callbacks.onHover(null);
  const onControlStart = () => { following = false; wake(); };
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerleave', onLeave);
  controls.addEventListener('start', onControlStart);
  controls.addEventListener('change', wake);
  const onVisibility = () => { if (!document.hidden) wake(); };
  document.addEventListener('visibilitychange', onVisibility);
  wake();

  const flyToView = (to: THREE.Vector3, centre: THREE.Vector3) => {
    following = false;
    if (reducedMotion) {
      camera.position.copy(to);
      controls.target.copy(centre);
      controls.update();
      render();
      return;
    }
    flight = { from: camera.position.clone(), to, fromTarget: controls.target.clone(), toTarget: centre, start: performance.now(), duration: 950 };
    wake();
  };
  const flyTo = (ids: string[]) => {
    const indices = ids.flatMap((id) => indexOf.get(id) ?? []);
    if (!indices.length) return;
    const box = new THREE.Box3();
    for (const index of indices) box.expandByPoint(new THREE.Vector3().fromArray(layout.positions, index * 3));
    const centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(spread * 0.4, box.getSize(new THREE.Vector3()).length() * 0.65);
    const direction = camera.position.clone().sub(controls.target).normalize();
    flyToView(centre.clone().add(direction.multiplyScalar(radius / Math.tan((camera.fov * Math.PI) / 360) * 1.5)), centre);
  };

  let hiddenFolders = new Set<string>();
  const applyEmphasis = () => {
    graph.nodes.forEach((node, index) => { shown[index] = hiddenFolders.has(node.folder) ? 0 : 1; });
    shownAttribute.needsUpdate = true;
    const keep = new Set([...highlighted, ...(selected ? [selected] : [])]);
    lit.fill(0);
    for (const id of keep) { const index = indexOf.get(id); if (index !== undefined) lit[index] = 1; }
    litAttribute.needsUpdate = true;
    pointMaterial.uniforms.dimOthers!.value = keep.size ? 1 : 0;
    // Links touching a lit star brighten; the rest fade with the dimmed cloud.
    edgePairs.forEach(({ source, target }, edge) => {
      const touches = lit[source] === 1 || lit[target] === 1;
      const hiddenEdge = shown[source] === 0 || shown[target] === 0;
      const factor = hiddenEdge ? 0 : !keep.size ? 1 : touches ? 2.4 : 0.25;
      edgeFactor[edge] = factor;
      paintEdge(edge, 0);
    });
    sparks.length = 0;
    clearFlares();
    flareAttribute.needsUpdate = true;
    lineColourAttribute.needsUpdate = true;
    wake();
    if (reducedMotion) render();
  };

  return {
    highlight(ids: string[], focus = true) {
      highlighted = ids.filter((id) => indexOf.has(id));
      applyEmphasis();
      if (focus && highlighted.length) flyTo(highlighted);
    },
    select(id: string | null) {
      selected = id && indexOf.has(id) ? id : null;
      applyEmphasis();
      if (selected) flyTo([selected]);
    },
    showFolders(folders: readonly string[] | null) {
      hiddenFolders = new Set(folders ? graph.nodes.map((node) => node.folder).filter((folder) => !folders.includes(folder)) : []);
      applyEmphasis();
      const visible = graph.nodes.filter((node) => !hiddenFolders.has(node.folder)).map((node) => node.id);
      if (folders && visible.length) flyTo(visible);
    },
    resetView() {
      highlighted = [];
      selected = null;
      applyEmphasis();
      const fit = measureFit();
      if (fit) flyToView(fit.to, fit.centre);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(hoverTimer);
      resizeObserver?.disconnect();
      intersection?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      controls.dispose();
      pointGeometry.dispose();
      pointMaterial.dispose();
      lineGeometry.dispose();
      (lines.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}

export type KnowledgeScene = ReturnType<typeof createKnowledgeScene>;
