# P15 release checkpoints

## Current checkpoint — build 80

Build **80 uploaded successfully at 17:06:13 UTC / 18:06:13 Copenhagen on 7 November 2026**
in unchanged TestFlight workflow [42394179996](https://github.com/DanAakesen/jarvis/actions/runs/42394179996),
from main `294a7929b8a21ef89fa36a8f0b1152461b0c9530` (PR #1631). Apple processing
and physical-device availability are not independently confirmed.

CI 42392412036, CodeQL 42392412015, independent review and all seven scoped native
cases qualified the exact merged source. Six unchanged cases are retained from
42390300501 and the final Chat case passed in 42392408582; actual page and Chat
captures were reviewed. Normal Deploy 42393878132 passed readiness and required
live acceptance before upload. Source proofs, artifact hashes, owner checks and
limits are in [the build 80 record](p15-build80-release.md).

The prepare-prompt backend fix is already live, and the owner was told to retry.
The Notes carousel/folder/editor image is selected for refinement but is not built
in this release. Copilot remains unavailable without a trusted compatibility receipt.
Earlier release outcomes below are historical and do not override new owner feedback.


## Completed Settings/Chat/widget/scaffold follow-up — build 79

Build **79 uploaded successfully at 14:18:29 UTC / 15:18:29 Copenhagen on 7 November 2026** in unchanged
TestFlight workflow [42380495562](https://github.com/DanAakesen/jarvis/actions/runs/42380495562),
from main `2504bc6a9b0c99d29c14a96bc261e8417df93fa1` (PR #1629). Apple processing
and physical device visibility are not independently confirmed.

The backend fixes oversized GitHub issue-list reads that prevented scaffold drafts,
with safe failure guidance and the existing later-approval requirement. Chat clears
sent dictation, reconciles steering by saved ID, keeps progress visible, fits short
owner bubbles to their text, groups tools under Jarvis and supports native text
selection. Settings fields keep their labels. Light-mode widget text is darker;
Tasks replaces the Notes widget and opens its task tab. Away mode is removed from
iOS Notifications and an empty activity bar stays hidden.

CI 42377620992 and CodeQL 42377620945 passed. All 20 scoped Settings/Chat/Home cases
are qualified from the final two-case pass 42377707190 and unchanged earlier passes;
10 widget/navigation cases are retained. Actual screenshots were inspected. The
merged full tree `05557824a3b533ef5a40789830ab1c7adf76b52c` and iOS tree
`7c20b275fa8fc8a6fa7fb9bb40757363dfb3e473` exactly match qualification. Main Simulator
42378965945 was cancelled before boot after verifying identity. Normal Deploy
42378966004 passed readiness and all 15 Current acceptance checks before upload.
No duplicate native run is needed for this source.

Copilot remains disabled: trusted dynamic-policy compatibility has not passed
and there is no valid receipt. Do not weaken the receipt gate or run another unchanged activation attempt.
The [scoped record](p15-chat-settings-feedback.md) retains failures, artifact hashes
and the owner's retest checklist. Physical dictation, haptics and widget-host behavior
remain owner checks. Earlier pending-state notes below are historical.

## Completed Home/chrome/widget follow-up — build 78

Build **78 uploaded successfully at 22:48:32 UTC / 23:48:32 Copenhagen on 6 November 2026**
in unchanged TestFlight workflow [42306553415](https://github.com/DanAakesen/jarvis/actions/runs/42306553415),
from main `ca5ca838399be5debe2115c4b2ba6879f3f062a9` (PR #1625). Apple processing and
physical device visibility are not independently confirmed.

Home now has Home / Quick actions / Upcoming headings, aligned hero titles/periods,
distinct orange agenda icons and native task swipe completion. At accessibility
sizes its log actions and activity groups stack with readable labels. Shared
headers and Notes/Factory footer containers are transparent. Every widget family
has one registered topic link: Workouts/Steps → Health, Factory → Software Factory,
Notes → Notes and Home → Home. Accepted loading/widget visuals and Chat appearance
are preserved.

CI 42302597659 passed (502 Core tests) and CodeQL 42302597761 passed. Native coverage
is 55 unchanged cases from 42292434058 plus all 15 Home/widget cases passing in
42302707513 on exact candidate `c4e141551c35c2d6c4c6895112cf1b6ade54f8f7`.
The full run's one incorrect Home geometry assertion remains recorded; it measured
glass accessibility content bounds rather than visual insets. The final focused
run retains unchanged 120/150-second per-test limits and verifies source identity
outside the corrected Home views/Home-only tile. Actual bilingual light/dark,
AX XXXL, native swipe, shared header/dock and widget destination captures were reviewed.

Merged full tree `9ecf8636632db51d8a47768d8b8e51cf5eca65f2` and iOS tree
`169764ccd98da54bbe309ef0766cba9da65df004` exactly match qualification. Automatic main
Simulator 42306089300 was cancelled before boot after proving identity. Normal
Deploy 42306089293 was accepted with readiness and all 15 Current checks passing
before the single TestFlight dispatch. No further Simulator run is needed for this
unchanged app/test tree. Physical widget-host taps, Face ID and haptic feel remain
device checks; native cold/warm URL delivery passed.

See [the scoped record](p15-home-hierarchy-feedback.md) for retained failures and artifact digests.
Earlier pending-state notes below are historical. Copilot remains unavailable under
the previously recorded provider-policy gate; this release does not enable it.

## Completed device-feedback release — build 77

The owner is testing build 76 and accepts Voice/history, Home send/camera,
task/reminder creation, Health pull refresh and compact task rows. The released UI
follow-up is PR #1621: local shimmer, generic task-source suppression, transparent
headers/floating docks, clear-glass selectors, consistent medium widgets and real
Body trend graphs.

Build **77 uploaded successfully at 19:54:10 UTC / 20:54:10 Copenhagen** in unchanged TestFlight
workflow [42282578034](https://github.com/DanAakesen/jarvis/actions/runs/42282578034),
from main `380782a02712322090de54d577991420351f460e` (#1621). Apple processing and
owner visibility of this build are not independently confirmed.

CI 42280051912 passed, including 502 Core tests, and CodeQL 42280051874 passed.
Native coverage is 67 passing cases in 42268563484 plus the focused gallery pass
in 42280276801 on identical production source. Both widget languages, Health
charts/detail/Back, accessibility, task scrolling and transparent controls were
inspected; unchanged shimmer was reviewed in a complete 6.398-second recording.
Earlier failed attempts remain in the delivery record and are not described as
passes. Widget host tint/refresh, physical haptics and live HealthKit remain device
checks.

Merged full tree: `8c18563542ef60ac423d4397ba3a3bc7d1837989`; app/test tree:
`70f5cefe1e153390376cfab48b50e099c1f7fde4`. Both exactly match the qualified candidate.
Automatic main Simulator 42281871658 was stopped during partial compilation before
boot, after proving identity. Normal Deploy 42281871580 was accepted with readiness
and all 15 Current conversation checks passing before TestFlight dispatch.

Backend PR #1624 / 1fb0f908 deployed successfully in 42258321357 with all 15 Current
acceptance checks passing. Its exact compatibility gate is accepted. Copilot itself
remains unqualified because trusted-policy diagnostics failed; do not activate it
by omitting/demoting Jarvis instructions or repeat provisioning without new evidence.

Build 76 uploaded from ab464314 in 42215302636 at 12:14:34 UTC / 13:14:34 Copenhagen;
the owner confirmed it is available. Its app/test tree was b9bd418f6d41c1fb9cc35450d1da9711eaf1c81a,
with 68/68 native tests and inspected captures. Later instructions authorize the
functional Chat/voice fixes and runtime-testing Plus option while preserving Chat
appearance. The previous CI hold was lifted; release remains authorized after checks.
Read the [delivery record](p15-device-feedback-2026-11-06.md) for full provenance and
historical failures. Do not reuse build 76 evidence for the changed rendering.

## Original board release — build 75

The non-Chat board alignment and owner-selected Home/success polish were uploaded
to TestFlight as **build 75**. Read the [release record](p15-release-2026-11-06.md)
for actual commits, CI, native screenshots, backend dependency and upload evidence.
Original continuation: `codex/p15-board-integration`, checkpoint `ab346d91`.

The merge order was #1604 → #1605 → #1606 → #1607 → #1608 → #1610. Notes backend
readiness and live acceptance passed before upload. #1609 was validation only and
was never merged. ChatModel, ChatScreen and shared orb remain unchanged.

Apple processing: not independently confirmed; no matching Apple processing email was available at 02:55 UTC.
Physical haptic feel, live VoiceOver and real HealthKit permissions remain device
acceptance checks. Other UI suggestions remain proposals in PLAN.md.

No additional simulator run is needed for the released source. The final verified
app/test tree is `cbc38ea1979d6a7d5b82e3bec1482bd04676f1cc`. The integration verification document retains
both earlier failures and their corrected evidence. Do not reuse a historical
pending-state note as a new blocker or restart the completed work.
