import json
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path(__file__).resolve().parent
results=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-webgl'])
 for width,height,touch,theme,motion in [(390,844,True,'dark','no-preference'),(320,700,True,'light','reduce'),(1440,1000,False,'dark','no-preference')]:
  page=b.new_page(viewport={'width':width,'height':height},is_mobile=touch,has_touch=touch,color_scheme=theme,reduced_motion=motion)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('**/src/useSignIn.ts',lambda r:r.fulfill(content_type='application/javascript',body="const token=async()=> 'synthetic'; const session={state:'signed-in',profile:{name:'Synthetic QA'},message:'',getAccessToken:token,getEntraAccessToken:token,hasOwnerSession:true,client:{getActiveAccount:()=>({homeAccountId:'synthetic'}),getAllAccounts:()=>[]},signIn:async()=>{},switchAccount:async()=>{},signOut:async()=>{},signOutAllDevices:async()=>{}}; export function useSignIn(){return session;}"))
  def respond(r):
   url=r.request.url
   data={'messages':[],'nextCursor':None} if '/conversation/history' in url else {}
   if '/workspaces' in url:data={'items':[]}
   if '/workspace/pins' in url:data={'pins':[]}
   if '/jobs' in url:data={'jobs':[]}
   if '/settings' in url:data={'settings':{'appearance':{'theme':theme}}}
   r.fulfill(json=data)
  page.route('http://fixture.invalid/**',respond)
  page.goto('http://localhost:5174/qaapp1301.html')
  box=page.get_by_role('textbox',name='Message Jarvis');box.wait_for()
  if not touch:
   assert not page.locator('.composer-dictate').is_visible()
   page.screenshot(path=str(out/'desktop-1440.png'))
   results.append({'width':width,'result':'unchanged desktop composer inspected; Dictate is phone-only'})
   page.close();continue
  box.fill('Remember')
  press=lambda locator: locator.tap() if touch else locator.click()
  press(page.get_by_role('button',name='Dictate',exact=True))
  emit=lambda words,final:page.evaluate("([words,final])=>fixtureRecognition.current.onresult({resultIndex:0,results:[{0:{transcript:words},isFinal:final}]})",[words,final])
  emit('the lunch',False);assert box.input_value()=='Remember the lunch'
  emit('the launch',False);assert box.input_value()=='Remember the launch'
  emit('the launch',True);emit('the launch',True);assert box.input_value()=='Remember the launch'
  page.evaluate('window.oldRecognition=fixtureRecognition.current;oldRecognition.onend()')
  assert page.evaluate('fixtureRecognition.current!==oldRecognition')
  assert page.get_by_role('button',name='Stop dictation',exact=True).count()==1
  page.evaluate("fixtureRecognition.current.onerror({error:'no-speech'});fixtureRecognition.current.onend();oldRecognition.onend()")
  emit('tomorrow',False);assert box.input_value()=='Remember the launch tomorrow'
  page.screenshot(path=str(out/f'dictating-{width}.png'))
  press(page.get_by_role('button',name='Stop dictation',exact=True))
  for cycle in range(3):
   press(page.get_by_role('button',name='Dictate',exact=True));emit('again',True)
   press(page.get_by_role('button',name='Stop dictation',exact=True))
  assert box.input_value()=='Remember the launch tomorrow again again again'
  press(page.get_by_role('button',name='Dictate',exact=True))
  page.evaluate("fixtureRecognition.current.onresult({resultIndex:0,results:[{0:{transcript:'hello'},isFinal:true},{0:{transcript:'guess'},isFinal:false}]})")
  box.fill('My correction')
  page.evaluate("fixtureRecognition.current.onresult({resultIndex:1,results:[{0:{transcript:'hello'},isFinal:true}]})")
  assert box.input_value()=='My correction'
  page.evaluate("fixtureRecognition.current.onresult({resultIndex:1,results:[{0:{transcript:'hello'},isFinal:true},{0:{transcript:'new words'},isFinal:false}]})")
  assert box.input_value()=='My correction new words'
  page.evaluate("fixtureRecognition.current.onresult({resultIndex:1,results:[{0:{transcript:'hello'},isFinal:true},{0:{transcript:'new wording'},isFinal:true}]})")
  assert box.input_value()=='My correction new wording'
  page.evaluate("fixtureRecognition.current.onerror({error:'not-allowed'})")
  assert 'Microphone permission was denied' in page.get_by_role('alert').inner_text()
  assert page.get_by_role('button',name='Dictate',exact=True).count()==1
  assert not errors,errors
  results.append({'width':width,'touch':touch,'theme':theme,'motion':motion,'result':'passed','pageErrors':errors})
  page.close()
 b.close()
(out/'results.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results))
