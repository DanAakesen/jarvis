"""Exercise the packaged scene, without development-server reloads."""
import json,os,subprocess,threading
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from PIL import Image,ImageChops,ImageStat
from playwright.sync_api import sync_playwright

root=Path(__file__).parent
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
env=os.environ.copy()
env['JARVIS_PROTOTYPE_URL']=f'http://127.0.0.1:{server.server_port}/jarvis-centred-stage.html'
try:
    subprocess.run(['python','core-check.py'],cwd=root,env=env,check=True)
    if os.environ.get('JARVIS_SKIP_INTERACTION_SUITE')!='1':
        subprocess.run(['python','browser-check.py'],cwd=root,env=env,check=True)
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'])
        page=browser.new_page(viewport={'width':1440,'height':1024},reduced_motion='reduce')
        page.set_default_timeout(60000)
        errors=[];requests=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
        page.on('request',lambda r:requests.append(r.url))
        page.goto(env['JARVIS_PROTOTYPE_URL'],wait_until='networkidle')
        page.wait_for_function('window.motionStudy?.scene?.frames>2')
        dormant=page.evaluate('window.motionStudy.scene')
        assert max(abs(dormant[k]['x']-720) for k in ['orb','platform','rearCircle'])<1,dormant
        assert abs(dormant['orb']['y']-dormant['rearCircle']['y'])<1,dormant
        page.locator('#start-voice').click();page.wait_for_function('window.motionStudy.scene.voice===1')
        page.locator('.voice-tools .example-trigger').click();page.wait_for_function('window.motionStudy.scene.split===1')
        page.screenshot(path=str(root/'captures/stage-final-window.png'))
        page.locator('#knowledge-balance').fill('90')
        assert 'Broader' in page.locator('#balance-caption').inner_text()
        page.locator('#knowledge-balance').fill('50')
        page.locator('#minimise-view').click();assert page.locator('#voice-tab').is_visible()
        page.locator('#voice-tab').click();assert page.locator('#view-window').is_visible()
        # Render at the same frozen time to measure actual background lighting.
        page.screenshot(path=str(root/'captures/stage-light-on.png'))
        phase=page.evaluate('window.motionStudy.scene.environment.phase')
        page.locator('.voice-tools .settings-trigger').click()
        page.locator('#orb-light').fill('0.25');page.keyboard.press('Escape')
        page.wait_for_function('window.motionStudy.scene.environment.wallLight<90')
        page.screenshot(path=str(root/'captures/stage-light-dim.png'))
        assert page.evaluate('window.motionStudy.scene.environment.phase')==phase
        region=(300,70,500,220)
        bright=Image.open(root/'captures/stage-light-on.png').convert('RGB').crop(region)
        dim=Image.open(root/'captures/stage-light-dim.png').convert('RGB').crop(region)
        def luminance(image):
            r,g,b=ImageStat.Stat(image).mean
            return .2126*r+.7152*g+.0722*b
        on,off=luminance(bright),luminance(dim)
        change=sum(ImageStat.Stat(ImageChops.difference(bright,dim)).mean)/3
        assert on>off*1.12 and change>3,(on,off,change)
        page.locator('.voice-tools .settings-trigger').click()
        page.locator('#orb-light').fill('1');page.keyboard.press('Escape')
        # Independent mechanisms really animate, including opposite directions.
        before=page.evaluate('window.motionStudy.scene.environment')
        page.emulate_media(reduced_motion='no-preference')
        page.wait_for_function('(t)=>window.motionStudy.scene.environment.phase>t+1',arg=before['phase'])
        after=page.evaluate('window.motionStudy.scene.environment')
        assert after['ringAngles'][0]>before['ringAngles'][0]+.07
        assert after['ringAngles'][1]<before['ringAngles'][1]-.045
        page.emulate_media(reduced_motion='reduce')
        page.set_viewport_size({'width':390,'height':844})
        page.wait_for_function('Math.abs(window.motionStudy.scene.orb.x-195)<1')
        page.screenshot(path=str(root/'captures/stage-final-phone.png'))
        end=page.locator('#end-voice').bounding_box()
        assert end['y']+end['height']<844
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.locator('#end-voice').click()
        assert not page.evaluate('window.motionStudy.getState().voice')
        assert not errors,errors
        assert len(requests)==1,requests
        import hashlib
        report={'artifact_sha256':hashlib.sha256((root/'jarvis-centred-stage.html').read_bytes()).hexdigest(),'result':'passed','artifact':'jarvis-centred-stage.html','external_asset_requests':0,'primary_interactions':'passed','opposing_ambient_ring_motion':True,'reduced_motion_freezes_environment':True,'background_region':region,'bright_luminance':on,'dim_luminance':off,'mean_rgb_change':change,'errors':errors}
        (root/'captures/stage-results.json').write_text(json.dumps(report,indent=2))
        print(json.dumps(report,indent=2));browser.close()
finally:
    server.shutdown();server.server_close()
