import json
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path('/workspace/jarvis/docs/ui/screenshots/1304')
results=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-webgl'])
 for width,height,touch in [(390,844,True),(320,700,True),(1440,900,False)]:
  page=b.new_page(viewport={'width':width,'height':height},is_mobile=touch,has_touch=touch,reduced_motion='reduce')
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('**/src/useSignIn.ts',lambda r:r.fulfill(content_type='application/javascript',body="const token=async()=> 'synthetic'; const session={state:'signed-in',profile:{name:'Synthetic QA'},message:'',getAccessToken:token,getEntraAccessToken:token,hasOwnerSession:true,client:{getActiveAccount:()=>({homeAccountId:'synthetic'}),getAllAccounts:()=>[]},signIn:async()=>{},switchAccount:async()=>{},signOut:async()=>{},signOutAllDevices:async()=>{}}; export function useSignIn(){return session;}"))
  def respond(r):
   u=r.request.url
   msg={'id':'42','sessionId':'41','channel':'voice','language':'en','role':'jarvis','text':'Synthetic conversation for camera and menu verification. Move the preview while keeping the conversation visible.','model':None,'voiceMinutes':None,'at':'2026-10-26T06:00:00.000Z','toolCalls':[]}
   data={'messages':[msg],'nextCursor':None} if '/conversation/history' in u else {}
   if '/workspaces' in u:data={'items':[]}
   if '/workspace/pins' in u:data={'pins':[]}
   if '/jobs' in u:data={'jobs':[]}
   if '/settings' in u:data={'settings':{'appearance':{'theme':'dark'}}}
   if '/presence' in u:data={'mode':'available','updatedAt':'2026-10-26T06:00:00Z'}
   r.fulfill(json=data)
  page.route('http://fixture.invalid/**',respond)
  page.add_init_script("""navigator.mediaDevices.getUserMedia=async (constraints)=>{
    const canvas=document.createElement('canvas');window.qaCanvas=canvas;canvas.width=360;canvas.height=640;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#366f7e';ctx.fillRect(0,0,360,640);
    ctx.fillStyle='#dcab68';ctx.fillRect(30,160,300,220);ctx.fillStyle='#fff';ctx.font='24px sans-serif';ctx.fillText('SYNTHETIC CAMERA',40,440);
    setInterval(()=>{ctx.fillStyle='#366f7e';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#dcab68';ctx.fillRect(canvas.width*.1,canvas.height*.25,canvas.width*.8,canvas.height*.35);},100);
    const stream=canvas.captureStream(10);const track=stream.getVideoTracks()[0];
    track.getSettings=()=>({width:360,height:640,facingMode:constraints.video.facingMode?.exact||constraints.video.facingMode?.ideal||'user'});
    return stream;
  };""")
  page.goto('http://localhost:5174/qaapp1296.html');page.get_by_role('textbox',name='Message Jarvis').wait_for();page.wait_for_timeout(1000)
  page.evaluate("document.documentElement.dataset.theme='dark'")
  if page.get_by_role('button',name='Show conversation',exact=True).count():page.get_by_role('button',name='Show conversation',exact=True).click()
  trigger=page.locator('.composer-more .more-menu-trigger'); trigger.wait_for()
  press=lambda locator: locator.tap() if touch else locator.click()
  for i in range(3):
   press(trigger);assert trigger.get_attribute('aria-expanded')=='true'
   press(trigger);assert trigger.get_attribute('aria-expanded')=='false'
  press(trigger);page.wait_for_timeout(450)
  page.get_by_role('menuitem',name='Enable video',exact=True).click()
  picture=page.locator('.camera-preview-picture');picture.wait_for();page.wait_for_timeout(600)
  page.screenshot(path=str(out/f'camera-before-{width}.png'))
  before=picture.bounding_box();x=before['x']+before['width']/2;y=before['y']+before['height']*.7
  if touch:
   cdp=page.context.new_cdp_session(page)
   cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
   for step in range(1,6):
    cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x-40*step/5,'y':y+70*step/5}]})
    page.wait_for_timeout(40)
   cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
   cdp.detach()
  else:
   page.mouse.move(x,y);page.mouse.down();page.mouse.move(x-150,y+90,steps=8);page.mouse.up()
  after=picture.bounding_box();assert abs(after['x']-before['x'])>20,(before,after)
  assert after['y']>before['y']+20,(before,after)
  page.screenshot(path=str(out/f'camera-drag-{width}.png'))
  states=[]
  def measure(label):
   data=picture.evaluate("""e=>{const v=e.querySelector('video'),r=e.getBoundingClientRect(),vr=v.getBoundingClientRect(),c=e.querySelector('.camera-status-actions').getBoundingClientRect();return {picture:{x:r.x,y:r.y,width:r.width,height:r.height},video:{x:vr.x,y:vr.y,width:vr.width,height:vr.height},intrinsic:[v.videoWidth,v.videoHeight],controls:{x:c.x,y:c.y,width:c.width,height:c.height}}}""")
   r=data['picture'];v=data['video'];c=data['controls']
   assert abs(r['width']/r['height']-data['intrinsic'][0]/data['intrinsic'][1])<.01,data
   assert all(abs(r[k]-v[k])<1 for k in r),data
   assert c['x']>=r['x'] and c['y']>=r['y'] and c['x']+c['width']<=r['x']+r['width']+1,data
   states.append({'state':label,**data})
  measure('dragged')
  if touch:
   for i in range(3):
    press(page.get_by_role('button',name='Switch to back camera'));page.get_by_role('button',name='Switch to front camera').wait_for();page.wait_for_timeout(400)
    press(page.get_by_role('button',name='Switch to front camera'));page.get_by_role('button',name='Switch to back camera').wait_for();page.wait_for_timeout(400)
   measure('switched-repeatedly')
  page.get_by_role('textbox',name='Message Jarvis').fill('Synthetic typing while camera stays on')
  page.set_viewport_size({'width':width,'height':600 if touch else 700});page.wait_for_timeout(700)
  page.evaluate("document.querySelector('.camera-preview-picture video').pause()")
  page.evaluate("window.qaCanvas.width=640;window.qaCanvas.height=360;const c=window.qaCanvas.getContext('2d');c.fillStyle='#366f7e';c.fillRect(0,0,640,360);c.fillStyle='#dcab68';c.fillRect(60,60,520,160)")
  page.evaluate("document.querySelector('.camera-preview-picture video').play()");page.wait_for_timeout(700)
  page.wait_for_function("document.querySelector('.camera-preview-picture video').videoWidth===640")
  page.wait_for_timeout(200)
  measure('resumed-landscape-short-viewport')
  page.screenshot(path=str(out/f'camera-short-{width}.png'))
  page.evaluate("window.qaCanvas.width=360;window.qaCanvas.height=640;const c=window.qaCanvas.getContext('2d');c.fillStyle='#366f7e';c.fillRect(0,0,360,640);c.fillStyle='#dcab68';c.fillRect(30,160,300,220)")
  page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(700)
  page.wait_for_function("document.querySelector('.camera-preview-picture video').videoWidth===360")
  page.wait_for_timeout(200)
  measure('restored-portrait')
  assert page.locator('.camera-preview-live,.camera-status-label').count()==0
  page.screenshot(path=str(out/f'camera-after-{width}.png'))
  page.evaluate("document.documentElement.dataset.theme='light'");page.wait_for_timeout(400)
  page.screenshot(path=str(out/f'camera-light-{width}.png'))
  page.evaluate("document.documentElement.dataset.theme='dark'")
  press(page.get_by_role('button',name='Close camera preview',exact=True));assert picture.count()==0
  if touch:
   press(page.get_by_role('button',name='Menu',exact=True));page.wait_for_timeout(450)
   page.evaluate("document.documentElement.dataset.theme='light'");page.wait_for_timeout(600)
  # Browser-computed surfaces retain translucency and borderless composer controls.
  surfaces=page.locator('.conversation-input, .mobile-bottom-nav, .mobile-menu-sheet, .app-topbar').evaluate_all("es=>es.map(e=>({class:e.className,background:getComputedStyle(e).backgroundColor,blur:getComputedStyle(e).backdropFilter}))")
  for selector in ['.composer-more .more-menu-trigger','.composer-send']:
   assert page.locator(selector).evaluate("e=>getComputedStyle(e).borderTopWidth")=='0px'
  styles=page.locator('.conversation-input').evaluate("e=>({background:getComputedStyle(e).backgroundColor,blur:getComputedStyle(e).backdropFilter})")
  results.append({'width':width,'height':height,'touch':touch,'before':before,'after':after,'states':states,'composer':styles,'surfaces':surfaces,'errors':errors})
  page.close()
 b.close()
(out/'measurements.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
