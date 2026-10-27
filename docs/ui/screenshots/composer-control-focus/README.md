# Mobile composer control focus (#1315 follow-up)

Base: main `159677cb` with the approved diagnostic, corrected sampling, scroll
preservation and bubble material/fade changes. No speculative pointer-guard
bypass is used for this correction.

## Evidence and implementation

The coordinator supplied the owner's iPhone diagnostic sequence: Send pointer-down
settled prevented=true, then a later mouse-down prevented=false, textarea focusout,
focus=other and changed button Y; the delayed mouse-up/click hits the composer rather
than Send. Plus and Dictate show the same later mouse-down/focus/geometry sequence.
All reported target/path containment checks are true and Send is enabled. This
owner-provided evidence was not independently captured on a physical device here.

Source matches that gap: Send had only a pointer-down guard; Plus/Dictate lacked
the focus guard. A form-scoped primary mouse-down handler now preserves textarea
focus on phone toolbar controls only while that textarea owns focus. Native click
remains the sole action/submission path. Existing Send pointer-down guard stays.

Opt-in integration API: a toolbar button inside `#conversation-composer` may use
`data-preserve-typing-focus`. Send/Dictate opt in. The existing Plus trigger is
matched by `.composer-more > .more-menu-trigger`; menu items are excluded. A future
appropriate toolbar control can opt in without changing global handlers. The
separate Stop share feature is not implemented here. Desktop, secondary presses,
unfocused composer, intentional menu focus, native cancellation/drag and transcript
scrolling retain their existing behavior. No CSS, telemetry or diagnostic removal.

## Tests and browser limits

Three owner-sequence unit cases fail on unchanged main at the uncancelled later
mouse-down assertion. The correction passes those cases for SVG descendants of
Send/Plus/Dictate, no action before click, one Send only, preserved draft, intended
Language-menu focus and dictation activation. Additional cases cover cancelled/
dragged presses, ordinary desktop/unfocused phone behavior and keyboard activation.
Existing recovery/queue, diagnostic privacy and scroll suites remain included.

`browser.py` has two distinct modes:
- Recorded-order replay: synthetic pointer/touch/mouse events follow the supplied
  ordering with production handlers intact. The script explicitly models native
  focus only if mouse-down was not cancelled, then hit-tests the original screen
  coordinates for release/click. It does not claim dispatchEvent creates native
  mouse focus defaults, nor that Chromium naturally reproduces iOS's later mouse
  event after cancelled touch pointer-down. Baseline imports exact unmodified main
  ConversationHistory source in a separate temporary module; no event guard is
  disabled or replaced. The expected baseline misses each control; fixed presses
  cancel mouse focus and execute the original click once.
- Native Chromium touch: actual CDP cancel/tap sequences with intact handlers check
  normal focus/action semantics, independently of that recorded-order replay.

Both modes simulate keyboard viewport geometry (480px focused, expansion to 844px
on blur), use a bounded component fixture and intercepted synthetic backend
responses. Geometry/direction need not match the owner's physical viewport numbers.
No physical iPhone/WebKit/software keyboard, live speech or live service writes are
claimed. The recognition fixture verifies control behavior without real microphone
access. The original scroll fixture separately checks real transcript scrolling,
continued keyboard input without refocus, Send and intentional outside controls.

## Reproduce

Install existing dependencies and Python Playwright/Chromium. Copy
`../mobile-chat-scroll/fixtures/qa1315.*` into `apps/web`. For the baseline page,
copy `qa1315.tsx` to `qa-composer-baseline.tsx`, changing only its component import
to `./src/ConversationHistory.baseline`; copy the HTML with that script path.
Create that temporary module with
`git show 159677cb:apps/web/src/ConversationHistory.tsx > apps/web/src/ConversationHistory.baseline.tsx`.
Run normal web Vite server and `python docs/ui/screenshots/composer-control-focus/browser.py`.
Remove all temporary fixture/module files before lint/build. No dependency or
production configuration changes. Local Node24/npm11 differs from pinned CI.

Completed local checks: 153 focused tests passed; web ESLint and TypeScript/Vite
build passed (existing chunk-size advisory). Browser comparison: all three baseline
recorded-order cases miss, all three fixed replay cases activate once, all three
fixed native-touch cases activate once. Native cancel and drag-away activate none.
Plus intentional Language focus/selection, Send no duplicates and Dictate draft
retention pass. Separate native transcript scroll moved 145px while keeping focus,
continued typing and a single Send; outside buttons/links still activate. Zero
page errors. Browser screenshots were inspected; no geometry/style change shipped.
Full web: 155 files / 2,437 tests passed in 244.21 seconds. Existing JSDOM
canvas/media notices emitted. No assertions/timeouts weakened.
