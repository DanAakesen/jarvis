# P15 release checkpoints

## Current device-feedback follow-up

The owner is testing build 76 and reports that Voice/history, Home send/camera,
task/reminder creation and Health pull refresh work. A new combined native
correction is in progress for per-element shimmer, generic task-source labels,
transparent headers and floating Notes/Health docks. These edits require one new
simulator qualification with actual screenshots/motion review before another upload;
do not reuse build 76's app-tree evidence for the changed rendering.

The subsequent owner-approved fixes merged through #1614 as `ab464314`.
CI, CodeQL and all 68 native UI tests passed; the corrected task rows and shared
controls were visually inspected. The app/test tree is
`b9bd418f6d41c1fb9cc35450d1da9711eaf1c81a`; do not repeat its simulator run for
backend-only or documentation changes.

Normal backend/agent/web deployment and live conversation acceptance passed.
Explicit Copilot comparison activation failed before its response canary. A
read-only inspection found one older version and no current-manifest match.
PR #1617 corrected the confirmed version-creation endpoint mismatch; provisioning
then succeeded, but the actual response rejected the instructions override.
PR #1619 qualified and merged the complete-policy developer-input correction;
its live check reused the existing version with definition refresh false, then
failed with HTTP 400 `invalid_request` without a field hint. A separate fixed-input
diagnostic qualified through #1620 and merged as `2b58f2f2`; deploy the hosted agent,
then explicitly run `diagnose_managed_chat=true` with all other comparison inputs
false. Do not guess the remaining incompatibility or repeat provisioning. #1618 also
qualified and merged a post-build OIDC refresh after a registry authentication
failure. Copilot inference remains unverified. TestFlight build **76 uploaded at
12:14:34 UTC / 13:14:34 Copenhagen** from verified main ab464314 (42215302636).
The normal backend dependency is accepted; Copilot activation continues separately.
The owner confirmed build 76 is visible in TestFlight; device testing is underway. Read the
[device-feedback delivery record](p15-device-feedback-2026-11-06.md) for exact
runs, retained evidence and current delivery status. Later owner instructions
authorize functional Chat/voice fixes and its runtime-testing Plus option while
preserving the existing Chat appearance. The previous CI hold was lifted.

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
