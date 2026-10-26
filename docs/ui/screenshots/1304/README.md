# Preview controls and resumed geometry — #1304

Actual React App rendered in Chromium at 390×844 and 320×700 touch, and
1440×900 desktop. Only sign-in, backend responses, speech recognition and camera
input are synthetic. Camera footage is a continuously drawn canvas MediaStream;
no private images are used. WebGL is disabled after a software WebGL capture
stalled, so these captures show the App's own fallback scene.

`camera-before-*` shows initial portrait capture; `camera-drag-*` follows real
CDP touch or mouse dragging; `camera-short-*` follows pause/resume into a 640×360
stream while typing in a shorter viewport; `camera-after-*` restores 360×640 and
the original viewport. `camera-light-*` checks the existing light theme.
All captures use the final implementation, not a claimed reproduction of the
owner's private screenshot. The mobile/desktop final pixels were inspected.

`measurements.json` records actual picture/video/control bounds and intrinsic
video dimensions. Checks assert matched video/picture geometry, unchanged aspect,
and controls inside the picture. Touch cases switch front/back three times;
all cases exercise repeated plus taps/clicks, drag and close. No browser page
errors occurred. Unit regression additionally holds a replacement stream pending:
the old code cleared the fitted size to a default 4:3 box, while the fix retains
the previous fit and refreshes dimensions on playing/play completion.
The exact iPhone interruption lifecycle has not been reproduced or accepted.

To reproduce from the repository root:

```sh
cp docs/ui/screenshots/1296/fixtures/qaapp1296.* apps/web/
npm run dev --workspace @jarvis/web -- --host 0.0.0.0 --port 5174
# In another terminal:
python3 docs/ui/screenshots/1304/fixtures/browser.py
rm apps/web/qaapp1296.html apps/web/qaapp1296.tsx
npm test --workspace @jarvis/web
npm run lint --workspace @jarvis/web
npm run build --workspace @jarvis/web
```

The Library reference was not inspected here: the materialization attempt left
`/workspace/private-reference-1304` empty. No private input was committed or
published. The second private attachment was not transferred; text requirements
and the coordinator's inspection guided the scoped change.
