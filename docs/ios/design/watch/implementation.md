## Dashboard and personal tasks — 10 November 2026 (#1701)

Source implementation is complete on the issue branch. The current base already
contains the steps/startup and Factory/lift changes described historically below;
do not duplicate or revert them. The owner's latest issue approves the scrolling
dashboard and Today/detail/Auto/Manual task concepts, superseding PR #1700's older
dashboard status. Body Fat selects the permitted preceding-three-calendar-months window.

Local filtering evidence: Swift 6.2.1, `swift test -j 2 --filter JarvisTodayTests`,
23 passed. Today includes overdue plus today; Upcoming contains only future
tasks. Completed/undated and midnight/DST cases are covered. Implementation-owner
reports include 616 Core tests before final integration refinements, 1,241 backend
regressions, 94 real SQL tests and passing backend build/lint. Focused follow-up
checks cover pagination, timezone preservation and definite versus unknown save
outcomes. Native Home count/list tests have not run on this Linux host.

The filtering checkpoint passed all three unsigned builds in run 42828752415;
its capture step failed on a simulator “Scene update failed” launch. That run does
not qualify the combined feature. Run 42836136120 failed Watch simulator and
paired-phone compilation at the nutrition accessibility expression; physical
architecture compilation was skipped. The review fix extracts a String property
with typed amount/goal/prefix/caveat steps, preserving the original `.formatted()`
calls, missing-value copy and partial-intake qualifiers. It also restores
`WatchChoiceBar` to top-level scope without changing the controls.

After merging main with both documentation entries preserved, runtime commit
`c9e05f6a` passes all 618 Core tests, 1,126 focused backend tests, backend build/lint,
Swift parsing and the existing iOS CI metadata check. The new Auto/Manual regression
exercises timeout, malformed success, definite rejection and successful manual
retry with unchanged content, submission identity, timestamp and timezone.
These are state/client tests, not native interaction evidence. Native run
[42857360808](https://github.com/DanAakesen/jarvis/actions/runs/42857360808)
waited ten minutes for a Mac runner, then was superseded by the documentation
head. Run 42859214862 compiled nutrition but failed Watch/paired-phone compilation
on two DisclosureGroups, which SwiftUI marks unavailable on watchOS. Both now
use native links to read-only detail lists; the active editor still owns its
unchanged draft while inspecting the saved task. All 619 Core tests pass after
this correction. All three native builds and new captures still need qualification.
Aggregate CI and the separate iPhone Simulator UI workflow remain draft-skipped,
not passed. GitHub CodeQL run 42857360341 passed its configured
languages (not Swift). Local CodeQL could not create a Swift database and skipped
JavaScript analysis for size; no Swift security-analysis pass is claimed.
Save freezes the submission identity, time and payload in the active editor.
Server receipts survive restarts; Watch-process draft restoration is not claimed.

Remaining acceptance: both task entry points, detail/edit, typed/dictated capture
without auto-submit, independent defaults, English/Danish, failed-save draft and
stable retry; dashboard navigation/swipes and source states; complication expiry,
deep links, Always On/tint, VoiceOver, long text and supported Watch sizes including
Ultra 2. Physical device rendering and interaction are not verified here.
Exact nutrition/task-list complication images could not be retrieved from PR #1700
or repository/session references and still require an authorized transfer from the
design conversation before final visual sign-off. No merge/deployment is performed.

## Startup alert follow-up — 9 November 2026

The owner reproduced the modal "iPhone unavailable. Reconnect and check history before sending again." on ordinary Watch launch, including launches unrelated to notifications. The root cause is the unconditional WatchModel disconnect alert combined with initial WCSession activation reporting not reachable.

Branch: `fix/watch-startup-connectivity-alert`, based on main `f54a4d15d6fa09be73563c3969a342ae20caa4a6`. The separate Home work stays in PR #1689. Primary session `01a1adc7-aebe-76f2-b63d-a852c887204f` owns integration and deployment.

The implementation makes initial/idle reachability status quiet, emits disconnect callbacks on real transitions, preserves active chat/voice failure feedback, and keeps history read errors inline. History results/failures are discarded if a newer typed/voice action supersedes the read. Four Core scenarios cover idle drafts, interrupted unacknowledged sends, acknowledged turns awaiting a reply, and active voice interruption. Tests and native build results are pending; no device verification or deployment is claimed.

Remaining device checks: ordinary launch and wrist-up with phone foreground/background/locked; opening a notification/chat; idle Bluetooth/range loss/reconnection without a modal; a genuine in-flight send/voice loss with feedback and no automatic resubmission; draft retention and history recovery. Signing/installation follow primary's existing release process. No live settings/data, entitlements or infrastructure are changed here.

# Apple Watch implementation handoff

9 November primary follow-up: the owner completed both App Group associations.
Signed archive 42613537731 (build 88) advanced past provisioning and failed on
four JSON safe-integer literals that overflow watchOS arm64_32 Int. The correction
caps line validation at the smaller of the platform Int maximum and JavaScript's
safe-integer maximum, preserving iPhone behavior. The Watch build workflow now
also compiles a Release build for physical Watch architectures without signing.
CI/native qualification and a replacement TestFlight upload remain pending.

Branch: `feature/apple-watch-companion`. PR: https://github.com/DanAakesen/jarvis/pull/1652. Primary: Jarvis2 primary, session `01a1adc7-aebe-76f2-b63d-a852c887204f`.

## Implemented

- XcodeGen Watch app and WidgetKit extension, targeting watchOS 26 with the existing iPhone SDK baseline. JarvisCore declares watchOS support. Watch app reuses the Jarvis app icon. Target device is the owner's Ultra 2; reported watchOS 27.2 needs readback.
- Home: compact Voice, Dictate and Factory rows; Jarvis heading and menu. Chat: iOS-style user bubbles, assistant text, input with mic/voice controls, explicit Send for populated drafts, streamed replies and reconnect history. System dictation appends to an editable draft and never automatically submits. The compact input opens the native draft editor when tapped; mic and voice controls remain inside its bar, avoiding watchOS TextField chrome expanding the row.
- Menu: today's incomplete due tasks, last seven days of workouts, lift history/add/edit/delete. Lift creation retains a submission UUID for idempotent retry; deletion requires confirmation. Factory provides selected-project task lists/details only, no task execution, approval or release controls.
- Four complications: rectangular daily steps/active energy and weekly gym/run/active energy; circular Tasks Today, Dictation and Voice launchers. Phone-local HealthKit statistics aggregate steps and active energy; background reads do not prompt. Missing or permission-hidden samples stay unavailable. Snapshots expire after 15 minutes or date rollover. Sensitive complication data uses privacySensitive.
- WatchConnectivity allow-list with 40 KB payload/64 KB wire bounds, deterministic JSON without slash expansion, correlation, reply timeout and no offline queue. iPhone authenticates using existing JarvisClient; no account token, backend URL or arbitrary HTTP proxy crosses to Watch. Sign-out stops Watch voice and clears context. Snapshots refresh with existing phone widget refresh, Watch foreground refresh and budgeted Watch background/connectivity tasks; watchOS controls timing. Health boundaries follow iPhone Calendar.current; cumulative HealthKit statistics avoid manually adding duplicate sources.
- Duplex voice: Watch captures/plays PCM16 using shared VoiceAudioEngine. Phone connects existing VoiceSessionClient and relays bounded chunks through ordered acknowledged messages. Watch exposes mute/end. Existing iPhone Voice Live Activity controls that same session and is the intended paired-Watch live tile. A phone watchdog ends abandoned sessions after 15 seconds without Watch audio/heartbeat. Disconnect stops local capture.
- WatchDesign.swift supplies shared Watch-native controls because UIKit-backed iOS JarvisControls cannot link on watchOS. SwiftUI paths/system glyphs approximate the approved art; reference PNGs are not fake functioning UI.

## Validation

- Linux Swift 6.2: all 537 JarvisCore tests passed, including seven new WatchContractTests for manual-send drafts, request bounds, expiry/midnight, unavailable health, cumulative chart, lift validation/retry identity and wire allow-list.
- Swift frontend parsing, git diff --check and Watch embed/companion/App Group/audio metadata checks passed locally. All 15 pipeline ImpactTests passed. The full local pipeline suite could not complete because its YAML loader requires Ruby, which is absent here.
- Xcode 26.6 unsigned Watch app, all four complications and full paired iPhone build passed at `ba5bd815` ([CI run](https://github.com/DanAakesen/jarvis/actions/runs/42511464786)). Final post-main-integration revision is recorded below.
- PR-only watch-build.yml compiles Watch and iPhone without signing. DEBUG --watch-fixture previews use synthetic data and make no backend requests; captures target an available Ultra simulator. Final native build/screenshot results are recorded separately below.

## Final revision and visual evidence

- Runtime source: `67d85cf980f4cf6a9b4b6f8fef4ab54042b215c1`, including latest main `c2624d67` and the compact draft-editor correction. Documentation/screenshot commits after this do not change runtime source.
- [Native CI 42512941709](https://github.com/DanAakesen/jarvis/actions/runs/42512941709): unsigned Watch app, all four widgets, isolated simulator captures and full paired iPhone build **passed**. This is build validation, not device voice/connection acceptance.
- Re-ran all **537** JarvisCore tests and all **15** pipeline ImpactTests on this combined source: **passed**. Seven tests are Watch-specific. Full local pipeline suite remains blocked by missing Ruby.
- Inspected raw [Home](native/home.png), [Chat](native/chat.png) and [Health](native/health.png) Ultra-family simulator captures. All three Home actions fit; Chat has compact controls with no oversized native TextField background. Health uses the actual shared layout inside the app, not a captured installed watch-face complication. [Capture provenance](native/README.md).
- Tap/keyboard/dictation, real phone connectivity and voice were not exercised by fixture capture. The approved images remain comparison references; final implementation visual acceptance belongs to the owner.

## Unverified and remaining

- Physical-device capture/playback, WatchConnectivity latency, Bluetooth/speaker routes, wrist-down/silent/background runtime, phone wake/lock behavior and interruptions. Owner accepts testing after primary-coordinated installation, not as a pre-build approval gate. Background audio configuration does not guarantee an unlimited session.
- End/mute from the mirrored iPhone Live Activity on the actual Watch. Existing Activity behavior is reused; no device verification is claimed.
- Signing/provisioning new Watch and widget bundle IDs with the existing App Group. No developer portal or production configuration changed here.
- Full watchOS localization, Dynamic Type/VoiceOver, Always On/tint and owner visual acceptance. Initial Watch copy is English. Native spacing must be checked against references.
- Health lists are bounded to 30 rows. Factory sends the latest 10 compact task excerpts; Chat loads the latest six compact messages. Long replies/history are Unicode-safe excerpts with a full-content-on-iPhone notice. Full data stays on iPhone. Other oversized responses fail visibly.
- A cold-start phone must initialize signed-in composition before serving requests; otherwise Watch asks the owner to open/sign in on iPhone. Standalone/offline operations are unsupported.

## Primary integration

Review the exact CI revision and approved references, arrange signing and installation using the primary release process, then run owner-device checks. Secondary does not merge, deploy, publish or start/recover live Factory tasks. Visual approval is complete; implementation/device acceptance is separate. Design PR #1648 is superseded for integration by this branch, which preserves its reference assets and requirements.


## Primary integration review — 8 November 2026

Primary has taken over PR #1652. The main iOS metadata checks now recognize and
validate both new Watch targets, their embedding and shared App Group. Review
found that live WatchConnectivity reachability was incorrectly hiding fresh
complication snapshots while the Watch app was backgrounded. Cached display data
now remains usable until its actual age/day deadline; actions still require the
phone. Timeline expiry also stops yesterday's values exactly at local midnight.
Apple's WCSession.isReachable, updateApplicationContext and WidgetKit timeline
documentation were checked for these boundaries. Signing and a combined-main
build remain pending. Physical voice/background/live-tile checks remain deferred
until signed installation, as agreed.


Primary combined-source evidence: fa6da450 passed full CI 42520574348 and all
544 Core tests. Native build 42520572882 passed Watch, four complications and
paired iPhone; primary inspected all three fresh captures. Artifact 13633820543
SHA256 ed2755edb65aa10cd2c0b2328c066e3c964e1bb649ebdac151e31a21815e2b8a.
A follow-up generation guard prevents an old cancelled chat from clearing the
new account's chat-task ownership. Current repair #1658 is integrated without
changing the qualified iOS tree fd5467327a30ac926c91ec055a06d8f940092c8c.
Focused native interaction run 42521342696, signing and upload remain pending.


## Factory creation and lift input correction — 10 November 2026

The owner now requests a selected-project Factory plus action and typed/dictated free text, extending the earlier read-only Watch scope only for explicit task creation. New task reuses existing FactoryTaskSubmission/backend idempotency through the paired phone, defaults the project agent and preserves unchanged/revisited draft identities on manual retry. No policy/recovery/merge/deployment controls or offline send queue.

WatchTextInput adds system mic entry alongside native typing for Exercise, Factory Title/Request and Message draft. Reps/Sets now open bounded swipe/Crown wheel pickers; returning preserves the rest of the form. Add lift is a visible plus action row. Empty health query status is accepted; unavailable health no longer claims the phone is disconnected. Histories reload after reachability changes.

Branch feature/watch-factory-lift-inputs is independent from primary's #1697 steps/startup bundle. WatchContract, WatchChatView and WatchConnection have distinct changes to preserve at integration. Eight Core regressions and new DEBUG-only in-memory fixture captures are included. All 555 Core tests, full CI and CodeQL passed at e4a5ab28. Native run 42775120796 attempt 2 passed all three unsigned builds. Lifts, New lift, Reps and New task fixture views were visually inspected; the selected-project capture is a startup frame and is not visual proof. No live task was created. [Final handoff](factory-lift-inputs-handoff-2026-11-10.md) records evidence and device checks. Required device checks: native typing/dictation on every free-text field, cancellation/draft retention, swipe/Crown Reps/Sets at large text, save/edit/delete lift, empty versus disconnected histories, project-scoped task receipt and unchanged manual retry. Do not start live Factory tasks during secondary testing.

Review correction: stored high-rep lifts are preserved without clamping. Watch validation now reuses JarvisLiftDraft; reps support 1–1,000 and sets 1–100. Unsupported/corrupt records are explicitly blocked from Save instead of normalized. Regression tests cover an unrelated weight edit preserving 150 reps and invalid/fractional/huge counts without conversion traps.


## Steps-only complication follow-up — 10 November 2026

Owner approved the amber vertical-stem steps concept. Implementation removes all small text, the target text, time axis, calorie footer and weekly workout column. A large white count and full-width amber cumulative curve/stems remain, with a dashed goal line. The existing hourly snapshot, positive configured step goal, freshness and midnight rules are reused. Missing readings show an em dash and no invented curve; true zero remains zero. Over-goal days expand the common scale rather than clipping progress. Partial days retain their actual hourly extent. Small complications and Watch chat controls are unchanged.

Branch `feature/watch-steps-complication` starts from main cb360ca7. Core tests cover goal crossing, missing/zero/invalid goals and partial-hour interpolation without future extrapolation. All 550 Core tests, CI and CodeQL passed at 6490aa2. Native run 42765852671 passed all three unsigned builds. The [isolated Health preview](steps-native-preview-2026-11-10.png) was inspected for count, full-width chart, stems and target line; it uses the actual shared view, not an installed watch-face complication. Final picker-copy/reference/docs follow-up checks are pending. Physical Watch verification is not claimed. Device checks: installed rectangular family at Ultra 2 size, long counts, Always On/tint, VoiceOver, before/after goal, missing/zero readings, late sync and midnight.

Reconnect alert: the owner reported the same startup modal again. Main still has the defect; PR #1692 at 5de65c01 implements quiet startup/idle connectivity and inline passive history errors, retaining feedback for active sends/voice. It passed 551 Core tests and all three unsigned native builds. It remains unmerged; broad iPhone UI qualification reports six Notes/push-navigation failures. Primary owns integration, release and actual connectivity acceptance. Weekly gym/run chart designs are deferred.


[Full steps/reconnect handoff](steps-reconnect-handoff-2026-11-10.md) records exact tested commits, CI, remaining checks and primary ownership. The stable widget kind is preserved; its picker name/description now describe daily steps. [Approved concept](steps-approved-2026-11-10.png) is generated design evidence, not a native capture.
