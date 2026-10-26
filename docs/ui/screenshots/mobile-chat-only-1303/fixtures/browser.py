import json
from playwright.sync_api import sync_playwright
out='/workspace/jarvis/docs/ui/screenshots/mobile-chat-only-1303/'
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
 page.goto('http://localhost:5173/qa1303.html');page.get_by_role('textbox',name='Message Jarvis').wait_for();page.wait_for_timeout(500)
 def geometry():
  return page.evaluate("""()=>({home:document.querySelector('.app-shell').dataset.home,keyboard:document.querySelector('.app-shell').dataset.keyboardOpen||null,focused:document.activeElement?.id,nav:document.querySelector('.mobile-bottom-nav')?getComputedStyle(document.querySelector('.mobile-bottom-nav')).visibility:null,slotHidden:document.querySelector('.conversation-input-slot').hidden,slotDisplay:getComputedStyle(document.querySelector('.conversation-input-slot')).display,composer:document.querySelector('.conversation-input-stack').getBoundingClientRect().toJSON(),height:getComputedStyle(document.querySelector('.app-shell')).getPropertyValue('--conversation-composer-height'),dock:getComputedStyle(document.querySelector('.app-shell')).getPropertyValue('--dock-space'),overflow:document.documentElement.scrollWidth,draft:document.querySelector('#message').value})""")
 input=page.get_by_role('textbox',name='Message Jarvis')
 input.fill('Keep this draft across mobile screens.')
 initial=geometry();assert initial['nav']=='visible' and not initial['slotHidden']
 page.screenshot(path=out+'chat-390.png')
 nav=page.get_by_role('navigation',name='Mobile navigation')
 nav.get_by_role('button',name='Workspaces',exact=True).click();page.wait_for_timeout(300)
 assert geometry()['slotHidden'] and geometry()['height']=='0px'
 page.get_by_role('button',name='Close Workspaces',exact=True).click();input.wait_for()
 assert input.input_value()=='Keep this draft across mobile screens.'
 nav.get_by_role('button',name='Workspaces',exact=True).click();page.wait_for_timeout(200)
 nav.get_by_role('link',name='Chat',exact=True).click();input.wait_for()
 assert not geometry()['slotHidden']
 input.focus()
 page.set_viewport_size({'width':390,'height':480});page.wait_for_timeout(200)
 assert geometry()['keyboard']=='true'
 # Navigate while the input is focused, as a router command could do.
 page.evaluate("window.fixtureNavigate('/settings')");page.wait_for_function("document.querySelector('.app-shell')?.dataset.home === 'false'");page.wait_for_timeout(200)
 leaving=geometry()
 assert leaving['slotHidden'] and leaving['slotDisplay']=='none' and leaving['keyboard'] is None and leaving['focused']!='message',leaving
 assert not input.is_visible()
 page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(200)
 settings=geometry();assert settings['height']=='0px' and settings['nav']=='visible',settings
 page.screenshot(path=out+'settings-390.png')
 # Exercise actual mobile navigation rather than only route commands.
 page.get_by_role('button',name='Menu',exact=True).click()
 page.get_by_role('dialog',name='Go to').get_by_role('link',name='Usage',exact=True).click();page.wait_for_timeout(400)
 usage=geometry();assert usage['slotHidden'] and usage['home']=='false' and usage['nav']=='visible',usage
 page.screenshot(path=out+'usage-390.png')
 page.get_by_role('navigation',name='Mobile navigation').get_by_role('link',name='Health',exact=True).click();page.wait_for_timeout(400)
 health=geometry();assert health['slotHidden'] and health['home']=='false',health
 page.screenshot(path=out+'health-390.png')
 page.get_by_role('navigation',name='Mobile navigation').get_by_role('link',name='Chat',exact=True).click();input.wait_for();page.wait_for_timeout(200)
 returned=geometry();assert not returned['slotHidden'] and returned['draft']=='Keep this draft across mobile screens.' and returned['nav']=='visible',returned
 input.focus();page.set_viewport_size({'width':390,'height':480});page.wait_for_timeout(200)
 typing=geometry();assert typing['keyboard']=='true' and typing['composer']['bottom']<=480 and typing['nav']=='hidden',typing
 page.screenshot(path=out+'returned-typing-390.png')
 page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(200)
 assert geometry()['nav']=='visible'
 # Direct non-Chat startup must not capture input focus.
 page.goto('http://localhost:5173/qa1303.html?route=/settings');page.wait_for_timeout(600)
 direct=geometry();assert direct['slotHidden'] and direct['focused']!='message' and direct['keyboard'] is None,direct
 assert direct['draft']=='Keep this draft across mobile screens.'
 # Desktop keeps its existing off-Chat behavior.
 page.set_viewport_size({'width':1440,'height':900});page.wait_for_timeout(300)
 desktop=geometry();assert not desktop['slotHidden'],desktop
 assert not errors,errors
 results={'initial':initial,'leavingWhileTyping':leaving,'settings':settings,'usage':usage,'health':health,'returned':returned,'typingAgain':typing,'directSettings':direct,'desktop':desktop,'pageErrors':errors}
 open(out+'measurements.json','w').write(json.dumps(results,indent=2)+'\n');print(json.dumps(results));b.close()
