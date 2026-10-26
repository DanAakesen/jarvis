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
      for theme in ['dark', 'light']:
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
        page.goto('http://localhost:5174/qaapp1301.html')

        page.get_by_role('textbox',name='Message Jarvis').wait_for()
        page.wait_for_timeout(1000)
        page.evaluate("theme => document.documentElement.dataset.theme = theme", theme)
        show=page.get_by_role('button',name='Show conversation',exact=True)
        if show.count() and show.is_visible(): show.click()
        page.locator('.conversation-message').first.wait_for()
        page.add_style_tag(content="""
          .jarvis-stage { background-image: repeating-linear-gradient(0deg, #ffb800 0 16px, #1257bf 16px 32px) !important; background-size: 64px 64px !important; animation: qa-pan 2s linear infinite !important; }
          .jarvis-stage::after, .jarvis-stage > * { visibility: hidden; }
          @keyframes qa-pan { to { background-position: 48px 24px; } }
        """)
        page.wait_for_timeout(350)
        transcript=page.locator('.conversation-window-host > .conversation-transcript')
        transcript.evaluate('e=>e.scrollTop=e.scrollHeight')
        bubble=page.locator('.conversation-message[data-speaker="jarvis"]').last
        ancestors=bubble.evaluate("e=>{let a=[];for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n);a.push({tag:n.className,blur:s.backdropFilter,mask:s.maskImage,opacity:s.opacity,filter:s.filter})}return a}")
        assert bubble.evaluate("e=>getComputedStyle(e).backdropFilter")=='blur(24px)'
        assert all(a['blur']=='none' and a['mask']=='none' and a['opacity']=='1' and a['filter']=='none' for a in ancestors[1:]), ancestors
        assert bubble.locator('ul li').count()==2
        assert page.locator('[popover].conversation-message').count()==0
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.evaluate('document.fonts.ready')
        page.wait_for_timeout(700)
        geometry=page.locator('.conversation-message, .conversation-input').evaluate_all("es=>es.map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})")
        # Observe changing scene frames with live animation, then freeze only the synthetic scene for A/B pixels.
        frame1=page.screenshot()
        page.wait_for_timeout(160)
        frame2=page.screenshot()
        assert frame1!=frame2
        page.add_style_tag(content='.jarvis-stage { animation: none !important; }')
        page.screenshot(path=str(out/f'{width}-{theme}-frost.png'))
        # Hide only text during numeric sampling so glyph edges cannot contaminate background variation.
        # The saved full screenshots retain all text.
        r=bubble.bounding_box(); t=transcript.bounding_box()
        clip={'x':r['x']+20,'y':max(r['y']+20,t['y']+75),'width':r['width']-40,'height':min(90,r['height']-40,t['height']-100)}
        text_mask=page.add_style_tag(content='.conversation-message > * { visibility: hidden !important; }')
        frosted=Image.open(io.BytesIO(page.screenshot(clip=clip))).convert('RGB')
        override=page.add_style_tag(content='.conversation-message[data-speaker] { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }')
        plain=Image.open(io.BytesIO(page.screenshot(clip=clip))).convert('RGB')
        text_mask.evaluate('e=>e.remove()')
        page.screenshot(path=str(out/f'{width}-{theme}-blur-disabled.png'))
        after=page.locator('.conversation-message, .conversation-input').evaluate_all("es=>es.map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})")
        assert geometry==after, (geometry,after)
        delta=sum(ImageStat.Stat(ImageChops.difference(frosted,plain)).mean)/3
        def variation(im):
            return sum(ImageStat.Stat(im).stddev)/3
        sharp=variation(plain); soft=variation(frosted)
        assert delta>1, (width,theme,delta)
        assert soft<sharp*.7, (width,theme,soft,sharp)
        override.evaluate('e=>e.remove()')
        # Translucency: changing the synthetic scene must still change bubble padding pixels.
        color=page.add_style_tag(content='.jarvis-stage { background: #ff3030 !important; }')
        red=Image.open(io.BytesIO(page.screenshot(clip=clip))).convert('RGB')
        color.evaluate("e=>e.textContent='.jarvis-stage { background: #3030ff !important; }'")
        blue=Image.open(io.BytesIO(page.screenshot(clip=clip))).convert('RGB')
        transmission=sum(ImageStat.Stat(ImageChops.difference(red,blue)).mean)/3
        # Desktop retains the existing dense window fill as well as the bubble fill.
        assert transmission>5, transmission
        color.evaluate('e=>e.remove()')
        transcript.evaluate('e=>e.scrollTop=0')
        assert transcript.evaluate('e=>e.scrollTop')==0
        page.screenshot(path=str(out/f'{width}-{theme}-history-top.png'))
        if not touch:
            # Compare relocated item masks with the original scrollport mask on a
            # uniform scene, isolating fade coverage from backdrop detail.
            uniform=page.add_style_tag(content='.jarvis-stage { background: #526777 !important; }')
            transcript.evaluate("e=>{const b=e.querySelector('[data-speaker=jarvis]');e.scrollTop+=b.getBoundingClientRect().top-e.getBoundingClientRect().top-20}")
            page.wait_for_timeout(150)
            box=transcript.bounding_box()
            fade_clip={'x':box['x']+2,'y':box['y'],'width':box['width']-4,'height':64}
            relocated=Image.open(io.BytesIO(page.screenshot(clip=fade_clip))).convert('RGB')
            page.screenshot(path=str(out/f'{width}-{theme}-scrolled-fade.png'))
            baseline=page.add_style_tag(content='.conversation-window-host > .conversation-transcript { mask-image: linear-gradient(to bottom, transparent 0, #000 64px); -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 64px); } .conversation-window-host > .conversation-transcript [data-transcript-fade] { mask-image: none; -webkit-mask-image: none; }')
            original=Image.open(io.BytesIO(page.screenshot(clip=fade_clip))).convert('RGB')
            page.screenshot(path=str(out/f'{width}-{theme}-baseline-fade.png'))
            fade_error=sum(ImageStat.Stat(ImageChops.difference(relocated,original)).mean)/3
            assert fade_error<2, fade_error
            baseline.evaluate('e=>e.remove()');uniform.evaluate('e=>e.remove()')
        transcript.evaluate('e=>e.scrollTop=e.scrollHeight')
        # Probe the actual mounted observer after the mutations produced by
        # history append/replacement; these probes contain only synthetic DOM.
        def aligned():
            return transcript.evaluate("e=>{const top=e.getBoundingClientRect().top;return [...e.querySelectorAll('.conversation-message')].every(b=>Math.abs(parseFloat(b.style.getPropertyValue('--transcript-fade-start'))-(top-b.getBoundingClientRect().top+16))<1)}")
        page.wait_for_timeout(150)
        assert aligned()
        page.set_viewport_size({'width':width,'height':height-80})
        page.wait_for_timeout(200)
        assert aligned()
        page.set_viewport_size({'width':width,'height':height})
        transcript.evaluate("e=>{const list=e.querySelector('.conversation-messages'), b=e.querySelector('.conversation-message').cloneNode(true);b.querySelector('p').textContent='Synthetic appended history';list.append(b)}")
        page.wait_for_timeout(150)
        assert aligned()
        transcript.evaluate("e=>{const b=e.querySelector('.conversation-message');b.querySelector('p').textContent='Synthetic refreshed history replacement '.repeat(8)}")
        page.wait_for_timeout(150)
        assert aligned()
        transcript.evaluate('e=>e.scrollTop=30')
        page.wait_for_timeout(150)
        assert aligned()
        page.emulate_media(reduced_motion='reduce')
        transcript.evaluate('e=>e.scrollTop=60')
        page.wait_for_timeout(150)
        assert aligned()
        field=page.get_by_role('textbox',name='Message Jarvis');field.fill('Synthetic draft stays editable'); assert field.input_value()=='Synthetic draft stays editable'
        plus=page.locator('.composer-more .more-menu-trigger');plus.click()
        menu=page.locator('.composer-more .more-menu-list');assert menu.is_visible() and menu.evaluate("e=>e.matches(':popover-open')")
        page.screenshot(path=str(out/f'{width}-{theme}-menu.png'))
        page.keyboard.press('Escape');assert not menu.is_visible()
        page.emulate_media(reduced_motion='reduce')
        assert bubble.evaluate("e=>getComputedStyle(e).filter")=='none'
        assert not errors, errors
        results.append({'width':width,'theme':theme,'ancestors':ancestors,'blurPixelDelta':delta,'unblurredVariation':sharp,'frostedVariation':soft,'transmissionDelta':transmission,'geometryUnchanged':True,'animatedFramesDiffer':True,'lists':2,'scrollAndComposer':True,'menuTopLayer':True,'maskAlignmentAfterScrollResizeAppendReplaceReducedMotion':True,'fadePixelError':fade_error if not touch else None,'errors':errors})
        page.close()
    browser.close()
(out/'measurements.json').write_text(json.dumps(results,indent=2)+'\n')
