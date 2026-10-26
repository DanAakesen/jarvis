# Chat bubble frost (#1324)

Actual App with synthetic history and an animated striped scene, mocked sign-in
and HTTP. Chromium exercises the existing WebGL fallback. No private data,
physical device, Safari, real media or provider is exercised.

Plus, both speaker bubbles and app header share a lighter 16px backdrop blur and the existing chrome fill.
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

Historical publication checkpoint: local git HTTPS credentials were invalid. GitHub
`create_blob` for ConversationHistory.css was denied, then denied again after
one evidence-backed retry with freshly verified owner approval. The reviewer
said delegated approval did not establish a direct override of the earlier
restriction. No bypass followed at that checkpoint. Subsequent direct file-level
approval enabled the original draft PR #1326.

## Integrated owner refinement

Use 16px (previously 24px) on Plus, bubbles and header through one token; preserve existing fill.
The history-open rule explicitly set composer top radii to zero; it now preserves
the window radius, inherited by both gradient border pseudo-elements.
Integrated main aa87c57e retains video #1318, Health #1322 and keyboard #1325.
Documentation introduction conflicts retain both entries; production merged automatically.

Review follow-up disables the unused fade observer during phone typing, coalesces
scroll updates into animation frames, and resets ResizeObserver targets on
replacement so removed direct children are not retained. Synthetic 300-bubble
scroll/observer and corner checks are in fixtures/performance-corners.py.

Corner clarification: only mobile with the history window shown is corrected;
desktop and hidden-state borders remain as before. Publishing private owner communication as an issue comment was denied by
approval review. No quote was posted or retained in these published artifacts.


Final cached-mask and lighter-material probes pass all four viewport/theme cases.
Header background A/B pixel deltas are 44–50/255. Desktop fade errors are
0.25/255 dark and 0.23/255 light. Mobile shown/hidden corners and both gradient
border pseudo-elements passed three hide/show cycles per theme; desktop retains
its original zero top radius in the shown state. No private screenshot was used.

The 302-bubble probe reports zero bubble rectangle reads during steady scrolling
and zero retained detached direct children after replacement. Phone typing has
zero fade observers. Measured frame times remain noisy under concurrent checks
(p50 18–52ms, p95 36–217ms); these do not establish physical-device smoothness.
The previous uncached probe performed 11,778 bubble rectangle reads in 40 frames.
Position caches now refresh on content/size/entrance changes, not raw scrolling;
only items intersecting the top fade receive masks. Offset state and observers
are cleaned up on replacement/unmount.


Final integration qualification (main aa87c57e): full web suite ran 154 files / 2420
tests; 2418 passed and two hit the unchanged 15-second timeout under concurrent
browser load. Failures were Camera preview's touch drag/cancel case and the
app-wide contrast audit. No assertions or timeouts were weakened. Targeted
uncontended rerun is recorded below. Previous focused Send timeout was also a
15-second timeout under contention; subsequent history suites passed.


- Final uncontended CameraPreview/contrast-audit/ConversationHistory/phone viewport
  rerun: **4 files / 149 tests passed**, including both full-suite timeout cases.
- Final web lint and TypeScript/Vite build passed. Aggregate repository lint also
  passed; full backend/vault dependency and PowerShell limits above remain.
- Final `browser.py`, `menu-regression.py` and `performance-corners.py` passed.
  Final focus-overflow captures show the faded focus outline and timestamp beyond
  the short bubble border. Timestamp checks wait for the existing opacity
  transition to reach its unchanged visible state. Corners are verified on the
  element and both border pseudo-elements across both themes and toggle states.
- Latest 302-bubble steady-scroll probe: zero bubble rectangle reads; zero retained
  detached observed children. Phone has no fade observer. Frame timings remain
  hardware/environment dependent; no physical Safari smoothness claim is made.


## Meal precision main integration

Integrated main `92fbd42cf167962ecbd86e54ada3b22374080465` (#1328). Documentation
introduction conflicts retain both entries. Backend food code, architecture notes
and the new whole-number history tests match main exactly. The three blur/corner
runtime files are byte-identical to local validated commit `89c45b28`, so the
existing synthetic pixels, fade, corner, observer and performance evidence remains
applicable; no fresh pixel run is claimed for this documentation/test integration.
Focused history/menu/attachment/phone integration checks: **4 files / 158 tests
passed**. The new tree requires its own hosted CI result; the prior tree's green
run is not used as qualification for this integration. Manual merge only.
