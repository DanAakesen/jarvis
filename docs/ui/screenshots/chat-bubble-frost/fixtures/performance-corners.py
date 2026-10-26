"""Actual App, synthetic dense history; no live service or media permissions."""
import json
import io
from PIL import Image, ImageStat, ImageChops
from pathlib import Path
from playwright.sync_api import sync_playwright
out = Path(__file__).resolve().parents[1]
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox', '--disable-webgl'])
    for width, height, touch in [(390,844,True), (1440,1000,False)]:
      for theme in ['dark','light']:
        page = browser.new_page(viewport={'width':width,'height':height}, is_mobile=touch, has_touch=touch)
        errors=[]
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('**/src/useSignIn.ts', lambda r: r.fulfill(content_type='application/javascript', body="const token=async()=> 'synthetic'; const session={state:'signed-in',profile:{name:'Synthetic QA'},message:'',getAccessToken:token,getEntraAccessToken:token,hasOwnerSession:true,client:{getActiveAccount:()=>({homeAccountId:'synthetic'}),getAllAccounts:()=>[]},signIn:async()=>{},switchAccount:async()=>{},signOut:async()=>{},signOutAllDevices:async()=>{}}; export function useSignIn(){return session;}"))
        def respond(r):
            u = r.request.url
            message = {'id':'42','sessionId':'41','channel':'chat','language':'en','role':'jarvis','text':'Synthetic readability fixture.\n\n- First readable list item\n- Second **sharp text** item\n\n' + 'Dense background should be frosted behind this reply. ' * 20,'model':None,'voiceMinutes':None,'at':'2026-10-26T06:00:00.000Z','toolCalls':[]}
            data = {'messages':[dict(message,id='40',role='dan',text='Synthetic user message: keep both bubble surfaces readable.'), message], 'nextCursor':None} if '/conversation/history' in u else {}
            if '/workspaces' in u: data = {'items':[]}
            if '/workspace/pins' in u: data = {'pins':[]}
            if '/jobs' in u: data = {'jobs':[]}
            if '/settings' in u: data = {'settings':{'appearance':{'theme':'dark'}}}
            if '/presence' in u: data = {'mode':'available','updatedAt':'2026-10-26T06:00:00Z'}
            if '/conversation/attachments' in u and r.request.method == 'POST':
                r.fulfill(status=201,json={'id':'12345678-1234-4123-8123-123456789012','name':'synthetic.txt','size':9,'contentType':'text/plain','status':'ready'}); return
            r.fulfill(json=data)
        page.route('http://fixture.invalid/**', respond)
        page.add_init_script("""const Native=ResizeObserver; window.qaObservers=[]; window.ResizeObserver=class extends Native { constructor(cb){super(cb);this.nodes=new Set();this.callbackName=cb.name;window.qaObservers.push(this)} observe(n,o){this.nodes.add(n);super.observe(n,o)} unobserve(n){this.nodes.delete(n);super.unobserve(n)} disconnect(){this.nodes.clear();super.disconnect()} };""")
        page.goto('http://localhost:5174/qaapp1301.html')

        page.get_by_role('textbox',name='Message Jarvis').wait_for()
        page.wait_for_timeout(1000)
        page.evaluate("theme => document.documentElement.dataset.theme = theme", theme)
        show=page.get_by_role('button',name='Show conversation',exact=True)
        if show.count() and show.is_visible(): show.click()
        page.locator('.conversation-message').first.wait_for()
        transcript=page.locator('.conversation-window-host > .conversation-transcript')
        page.add_style_tag(content='.jarvis-stage { background: repeating-linear-gradient(0deg,#ffb800 0 16px,#1257bf 16px 32px) !important; } .jarvis-stage::after,.jarvis-stage > * { visibility:hidden; }')
        header_clip={'x':width/2,'y':10,'width':20,'height':30}
        header_frost=Image.open(io.BytesIO(page.screenshot(clip=header_clip))).convert('RGB')
        no_header_blur=page.add_style_tag(content='.app-shell .app-topbar { backdrop-filter:none !important; -webkit-backdrop-filter:none !important; }')
        header_plain=Image.open(io.BytesIO(page.screenshot(clip=header_clip))).convert('RGB')
        header_delta=sum(ImageStat.Stat(ImageChops.difference(header_frost,header_plain)).mean)/3
        assert header_delta>1,header_delta
        no_header_blur.evaluate('e=>e.remove()')
        assert page.locator('.app-topbar').evaluate("e=>getComputedStyle(e).backdropFilter")=='blur(16px)'
        composer=page.locator('.conversation-input')
        corners=composer.evaluate("e=>{const a=getComputedStyle(e), b=getComputedStyle(e,'::before'),c=getComputedStyle(e,'::after');return [a,b,c].map(s=>[s.borderTopLeftRadius,s.borderTopRightRadius])}")
        assert all(c[0]==c[1] and (float(c[0].replace('px',''))>0 if touch else c[0]=='0px') for c in corners), corners
        if touch:
            for cycle in range(3):
                page.get_by_role('button',name='Hide conversation',exact=True).click()
                page.wait_for_timeout(250)
                assert composer.evaluate("e=>getComputedStyle(e).borderTopLeftRadius===getComputedStyle(e).borderBottomLeftRadius")
                if cycle==0: page.screenshot(path=str(out/f'{width}-{theme}-hidden-composer.png'))
                page.get_by_role('button',name='Show conversation',exact=True).click()
                page.wait_for_timeout(250)
                assert composer.evaluate("e=>getComputedStyle(e).borderTopLeftRadius===getComputedStyle(e).borderBottomLeftRadius")
        composer.get_by_role('textbox').focus()
        page.screenshot(path=str(out/f'{width}-{theme}-rounded-composer.png'))
        perf=transcript.evaluate("""async e=>{
          const original=e.querySelector('.conversation-messages'), replacement=original.cloneNode(true);
          original.replaceWith(replacement);
          const sample=replacement.querySelector('.conversation-message');
          for(let i=0;i<300;i++){const b=sample.cloneNode(true);b.style.animation='none';replacement.append(b)}
          await new Promise(r=>setTimeout(r,1000));
          const observers=window.qaObservers.filter(o=>o.callbackName==='measure'&&o.nodes.has(e));
          const detached=observers.flatMap(o=>[...o.nodes]).filter(n=>!n.isConnected).length;
          const native=Element.prototype.getBoundingClientRect;let reads=0;
          Element.prototype.getBoundingClientRect=function(){if(this.matches('.conversation-message'))reads++;return native.call(this)};
          const gaps=[];let prior=performance.now();
          for(let i=0;i<40;i++){e.scrollTop=(i/40)*(e.scrollHeight-e.clientHeight);await new Promise(r=>requestAnimationFrame(r));let now=performance.now();gaps.push(now-prior);prior=now}
          Element.prototype.getBoundingClientRect=native;
          gaps.sort((a,b)=>a-b);
          return {bubbles:replacement.querySelectorAll('.conversation-message').length,bubbleRectReads:reads,p50FrameMs:gaps[20],p95FrameMs:gaps[38],detachedObservedChildren:detached,fadeObservers:observers.length};
        }""")
        assert perf['detachedObservedChildren']==0,perf
        if touch: assert perf['bubbleRectReads']==0 and perf['fadeObservers']==0,perf
        assert not errors,errors
        results.append({'width':width,'theme':theme,'mobileToggleCycles':3 if touch else None,'corners':corners,'headerBlur':'16px','headerPixelDelta':header_delta,'scrollProbe':perf})
        page.close()
    browser.close()
(out/'performance-and-corners.json').write_text(json.dumps(results,indent=2)+'\n')
