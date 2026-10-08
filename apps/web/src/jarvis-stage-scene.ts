import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { ThemeMode } from './theme-preference-context';
import { createJarvisStageOrb } from './JarvisStageOrb';
import { createOrbMotion } from './jarvis-orb-motion';
import type { JarvisOrbState } from './voice-presentation';
import type { VoiceSignals } from './voice-stage-context';
import {
  nextJarvisStageQualityLevel,
  resolveJarvisStageQuality,
  type JarvisStageQualityLevel,
} from './jarvis-stage-quality';

export type JarvisStageOptions = {
  theme: ThemeMode;
  reducedMotion: boolean;
  voiceActive: boolean;
  hasWindows: boolean;
  /** Real voice or chat state driving the orb's distinct behaviour. */
  orbState: JarvisOrbState;
};

export type JarvisStageScene = ReturnType<typeof createJarvisStageScene>;

type ThemePalette = {
  background: string;
  floor: string;
  wall: string;
  inset: string;
  metal: string;
  seam: string;
  amber: string;
  /** The bright amber glow shared with the chat orb's brain (--glass-glow-warm). */
  warm: string;
  hemisphere: string;
  ground: string;
  key: string;
  rim: string;
  orb: string;
  reflector: number;
  exposure: number;
  glow: number;
};

type ThemeColor = Exclude<keyof ThemePalette, 'reflector' | 'exposure' | 'glow' | 'warm'>;

function readStagePalette(): ThemePalette {
  const style = window.getComputedStyle(document.documentElement);
  const colorContext = document.createElement('canvas').getContext('2d');
  const color = (role: ThemeColor | 'reflector') => {
    const value = style.getPropertyValue(`--stage-${role}`).trim();
    if (!colorContext || !CSS.supports('color', value)) return value;
    colorContext.fillStyle = '#000000';
    colorContext.fillStyle = value;
    const resolved = colorContext.fillStyle;
    const channels = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+)?\)$/i.exec(resolved);
    if (!channels) return resolved;
    return `#${channels.slice(1, 4).map((channel) => Math.round(Number(channel) * 255)
      .toString(16).padStart(2, '0')).join('')}`;
  };
  const number = (role: 'exposure' | 'glow', fallback: number) => {
    const value = Number.parseFloat(style.getPropertyValue(`--stage-${role}`));
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    background: color('background'),
    floor: color('floor'),
    wall: color('wall'),
    inset: color('inset'),
    metal: color('metal'),
    seam: color('seam'),
    amber: color('amber'),
    warm: style.getPropertyValue('--glass-glow-warm').trim() || '#ffb45c',
    hemisphere: color('hemisphere'),
    ground: color('ground'),
    key: color('key'),
    rim: color('rim'),
    orb: color('orb'),
    reflector: new THREE.Color(color('reflector')).getHex(),
    exposure: number('exposure', 1),
    glow: number('glow', 1),
  };
}

export function createJarvisStageScene(
  host: HTMLElement,
  onContextLost: () => void,
  initialOptions: JarvisStageOptions = {
    theme: 'dark',
    reducedMotion: false,
    voiceActive: false,
    hasWindows: false,
    orbState: 'idle',
  },
  onContextRestored: () => void = () => {},
) {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
  const lifecycle = { removeListeners: () => {} };
  try {
    return createJarvisStageSceneWithRenderer(host, onContextLost, initialOptions, renderer, lifecycle, onContextRestored);
  } catch (error) {
    lifecycle.removeListeners();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    throw error;
  }
}

const ambientFrameInterval = 1000 / 30;

function createJarvisStageSceneWithRenderer(
  host: HTMLElement,
  onContextLost: () => void,
  initialOptions: JarvisStageOptions,
  renderer: THREE.WebGLRenderer,
  lifecycle: { removeListeners: () => void },
  onContextRestored: () => void,
) {
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(43, window.innerWidth / window.innerHeight, 0.1, 80);
  camera.position.set(0, 4.5, 19);
  camera.lookAt(0, 3, 0);
  const anchor = new THREE.Group();
  scene.add(anchor);

  let disposed = false;
  let contextLost = false;
  let animationFrame = 0;
  let animating = false;
  let elapsed = 0;
  let previous = performance.now();
  let current = initialOptions;
  let qualityLevel: JarvisStageQualityLevel = renderer.capabilities.maxTextureSize < 4096 ? 1 : 0;
  let qualityFrameCount = 0;
  let qualityFrameTime = 0;
  let qualityWindowStarted = performance.now();
  let smoothQualityWindows = 0;
  let signals: VoiceSignals | null = null;
  const motion = createOrbMotion();
  const orbGeometry = { x: '', y: '', radius: '' };

  let palette = readStagePalette();
  const themeMaterials: { material: THREE.MeshStandardMaterial; role: ThemeColor }[] = [];
  const standard = (
    role: ThemeColor,
    options: Partial<Pick<THREE.MeshStandardMaterialParameters, 'metalness' | 'roughness' | 'side' | 'emissive'>> = {},
  ) => {
    const material = new THREE.MeshStandardMaterial({ color: palette[role], ...options });
    themeMaterials.push({ material, role });
    return material;
  };
  const glow = new THREE.MeshBasicMaterial({ color: '#8bdce8', transparent: true, opacity: 0.52 });
  const cyan = new THREE.MeshBasicMaterial({ color: '#74e5ef', transparent: true, opacity: 0.88 });
  const warm = new THREE.MeshBasicMaterial({ color: palette.warm, transparent: true, opacity: 0.85 });
  // Thin amber lines are flat and unlit, so they stay crisp instead of blooming.
  const warmLine = new THREE.MeshBasicMaterial({ color: palette.warm });
  const metal = standard('metal', { metalness: 0.88, roughness: 0.24 });
  const darkMetal = standard('wall', {
    metalness: 0.62, roughness: 0.42, side: THREE.DoubleSide,
  });
  const inset = standard('inset', {
    metalness: 0.76, roughness: 0.3, side: THREE.DoubleSide,
  });
  const seam = standard('seam', {
    metalness: 0.78, roughness: 0.22, emissive: palette.seam,
  });

  const hemisphere = new THREE.HemisphereLight(palette.hemisphere, palette.ground, 0.56);
  scene.add(hemisphere);
  const key = new THREE.DirectionalLight(palette.key, 1.1);
  key.position.set(-4, 8, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(palette.rim, 0.55);
  rim.position.set(6, 2, -5);
  scene.add(rim);

  const floorMaterial = standard('floor', { metalness: 0.8, roughness: 0.31 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.3;
  scene.add(floor);
  const reflection = new Reflector(new THREE.PlaneGeometry(90, 90), {
    color: palette.reflector,
    textureWidth: 768,
    textureHeight: 768,
    multisample: 0,
  });
  const reflectionMaterial = reflection.material as THREE.ShaderMaterial;
  reflection.rotation.x = -Math.PI / 2;
  reflection.position.y = -0.299;
  scene.add(reflection);

  const platform = new THREE.Group();
  anchor.add(platform);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 3, 0.12, 96), darkMetal);
  deck.position.y = -0.14;
  platform.add(deck);
  function horizontalRing(parent: THREE.Object3D, radius: number, tube: number, material: THREE.Material, y = 0) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 128), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    parent.add(mesh);
    return mesh;
  }
  horizontalRing(platform, 2.95, 0.042, metal, -0.03);
  horizontalRing(platform, 2.72, 0.014, glow, 0.01);
  horizontalRing(platform, 2.55, 0.026, metal, 0.005);
  horizontalRing(platform, 2.47, 0.021, cyan, 0.02);
  horizontalRing(platform, 1.83, 0.01, glow, 0.015);
  horizontalRing(platform, 3.65, 0.013, glow, -0.22);
  horizontalRing(platform, 4.08, 0.052, metal, -0.25);
  horizontalRing(platform, 4.3, 0.012, glow, -0.27);
  const packets: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = [];
  for (let index = 0; index < 6; index += 1) {
    const packet = new THREE.Mesh(new THREE.SphereGeometry(0.021, 8, 6),
      new THREE.MeshBasicMaterial({ color: index % 3 === 0 ? palette.warm : '#b8f5ff' }));
    platform.add(packet);
    packets.push(packet);
  }

  const segments = new THREE.InstancedMesh(new THREE.BoxGeometry(0.022, 0.008, 0.15), metal, 64);
  const segmentTransform = new THREE.Object3D();
  for (let index = 0; index < 64; index += 1) {
    const angle = index / 64 * Math.PI * 2;
    segmentTransform.position.set(Math.sin(angle) * 2.66, 0.04, Math.cos(angle) * 2.66);
    segmentTransform.rotation.y = angle;
    segmentTransform.scale.z = index % 4 === 0 ? 1 : 0.4;
    segmentTransform.updateMatrix();
    segments.setMatrixAt(index, segmentTransform.matrix);
  }
  platform.add(segments);

  const architecture = new THREE.Group();
  anchor.add(architecture);
  const chamber = new THREE.Group();
  anchor.add(chamber);
  const panelCount = 12;
  const start = Math.PI * 0.38;
  const span = Math.PI * 1.24;
  for (let index = 0; index < panelCount; index += 1) {
    const angle = start + index * span / panelCount;
    const width = span / panelCount;
    const panel = new THREE.Mesh(
      new THREE.CylinderGeometry(15, 15, 16, 4, 1, true, angle, width * 0.98),
      index % 3 === 1 ? inset : darkMetal,
    );
    panel.position.y = 7.7;
    chamber.add(panel);
    const edge = angle + width;
    const rib = new THREE.Mesh(new RoundedBoxGeometry(0.1, 15.6, 0.18, 2, 0.025), metal);
    rib.position.set(Math.sin(edge) * 14.84, 7.5, Math.cos(edge) * 14.84);
    rib.rotation.y = edge;
    if (Math.abs(Math.sin(edge)) > 0.12) chamber.add(rib);
    for (const [y, material] of [[3.2, metal], [8.2, metal], [0.28, seam]] as const) {
      const trim = new THREE.Mesh(new THREE.CylinderGeometry(14.82, 14.82, 0.035, 4, 1, true, angle + 0.02, width - 0.04), material);
      trim.material.side = THREE.DoubleSide;
      trim.position.y = y;
      if (Math.abs(Math.sin(angle + width * 0.5)) > 0.42 || y < 1) chamber.add(trim);
    }
    if (index % 2 === 0) {
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.035, 2.3, 0.02), glow);
      slit.position.set(Math.sin(edge) * 14.7, 7, Math.cos(edge) * 14.7);
      slit.rotation.y = edge;
      chamber.add(slit);
    }
  }
  for (const side of [-1, 1]) {
    for (let index = 0; index < 3; index += 1) {
      const beam = new THREE.Mesh(new RoundedBoxGeometry(0.48 - index * 0.05, 12, 0.66, 3, 0.065), metal);
      beam.position.set(side * (8.6 + index * 0.5), 5.65, 2 - index * 5.7);
      beam.rotation.z = -side * 0.16;
      chamber.add(beam);
      const recess = new THREE.Mesh(new THREE.BoxGeometry(0.19, 11.95, 0.035), darkMetal);
      recess.position.copy(beam.position);
      recess.position.z += 0.35;
      recess.rotation.copy(beam.rotation);
      chamber.add(recess);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.022, 9.4, 0.03), glow);
      strip.position.copy(beam.position);
      strip.position.x += side * 0.14;
      strip.position.z += 0.355;
      strip.rotation.copy(beam.rotation);
      chamber.add(strip);
      const amberSlit = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.85, 0.014), warm);
      amberSlit.position.copy(beam.position);
      amberSlit.position.y = 1;
      amberSlit.position.z += 0.36;
      amberSlit.rotation.copy(beam.rotation);
      chamber.add(amberSlit);
    }
  }
  const farRail = new THREE.Mesh(new THREE.TorusGeometry(6.6, 0.013, 6, 200), metal);
  farRail.rotation.x = -Math.PI / 2;
  farRail.position.y = -0.25;
  chamber.add(farRail);

  const mechanisms: { moving: THREE.Group; speed: number; phase: number }[] = [];
  const ringData = [{ radius: 3.6, depth: 0, speed: 0.085 }, { radius: 5.2, depth: -0.45, speed: -0.056 }, { radius: 6.8, depth: -0.9, speed: 0.034 }];
  for (let index = 0; index < ringData.length; index += 1) {
    const { radius, depth, speed } = ringData[index]!;
    const pivot = new THREE.Group();
    pivot.position.z = depth;
    architecture.add(pivot);
    const rail = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.055, 10, 192), metal);
    pivot.add(rail);
    const moving = new THREE.Group();
    pivot.add(moving);
    for (let section = 0; section < 4; section += 1) {
      const tube = 0.115 + index * 0.022;
      const arc = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 12, 44, Math.PI * 0.34), metal);
      arc.rotation.z = section * Math.PI / 2 + 0.12;
      moving.add(arc);
      // The accent section carries a fine, crisp amber inlay on its face instead of a thick orange band (Dan, 7 October).
      if (section === index) {
        const inlay = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.009, 4, 88, Math.PI * 0.34), warmLine);
        inlay.position.z = tube + 0.004;
        arc.add(inlay);
      }
      const tracer = new THREE.Mesh(new THREE.TorusGeometry(radius - 0.16, 0.011, 6, 44, Math.PI * 0.3), glow);
      tracer.rotation.z = section * Math.PI / 2 + 0.16;
      tracer.position.z = 0.1;
      moving.add(tracer);
    }
    const teeth = new THREE.InstancedMesh(new THREE.BoxGeometry(0.025, 0.11, 0.055), metal, 40);
    const tooth = new THREE.Object3D();
    for (let index = 0; index < 40; index += 1) {
      const angle = index / 40 * Math.PI * 2;
      tooth.position.set(Math.cos(angle) * (radius + 0.18), Math.sin(angle) * (radius + 0.18), 0);
      tooth.rotation.z = angle - Math.PI / 2;
      tooth.scale.y = index % 5 === 0 ? 1 : 0.55;
      tooth.updateMatrix();
      teeth.setMatrixAt(index, tooth.matrix);
    }
    moving.add(teeth);
    mechanisms.push({ moving, speed, phase: index * Math.PI * 0.18 });
  }

  const floorBand = new THREE.Group();
  platform.add(floorBand);
  for (let index = 0; index < 8; index += 1) {
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(3.34, 0.011, 5, 32, Math.PI * 0.13),
      index % 4 === 0 ? warmLine : seam,
    );
    arc.rotation.set(-Math.PI / 2, 0, index * Math.PI / 4);
    arc.position.y = -0.15;
    floorBand.add(arc);
  }

  const particleCount = 260;
  const positions = new Float32Array(particleCount * 3);
  const seeds = new Float32Array(particleCount);
  let randomSeed = 29;
  const random = () => {
    randomSeed = randomSeed * 16807 % 2147483647;
    return randomSeed / 2147483647;
  };
  for (let index = 0; index < particleCount; index += 1) {
    positions[index * 3] = (random() - 0.5) * 24;
    positions[index * 3 + 1] = random() * 12 - 0.1;
    positions[index * 3 + 2] = -22 + random() * 25;
    seeds[index] = random();
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  particleGeometry.setDrawRange(0, particleCount);
  const particleUniforms = {
    uTime: { value: 0 },
    uOrb: { value: new THREE.Vector3() },
    uColor: { value: new THREE.Color(palette.orb) },
    uPower: { value: 0.3 },
  };
  const particles = new THREE.Points(particleGeometry, new THREE.ShaderMaterial({
    uniforms: particleUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aSeed;uniform float uTime;uniform vec3 uOrb;uniform float uPower;
      varying float vLight;varying float vSeed;
      void main(){vec3 p=position;float t=uTime*.19+aSeed*6.283;
      p.x+=sin(t+p.z*.2)*.35;p.y+=sin(t*.8+aSeed*12.)*.4;p.z+=sin(t*.5)*.8;
      vec4 world=modelMatrix*vec4(p,1.);float d=distance(world.xyz,uOrb);
      vLight=.13+uPower*exp(-d*.22)*.7;vSeed=aSeed;
      vec4 view=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*view;
      gl_PointSize=clamp(34./max(1.,-view.z),1.,4.);}`,
    fragmentShader: `uniform vec3 uColor;varying float vLight;varying float vSeed;
      void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;
      float a=pow(1.-d,2.)*vLight;vec3 tint=mix(uColor,vec3(.85,.63,.32),step(.94,vSeed));
      gl_FragColor=vec4(tint*1.6,a);}`,
  }));
  scene.add(particles);

  const orbVisual = createJarvisStageOrb();
  const orbRig = new THREE.Group();
  orbRig.add(orbVisual.orb);
  scene.add(orbRig);
  const orbLight = new THREE.PointLight(palette.orb, 100, 26, 2);
  scene.add(orbLight);
  const amberLight = new THREE.PointLight(palette.warm, 4, 10, 2);
  orbVisual.uniforms.uWarm.value.set(palette.warm);
  scene.add(amberLight);
  const wallLight = new THREE.SpotLight(palette.orb, 100, 45, 0.83, 0.85, 2);
  scene.add(wallLight, wallLight.target);

  const cameraRay = new THREE.Vector3();
  const orbWorld = new THREE.Vector3();
  const themeColors = { current: new THREE.Color(), orb: new THREE.Color() };

  function setTheme() {
    palette = readStagePalette();
    scene.fog = new THREE.FogExp2(palette.background, current.theme === 'dark' ? 0.015 : 0.012);
    renderer.toneMappingExposure = palette.exposure;
    hemisphere.color.set(palette.hemisphere);
    hemisphere.groundColor.set(palette.ground);
    key.color.set(palette.key);
    rim.color.set(palette.rim);
    for (const { material, role } of themeMaterials) {
      material.color.set(palette[role]);
    }
    reflectionMaterial.uniforms['color']?.value.set(palette.reflector);
    seam.emissive.set(palette.seam);
    themeColors.orb.set(palette.orb);
    warm.color.set(palette.warm);
    warmLine.color.set(palette.warm);
    amberLight.color.set(palette.warm);
    orbVisual.uniforms.uWarm.value.set(palette.warm);
  }

  function resize(redraw = true) {
    const bounds = host.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width || window.innerWidth));
    const height = Math.max(1, Math.round(bounds.height || window.innerHeight));
    camera.aspect = width / height;
    camera.position.set(0, 4.5, 19);
    camera.lookAt(0, 3, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const quality = resolveJarvisStageQuality(
      width,
      height,
      window.devicePixelRatio || 1,
      renderer.capabilities.maxTextureSize,
      qualityLevel,
    );
    renderer.setPixelRatio(quality.pixelRatio);
    renderer.setSize(width, height, false);
    particleGeometry.setDrawRange(0, Math.floor(particleCount * quality.particleScale));
    const target = reflection.getRenderTarget();
    if (target.width !== quality.reflectionSize || target.height !== quality.reflectionSize) {
      target.setSize(quality.reflectionSize, quality.reflectionSize);
    }
    if (redraw && !disposed && !contextLost && !document.hidden) draw(0);
  }

  function draw(delta: number) {
    if (contextLost) return;
    const bounds = host.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width || window.innerWidth));
    const height = Math.max(1, Math.round(bounds.height || window.innerHeight));
    const mobile = width <= 700 ||
      (height <= 500 && (window.matchMedia?.('(pointer: coarse)').matches ?? false));
    camera.aspect = width / height;
    camera.position.set(0, 4.5, 19);
    camera.lookAt(0, 3, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    anchor.scale.setScalar(mobile ? 0.7 : 1);
    anchor.updateMatrixWorld(true);
    cameraRay.set(0, 1 - 0.46 * 2, 0.5).unproject(camera).sub(camera.position).normalize();
    const rearWorld = camera.position.clone().addScaledVector(cameraRay, (-5 - camera.position.z) / cameraRay.z);
    architecture.position.copy(anchor.worldToLocal(rearWorld));
    architecture.quaternion.copy(camera.quaternion);

    // The orb stays where it is on every screen (Dan, 8 October): windows and controls move around it, never the orb.
    const screenX = 0.5;
    const screenY = 0.46;
    const pixelRadius = mobile
      ? Math.min(width * 0.28, height * 0.16)
      : Math.min(width * 0.18, height * 0.18);
    cameraRay.set(screenX * 2 - 1, 1 - screenY * 2, 0.5).unproject(camera).sub(camera.position).normalize();
    orbWorld.copy(camera.position).addScaledVector(cameraRay, -camera.position.z / cameraRay.z);
    orbRig.position.copy(orbWorld);
    publishOrbGeometry(screenX * width, screenY * height, pixelRadius);

    const awakeTarget = current.voiceActive ? 1 : current.orbState !== 'idle' ? 0.72 : 0;
    const readLevel = (read: (() => number) | undefined) => {
      const level = read ? read() : 0;
      return Number.isFinite(level) ? THREE.MathUtils.clamp(level, 0, 1) : 0;
    };
    const live = motion.step(delta, {
      awake: awakeTarget,
      state: current.orbState,
      playback: readLevel(signals ? () => signals!.playbackLevel() : undefined),
      input: readLevel(signals ? () => signals!.inputLevel() : undefined),
      reducedMotion: current.reducedMotion,
    });
    const time = current.reducedMotion ? 0 : elapsed;
    const breath = current.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 1.7);
    const speechLight = live.speak * live.speech;
    const cameraDepth = orbWorld.clone().applyMatrix4(camera.matrixWorldInverse).z;
    const scale = pixelRadius * (-cameraDepth) * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) /
      height / 1.12;
    // The surge expands then settles; listening breathes and speech swells the shell slightly.
    const pulse = 1 + (1 - live.awake) * (breath - 0.5) * 0.012 + live.surge * 0.085 + live.listen * (breath - 0.5) * 0.022 + speechLight * 0.04 -
      live.think * 0.012;
    orbRig.scale.setScalar(scale * pulse);
    orbLight.position.copy(orbWorld);
    amberLight.position.copy(orbWorld);
    wallLight.position.copy(orbWorld);
    wallLight.target.position.set(orbWorld.x * 0.72, orbWorld.y * 0.8 + 0.7, -14.5);

    const toolFlicker = current.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 9.5);
    const power = (0.34 + (1 - live.awake) * 0.04 * breath + 0.58 * live.awake + live.surge * 0.75 + live.waveStrength * 0.18 +
      live.listen * (0.04 + 0.06 * breath + live.input * 0.12) + live.think * 0.03 +
      live.tool * (0.06 + 0.08 * toolFlicker) + live.speak * 0.08 + speechLight * 0.55) * palette.glow;
    themeColors.current.copy(themeColors.orb);
    orbVisual.uniforms.uColor.value.lerp(themeColors.current, current.reducedMotion ? 1 : 0.16);
    orbVisual.update(time, live);
    orbLight.color.copy(orbVisual.uniforms.uColor.value);
    orbLight.intensity = 100 * power;
    amberLight.intensity = 5 + (1 - live.awake) * 1.5 * breath + 14 * live.ignite + 14 * live.surge + 7 * live.think + 16 * speechLight;
    wallLight.color.copy(orbVisual.uniforms.uColor.value);
    wallLight.intensity = 100 * power;
    particleUniforms.uTime.value = time;
    particleUniforms.uOrb.value.copy(orbWorld);
    particleUniforms.uColor.value.copy(orbVisual.uniforms.uColor.value);
    particleUniforms.uPower.value = power;
    for (const { moving, speed, phase } of mechanisms) moving.rotation.z = elapsed * speed + phase;
    floorBand.rotation.y = -elapsed * 0.065;
    packets.forEach((packet, index) => {
      const angle = elapsed * (index % 2 === 0 ? 0.13 : -0.1) + index * Math.PI / 3;
      packet.position.set(Math.cos(angle) * 3.35, -0.12, Math.sin(angle) * 3.35);
    });
    seam.emissiveIntensity = 0.13 + power * 0.16;
    wallLight.target.updateMatrixWorld();
    renderer.render(scene, camera);
  }

  function publishOrbGeometry(x: number, y: number, radius: number) {
    const page = host.parentElement;
    if (!page) return;
    const next = { x: `${Math.round(x)}px`, y: `${Math.round(y)}px`, radius: `${Math.round(radius)}px` };
    for (const key of ['x', 'y', 'radius'] as const) {
      if (orbGeometry[key] === next[key]) continue;
      orbGeometry[key] = next[key];
      page.style.setProperty(`--jarvis-orb-${key}`, next[key]);
    }
  }

  function startAnimation() {
    if (disposed || contextLost || animating || current.reducedMotion || document.hidden) return;
    animating = true;
    previous = performance.now();
    qualityWindowStarted = previous;
    qualityFrameCount = 0;
    qualityFrameTime = 0;
    animationFrame = window.requestAnimationFrame(frame);
  }

  function stopAnimation() {
    if (!animating) return;
    animating = false;
    window.cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }

  function frame(now: number) {
    if (disposed || !animating) return;
    if (document.hidden || current.reducedMotion || contextLost) {
      stopAnimation();
      if (!contextLost && !document.hidden) draw(0);
      return;
    }
    const frameInterval = Math.max(0, now - previous);
    // The room is ambient: 30 fps keeps it smooth at half the cost. Voice gets the full display rate.
    const targetInterval = current.voiceActive ? 0 : ambientFrameInterval;
    if (frameInterval < targetInterval - 4) {
      animationFrame = window.requestAnimationFrame(frame);
      return;
    }
    const delta = Math.max(0, Math.min(frameInterval / 1000, 0.12));
    previous = now;
    elapsed += delta;
    draw(delta);
    qualityFrameCount += 1;
    // Quality adapts to lateness against the frame budget, so the deliberate 30 fps cap never lowers quality.
    qualityFrameTime += Math.min(Math.max(0, frameInterval - Math.max(0, targetInterval - 1000 / 60)), 1000);
    if (now - qualityWindowStarted >= 1000 && qualityFrameCount > 0) {
      const nextQuality = nextJarvisStageQualityLevel(qualityLevel, qualityFrameTime / qualityFrameCount);
      if (nextQuality > qualityLevel) {
        qualityLevel = nextQuality;
        smoothQualityWindows = 0;
        resize(false);
      } else if (nextQuality < qualityLevel) {
        smoothQualityWindows += 1;
        if (smoothQualityWindows >= 3) {
          qualityLevel = nextQuality;
          smoothQualityWindows = 0;
          resize(false);
        }
      } else if (qualityFrameTime / qualityFrameCount >= 17) {
        smoothQualityWindows = 0;
      }
      qualityFrameCount = 0;
      qualityFrameTime = 0;
      qualityWindowStarted = now;
    }
    animationFrame = window.requestAnimationFrame(frame);
  }

  const onResize = () => resize();
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
  const onVisibilityChange = () => {
    if (document.hidden) {
      stopAnimation();
    } else {
      startAnimation();
      if (!animating) draw(0);
    }
  };
  const onWebGlContextLost = (event: Event) => {
    event.preventDefault();
    if (contextLost || disposed) return;
    contextLost = true;
    stopAnimation();
    onContextLost();
  };
  const onWebGlContextRestored = () => {
    if (!contextLost || disposed) return;
    contextLost = false;
    setTheme();
    resize(false);
    if (document.hidden) {
      onContextRestored();
      return;
    }
    if (current.reducedMotion) draw(0);
    else startAnimation();
    onContextRestored();
  };
  lifecycle.removeListeners = () => {
    renderer.domElement.removeEventListener('webglcontextlost', onWebGlContextLost);
    renderer.domElement.removeEventListener('webglcontextrestored', onWebGlContextRestored);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    window.visualViewport?.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    resizeObserver?.disconnect();
  };
  renderer.domElement.addEventListener('webglcontextlost', onWebGlContextLost);
  renderer.domElement.addEventListener('webglcontextrestored', onWebGlContextRestored);
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibilityChange);
  resizeObserver?.observe(host);

  let disposedOnce = false;
  const dispose = () => {
    if (disposedOnce) return;
    disposedOnce = true;
    disposed = true;
    stopAnimation();
    lifecycle.removeListeners();
    scene.traverse((object: THREE.Object3D) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      }
    });
    for (const key of ['x', 'y', 'radius']) host.parentElement?.style.removeProperty(`--jarvis-orb-${key}`);
    reflection.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };

  host.appendChild(renderer.domElement);
  setTheme();
  resize();
  startAnimation();

  return {
    update(options: JarvisStageOptions) {
      if (disposed) return;
      current = options;
      setTheme();
      if (options.reducedMotion) {
        stopAnimation();
        if (!document.hidden) draw(0);
      } else {
        startAnimation();
      }
    },
    /** Live audio levels are pulled once per frame; null resets the speech and input envelopes. */
    setSignals(next: VoiceSignals | null) {
      signals = next;
    },
    dispose,
  };
}
