import type { KnowledgeFolder, KnowledgeGraph } from './knowledge-data';

/**
 * A 3D force layout for the knowledge cloud. Each folder gets its own region, linked notes pull together and nearby
 * notes push apart (neighbours only, via a spatial grid, so a step stays roughly linear for 2,000 notes). The caller
 * runs one step per frame, so the cloud visibly settles, and stops once it is still.
 */
const folderCentres: Record<KnowledgeFolder, [number, number, number]> = {
  People: [1, 1, 1], Work: [-1, -1, 1], Personal: [-1, 1, -1], General: [1, -1, -1],
};

export interface KnowledgeLayout {
  /** xyz per node, in graph.nodes order. */
  positions: Float32Array;
  /** Advances the simulation; returns false once it has settled. */
  step: () => boolean;
  /** Runs steps without rendering (used for reduced motion and tests). */
  settle: (maxSteps?: number) => void;
}

const bump = (array: Float32Array, at: number, value: number) => { array[at] = (array[at] ?? 0) + value; };

export function createKnowledgeLayout(graph: KnowledgeGraph, seed = 11): KnowledgeLayout {
  const count = graph.nodes.length;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const index = new Map(graph.nodes.map((node, position) => [node.id, position]));
  const edges = graph.edges.flatMap((edge) => {
    const source = index.get(edge.source);
    const target = index.get(edge.target);
    return source === undefined || target === undefined ? [] : [[source, target, edge.type === 'link' ? 1 : 0.45] as const];
  });
  let state = seed;
  const random = () => { state = (state * 16807) % 2147483647; return state / 2147483647; };
  // The cloud's size grows with the cube root of the number of notes, so density stays similar.
  const spread = 26 * Math.cbrt(Math.max(count, 8) / 400);
  const centres = graph.nodes.map((node) => folderCentres[node.folder].map((value) => value * spread * 0.55));
  for (let node = 0; node < count; node += 1) {
    const centre = centres[node]!;
    const radius = spread * 0.45 * Math.cbrt(random());
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    positions[node * 3] = centre[0]! + radius * Math.sin(phi) * Math.cos(theta);
    positions[node * 3 + 1] = centre[1]! + radius * Math.sin(phi) * Math.sin(theta);
    // A flat map (Dan, 8 October): every note lies on one plane.
    positions[node * 3 + 2] = 0;
  }

  const repelRadius = spread * 0.16;
  const springLength = spread * 0.09;
  let temperature = 1;
  let steps = 0;

  const step = () => {
    if (temperature < 0.02 || steps > 400) return false;
    steps += 1;
    const forces = new Float32Array(count * 3);
    // Repulsion between neighbours found through a coarse grid.
    const cell = repelRadius;
    const grid = new Map<string, number[]>();
    const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
    for (let node = 0; node < count; node += 1) {
      const k = key(Math.floor(positions[node * 3]! / cell), Math.floor(positions[node * 3 + 1]! / cell), Math.floor(positions[node * 3 + 2]! / cell));
      const bucket = grid.get(k);
      if (bucket) bucket.push(node); else grid.set(k, [node]);
    }
    for (let node = 0; node < count; node += 1) {
      const x = positions[node * 3]!, y = positions[node * 3 + 1]!, z = positions[node * 3 + 2]!;
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) {
        for (const other of grid.get(key(cx + dx, cy + dy, cz + dz)) ?? []) {
          if (other <= node) continue;
          const ox = x - positions[other * 3]!, oy = y - positions[other * 3 + 1]!, oz = z - positions[other * 3 + 2]!;
          const distanceSquared = ox * ox + oy * oy + oz * oz + 0.01;
          if (distanceSquared > repelRadius * repelRadius) continue;
          const push = (repelRadius * repelRadius) / distanceSquared * 0.012;
          bump(forces, node * 3, ox * push); bump(forces, node * 3 + 1, oy * push); bump(forces, node * 3 + 2, oz * push);
          bump(forces, other * 3, -ox * push); bump(forces, other * 3 + 1, -oy * push); bump(forces, other * 3 + 2, -oz * push);
        }
      }
    }
    // Springs along links; similarity edges pull more gently.
    for (const [source, target, strength] of edges) {
      const ox = positions[target * 3]! - positions[source * 3]!;
      const oy = positions[target * 3 + 1]! - positions[source * 3 + 1]!;
      const oz = positions[target * 3 + 2]! - positions[source * 3 + 2]!;
      const distance = Math.sqrt(ox * ox + oy * oy + oz * oz) || 0.001;
      const pull = (distance - springLength) / distance * 0.04 * strength;
      bump(forces, source * 3, ox * pull); bump(forces, source * 3 + 1, oy * pull); bump(forces, source * 3 + 2, oz * pull);
      bump(forces, target * 3, -ox * pull); bump(forces, target * 3 + 1, -oy * pull); bump(forces, target * 3 + 2, -oz * pull);
    }
    let movement = 0;
    for (let node = 0; node < count; node += 1) {
      const centre = centres[node]!;
      for (let axis = 0; axis < 3; axis += 1) {
        const at = node * 3 + axis;
        // A gentle pull back to the folder's region keeps the four clusters readable.
        if (axis === 2) continue;
        const home = (centre[axis]! - positions[at]!) * 0.004;
        velocities[at] = (velocities[at]! + forces[at]! + home) * 0.82;
        const capped = Math.max(-spread * 0.05, Math.min(spread * 0.05, velocities[at]! * temperature));
        bump(positions, at, capped);
        movement += Math.abs(capped);
      }
    }
    temperature *= 0.985;
    return movement / Math.max(1, count) > spread * 0.0004;
  };

  return {
    positions,
    step,
    settle: (maxSteps = 260) => { for (let n = 0; n < maxSteps && step(); n += 1) { /* settle without rendering */ } },
  };
}
