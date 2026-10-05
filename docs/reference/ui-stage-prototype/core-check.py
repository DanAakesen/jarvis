"""Check rendered dormant/awake colour and persistent core in the standalone."""
import json,os,colorsys
from pathlib import Path
from PIL import Image,ImageStat
from playwright.sync_api import sync_playwright
root=Path(__file__).parent

def core_pixels(file,orb):
    image=Image.open(file).convert('RGB')
    cx,cy=round(orb['x']),round(orb['y'])
    patch=image.crop((cx-36,cy-36,cx+36,cy+36))
    red,green,blue=ImageStat.Stat(patch).mean
    # Amber includes pale gold as it blooms over the transparent blue shell.
    # Use hue/saturation so blue, neutral white and pure red do not count.
    hsv=[colorsys.rgb_to_hsv(r/255,g/255,b/255) for r,g,b in patch.get_flattened_data()]
    warm=sum(1 for h,s,v in hsv if 12 <= h*360 <= 55 and s>.18 and v>.10)/(72*72)
    return {'rgb':[red,green,blue],'luminance':.2126*red+.7152*green+.0722*blue,'warm_fraction':warm}

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1440,'height':1024},reduced_motion='reduce')
    page.set_default_timeout(90000)
    errors=[];requests=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
    page.on('request',lambda r:requests.append(r.url))
    url=os.environ.get('JARVIS_PROTOTYPE_URL','http://127.0.0.1:4173/')
    page.goto(url,wait_until='networkidle');page.wait_for_function('window.motionStudy?.scene?.frames>2')
    dormant=page.evaluate('window.motionStudy.scene')
    page.screenshot(path=str(root/'captures/core-dormant.png'))
    dormant_pixels=core_pixels(root/'captures/core-dormant.png',dormant['orb'])
    assert .015 < dormant_pixels['warm_fraction'] < .70,dormant_pixels
    assert dormant['orbVisual']['visible'] and dormant['orbVisual']['coreVisible']
    assert dormant['orbVisual']['coreTransparent'] and not dormant['orbVisual']['backgroundMasked']
    page.locator('#start-voice').click();page.wait_for_function('window.motionStudy.scene.voice===1')
    awake=page.evaluate('window.motionStudy.scene')
    page.screenshot(path=str(root/'captures/core-awake.png'))
    awake_pixels=core_pixels(root/'captures/core-awake.png',awake['orb'])
    assert .02 < awake_pixels['warm_fraction'] < .70,awake_pixels
    assert awake_pixels['luminance']>dormant_pixels['luminance']*1.25,(dormant_pixels,awake_pixels)
    assert abs(awake['orb']['x']-dormant['orb']['x'])<1
    assert awake['orbGrowth']==1 and dormant['orbGrowth']==1
    page.locator('#end-voice').click();page.wait_for_function('window.motionStudy.scene.voice===0')
    restored=page.evaluate('window.motionStudy.scene')
    assert restored['orbVisual']['visible'] and restored['orbVisual']['coreVisible']
    page.screenshot(path=str(root/'captures/core-dormant-restored.png'))
    restored_pixels=core_pixels(root/'captures/core-dormant-restored.png',restored['orb'])
    assert abs(restored_pixels['luminance']-dormant_pixels['luminance'])<1
    page.set_viewport_size({'width':390,'height':844})
    page.wait_for_function('Math.abs(window.motionStudy.scene.orb.x-195)<1')
    page.screenshot(path=str(root/'captures/phone-dormant.png'))
    phone=page.evaluate('window.motionStudy.scene')
    assert abs(phone['orb']['y']-422)<1 and phone['orbVisual']['coreVisible']
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors
    if url.endswith('.html'):assert len(requests)==1,requests
    report={'result':'passed','tested_artifact':url.split('/')[-1] or 'development server','network_requests':len(requests),'dormant_core':dormant_pixels,'awake_core':awake_pixels,'restored_core':restored_pixels,'phone_orb':phone['orb'],'errors':errors}
    (root/'captures/core-results.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
    browser.close()
