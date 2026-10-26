import json
from playwright.sync_api import sync_playwright
out='/workspace/jarvis/docs/ui/screenshots/iphone-keyboard-1295/'
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=b.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
 page.route('**/src/useSignIn.ts',lambda r:r.fulfill(content_type='application/javascript',body="const token=async()=> 'synthetic'; const session={state:'signed-in',profile:{name:'Synthetic QA'},message:'',getAccessToken:token,getEntraAccessToken:token,hasOwnerSession:true,client:{getActiveAccount:()=>({homeAccountId:'synthetic'}),getAllAccounts:()=>[]},signIn:async()=>{},switchAccount:async()=>{},signOut:async()=>{},signOutAllDevices:async()=>{}}; export function useSignIn(){return session;}"))
 urls=[];errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def respond(r):
  u=r.request.url;urls.append(u)
  msg={'id':'42','sessionId':'41','channel':'voice','language':'en','role':'jarvis','text':'Synthetic conversation for mobile layout verification. The message remains visible when opening the menu.','model':None,'voiceMinutes':None,'at':'2026-10-26T06:00:00.000Z','toolCalls':[]}
  data={'messages':[msg],'nextCursor':None} if '/conversation/history' in u else {}
  if '/workspaces' in u: data={'items':[]}
  if '/workspace/pins' in u:data={'pins':[]}
  if '/jobs' in u: data={'jobs':[]}
  if '/settings' in u:data={'settings':{'appearance':{'theme':'dark'}}}
  if '/presence' in u:data={'mode':'available','updatedAt':'2026-10-26T06:00:00Z'}
  r.fulfill(json=data)
 page.route('http://fixture.invalid/**',respond)
 page.goto('http://localhost:5173/qaapp1293.html');page.get_by_role('textbox',name='Message Jarvis').wait_for();page.wait_for_timeout(500)
 input=page.get_by_role('textbox',name='Message Jarvis')
 input.fill('Keep this draft while the iPhone keyboard is open.')
 if page.get_by_role('button',name='Show conversation',exact=True).count():page.get_by_role('button',name='Show conversation',exact=True).click()
 input.focus()
 page.set_viewport_size({'width':390,'height':480});page.wait_for_timeout(300)
 def geometry():
  return page.evaluate("""()=>({inner:innerHeight,layout:document.documentElement.clientHeight,visual:visualViewport.height,offset:visualViewport.offsetTop,focused:document.activeElement?.id,typing:document.querySelector('.app-shell').dataset.keyboardOpen,nav:getComputedStyle(document.querySelector('.mobile-bottom-nav')).visibility,composer:document.querySelector('.conversation-input-stack').getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth})""")
 resized=geometry()
 assert resized['inner']==resized['layout']==resized['visual']==480,resized
 assert resized['nav']=='hidden' and resized['composer']['bottom']<=480 and resized['focused']=='message',resized
 page.get_by_role('button',name='More options',exact=True).click()
 assert page.get_by_role('menu',name='More options',exact=True).is_visible()
 assert geometry()['nav']=='hidden' and geometry()['composer']['bottom']==resized['composer']['bottom']
 page.keyboard.press('Escape');input.focus()
 page.screenshot(path=out+'app-resized-layout-390x480.png')
 # Dismissal enlarges the viewport, while the caret still owns focus.
 page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(300)
 restored=geometry();assert restored['nav']=='visible' and restored['focused']=='message',restored
 page.screenshot(path=out+'app-restored-390x844.png')
 # Reopening without another focus event must hide navigation again.
 page.set_viewport_size({'width':390,'height':480});page.wait_for_timeout(250)
 assert geometry()['nav']=='hidden'
 # Reload with all three viewports already short: no pre-keyboard height exists.
 page.reload();page.get_by_role('textbox',name='Message Jarvis').wait_for();page.get_by_role('textbox',name='Message Jarvis').focus();page.wait_for_timeout(300)
 mounted=geometry();assert mounted['nav']=='hidden' and mounted['composer']['bottom']<=480,mounted
 assert page.get_by_role('textbox',name='Message Jarvis').input_value()=='Keep this draft while the iPhone keyboard is open.'
 page.screenshot(path=out+'app-mounted-short-390x480.png')
 # Ending typing restores normal navigation even without any viewport event.
 page.get_by_role('textbox',name='Message Jarvis').evaluate('(e)=>e.blur()');page.wait_for_timeout(100)
 blurred=geometry();assert blurred['nav']=='visible',blurred
 page.screenshot(path=out+'app-blurred-short-390x480.png')
 print(json.dumps({'resized':resized,'restored':restored,'mounted':mounted,'blurred':blurred,'pageErrors':errors}))
 b.close()
