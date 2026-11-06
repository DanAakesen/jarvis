# P15 release checkpoints

## Current device-feedback follow-up

The owner is testing build 76 and accepts Voice/history, Home send/camera,
task/reminder creation, Health pull refresh and compact task rows. The active UI
follow-up is PR #1621: local shimmer, generic task-source suppression, transparent
headers/floating docks, clear-glass selectors, consistent medium widgets and real
Body trend graphs.

The final UI source 1766b727 is qualified and merged as 380782a0. CI 42280051912
passed, including 502 Core tests, and CodeQL 42280051874 passed. Native coverage
is 67 passing cases in 42268563484 plus the focused gallery pass in 42280276801;
production source and the other 67 tests are identical. Both widget languages,
Health graphs/detail/Back, accessibility, task scrolling, transparent controls and
local shimmer motion were inspected. Retained failures are recorded separately.

Merged full tree: 8c18563542ef60ac423d4397ba3a3bc7d1837989; app/test tree:
70f5cefe1e153390376cfab48b50e099c1f7fde4. The automatic main simulator was cancelled
before boot after this identity check; no duplicate simulator was run. Normal
Deploy 42281871580 passed readiness and is checking live conversation acceptance.
The authorised TestFlight upload follows acceptance; no new upload is claimed yet.

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
