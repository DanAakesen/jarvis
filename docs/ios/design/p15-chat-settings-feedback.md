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
E2E project test undisturbed. Copilot remains disabled after its second policy
canary used the previous turn's policy; docs/runtime-comparison-owner-test.md is the
comparison guide once compatible activation is possible.

The first follow-up CI (42373384283, source 872f3503) built JarvisCore and ran
509 tests with three failed assertions: the older transport-fixture expectation
omitted the two newly surfaced connection-state events, and the UI guard rejected
an inline ad-hoc spinner. The fixture now asserts all six events explicitly and
the tool row uses the existing JarvisLoadingView. No native run was dispatched for
that source. Automatic Simulator 42373384227 was force-cancelled before boot.
