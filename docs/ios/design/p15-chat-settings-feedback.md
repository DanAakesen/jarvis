# Settings and Chat feedback — 7 November 2026

This follow-up includes widgets/Tasks/empty activity from PR #1629 plus the owner's
new Settings, Chat interaction and blocked scaffold reports. PR #1629 is merged as
2504bc6a9b0c99d29c14a96bc261e8417df93fa1. Normal backend deployment passed.
Build **79 uploaded successfully at 14:18:29 UTC / 15:18:29 Copenhagen on 7 November 2026** in unchanged
TestFlight workflow [42380495562](https://github.com/DanAakesen/jarvis/actions/runs/42380495562),
from main `2504bc6a9b0c99d29c14a96bc261e8417df93fa1` (PR #1629). Apple processing
and physical device visibility are not independently confirmed.

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

## Qualified changes

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
This confirms the read boundary, not a production scaffold write. Deployment and
Current acceptance are recorded below; the owner must still retest the proposal flow.

## Delivery

Final source 44cbbfcdfcb7594583df6d40737d549f90f845de passed CI 42377620992
(7,391 backend tests passed, one skipped; 509 Core tests passed) and CodeQL
42377620945. Native 42377707190 passed both remaining cases with no failures or
skips. Reuse 17 passing cases from 42373705592, English target editing from
42375612793, and 10 unchanged widget/navigation cases from 42370022661. Only
fixture/test-driver files changed during the final corrections; production UI
source has not changed since f8651cda. All earlier failures are retained below.

Qualified and merged full tree: 05557824a3b533ef5a40789830ab1c7adf76b52c.
Qualified and merged iOS tree: 7c20b275fa8fc8a6fa7fb9bb40757363dfb3e473.
Automatic main Simulator 42378965945 was cancelled before boot after checking
both identities; its boot step had no start time. The validation-only branch
codex/widget-contrast-validation must never merge. No further native run is needed
for this unchanged app/test tree. Xcode 26.6, XcodeGen 2.46.0 and the existing
120/150-second test limits were retained.

CI artifact 13575923537 was downloaded and its SHA-256 verified:
238218fbef8e11789f753417b4d2a370a224743cd1f45496271a5d25f81d7bf5.
The qualification receipt binds PR #1629, the final head and full tree.
Native artifact 13575959044 was downloaded and its SHA-256 verified:
f1a8dd62e549de01ed234efba46e8e661ae4c347af87fe513578ee88cf5cee4f.
Its provenance binds the final source and iOS tree, and the actual summary records
2/2 passing tests on iPhone 17 Pro / iOS 26.4.1.

Inspected native captures include the acknowledgment/live tools, interrupted turn
still Working with a next draft, one compact question bubble, final collapsed
assistant tools, native selection handles across formatted text, English/dark and
Danish/light labelled Settings, accessibility stacking, and corrected empty
Notifications/Chat views. The Current runtime selector/retry and isolated synthetic
conversation passed; normal draft/history preservation is asserted. These fixtures
do not establish live Copilot acceptance or physical microphone/haptic behavior.

Normal backend deployment 42378966004 passed readiness and all 15 Current live
acceptance entries before the single TestFlight dispatch. Its accepted release
receipt binds source 2504bc6a and the qualified full tree. Artifact 13576943195
was downloaded and SHA-256 verified:
88d6229508f039fc1d83c0b920cb943c4a43e8673b8a70d6e680655925a3eedc.
Backend image sha256:1f20b534db942977f51a9f2ceb3aaa17a027728039ef7a6c28ea279bc496e5a7
is ready in revision ca-jarvis-backend-rmw7kae3bza6a--0000536; Current agent version
197 and Web deployed successfully. The single unchanged TestFlight workflow
42380495562 uploaded build 79 from exact main 2504bc6a at 14:18:29 UTC / 15:18:29 Copenhagen on 7 November 2026.
Apple processing/device availability is not independently confirmed.
 The owner's project draft/data remain intact; the read reproduction
performed no writes. Copilot remains disabled after its second policy canary used
the previous turn's policy. See docs/runtime-comparison-owner-test.md for the
comparison guide once compatible activation is possible.

## Owner retest after release

1. Retry “Prepare the widget in Jarvis.” Inspect the proposed scope and wait for
   the normal later approval before creating the issue or starting coding work.
   This release does not approve that separate widget project for the owner.
2. During a long reply, send one “?”. It should appear once in a compact bubble;
   Working/reconnecting feedback should remain until the turn completes. Type a
   next draft while waiting and confirm it stays intact.
3. Dictate and send a message. The composer should clear once and late speech
   callbacks must not restore it. Check both the send button and keyboard Return.
4. Long-press a Jarvis reply and select part of a sentence using native handles.
   Live tools should follow Jarvis's acknowledgment; final tools should be collapsed
   beneath the reply and expand on tap.
5. Check Training targets and other Settings fields: each value has a persistent
   label, including after editing, at the owner's preferred text size.
6. Check lighter widget supporting text, the Tasks widget opening its task tab,
   and no Background activity bar when the activity sheet has nothing visible.

Copilot is still unavailable. Current can be tested in a separate conversation;
use the comparison guide only once faithful Copilot activation is established.

## Retained failed attempts and corrections

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

Final native 42377707190 qualified both corrected cases. The test-owned completion
signal holds Chat until the interrupted Working state and next draft are asserted;
the final capture confirms one compact follow-up, preserved next draft and collapsed
tools beneath Jarvis. The Danish target edit validates and saves the intended value.
No test limit was raised and no assertion was removed.
