# Continuous dictation verification (#1305)

The captures show the actual App with synthetic sign-in, HTTP responses and
speech-recognition events. Chromium runs with WebGL disabled; the existing 3D
fallback message is expected. No live microphone, provider or private data is used.

## Reproduce

From the repository root with Python Playwright and `/usr/bin/chromium` installed:

```sh
npm ci --ignore-scripts --workspace @jarvis/web --workspace @jarvis/contracts --cache /tmp/jarvis-npm-cache
cp docs/ui/screenshots/1301/fixtures/qaapp1301.tsx apps/web/
cp docs/ui/screenshots/1301/fixtures/qaapp1301.html apps/web/
npm run dev --workspace @jarvis/web -- --host 127.0.0.1 --port 5174
# In another shell:
python3 docs/ui/screenshots/1305/browser.py
rm apps/web/qaapp1301.tsx apps/web/qaapp1301.html
npm test --workspace @jarvis/web
npm run lint --workspace @jarvis/web
npm run build --workspace @jarvis/web
```

## Evidence

- Browser: passed at 390×844 dark and 320×700 light/reduced-motion with touch.
  Replaces interim hypotheses, deduplicates final replay, restarts after end and
  no-speech, ignores retired callbacks, retains the draft, completes three repeat
  toggles, and displays permission denial. No page errors in either phone case.
- Desktop 1440×1000: inspected the unchanged composer; Dictate is intentionally
  hidden there by existing CSS. No change to desktop visibility is included.
- All three screenshots were visually inspected. Draft and Stop fit the existing
  controls at both phone widths; no new layout, palette or animation was added.
- Web lint and build passed; build retains the existing >500kB chunk advisory.
- `npm test --workspace @jarvis/web`: 152 files passed, one failed; 2,378 tests
  passed and one contrast-audit test hit its 15-second timeout during concurrent
  browser work. All 95 `ConversationHistory` tests passed.
- A combined conversation/contrast rerun passed all 95 conversation tests but
  repeated the contrast timeout while the full suite was still running.
- `npm test --workspace @jarvis/web -- src/contrast-audit.test.ts` alone: all
  seven tests passed with unchanged assertions/timeouts. The complete suite was
  then rerun without concurrent browser work: all 153 files and 2,379 tests passed
  in 177.69 seconds at commit `456f0526f1fdb6766b7bcbdff7a5d7a4413fcac2`.
  The contrast timeout did not reproduce; assertions and timeouts were unchanged.
- `git diff --check`: passed.

An initial unit assertion checked localStorage instead of existing sessionStorage;
it was corrected. Early browser harness runs had an invalid synthetic settings
response and attempted to click the intentionally hidden desktop Dictate control;
the fixture/checks were corrected without changing product behavior.

## Inline review correction

Review `discussion_r4377356371` identified lost new words when a manually edited
interim result disappears and the browser reuses its index. Clamp the ignored
edit boundary to each current result snapshot length. Two regression variants
(shrink immediately after editing, or after an intervening snapshot) both failed
before the correction and passed afterward, including interim-to-final updates,
final snapshot replay, preservation of the edit and session draft storage.
All 97 `ConversationHistory` tests passed after the correction. The subsequent
full web suite passed all 153 files and 2,381 tests in 167.59 seconds. Web lint
and build also passed (existing chunk-size advisory); no assertions or timeouts
were weakened. Browser screenshots above predate this result-handler-only fix.

## Limits

Node 24.19.0/npm 11.9.0 differs from pinned CI Node 22/npm 10. The jsdom suite
reports existing unimplemented canvas/media methods. Simulated browser events
are not physical iPhone, WebKit, microphone or speech-provider acceptance.
Independent review, hosted exact-head qualification and merge belong to the parent.
