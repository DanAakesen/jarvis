import { useEffect, useRef } from 'react';
import { useJarvisActivity } from './activity-context';

interface Node { x: number; y: number; z: number }

// The same seeded construction as the stage orb's core, so the small orb carries the same amber heart.
function buildCore() {
  let seed = 71;
  const random = () => {
    seed = seed * 16807 % 2147483647;
    return seed / 2147483647;
  };
  const nodes: Node[] = [];
  for (let index = 0; index < 40; index += 1) {
    const angle = index * 2.39996;
    const y = 1 - 2 * (index + 0.5) / 40;
    const radius = 0.42 + random() * 0.5;
    const ring = Math.sqrt(1 - y * y);
    nodes.push({ x: Math.cos(angle) * ring * radius, y: y * radius * 0.84, z: Math.sin(angle) * ring * radius * 0.85 });
  }
  const links = nodes.map((origin, index) => {
    const neighbours = nodes
      .map((node, neighbourIndex) => ({ neighbourIndex, distance: Math.hypot(origin.x - node.x, origin.y - node.y, origin.z - node.z) }))
      .filter(({ neighbourIndex }) => neighbourIndex !== index)
      .sort((left, right) => left.distance - right.distance);
    return [index, neighbours[index % 3]!.neighbourIndex] as const;
  });
  const sparks = Array.from({ length: 46 }, () => {
    const radius = 0.95 * Math.pow(random(), 0.65);
    const angle = random() * Math.PI * 2;
    const y = random() * 2 - 1;
    const ring = Math.sqrt(1 - y * y);
    return { x: Math.cos(angle) * ring * radius, y: y * radius * 0.82, z: Math.sin(angle) * ring * radius * 0.85, seed: random() };
  });
  return { nodes, links, sparks };
}

const core = buildCore();

/** A living miniature of the stage orb for the composer's voice button. Decorative; the button carries the name. */
export function InputOrbCore() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { working } = useJarvisActivity();
  const workingRef = useRef(working);
  const wake = useRef<() => void>(() => {});
  useEffect(() => {
    workingRef.current = working;
    wake.current();
  }, [working]);

  useEffect(() => {
    const element = canvas.current;
    const context = typeof element?.getContext === 'function' ? element.getContext('2d') : null;
    if (!element || !context) return;
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const reduced = () => (motionQuery?.matches ?? false) || document.documentElement.dataset.motion === 'reduced';
    let frame = 0;
    let last = performance.now();
    let flow = 0;
    let energy = 0;

    const draw = (time: number) => {
      const size = element.clientWidth || 42;
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      if (element.width !== Math.round(size * ratio)) {
        element.width = Math.round(size * ratio);
        element.height = Math.round(size * ratio);
      }
      const styles = getComputedStyle(element);
      const cool = styles.getPropertyValue('--stage-orb').trim() || '#52dcfa';
      const warm = styles.getPropertyValue('--glass-glow-warm').trim() || '#ffb45c';
      const delta = Math.min(0.1, (time - last) / 1000);
      last = time;
      const still = reduced();
      // Hover or keyboard focus wakes the core a little, hinting that the orb can come alive.
      const host = element.closest('.input-orb');
      const awake = Boolean(host && !(host as HTMLButtonElement).disabled && host.matches(':hover, :focus-visible'));
      energy += ((workingRef.current ? 1 : awake ? 0.85 : 0) - energy) * (1 - Math.exp(-delta * (awake ? 6 : 4)));
      if (!still) flow += delta * (0.35 + energy * 1.3);

      const half = size / 2;
      const scale = half * 0.62;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, size, size);

      // Faint rotating meridians on the cyan glass shell.
      context.save();
      context.beginPath();
      context.arc(half, half, half - 1.5, 0, Math.PI * 2);
      context.clip();
      context.strokeStyle = cool;
      context.lineWidth = 0.5;
      for (let index = 0; index < 4; index += 1) {
        const phase = (flow * 0.25 + index / 4) % 1;
        const width = Math.abs(Math.cos(phase * Math.PI)) * (half - 2);
        context.globalAlpha = 0.18 + 0.12 * Math.sin(phase * Math.PI);
        context.beginPath();
        context.ellipse(half, half, Math.max(0.5, width), half - 2, 0, 0, Math.PI * 2);
        context.stroke();
      }
      context.globalAlpha = 0.16;
      context.beginPath();
      context.ellipse(half, half, half - 2, (half - 2) * 0.32, 0, 0, Math.PI * 2);
      context.stroke();
      context.restore();

      // Amber core: filaments and sparks rotating together, brighter while Jarvis works.
      const rotateY = flow * 0.32;
      const tilt = Math.sin(flow * 0.55) * 0.2;
      const project = (node: { x: number; y: number; z: number }, stir: number) => {
        const x = node.x + Math.sin(node.y * 7 + flow) * stir;
        const y = node.y + Math.cos(node.z * 6 - flow * 0.8) * stir;
        const z = node.z + Math.sin(node.x * 6.5 + flow * 0.7) * stir;
        const cosY = Math.cos(rotateY);
        const sinY = Math.sin(rotateY);
        const rx = x * cosY + z * sinY;
        const rz = -x * sinY + z * cosY;
        const ry = y * Math.cos(tilt) - rz * Math.sin(tilt);
        return { x: half + rx * scale, y: half + ry * scale };
      };
      const stir = still ? 0 : 0.04 + 0.05 * energy;
      context.globalCompositeOperation = 'lighter';
      context.lineWidth = 0.6;
      context.strokeStyle = warm;
      for (const [from, to] of core.links) {
        const start = project(core.nodes[from]!, stir);
        const end = project(core.nodes[to]!, stir);
        const pulse = Math.pow(0.5 + 0.5 * Math.sin(from * 0.9 - flow * 2.5), 6);
        context.globalAlpha = 0.32 + 0.3 * energy + pulse * 0.35;
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.quadraticCurveTo((start.x + end.x) / 2 + (half - start.x) * 0.08, (start.y + end.y) / 2 + (half - start.y) * 0.08, end.x, end.y);
        context.stroke();
      }
      context.fillStyle = warm;
      for (const spark of core.sparks) {
        const point = project(spark, stir);
        const twinkle = still ? 0.6 : Math.pow(0.5 + 0.5 * Math.sin(flow * 1.6 + spark.seed * 21), 4);
        context.globalAlpha = (0.25 + 0.75 * twinkle) * (0.55 + 0.45 * energy);
        context.beginPath();
        context.arc(point.x, point.y, 0.35 + twinkle * 0.6, 0, Math.PI * 2);
        context.fill();
      }
      const glow = context.createRadialGradient(half, half, 0, half, half, scale * 0.9);
      glow.addColorStop(0, warm);
      glow.addColorStop(1, 'transparent');
      context.globalAlpha = 0.35 + 0.25 * energy + (still ? 0 : 0.08 * Math.sin(time / 600));
      context.fillStyle = glow;
      context.beginPath();
      context.arc(half, half, scale * 0.9, 0, Math.PI * 2);
      context.fill();
      context.globalCompositeOperation = 'source-over';
      context.globalAlpha = 1;

      if (!still && document.visibilityState !== 'hidden') frame = requestAnimationFrame(draw);
      else frame = 0;
    };
    const resume = () => {
      if (frame || document.visibilityState === 'hidden') return;
      last = performance.now();
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    wake.current = resume;
    motionQuery?.addEventListener?.('change', resume);
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(resume) : null;
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    document.addEventListener('visibilitychange', resume);
    return () => {
      wake.current = () => {};
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', resume);
      motionQuery?.removeEventListener?.('change', resume);
      observer?.disconnect();
    };
  }, []);

  return <canvas ref={canvas} className="input-orb-core" aria-hidden="true" />;
}
