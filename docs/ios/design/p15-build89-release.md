# Build 89 — Watch and intelligent notifications

9 November 2026. Main `f1cc32f917b5868554aa1779f3b66908f4c008d7`.
TestFlight [42635187842](https://github.com/DanAakesen/jarvis/actions/runs/42635187842)
successfully archived, signed and uploaded build 89. Apple processing and
installed availability have not been checked.

## Included

- Apple Watch companion: four complications, Voice/Dictate Home, Chat, tasks,
  workouts, lift management and read-only Factory. The shared App Group and
  arm64_32 archive blockers are resolved.
- Intelligent notifications use saved health, nutrition, notes, memory and
  existing sources. Model-written findings use actual progress and details;
  native notification taps open the matching finding with its available actions.
- Consecutive calls of the same tool are grouped in normal and test Chat while
  preserving attempt counts and refused/error outcomes.
- Earlier Notes/Ember, transparent chrome, Home Today workout totals, chat
  progress/navigation and lift editing remain included.

## Verification

PR #1669 head `811a559e82ea3ea1f711a34628c4137b280d05dd` passed full CI
42633607539 and CodeQL 42633606982. The exact iOS tree
`f8b1a612ea5b9641e7c8b4584d2cd545bc7ca4ff` passed Watch/widget physical Release,
Simulator and paired-iPhone compilation in 42620677050.

Native run 42620677166 passed all three notification checks: open finding/actions
and dismiss, read-only historical finding, and retry after a transient load
failure. Its overall suite failed on three existing Notes tests that still
describe the earlier folder flow. This is not a full native-suite pass. Large
artifacts exceeded the available download limit; no fresh notification screenshot
inspection is claimed.

Backend deployment 42635181674 passed readiness and live conversation acceptance.
Startup applies migration 0076 before listening. APNs activation 42636282777
passed on ready revision `0000565`, using production Key Vault references.
Remote provider acceptance and actual device receipt remain unverified.

## Short installed-device check

1. Install build 89 on iPhone and the paired Watch. Open both, verify the phone
   connection, then open Chat and try dictation/voice. Add a complication, lock
   and wake the Watch, and check that data and navigation remain usable.
2. Allow Jarvis notifications. Ask: “Remind me in two minutes to check Jarvis
   push notifications.” Lock the phone and verify one notification arrives.
   Check Watch mirroring under the device's normal notification settings.
3. Open Proactive and choose Check now. Any finding should use real saved data;
   no useful finding is a valid result. When a finding notification arrives,
   tapping it should open that exact finding and its appropriate actions.

Factory testing is separate and now ready: fresh-image run 42644583506 passed
five-worker lifecycle, storage, cleanup and activation on ready revision 0000568.
The canary made no model calls; start a fresh owner coding task for end-to-end
acceptance. Copilot comparison remains parked.

The 9 November Home report is a new metric-definition/configuration task, not
included in build 89: daily active energy/exercise time and configurable brief
instructions/line count are handed to secondary in
[the implementation brief](home-brief-activity-handoff.md).

Read-only readiness 42646690853 confirmed production APNs and all delivery flags
remain configured on ready revision `0000568` after the final Factory cutover.
This configuration check did not send a push notification.
