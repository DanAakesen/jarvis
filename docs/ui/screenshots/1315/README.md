# Mobile Send focus — #1315

The six-line runtime change prevents primary pointer-down focus transfer on
Send only when the phone composer textarea already owns focus. Native click
and form submission remain the sole submission path. No layout, send queue,
attachment, dictation or recovery behavior is replaced.

## Diagnosis and browser evidence

`baseline.json` records actual ConversationHistory in Chromium touch emulation
at 390×844 with the new guard temporarily disabled. The fixture controls visual
viewport height to 480px while typing and expands it to 844px on blur. The
sequence was pointer-down, pointer-up, compatibility mouse-down, textarea blur,
button focus, then a click on the shell. Send moved from y=419 to y=707; zero
turn requests were made. This isolates a plausible native focus/viewport race,
not a claim that desktop emulation proves the owner's exact phone behavior.

`browser.json` runs the same component with the guard enabled. A native cancelled
touch makes no request. A subsequent touch produces pointer-down/up, click and
one submit, without blur or compatibility mouse-down. The textarea stays focused,
the simulated keyboard remains open and Send stays at y=419. Repeated send,
explicit blur/reopen, interrupted stream recovery and desktop click each retain
their existing semantics. An uncertain delivery leaves the error visible without
automatically restoring/resending the draft. All four requests use synthetic
text and intercepted responses; no real user or food-log write occurs. No page
errors were observed. `touch-focused.png` shows the actual component after two
successful sends, with the empty field ready to type. The blank lower region is
the simulated keyboard area, not native keyboard pixels.

The focused regressions also cover no submit before release, repeated pending
steering, disabled empty draft, cancel, rejected-send draft restoration/resend,
and explicit keyboard activation of Send. Existing tests retain upload, voice,
dictation, queue and interrupted-stream behavior coverage.

## Reproduce

Install existing web/contracts workspaces using the repository lockfile:
`npm ci --ignore-scripts --workspace @jarvis/web --workspace @jarvis/contracts`.
Copy `fixtures/qa1315.html` and `qa1315.tsx` into
`apps/web/`, run the normal web Vite server, then run
`python docs/ui/screenshots/1315/send-browser.py`. The fixture imports the actual
component and viewport hook. Remove the two temporary web fixture files before
lint/build. `--baseline` records a comparison when the guard is locally disabled;
restore the guard before normal validation. Browser traffic outside localhost is
intercepted. Browser script requires Python Playwright and `/usr/bin/chromium`.

## Limits

Physical iPhone/Safari keyboard behavior remains unverified. This is synthetic
Chromium touch/component evidence, not full-App or live acceptance. Local Node
24.19.0/npm 11.9.0 differs from pinned CI Node 22/npm 10. The combined candidate integrates
6ec8af1e (mobile composer visibility, desktop parity, continuous dictation and
accepted meal recovery). Merge remains parent-owned after exact-head checks.

## Original local validation (83563177)

- Full web suite: 153 files / 2,386 tests passed.
- Focused ConversationHistory + phone viewport suites: 113 tests passed.
- Web ESLint: passed with zero warnings.
- Web TypeScript/Vite build: passed; existing large-chunk advisory only.
- Actual-component Chromium touch/cancel/repeat/reopen/interruption and desktop
  script: passed, with zero page errors and only intercepted synthetic requests.
- `git diff --check`: passed.

JSDOM emitted existing canvas/media not-implemented notices. These checks are
local verification, not pinned CI or physical-phone acceptance.

## Combined baseline validation (6ec8af1e)

Retained both sides of adjacent documentation/test additions. Desktop parity had
removed the unused `phone` parameter binding, so restore `phone = false` for the
Send guard. The complete runtime diff against main is this one binding plus the
five-line handler; recovery, original turn identity, dictation and layout code
are unchanged.

The rerun exposed an old fixture limitation: it rendered MobileBottomNav at
1440px even though the real desktop shell does not. The local `qa1315` fixture
mounts that navigation only on phones and otherwise retains the actual component
and viewport hook. Its route mocks now include active-turn discovery. These are
fixture corrections, not application layout changes.

Updated `browser.json` and `touch-focused.png` cover the combined component:
cancel, touch send with stable 480px viewport/y=419 button, repeated send,
interrupted stream, focus reopening and desktop click. On reload, active turn
41/901 reattaches through GET `/conversation/sessions/41/turns/901/events`; the
four prior intentional send POSTs remain exactly four. The recovered reply uses
the original turn identity. Zero page errors; no real traffic or food writes.
The original `baseline.json` remains the earlier controlled negative comparison.

Combined-candidate local checks: full web suite 153 files / 2,395 tests passed;
web ESLint and TypeScript/Vite build passed (existing chunk-size advisory).
The first integrated run failed on the missing phone binding described above;
the final full rerun passes with that correction. No failed run is used as
qualification evidence. `git diff --check` passed.
