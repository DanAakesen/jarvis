"""Run against the existing qa1315 actual-component fixture (see README)."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

out = Path(__file__).parent
baseline = False
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    page.context.grant_permissions(['clipboard-read', 'clipboard-write'])
    errors, calls = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    def message(i, text):
        return {'id': str(i), 'sessionId': '41', 'role': 'jarvis', 'text': text,
                'channel': 'chat', 'language': 'en', 'toolCalls': [], 'model': None, 'at': '2026-10-26T12:00:00Z'}
    def respond(route):
        path = route.request.url
        if path.startswith('http://localhost:5173/'):
            route.continue_()
        elif path.endswith('/conversation/turns/active'):
            route.fulfill(json={'turns': []})
        elif route.request.method == 'GET':
            route.fulfill(json={'messages': [message(i, f'Synthetic history row {i}. Read while composing. ' * 3) for i in range(40)], 'nextCursor': None})
        elif path.endswith('/sessions'):
            route.fulfill(json={'id': '41', 'channel': 'chat', 'language': 'en'})
        elif path.endswith('/turns'):
            calls.append(route.request.post_data_json['text'])
            user = {**message(100, calls[-1]), 'role': 'dan'}
            route.fulfill(content_type='text/event-stream', body=''.join('event: '+event+'\ndata: '+json.dumps(data)+'\n\n' for event, data in [('user', user), ('done', message(101, 'Synthetic reply'))]))
        else:
            route.fulfill(status=500, json={'error': 'Unexpected fixture endpoint'})
    page.route('**/*', respond)
    page.goto('http://localhost:5173/qa1315.html')
    box = page.get_by_role('textbox', name='Message Jarvis')
    transcript = page.get_by_label('Conversation history', exact=True)
    page.get_by_text('Synthetic history row 39.', exact=False).wait_for()
    box.fill('Draft before scroll')
    page.evaluate('''() => {
      window.trace = [];
      for (const type of ['pointerdown','pointermove','pointercancel','pointerup','scroll','blur','click','submit'])
        document.addEventListener(type,e=>window.trace.push({type,target:e.target.id || e.target.className,active:document.activeElement?.id}),true);
      Object.defineProperty(visualViewport,'height',{configurable:true,value:480});
      visualViewport.dispatchEvent(new Event('resize'));
      document.querySelector('#message').addEventListener('blur',()=>{
        Object.defineProperty(visualViewport,'height',{configurable:true,value:844});
        visualViewport.dispatchEvent(new Event('resize'));
      });
    }''')
    page.wait_for_timeout(300)
    transcript.evaluate('(e)=>e.scrollTop=e.scrollHeight')
    page.wait_for_timeout(100)
    before = transcript.evaluate('(e)=>e.scrollTop')
    rect = transcript.bounding_box()
    print('transcript', transcript.evaluate('(e)=>({height:e.clientHeight,scrollHeight:e.scrollHeight,overflow:getComputedStyle(e).overflowY})'), rect)
    cdp = page.context.new_cdp_session(page)
    x, y = rect['x'] + rect['width']/2, rect['y'] + 55
    cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
    for dy in range(20, 161, 20):
        cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':x,'y':y+dy}]})
        page.wait_for_timeout(25)
    cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
    page.wait_for_timeout(400)
    result = page.evaluate('''() => ({active:document.activeElement?.id,height:visualViewport.height,keyboard:document.querySelector('.app-shell').dataset.keyboardOpen,trace:window.trace})''')
    result.update(scroll_before=before, scroll_after=transcript.evaluate('(e)=>e.scrollTop'), draft=box.input_value())
    if not baseline:
        assert result['scroll_after'] < before - 50, result
        assert result['active'] == 'message' and result['keyboard'] == 'true' and result['height'] == 480, result
        assert result['draft'] == 'Draft before scroll'
        # Use keyboard input without refocusing/filling, so lost focus cannot be hidden.
        page.keyboard.type(' continued')
        assert box.input_value() == 'Draft before scroll continued'
        page.get_by_role('button', name='Send', exact=True).tap()
        page.wait_for_timeout(300)
        assert calls == ['Draft before scroll continued'], calls
        assert box.evaluate('(e)=>e===document.activeElement') and box.input_value() == ''
        result['calls'] = list(calls)
        page.get_by_role('button', name='More options', exact=True).tap()
        result['first_plus_opened'] = page.get_by_role('menuitem', name='Copy Send diagnostic', exact=True).is_visible()
        if not result['first_plus_opened']:
            page.get_by_role('button', name='More options', exact=True).tap()
        page.get_by_role('menuitem', name='Copy Send diagnostic', exact=True).tap()
        page.get_by_text('Send diagnostic copied. Share it only when you choose. Nothing was uploaded.', exact=True).wait_for()
        copied = page.evaluate("Promise.race([navigator.clipboard.readText(), new Promise((_, reject) => setTimeout(() => reject(new Error('Harness clipboard read timed out')), 3000))])")  # harness-only read
        payload = json.loads(copied)
        assert payload['version'] == 1 and 0 < len(payload['events']) <= 128
        assert 'Draft before scroll' not in copied and 'Synthetic' not in copied
        assert all(set(row) == {'ms','event','phase','target','focused','inComposer','pathInComposer','prevented','disabled','pointer','viewport','button'} for row in payload['events'])
        assert any(row['event'] == 'pointerdown' and row['target'] == 'send' and row['phase'] == 'settled' and row['prevented'] for row in payload['events']), payload
        result['native_send_cancellation_recorded'] = True
        result['native_send_pointerdown'] = [row for row in payload['events'] if row['event'] == 'pointerdown' and row['target'] == 'send']
        result['copied_event_count'] = len(payload['events'])
        result['clipboard_content_free'] = True

        page.screenshot(path=str(out/'touch-scroll-send.png'))
        # A genuine outside tap still dismisses and its button/link click is not swallowed.
        page.evaluate('''() => {
          const controls=document.createElement('div');
          controls.style='position:fixed;top:80px;left:20px;z-index:99999';
          controls.innerHTML='<button id="qa-button">Fixture button</button><a id="qa-link" href="#fixture-link">Fixture link</a>';
          document.body.append(controls);
          window.activations=[];
          controls.addEventListener('click',e=>window.activations.push(e.target.id));
        }''')
        for selector in ['#qa-button', '#qa-link']:
            box.focus()
            page.locator(selector).tap()
            assert not box.evaluate('(e)=>e===document.activeElement')
        result['activations'] = page.evaluate('window.activations')
        assert result['activations'] == ['qa-button','qa-link']
        assert page.url.endswith('#fixture-link')
        assert errors == [], errors
    result['errors'] = errors
    (out/('baseline.json' if baseline else 'browser.json')).write_text(json.dumps(result, indent=2))
    print(json.dumps({k:v for k,v in result.items() if k != 'trace'}, indent=2))
    browser.close()
