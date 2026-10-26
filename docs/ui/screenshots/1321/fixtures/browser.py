import json
from pathlib import Path
from playwright.sync_api import sync_playwright
out = Path(__file__).parent.parent
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    results=[]
    for width,theme in [(390,'dark'),(1440,'light')]:
        page=browser.new_page(viewport={'width':width,'height':1000},reduced_motion='reduce')
        errors=[]
        page.on('pageerror',lambda e: errors.append(str(e)))
        page.route('**/*',lambda r:r.continue_() if r.request.url.startswith('http://127.0.0.1:5173/') else r.abort())
        page.goto('http://127.0.0.1:5173/qa1321.html')
        page.evaluate('(theme)=>document.documentElement.dataset.theme=theme',theme)
        status=page.get_by_role('status',name='Food estimate awaiting your reply')
        assert status.locator('li').all_text_contents()==['Protein: 12.5 g','Calories: 300 kcal','Fat: 8 g','Carbohydrates: unknown (not zero) g']
        assert page.get_by_text('Health food review',exact=True).is_visible()
        page.screenshot(path=str(out/f'list-{width}-{theme}.png'),full_page=True)
        page.get_by_role('button',name='1 item needs attention').click()
        panel=page.get_by_role('heading',name='Pending confirmations').locator('..')
        assert panel.locator('.confirmation-summary li').all_text_contents()==status.locator('li').all_text_contents()
        page.screenshot(path=str(out/f'approval-{width}-{theme}.png'),full_page=True)
        approve=page.get_by_role('button',name='Approve Other')
        approve.focus()
        assert approve.evaluate('(e)=>e===document.activeElement')
        approve.press('Enter')
        page.wait_for_function('document.body.dataset.resolved==="true"')
        assert not errors,errors
        assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
        results.append({'width':width,'theme':theme,'listItems':status.locator('li').all_text_contents(),'keyboardApproval':'synthetic callback only','errors':errors})
        page.close()
    (out/'browser.json').write_text(json.dumps(results,indent=2))
    print(json.dumps(results))
    browser.close()
