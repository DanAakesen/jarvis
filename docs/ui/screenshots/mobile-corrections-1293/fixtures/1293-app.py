import json
from playwright.sync_api import sync_playwright
out='/workspace/jarvis/docs/ui/screenshots/mobile-corrections-1293/'
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
 page.goto('http://localhost:5173/qaapp1293.html');page.get_by_role('textbox',name='Message Jarvis').wait_for();page.wait_for_timeout(1500)
 page.evaluate("document.documentElement.dataset.theme='dark'")
 if page.get_by_role('button',name='Show conversation',exact=True).count():page.get_by_role('button',name='Show conversation',exact=True).click()
 page.get_by_role('textbox',name='Message Jarvis').fill('A full-width draft with room to write a complete message.')
 page.screenshot(path=out+'app-composer-390.png')
 page.get_by_role('button',name='Menu',exact=True).click();page.wait_for_timeout(500);page.screenshot(path=out+'app-menu-390.png')
 page.keyboard.press('Escape')
 page.get_by_role('button',name='Dictate',exact=True).click();page.screenshot(path=out+'app-listening-390.png')
 page.get_by_role('button',name='Stop dictation',exact=True).click();assert page.get_by_role('alert').count()==0
 page.get_by_role('button',name='Dictate',exact=True).click();page.evaluate("window.fixtureRecognition.current.onerror({error:'not-allowed'})");page.screenshot(path=out+'app-error-390.png')
 page.evaluate("Object.defineProperty(window.visualViewport,'height',{configurable:true,value:480});window.visualViewport.dispatchEvent(new Event('resize'))");page.wait_for_timeout(200);page.screenshot(path=out+'app-keyboard-geometry-390.png')
 assert page.locator('.mobile-bottom-nav').is_hidden()
 assert page.locator('.conversation-input-stack').bounding_box()['y']+page.locator('.conversation-input-stack').bounding_box()['height']<=480
 page.set_viewport_size({'width':320,'height':700});page.reload();page.get_by_role('textbox',name='Message Jarvis').wait_for();page.wait_for_timeout(600);page.get_by_role('button',name='Menu',exact=True).click();page.wait_for_timeout(450);page.evaluate("document.documentElement.dataset.theme='light'");page.screenshot(path=out+'app-menu-light-320.png')
 page.set_viewport_size({'width':1440,'height':900});page.reload();page.get_by_role('textbox',name='Message Jarvis').wait_for();page.wait_for_timeout(500);page.screenshot(path=out+'app-desktop-1440.png')
 print(json.dumps({'requests':urls,'errors':errors,'alerts':page.get_by_role('alert').all_text_contents()}))
 b.close()
