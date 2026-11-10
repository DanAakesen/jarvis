# Watch steps and startup-alert handoff — 10 November 2026

Primary owner: Jarvis2 primary, session `01a1adc7-aebe-76f2-b63d-a852c887204f`.
Secondary implemented these changes; neither PR is merged or deployed by secondary.
Weekly workout designs are deferred and must not be included.

## Approved steps complication

- PR: https://github.com/DanAakesen/jarvis/pull/1696
- Branch: `feature/watch-steps-complication`, based on main `cb360ca7ee691bd07a4b028c760a36c4bb5f336e`.
- Tested runtime commit: `6490aa2a30bbc0f003e81740e753da56811b2b82`.
- [Approved generated design reference](steps-approved-2026-11-10.png): a concept, not a native screenshot.
- Large white step count, full-width amber curve with gradient vertical stems and dashed daily goal. No small labels, target number, axes, calorie footer or weekly workout column.
- Existing snapshot, goal, expiry and local-midnight rules are reused. Core projection distinguishes missing/zero, shares goal/current scale, permits exceeding the goal and preserves incomplete-day coverage.
- Small complications and existing shared controls remain unchanged.
- No new backend, credentials, entitlement, settings storage, infrastructure or offline behavior.

## Reconnect alert

- PR: https://github.com/DanAakesen/jarvis/pull/1692
- Branch: `fix/watch-startup-connectivity-alert`.
- Tested commit: `5de65c01a0504108274c3b3bd3024a3ec2b846f8`.
- The owner reported the identical startup modal again. Main still contains the old unconditional disconnect handler; this patch is implemented but unmerged.
- Quiet startup/idle connectivity; notify only actual reachable-to-unreachable transitions and interrupted sends/voice. Passive history errors stay inline; stale reads cannot override newer typed/voice work. Preserve unsent drafts and avoid recreating acknowledged sends. No automatic resubmission.
- Independent runtime changes: primary can integrate both PRs in either order. Reconcile their shared documentation additions while preserving both records.

## Executed checks

Steps runtime `6490aa2`:

- Existing Actions `swift build` and `swift test`: **550 tests passed**, including all three new plot regressions. [Core job](https://github.com/DanAakesen/jarvis/actions/runs/42765871651/job/129662211349).
- [CI 42765871651](https://github.com/DanAakesen/jarvis/actions/runs/42765871651) and CodeQL passed.
- [Native run 42765852671](https://github.com/DanAakesen/jarvis/actions/runs/42765852671): Watch simulator and physical Watch Release architecture builds passed; isolated fixture previews captured. Paired iPhone simulator compilation also passed. All three native builds are unsigned.
- Final follow-up changes documentation/reference assets and only the widget picker name/description (two string literals); chart/recovery logic remains the tested source above. Fresh follow-up CI/native runs may still be pending. The stable widget kind is preserved.

Reconnect runtime `5de65c0`:

- **551 Core tests passed**, including four recovery scenarios: idle draft, unacknowledged send, acknowledged reply wait and voice interruption. [Core job](https://github.com/DanAakesen/jarvis/actions/runs/42674837332/job/129353495528).
- [CI 42674837332](https://github.com/DanAakesen/jarvis/actions/runs/42674837332) and CodeQL passed.
- [Native run 42674833976](https://github.com/DanAakesen/jarvis/actions/runs/42674833976): unsigned Watch simulator, physical Watch Release and paired iPhone simulator builds all passed.
- [Broad iPhone UI run 42674837701](https://github.com/DanAakesen/jarvis/actions/runs/42674837701): 78 tests ran, six failures in Notes and proactive notification navigation. Full UI qualification is not green; these failures are outside this Watch recovery patch.

[Native Health preview](steps-native-preview-2026-11-10.png) was visually inspected: large count, full-width target/curve and gradient stems are visible without small labels. This actual shared-view fixture is not a watch-face installation. [Build logs and screenshots artifact](https://github.com/DanAakesen/jarvis/actions/runs/42765852671/artifacts/13740277094), SHA256 `a6e6cfd0c531b0c295ade95201c3145f9b8b4545d3623b543ec7d16b118ab2b4`. The broader steps-PR iPhone UI run [42765871895](https://github.com/DanAakesen/jarvis/actions/runs/42765871895) is separate and has not been claimed green.

## Remaining verification and delivery

- Primary reviews, integrates and qualifies combined source, then uses the existing release process. Secondary has not merged, signed, uploaded, released or deployed.
- Installed Ultra 2 watch-face rectangular complication: actual size/readability, long count, goal crossing, missing/true zero, late Watch sync, midnight, Always On, tint and VoiceOver. Fixture captures do not establish actual watch-face acceptance.
- Startup/wrist-up with iPhone foreground, background and locked; opening from a notification; idle connection loss without modal.
- Real active send/voice interruption still reports uncertainty, retains appropriate drafts, stops local audio and never automatically resubmits.
- Confirm fresh history after reconnect and installed iPhone/Watch build identity.
- Real device/transport testing and owner acceptance are unverified. No new runtime dependency between these two patches.

## Primary integration — 10 November 2026

Primary combined exact secondary heads `afa8f8dc` and `5de65c01` on current
main `cb360ca7`, preserving both design and recovery changes. Only the decision
log required conflict resolution; both entries are retained. The saved native
Health preview was inspected and matches the approved steps-only direction;
it remains a fixture, not an installed watch-face capture.

Combined Core, unsigned native builds and CodeQL qualification are pending.
The broader iPhone suite remains separate: the six previously observed failures
are in unchanged Notes and notification navigation. Notes tests still assume
folder controls on the landing page; two notification tests require `chat.send`
when the empty composer deliberately renders `chat.mode`. The transient
notification-context recovery failure remains unresolved. No full iPhone UI
pass or installed-device acceptance is claimed. These known baseline failures
do not establish a regression in this Watch-only bundle.

Release scope is steps plus startup/reconnect recovery. Home brief/daily activity
PR #1689 and deferred workout designs are not included. Primary will upload the
combined signed iPhone/Watch build after changed-source qualification passes.
