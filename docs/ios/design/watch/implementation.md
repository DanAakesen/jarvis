## Quick lift capture and integration handoff — 10 November 2026 (#1705)

The approved generated references were retrieved from `009750f0932e6d49af370af73618160ed8ef6fae`; they are not screenshots of this implementation. Quick capture adds a shared `jarvis-watch://log-lift` destination, editable native text/dictation, explicit Save and the existing Voice experience. The backend extracts only one lift through the existing JSON model port and creates it through existing lift storage. Missing details do not write. The operation key persists before sending; an unknown outcome locks the submitted text for same-operation manual retry rather than offering an unsafe fresh save. A server-confirmed deleted operation is a terminal failure, not success or an unknown outcome: retain the original input and permit a fresh operation only through explicit Log another lift.

### Coordination with #1703

PR #1703 was inspected at `b9e5ee86a824092eccff594419271a31448af219`; it was not merged. Preserve its Today/Upcoming filtering, task submissions/store/migration, backend wiring, dashboard, full views and all existing widget kinds.

A read-only `git merge-file -p` rehearsal against common base `3358ea6d0d64eff1b68e15103bd2172b37526ffb` found textual conflicts in `Watch/JarvisWatchApp.swift`, Core `Watch/WatchContract.swift`, `WatchWidgets/JarvisWatchWidgets.swift` and `.github/workflows/watch-build.yml`. The bridge, text input, preview and backend composition merged textually in that rehearsal; this does not establish semantic or native-build compatibility. Temporary merge outputs remained outside the repository; no branch merge was performed.

- `Watch/JarvisWatchApp.swift`: combine the additive `logLift` route, destination and URL case with #1703's `TabView`, dashboard/action pages and all its routes. Do not replace its root with the pre-dashboard root.
- `Watch/WatchLiftCaptureView.swift`: `WatchLiftHomeSummary` is only the minimal live-data Workouts section for this branch's pre-dashboard base. During integration, remove that fallback and insert **only** `WatchLogLiftShortcut()` immediately after `workouts(now: context.date)` inside #1703's existing `WatchDashboardSection(title: "Workouts", route: .workouts)` in `WatchDashboardViews.swift`. Keep See more and the existing Gym/Run summary; do not retain two summaries.
- `WatchWidgets/JarvisWatchWidgets.swift`: retain #1703's provider/dashboard changes and widget bundle entries; append the new Log lift circular widget, preserving all stable existing kinds.
- `Packages/JarvisCore/Sources/JarvisCore/Watch/WatchContract.swift` and `Jarvis/JarvisWatchBridge.swift`: union the new capture action/validation/handler with #1703's task/dashboard actions and handlers.
- `Watch/WatchTextInput.swift`: preserve #1703's additions alongside the capture-specific multiline options. `WatchDesign.swift` owns shared Watch glyph/action changes.
- `apps/backend/src/index.ts`: retain both #1703's task-capture composition and the lift-capture model injection. Neither replaces the other's backend.
- `.github/workflows/watch-build.yml`: retain #1703's captures and these additional lift-state captures.

Observed integration risk: #1703's native run [42836136120](https://github.com/DanAakesen/jarvis/actions/runs/42836136120), at the inspected head, failed paired-phone compilation in `WatchComplicationViews.swift:60:62` with “the compiler is unable to type-check this expression in reasonable time.” This is evidence for that separate revision, not a result for the combined code. Primary must qualify the integrated head. No active Factory task, including acceptance task #24, was started, changed or recovered here.

### Apple sources reviewed

Direct retrieval from `developer.apple.com` failed DNS resolution in this runner. The official pages' indexed API/HIG excerpts were read through the available web-search tool:

- [WatchKit text input](https://developer.apple.com/documentation/watchkit/wkinterfacecontroller/presenttextinputcontroller(withsuggestions:allowedinputmode:completion:)): modal text gathering, accepted text in completion, called on the main thread. A mic action opens this system interface; the API does not guarantee dictation starts immediately.
- [WidgetKit scene linking](https://developer.apple.com/documentation/widgetkit/linking-to-specific-app-scenes-from-your-widget-or-live-activity): `widgetURL` opens the matching scene through `onOpenURL`. The Log lift complication only navigates; it never starts recording directly.
- [Accessory widgets and complications](https://developer.apple.com/documentation/widgetkit/creating-accessory-widgets-and-watch-complications) and [HIG Complications](https://developer.apple.com/design/human-interface-guidelines/complications): use the circular family and a compact, legible launcher. The approved static launcher intentionally serves quick entry rather than displaying fabricated live lift data.
- [WCSession](https://developer.apple.com/documentation/watchconnectivity/wcsession): activate the session before messaging; `isReachable` represents availability for live messages. Preserve the existing phone-authenticated, no-offline-queue model.
- [Recording permission](https://developer.apple.com/documentation/avfaudio/avaudioapplication/requestrecordpermission(completionhandler:)): explicit microphone permission and a usage description are required; denied access needs Settings recovery. Voice reuses the existing permission-aware audio engine.

### Verification boundaries

The existing workflow-impact check passed: `cd .github/scripts && PYTHONPATH=tests python -m unittest tests.test_pipeline.ImpactTests` (16 tests). The first invocation without the helper path failed import and is not counted as a pass.

Backend agent verification (not repeated by the parent):

- Final targeted command: `npm test --workspace @jarvis/backend -- src/health/lifts src/health/routes/lifts.test.ts src/health/tools/gym.test.ts src/health/composition.test.ts src/health/index.test.ts src/core/tool-calls.test.ts --maxWorkers=1` — **156 tests / 8 files passed**, including the final typed HTTP 410 / `lift_deleted` response.
- `npm run build --workspace @jarvis/backend` and `npm run lint --workspace @jarvis/backend` — passed after that change.
- Earlier broader command: `npm test --workspace @jarvis/backend -- src/health src/core/tool-calls.test.ts src/core/approval-interpreter-foundry.test.ts src/voice/realtime.test.ts src/voice/relay.test.ts --maxWorkers=1` — **1,532 tests / 70 files passed** before the surgical terminal-outcome change. The parallel invocation encountered two health-upload startup timing failures; the serial rerun passed unchanged.
- Tests use injected model/store doubles and existing SQL-query mocks. No live Foundry parsing, real SQL transaction, spoken request or real history write/readback was performed. CodeQL and final Core/native results are recorded separately.

Watch/Core agent final verification (not repeated by the parent):

- `swift build --package-path apps/ios/Packages/JarvisCore -j 2` and `swift test --package-path apps/ios/Packages/JarvisCore -j 2` — build passed and **588 tests passed**. Local `TMPDIR` was redirected to ignored `.build` for this runner's filesystem restrictions; tests use Foundation's temporary-directory API.
- `swiftc -frontend -parse`, with and without `-D DEBUG`, over Watch sources, the widget and iPhone bridge — passed. Parsing is not Apple-SDK type checking.
- `swiftc -typecheck -D DEBUG -I apps/ios/Packages/JarvisCore/.build/x86_64-unknown-linux-gnu/debug/Modules apps/ios/Watch/WatchLiftCaptureFixture.swift` — passed for the isolated fixture, not SwiftUI.
- Read-only review found and resolved the terminal-deletion lock; the final review reported no significant issues. Only verified HTTP 410 plus `code: "lift_deleted"` becomes the internal bridge `.deleted` result; other failures keep the exact request locked. Backend HTTP 200 remains saved/needsDetails only.

Post-commit checks for runtime revision `75fa8dc`:

- The final 37-file secret scan found no secrets; committed scope contains no reference scratch images, build products or dependencies.
- CodeQL completed Actions analysis with no alerts. **Swift database creation failed and JavaScript analysis was skipped because its database was too large.** This is partial analysis, not a clean Swift/backend security scan; primary must run supported native/backend scanning for the integrated revision.
- GitHub Actions showed no Watch build runs for `copilot/apple-watch-log-lift-complication` when checked after the push. Consequently no new simulator captures or interactions are claimed. The PR-title run [42852844168](https://github.com/DanAakesen/jarvis/actions/runs/42852844168) failed its identity/head guard on the earlier `79ae9d6` event, not a compilation or functional test of this runtime revision. A fresh gate/native run is needed on the intended current head.

This Linux runner has Swift but no Xcode, `xcrun`, Apple simulator or physical Watch. The existing native workflow now requests synthetic Log lift draft/saved/missing/uncertain/deleted and complication-preview captures, followed by a deep-link launch. The capture shell block also passed `bash -n`. A requested capture is not a successful capture; a fixture is not a real save or installed complication.

Still required on the integrated native build: inspect actual captures and exercise Home/complication → capture, native typing/editing/dictation/cancellation, Save/clarification/error/reconnect/relaunch and existing See more/lift editing/chat navigation. On an installed Ultra 2, verify complication picker/launch, readability, Dynamic Type/VoiceOver, microphone denial/recovery, English/Danish voice with 3, 4 and other reps, one actual saved set with unchanged dumbbell weight, and the same record in real iPhone and Watch history. No physical-device, actual speech, installed-complication or live history-write verification is claimed. Primary owns merge, installation and release.

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
