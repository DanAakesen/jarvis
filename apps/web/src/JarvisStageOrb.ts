import * as THREE from 'three';
import { getLatticeModel, latticeDetailForSize, makeLatticeScene } from './jarvis-lattice';
import { latticeRadiusFraction, paintLattice } from './jarvis-lattice-painter';
import { orbAppearance } from './jarvis-orb-appearance';
import type { OrbFrame } from './jarvis-orb-motion';
import { resolveJarvisOrbTextureSize } from './jarvis-stage-quality';

/** Radius of the glass sphere in the orb's own units; the stage scales the rig so this matches the dock radius. */
export const stageOrbRadius = 1.12;

// The lattice is repainted at most this often; the room around it still renders at its own pace.
const paintInterval = 1 / 30;

/**
 * The Jarvis orb on the stage: the procedural cognitive lattice drawn by the shared Canvas 2D painter onto a
 * camera-facing plane. The glass never turns; only the network inside it moves. `uniforms.uColor` carries the theme
 * colour that tints the stage lights and particles.
 */
export function createJarvisStageOrb() {
  const orb = new THREE.Group();
  const uniforms = {
    uColor: { value: new THREE.Color(orbAppearance.cool) },
  };
  const model = getLatticeModel();
  const material = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: null as THREE.Texture | null } },
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    // The canvas already holds display-space, premultiplied colour, so it is written through untouched.
    fragmentShader: 'uniform sampler2D uMap;varying vec2 vUv;void main(){gl_FragColor=texture2D(uMap,vUv);}',
  });
  const side = 2 * stageOrbRadius / latticeRadiusFraction;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(side, side), material);
  plane.renderOrder = 3;
  plane.visible = false;
  orb.add(plane);

  let canvas: HTMLCanvasElement | null = null;
  let context: CanvasRenderingContext2D | null = null;
  let texture: THREE.CanvasTexture | null = null;
  let diameter = 0;
  let paintedAt = -Infinity;
  let detail = latticeDetailForSize(0);

  /** Sizes the texture for the orb's on-screen radius in drawing-buffer pixels. */
  function setResolution(pixelRadius: number, maxTextureSize: number) {
    const next = resolveJarvisOrbTextureSize(pixelRadius, maxTextureSize);
    detail = latticeDetailForSize(pixelRadius * 2);
    if (next === diameter) return;
    texture?.dispose();
    texture = null;
    canvas ??= document.createElement('canvas');
    canvas.width = next;
    canvas.height = next;
    context = canvas.getContext('2d');
    diameter = next;
    paintedAt = -Infinity;
    if (!context) {
      plane.visible = false;
      return;
    }
    texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.premultiplyAlpha = true;
    material.uniforms['uMap']!.value = texture;
  }

  function update(frame: OrbFrame) {
    if (!context || !texture) return;
    const moving = frame.time > paintedAt;
    if (moving && frame.time - paintedAt < paintInterval - 0.001) return;
    paintedAt = frame.time;
    paintLattice(context, makeLatticeScene(model, frame, detail), frame, { size: diameter });
    texture.needsUpdate = true;
    plane.visible = true;
  }

  function dispose() {
    texture?.dispose();
    texture = null;
  }

  return { orb, uniforms, setResolution, update, dispose };
}
