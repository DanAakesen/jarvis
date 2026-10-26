# Composer Plus menu (#1319)

Actual App with synthetic dense conversation history, mocked sign-in/HTTP and
browser speech recognition. Chromium uses the existing WebGL fallback. No private
screenshots, real microphone, camera, voice provider or physical iPhone tested.

The popup uses 24px blur and a 94% theme-colored fill. The higher fill matters:
nested backdrop roots can leave underlying chat text sharp despite a computed
blur. This is limited to the composer Plus list and its Language flyout.
The composer/header/navigation and voice menus retain their existing material.

Top-to-bottom DOM, visual and keyboard order is Language, available capture
options, Voice, Attach. Voice reuses the existing `ShellIcon` waveform; Dictate
retains its microphone. The native file input remains mounted and anchored to
Attach while the picker is open and after cancellation.

## Reproduce

From the repository root with web/contracts dependencies and Python Playwright:

```sh
cp docs/ui/screenshots/1301/fixtures/qaapp1301.tsx apps/web/
cp docs/ui/screenshots/1301/fixtures/qaapp1301.html apps/web/
npm run dev --workspace @jarvis/web -- --host 0.0.0.0 --port 5174
# In another shell:
python3 docs/ui/screenshots/1319/fixtures/browser.py
rm apps/web/qaapp1301.tsx apps/web/qaapp1301.html
```

Screenshots cover 390×844 touch emulation and 1440×1000 desktop in dark/light,
with the menu open over dense text and the Language flyout open. Assertions cover
actual rendered order, 24px popup/10px unchanged composer blur, fixed popup alpha,
hit testing, repeated toggles, Home/End/arrows/Escape and restored Plus focus,
native chooser bounds/cancellation, reduced motion and browser page errors.
`measurements.json` records results. Emulation does not establish iPhone/Safari
acceptance. The synthetic fallback status overlaps the top of the long history;
that pre-existing fallback layout is outside this menu correction.

## Qualification

The full `npm ci --ignore-scripts --cache /tmp/jarvis-npm-1319 --no-audit --no-fund`
failed with HTTP 403 for unchanged backend `pkce-challenge@5.0.1` at the locked
Microsoft package feed. No registry, lockfile or TLS settings were changed.
The scoped install succeeded:
`npm ci --ignore-scripts --workspace @jarvis/web --workspace @jarvis/contracts --cache /tmp/jarvis-npm-1319 --no-audit --no-fund`.
Local Node 24.19.0/npm 11.9.0 differs from CI Node 22/npm 10.

- Shared Python: `PYTHONPATH=.github/scripts python3 -m unittest discover -s .github/scripts/tests -v`: 144 tests, 141 passed; 3 setup-vault-mirror errors because `pwsh` is absent.
- `npm run lint --workspace @jarvis/contracts --workspace @jarvis/web`: passed after the action array was declared in final visual order (no render-time reversal).
- `npm run lint`: contracts/backend/vault-mirror passed; the initial web lint found the reversal expression, corrected and rechecked as above.
- `npm run build`: contracts/web typecheck and production build passed (existing large-chunk advisory); backend/vault-mirror blocked by absent packages after the full-install failure.
- `npm test --workspace @jarvis/contracts --workspace @jarvis/web`: contracts 131 cases passed, one file could not import missing `fastify`. Initial web run: 2,387 passed, seven failures. Two obsolete expectations (attachment order and CSS token usage) were corrected; the other five failures involved async UI timing and contrast/workout timeouts while browser/build checks competed for resources. Final web rerun is recorded below.
- `python3 docs/ui/screenshots/1319/fixtures/browser.py`: passed all four viewport/theme combinations. Final captures were visually inspected.
- `npm test --workspace @jarvis/web -- --maxWorkers=2`: **153 files / 2,394 tests passed** on the corrected implementation, without browser/build contention.
- `npm test --workspace @jarvis/web -- --run src/ConversationHistory.test.tsx src/ConversationMoreMenu.test.tsx src/ConversationAttachments.test.tsx src/stylesheets.test.tsx`: **4 files / 195 tests passed**.
- Final `npm run build --workspace @jarvis/contracts --workspace @jarvis/web`: passed, including TypeScript and production build (existing chunk-size advisory).
- Final repeat `python3 docs/ui/screenshots/1319/fixtures/browser.py`: passed after the final array/token changes; captures regenerated.

## Integration hold

Based on main `6ec8af1e` (includes meal recovery #1314). Prepare a draft PR;
do not merge/deploy. The coordinator must integrate after Send #1316 and camera
#1318, preserving removed camera-watch controls and all unrelated documentation.
No edits to VoiceControls or capture-action definitions belong to this change.
