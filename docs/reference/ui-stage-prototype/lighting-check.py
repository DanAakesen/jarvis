"""Verify actual ambient geometry movement and rendered light on the back wall."""
import json
import os
from pathlib import Path
from PIL import Image, ImageChops, ImageStat
from playwright.sync_api import sync_playwright
root=Path(__file__).parent
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1440,'height':1024})
    page.set_default_timeout(60000)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
    requests=[];page.on('request',lambda request:requests.append(request.url))
    prototype_url=os.environ.get('JARVIS_PROTOTYPE_URL','http://127.0.0.1:4173/')
    page.goto(prototype_url,wait_until='networkidle')
    page.wait_for_function('window.motionStudy?.scene?.frames > 2')
    page.locator('#start-voice').click()
    page.wait_for_function('window.motionStudy.scene.voice > .98')
    page.locator('.voice-tools .example-trigger').click()
    page.wait_for_function('window.motionStudy.scene.split > .995')
    before=page.evaluate('window.motionStudy.scene.environment')
    page.screenshot(path=str(root/'captures/living-motion-a.png'))
    page.wait_for_function('(phase)=>window.motionStudy.scene.environment.phase>phase+2',arg=before['phase'])
    after=page.evaluate('window.motionStudy.scene.environment')
    page.screenshot(path=str(root/'captures/living-motion-b.png'))
    assert after['ringAngles'][0]>before['ringAngles'][0]+.15,(before,after)
    assert after['ringAngles'][1]<before['ringAngles'][1]-.10,(before,after)
    # Freeze at the same physical geometry/time for a fair bright/dim comparison.
    page.locator('.voice-tools .settings-trigger').click()
    page.locator('#reduce-motion').check();page.keyboard.press('Escape')
    page.wait_for_function('window.motionStudy.getState().reduced')
    phase=page.evaluate('window.motionStudy.scene.environment.phase')
    page.screenshot(path=str(root/'captures/wall-light-on.png'))
    page.locator('.voice-tools .settings-trigger').click()
    page.locator('#orb-light').fill('0.25');page.keyboard.press('Escape')
    page.wait_for_function('window.motionStudy.scene.environment.wallLight < 50')
    page.screenshot(path=str(root/'captures/wall-light-dim.png'))
    assert page.evaluate('window.motionStudy.scene.environment.phase')==phase
    # Region above the orb and left of the window: wall and distant ring only.
    region=(60,90,680,250)
    bright=Image.open(root/'captures/wall-light-on.png').convert('RGB').crop(region)
    dim=Image.open(root/'captures/wall-light-dim.png').convert('RGB').crop(region)
    def luminance(image):
        r,g,b=ImageStat.Stat(image).mean
        return .2126*r+.7152*g+.0722*b
    lit_luminance=luminance(bright);dim_luminance=luminance(dim)
    assert lit_luminance>dim_luminance*1.12,(lit_luminance,dim_luminance)
    change=sum(ImageStat.Stat(ImageChops.difference(bright,dim)).mean)/3
    assert change>3,change
    # Restore emitter, then change state. The wall's light must use the orb colour.
    page.locator('.voice-tools .settings-trigger').click()
    page.locator('#orb-light').fill('1');page.locator('#state-select').select_option('thinking');page.keyboard.press('Escape')
    page.wait_for_function('window.motionStudy.scene.environment.wallLight > 150')
    page.screenshot(path=str(root/'captures/wall-thinking.png'))
    assert not errors,errors
    if 'jarvis-living-space.html' in prototype_url:assert len(requests)==1,requests
    report={'result':'passed','tested_artifact':prototype_url.split('/')[-1] or 'development server','network_requests':len(requests),'opposing_ring_motion':True,'reduced_motion_freezes_environment':True,'background_region':region,'bright_luminance':lit_luminance,'dim_luminance':dim_luminance,'mean_rgb_change':change,'errors':errors,'before':before,'after':after}
    (root/'captures/lighting-results.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2));browser.close()
