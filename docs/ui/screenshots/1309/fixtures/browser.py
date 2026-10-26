"""Actual-App desktop composer regression; synthetic local data only.
Copy qaapp1301.{html,tsx} from ../1301/fixtures into apps/web; serve Vite on 5174.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

out = Path(__file__).resolve().parents[1]
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox', '--disable-webgl'])
    for width, height, touch in [(1440, 1000, False), (900, 800, False), (390, 844, True)]:
        page = browser.new_page(viewport={'width': width, 'height': height}, is_mobile=touch, has_touch=touch, reduced_motion='reduce' if touch else 'no-preference')
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('**/src/useSignIn.ts', lambda r: r.fulfill(content_type='application/javascript', body="const token=async()=> 'synthetic'; const session={state:'signed-in',profile:{name:'Synthetic QA'},message:'',getAccessToken:token,getEntraAccessToken:token,hasOwnerSession:true,client:{getActiveAccount:()=>({homeAccountId:'synthetic'}),getAllAccounts:()=>[]},signIn:async()=>{},switchAccount:async()=>{},signOut:async()=>{},signOutAllDevices:async()=>{}}; export function useSignIn(){return session;}"))
        def respond(r):
            u = r.request.url
            message = {'id':'42','sessionId':'41','channel':'chat','language':'en','role':'jarvis','text':'Synthetic desktop composer regression. Resize, maximise and restore this conversation.','model':None,'voiceMinutes':None,'at':'2026-10-26T06:00:00.000Z','toolCalls':[]}
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
        draft = page.get_by_role('textbox', name='Message Jarvis')
        draft.wait_for(); page.wait_for_timeout(1200)
        show = page.get_by_role('button',name='Show conversation',exact=True)
        if show.count() and show.is_visible(): show.click()
        page.locator('.conversation-message').wait_for()
        page.locator('.conversation-message').hover()
        assert page.locator('.message-metadata').bounding_box()['y'] >= page.locator('.conversation-message').bounding_box()['y']
        plus = page.locator('.composer-more .more-menu-trigger')
        states = []
        def inspect(state):
            page.wait_for_timeout(350)
            bounds = page.evaluate("""() => {
                const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
                return {window:rect('.workspace-window-conversation'),stack:rect('.conversation-input-stack'),composer:rect('.conversation-input'),draft:rect('.composer textarea'),plus:rect('.composer-more'),dictate:rect('.composer-dictate'),send:rect('.composer-send')};
            }""")
            if not touch:
                for key in ['composer','stack']:
                    assert abs(bounds[key]['x']-bounds['window']['x']) < 2, bounds
                    assert abs(bounds[key]['right']-bounds['window']['right']) < 2, bounds
                assert page.locator('.area-rail').is_visible()
            assert bounds['draft']['bottom'] <= bounds['plus']['y'] + 1, bounds
            assert bounds['draft']['width'] > bounds['composer']['width'] - 45, bounds
            for cycle in range(3):
                plus.click(); page.wait_for_timeout(300)
                menu = page.locator('.composer-more .more-menu-list')
                assert menu.is_visible()
                hit = menu.evaluate("""e=>[...e.querySelectorAll('button')].filter(b=>!b.disabled).every(b=>{const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})""")
                assert hit, (state, 'menu occluded')
                if cycle == 2: page.screenshot(path=str(out/f'{width}-{state}.png'))
                plus.click(); assert not menu.is_visible()
            plus.click()
            with page.expect_file_chooser(): page.get_by_role('menuitem',name='Attach file or photo',exact=True).click()
            assert plus.get_attribute('aria-expanded') == 'false'
            states.append({'state':state,'bounds':bounds,'menuHitTests':3,'pickerClickable':True})
        inspect('normal')
        if not touch:
            resize = page.get_by_role('button',name='Resize Conversation from right border',exact=True)
            resize.focus(); resize.press('Shift+ArrowRight'); resize.press('Shift+ArrowRight')
            inspect('resized')
            page.get_by_role('button',name='Maximise Conversation',exact=True).click()
            inspect('maximized')
            page.get_by_role('button',name='Restore size of Conversation',exact=True).click()
            inspect('restored')
        dictate = page.get_by_role('button',name='Dictate',exact=True)
        assert dictate.is_visible() and dictate.is_enabled()
        dictate.click(); page.get_by_role('button',name='Stop dictation',exact=True).wait_for()
        page.evaluate("window.fixtureRecognition.current.onresult({resultIndex:0,results:[Object.assign([{transcript:'Synthetic dictated draft'}],{isFinal:true})]})")
        assert 'Synthetic dictated draft' in draft.input_value()
        page.get_by_role('button',name='Stop dictation',exact=True).click()
        assert page.get_by_role('button',name='Dictate',exact=True).is_visible()
        page.locator('[data-testid="attachment-input"]').set_input_files({'name':'synthetic.txt','mimeType':'text/plain','buffer':b'synthetic'})
        page.locator('.attachment-chip[data-status="ready"]').wait_for()
        page.locator('[data-testid="attachment-input"]').set_input_files({'name':'unsupported.exe','mimeType':'application/octet-stream','buffer':b'synthetic'})
        feedback = page.locator('.composer-feedback .chat-error'); feedback.wait_for()
        assert feedback.bounding_box()['y'] < page.locator('.conversation-input').bounding_box()['y']
        assert page.locator('.attachment-chips').bounding_box()['y'] < draft.bounding_box()['y']
        assert draft.bounding_box()['y'] + draft.bounding_box()['height'] <= plus.bounding_box()['y'] + 1
        page.screenshot(path=str(out/f'{width}-feedback-attachment.png'))
        assert not errors, errors
        results.append({'viewport':[width,height],'touch':touch,'states':states,'dictationStartStop':True,'attachmentsAndFeedback':True,'pageErrors':errors})
        page.close()
    browser.close()
(out/'measurements.json').write_text(json.dumps(results,indent=2)+'\n')
print('Passed desktop normal/resized/maximized/restored and phone composer checks')
