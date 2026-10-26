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
network transmission, persistent storage, clipboard or UI. Listeners are passive
and never cancel, stop, focus, submit or schedule browser layout changes. Geometry
reads observe the current layout. Settled microtasks observe cancellation after
existing handlers have run; no events are synthesized by the collector.

This is a diagnostic, not a fix or physical iOS reproduction. Browser event
metadata and viewport dimensions do not prove that a software keyboard is open.
No publication, issue mutation or deployment is included.

## Retrieval plan requiring coordinator decision

The local module currently has only an exported snapshot reader for tests/developer
integration. Owner retrieval is not implemented. The smallest usable owner flow
would add a temporary explicit Copy Send diagnostic action after the normal failed
tap, serializing only these entries to the clipboard. That needs approval for a
new control and clipboard use; sending/pasting the result would be a further
owner-directed transfer. Do not implement those dependent steps under the collector
approval alone. No storage or external telemetry is proposed.

Validation: diagnostic/composer/viewport selection 132 tests passed; isolated
privacy/cleanup suite 2 passed; web lint and TypeScript/Vite build passed with the
existing chunk-size advisory. Tests check unchanged focus and single submission,
content allowlist, no storage/network calls, memory bound, deep-copy reads and
listener/queued-work disposal. No physical keyboard validation is claimed.
