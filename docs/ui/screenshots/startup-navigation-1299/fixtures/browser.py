import json
from playwright.sync_api import sync_playwright
out='/workspace/jarvis/docs/ui/screenshots/startup-navigation-1299/'
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
 def geometry():
  return page.evaluate("""()=>({inner:innerHeight,layout:document.documentElement.clientHeight,visual:visualViewport.height,focused:document.activeElement?.id,typing:document.querySelector('.app-shell').dataset.keyboardOpen,nav:getComputedStyle(document.querySelector('.mobile-bottom-nav')).visibility,composer:document.querySelector('.conversation-input-stack').getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth})""")
 # Crucially, no click, fill, blur or focus before this initial observation.
 startup=geometry()
 assert startup['focused']=='message' and startup['nav']=='visible' and startup['typing']=='false',startup
 page.screenshot(path=out+'startup-390x844.png')
 input=page.get_by_role('textbox',name='Message Jarvis')
 input.fill('Keep navigation available until the keyboard opens.')
 page.set_viewport_size({'width':390,'height':480});page.wait_for_timeout(300)
 typing=geometry()
 assert typing['inner']==typing['layout']==typing['visual']==480 and typing['nav']=='hidden' and typing['composer']['bottom']==472,typing
 page.get_by_role('button',name='More options',exact=True).click()
 assert page.get_by_role('menu',name='More options',exact=True).is_visible()
 assert geometry()['nav']=='hidden' and geometry()['composer']['bottom']==472
 page.get_by_role('button',name='More options',exact=True).click()
 assert not page.get_by_role('menu',name='More options',exact=True).count()
 input.focus()
 page.screenshot(path=out+'typing-390x480.png')
 page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(300)
 restored=geometry();assert restored['nav']=='visible' and restored['focused']=='message',restored
 page.screenshot(path=out+'restored-390x844.png')
 # Resize arrives before focus: keep the earlier height observation.
 input.evaluate('(e)=>e.blur()');page.wait_for_timeout(100)
 page.set_viewport_size({'width':390,'height':480});page.wait_for_timeout(150)
 assert geometry()['nav']=='visible'
 input.focus();page.wait_for_timeout(100)
 assert geometry()['nav']=='hidden'
 input.evaluate('(e)=>e.blur()');page.wait_for_timeout(100)
 assert geometry()['nav']=='visible'
 # A fresh short viewport without any inset/history is not keyboard evidence.
 page.reload();page.get_by_role('textbox',name='Message Jarvis').wait_for();page.wait_for_timeout(500)
 short=geometry();assert short['focused']=='message' and short['nav']=='visible',short
 assert page.get_by_role('textbox',name='Message Jarvis').input_value()=='Keep navigation available until the keyboard opens.'
 page.screenshot(path=out+'startup-short-390x480.png')
 page.set_viewport_size({'width':390,'height':300});page.wait_for_timeout(200)
 assert geometry()['nav']=='hidden' and geometry()['composer']['bottom']<=300
 assert not errors,errors
 results={'startup':startup,'typing':typing,'restored':restored,'shortStartup':short,'pageErrors':errors}
 open(out+'measurements.json','w').write(json.dumps(results,indent=2)+'\n')
 print(json.dumps(results))
 b.close()
