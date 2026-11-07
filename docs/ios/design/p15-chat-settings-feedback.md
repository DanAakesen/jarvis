# Settings and Chat feedback — 7 November 2026

This follow-up includes widgets/Tasks/empty activity from PR #1629 plus the owner's
new Settings, Chat interaction and blocked scaffold reports. It is not released.

## Retained evidence

Source e9aa204ba54df16c848cb715ee977ab8f8d227ce, iOS tree
e7c7bc87ef3696d228236aafde0f80e8366a29b6: CI 42369977880 and CodeQL
42369977812 passed. Focused native run 42370022661 passed 10 automated cases.
Artifact 13573512442 SHA-256:
aa8c12379ad5e9c6a943565c7d8e544ee9c4e7fe72c0f1187c6ca08a58796226.
EN-light widgets show darker secondary text and three task rows. Active Notifications
retains approvals and has no Away row. Empty-activity screenshots showed the sign-in
cover because that test omitted the chat fixture launch argument; those screenshots
are not accepted, despite passing AX existence checks. The test now includes the
fixture argument and a hittability assertion. Earlier failed run 42368114024 remains
retained, including the gallery deadline and widget-tab failures corrected in e9aa.

## Changes awaiting native qualification

- Persistent Settings labels, trailing values and accessibility/multiline stacking.
- Native selection across complete formatted Jarvis replies.
- Compact short owner bubbles; exact-ID replacement for steering messages.
- Stopped dictation sessions reject late results and cannot overwrite the next draft.
- Acknowledgment, correlated live tools, final reply and collapsed tool history.
- Persistent active/reconnecting status; interrupted rounds keep the root turn.
- GitHub oversized-page splitting and useful issue-list failure guidance.

## Backend verification

Local focused suites passed: 157 backend tests, 45 contract tests, backend no-emit
typecheck. The pre-fix real repository read measured page 7 at 1,099,352 bytes.
The corrected reader returned 1,626 issue/PR titles in 21 GETs, zero writes.
This confirms the read boundary, not a production scaffold write or deployment.

## Delivery

CI/CodeQL and focused native Settings/Chat checks are pending. Reuse unchanged widget
captures and navigation tests with source-path proof; do not repeat that gallery.
Normal backend deploy/acceptance must precede TestFlight. Keep the owner's current
project draft and data intact. That E2E test is now blocked by the reproduced read
failure; release remains authorized after qualification. Copilot remains disabled after its second policy
canary used the previous turn's policy; docs/runtime-comparison-owner-test.md is the
comparison guide once compatible activation is possible.

The first follow-up CI (42373384283, source 872f3503) built JarvisCore and ran
509 tests with three failed assertions: the older transport-fixture expectation
omitted the two newly surfaced connection-state events, and the UI guard rejected
an inline ad-hoc spinner. The fixture now asserts all six events explicitly and
the tool row uses the existing JarvisLoadingView. No native run was dispatched for
that source. Automatic Simulator 42373384227 was force-cancelled before boot.

Follow-up CI 42373569801 passed all 509 Core tests and Web checks. Backend ran
7,392 tests: 7,388 passed, one skipped and three failed because the activity
privacy allowlist had not included the newly intentional messageId field. The
corrected check explicitly requires the correlated ID on both events and still
rejects every unapproved field or private payload. Its three focused cases pass
locally. Native 42373705592 is the only active Simulator run; the app built and
interaction checks are running against f8651cda / iOS tree
ed7db56a1dc12ddf403850f7f62d91b0c22604b1. This backend test-only correction does
not change that tree or require a duplicate native run.

CI 42374596904 passed on 748f01c0, including the full backend suite. Native
42373705592 completed with 17/20 cases passing and three failed cases. Artifact
13575482150 SHA-256:
353ec5fa4277fccf93596ccf8e72769afbc3b52cc6a9780e54694ea716e9469e.
Its actual reply-selection capture shows native word handles, formatted text and
Copy/Look Up/Translate. The empty Notifications/Chat captures now show the real
views, no Away row and no empty activity bar. Training labels at normal and AX
sizes were inspected; long labels wrap and the large list scrolls.

The controlled Chat fixture returned English for a newly requested Danish session,
so the client correctly rejected it before opening a turn. It now echoes the
requested language and supplies SSE headers. The two Settings edit checks tapped
before the trailing digit, producing 54 instead of 5. They now put the caret after
the current value and assert the replacement value before checking validation/save.
Only these three cases require another native run. Production UI source is unchanged.

Apple API review: UITextView/isSelectable provide a single native rich-text selection
range; TextField documents that iOS uses its label as a placeholder, hence the explicit
persistent label; ViewThatFits selects the compact or stacked arrangement. Sources
are linked in PR #1629. No custom selection handles or gesture recognizers are added.

CI 42375571409 and CodeQL 42375571446 passed on 63f26a0a. Focused native
42375612793 passed the English Settings edit. Chat's single compact follow-up,
cleared composer, retained next draft and final tool placement passed, but its
interrupted-state assertion ran after the fixture's three-second final response.
The Danish Settings check still inserted before the digit: two percent of the
full-width stacked field is wider than half the digit. These two cases remain
unqualified. Artifact 13575669446 SHA-256:
f203ab1c4dc895f8ba92fcbe17d662ab8e4474c77d0f2dd19e31a2d5d0f29e17.

The Chat fixture now holds the response until an explicit test-only Darwin
notification, registered only by the enabled DEBUG Simulator fixture and cancelled
on completion/destruction. It checks progress with the next draft present before
releasing the response; no timed race remains. Settings taps one point inside the
trailing edge regardless of field width. Rerun only Chat feedback and Danish target
editing; reuse the passing English edit and all other unchanged screen evidence.

Native 42377189552 failed during compilation before any Simulator boot: the SDK
does not import notify_register_dispatch/notify_cancel into Swift. The test-only
signal now uses the documented CFNotificationCenterAddObserver/PostNotification
APIs, with an observer owned by the fixture and removed on destruction. Apple’s
API documentation confirms main-thread delivery; the callback hops to the fixture
actor. This is another retained build failure, not native verification.
