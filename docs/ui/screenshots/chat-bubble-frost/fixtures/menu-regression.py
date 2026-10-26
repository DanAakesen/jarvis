"""Actual App, synthetic dense history; no live service or media permissions."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
out = Path(__file__).resolve().parents[1] / 'menu-regression'
out.mkdir(exist_ok=True)
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
            message = {'id':'42','sessionId':'41','channel':'chat','language':'en','role':'jarvis','text':'Synthetic readability fixture. Dense conversation text should remain behind the menu. Attach a document, discuss a plan, or review the next steps. ' * 60,'model':None,'voiceMinutes':None,'at':'2026-10-26T06:00:00.000Z','toolCalls':[]}
            data = {'messages':[message], 'nextCursor':None} if '/conversation/history' in u else {}
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
        page.locator('.conversation-message').wait_for()
        plus=page.locator('.composer-more .more-menu-trigger')
        menu=page.locator('.composer-more .more-menu-list')
        for _ in range(3):
            plus.click(); page.wait_for_timeout(300)
            assert menu.is_visible()
            plus.click(); assert not menu.is_visible()
        plus.click(); page.wait_for_timeout(350)
        page.set_viewport_size({'width':width,'height':height-80})
        page.wait_for_function("() => { const m=document.querySelector('.composer-more .more-menu-list').getBoundingClientRect(), p=document.querySelector('.composer-more .more-menu-trigger').getBoundingClientRect(); return Math.abs(m.y+m.height+10-p.y)<2; }")
        assert abs(menu.bounding_box()['y']+menu.bounding_box()['height']+10-plus.bounding_box()['y']) < 2
        page.set_viewport_size({'width':width,'height':height})
        page.wait_for_timeout(150)
        items=menu.get_by_role('menuitem')
        labels=items.all_text_contents()
        assert labels[0]=='Language' and labels[-2:]==['Voice','Attach file or photo'], labels
        positions=[item.bounding_box()['y'] for item in items.all()]
        assert positions==sorted(positions)
        assert menu.evaluate("e=>getComputedStyle(e).backdropFilter")=='blur(24px)'
        assert menu.evaluate("e=>e.matches(':popover-open')")
        assert menu.evaluate("e=>getComputedStyle(e).backgroundColor===getComputedStyle(document.querySelector('.conversation-input')).backgroundColor")
        assert page.locator('.conversation-input').evaluate("e=>getComputedStyle(e).backdropFilter")=='blur(10px)'
        assert menu.evaluate("e=>[...e.querySelectorAll('button')].every(b=>{const r=b.getBoundingClientRect(); return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})")
        page.screenshot(path=str(out/f'{width}-{theme}-menu.png'))
        items.first.press('End'); assert items.last.evaluate('e=>e===document.activeElement')
        items.last.press('ArrowUp'); assert items.nth(items.count()-2).evaluate('e=>e===document.activeElement')
        items.nth(items.count()-2).press('Home'); items.first.press('ArrowRight')
        flyout=page.get_by_role('menu',name='Language',exact=True)
        assert flyout.is_visible()
        assert flyout.evaluate("e=>e.matches(':popover-open')")
        page.screenshot(path=str(out/f'{width}-{theme}-language.png'))
        plus.click(); assert not menu.is_visible() and not flyout.is_visible()
        plus.click(); items.first.press('ArrowRight')
        page.keyboard.press('Escape'); page.keyboard.press('Escape')
        assert plus.evaluate('e=>e===document.activeElement')
        plus.click()
        with page.expect_file_chooser(): page.get_by_role('menuitem',name='Attach file or photo',exact=True).click()
        anchor=page.get_by_test_id('attachment-input')
        assert anchor.evaluate("e=>{const a=e.getBoundingClientRect(),b=e.parentElement.querySelector('button').getBoundingClientRect(); return ['x','y','width','height'].every(k=>Math.abs(a[k]-b[k])<1)}")
        anchor.dispatch_event('cancel'); assert menu.is_visible()
        plus.click()
        page.emulate_media(reduced_motion='reduce')
        plus.click(); assert menu.is_visible(); page.keyboard.press('Escape')
        assert not errors, errors
        results.append({'width':width,'theme':theme,'order':labels,'blur':'24px','composerBlur':'10px','nativeTopLayer':True,'chromeFillPreserved':True,'viewportAnchor':True,'keyboard':True,'toggleCycles':3,'nativePickerAnchor':True,'reducedMotion':True,'pageErrors':errors})
        page.close()
    browser.close()
(out/'measurements.json').write_text(json.dumps(results,indent=2)+'\n')
