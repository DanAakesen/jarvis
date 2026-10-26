import json, io
from PIL import Image
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path('/workspace/jarvis/docs/ui/screenshots/1309/final-mobile');out.mkdir(exist_ok=True)
results=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-webgl'])
 for width,height,touch,theme,motion in [(390,844,True,'dark','reduce'),(1440,1000,False,'dark','reduce')]:
  page=b.new_page(viewport={'width':width,'height':height},is_mobile=touch,has_touch=touch,color_scheme=theme,reduced_motion=motion)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('**/src/useSignIn.ts',lambda r:r.fulfill(content_type='application/javascript',body="const token=async()=> 'synthetic'; const session={state:'signed-in',profile:{name:'Synthetic QA'},message:'',getAccessToken:token,getEntraAccessToken:token,hasOwnerSession:true,client:{getActiveAccount:()=>({homeAccountId:'synthetic'}),getAllAccounts:()=>[]},signIn:async()=>{},switchAccount:async()=>{},signOut:async()=>{},signOutAllDevices:async()=>{}}; export function useSignIn(){return session;}"))
  pending_settings=[]
  def respond(r):
   u=r.request.url
   msg={'id':'42','sessionId':'41','channel':'voice','language':'en','role':'jarvis','text':'Synthetic conversation for settled glass verification. Chat remains visible behind the menu.','model':None,'voiceMinutes':None,'at':'2026-10-26T06:00:00.000Z','toolCalls':[]}
   data={'messages':[msg],'nextCursor':None} if '/conversation/history' in u else {}
   if '/workspaces' in u:data={'items':[]}
   if '/workspace/pins' in u:data={'pins':[]}
   if '/jobs' in u:data={'jobs':[]}
   if '/settings' in u:data={'settings':{'appearance':{'theme':theme,'motion':'reduced'}}}
   if '/presence' in u:data={'mode':'available','updatedAt':'2026-10-26T06:00:00Z'}
   r.fulfill(json=data)
  page.route('http://fixture.invalid/**',respond)
  # Replace only the voice transport/audio boundary; actual App/VoiceControls own UI state.
  page.route('**/src/voice-client.ts',lambda r:r.fulfill(content_type='application/javascript',body="export class BrowserVoiceClient { constructor(options){this.options=options;}start(){this.options.onStatus('listening','Synthetic voice session');}stop(){this.options.onStatus('stopped','Stopped');}setCameraState(){}playbackLevel(){return 0;}inputLevel(){return 0;}setMuted(){} }"))
  page.goto('http://localhost:5174/qa1303.html');page.get_by_role('textbox',name='Message Jarvis').wait_for();page.wait_for_timeout(1000)
  page.wait_for_timeout(400)
  if page.get_by_role('button',name='Show conversation',exact=True).count():page.get_by_role('button',name='Show conversation',exact=True).click()
  page.locator('.composer-more .more-menu-trigger').click()
  page.get_by_role('menuitem',name='Voice',exact=True).click()
  page.wait_for_function("document.querySelector('.app-shell').dataset.voiceActive==='true'")
  page.wait_for_timeout(700)
  states=page.evaluate("""()=>['.app-topbar','.conversation-input','.composer','.voice-bar','.mobile-bottom-nav'].map(selector=>{const e=document.querySelector(selector);if(!e)return {selector,exists:false};const s=getComputedStyle(e);return {selector,class:e.className,voiceActive:e.dataset.voiceActive,hidden:e.hidden,display:s.display,background:s.backgroundColor,blur:s.backdropFilter,rect:e.getBoundingClientRect().toJSON()};})""")
  assert page.locator('.app-topbar').is_visible()
  assert page.locator('.app-topbar').evaluate("e=>getComputedStyle(e).backdropFilter")=='blur(10px)'
  assert page.locator('.conversation-input').get_attribute('data-voice-active')=='true'
  assert page.locator('.conversation-input').evaluate("e=>getComputedStyle(e).backgroundColor")=='rgba(0, 0, 0, 0)'
  assert page.locator('.voice-bar').evaluate("e=>getComputedStyle(e).backdropFilter")=='blur(10px)'
  assert '/ 0.36)' in page.locator('.voice-bar').evaluate("e=>getComputedStyle(e).backgroundColor")
  page.screenshot(path=str(out/f'voice-material-{width}.png'))
  if touch:
   page.evaluate("window.fixtureNavigate('/settings')")
   page.wait_for_function("document.querySelector('.conversation-input-slot').hidden")
   assert not page.locator('.voice-bar').is_visible()
   assert page.locator('.app-shell').get_attribute('data-voice-active') == 'true'
   page.evaluate("window.fixtureNavigate('/')")
   page.locator('.voice-bar').wait_for()
   page.get_by_role('navigation',name='Mobile navigation').get_by_role('button',name='Workspaces',exact=True).click()
   assert not page.locator('.voice-bar').is_visible()
   page.get_by_role('button',name='Close Workspaces',exact=True).click()
   page.locator('.voice-bar').wait_for()
  page.get_by_role('button',name='End voice',exact=True).click()
  page.wait_for_function("document.querySelector('.app-shell').dataset.voiceActive==='false'")
  page.get_by_role('textbox',name='Message Jarvis').wait_for()
  assert not errors, errors
  results.append({'viewport':[width,height],'voiceTransport':'synthetic listening state; no microphone or network','states':states,'mobileRouteVisibility':touch,'explicitEndVoice':True,'errors':errors})
  page.close()
 b.close()
(out/'voice-measurements.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
