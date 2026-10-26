# Temporary passive Send diagnostic — local only

Based on main `92fbd42c`. The speculative Send mouse-down fallback is absent.
`send-diagnostic.ts` stores at most 128 allowlisted event snapshots in module
memory. It attaches only to the visible phone typing composer and removes all
listeners/queued recording on disposal. Reload clears the buffer; a new collector
resets it. `readSendDiagnostic()` returns deep copies of the bounded snapshots.

Allowed data: relative elapsed milliseconds; event type/phase; target and focus
categories composer/send/other; defaultPrevented; button disabled; whitelisted
pointer kind; numeric viewport dimensions/offset/scale and Send rectangle.
No input/change/keypress listeners, message text, draft length, DOM attributes,
HTML, URLs, tokens, file/photo content, health data, event payload serialization,
network transmission or persistent storage. Clipboard writing occurs only through the explicit Copy Send diagnostic action; clipboard reading is absent. Listeners are passive
and never cancel, stop, focus, submit or schedule browser layout changes. Geometry
reads observe the current layout. Settled microtasks observe cancellation after
existing handlers have run; no events are synthesized by the collector.

This is a diagnostic, not a fix or physical iOS reproduction. Browser event
metadata and viewport dimensions do not prove that a software keyboard is open.
No publication, issue mutation or deployment is included.

## Approved retrieval

On the visible phone typing composer, Plus contains a temporary Copy Send diagnostic
item above Voice, with Attach still nearest Plus. It writes a snapshot of at most
128 entries to the clipboard only after explicit selection. It never reads the
existing clipboard. No automatic upload, paste or persistence is performed.
Existing toast feedback reports copied, empty, unavailable and rejected outcomes;
errors use fixed text rather than exposing permission exception details. The action
is disabled while a write is pending. The owner chooses whether to paste/share it.
Desktop and voice menus do not gain the action.

Reopening #1315 and publication remain blocked at the previous approval boundary.
No connected owner-message reader is available in this executor, so the new approval
was not independently verified and the denied operation was not retried.

Validation: diagnostic/composer/viewport selection 132 tests passed; isolated
privacy/cleanup suite 2 passed; web lint and TypeScript/Vite build passed with the
existing chunk-size advisory. Tests check unchanged focus and single submission,
content allowlist, no storage/network calls, memory bound, deep-copy reads and
listener/queued-work disposal. No physical keyboard validation is claimed.

Copy tests cover bounded metadata, no clipboard reads, explicit-press-only writes,
empty/unavailable/rejected results, content privacy and UI success/failure feedback.
Final focused diagnostic/composer/viewport selection: 136 tests passed.

## Broader composer report and browser result

Owner reports that all composer taps first dismiss the keyboard, whereas transcript
taps/scroll work. Source inspection finds ordinary controls under the actual
`.conversation-input` ancestor; native top-layer menu sheets retain DOM ancestry.
The outside-dismiss predicate exempts that ancestor and menu sheets. No verified
shared application blur cause was found. Native control focus plus viewport
movement is a candidate, not a proven owner-device event chain.

The trace now distinguishes fixed categories for Plus, Dictate, handle, menus and
composer surface, and records both target-closest and composedPath containment.
No labels, IDs, DOM paths, text or payloads are copied. Path containment is captured
before dispatch completes and retained for the settled record.

Actual-component Chromium browser script `browser.py` passed real touch scrolling
145px, retained focused draft, continued keyboard typing, single-tap Send, explicit
copy of 60 content-free entries, and outside button/link activation, with zero
page errors. It grants clipboard permissions and reads the clipboard in the TEST
HARNESS only to assert the production write; application code never reads it.

Keyboard geometry is simulated (480px while typing, 844px after blur). In that
controlled setup the first Plus tap did not open the menu: blur-driven expansion
moved the control. The second tap with keyboard closed opened it and copy passed.
`browser.json` explicitly records `first_plus_opened: false`. This is not a
claim that the broader composer bug is fixed, nor physical iOS reproduction.
No event handlers are disabled or replaced in this diagnostic browser scenario.
The first browser attempt hit a stopped dev server; an earlier menu attempt timed
out before clipboard access. Only the completed run is acceptance evidence.

Final focused suite: 137 tests passed. Web lint and TypeScript/Vite build passed.
No full-suite or hosted qualification is claimed for this UI follow-up. No external
issue/PR mutation attempted because direct owner-reader verification is unavailable.
