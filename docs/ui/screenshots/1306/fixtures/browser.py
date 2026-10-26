import json
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path('/workspace/jarvis/docs/ui/screenshots/1306')
results=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-webgl'])
 for width,height,touch,theme,motion in [(390,844,True,'dark','no-preference'),(320,700,True,'light','reduce'),(1440,1000,False,'dark','no-preference')]:
  page=b.new_page(viewport={'width':width,'height':height},is_mobile=touch,has_touch=touch,color_scheme=theme,reduced_motion=motion)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('**/src/useSignIn.ts',lambda r:r.fulfill(content_type='application/javascript',body="const token=async()=> 'synthetic'; const session={state:'signed-in',profile:{name:'Synthetic QA'},message:'',getAccessToken:token,getEntraAccessToken:token,hasOwnerSession:true,client:{getActiveAccount:()=>({homeAccountId:'synthetic'}),getAllAccounts:()=>[]},signIn:async()=>{},switchAccount:async()=>{},signOut:async()=>{},signOutAllDevices:async()=>{}}; export function useSignIn(){return session;}"))

  def respond(r):
   u=r.request.url
   msg={'id':'42','sessionId':'41','channel':'chat','language':'en','role':'jarvis','text':'Synthetic attachment menu check.','model':None,'voiceMinutes':None,'at':'2026-10-26T06:00:00.000Z','toolCalls':[]}
   data={'messages':[msg],'nextCursor':None} if '/conversation/history' in u else {}
   if '/workspaces' in u:data={'items':[]}
   if '/workspace/pins' in u:data={'pins':[]}
   if '/jobs' in u:data={'jobs':[]}
   if '/settings' in u:data={'settings':{'appearance':{'theme':theme}}}
   if '/presence' in u:data={'mode':'available','updatedAt':'2026-10-26T06:00:00Z'}
   r.fulfill(json=data)
  page.route('http://fixture.invalid/**',respond)
  page.goto('http://localhost:5174/qaapp1301.html')
  page.get_by_role('textbox',name='Message Jarvis').wait_for()
  page.wait_for_timeout(1000)
  press=lambda locator: locator.tap() if touch else locator.click()
  trigger=page.locator('.composer-more .more-menu-trigger')
  press(trigger)
  page.wait_for_timeout(400)
  action=page.get_by_role('menuitem',name='Attach file or photo')
  before=action.bounding_box()
  input=page.get_by_test_id('attachment-input')
  bounds=input.bounding_box()
  assert all(abs(bounds[k]-before[k])<1 for k in bounds),(bounds,before)
  with page.expect_file_chooser() as fc:press(action)
  chooser=fc.value
  page.wait_for_timeout(500)
  assert trigger.get_attribute('aria-expanded')=='true'
  assert action.is_visible()
  assert action.bounding_box()==before
  assert chooser.is_multiple()
  assert chooser.element.evaluate('(e)=>e===document.querySelector(".more-menu-file-input")')
  page.screenshot(path=str(out/f'picker-source-{width}-{theme}.png'))
  # Browser automation intercepts the chooser; simulate native cancel, then reopen.
  input.dispatch_event('cancel')
  assert trigger.get_attribute('aria-expanded')=='true'
  with page.expect_file_chooser():press(action)
  assert action.bounding_box()==before
  press(trigger);assert trigger.get_attribute('aria-expanded')=='false'
  press(trigger)
  page.keyboard.press('Escape');assert trigger.get_attribute('aria-expanded')=='false'
  press(trigger)
  page.mouse.click(width-5,5)
  assert trigger.get_attribute('aria-expanded')=='false'
  press(trigger)
  page.get_by_role('menuitem',name='Language',exact=True).click()
  page.get_by_role('menuitemradio',name='English').click()
  assert trigger.get_attribute('aria-expanded')=='false'
  assert not errors,errors
  results.append({'viewport':[width,height],'theme':theme,'motion':motion,'row':before,'input':bounds,'nativeFileChooserEvent':True,'menuRetained':True,'cancelSimulated':True,'plusEscapeOutsideLanguage':True,'errors':errors})
  page.close()
 b.close()
(out/'measurements.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
