import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { OrbMotionFrame } from './jarvis-orb-motion';

export function createJarvisStageOrb() {
  const orb = new THREE.Group();
  const uniforms = {
    uTime: { value: 0 },
    uCoreFlow: { value: 0 },
    uEnergy: { value: 0.12 },
    uAwake: { value: 0 },
    uIgnite: { value: 0 },
    uWave: { value: 0 },
    uWaveStrength: { value: 0 },
    uSurge: { value: 0 },
    uListen: { value: 0 },
    uThink: { value: 0 },
    uTool: { value: 0 },
    uSpeak: { value: 0 },
    uInput: { value: 0 },
    uColor: { value: new THREE.Color('#52dcfa') },
    // The bright amber brain (Dan, 7 October): the same warm glow as the chat orb, read from --glass-glow-warm.
    uWarm: { value: new THREE.Color('#ffb45c') },
  };
  const stateUniforms = `uniform float uIgnite;uniform float uWave;uniform float uWaveStrength;uniform float uSurge;
    uniform float uListen;uniform float uThink;uniform float uTool;uniform float uSpeak;uniform float uInput;`;
  const vertex = `varying vec3 vNormal;varying vec3 vPosition;varying vec3 vWorld;
    void main(){vNormal=normalize(mat3(modelMatrix)*normal);vPosition=position;
    vec4 world=modelMatrix*vec4(position,1.);vWorld=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}`;
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1.12, 112, 80), new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: vertex,
    fragmentShader: `uniform float uTime;uniform float uEnergy;uniform float uAwake;uniform vec3 uColor;uniform vec3 uWarm;${stateUniforms}
      varying vec3 vNormal;varying vec3 vPosition;varying vec3 vWorld;
      void main(){vec3 p=normalize(vPosition);vec3 eye=normalize(cameraPosition-vWorld);
        float rim=pow(1.-abs(dot(normalize(vNormal),eye)),2.7);
        float a=atan(p.z,p.x),lat=asin(clamp(p.y,-1.,1.));
        float veil=pow(abs(sin(a*17.+lat*23.+sin(lat*7.-uTime*.22)*3.+uTime*.12)),40.);
        float micro=pow(abs(sin(a*37.-lat*48.+sin(a*4.+uTime*.18)*2.)),54.);
        float fine=pow(abs(sin(a*26.+lat*39.+sin(lat*9.-uTime*.25)*4.)),40.);
        float thread=fine*smoothstep(.08,.42,rim)*mix(.065,.11,uAwake);
        float detail=(veil*.15+micro*.035)*(.12+rim*.88)*(1.+uEnergy*.45);
        float speech=uSpeak*uEnergy;
        float breath=.5+.5*sin(uTime*1.7);
        float strength=mix(.62,1.15,uAwake)*(1.+(1.-uAwake)*(.055*sin(uTime*1.1)))*(1.+uSurge*.9+speech*1.1+uListen*breath*.18);
        // Wake: an energy front travels outward from the core across the shell.
        float front=exp(-pow((rim-uWave)*7.,2.))*uWaveStrength;
        // Listening: attentive ripples moving outward, lifted by live microphone input.
        float ripple=pow(.5+.5*sin(rim*19.-uTime*3.4),10.)*uListen*(.28+uInput*1.6);
        // Thinking: rings drawn inward toward the core.
        float inward=pow(.5+.5*sin(rim*15.+uTime*2.7),12.)*uThink*.55;
        // Tool work: directed comets travelling around the shell.
        float head=uTime*2.3;
        float comet=pow(max(0.,cos(a-head)),36.)*exp(-pow(lat-.35*sin(head*.5),2.)*14.)
          +pow(max(0.,cos(a+head*.8+2.1)),48.)*exp(-pow(lat+.3,2.)*16.)*.6;
        comet*=uTool*(.4+rim*.9);
        // Speaking: outward pulses carried by the audible speech envelope.
        float voiceRing=pow(.5+.5*sin(rim*10.-uTime*5.2),6.)*speech*1.4;
        vec3 c=mix(uColor*.62,uColor,uAwake)*(rim*2.25+detail*1.4)*strength;
        c+=vec3(.48,.78,1.)*pow(rim,6.)*.55*strength;
        c+=uColor*thread*2.4;
        c+=mix(uWarm,vec3(.62,.9,1.),smoothstep(.1,.7,uWave))*front*1.6;
        c+=uColor*(ripple+voiceRing)*(.35+rim*.8);
        c+=mix(uColor,uWarm,.35)*inward*(1.-rim*.4);
        c+=vec3(.75,.95,1.)*comet*2.2;
        float alpha=rim*.66+detail*.45+thread*.4+uEnergy*.03+.004+front*.5+(ripple+voiceRing+inward)*.22+comet*.6;
        gl_FragColor=vec4(c,clamp(alpha,0.,.86));}`,
  }));
  shell.renderOrder = 3;
  orb.add(shell);

  const ribbons = new THREE.Group();
  orb.add(ribbons);
  const ribbonMaterial = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uTime;varying vec2 vUv;varying float vRim;
      void main(){vUv=uv;vec3 p=position;float d=sin(p.y*6.+p.z*3.+uTime*.28)*.014;
      p+=normalize(p)*d;vec4 view=modelViewMatrix*vec4(p,1.);
      vRim=1.-abs(dot(normalize(normalMatrix*normal),normalize(-view.xyz)));
      gl_Position=projectionMatrix*view;}`,
    fragmentShader: `uniform float uTime;uniform float uAwake;uniform float uEnergy;uniform vec3 uColor;${stateUniforms}
      varying vec2 vUv;varying float vRim;
      void main(){float envelope=smoothstep(0.,.08,vUv.y)*smoothstep(0.,.08,1.-vUv.y);
        float flow=pow(.5+.5*sin(vUv.x*12.-uTime*(.24+uTool*2.6+uThink*.5)),2.);
        float veins=pow(.5+.5*sin(vUv.y*90.+sin(vUv.x*28.+uTime*.22)*5.),22.);
        float highlight=pow(max(0.,1.-abs(vUv.y-.14)*45.),2.)*flow;
        float light=(.46+.54*uAwake)*(1.+(1.-uAwake)*.08*sin(uTime*1.1+vUv.x*6.))*(1.+uSurge*.8+uSpeak*uEnergy*.9+uTool*.35);
        float opacity=(.055+veins*.12)*envelope*(.35+.65*vRim)+highlight*.27;
        vec3 color=uColor*(1.2+veins*.65)+vec3(.52,.8,1.)*highlight*1.8;
        gl_FragColor=vec4(color,opacity*light);}`,
  });
  for (let band = 0; band < 9; band += 1) {
    const steps = 220;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const tilt = band * 0.79;
    const phase = band * 1.4;
    for (let index = 0; index <= steps; index += 1) {
      const angle = index / steps * Math.PI * 2;
      const latitude = 0.45 * Math.sin(angle * 2 + phase) + 0.18 * Math.sin(angle * 3 - phase);
      const width = (band < 6 ? 0.075 : 0.009) +
        (band < 6 ? 0.17 : 0.023) * Math.pow(0.5 + 0.5 * Math.sin(angle * 3 + phase), 2);
      for (let side = 0; side < 2; side += 1) {
        const lineLatitude = latitude + (side ? width : -width);
        positions.push(
          Math.cos(angle) * Math.cos(lineLatitude) * 1.125,
          Math.sin(lineLatitude) * 1.125,
          Math.sin(angle) * Math.cos(lineLatitude) * 1.125,
        );
        uvs.push(index / steps, side);
      }
      if (index < steps) {
        const point = index * 2;
        indices.push(point, point + 1, point + 2, point + 1, point + 3, point + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, ribbonMaterial);
    mesh.rotation.set(tilt, phase * 0.26, band * 0.49);
    mesh.renderOrder = 4;
    ribbons.add(mesh);
  }

  let seed = 71;
  const random = () => {
    seed = seed * 16807 % 2147483647;
    return seed / 2147483647;
  };
  const core = new THREE.Group();
  core.scale.setScalar(1.13);
  orb.add(core);
  const coreUniforms = { uTime: uniforms.uTime, uCoreFlow: uniforms.uCoreFlow, uAwake: uniforms.uAwake, uAudioLevel: uniforms.uEnergy,
    uIgnite: uniforms.uIgnite, uSurge: uniforms.uSurge, uThink: uniforms.uThink, uSpeak: uniforms.uSpeak,
    uListen: uniforms.uListen, uTool: uniforms.uTool, uInput: uniforms.uInput, uWave: uniforms.uWave,
    uWaveStrength: uniforms.uWaveStrength, uWarm: uniforms.uWarm };
  const nodes: THREE.Vector3[] = [];
  for (let index = 0; index < 64; index += 1) {
    const angle = index * 2.39996;
    const y = 1 - 2 * (index + 0.5) / 64;
    const radius = 0.17 + random() * 0.22;
    const lobe = index % 2 === 0 ? -0.055 : 0.055;
    nodes.push(new THREE.Vector3(
      Math.cos(angle) * Math.sqrt(1 - y * y) * radius + lobe,
      y * radius * 0.84,
      Math.sin(angle) * Math.sqrt(1 - y * y) * radius * 0.85,
    ));
  }
  const curves: THREE.TubeGeometry[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const origin = nodes[index]!;
    const neighbours = nodes
      .map((node, neighbourIndex) => ({ node, index: neighbourIndex, distance: origin.distanceTo(node) }))
      .filter((neighbour) => neighbour.index !== index)
      .sort((left, right) => left.distance - right.distance);
    const destination = neighbours[index % 3]!.node;
    const bend = origin.clone().add(destination).normalize().multiplyScalar(0.07);
    const curve = new THREE.CatmullRomCurve3([
      origin,
      origin.clone().lerp(destination, 0.35).add(bend),
      origin.clone().lerp(destination, 0.7).add(bend),
      destination,
    ]);
    curves.push(new THREE.TubeGeometry(curve, 20, 0.0018 + random() * 0.0012, 3, false));
  }
  for (let index = 0; index < 10; index += 1) {
    const points: THREE.Vector3[] = [];
    for (let point = 0; point < 32; point += 1) {
      const angle = point / 31 * Math.PI * 1.8 + index * 0.7;
      const radius = 0.19 + 0.04 * Math.sin(angle * 3 + index);
      points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.8,
        Math.sin(angle * 2 + index) * 0.16));
    }
    curves.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 80, 0.0014, 3, false));
  }
  const coreMaterial = new THREE.ShaderMaterial({
    uniforms: coreUniforms, transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    vertexShader: `uniform float uTime;uniform float uCoreFlow;uniform float uAwake;uniform float uThink;uniform float uTool;varying vec2 vUv;
      void main(){vUv=uv;vec3 p=position;
        // A slowly stirring network in dormancy; stronger travelling deformation when awake.
        float stir=.03+.028*uAwake+uTool*.02;
        p+=vec3(sin(p.y*17.+uCoreFlow),cos(p.z*13.-uCoreFlow*.8),sin(p.x*15.+uCoreFlow*.7))*stir;
        p*=1.-uThink*.12*(.5+.5*sin(uTime*3.1));
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
    fragmentShader: `uniform float uTime;uniform float uCoreFlow;uniform float uAwake;uniform float uAudioLevel;uniform vec3 uWarm;${stateUniforms}varying vec2 vUv;
      void main(){float pulse=pow(.5+.5*sin(vUv.x*8.-uCoreFlow*2.5),8.);
        // Livelier (Dan, 8 October): a second, faster train of signals fires along the filaments, a slow heartbeat lifts
        // the whole core in dormancy, and thinking, tools, listening and speech each push it visibly further.
        float fire=pow(.5+.5*sin(vUv.x*15.+uTime*(1.6+uTool*4.+uThink*2.)),18.)*(.55+uTool*.9+uThink*.6);
        float heart=pow(.5+.5*sin(uTime*1.25),3.);
        float energy=mix(.5,.85,max(uAwake,uIgnite))*(.82+.3*heart)+uSurge*.3+uSpeak*uAudioLevel*.75+uThink*.38+uTool*.3+uListen*uInput*.55;
        vec3 c=mix(uWarm*vec3(1.,.8,.7),uWarm,max(pulse,fire));
        gl_FragColor=vec4(c*(1.25+pulse*.7+fire*1.1),min(1.,energy*(.66+pulse*.28+fire*.5)));}`,
  });
  const connections = new THREE.Mesh(mergeGeometries(curves), coreMaterial);
  curves.forEach((geometry) => geometry.dispose());
  connections.renderOrder = 1;
  core.add(connections);

  const pointPositions: number[] = [];
  const pointSeeds: number[] = [];
  const pointSizes: number[] = [];
  for (let index = 0; index < 220; index += 1) {
    const radius = 0.38 * Math.pow(random(), 0.65);
    const angle = random() * Math.PI * 2;
    const y = random() * 2 - 1;
    const point = index < nodes.length ? nodes[index]! : new THREE.Vector3(
      Math.cos(angle) * Math.sqrt(1 - y * y) * radius,
      y * radius * 0.82,
      Math.sin(angle) * Math.sqrt(1 - y * y) * radius * 0.85,
    );
    pointPositions.push(point.x, point.y, point.z);
    pointSeeds.push(random());
    pointSizes.push(index < 12 ? 1.85 : 0.4 + random() * 0.85);
  }
  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pointPositions, 3));
  pointGeometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(pointSeeds, 1));
  pointGeometry.setAttribute('aSize', new THREE.Float32BufferAttribute(pointSizes, 1));
  const sparks = new THREE.Points(pointGeometry, new THREE.ShaderMaterial({
    uniforms: coreUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aSeed;attribute float aSize;uniform float uTime;uniform float uCoreFlow;uniform float uAwake;uniform float uAudioLevel;${stateUniforms}varying float vEnergy;
      void main(){vec3 p=position;
        p+=vec3(sin(uCoreFlow+aSeed*12.),cos(uCoreFlow*.8+aSeed*17.),sin(uCoreFlow*.7-aSeed*9.))*(.026+.03*uAwake+uListen*uInput*.04);
        // Thinking draws sparks inward along the core; ignition and speech push them outward.
        float inflow=fract(uTime*(.55+uThink*.5)+aSeed);
        p*=mix(1.,1.2-inflow*.9,uThink)*(1.+uSurge*.35+uSpeak*uAudioLevel*.45+uTool*.08*sin(uTime*6.+aSeed*30.));
        float ignite=max(uAwake,uIgnite);
        vEnergy=min(1.,(.5+.6*ignite+.35*uSurge+.6*uSpeak*uAudioLevel+.35*uThink+.3*uTool+.5*uListen*uInput)*(.4+.6*pow(.5+.5*sin(uCoreFlow*2.2+aSeed*21.),4.)));
        vec4 v=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*v;
        float scale=length(modelMatrix[0].xyz);
        float pointScale=scale<1.?scale/2.3:1.;
        gl_PointSize=clamp(aSize*(60.+uAwake*70.+uSpeak*uAudioLevel*40.)*pointScale/max(1.,-v.z),.8,13.);}`,
    fragmentShader: `uniform vec3 uWarm;varying float vEnergy;void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;
      float glow=exp(-d*d*7.)*.8+pow(1.-d,4.)*.6;
      gl_FragColor=vec4(uWarm*(1.25+pow(1.-d,5.)*1.2),glow*vEnergy);}`,
  }));
  sparks.renderOrder = 2;
  core.add(sparks);

  const outerPositions: number[] = [];
  const outerSeeds: number[] = [];
  for (let index = 0; index < 460; index += 1) {
    const angle = index * 2.39996;
    const y = 1 - 2 * (index + 0.5) / 460;
    const radius = Math.sqrt(1 - y * y) * 1.105;
    outerPositions.push(Math.cos(angle) * radius, y * 1.105, Math.sin(angle) * radius);
    outerSeeds.push(random());
  }
  const outerGeometry = new THREE.BufferGeometry();
  outerGeometry.setAttribute('position', new THREE.Float32BufferAttribute(outerPositions, 3));
  outerGeometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(outerSeeds, 1));
  const motes = new THREE.Points(outerGeometry, new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aSeed;uniform float uTime;uniform float uAwake;uniform float uEnergy;${stateUniforms}varying float vAlpha;
      void main(){float ripple=sin(uTime*2.4-aSeed*9.)*uListen*(.012+uInput*.03);
        vec3 p=position*(1.+sin(uTime*.3+aSeed*12.)*.005+ripple+uSurge*.06*(1.-uWave)+uWaveStrength*.05*uWave);
        vAlpha=(.28+.47*uAwake+uEnergy*uSpeak*.4+uSurge*.5+uWaveStrength*.35)*(.25+.75*pow(.5+.5*sin(uTime*(.25+uTool*1.4)+aSeed*50.),4.));
        vec4 v=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*v;gl_PointSize=clamp((32.+48.*uAwake)/max(1.,-v.z),1.4,5.);}`,
    fragmentShader: `uniform vec3 uColor;varying float vAlpha;void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;
      gl_FragColor=vec4(mix(uColor,vec3(.8,.95,1.),.4),pow(1.-d,2.)*vAlpha);}`,
  }));
  motes.renderOrder = 4;
  orb.add(motes);

  let ribbonAngle = 0;
  let coreFlow = 0;
  let previousTime = 0;
  function update(time: number, motion: OrbMotionFrame) {
    const delta = Math.max(0, Math.min(time - previousTime, 0.12));
    previousTime = time;
    uniforms.uTime.value = time;
    uniforms.uAwake.value = motion.awake;
    uniforms.uEnergy.value = motion.speech;
    uniforms.uIgnite.value = motion.ignite;
    uniforms.uWave.value = motion.wave;
    uniforms.uWaveStrength.value = motion.waveStrength;
    uniforms.uSurge.value = motion.surge;
    uniforms.uListen.value = motion.listen;
    uniforms.uThink.value = motion.think;
    uniforms.uTool.value = motion.tool;
    uniforms.uSpeak.value = motion.speak;
    uniforms.uInput.value = motion.input;
    // Integrate the phase so waking and changing state cannot jump the core's pose.
    coreFlow += delta * (0.42 + motion.awake * 0.7 + motion.think * 1.0 + motion.tool * 1.2 + motion.speech * 1.1 + motion.listen * motion.input * 0.8);
    uniforms.uCoreFlow.value = coreFlow;
    core.rotation.set(Math.sin(coreFlow * 0.55) * 0.2, coreFlow * 0.32, Math.cos(coreFlow * 0.4) * 0.12);
    // Tool work and the wake surge visibly spin up the ribbons; integrated so speed changes stay smooth.
    ribbonAngle += delta * (0.05 + motion.awake * 0.045 + motion.tool * 0.5 + motion.surge * 0.35 + motion.think * 0.06);
    ribbons.rotation.y = ribbonAngle;
    motes.rotation.y = -time * 0.012;
  }

  return { orb, uniforms, update };
}
