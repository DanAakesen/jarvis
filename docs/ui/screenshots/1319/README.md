# Composer Plus menu (#1319)

Actual App with synthetic dense conversation history, mocked sign-in/HTTP and
browser speech recognition. Chromium uses the existing WebGL fallback. No private
screenshots, real microphone, camera, voice provider or physical iPhone tested.

The popup uses 24px blur with the **unchanged** chrome translucent fill (40% of
the existing theme surface). The composer is a backdrop root: increasing a nested
popup's blur did not blur the underlying chat. Both composer sheets now use manual
native popovers, placing them in the browser top layer while preserving DOM ancestry,
file-input anchoring and existing custom focus/close behavior. Only this popup opts
in; other menus and glass surfaces are unchanged. Position follows the trigger every
animation frame while open, including viewport changes. Browsers without native
popover support retain the existing inline menu behavior; the sampling correction
requires native popover support.

Review rejected the first candidate's 94% fill: it reduced transmission without
fixing actual blur. That fill is removed. Regenerated captures show the settled
translucent popup with blurred underlying text, rather than a computed-blur claim.

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
actual rendered order, 24px popup/10px unchanged composer blur, unchanged chrome fill and native top-layer placement,
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

## Integration queue

Integrated main `496182bc226bd3419a8e015ad7e2955e23abb4a1` (meal recovery #1314 and
Send #1316). The coordinator revised the queue: this PR now precedes camera #1318.
No unmerged camera changes were imported. Normal ready-PR qualification and review
are required; the coordinator owns merge/deployment.

## Review correction validation

The top-layer follow-up regenerates all screenshots and repeats viewport/theme,
resize anchoring, repeated Plus close with an open Language flyout, native file
chooser, focus, keyboard and reduced-motion checks. Earlier full-suite results
above describe the first candidate; exact follow-up results are recorded below.

- `npm test --workspace @jarvis/web -- --run src/ConversationHistory.test.tsx src/ConversationMoreMenu.test.tsx src/ConversationAttachments.test.tsx src/stylesheets.test.tsx`: **4 files / 196 tests passed**, including native-popover DOM/focus/toggle/picker retention with a jsdom adapter. Real top-layer rendering is covered by Chromium, not that adapter.
- `npm run lint --workspace @jarvis/contracts --workspace @jarvis/web`: passed. After the final test-adapter/viewport predicate adjustment, `npm exec --workspace @jarvis/web -- eslint src/ConversationMoreMenu.tsx src/ConversationMoreMenu.test.tsx --max-warnings 0` also passed.
- `npm run build --workspace @jarvis/contracts --workspace @jarvis/web`: passed, including TypeScript and production build (existing chunk-size advisory).
- `python3 docs/ui/screenshots/1319/fixtures/browser.py`: passed all four combinations with native top-layer placement, unchanged fill and viewport anchoring assertions. The regenerated mobile and desktop captures were visually inspected; underlying text is blurred rather than merely dimmed.
- The full web suite passed on the first candidate (2,394 tests); exact-head full aggregate qualification after this correction remains for hosted CI. Existing dependency-feed/PowerShell limits remain unchanged; no feed/lockfile workarounds were made.

## Integrated main 496182bc

Merged `496182bc226bd3419a8e015ad7e2955e23abb4a1` with both meal recovery and
one-tap Send. Production files merged automatically. Four documentation
introductions conflicted; both sets of entries were retained. The Send primary
pointer guard matches main. No camera #1318 source is imported; that PR follows
this one in the revised integration queue.

Integrated local verification:

- `npm test --workspace @jarvis/web -- --run src/ConversationHistory.test.tsx src/ConversationMoreMenu.test.tsx src/ConversationAttachments.test.tsx src/stylesheets.test.tsx`: 4 files / **199 tests passed**.
- `npm test --workspace @jarvis/web -- --run src/phone-chat-viewport.test.tsx`: **13 tests passed**.
- `python3 docs/ui/screenshots/1319/fixtures/browser.py`: passed all four mobile/desktop and dark/light combinations; regenerated captures inspected over dense chat text.
- `python3 docs/ui/screenshots/1319/fixtures/integration-send.py`: passed cancelled touch, repeated Send, explicit blur/reopen, interrupted-stream recovery and desktop click, with zero browser errors and intercepted synthetic requests. This copies the existing #1315 script with only the port/output location adjusted; original #1315 evidence is unchanged. Copy its `qa1315.{html,tsx}` fixtures into `apps/web/` and serve Vite on 5174 to reproduce. Results live in `integration-send/`.

The first browser attempt found the old Vite process unavailable after environment
restart; restarting the normal local server resolved it. Physical-device limits
remain unchanged. Exact-head hosted CI and review are required before the
coordinator merges; no local aggregate failure is waived.

- Final `npm run lint --workspace @jarvis/contracts --workspace @jarvis/web`: passed.
- Final `npm run build --workspace @jarvis/contracts --workspace @jarvis/web`: passed, including TypeScript and production bundle; only the existing chunk-size advisory remains.
