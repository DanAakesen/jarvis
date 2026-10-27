"""Synthetic API/keyboard geometry; intact production handlers, explicit owner-sequence replay."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
out = Path(__file__).parent
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for baseline, native, name, selector in [(b,n,name,sel) for b,n in [(True,False),(False,False),(False,True)] for name,sel in [('Send','.composer-send'),('Plus','.composer-more > .more-menu-trigger'),('Dictate','.composer-dictate')]]:
        page = browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
        calls, errors = [], []
        page.on('pageerror',lambda e:errors.append(str(e)))
        def respond(route):
            url=route.request.url
            if url.startswith('http://localhost:5173/'):
                route.continue_()
            elif url.endswith('/conversation/turns/active'):
                route.fulfill(json={'turns':[]})
            elif route.request.method=='GET':
                route.fulfill(json={'messages':[],'nextCursor':None})
            elif url.endswith('/sessions'):
                route.fulfill(json={'id':'41','channel':'chat','language':'en'})
            elif url.endswith('/turns'):
                calls.append(route.request.post_data_json['text'])
                msg={'id':'100','sessionId':'41','role':'dan','text':calls[-1],'model':None,'at':'2026-10-27T09:00:00Z'}
                reply={**msg,'id':'101','role':'jarvis','text':'Synthetic reply'}
                route.fulfill(content_type='text/event-stream',body=''.join('event: '+event+'\ndata: '+json.dumps(data)+'\n\n' for event,data in [('user',msg),('done',reply)]))
            else:
                route.fulfill(status=500,json={'error':'Unexpected synthetic route'})
        page.route('**/*',respond)
        page.goto('http://localhost:5173/'+('qa-composer-baseline.html' if baseline else 'qa1315.html'))
        box=page.get_by_role('textbox',name='Message Jarvis')
        box.fill('Synthetic owner-sequence draft')
        page.evaluate('''() => {
          Object.defineProperty(visualViewport,'height',{configurable:true,value:480});
          visualViewport.dispatchEvent(new Event('resize'));
          document.querySelector('#message').addEventListener('blur',()=>{
            Object.defineProperty(visualViewport,'height',{configurable:true,value:844});
            visualViewport.dispatchEvent(new Event('resize'));
          });
        }''')
        page.wait_for_timeout(150)
        if native:
            button=page.locator(selector)
            bounds=button.bounding_box()
            cdp=page.context.new_cdp_session(page)
            point={'x':bounds['x']+22,'y':bounds['y']+22}
            cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[point]})
            cdp.send('Input.dispatchTouchEvent',{'type':'touchCancel','touchPoints':[]})
            assert calls==[] and not page.get_by_role('menu').count()
            cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[point]})
            cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':20,'y':max(80,point['y']-150)}]})
            cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
            assert calls==[] and not page.get_by_role('menu').count()
            assert page.get_by_role('button',name='Stop dictation').count()==0
            assert box.evaluate('(e)=>e===document.activeElement')
            button.tap()
            info={'mode':'native Chromium touch'}
        else:
            info=page.evaluate('''selector => {
              const b=document.querySelector(selector), r=b.getBoundingClientRect(), x=r.x+r.width/2,y=r.y+r.height/2;
              b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerType:'touch',isPrimary:true,button:0}));
              b.dispatchEvent(new Event('touchstart',{bubbles:true,cancelable:true}));
              b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerType:'touch',isPrimary:true,button:0}));
              b.dispatchEvent(new Event('touchend',{bubbles:true,cancelable:true}));
              const down=new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});
              const allowed=b.dispatchEvent(down);
              // Explicit model of the default focus step reported by the owner.
              // dispatchEvent alone does not perform this browser default.
              if(allowed)b.focus();
              const target=document.elementFromPoint(x,y);
              target?.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,button:0}));
              target?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0}));
              return {mode:'recorded-order replay with modelled default focus',mouseDownPrevented:down.defaultPrevented,beforeY:r.y,afterY:b.getBoundingClientRect().y,clickHitOriginalButton:!!target&&b.contains(target)};
            }''',selector)
        page.wait_for_timeout(300)
        action = len(calls)==1 if name=='Send' else page.get_by_role('menu',name='More options',exact=True).count()==1 if name=='Plus' else page.get_by_role('button',name='Stop dictation').count()==1
        if baseline:
            assert not info['mouseDownPrevented'] and not action and not info['clickHitOriginalButton'], info
        else:
            assert action, (name,info,errors)
            if not native: assert info['mouseDownPrevented'] and info['clickHitOriginalButton'], info
            if name!='Plus':
                assert box.evaluate('(e)=>e===document.activeElement')
                page.keyboard.type(' continued')
                assert box.input_value().endswith(' continued')
            else:
                assert page.get_by_role('menuitem',name='Language',exact=True).evaluate('(e)=>e===document.activeElement')
                page.get_by_role('menuitem',name='Language',exact=True).click()
                assert page.get_by_role('menu',name='Language',exact=True).is_visible()
            page.screenshot(path=str(out/(name.lower()+('-native' if native else '-replay')+'.png')))
        assert errors==[], errors
        results.append({'control':name,'baseline':baseline,**info,'actionOccurred':action,'sendCount':len(calls),'errors':errors})
        page.close()
    browser.close()
(out/'browser.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
