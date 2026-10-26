import json, io
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright
out='/workspace/jarvis/docs/ui/screenshots/mobile-corrections-1293/'
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=b.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
 page.route('**/src/useSignIn.ts',lambda r:r.fulfill(content_type='application/javascript',body="const token=async()=> 'synthetic'; const session={state:'signed-in',profile:{name:'Synthetic QA'},message:'',getAccessToken:token,getEntraAccessToken:token,hasOwnerSession:true,client:{getActiveAccount:()=>({homeAccountId:'synthetic'}),getAllAccounts:()=>[]},signIn:async()=>{},switchAccount:async()=>{},signOut:async()=>{},signOutAllDevices:async()=>{}}; export function useSignIn(){return session;}"))
 pending=[]
 urls=[];errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def respond(r):
  u=r.request.url;urls.append(u)
  if u.endswith('/conversation/attachments'):
   pending.append(r);return
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
 page.get_by_role('textbox',name='Message Jarvis').fill('Please review this synthetic image with my draft.')
 image=Image.new('RGB',(96,64),'#103746');draw=ImageDraw.Draw(image);draw.rectangle((8,8,40,55),fill='#54cbd6');draw.ellipse((48,16,88,56),fill='#f3be63');buf=io.BytesIO();image.save(buf,format='PNG');raw=buf.getvalue()
 page.get_by_test_id('attachment-input').set_input_files({'name':'synthetic-thumbnail.png','mimeType':'image/png','buffer':raw})
 thumb=page.get_by_role('img',name='Preview of synthetic-thumbnail.png');thumb.wait_for()
 thumb.evaluate('(img)=>img.decode()')
 assert thumb.evaluate('(img)=>img.complete && img.naturalWidth===96 && img.naturalHeight===64')
 page.get_by_role('progressbar',name='Uploading synthetic-thumbnail.png').wait_for()
 page.screenshot(path=out+'app-attachment-uploading-390.png')
 for _ in range(30):
  if pending:break
  page.wait_for_timeout(100)
 assert pending
 pending.pop(0).fulfill(status=201,json={'id':'0b0f4a7e-3c1d-4f6a-8b2e-1a2b3c4d5e6f','name':'synthetic-thumbnail.png','contentType':'image/png','size':len(raw),'status':'ready'})
 page.locator('.attachment-chip[data-status="ready"]').wait_for()
 page.screenshot(path=out+'app-attachment-ready-390.png')
 geometry=page.evaluate("""()=>{const rect=s=>document.querySelector(s).getBoundingClientRect().toJSON();return {chip:rect('.attachment-chip'),input:rect('textarea'),more:rect('.composer-more'),dictate:rect('.composer-dictate'),send:rect('.composer-send'),composer:rect('.conversation-input'),inside:document.querySelector('.attachment-chip').closest('form')?.id,decoded:document.querySelector('.attachment-thumb').naturalWidth,overflow:document.documentElement.scrollWidth}}""")
 assert geometry['inside']=='conversation-composer' and geometry['decoded']==96
 assert geometry['chip']['bottom']<=geometry['input']['top']
 assert geometry['input']['bottom']<=geometry['more']['top']
 assert geometry['input']['width']>=350
 assert geometry['more']['y']==geometry['dictate']['y']==geometry['send']['y']
 page.set_viewport_size({'width':320,'height':700});page.wait_for_timeout(400);page.screenshot(path=out+'app-attachment-ready-320.png')
 page.get_by_test_id('attachment-input').set_input_files({'name':'failed-thumbnail.png','mimeType':'image/png','buffer':raw})
 for _ in range(30):
  if pending:break
  page.wait_for_timeout(100)
 assert pending
 pending.pop(0).fulfill(status=503,json={})
 page.get_by_role('alert').filter(has_text='failed-thumbnail.png').wait_for()
 assert page.get_by_role('alert').filter(has_text='failed-thumbnail.png').evaluate("e=>e.closest('.conversation-input')===null")
 page.screenshot(path=out+'app-attachment-error-320.png')
 print(json.dumps({'geometry':geometry,'pageErrors':errors,'uploadingReadyAndErrorVerified':True}))
 b.close()
