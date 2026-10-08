import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { KnowledgeFolder, KnowledgeGraph } from './knowledge-data';
import { createKnowledgeLayout } from './knowledge-layout';

export interface KnowledgeSceneCallbacks {
  onSelect: (id: string) => void;
  onHover: (hover: { id: string; x: number; y: number } | null) => void;
  /** Screen positions of labelled stars (highlights and the selection), refreshed after each rendered frame. */
  onLabels: (labels: { id: string; x: number; y: number }[]) => void;
}

const frameInterval = 1000 / 30;

function folderColours(element: HTMLElement): Record<KnowledgeFolder, THREE.Color> {
  const styles = getComputedStyle(element);
  const read = (name: string, fallback: string) => new THREE.Color(styles.getPropertyValue(name).trim() || fallback);
  return {
    People: read('--graph-people', '#4aa8ff'),
    Work: read('--graph-work', '#ffb45c'),
    Personal: read('--graph-personal', '#3ddc97'),
    General: read('--graph-general', '#b69cff'),
  };
}

// Idle life on a flat map (Dan, 8 October): each note floats a few pixels on its own slow orbit; links follow.
const driftChunk = `vec2 float_drift(float phase, float time) {
  return vec2(sin(time * (0.35 + phase * 0.25) + phase * 6.2831), cos(time * (0.3 + phase * 0.2) + phase * 9.1));
}`;

const lineVertex = `attribute vec3 lineColour;
attribute float phase;
uniform float time;
uniform float drift;
varying vec3 vColour;
${driftChunk}
void main() {
  vColour = lineColour;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position + vec3(float_drift(phase, time) * drift, 0.0), 1.0);
}`;

const lineFragment = `varying vec3 vColour;
void main() { gl_FragColor = vec4(vColour, 1.0); }`;

const pointVertex = `
attribute float size;
attribute vec3 colour;
attribute float lit;
attribute float shown;
attribute float phase;
uniform float dimOthers;
uniform float pixelRatio;
uniform float time;
uniform float drift;
varying vec3 vColour;
varying float vAlpha;
${driftChunk}
void main() {
  vec4 view = modelViewMatrix * vec4(position + vec3(float_drift(phase, time) * drift, 0.0), 1.0);
  float emphasis = mix(1.0 - dimOthers * 0.82, 1.0, lit);
  // Idle life: every star breathes slowly on its own rhythm.
  float breath = sin(time * (0.6 + phase * 0.5) + phase * 6.2831);
  vColour = colour * mix(1.0, 1.6, lit) * (0.92 + 0.08 * breath);
  vAlpha = emphasis * shown;
  gl_PointSize = shown * size * pixelRatio * (1.0 + lit * 0.7) * (1.0 + 0.05 * breath) * (400.0 / max(1.0, -view.z));
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
 * The knowledge map, drawn flat with WebGL: one draw call for every note, one for every link. At 30 fps its stars breathe
 * and a link now and then lights up; dragging pans and the wheel zooms; it stops drawing when off-screen or hidden, and stays still with reduced motion.
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
    const colour = colours[node.folder];
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
  const phases = new Float32Array(count);
  for (let index = 0; index < count; index += 1) phases[index] = Math.abs(Math.sin(index * 12.9898) * 43758.5453) % 1;
  pointGeometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
  const pointMaterial = new THREE.ShaderMaterial({
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
    uniforms: { dimOthers: { value: 0 }, pixelRatio: { value: pixelRatio }, time: { value: 0 }, drift: { value: reducedMotion ? 0 : spread * 0.012 } },
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
      const colour = colours[graph.nodes[node]!.folder];
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
  // Between interactions the stars breathe and a link now and then lights up and fades.
  const sparks: { edge: number; start: number }[] = [];
  let nextSpark = performance.now() + 1200;
  let onScreen = true;
  const sparkDuration = 1600;
  const paintEdge = (edge: number, boost: number) => {
    const factor = edgeFactor[edge]! * (1 + boost);
    for (let channel = 0; channel < 6; channel += 1) lineColours[edge * 6 + channel] = baseLineColours[edge * 6 + channel]! * factor;
  };
  const stepSparks = (now: number) => {
    if (!edgePairs.length) return;
    if (now >= nextSpark) {
      const edge = Math.floor(Math.random() * edgePairs.length);
      const pair = edgePairs[edge]!;
      if (shown[pair.source] === 1 && shown[pair.target] === 1 && !sparks.some((spark) => spark.edge === edge)) sparks.push({ edge, start: now });
      nextSpark = now + 900 + Math.random() * 1400;
    }
    for (let index = sparks.length - 1; index >= 0; index -= 1) {
      const spark = sparks[index]!;
      const t = (now - spark.start) / sparkDuration;
      if (t >= 1) { paintEdge(spark.edge, 0); sparks.splice(index, 1); continue; }
      paintEdge(spark.edge, Math.sin(Math.PI * t) * (pairSimilar(spark.edge) ? 2.6 : 1.1));
    }
    lineColourAttribute.needsUpdate = true;
  };
  const pairSimilar = (edge: number) => edgePairs[edge]!.similar;
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points = { threshold: spread * 0.025 };
  const pointer = new THREE.Vector2();

  const labelled = () => [...new Set([...highlighted.slice(0, 12), ...(selected ? [selected] : [])])];
  const project = (id: string) => {
    const index = indexOf.get(id);
    if (index === undefined) return null;
    const vector = new THREE.Vector3().fromArray(layout.positions, index * 3).project(camera);
    if (vector.z > 1) return null;
    const bounds = renderer.domElement.getBoundingClientRect();
    return { id, x: (vector.x + 1) / 2 * bounds.width, y: (1 - vector.y) / 2 * bounds.height };
  };

  const render = () => {
    renderer.render(scene, camera);
    callbacks.onLabels(labelled().flatMap((id) => project(id) ?? []));
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
      moving = true;
    }
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

  const pick = (event: PointerEvent) => {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(points).find((candidate) => candidate.index !== undefined && shown[candidate.index] === 1);
    return hit?.index === undefined ? null : graph.nodes[hit.index] ?? null;
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
  const onControlStart = () => { wake(); };
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerleave', onLeave);
  controls.addEventListener('start', onControlStart);
  controls.addEventListener('change', wake);
  const onVisibility = () => { if (!document.hidden) wake(); };
  document.addEventListener('visibilitychange', onVisibility);
  wake();

  const flyTo = (ids: string[]) => {
    const indices = ids.flatMap((id) => indexOf.get(id) ?? []);
    if (!indices.length) return;
    const box = new THREE.Box3();
    for (const index of indices) box.expandByPoint(new THREE.Vector3().fromArray(layout.positions, index * 3));
    const centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(spread * 0.4, box.getSize(new THREE.Vector3()).length() * 0.65);
    const direction = camera.position.clone().sub(controls.target).normalize();
    const to = centre.clone().add(direction.multiplyScalar(radius / Math.tan((camera.fov * Math.PI) / 360) * 1.5));
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
      flyTo(graph.nodes.map((node) => node.id));
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
