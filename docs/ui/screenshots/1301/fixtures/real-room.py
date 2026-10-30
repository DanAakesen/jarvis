import json, io
from PIL import Image
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path('/workspace/jarvis/docs/ui/screenshots/1301');out.mkdir(exist_ok=True)
results=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 for width,height,touch,theme,motion in [(390,844,True,'dark','reduce')]:
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
  page.goto('http://localhost:5174/qaapp1301.html');page.get_by_role('textbox',name='Message Jarvis').wait_for();page.wait_for_timeout(1000)
  page.wait_for_timeout(400)
  if page.get_by_role('button',name='Show conversation',exact=True).count():page.get_by_role('button',name='Show conversation',exact=True).click()
  trigger=page.get_by_role('button',name='Menu',exact=True)
  for cycle in range(3):
   trigger.tap();page.wait_for_timeout(700)
   if cycle<2:trigger.tap()
  page.wait_for_timeout(2500)
  assert page.locator('.jarvis-stage').get_attribute('data-failed')=='false'
  info=page.evaluate("""()=>{const c=document.querySelector('.jarvis-stage canvas');const gl=c.getContext('webgl2');const ext=gl?.getExtension('WEBGL_debug_renderer_info');return {stageFailed:document.querySelector('.jarvis-stage').dataset.failed,canvas:[c.width,c.height],renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl?.getParameter(gl.RENDERER),surfaces:['.app-topbar','.conversation-input','.mobile-bottom-nav','.mobile-menu-sheet'].map(selector=>{const s=getComputedStyle(document.querySelector(selector));return {selector,background:s.backgroundColor,blur:s.backdropFilter,opacity:s.opacity};})};}""")
  (out/'real-room-measurements.json').write_text(json.dumps(info,indent=2))
  print(json.dumps(info),flush=True)
  page.screenshot(path=str(out/'settled-real-room-390.png'),timeout=15000)
  print('captured',flush=True)
  page.close()
 b.close()
