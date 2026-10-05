import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { ThemeMode } from './theme-preference-context';
import { createJarvisStageOrb } from './JarvisStageOrb';

export type JarvisStageOptions = {
  theme: ThemeMode;
  reducedMotion: boolean;
  voiceActive: boolean;
  hasWindows: boolean;
};

export type JarvisStageScene = ReturnType<typeof createJarvisStageScene>;

type ThemePalette = {
  background: string;
  floor: string;
  wall: string;
  inset: string;
  metal: string;
  seam: string;
  hemisphere: string;
  ground: string;
  key: string;
  rim: string;
  orb: string;
  reflector: number;
  exposure: number;
};

const palettes: Record<ThemeMode, ThemePalette> = {
  dark: {
    background: '#030b13',
    floor: '#0b1d29',
    wall: '#101f2d',
    inset: '#1c3548',
    metal: '#738d9d',
    seam: '#52c7dc',
    hemisphere: '#a2d6f2',
    ground: '#081522',
    key: '#c2e5ff',
    rim: '#55bace',
    orb: '#52dcfa',
    reflector: 0x526b80,
    exposure: 1,
  },
  light: {
    background: '#e7edef',
    floor: '#b9cbd0',
    wall: '#c8d4d6',
    inset: '#9db4bb',
    metal: '#607c85',
    seam: '#14768d',
    hemisphere: '#f5fbf7',
    ground: '#738c94',
    key: '#fff6e8',
    rim: '#388da0',
    orb: '#14768d',
    reflector: 0xc1d3d7,
    exposure: 1.18,
  },
};

export function createJarvisStageScene(
  host: HTMLElement,
  onContextLost: () => void,
  initialOptions: JarvisStageOptions = {
    theme: 'dark',
    reducedMotion: false,
    voiceActive: false,
    hasWindows: false,
  },
) {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
  const lifecycle = { removeListeners: () => {} };
  try {
    return createJarvisStageSceneWithRenderer(host, onContextLost, initialOptions, renderer, lifecycle);
  } catch (error) {
    lifecycle.removeListeners();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    throw error;
  }
}

function createJarvisStageSceneWithRenderer(
  host: HTMLElement,
  onContextLost: () => void,
  initialOptions: JarvisStageOptions,
  renderer: THREE.WebGLRenderer,
  lifecycle: { removeListeners: () => void },
) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1 : 1.2));
  renderer.setSize(window.innerWidth, window.innerHeight);
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
  let animationFrame = 0;
  let animating = false;
  let elapsed = 0;
  let previous = performance.now();
  let lastFrame = previous - 1000 / 30;
  let current = initialOptions;
  let voicePosition = 0;
  let voiceVelocity = 0;
  let windowPosition = 0;
  let windowVelocity = 0;

  const themeMaterials: { material: THREE.MeshStandardMaterial; dark: string; light: string }[] = [];
  const standard = (
    dark: string,
    light: string,
    options: Partial<Pick<THREE.MeshStandardMaterialParameters, 'metalness' | 'roughness' | 'side' | 'emissive'>> = {},
  ) => {
    const material = new THREE.MeshStandardMaterial({ color: dark, ...options });
    themeMaterials.push({ material, dark, light });
    return material;
  };
  const glow = new THREE.MeshBasicMaterial({ color: '#8bdce8', transparent: true, opacity: 0.52 });
  const cyan = new THREE.MeshBasicMaterial({ color: '#74e5ef', transparent: true, opacity: 0.88 });
  const warm = new THREE.MeshBasicMaterial({ color: '#e6ba79', transparent: true, opacity: 0.46 });
  const metal = standard('#738d9d', '#607c85', { metalness: 0.88, roughness: 0.24 });
  const darkMetal = standard('#101f2d', '#c8d4d6', {
    metalness: 0.62, roughness: 0.42, side: THREE.DoubleSide,
  });
  const inset = standard('#1c3548', '#9db4bb', {
    metalness: 0.76, roughness: 0.3, side: THREE.DoubleSide,
  });
  const seam = standard('#52c7dc', '#14768d', {
    metalness: 0.78, roughness: 0.22, emissive: '#164651',
  });
  const gold = standard('#b18b54', '#a07845', {
    metalness: 0.85, roughness: 0.28, emissive: '#bf7134',
  });

  const hemisphere = new THREE.HemisphereLight('#a2d6f2', '#081522', 0.56);
  scene.add(hemisphere);
  const key = new THREE.DirectionalLight('#c2e5ff', 1.1);
  key.position.set(-4, 8, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#55bace', 0.55);
  rim.position.set(6, 2, -5);
  scene.add(rim);

  const floorMaterial = standard('#0b1d29', '#b9cbd0', { metalness: 0.8, roughness: 0.31 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.3;
  scene.add(floor);
  const reflection = new Reflector(new THREE.PlaneGeometry(90, 90), {
    color: palettes.dark.reflector,
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
      new THREE.MeshBasicMaterial({ color: index % 3 === 0 ? '#d7b77d' : '#b8f5ff' }));
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
      const amberSlit = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.85, 0.032), warm);
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
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.115 + index * 0.022, 12, 44, Math.PI * 0.34),
        section === index ? gold : metal,
      );
      arc.rotation.z = section * Math.PI / 2 + 0.12;
      moving.add(arc);
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
      index % 4 === 0 ? gold : seam,
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
  const particleUniforms = {
    uTime: { value: 0 },
    uOrb: { value: new THREE.Vector3() },
    uColor: { value: new THREE.Color(palettes.dark.orb) },
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
  const orbLight = new THREE.PointLight(palettes.dark.orb, 100, 26, 2);
  scene.add(orbLight);
  const amberLight = new THREE.PointLight('#ff984c', 4, 10, 2);
  scene.add(amberLight);
  const wallLight = new THREE.SpotLight(palettes.dark.orb, 100, 45, 0.83, 0.85, 2);
  scene.add(wallLight, wallLight.target);

  const cameraRay = new THREE.Vector3();
  const orbWorld = new THREE.Vector3();
  const themeColors = { current: new THREE.Color(), orb: new THREE.Color() };

  function setTheme(theme: ThemeMode) {
    const palette = palettes[theme];
    scene.fog = new THREE.FogExp2(palette.background, theme === 'dark' ? 0.015 : 0.012);
    renderer.toneMappingExposure = palette.exposure;
    hemisphere.color.set(palette.hemisphere);
    hemisphere.groundColor.set(palette.ground);
    key.color.set(palette.key);
    rim.color.set(palette.rim);
    for (const { material, dark, light } of themeMaterials) {
      material.color.set(theme === 'dark' ? dark : light);
    }
    reflectionMaterial.uniforms['color']?.value.set(palette.reflector);
    themeColors.orb.set(palette.orb);
  }

  function resize() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    camera.aspect = width / height;
    camera.position.set(0, 4.5, 19);
    camera.lookAt(0, 3, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 700 ? 1 : 1.2));
    renderer.setSize(width, height);
    const reflectionSize = width < 700 ? 512 : 768;
    const target = reflection.getRenderTarget();
    if (target.width !== reflectionSize || target.height !== reflectionSize) target.setSize(reflectionSize, reflectionSize);
    if (!disposed) draw(0);
  }

  function draw(delta: number) {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const mobile = width <= 700;
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

    if (current.reducedMotion) {
      voicePosition = Number(current.voiceActive);
      voiceVelocity = 0;
      windowPosition = Number(current.hasWindows);
      windowVelocity = 0;
    } else {
      const factor = Math.max(0, Math.min(delta, 0.12));
      const steps = Math.max(1, Math.ceil(factor / (1 / 90)));
      const step = factor / steps;
      const targets = [
        { value: () => voicePosition, velocity: () => voiceVelocity, set: (value: number, velocity: number) => { voicePosition = value; voiceVelocity = velocity; }, destination: Number(current.voiceActive), frequency: 6.6 },
        { value: () => windowPosition, velocity: () => windowVelocity, set: (value: number, velocity: number) => { windowPosition = value; windowVelocity = velocity; }, destination: Number(current.hasWindows), frequency: 7.8 },
      ];
      for (let index = 0; index < steps; index += 1) {
        for (const target of targets) {
          const acceleration = (target.frequency ** 2) * (target.destination - target.value()) -
            2 * target.frequency * target.velocity();
          const velocity = target.velocity() + acceleration * step;
          target.set(target.value() + velocity * step, velocity);
        }
      }
    }
    const layout = THREE.MathUtils.clamp(windowPosition, 0, 1);
    const screenX = mobile ? 0.5 : 0.5 - 0.22 * layout;
    const screenY = mobile ? THREE.MathUtils.lerp(0.46, 0.78, layout) : 0.46;
    cameraRay.set(screenX * 2 - 1, 1 - screenY * 2, 0.5).unproject(camera).sub(camera.position).normalize();
    orbWorld.copy(camera.position).addScaledVector(cameraRay, -camera.position.z / cameraRay.z);
    orbRig.position.copy(orbWorld);
    const pixelRadius = mobile
      ? Math.min(width * 0.28, height * 0.16)
      : Math.min(width * 0.18, height * 0.18);
    const cameraDepth = orbWorld.clone().applyMatrix4(camera.matrixWorldInverse).z;
    const scale = pixelRadius * (-cameraDepth) * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) /
      height / 1.12;
    orbRig.scale.setScalar(scale);
    orbLight.position.copy(orbWorld);
    amberLight.position.copy(orbWorld);
    wallLight.position.copy(orbWorld);
    wallLight.target.position.set(orbWorld.x * 0.72, orbWorld.y * 0.8 + 0.7, -14.5);

    const awake = THREE.MathUtils.clamp(voicePosition, 0, 1);
    const power = 0.26 + 0.74 * awake;
    themeColors.current.copy(themeColors.orb);
    orbVisual.uniforms.uColor.value.lerp(themeColors.current, current.reducedMotion ? 1 : 0.16);
    orbVisual.uniforms.uEnergy.value = 0.12 + awake * 0.73;
    orbVisual.update(current.reducedMotion ? 0 : elapsed, awake);
    orbLight.color.copy(orbVisual.uniforms.uColor.value);
    orbLight.intensity = 100 * power;
    amberLight.intensity = 4 + 18 * awake;
    wallLight.color.copy(orbVisual.uniforms.uColor.value);
    wallLight.intensity = 100 * power;
    particleUniforms.uTime.value = current.reducedMotion ? 0 : elapsed;
    particleUniforms.uOrb.value.copy(orbWorld);
    particleUniforms.uColor.value.copy(orbVisual.uniforms.uColor.value);
    particleUniforms.uPower.value = power;
    for (const { moving, speed, phase } of mechanisms) moving.rotation.z = elapsed * speed + phase;
    floorBand.rotation.y = -elapsed * 0.065;
    packets.forEach((packet, index) => {
      const angle = elapsed * (index % 2 === 0 ? 0.13 : -0.1) + index * Math.PI / 3;
      packet.position.set(Math.cos(angle) * 3.35, -0.12, Math.sin(angle) * 3.35);
    });
    seam.emissive.set(palettes[current.theme].seam);
    seam.emissiveIntensity = 0.13 + power * 0.16;
    wallLight.target.updateMatrixWorld();
    renderer.render(scene, camera);
  }

  function startAnimation() {
    if (disposed || animating || current.reducedMotion || document.hidden) return;
    animating = true;
    previous = performance.now();
    lastFrame = previous - 1000 / 30;
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
    if (document.hidden || current.reducedMotion) {
      stopAnimation();
      draw(0);
      return;
    }
    if (now - lastFrame < 1000 / 30) {
      animationFrame = window.requestAnimationFrame(frame);
      return;
    }
    const delta = Math.max(0, Math.min((now - previous) / 1000, 0.12));
    previous = now;
    lastFrame = now;
    elapsed += delta;
    draw(delta);
    animationFrame = window.requestAnimationFrame(frame);
  }

  const onResize = () => resize();
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
    dispose();
    onContextLost();
  };
  lifecycle.removeListeners = () => {
    renderer.domElement.removeEventListener('webglcontextlost', onWebGlContextLost);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
  renderer.domElement.addEventListener('webglcontextlost', onWebGlContextLost);
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibilityChange);

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
    reflection.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };

  host.appendChild(renderer.domElement);
  setTheme(current.theme);
  resize();
  startAnimation();

  return {
    update(options: JarvisStageOptions) {
      if (disposed) return;
      current = options;
      setTheme(options.theme);
      if (options.reducedMotion) {
        stopAnimation();
        draw(0);
      } else {
        startAnimation();
      }
      if (options.reducedMotion) draw(0);
    },
    dispose,
  };
}
