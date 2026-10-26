# Camera movement and menu verification (#1296)

The committed PNGs show the actual App with its production Workspace,
CameraPreview, ConversationHistory, ConversationMoreMenu, MobileBottomNav and
MobileMenu components. Sign-in and HTTP responses are synthetic. The camera is a
360×640 canvas stream with labeled colored shapes; no camera hardware or private
reference pixels are used. Chromium runs with WebGL disabled, so the existing
3D-room fallback and its message are visible. The initial software-WebGL attempt
was stopped because it stalled capture; it is not performance acceptance.

## Reproduce

From the repository root, with Python Playwright and `/usr/bin/chromium` available:

```sh
npm ci --ignore-scripts --workspace @jarvis/web --workspace @jarvis/contracts --cache /tmp/jarvis-npm-cache-1296
cp docs/ui/screenshots/1296/fixtures/qaapp1296.* apps/web/
npm run dev --workspace @jarvis/web -- --host 0.0.0.0
# In another shell, from /workspace/jarvis:
python3 docs/ui/screenshots/1296/fixtures/browser.py
rm apps/web/qaapp1296.tsx apps/web/qaapp1296.html
```

The browser script uses this executor's `/workspace/jarvis` path and writes only
synthetic evidence into this folder. The temporary fixture files must be removed
before committing or building. No production authentication or network is needed.

## Results

- `npm test --workspace @jarvis/web`: 153 files, 2360 tests passed.
- `npm test --workspace @jarvis/web -- src/CameraPreview.test.tsx src/ConversationMoreMenu.test.tsx src/Workspace.test.tsx src/stylesheets.test.tsx`: 4 files, 171 tests passed after the final touch-action refinement.
- `npm run lint --workspace @jarvis/web`: passed.
- `npm run build --workspace @jarvis/web`: passed; existing >500kB chunk advisory.
- `python3 docs/ui/screenshots/1296/fixtures/browser.py`: passed at 390×844 and
  320×700 touch, plus 1440×1000 desktop pointer. No page errors. Three successive
  open/close cycles use actual taps/clicks. CDP touch input moves the preview
  40px left/70px down; desktop mouse input moves it 150px left/90px down.
  Touch switch remains functional at the moved location, and close works after
  both touch and mouse movement. Composer plus/send borders remain 0px.
- `measurements.json` records rendered bounds and computed surfaces. Light phone
  composer/dock/menu alpha is 0.58 while the unchanged header remains 0.92.
  Dark desktop composer alpha is 0.522 (58% of its existing translucent surface).
- Final screenshots were inspected for framing, overlay position, legibility,
  borderless icons, menu transparency and undimmed conversation. They include
  dark phone/desktop plus menus, moved cameras, and phone navigation menus in
  both themes. No new animation is added; repeated input works during menu motion.

An early stylesheet test rejected a raw color literal; replacing it with the
existing theme tokens fixed the failure. An early browser run had an ambiguous
close locator matching a workspace tab too; the final script matches the exact
camera overlay name. Neither failure remains in the final checks.

## Limits

Node 24.19.0/npm 11.9.0 differs from pinned CI Node 22/npm 10. Parent owns hosted
exact-head checks, review, merge and deployment. No physical iPhone, WebKit,
real camera/microphone, live service, or model-image acceptance is claimed.

Both supplied private Library images failed the supported transfer helper with
`library file transfer failed: download failed`. The destination remained empty.
The helper did not classify denial versus connectivity; preparation succeeded,
local download did not. Neither source image was pixel-inspected in this
executor, committed or published. Implementation used the explicit text scope
and the parent's inspection description. The public artifacts here are synthetic.
