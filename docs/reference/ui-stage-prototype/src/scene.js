import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { createEnvironment } from './environment.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createOrb } from './orb.js';

// A stable viewpoint into a living 3D chamber. The orb moves for UI space,
// while independent mechanisms, dust and reflected light animate the room.
export function createScene(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#030b13');
  scene.fog = new THREE.FogExp2('#030b13', .015);
  const studio=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);
  const studioMap=pmrem.fromScene(studio,.04);scene.environment=studioMap.texture;scene.environmentIntensity=.42;
  studio.dispose();pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(43, innerWidth / innerHeight, .1, 80);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .58, .55, .68);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const anchor = new THREE.Group();
  scene.add(anchor);
  const orbRig = new THREE.Group();scene.add(orbRig);
  const platform = new THREE.Group();
  anchor.add(platform);
  scene.add(new THREE.HemisphereLight('#a2d6f2', '#081522', .32));
  const key = new THREE.DirectionalLight('#c2e5ff', .6);
  key.position.set(-4, 8, 4);scene.add(key);
  const rim = new THREE.DirectionalLight('#55bace', .4);
  rim.position.set(6, 2, -5);scene.add(rim);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(90,90), new THREE.MeshStandardMaterial({color:'#0b1d29',metalness:.8,roughness:.31}));
  floor.rotation.x = -Math.PI/2;floor.position.y=-.3;scene.add(floor);
  // One planar mirror renders the actual scene from below the floor. A modest
  // five-tap blur softens the reflection rather than drawing a flattened orb.
  const reflection = new Reflector(new THREE.PlaneGeometry(90,90), {color:0x526b80,textureWidth:768,textureHeight:768,multisample:0});
  reflection.rotation.x=-Math.PI/2;reflection.position.y=-.299;scene.add(reflection);
  reflection.material.fragmentShader=reflection.material.fragmentShader.replace('vec4 base = texture2DProj( tDiffuse, vUv );', `vec2 uv = vUv.xy / vUv.w;
    vec4 base = texture2D(tDiffuse, uv)*.4;
    base += texture2D(tDiffuse, uv+vec2(.0009,0.))*.15;
    base += texture2D(tDiffuse, uv-vec2(.0009,0.))*.15;
    base += texture2D(tDiffuse, uv+vec2(0.,.0009))*.15;
    base += texture2D(tDiffuse, uv-vec2(0.,.0009))*.15;`);
  const metal = new THREE.MeshStandardMaterial({color:'#446276',metalness:1,roughness:.23});
  const darkMetal = new THREE.MeshStandardMaterial({color:'#0e2635',metalness:.8,roughness:.18,transparent:true,opacity:.12,depthWrite:false});
  const light = new THREE.MeshBasicMaterial({color:'#94dae9',transparent:true,opacity:.6});
  const cyan = new THREE.MeshBasicMaterial({color:'#74e5ef',transparent:true,opacity:.95});
  function ring(parent, radius, tube, material, y = 0) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius,tube,12,160),material);
    mesh.rotation.x=-Math.PI/2;mesh.position.y=y;parent.add(mesh);return mesh;
  }
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.9,3.0,.12,128),darkMetal);
  deck.position.y=-.14;platform.add(deck);
  ring(platform,2.95,.042,metal,-.03);ring(platform,2.72,.014,light,.01);
  ring(platform,2.55,.026,metal,.005);ring(platform,2.47,.021,cyan,.02);
  ring(platform,1.83,.010,light,.015);
  ring(platform,3.65,.013,light,-.22);ring(platform,4.08,.052,metal,-.25);
  ring(platform,4.3,.012,light,-.27);
  platform.scale.setScalar(1.08);
  platform.position.x=0;
  const segments = new THREE.InstancedMesh(new THREE.BoxGeometry(.022,.008,.15),metal,64);platform.add(segments);
  const segmentTransform=new THREE.Object3D();
  for(let i=0;i<64;i++){
    const a=i/64*Math.PI*2;segmentTransform.position.set(Math.sin(a)*2.66,.04,Math.cos(a)*2.66);
    segmentTransform.rotation.y=a;segmentTransform.scale.z=i%4===0?1:.4;segmentTransform.updateMatrix();segments.setMatrixAt(i,segmentTransform.matrix);
  }
  const architecture = new THREE.Group();anchor.add(architecture);
  const environment=createEnvironment(scene,anchor,platform,architecture);
  const backLight=new THREE.PointLight('#589aba',20,35,2);backLight.position.set(0,5,-9);anchor.add(backLight);
  const haloLight = new THREE.PointLight('#4be1ef',0,20,2);scene.add(haloLight);
  const orbVisual=createOrb(),orb=orbVisual.orb,uniforms=orbVisual.uniforms;
  orb.position.y=2.1;orbRig.add(orb);
  const amberLight=new THREE.PointLight('#ff984c',4,10,2);scene.add(amberLight);
  let target={voice:false,window:false,lightStrength:1,duration:1.8,wakeDuration:3.2,reduced:false,state:'ready',muted:false};
  let motion={voice:0,split:0,voiceVelocity:0,splitVelocity:0};
  let elapsed=0,previous=performance.now(),raf=0,disposed=false,frames=0;
  const projectedOrb=new THREE.Vector3(),projectedPlatform=new THREE.Vector3(),projectedArchitecture=new THREE.Vector3();
  const ray=new THREE.Vector3(),orbWorld=new THREE.Vector3(),lightWorld=new THREE.Vector3();
  const rearLeft=new THREE.Vector3(),rearRight=new THREE.Vector3(),rearTop=new THREE.Vector3(),rearBottom=new THREE.Vector3();
  const colors={ready:new THREE.Color('#52dcfa'),listening:new THREE.Color('#51e7ed'),thinking:new THREE.Color('#8ca7ff'),speaking:new THREE.Color('#98f3d7')};
  const mutedColor=new THREE.Color('#6d8896');
  const debug={orbVisual:orbVisual.debug,environment:environment.debug,renderer:'three.js',frames:0,orb:{x:0,y:0},platform:{x:0,y:0},alignmentError:0,wakeSamples:[]};
  function frame(now){
    if(disposed)return;
    raf=requestAnimationFrame(frame);
    if(document.hidden){previous=now;return;}
    // Avoid jumping through the entire wake-up after shader compilation or a
    // slow frame. A short step preserves the wake-up transition under load.
    const dt=Math.max(0,Math.min((now-previous)/1000,.12));previous=now;
    const factor=target.reduced?1:1-Math.exp(-dt*5/target.duration);
    const splitTarget=Number(target.voice&&target.window);
    if(target.reduced){motion.voice=Number(target.voice);motion.split=splitTarget;motion.voiceVelocity=0;motion.splitVelocity=0;}
    else{
      // Stable springs give the orb momentum and reverse smoothly on new input.
      const steps=Math.max(1,Math.ceil(dt/(1/90))),step=dt/steps;
      for(let i=0;i<steps;i++){
        for(const [value,velocity,frequency,destination] of [['voice','voiceVelocity',6.6,Number(target.voice)],['split','splitVelocity',7.8,splitTarget]]){
          const omega=frequency/(value==='voice'?target.wakeDuration:target.duration);
          motion[velocity]+=(omega*omega*(destination-motion[value])-2*omega*motion[velocity])*step;
          motion[value]+=motion[velocity]*step;
        }
      }
    }
    const mobile=innerWidth<=700;
    // These transforms depend only on viewport size, never UI state.
    camera.fov=43;camera.position.set(0,4.5,19);camera.lookAt(0,3,0);
    camera.updateProjectionMatrix();camera.updateMatrixWorld();
    anchor.position.set(0,0,0);anchor.rotation.set(0,0,0);anchor.scale.setScalar(mobile?.7:1);
    anchor.updateMatrixWorld(true);
    // The room, platform and rear mechanisms share a single centre line.
    // The rear assembly stays fixed when a content window moves only the orb.
    ray.set(0,1-.46*2,.5).unproject(camera).sub(camera.position).normalize();
    const rearWorld=camera.position.clone().addScaledVector(ray,(-5-camera.position.z)/ray.z);
    architecture.position.copy(anchor.worldToLocal(rearWorld));
    architecture.quaternion.copy(camera.quaternion);
    const awake=THREE.MathUtils.clamp(motion.voice,0,1);
    // The dormant orb is already here. Activation brightens it in place;
    // an open voice view can then move it into the available side/dock space.
    const layout=motion.split*THREE.MathUtils.smoothstep(awake,0,.65);
    const screenX=mobile?.5:.5-.21*layout;
    const screenY=mobile?THREE.MathUtils.lerp(.50,.44,awake)+.24*layout:.46;
    const depth=mobile?3*layout:0;
    ray.set(screenX*2-1,1-screenY*2,.5).unproject(camera).sub(camera.position).normalize();
    orbWorld.copy(camera.position).addScaledVector(ray,(depth-camera.position.z)/ray.z);
    orbRig.position.copy(orbWorld);orbRig.position.y-=2.1;
    const fullRadius=mobile?Math.min(innerWidth*.28,innerHeight*.16):Math.min(innerWidth*.18,innerHeight*.18);
    const dockRadius=mobile?46:Math.min(innerWidth*.14,innerHeight*.157);
    const pixelRadius=THREE.MathUtils.lerp(fullRadius,dockRadius,layout);
    const cameraDepth=orbWorld.clone().applyMatrix4(camera.matrixWorldInverse).z;
    const fittedScale=pixelRadius*(-cameraDepth)*2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/innerHeight/1.12;
    const growth=1+.025*Math.sin(Math.PI*awake);
    orb.position.y=2.1+.035*Math.sin(Math.PI*awake);
    const sphereScale=growth*fittedScale;
    orb.scale.setScalar(sphereScale);orb.visible=true;
    orbRig.updateMatrixWorld(true);orb.getWorldPosition(lightWorld);
    if(!target.reduced)elapsed+=dt;
    orbVisual.update(elapsed,awake);
    uniforms.uColor.value.lerp(target.muted?mutedColor:colors[target.state],factor);
    const intensity=target.state==='speaking'?.85:target.state==='thinking'?.65:.4;
    uniforms.uEnergy.value=(target.muted?.12:intensity)*(.3+.7*awake)+(target.reduced?0:Math.sin(elapsed*2)*.025);
    // The dormant orb still illuminates and reflects in the room, at lower
    // power. A small amber source complements its blue exterior.
    const power=target.lightStrength*(.26+.74*awake)*(target.muted?.25:1);
    haloLight.position.copy(lightWorld);haloLight.color.copy(uniforms.uColor.value);
    haloLight.intensity=160*power;
    amberLight.position.copy(lightWorld);amberLight.intensity=target.lightStrength*(4+18*awake);
    environment.update({time:elapsed,orbPosition:lightWorld,orbRadius:sphereScale*1.12,color:uniforms.uColor.value,power,reduced:target.reduced});
    composer.render();
    orb.getWorldPosition(projectedOrb);projectedOrb.project(camera);
    platform.getWorldPosition(projectedPlatform);projectedPlatform.project(camera);
    architecture.getWorldPosition(projectedArchitecture);projectedArchitecture.project(camera);
    rearLeft.set(-3.1,0,0);architecture.localToWorld(rearLeft);rearLeft.project(camera);
    rearRight.set(3.1,0,0);architecture.localToWorld(rearRight);rearRight.project(camera);
    rearTop.set(0,3.1,0);architecture.localToWorld(rearTop);rearTop.project(camera);
    rearBottom.set(0,-3.1,0);architecture.localToWorld(rearBottom);rearBottom.project(camera);
    const rearWidth=Math.hypot((rearRight.x-rearLeft.x)*innerWidth,(rearRight.y-rearLeft.y)*innerHeight);
    const rearHeight=Math.hypot((rearTop.x-rearBottom.x)*innerWidth,(rearTop.y-rearBottom.y)*innerHeight);
    debug.frames=++frames;debug.voice=motion.voice;debug.split=motion.split;
    debug.orbHeight=orb.position.y;debug.orbGrowth=growth;
    debug.orb={x:(projectedOrb.x*.5+.5)*innerWidth,y:(-.5*projectedOrb.y+.5)*innerHeight};
    debug.platform={x:(projectedPlatform.x*.5+.5)*innerWidth,y:(-.5*projectedPlatform.y+.5)*innerHeight};
    debug.rearCircle={x:(projectedArchitecture.x*.5+.5)*innerWidth,y:(-.5*projectedArchitecture.y+.5)*innerHeight};
    debug.cameraPosition=camera.position.toArray();debug.cameraQuaternion=camera.quaternion.toArray();
    debug.orbRadius=pixelRadius*growth;debug.orbWorld=lightWorld.toArray();
    debug.lightPosition=haloLight.position.toArray();debug.lightIntensity=haloLight.intensity;
    debug.reflection={kind:'planar scene reflection',width:reflection.getRenderTarget().width,blurred:true};
    debug.rigDepth=depth;debug.rearAspect=rearWidth/rearHeight;
    if(target.voice&&awake>.005&&awake<.98){
      const last=debug.wakeSamples.at(-1);
      if(!last||awake-last.progress>.035){
        debug.wakeSamples.push({progress:awake,height:orb.position.y,growth,shellBrightness:orbVisual.debug.shellBrightness,coreBrightness:orbVisual.debug.coreBrightness,x:debug.orb.x,y:debug.orb.y});
        if(debug.wakeSamples.length>60)debug.wakeSamples.shift();
      }
    }
    // The dormant/solo orb is central; a voice window moves it aside.
    debug.alignmentError=Math.abs(debug.orb.x-debug.platform.x);
  }
  function resize(){
    camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<700?1.25:1.5));
    renderer.setSize(innerWidth,innerHeight);composer.setSize(innerWidth,innerHeight);
  }
  // Compile the persistent orb and its voice state before the first interaction.
  renderer.compile(scene,camera);previous=performance.now();
  window.addEventListener('resize',resize);raf=requestAnimationFrame(frame);
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();document.getElementById('render-error').hidden=false;cancelAnimationFrame(raf);});
  return { debug, update(options){if(options.voice&&!target.voice){debug.wakeSamples=[];previous=performance.now();}target={...target,...options};},dispose(){disposed=true;cancelAnimationFrame(raf);window.removeEventListener('resize',resize);scene.traverse(obj=>{obj.geometry?.dispose();if(obj.material){for(const mat of Array.isArray(obj.material)?obj.material:[obj.material])mat.dispose();}});reflection.dispose();studioMap.dispose();composer.dispose();renderer.dispose();} };
}
