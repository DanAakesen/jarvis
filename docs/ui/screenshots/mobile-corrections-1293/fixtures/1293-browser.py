import json
from playwright.sync_api import sync_playwright
out='/workspace/jarvis/docs/ui/screenshots/mobile-corrections-1293/'
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=b.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 msg={'id':'42','sessionId':'41','channel':'voice','language':'en','role':'jarvis','text':'Synthetic conversation for mobile layout verification. The draft below stays editable while the menu is open.','model':None,'voiceMinutes':None,'at':'2026-10-26T06:00:00.000Z','toolCalls':[]}
 page.route('http://fixture.invalid/**',lambda r:r.fulfill(json={'messages':[msg], 'nextCursor':None}))
 page.goto('http://localhost:5173/qa1293.html');page.get_by_role('textbox',name='Message Jarvis').wait_for();page.wait_for_timeout(1200)
 page.screenshot(path=out+'composer-390.png')
 page.get_by_role('textbox',name='Message Jarvis').fill('A full-width draft with room to type a complete message.')
 page.get_by_role('button',name='Menu',exact=True).click();page.wait_for_timeout(500);page.screenshot(path=out+'menu-390.png')
 print(page.evaluate('''() => { const r=s=>{const e=document.querySelector(s),b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,background:getComputedStyle(e).backgroundColor,blur:getComputedStyle(e).backdropFilter}};return {input:r('textarea'),more:r('.composer-more'),dictate:r('.composer-dictate'),send:r('.composer-send'),menu:r('.mobile-menu-sheet'),backdrop:r('.mobile-menu-backdrop'),page:r('.mobile-menu-page'),dots:r('.mobile-menu-dots'),overflow:document.documentElement.scrollWidth}}'''))
 page.keyboard.press('Escape');page.get_by_role('button',name='Dictate',exact=True).click();page.evaluate("window.fixtureRecognition.current.onerror({error:'not-allowed'})");page.screenshot(path=out+'error-390.png')
 page.evaluate("Object.defineProperty(window,'visualViewport',{configurable:true,value:Object.assign(new EventTarget(),{height:480,offsetTop:0,scale:1})});window.dispatchEvent(new Event('resize'))")
 # Hook captured original viewport; override its height to simulate the actual resize event.
 page.reload();page.get_by_role('textbox',name='Message Jarvis').wait_for();page.wait_for_timeout(400)
 page.evaluate("Object.defineProperty(window.visualViewport,'height',{configurable:true,value:480});window.visualViewport.dispatchEvent(new Event('resize'))")
 page.screenshot(path=out+'keyboard-geometry-390.png');print('keyboard',page.evaluate("({keyboard:document.querySelector('.app-shell').dataset.keyboardOpen,nav:getComputedStyle(document.querySelector('.mobile-bottom-nav')).visibility,composer:document.querySelector('.conversation-input').getBoundingClientRect().toJSON()})"))
 page.set_viewport_size({'width':320,'height':700});page.reload();page.get_by_role('button',name='Menu',exact=True).click();page.wait_for_timeout(500);page.screenshot(path=out+'menu-320.png')
 print('errors',errors)
 b.close()
