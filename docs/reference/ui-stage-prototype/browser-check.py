import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).parent
(root / 'captures').mkdir(exist_ok=True)
errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1024}, device_scale_factor=1)
    page.set_default_timeout(90000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
    page.goto(os.environ.get('JARVIS_PROTOTYPE_URL','http://127.0.0.1:4173/'), wait_until='networkidle')
    page.wait_for_function('window.motionStudy?.scene?.frames > 2')
    assert page.locator('#render-error').is_hidden()
    page.locator('#toggle-left').click()
    assert page.locator('.workspace').bounding_box()['width'] > 600
    page.locator('#expand-left').click()
    page.locator('#toggle-right').click()
    assert page.locator('.workspace').bounding_box()['width'] > 800
    page.locator('#expand-right').click()
    page.screenshot(path=str(root / 'captures/typing.png'))
    dormant=page.evaluate('window.motionStudy.scene')
    assert dormant['orbVisual']['visible'] and dormant['orbVisual']['coreVisible'],dormant
    assert dormant['orbVisual']['awake']==0 and dormant['orbGrowth']==1,dormant
    assert abs(dormant['orb']['x']-720)<1 and abs(dormant['orb']['y']-1024*.46)<1,dormant
    assert abs(dormant['platform']['x']-720)<1 and abs(dormant['rearCircle']['x']-720)<1,dormant
    assert abs(dormant['rearCircle']['y']-dormant['orb']['y'])<1,dormant
    assert dormant['alignmentError']<1,dormant
    assert dormant['cameraPosition'][1]==4.5,dormant
    assert dormant['orbRadius']<=1024*.181,dormant
    assert dormant['orbVisual']['centralOrbitArcs']==0 and not dormant['orbVisual']['backgroundMasked'],dormant
    assert dormant['orbVisual']['coreTransparent'] and dormant['orbVisual']['opaqueCoreSurfaces']==0,dormant
    page.locator('#start-voice').click()
    page.wait_for_function('window.motionStudy.scene.voice > .98')
    wake = page.evaluate('window.motionStudy.scene.wakeSamples')
    assert any(.05 < sample['progress'] < .75 for sample in wake),wake
    assert all(sample['growth'] >= 1 and sample['height'] >= 2.1 for sample in wake),wake
    assert wake[0]['shellBrightness'] < wake[-1]['shellBrightness'],wake
    assert wake[0]['coreBrightness'] < wake[-1]['coreBrightness'],wake
    assert page.locator('#shell').get_attribute('inert') is not None
    assert page.locator('#end-voice').evaluate('(el) => el === document.activeElement')
    page.screenshot(path=str(root / 'captures/voice-centred.png'))
    centred = page.evaluate('window.motionStudy.scene')
    assert abs(centred['orbHeight']-2.1) < .003 and abs(centred['orbGrowth']-1) < .002
    assert centred['orbVisual']['shellBrightness'] > dormant['orbVisual']['shellBrightness'] * 1.9
    assert centred['orbVisual']['coreBrightness'] > dormant['orbVisual']['coreBrightness'] * 2
    assert centred['lightIntensity'] > dormant['lightIntensity'] * 3
    page.locator('.voice-tools .example-trigger').click()
    page.wait_for_function('window.motionStudy.scene.split > .995')
    page.screenshot(path=str(root / 'captures/voice-window.png'))
    split = page.evaluate('window.motionStudy.scene')
    assert split['orb']['x'] < centred['orb']['x'] - 150
    assert split['orbRadius'] < centred['orbRadius'] * .9, (centred,split)
    assert split['orb']['x'] + split['orbRadius'] < page.locator('#view-window').bounding_box()['x'],split
    assert split['cameraPosition'] == centred['cameraPosition']
    assert split['cameraQuaternion'] == centred['cameraQuaternion']
    for fixed in ['platform','rearCircle']:
        assert abs(split[fixed]['x']-centred[fixed]['x']) < .001
        assert abs(split[fixed]['y']-centred[fixed]['y']) < .001
    assert abs(split['rearAspect']-centred['rearAspect']) < .001
    assert centred['rearAspect'] > .95, centred
    assert split['lightPosition'] == split['orbWorld'], split
    assert split['lightIntensity'] > 100, split
    assert split['reflection']['kind'] == 'planar scene reflection'
    assert split['reflection']['width'] >= 768
    page.locator('#knowledge-balance').fill('90')
    assert 'Broader sources lead' in page.locator('#balance-caption').inner_text()
    page.locator('#knowledge-balance').fill('10')
    assert 'Personal context leads' in page.locator('#balance-caption').inner_text()
    page.locator('#knowledge-balance').fill('50')
    # Turning down the emitter must change the rendered scene, not just a label.
    page.locator('.voice-tools .settings-trigger').click()
    page.locator('#orb-light').fill('0.25')
    page.wait_for_function('window.motionStudy.scene.lightIntensity < 45')
    page.keyboard.press('Escape')
    page.screenshot(path=str(root / 'captures/voice-window-dim.png'))
    page.locator('.voice-tools .settings-trigger').click()
    page.locator('#orb-light').fill('1')
    page.keyboard.press('Escape')
    page.locator('#minimise-view').click()
    page.wait_for_function('window.motionStudy.scene.split < .02')
    assert page.locator('#voice-tab').is_visible()
    page.locator('#voice-tab').click()
    assert page.locator('#view-window').is_visible()
    page.locator('#close-view').click()
    assert page.locator('#view-window').is_hidden()
    page.keyboard.press('Escape')
    assert not page.evaluate('window.motionStudy.getState().voice')
    assert page.locator('#start-voice').evaluate('(el) => el === document.activeElement')
    page.wait_for_function('window.motionStudy.scene.voice < .005',timeout=60000)
    restored=page.evaluate('window.motionStudy.scene')
    assert restored['orbVisual']['visible'] and restored['orbVisual']['coreVisible']
    assert restored['orbVisual']['shellBrightness'] < .49
    page.screenshot(path=str(root/'captures/dormant-restored.png'))
    # Reversing a transition while it is in flight must not queue old targets.
    for _ in range(3):
        page.locator('#start-voice').click()
        page.keyboard.press('Escape')
    assert not page.evaluate('window.motionStudy.getState().voice')
    # Configurable entry behaviour retains a minimised view across the two modes.
    page.locator('.welcome .example-trigger').click()
    page.locator('.top-actions .settings-trigger').click()
    page.locator('#minimise-on-voice').check()
    page.keyboard.press('Escape')
    page.locator('#start-voice').click()
    assert page.locator('#voice-tab').is_visible()
    page.keyboard.press('Escape')
    assert page.locator('#view-tab').is_visible()
    assert page.locator('#view-window').is_hidden()
    # Opening a dialog does not let Escape end voice underneath it.
    page.locator('#start-voice').click()
    page.locator('.voice-tools .settings-trigger').click()
    page.keyboard.press('Escape')
    assert page.evaluate('window.motionStudy.getState().voice')
    page.keyboard.press('Escape')
    # Real reduced-motion preference is observed and the renderer still functions.
    page.emulate_media(reduced_motion='reduce')
    page.wait_for_function('window.motionStudy.getState().reduced')
    page.locator('#start-voice').click()
    page.wait_for_function('window.motionStudy.scene.voice == 1')
    # Phone dock behaviour keeps the foreground view and end button on screen.
    page.set_viewport_size({'width':390,'height':844})
    page.locator('.voice-tools .example-trigger').click()
    page.wait_for_function('window.motionStudy.scene.split == 1')
    page.screenshot(path=str(root / 'captures/phone-voice-window.png'))
    phone_orb = page.evaluate('window.motionStudy.scene.orb')
    assert 480 < phone_orb['y'] < 650, phone_orb
    assert abs(phone_orb['x'] - 195) < 10, phone_orb
    bounds = page.locator('#end-voice').bounding_box()
    assert bounds['y'] + bounds['height'] <= 844, bounds
    assert page.locator('#view-window').bounding_box()['x'] >= 0
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.locator('#end-voice').click()
    page.screenshot(path=str(root / 'captures/phone-typing.png'))
    assert not errors, errors
    report={'result':'passed','checks':['real WebGL rendering','persistent centred dormant orb','transparent particle and filament core with no opaque surface or backing','core stays visible in dormant mode','smooth in-place wake-up','brighter shell, core and room in voice','orb returns to dormancy after voice','centred voice state','orb moves and resizes without overlapping the content window','camera, platform and rear ring remain fixed','rear ring faces viewer','moving emitter matches orb','768px planar floor reflection','interactive illustrative source balance','adjustable rendered orb lighting','minimise and restore','close and recenter','Escape and focus restoration','rapid mode reversal','configurable minimise on entry','dialog Escape isolation','reduced motion','390px phone layout'], 'wake':wake,'dormant':dormant,'restored':restored,'centred':centred,'split':split,'browser_errors':errors,'note':'Chromium uses software WebGL here; performance on physical GPUs/phones is unverified.'}
    (root / 'captures/browser-results.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))
    browser.close()
