"""Run with the qa1315 component fixtures copied into apps/web."""
import json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
out = Path(__file__).resolve().parents[1] / 'integration-send'
out.mkdir(exist_ok=True)
baseline = '--baseline' in sys.argv
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True)
    errors, calls, replays = [], [], []
    recovery = {'enabled': False}
    page.on('pageerror', lambda e: errors.append(str(e)))
    def respond(route):
        path = route.request.url
        if path.endswith('/conversation/turns/active'):
            route.fulfill(json={'turns':[{'sessionId':'41','messageId':'901','language':'en'}] if recovery['enabled'] else []})
        elif path.endswith('/sessions/41/turns/901/events'):
            assert route.request.method == 'GET'
            replays.append(path)
            recovery['enabled'] = False
            msg = {'id':'901','sessionId':'41','role':'dan','text':'Synthetic original recovered message','model':None,'at':'2026-10-26T12:00:00Z'}
            reply = {**msg,'id':'902','role':'jarvis','text':'Synthetic original recovered reply'}
            route.fulfill(content_type='text/event-stream',body=''.join('event: '+event+'\ndata: '+json.dumps(data)+'\n\n' for event,data in [('user',msg),('done',reply)]))
        elif route.request.method == 'GET':
            route.fulfill(json={'messages':[], 'nextCursor':None})
        elif path.endswith('/sessions'):
            route.fulfill(json={'id':'41','channel':'chat','language':'en'})
        elif path.endswith('/turns'):
            calls.append(route.request.post_data_json['text'])
            n = len(calls)
            msg = {'id':str(n*2), 'sessionId':'41', 'role':'dan','text':calls[-1], 'model':None, 'at':'2026-10-26T12:00:00Z'}
            reply = {**msg, 'id':str(n*2+1), 'role':'jarvis', 'text':'Synthetic reply'}
            body = ''.join('event: '+event+'\ndata: '+json.dumps(data)+'\n\n' for event,data in [('user',msg),('done',reply)])
            if n == 3:
                body = 'event: error\ndata: {"error":"Synthetic interrupted reply"}\n\n'
            route.fulfill(content_type='text/event-stream', body=body)
        else:
            route.fulfill(status=500, json={'error':'Unexpected synthetic endpoint'})
    # Every non-local request is intercepted; no real backend sends.
    page.route('**/*', lambda r: r.continue_() if r.request.url.startswith('http://localhost:5174/') else respond(r))
    page.goto('http://localhost:5174/qa1315.html')
    box = page.get_by_role('textbox', name='Message Jarvis')
    send = page.get_by_role('button', name='Send', exact=True)
    box.fill('Synthetic touch send')
    page.evaluate('''() => {
      window.trace = [];
      for (const type of ['pointerdown','pointerup','pointercancel','mousedown','blur','focus','click','submit'])
        document.addEventListener(type,e=>window.trace.push({type,target:e.target.id || e.target.className,active:document.activeElement?.id}),true);
      Object.defineProperty(window.visualViewport,'height',{configurable:true,value:480});
      window.visualViewport.dispatchEvent(new Event('resize'));
      // Model keyboard dismissal on blur to expose the dock/focus sequence.
      document.querySelector('#message').addEventListener('blur',()=>{
        Object.defineProperty(window.visualViewport,'height',{configurable:true,value:844});
        window.visualViewport.dispatchEvent(new Event('resize'));
      });
    }''')
    page.wait_for_timeout(200)
    before = send.bounding_box()
    # A cancelled native touch must not submit.
    cdp = page.context.new_cdp_session(page)
    point = {'x':before['x']+22,'y':before['y']+22}
    cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[point]})
    cdp.send('Input.dispatchTouchEvent', {'type':'touchCancel','touchPoints':[]})
    assert calls == [] and box.input_value() == 'Synthetic touch send'
    send.tap()
    page.wait_for_timeout(500)
    result = page.evaluate('''() => ({active:document.activeElement?.id,height:visualViewport.height,keyboard:document.querySelector('.app-shell').dataset.keyboardOpen,trace:window.trace})''')
    result.update(calls=list(calls), before=before, after=send.bounding_box(), errors=errors)
    if not baseline:
        assert result['active'] == 'message', result
        assert result['height'] == 480 and result['keyboard'] == 'true', result
        assert calls == ['Synthetic touch send'], result
        assert box.input_value() == '' and send.is_disabled()
        box.fill('Synthetic repeated touch')
        send.tap()
        page.wait_for_timeout(300)
        assert calls == ['Synthetic touch send','Synthetic repeated touch'], calls
        assert box.evaluate('(e)=>e===document.activeElement')
        page.screenshot(path=str(out/'touch-focused.png'))
        # Explicit dismissal and reopening still work.
        box.evaluate('(e)=>e.blur()')
        box.fill('Synthetic reopened draft')
        send.tap()
        page.wait_for_timeout(300)
        assert len(calls) == 3 and box.evaluate('(e)=>e===document.activeElement')
        assert page.get_by_text('Synthetic interrupted reply', exact=True).is_visible()
        assert box.input_value() == ''  # delivery-uncertain recovery must not auto-resend
        # Desktop keeps its normal focus behavior.
        page.set_viewport_size({'width':1440,'height':900})
        page.reload()
        box.fill('Synthetic desktop send')
        send.click()
        page.wait_for_timeout(300)
        assert len(calls) == 4
        result['repeated_reopened_desktop_calls'] = list(calls)
        recovery['enabled'] = True
        page.set_viewport_size({'width':390,'height':844})
        page.reload()
        page.get_by_text('Synthetic original recovered reply',exact=True).wait_for()
        assert len(replays) == 1 and len(calls) == 4
        result['original_identity_get_replays'] = replays
        result['post_count_after_recovery'] = len(calls)
        assert errors == [], errors
    (out/('baseline.json' if baseline else 'browser.json')).write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
    browser.close()
