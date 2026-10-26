import json, io
from PIL import Image
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path('/workspace/jarvis/docs/ui/screenshots/1301');out.mkdir(exist_ok=True)
results=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-webgl'])
 for width,height,touch,theme,motion in [(390,844,True,'dark','no-preference'),(320,700,True,'light','reduce'),(1440,1000,False,'dark','no-preference')]:
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
   if '/settings' in u:
    pending_settings.append(r);return
   if '/presence' in u:data={'mode':'available','updatedAt':'2026-10-26T06:00:00Z'}
   r.fulfill(json=data)
  page.route('http://fixture.invalid/**',respond)
  page.goto('http://localhost:5174/qaapp1301.html');page.get_by_role('textbox',name='Message Jarvis').wait_for();page.wait_for_timeout(1000)
  page.wait_for_timeout(400)
  if page.get_by_role('button',name='Show conversation',exact=True).count():page.get_by_role('button',name='Show conversation',exact=True).click()
  suffix=f'{width}-{theme}'
  surfaces=['.app-topbar','.conversation-input']+(['.mobile-bottom-nav','.mobile-menu-sheet'] if touch else [])
  trigger=page.get_by_role('button',name='Menu',exact=True) if touch else page.locator('.composer-more .more-menu-trigger')
  if not touch:surfaces+=['.more-menu-list']
  press=lambda locator: locator.tap() if touch else locator.click()
  snapshots=[]
  for cycle in range(3):
   press(trigger)
   # Sample actual animation frames: material alpha/blur must not change during entrance.
   frames=page.evaluate("""async selectors=>{
    const samples=[];const start=performance.now();
    while(performance.now()-start<700){
     samples.push(selectors.map(selector=>{const e=document.querySelector(selector),s=getComputedStyle(e);return {selector,background:s.backgroundColor,blur:s.backdropFilter,opacity:s.opacity,wrapperOpacity:e.parentElement.classList.contains('mobile-menu')?getComputedStyle(e.parentElement).opacity:'1'};}));
     await new Promise(requestAnimationFrame);
    }return samples;
   }""",surfaces)
   for frame in frames:
    for item in frame:
     assert item['opacity']=='1' and item['wrapperOpacity']=='1',item
     assert item['blur']=='blur(10px)',item
     assert '/ 0.36)' in item['background'] or '/ 0.4)' in item['background'],item
   assert all(frame==frames[-1] for frame in frames),frames
   if cycle==0:
    assert pending_settings
    for request in pending_settings:request.fulfill(json={'settings':{'appearance':{'theme':theme}}})
   page.wait_for_timeout(2500)
   snapshots.append(frames[-1])
   if cycle==2:page.screenshot(path=str(out/f'settled-menu-{suffix}.png'))
   press(trigger);assert trigger.get_attribute('aria-expanded')=='false'
  press(trigger);page.wait_for_timeout(600)
  # Pixel probe: changing only the synthetic scene beneath the real App must
  # change pixels through every named surface, including header and bottom dock.
  points={}
  for selector in surfaces:
   r=page.locator(selector).bounding_box()
   points[selector]=(round(r['x']+r['width']*.5),round(r['y']+r['height']*.3))
  colors=[]
  for color in ['rgb(30,90,130)','rgb(130,70,30)']:
   page.locator('.jarvis-stage').evaluate('(e,color)=>e.style.background=color',color)
   page.wait_for_timeout(120)
   shot=Image.open(io.BytesIO(page.screenshot())).convert('RGB')
   colors.append({selector:shot.getpixel(point) for selector,point in points.items()})
  deltas={selector:sum(abs(a-b) for a,b in zip(colors[0][selector],colors[1][selector])) for selector in surfaces}
  assert all(delta>20 for delta in deltas.values()),deltas
  page.locator('.jarvis-stage').evaluate("e=>e.style.removeProperty('background')")
  if touch:
   # Current route, expanded Menu and pressed Workspaces all retain plain boxes.
   for label in ['Menu','Chat']:
    button=page.locator('.mobile-bottom-nav').get_by_role('button' if label=='Menu' else 'link',name=label,exact=True)
    state=button.evaluate("e=>{const s=getComputedStyle(e);return {bg:s.backgroundColor,border:s.borderWidth,shadow:s.boxShadow,text:s.color,icon:getComputedStyle(e.querySelector('svg')).color}}")
    assert state['bg']=='rgba(0, 0, 0, 0)' and state['border']=='0px' and state['shadow']=='none',state
    assert state['icon']!=state['text'],state
   press(trigger)
   workspaces=page.get_by_role('button',name='Workspaces',exact=True);press(workspaces)
   assert workspaces.get_attribute('aria-pressed')=='true'
   assert workspaces.evaluate("e=>getComputedStyle(e).backgroundColor")=='rgba(0, 0, 0, 0)'
   press(workspaces)
   page.keyboard.press('Tab');trigger.focus()
   assert trigger.evaluate("e=>getComputedStyle(e).outlineStyle")=='solid'
   assert page.locator('.mobile-bottom-nav').is_visible()
   assert page.locator('.app-shell').get_attribute('data-keyboard-open')!='true'
  else:press(trigger)
  # Composer plus popup also uses the same settled material at every size.
  plus=page.locator('.composer-more .more-menu-trigger');press(plus);page.wait_for_timeout(2800)
  plus_style=page.locator('.more-menu-list').evaluate("e=>({background:getComputedStyle(e).backgroundColor,blur:getComputedStyle(e).backdropFilter,opacity:getComputedStyle(e).opacity})")
  assert plus_style['blur']=='blur(10px)' and plus_style['opacity']=='1'
  page.screenshot(path=str(out/f'settled-plus-{suffix}.png'));press(plus)
  assert not errors,errors
  results.append({'viewport':[width,height],'theme':theme,'motion':motion,'delayedSettings':True,'cycles':snapshots,'scenePixelDeltas':deltas,'plus':plus_style,'errors':errors})
  page.close()
 b.close()
(out/'measurements.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
