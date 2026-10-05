import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function createJarvisStageOrb() {
  const orb = new THREE.Group();
  const uniforms = {
    uTime: { value: 0 },
    uEnergy: { value: 0.12 },
    uAwake: { value: 0 },
    uColor: { value: new THREE.Color('#52dcfa') },
  };
  const vertex = `varying vec3 vNormal;varying vec3 vPosition;varying vec3 vWorld;
    void main(){vNormal=normalize(mat3(modelMatrix)*normal);vPosition=position;
    vec4 world=modelMatrix*vec4(position,1.);vWorld=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}`;
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1.12, 112, 80), new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: vertex,
    fragmentShader: `uniform float uTime;uniform float uEnergy;uniform float uAwake;uniform vec3 uColor;
      varying vec3 vNormal;varying vec3 vPosition;varying vec3 vWorld;
      void main(){vec3 p=normalize(vPosition);vec3 eye=normalize(cameraPosition-vWorld);
        float rim=pow(1.-abs(dot(normalize(vNormal),eye)),2.7);
        float a=atan(p.z,p.x),lat=asin(clamp(p.y,-1.,1.));
        float veil=pow(abs(sin(a*17.+lat*23.+sin(lat*7.-uTime*.22)*3.+uTime*.12)),40.);
        float micro=pow(abs(sin(a*37.-lat*48.+sin(a*4.+uTime*.18)*2.)),54.);
        float fine=pow(abs(sin(a*26.+lat*39.+sin(lat*9.-uTime*.25)*4.)),40.);
        float thread=fine*smoothstep(.08,.42,rim)*mix(.025,.11,uAwake);
        float detail=(veil*.15+micro*.035)*(.12+rim*.88)*(1.+uEnergy*.45);
        float strength=mix(.35,1.15,uAwake)*(1.+uEnergy*.18);
        vec3 c=mix(vec3(.18,.38,.48),uColor,uAwake)*(rim*2.25+detail*1.4)*strength;
        c+=vec3(.48,.78,1.)*pow(rim,6.)*.55*strength;
        c+=uColor*thread*2.4;
        gl_FragColor=vec4(c,clamp(rim*.66+detail*.45+thread*.4+uEnergy*.03+.004,0.,.78));}`,
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
    fragmentShader: `uniform float uTime;uniform float uAwake;uniform vec3 uColor;varying vec2 vUv;varying float vRim;
      void main(){float envelope=smoothstep(0.,.08,vUv.y)*smoothstep(0.,.08,1.-vUv.y);
        float flow=pow(.5+.5*sin(vUv.x*12.-uTime*.24),2.);
        float veins=pow(.5+.5*sin(vUv.y*90.+sin(vUv.x*28.+uTime*.22)*5.),22.);
        float highlight=pow(max(0.,1.-abs(vUv.y-.14)*45.),2.)*flow;
        float light=.28+.72*uAwake;
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
  const coreUniforms = { uTime: uniforms.uTime, uAwake: uniforms.uAwake, uAudioLevel: uniforms.uEnergy };
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
    vertexShader: `uniform float uTime;varying vec2 vUv;
      void main(){vUv=uv;vec3 p=position;
        p+=normalize(p+vec3(.0001))*sin(p.y*17.+p.z*13.+uTime*.48)*.009;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
    fragmentShader: `uniform float uTime;uniform float uAwake;uniform float uAudioLevel;varying vec2 vUv;
      void main(){float pulse=pow(.5+.5*sin(vUv.x*8.-uTime*(.3+uAwake*.6+uAudioLevel*.4)),8.);
        float energy=mix(.16,.78,uAwake)+uAudioLevel*.12;
        vec3 c=mix(vec3(1.,.31,.04),vec3(1.,.48,.13),pulse);
        gl_FragColor=vec4(c*(1.2+pulse*.6),energy*(.64+pulse*.25));}`,
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
    vertexShader: `attribute float aSeed;attribute float aSize;uniform float uTime;uniform float uAwake;uniform float uAudioLevel;varying float vEnergy;
      void main(){vec3 p=position;p+=normalize(p+vec3(.0001))*sin(uTime*.42+aSeed*12.)*.012;
        vEnergy=min(1.,(.18+.82*uAwake+.2*uAudioLevel)*(.45+.55*pow(.5+.5*sin(uTime*(.28+uAwake*.5)+aSeed*21.),4.)));
        vec4 v=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*v;
        float scale=length(modelMatrix[0].xyz);
        float pointScale=scale<1.?scale/2.3:1.;
        gl_PointSize=clamp(aSize*(48.+uAwake*65.)*pointScale/max(1.,-v.z),.8,11.);}`,
    fragmentShader: `varying float vEnergy;void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;
      float glow=exp(-d*d*7.)*.8+pow(1.-d,4.)*.6;
      gl_FragColor=vec4(vec3(1.,.39,.09)*(1.6+pow(1.-d,5.)*1.2),glow*vEnergy);}`,
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
    vertexShader: `attribute float aSeed;uniform float uTime;uniform float uAwake;varying float vAlpha;
      void main(){vec3 p=position*(1.+sin(uTime*.3+aSeed*12.)*.005);
        vAlpha=(.15+.6*uAwake+uEnergy*.08)*(.25+.75*pow(.5+.5*sin(uTime*.25+aSeed*50.),4.));
        vec4 v=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*v;gl_PointSize=clamp((32.+48.*uAwake)/max(1.,-v.z),1.4,5.);}`,
    fragmentShader: `uniform vec3 uColor;varying float vAlpha;void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;
      gl_FragColor=vec4(mix(uColor,vec3(.8,.95,1.),.4),pow(1.-d,2.)*vAlpha);}`,
  }));
  motes.renderOrder = 4;
  orb.add(motes);

  function update(time: number, awake: number, audioLevel: number) {
    uniforms.uTime.value = time;
    uniforms.uAwake.value = awake;
    uniforms.uEnergy.value = audioLevel;
    core.rotation.set(Math.sin(time * 0.075) * 0.09, time * 0.045, Math.cos(time * 0.07) * 0.05);
    ribbons.rotation.y = time * 0.028;
    motes.rotation.y = -time * 0.012;
  }

  return { orb, uniforms, update };
}
