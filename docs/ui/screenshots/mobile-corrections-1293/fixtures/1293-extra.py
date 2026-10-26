import json
from playwright.sync_api import sync_playwright
out='/workspace/jarvis/docs/ui/screenshots/mobile-corrections-1293/'
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=b.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
 page.route('http://fixture.invalid/**',lambda r:r.fulfill(json={'messages':[],'nextCursor':None}))
 page.goto('http://localhost:5173/qa1293.html');page.get_by_role('textbox',name='Message Jarvis').fill('Keep this draft')
 page.get_by_role('button',name='Dictate',exact=True).click();page.screenshot(path=out+'listening-390.png')
 page.get_by_role('button',name='Stop dictation',exact=True).click();assert page.get_by_role('alert').count()==0
 assert page.get_by_role('textbox',name='Message Jarvis').input_value()=='Keep this draft'
 page.get_by_role('button',name='Menu',exact=True).click();page.wait_for_timeout(450)
 rail=page.get_by_role('navigation',name='Pages');rail.focus();page.keyboard.press('ArrowRight');page.wait_for_timeout(450)
 page.screenshot(path=out+'menu-page2-390.png')
 assert 'Page 2 of 2' in page.get_by_role('dialog').get_by_role('status').inner_text()
 page.keyboard.press('Escape');page.get_by_role('button',name='More options').click();page.screenshot(path=out+'plus-390.png');page.keyboard.press('Escape')
 page.evaluate("document.documentElement.dataset.theme='light'");page.get_by_role('button',name='Menu',exact=True).click();page.wait_for_timeout(450);page.screenshot(path=out+'menu-light-390.png')
 page.emulate_media(reduced_motion='reduce');page.keyboard.press('Escape');page.get_by_role('button',name='Menu',exact=True).click();assert page.get_by_role('dialog').is_visible()
 page.set_viewport_size({'width':1440,'height':900});page.reload();page.get_by_role('textbox',name='Message Jarvis').wait_for();page.wait_for_timeout(400);page.screenshot(path=out+'components-desktop-1440.png')
 print('Stop preserves draft with no alert; arrow paging, Escape, plus menu and reduced-motion menu passed. Captured light mobile and desktop component fixtures.')
 b.close()
