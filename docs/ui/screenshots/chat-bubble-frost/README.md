# Chat bubble frost (#1324)

Actual App with synthetic history and an animated striped scene, mocked sign-in
and HTTP. Chromium exercises the existing WebGL fallback. No private data,
physical device, Safari, real media or provider is exercised.

Both speaker bubbles share the Plus menu's 24px backdrop blur and chrome fill.
The window blur uses a background-only pseudo-element. The desktop transcript
keeps its 64px top-edge fade through item masks aligned to the scrollport on
scroll/resize/content changes. Masks extend beyond each item to retain timestamps
and focus outlines. No bubble geometry or list markup changes.

Earlier mask-free investigation captures are superseded by regenerated evidence
from the fade-preserving implementation. `measurements.json` records the current
four viewport/theme checks. Full screenshots retain text; numeric blur sampling
hides text temporarily to exclude glyph edges. A/B captures change blur alone.
Desktop fade crops compare the relocated masks against the original ancestor
mask on a uniform synthetic scene, isolating fade from backdrop detail.

## Reproduce

From repository root with web/contracts dependencies, Python Playwright/Pillow
and `/usr/bin/chromium`:

```sh
cp docs/ui/screenshots/1301/fixtures/qaapp1301.tsx apps/web/
cp docs/ui/screenshots/1301/fixtures/qaapp1301.html apps/web/
npm run dev --workspace @jarvis/web -- --host 0.0.0.0 --port 5174
# Separate shell:
python3 docs/ui/screenshots/chat-bubble-frost/fixtures/browser.py
python3 docs/ui/screenshots/chat-bubble-frost/fixtures/menu-regression.py
rm apps/web/qaapp1301.tsx apps/web/qaapp1301.html
```

Checks cover 390×844 touch and 1440×1000 desktop, both themes; scene motion,
blur pixel contrast, scene color transmission, sharp text, semantic lists,
scrolling, unchanged A/B geometry, editable draft, top-layer menu and reduced
motion. The reused Plus-menu regression also checks repeated toggles, Language
flyout, resize anchoring, keyboard focus and native file-chooser cancellation.
The existing fallback status overlaps the top of phone history; this is not
introduced by the bubble change.

## Environment and aggregate limits

Base main: `1c1029a31ce2c3008c9e721cdaf9ba2647a1febb`.
Node 24.19/npm 11.9 differs from pinned Node 22/npm 10.
Full frozen install failed HTTP 403 for locked `pkce-challenge@5.0.1` at the
Microsoft feed. Scoped web/contracts frozen install succeeded; no registry,
lockfile, TLS or global configuration changes were made.

Aggregate lint passed. Aggregate build passed contracts/web, but backend and
vault-mirror fail on missing packages after the install failure. Aggregate test
attempt passed 2283 backend tests and 151 vault-mirror tests; 196 backend files
and 5 vault-mirror files failed to load, principally missing packages. Passing
`--maxWorkers=2` through all workspaces was incompatible with contracts' Node
test runner; corrected contracts rerun passed 131 tests with one file failing
to import missing fastify. Shared Python: 144 tests, 141 passed and 3 errors
because PowerShell is absent. These are limits, not waived release gates.

Final web/browser qualification results are recorded below.

- Final `npm run lint --workspace @jarvis/web`: passed.
- Final `npm run build --workspace @jarvis/web`: passed, including TypeScript;
  existing bundle-size advisory only.
- Fade-preserving `fixtures/browser.py`: passed all four viewport/theme states.
  Background standard deviation fell by 46–92%; scene-color transmission remained
  measurable. Original-versus-relocated fade crops differed by 0.29/255 dark and
  0.39/255 light mean pixel value. Captures were visually inspected.
- Initial concurrent menu regression hit its fixed 100ms resize check. The fixture
  now waits for the same <2px positional predicate; no tolerance was changed.
- Final `fixtures/menu-regression.py`: passed all four viewport/theme states,
  including the unchanged two-pixel resize tolerance, file chooser and keyboard.
- Final full web suite: 152 files passed / 1 failed; 2397 tests passed / 1 failed.
  The failure was App shell's `uses the same gated Daily page and existing refresh
  stream (phone=false)`, timing out waiting for the Training heading while browser
  checks competed for CPU. All chat, stylesheet and stacking tests passed.
- Final uncontended rerun of App, ConversationHistory, ConversationMoreMenu,
  ConversationAttachments, stylesheets, phone-chat-viewport and overlays.styles:
  **7 files / 350 tests passed**. This includes the failed App case and the CSS
  contracts after correcting the mask color token and using allowed local -1
  decoration ordering. No test isolation or production behavior was weakened.

## Observer follow-up validation

Expanded synthetic mounted-DOM probes verify exact scrollport-relative mask
alignment after viewport resize, history-like append and text replacement,
scroll, and reduced motion, in all four viewport/theme cases. These isolate
observer behavior; they do not claim a live server history-refresh acceptance.
The append probe caught a stale offset during the existing finite entrance
transform. Offset tracking now follows `conversation-enter` only while it runs
and cancels its animation frame on cleanup. The animation itself is unchanged.

- Regenerated `fixtures/browser.py`: passed all four cases, including those
  lifecycle probes, pixel blur/transmission and baseline fade crops. Latest fade
  mean pixel errors: dark 0.31/255, light 0.23/255. Final captures inspected.
- Follow-up App/chat/menu/attachment/styles/phone/stacking rerun: 350 tests passed.
- Follow-up web lint and TypeScript/production build: passed.
- Full aggregate result above predates this observer follow-up; no new full-suite
  pass is claimed. Timeout identity remains `App shell > uses the same gated Daily
  page and existing refresh stream (phone=false)`; it passed in both focused reruns.

Publication remains blocked: local git HTTPS credentials are invalid. GitHub
`create_blob` for ConversationHistory.css was denied, then denied again after
one evidence-backed retry with freshly verified owner approval. The reviewer
said delegated approval did not establish a direct override of the earlier
restriction. No retry, alternative upload, remote branch or draft PR followed.
