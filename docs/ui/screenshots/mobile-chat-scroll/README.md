# Mobile chat scroll focus — local verification

Base: `496182bc226bd3419a8e015ad7e2955e23abb4a1` (includes the deployed Send guard).
Only `phone-chat-viewport.ts` changes runtime behavior. Its document touch-down
handler previously blurred `#message` before native scrolling could start.
Dismissal now waits for release, cancels after movement beyond 8 CSS px (including
movement visible only at release), native scroll or pointer cancellation, and
only blurs the original still-focused editor. No preventDefault is added.
Composer/menu exemptions and the Send handler remain unchanged.

## Browser evidence

`baseline.json` uses the old hook with the same fixture and CDP native touch
sequence: textarea focus is lost, simulated viewport expands 480 → 844, and
keyboard-open becomes false. `browser.json` uses the fix: transcript scrollTop
moves 5606 → 5461 while textarea focus, draft and simulated 480px viewport remain.
Typing ` continued` via keyboard input without refocusing extends the draft;
one Send tap produces exactly one intercepted POST and leaves the input focused.
Additional fixture button/link taps dismiss intentionally and activate normally.
No page errors. `touch-scroll-send.png` shows the actual component after Send.

The fixture imports actual ConversationHistory, CSS, viewport hook and mobile
navigation. It derives from the Send fixture, adding the real host class and a
bounded window height so history can scroll. Forty synthetic messages provide
overflow. All non-local requests are intercepted. Earlier fixture attempts lacked
valid history fields/bounded overflow; those failed checks are not acceptance.

## Reproduce

1. Install locked web/contracts workspaces:
   `npm ci --cache /tmp/jarvis-npm-cache --ignore-scripts --workspace @jarvis/web --workspace @jarvis/contracts`.
2. Copy `fixtures/qa1315.html` and `fixtures/qa1315.tsx` into `apps/web/`.
3. Run `npm run dev --workspace @jarvis/web`.
4. Run `python docs/ui/screenshots/mobile-chat-scroll/browser.py` with Python
   Playwright and `/usr/bin/chromium` available.
5. Remove the two temporary web fixture files before lint/build.

`--baseline` records comparison output with the base hook temporarily restored;
always restore the fixed hook afterward. No live backend or personal data is used.

## Validation and limits

- Focused viewport + ConversationHistory suites: 120 tests passed.
- Full web suite: 153 files / 2,400 tests passed (331.34 seconds, two workers).
  JSDOM emitted existing canvas/media not-implemented notices.
- Chromium at 390×844: real touch scrolling, focus/draft retention, continued
  typing, single-tap Send and genuine outside button/link activation passed.
- Keyboard height/blur response is simulated. Native iOS keyboard, physical
  Safari and full-App acceptance are not claimed.
- Environment Node 24.19.0/npm 11.9.0 differs from pinned Node 22/npm 10 CI.
- Initial install failed because the default npm cache was unwritable; the
  same lockfile installed successfully using a writable `/tmp` cache.
- Web ESLint passed with zero warnings.
- Web TypeScript/Vite build passed; existing chunk-size advisory only.
- `git diff --check` passed.

## Integration scope

No ConversationHistory, camera, menu, Health, CSS or dependency-file changes.
The runtime fix preserves menu DOM-ancestry exemptions, including a native
popover that remains under the same menu nodes. Concurrent camera/menu branches
were not merged or tested here. Documentation additions at the tops of shared
files may require retaining both sides during integration.

## Final local review follow-up

Review found that a second finger could replace the pending touch candidate and
blur the composer on release. A regression failed against `f292859b` (20 passed,
1 failed). Only primary touches now become candidates; a secondary touch first
cancels the existing candidate, so neither finger's release dismisses it.

The revised focused suites pass 123 tests. New cases cover second-finger release
and a later normal tap, a 5px intended tap with unprevented release, and exact
global-listener removal plus pending-press abandonment on disable/re-enable and
unmount. Existing cases cover move-away-and-back, release-distance-only movement,
pointercancel, captured descendant scroll and focus transfer to another editor.
The actual-component Chromium swipe/type/Send/button/link scenario passed again.
The fixture imports `./src/phone-chat-viewport` directly when copied into
`apps/web`; it does not contain a copy of the hook. The 2,400-test full-suite result
above belongs to the initial commit, before this primary-touch guard.
Web ESLint and TypeScript/Vite build also pass after the review correction;
Vite retains its existing chunk-size advisory. `git diff --check` passes.
