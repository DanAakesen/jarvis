import '@phosphor-icons/web/regular';
import './style.css';
import { createScene } from './scene.js';

const $=id=>document.getElementById(id);
const media=matchMedia('(prefers-reduced-motion: reduce)');
const state={voice:false,view:false,minimised:false,muted:false,reduced:media.matches,orbState:'ready',lightStrength:1,duration:1.8,wakeDuration:3.2};
let scene;
try{scene=createScene($('scene'));}catch(error){$('render-error').hidden=false;console.error('3D scene failed to initialise',error);}
$('reduce-motion').checked=state.reduced;
function render(){
  document.body.classList.toggle('voice',state.voice);
  document.body.classList.toggle('has-view',state.view&&!state.minimised);
  document.body.classList.toggle('reduced',state.reduced);
  $('shell').inert=state.voice;$('voice-layer').inert=!state.voice;
  $('view-window').hidden=!state.view||state.minimised;
  $('view-tab').hidden=!state.view;$('voice-tab').hidden=!state.voice||!state.view||!state.minimised;
  $('tab-state').textContent=state.minimised?' · minimised':'';
  document.querySelector('.context-empty').hidden=state.view;
  document.querySelector('.context-example').hidden=!state.view;
  $('orb-state').textContent=state.muted?'Muted preview':({ready:'Ready',listening:'Listening preview',thinking:'Thinking preview',speaking:'Speaking preview'})[state.orbState];
  $('mute').setAttribute('aria-pressed',String(state.muted));$('mute').querySelector('span').textContent=state.muted?'Unmute preview':'Mute preview';
  document.documentElement.style.setProperty('--duration',`${state.duration*1000}ms`);
  scene?.update({voice:state.voice,window:state.view&&!state.minimised,lightStrength:state.lightStrength,duration:state.duration,wakeDuration:state.wakeDuration,reduced:state.reduced,state:state.orbState,muted:state.muted});
}
function setVoice(voice){
  if(state.voice===voice)return;
  state.voice=voice;
  if(voice&&$('minimise-on-voice').checked&&state.view)state.minimised=true;
  render();(voice?$('end-voice'):$('start-voice')).focus({preventScroll:true});
}
function openView(){state.view=true;state.minimised=false;render();}
function closeView(){state.view=false;state.minimised=false;render();(state.voice?document.querySelector('.voice-tools .example-trigger'):document.querySelector('.welcome .example-trigger')).focus({preventScroll:true});}
$('start-voice').addEventListener('click',()=>setVoice(true));
$('end-voice').addEventListener('click',()=>setVoice(false));
document.querySelectorAll('.example-trigger').forEach(button=>button.addEventListener('click',openView));
$('close-view').addEventListener('click',closeView);
$('minimise-view').addEventListener('click',()=>{state.minimised=true;render();(state.voice?$('voice-tab'):$('view-tab')).focus({preventScroll:true});});
$('view-tab').addEventListener('click',openView);$('voice-tab').addEventListener('click',openView);
$('knowledge-balance').addEventListener('input',event=>{
  const value=Number(event.target.value);
  $('balance-caption').textContent=value<35?'Personal context leads; connected sources add perspective.':value>65?'Broader sources lead; personal context keeps them relevant.':'A balance of personal context and broader sources.';
});
$('mute').addEventListener('click',()=>{state.muted=!state.muted;render();});
document.querySelectorAll('.settings-trigger').forEach(button=>button.addEventListener('click',()=>$('settings').showModal()));
$('orb-light').addEventListener('input',event=>{state.lightStrength=Number(event.target.value);render();});
$('duration').addEventListener('input',event=>{state.duration=Number(event.target.value);$('duration-label').textContent=`${state.duration.toFixed(1)} s`;render();});
$('wake-duration').addEventListener('input',event=>{state.wakeDuration=Number(event.target.value);$('wake-duration-label').textContent=`${state.wakeDuration.toFixed(1)} s`;render();});
$('reduce-motion').addEventListener('change',event=>{state.reduced=event.target.checked;render();});
media.addEventListener('change',event=>{state.reduced=event.matches;$('reduce-motion').checked=state.reduced;render();});
$('state-select').addEventListener('change',event=>{state.orbState=event.target.value;render();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('settings').open&&state.voice){event.preventDefault();setVoice(false);}});
function togglePanel(side,visible){
  const panel=$(`${side}-panel`);panel.hidden=!visible;$(`expand-${side}`).hidden=visible;
  document.documentElement.style.setProperty(`--${side}`,visible?(side==='left'?'190px':'260px'):'0px');
}
$('toggle-left').addEventListener('click',()=>togglePanel('left',false));$('expand-left').addEventListener('click',()=>togglePanel('left',true));
$('toggle-right').addEventListener('click',()=>togglePanel('right',false));$('expand-right').addEventListener('click',()=>togglePanel('right',true));
for(const id of ['home','conversation-nav','conversation-tab'])$(id).addEventListener('click',()=>{if(state.view){state.minimised=true;render();}$('message').focus();});
$('language').addEventListener('click',()=>{const code=$('language').textContent==='EN'?'DA':'EN';$('language').textContent=code;document.querySelector('.composer-language').textContent=code;$('message').placeholder=code==='DA'?'Spørg Jarvis…':'Ask Jarvis…';});
function message(role,content){const item=document.createElement('div');item.className='message';const name=document.createElement('strong');name.textContent=role;item.append(name,document.createTextNode(content));$('messages').append(item);}
$('composer').addEventListener('submit',event=>{
  event.preventDefault();const input=$('message');const text=input.value.trim();if(!text)return;
  input.value='';document.querySelector('.welcome').hidden=true;message('Dan',text);
  if(/voice|stemme/i.test(text)){setVoice(true);return;}
  if(/close|hide|luk/i.test(text)){closeView();message('Jarvis · demo','The example view is closed.');}
  else if(/show|open|compare|vis|comparison/i.test(text)){openView();message('Jarvis · demo','Here is the example comparison. Start voice to see it move alongside the orb.');}
  else message('Jarvis · demo','This is a motion study. Try “show comparison”, “close comparison”, or press the orb to preview voice.');
});
render();
// Read-only evidence for browser checks; no production API or microphone access.
window.motionStudy={getState:()=>({...state}),scene:scene?.debug};
window.addEventListener('pagehide',()=>scene?.dispose());
