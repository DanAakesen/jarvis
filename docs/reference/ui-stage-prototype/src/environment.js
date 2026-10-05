import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// A symmetric chamber built from actual surfaces. The orb illuminates the
// wall, the counter-rotating mechanisms and their real floor reflection.
export function createEnvironment(scene, anchor, platform, architecture) {
  const chamber = new THREE.Group(); anchor.add(chamber);
  const steel = new THREE.MeshStandardMaterial({color:'#738d9d',metalness:.88,roughness:.24});
  const graphite = new THREE.MeshStandardMaterial({color:'#101f2d',metalness:.62,roughness:.42,side:THREE.DoubleSide});
  const inset = new THREE.MeshStandardMaterial({color:'#1c3548',metalness:.76,roughness:.3,side:THREE.DoubleSide});
  const seam = new THREE.MeshStandardMaterial({color:'#739dac',metalness:.78,roughness:.22,emissive:'#4cb2cb',emissiveIntensity:.2});
  const gold = new THREE.MeshStandardMaterial({color:'#b18b54',metalness:.85,roughness:.28,emissive:'#bf7134',emissiveIntensity:.09});
  const stripLight = new THREE.MeshBasicMaterial({color:'#5bccf8',transparent:true,opacity:.48});
  const warmLight = new THREE.MeshBasicMaterial({color:'#e6ba79',transparent:true,opacity:.4});
  const chamberUniforms={uChamberTime:{value:0},uChamberPower:{value:0},uChamberOrb:{value:new THREE.Vector3()},uChamberRadius:{value:1},uChamberColor:{value:new THREE.Color('#52dcfa')}};
  function finishMetal(material,quietBehindOrb=false) {
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,chamberUniforms);
      shader.vertexShader='varying vec3 vSurface;varying vec3 vSurfaceWorld;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vSurface=position;vec4 surfacePosition=vec4(position,1.);
        #ifdef USE_INSTANCING
          surfacePosition=instanceMatrix*surfacePosition;
        #endif
        vSurfaceWorld=(modelMatrix*surfacePosition).xyz;`);
      shader.fragmentShader='varying vec3 vSurface;varying vec3 vSurfaceWorld;uniform float uChamberTime;uniform float uChamberPower;uniform vec3 uChamberOrb;uniform float uChamberRadius;uniform vec3 uChamberColor;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float brushed=sin(vSurface.y*38.+sin(vSurface.x*12.)*.6)*.5+.5;
        roughnessFactor=clamp(roughnessFactor+brushed*.045,.18,.8);`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float caustic=pow(.5+.5*sin(vSurfaceWorld.x*1.6+sin(vSurfaceWorld.y*1.8-uChamberTime*.3)+uChamberTime*.22),5.);
        float spill=exp(-distance(vSurfaceWorld,uChamberOrb)*.11)*uChamberPower;
        totalEmissiveRadiance+=uChamberColor*caustic*spill*.07;`);
      if(quietBehindOrb) shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>', `
        // Reduce ONLY the mechanism's glare behind the transparent orb. There
        // is no opaque disc or backing: the wall and open core remain visible.
        vec3 axis=normalize(uChamberOrb-cameraPosition);
        vec3 offset=vSurfaceWorld-cameraPosition;
        float along=dot(offset,axis),orbDepth=distance(uChamberOrb,cameraPosition);
        float separation=length(offset-axis*along)*orbDepth/max(along,.01);
        float quiet=(1.-smoothstep(uChamberRadius*.72,uChamberRadius*1.04,separation))*step(orbDepth,along);
        outgoingLight*=mix(1.,.16,quiet);
        diffuseColor.a*=mix(1.,.22,quiet);
        #include <opaque_fragment>`);
    };
    material.customProgramCacheKey=()=>quietBehindOrb?'quiet-ring':'brushed-chamber';
  }
  for(const material of [steel,graphite,inset]) finishMetal(material);
  const ringSteel=steel.clone(),ringGold=gold.clone(),ringTracer=stripLight.clone();
  for(const material of [ringSteel,ringGold,ringTracer]){material.transparent=true;material.depthWrite=false;finishMetal(material,true);}
  // Broad wall facets, paired ribs and recessed slits have shared symmetry.
  // No foreground floating blocks or irregular stray floor tracks.
  const panels=12, start=Math.PI*.38, span=Math.PI*1.24;
  for(let i=0;i<panels;i++) {
    const theta=start+i*span/panels, width=span/panels;
    const panel=new THREE.Mesh(new THREE.CylinderGeometry(15,15,16,4,1,true,theta,width*.98),i%3===1?inset:graphite);
    panel.position.y=7.7; chamber.add(panel);
    const a=theta+width;
    const rib=new THREE.Mesh(new RoundedBoxGeometry(.1,15.6,.18,2,.025),steel);
    rib.position.set(Math.sin(a)*14.84,7.5,Math.cos(a)*14.84);rib.rotation.y=a;
    // Keep the central wall surface uninterrupted behind the transparent core.
    if(Math.abs(Math.sin(a))>.12) chamber.add(rib);
    for(const [y,material] of [[3.2,steel],[8.2,steel],[.28,seam]]) {
      const trim=new THREE.Mesh(new THREE.CylinderGeometry(14.82,14.82,.035,4,1,true,theta+.02,width-.04),material);
      trim.material.side=THREE.DoubleSide;trim.position.y=y;
      if(Math.abs(Math.sin(theta+width*.5))>.42||y<1) chamber.add(trim);
    }
    if(i%2===0) {
      const recessed=new THREE.Mesh(new THREE.BoxGeometry(.035,2.3,.02),stripLight);
      recessed.position.set(Math.sin(a)*14.7,7,Math.cos(a)*14.7);recessed.rotation.y=a;chamber.add(recessed);
    }
  }
  for(const side of [-1,1]) {
    for(let i=0;i<3;i++) {
      const beam=new THREE.Mesh(new RoundedBoxGeometry(.48-i*.05,12,.66,3,.065),steel);
      beam.position.set(side*(8.6+i*.5),5.65,2-i*5.7);
      beam.rotation.z=-side*.16;chamber.add(beam);
      const recess=new THREE.Mesh(new THREE.BoxGeometry(.19,11.95,.035),graphite);
      recess.position.copy(beam.position);recess.position.z+=.35;recess.rotation.copy(beam.rotation);chamber.add(recess);
      const strip=new THREE.Mesh(new THREE.BoxGeometry(.022,9.4,.03),stripLight);
      strip.position.copy(beam.position);strip.position.x+=side*.14;strip.position.z+=.355;strip.rotation.copy(beam.rotation);chamber.add(strip);
      const amberSlit=new THREE.Mesh(new THREE.BoxGeometry(.026,.85,.032),warmLight);
      amberSlit.position.copy(beam.position);amberSlit.position.y=1;amberSlit.position.z+=.36;amberSlit.rotation.copy(beam.rotation);chamber.add(amberSlit);
    }
  }

  const mechanisms=[];
  const ringData=[{r:3.6,z:0,speed:.085},{r:5.2,z:-.45,speed:-.056},{r:6.8,z:-.9,speed:.034}];
  for(let index=0;index<ringData.length;index++) {
    const {r,z,speed}=ringData[index];
    const pivot=new THREE.Group();pivot.position.z=z;architecture.add(pivot);
    const rail=new THREE.Mesh(new THREE.TorusGeometry(r,.055,10,192),ringSteel);pivot.add(rail);
    const moving=new THREE.Group();pivot.add(moving);
    for(let section=0;section<4;section++) {
      const arc=new THREE.Mesh(new THREE.TorusGeometry(r,.115+index*.022,12,44,Math.PI*.34),section===index?ringGold:ringSteel);
      arc.rotation.z=section*Math.PI/2+.12;moving.add(arc);
      const tracer=new THREE.Mesh(new THREE.TorusGeometry(r-.16,.011,6,44,Math.PI*.30),ringTracer);
      tracer.rotation.z=section*Math.PI/2+.16;tracer.position.z=.10;moving.add(tracer);
    }
    const teeth=new THREE.InstancedMesh(new THREE.BoxGeometry(.025,.11,.055),ringSteel,40);
    const transform=new THREE.Object3D();
    for(let tooth=0;tooth<40;tooth++) {
      const a=tooth/40*Math.PI*2;
      transform.position.set(Math.cos(a)*(r+.18),Math.sin(a)*(r+.18),0);
      transform.rotation.z=a-Math.PI/2;transform.scale.y=tooth%5===0?1:.55;transform.updateMatrix();teeth.setMatrixAt(tooth,transform.matrix);
    }
    moving.add(teeth);mechanisms.push({pivot,moving,speed,phase:index*Math.PI*.18});
  }
  const floorBand=new THREE.Group();platform.add(floorBand);
  for(let i=0;i<8;i++) {
    const arc=new THREE.Mesh(new THREE.TorusGeometry(3.34,.011,5,32,Math.PI*.13),i%4===0?gold:seam);
    arc.rotation.set(-Math.PI/2,0,i*Math.PI/4);arc.position.y=-.15;floorBand.add(arc);
  }
  const farRail=new THREE.Mesh(new THREE.TorusGeometry(6.6,.013,6,200),steel);
  farRail.rotation.x=-Math.PI/2;farRail.position.y=-.25;chamber.add(farRail);
  const packets=[];
  for(let i=0;i<6;i++) {
    const mesh=new THREE.Mesh(new THREE.SphereGeometry(.021,8,6),new THREE.MeshBasicMaterial({color:i%3===0?'#d7b77d':'#b8f5ff'}));
    platform.add(mesh);packets.push(mesh);
  }

  const count=520,positions=new Float32Array(count*3),seeds=new Float32Array(count),sizes=new Float32Array(count);
  let randomSeed=29;
  const random=()=>{randomSeed=(randomSeed*16807)%2147483647;return randomSeed/2147483647;};
  for(let i=0;i<count;i++) {
    positions[i*3]=(random()-.5)*24;positions[i*3+1]=random()*12-.1;positions[i*3+2]=-22+random()*25;
    seeds[i]=random();sizes[i]=.3+random()*.8;
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.setAttribute('aSeed',new THREE.BufferAttribute(seeds,1));geometry.setAttribute('aSize',new THREE.BufferAttribute(sizes,1));
  const particleUniforms={uTime:{value:0},uOrb:{value:new THREE.Vector3()},uColor:{value:new THREE.Color('#52dcfa')},uPower:{value:0}};
  const dust=new THREE.Points(geometry,new THREE.ShaderMaterial({uniforms:particleUniforms,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    vertexShader:`attribute float aSeed;attribute float aSize;uniform float uTime;uniform vec3 uOrb;uniform float uPower;
      varying float vLight;varying float vSeed;
      void main(){vec3 p=position;float t=uTime*.19+aSeed*6.283;
      p.x+=sin(t+p.z*.2)*.35;p.y+=sin(t*.8+aSeed*12.)*.4;p.z+=sin(t*.5)*.8;
      vec4 world=modelMatrix*vec4(p,1.);float d=distance(world.xyz,uOrb);
      vLight=.13+uPower*exp(-d*.22)*.7;vSeed=aSeed;
      vec4 view=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*view;
      gl_PointSize=clamp(aSize*34./max(1.,-view.z),1.,5.);}`,
    fragmentShader:`uniform vec3 uColor;varying float vLight;varying float vSeed;
      void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;
      float a=pow(1.-d,2.)*vLight;vec3 tint=mix(uColor,vec3(.85,.63,.32),step(.94,vSeed));
      gl_FragColor=vec4(tint*1.6,a);}`}));scene.add(dust);

  const hazeUniforms={uTime:{value:0},uOrb:{value:new THREE.Vector3()},uColor:{value:new THREE.Color('#52dcfa')},uPower:{value:0}};
  const hazeMaterial=new THREE.ShaderMaterial({uniforms:hazeUniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide,
    vertexShader:`varying vec2 vUv;varying vec3 vWorld;void main(){vUv=uv;vec4 p=modelMatrix*vec4(position,1.);vWorld=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}`,
    fragmentShader:`uniform float uTime;uniform vec3 uOrb;uniform vec3 uColor;uniform float uPower;varying vec2 vUv;varying vec3 vWorld;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
      void main(){vec2 p=vUv*vec2(9.,4.)+vec2(uTime*.025,uTime*.015);
        float fog=noise(p)*.65+noise(p*2.1-uTime*.017)*.35;
        float edge=sin(vUv.y*3.14159)*smoothstep(0.,.12,vUv.x)*smoothstep(0.,.12,1.-vUv.x);
        float scatter=exp(-distance(vWorld,uOrb)*.18)*uPower;
        gl_FragColor=vec4(mix(vec3(.04,.08,.12),uColor*.35,clamp(scatter,0.,1.)),fog*edge*(.012+scatter*.05));}`} );
  const mist=new THREE.Mesh(new THREE.PlaneGeometry(24,4),hazeMaterial);mist.position.set(0,4,-12);scene.add(mist);

  const wallLight=new THREE.SpotLight('#52dcfa',0,45,.83,.85,2);
  scene.add(wallLight);scene.add(wallLight.target);
  const debug={geometryLayers:3,wallPanels:panels,particles:count,depthRange:[-22,4],chamberRadius:15,phase:0,ringAngles:[],wallLight:0};
  function update({time,orbPosition,orbRadius,color,power,reduced}) {
    chamberUniforms.uChamberTime.value=time;chamberUniforms.uChamberPower.value=power;
    chamberUniforms.uChamberOrb.value.copy(orbPosition);chamberUniforms.uChamberColor.value.copy(color);
    chamberUniforms.uChamberRadius.value=orbRadius;
    hazeUniforms.uTime.value=time;hazeUniforms.uOrb.value.copy(orbPosition);
    hazeUniforms.uColor.value.copy(color);hazeUniforms.uPower.value=power;
    for(const {moving,speed,phase} of mechanisms) moving.rotation.z=time*speed+phase;
    floorBand.rotation.y=-time*.065;
    for(let i=0;i<packets.length;i++) {
      const a=time*(i%2===0?.13:-.10)+i*Math.PI/3;
      packets[i].position.set(Math.cos(a)*3.35,-.12,Math.sin(a)*3.35);
    }
    particleUniforms.uTime.value=time;particleUniforms.uOrb.value.copy(orbPosition);
    particleUniforms.uColor.value.copy(color);particleUniforms.uPower.value=power;
    seam.emissive.copy(color);seam.emissiveIntensity=.13+power*.16+(reduced?0:.015*Math.sin(time*.6));
    wallLight.position.copy(orbPosition);wallLight.color.copy(color);
    wallLight.target.position.set(orbPosition.x*.72,orbPosition.y*.8+.7,-14.5);
    wallLight.intensity=power*330;
    debug.phase=time;debug.ringAngles=mechanisms.map(({moving})=>moving.rotation.z);
    debug.wallLight=wallLight.intensity;debug.wallLightPosition=wallLight.position.toArray();
  }
  return {update,debug};
}
