import json
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path('/workspace/jarvis/docs/ui/screenshots/1317')
results=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-webgl'])
 for width,height,touch in [(390,844,True),(320,700,True),(1440,1000,False)]:
  page=b.new_page(viewport={'width':width,'height':height},is_mobile=touch,has_touch=touch)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('**/src/useSignIn.ts',lambda r:r.fulfill(content_type='application/javascript',body="const token=async()=> 'synthetic'; const session={state:'signed-in',profile:{name:'Synthetic QA'},message:'',getAccessToken:token,getEntraAccessToken:token,hasOwnerSession:true,client:{getActiveAccount:()=>({homeAccountId:'synthetic'}),getAllAccounts:()=>[]},signIn:async()=>{},switchAccount:async()=>{},signOut:async()=>{},signOutAllDevices:async()=>{}}; export function useSignIn(){return session;}"))
  frames=[]
  observations=[]
  exhausted=False
  stall=False
  held=[]
  def respond(r):
   u=r.request.url
   msg={'id':'42','sessionId':'41','channel':'voice','language':'en','role':'jarvis','text':'Synthetic conversation for camera and menu verification. Move the preview while keeping the conversation visible.','model':None,'voiceMinutes':None,'at':'2026-10-26T06:00:00.000Z','toolCalls':[]}
   data={'messages':[msg]+observations,'nextCursor':None} if '/conversation/history' in u else {}
   if '/workspaces' in u:data={'items':[]}
   if '/workspace/pins' in u:data={'pins':[]}
   if '/jobs' in u:data={'jobs':[]}
   if '/settings' in u:data={'settings':{'appearance':{'theme':'dark'}}}
   if '/presence' in u:data={'mode':'available','updatedAt':'2026-10-26T06:00:00Z'}
   if '/conversation/sessions' in u:data={'id':'43','channel':'chat','language':'en'}
   if '/conversation/turns/active' in u:data={'turns':[]}
   if '/vision/watch' in u:
    if r.request.method=='POST' and stall:held.append(r);return
    if r.request.method=='POST' and exhausted:r.fulfill(status=429,json={'error':'The daily vision budget is exhausted.'});return
    if r.request.method=='POST':
     frames.append(r.request.post_data_json)
     observation={**msg,'id':str(100+len(frames)),'text':f'Synthetic ongoing observation {len(frames)}.'}
     observations.append(observation)
     data={'summary':'Synthetic scene','speak':observation['text'],'budget':{'usedUsd':0.01,'limitUsd':1}}
    else:r.fulfill(status=204);return
   r.fulfill(json=data)
  page.route('http://fixture.invalid/**',respond)
  page.add_init_script("""window.fixtureAcks={};window.fixturePermission='granted';
  navigator.permissions.query=async()=>({state:window.fixturePermission});
  const originalFetch=window.fetch.bind(window);
  window.fetch=async(input,init)=>{
    const url=input instanceof Request?input.url:String(input);
    if(url.endsWith('/now/events')) return new Response(new ReadableStream({start(controller){
      const emit=(event,data)=>controller.enqueue(new TextEncoder().encode('event: '+event+'\\ndata: '+JSON.stringify(data)+'\\n\\n'));
      window.fixtureCommand=command=>emit('workspace-command',{command,expiresAt:Date.now()+10000});
      emit('workspace-ready',{sessionId:'12345678-1234-1234-1234-123456789012'});
    }}),{headers:{'Content-Type':'text/event-stream'}});
    const response=await originalFetch(input,init);
    if(url.includes('/now/workspace/commands/')&&url.endsWith('/ack')&&response.ok){
      window.fixtureAcks[url.split('/').at(-2)]=JSON.parse(init.body);
    }
    return response;
  };""")
  page.add_init_script("""navigator.mediaDevices.getUserMedia=async (constraints)=>{
    const canvas=document.createElement('canvas');canvas.width=360;canvas.height=640;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#366f7e';ctx.fillRect(0,0,360,640);
    ctx.fillStyle='#dcab68';ctx.fillRect(30,160,300,220);ctx.fillStyle='#fff';ctx.font='24px sans-serif';ctx.fillText('SYNTHETIC CAMERA',40,440);
    const stream=canvas.captureStream(10);const track=stream.getVideoTracks()[0];
    track.getSettings=()=>({width:360,height:640,facingMode:constraints.video.facingMode?.exact||constraints.video.facingMode?.ideal||'user'});
    return stream;
  };""")
  page.goto('http://localhost:5173/qaapp1296.html');page.get_by_role('textbox',name='Message Jarvis').wait_for();page.wait_for_timeout(1000)
  page.evaluate("document.documentElement.dataset.theme='dark'")
  if page.get_by_role('button',name='Show conversation',exact=True).count():page.get_by_role('button',name='Show conversation',exact=True).click()
  page.get_by_text('Synthetic conversation for camera and menu verification.',exact=False).first.wait_for()
  assert page.get_by_text('Jarvis could not load conversation history.',exact=False).count()==0
  trigger=page.locator('.composer-more .more-menu-trigger'); trigger.wait_for()
  press=lambda locator: locator.tap() if touch else locator.click()
  for i in range(3):
   press(trigger);assert trigger.get_attribute('aria-expanded')=='true'
   press(trigger);assert trigger.get_attribute('aria-expanded')=='false'
  press(trigger);page.wait_for_timeout(450);page.screenshot(path=str(out/f'plus-{width}.png'))
  page.get_by_role('menuitem',name='Enable video',exact=True).click()
  picture=page.locator('.camera-preview-picture');picture.wait_for();page.wait_for_timeout(600)
  page.wait_for_timeout(5800)
  assert len(frames)>=3, len(frames)
  for observation in observations[:3]:
   page.get_by_text(observation['text'],exact=True).wait_for()
   assert page.get_by_text(observation['text'],exact=True).count()==1
  stall=True
  page.locator('.composer-feedback').get_by_text('Camera updates delayed; retrying…',exact=True).wait_for(timeout=25000)
  assert len(held)==1
  stall=False
  frames.append(held[0].request.post_data_json)
  held.pop().fulfill(json={'summary':'Synthetic scene','speak':None,'budget':{'usedUsd':0.02,'limitUsd':1}})
  page.locator('.composer-feedback').get_by_text('Receiving camera updates',exact=False).wait_for()
  press(trigger)
  assert page.get_by_role('menuitem',name='Watch the camera').count()==0
  assert page.locator('.composer-feedback').get_by_text('Receiving camera updates',exact=False).is_visible()
  page.screenshot(path=str(out/f'camera-{width}.png'))
  press(trigger)
  press(page.get_by_role('button',name='Close camera preview',exact=True))
  count=len(frames);page.wait_for_timeout(3000)
  assert len(frames)==count
  def command(value):
   page.evaluate('command=>window.fixtureCommand(command)',value)
   page.wait_for_function('id=>window.fixtureAcks[id]!==undefined',arg=value['commandId'])
   return page.evaluate('id=>window.fixtureAcks[id]',value['commandId'])
  page.wait_for_function('typeof window.fixtureCommand==="function"')
  assert command({'commandId':'jarvis-video-on','operation':'show','viewId':'camera-preview'})['applied']
  page.locator('.composer-feedback').get_by_text('Receiving camera updates',exact=False).wait_for()
  assert len(frames)>count
  assert command({'commandId':'jarvis-video-off','operation':'session','action':'camera','value':'off'})['applied']
  count=len(frames);page.wait_for_timeout(3000);assert len(frames)==count
  page.evaluate("window.fixturePermission='prompt'")
  refused=command({'commandId':'jarvis-video-denied','operation':'show','viewId':'camera-preview'})
  assert not refused['applied']
  assert 'allowed' in refused['reason']
  assert len(frames)==count
  page.evaluate("window.fixturePermission='granted'")
  exhausted=True
  press(trigger);page.get_by_role('menuitem',name='Enable video',exact=True).click()
  page.get_by_text('The daily vision budget is exhausted.',exact=False).first.wait_for()
  assert picture.count()==0
  page.evaluate("() => { navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('denied','NotAllowedError')}; }")
  press(trigger);page.get_by_role('menuitem',name='Enable video',exact=True).click()
  page.get_by_text('Camera access was not started. Allow camera access and try again.',exact=False).first.wait_for()
  assert page.locator('.camera-preview').get_attribute('data-inactive')=='true'
  assert page.locator('.camera-preview video').evaluate('v=>v.srcObject===null')
  assert len(frames)==count
  assert not errors, errors
  results.append({'width':width,'height':height,'touch':touch,'framesDuringSilence':count,'visibleObservationsDuringSilence':len(observations[:3]),'framesAfterStop':len(frames)-count,'errors':errors})
  page.close()
 b.close()
(out/'measurements.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
