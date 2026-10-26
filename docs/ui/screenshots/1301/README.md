# Settled shell glass verification (#1301)

These are synthetic screenshots of the actual App and production shell,
conversation and menu components. Sign-in, HTTP data and delayed settings are
controlled fixtures. Chromium runs the existing WebGL fallback, not a fabricated
interface. No private input screenshot, camera or microphone data is included.

## Diagnosis

On main `df3fafa535f10b7c76b0c911f039dbc0f13b85cc`, the 390×844 dark App showed:

| Surface | Settled fill alpha | Winning blur |
| --- | ---: | ---: |
| Header | 0.90 | 24px |
| Composer, dock and mobile menu | 0.522 | 24px |

At about 100ms the mobile-menu wrapper and sheet each had opacity 0.932683;
at 600ms both reached 1, while background alpha was unchanged. This is a double
opacity fade, not an observed late stylesheet/background replacement. The old
phone selector defeated the later 10px blur rule, and the header was excluded
from the clearer-fill override. The scene was fixed at 0,0 and covered the full
390×844 viewport behind header/dock, with transparent shell ancestors.
`baseline-measurements.json` preserves the computed values and bounds.

The correction uses one dedicated partial glass fill (0.36 dark / 0.40 light)
and 10px blur for the requested surfaces, removes conflicting overrides, and
uses translation-only menu entrance. It leaves other overlay motion alone.
Dock hover/pressed/current/expanded states affect the existing icon color/stroke,
not item backgrounds or borders. Label colors and keyboard focus remain intact.

## Reproduce

With existing web dependencies, Python Playwright, Pillow and `/usr/bin/chromium`:

```sh
cp docs/ui/screenshots/1301/fixtures/qaapp1301.* apps/web/
npm run dev --workspace @jarvis/web -- --host 0.0.0.0 --port 5174
# In another shell, from /workspace/jarvis:
python3 docs/ui/screenshots/1301/fixtures/browser.py
rm apps/web/qaapp1301.tsx apps/web/qaapp1301.html
```

The fixture intentionally uses this executor's `/workspace/jarvis` path.
Remove temporary App entry files before committing or building. Browser artifacts
are synthetic and safe to commit. The fixture does not contact live services.

## Browser assertions and inspection

Passed at 390×844 dark/full motion, 320×700 light/reduced motion, and 1440×1000
desktop dark/full motion. For each size, three actual menu toggles sample 700ms
of animation frames and wait another 2500ms after opening. A deferred settings
response is released after the first animation sample; subsequent settled
frames still match. All target fills and blurs stay constant and menu opacity
stays 1. The composer plus popup is also captured after 2800ms.

A separate internal pixel probe changes only the synthetic stage background
between two colors, samples pixels through every target surface, and restores
the original stage before saving screenshots. Every surface transmits the
change, including header and dock. Measurements are in `measurements.json`;
these checks establish rendered transmission, not just a CSS alpha declaration.
Normal screenshots show the existing fallback scene and were pixel-inspected.

Current Chat, expanded Menu and pressed Workspaces retain plain item backgrounds;
selected icons differ from their labels. Plus toggling, startup-visible dock and
keyboard focus outlines pass. There are no page errors. Existing microphone/send
icon colors, keyboard logic and startup behavior were not changed.

## Local checks

- `npm test --workspace @jarvis/web -- src/stylesheets.test.tsx src/MobileShell.test.tsx src/phone-chat-viewport.test.ts`: 97 passed.
- `npm run lint --workspace @jarvis/web`: passed.
- `npm run build --workspace @jarvis/web`: passed, with existing large-chunk advisory.
- `npm test --workspace @jarvis/web`: final full run passed 153 files / 2369 tests.

The initial full run passed 2367 tests and failed two obsolete source-contract
expectations requiring the old opacity rule and full-label dock selection. Those
expectations were updated to preserve hidden/reduced-motion behavior, require
icon-only selection and retain focus outlines; the final full run passed.

## Limits

The supplied private image transfer failed with
`library file transfer failed: download failed`; the local destination was empty.
Preparation succeeded but the download did not. The helper did not classify a
denial versus connectivity error. This executor did not inspect source pixels
or publish them; it followed explicit text requirements and coordinator context.

Local Node 24.19.0/npm 11.9.0 differs from pinned CI Node 22/npm 10. This is
synthetic Chromium evidence, not physical iPhone/WebKit or live-service
acceptance. Coordinator owns hosted exact-head qualification, review and release.
