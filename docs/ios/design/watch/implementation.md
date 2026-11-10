Current delivery continues **#1735 → main**, preserving exact #1733
`b14d7556149a90a62b61c1df2e27e6c62394d09d`; previous targets below are historical.
The historical combined qualification section
at the end supersedes historical child/stacked directions and separates source
evidence from final-head acceptance.

## External URL and small-Watch evidence — 10 November 2026 (#1735)

[Run 42891349643/job 130093247782](https://github.com/DanAakesen/jarvis/actions/runs/42891349643/job/130093247782)
failed `small-log-lift` at 20:18:41 and actual Tasks URL dispatch at 20:19:00
(error 115). Artifact 13801390669 contains rendered task detail/edit and the
failed small lift form; this was not another task-detail Priority failure.

Exact-source [run 42894231414/job 130103184643](https://github.com/DanAakesen/jarvis/actions/runs/42894231414/job/130103184643)
completed **failure**, not pending: Watch simulator, Watch Release architecture
and paired-iPhone **builds** passed. [Artifact 13801702242](https://github.com/DanAakesen/jarvis/actions/runs/42894231414/artifacts/13801702242)
was downloaded; its SHA-256
`e9a981e2977b5426fc4b281ec6c81ae88ed207d613935ef78f71fffe991b80f4`
matches GitHub. `watch-head.txt` records exact `b14d755`. It contains 36 PNGs.

The actual `small-log-lift-failed.png` was visually inspected: title, Lift details,
Bench press/80 kg/4 reps and mic render; substantial input space precedes a Save
button clipped at the bottom. OCR recognizes the form but reads the partial
action as “COvO.” Capture fails at 20:37:16 and reaches its eight-minute step
timeout at 20:37:20. The generic “launch-spinner” log is misleading for this image.
Only Log lift's minimum multiline height is reduced 90→54 points. Text can grow
and scroll; Save's shared target and all required OCR anchors remain. Corrected
small-Watch full-button visibility and large-text interaction remain unverified.

At 20:37:59, `simulator.log:801–805` records an untargeted URL open, followed by
`ERROR: There is no registered handler for URL scheme jarvis-watch` and error 115.
`tasks-openurl-status.txt` contains 115. Built and installed Info.plist JSON match,
including `WKApplication`, companion dependence and `jarvis-watch` URL types.
This is a LaunchServices lookup failure **before demonstrated app delivery**,
not evidence of a parser failure. The original loop exited before Log lift.
The earlier Carousel `reason openURL` belongs to app launch, not this route.

Apple's [WidgetKit deep-link guidance](https://developer.apple.com/documentation/widgetkit/linking-to-specific-app-scenes-from-your-widget-or-live-activity)
says widget interaction activates the containing app and passes its URL to
`onOpenURL`; [`widgetURL`](https://developer.apple.com/documentation/swiftui/view/widgeturl(_:))
does not establish generic scheme discovery. Apple lists
[`CFBundleURLTypes`](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleurltypes)
on watchOS and [requires the companion for dependent apps](https://developer.apple.com/documentation/watchos-apps/creating-independent-watchos-apps).
Our CI installed only the Watch before checking delivery, compiling the phone
afterward. Pair/install that existing companion first; capture pair metadata,
installed app registration and installation-window logs. This corrects setup
but is **not yet a demonstrated error-115 fix**. Production routing and companion
independence stay unchanged.

Each route now has an independent real dispatch attempt, retained status,
available receipts and failure image. Either failure keeps the step red.
Positive acceptance still requires matching nonce/PID/URL, destination receipt
and rendered-content OCR. A general watchOS simulator limitation is **not proven**:
there is no known-good control or actual WidgetKit delivery comparison yet.
Require installed Tasks and Log lift complication taps, warm/cold launch,
corrected-head screenshots and physical Watch acceptance independently.

Source [iPhone run 42894768049](https://github.com/DanAakesen/jarvis/actions/runs/42894768049)
still runs without artifacts at inspection. No fresh native compact-X image or
passing removal/accessibility/loading/chat result is available. Preserve its
24 selections/two workers and the dark-mode off-glyph removal test; source
geometry is not visual acceptance. The orchestrator owns final CI, merge,
backend and TestFlight. No source PR or live Factory task was changed.

Source loading [run 42874104073](https://github.com/DanAakesen/jarvis/actions/runs/42874104073),
artifact 13797261356, contains actual hierarchy evidence of parent-ID propagation
over Factory filters, Usage retry and Proactive item actions. Containing groups
now preserve those child IDs; the native assertions remain. Settings language
checks now query the actual selected inline-picker button, also requiring
hittability. Workspace tests still target an intentionally absent sidebar entry;
other unroot-caused loading failures remain open. These are source-evidence
repairs, not passing corrected-head native execution.

## Native repair qualification — 10 November 2026 (#1730)

Exact #1729 `a39f152` is preserved as an ancestor. Its Watch run **42886195288**
passes simulator, physical-architecture Release and paired-phone builds.
Downloaded artifact **13798051865** has SHA-256
`39b0716e4541a4a66b76ca12103a6d3c36be49dd21f42e0ed95f16c7c85c5bdd`,
matching GitHub's digest. Nine destinations passed visible-text verification;
project now contains Fixture project/No tasks, and Tasks contains unwrapped
Upcoming. This OCR evidence is not native visual/reference acceptance.

Task-detail failed the gate despite recognized Task/Edit/Call dentist/Due content:
Priority is below the initial viewport. The matcher now uses those four visible
anchors, retaining fresh receipt and startup/wrong-scene rejection. The exact
transcript failed before repair; eight capture/workflow tests now pass locally.
Later destinations, lower dashboard sections and smaller-size captures did not
run after that failure and still require an exact-final-head capture.

Separate actual `simctl openurl` delivery of `jarvis-watch://tasks` failed with
**LSApplicationWorkspaceErrorDomain 115**; Log lift URL was not reached. Both built
and installed URL registration match. No URL repair or installed-complication
acceptance is claimed. Preserve the failing gate; physical-device routing,
dictation, accessibility, approved-reference review and release remain outstanding.

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
this correction. Corrected runtime
[`606c299d`](https://github.com/DanAakesen/jarvis/commit/606c299d9f4ca8b3ae077aaa4d8107bb1150b8a2)
passes Watch simulator, physical-Watch Release architecture and paired-iPhone
compilation in
[run 42860889807](https://github.com/DanAakesen/jarvis/actions/runs/42860889807).
Capture also passed, producing 21 synthetic native PNGs in
[artifact 13786576239](https://github.com/DanAakesen/jarvis/actions/runs/42860889807/artifacts/13786576239);
download SHA256 `a54a37fd645e96b97f37717ad47fe8f25c78f8e97530a87328d8379602183fb8`
matches GitHub's digest. Eighteen images are 422×514 and the three smaller-size
captures are 374×446; these dimensions do not establish physical Ultra 2 fit.
The dashboard's `home.png` top viewport was visually inspected: title/menu,
Up Next time/timeline, event title/timing and horizontal-page indicator render
without visible overlap. The viewer then enforced a one-image cap, preventing
visual inspection of the other twenty captures. Their presence does not establish
task/complication layout acceptance. Fixture launches are not tap/dictation/save,
scroll/swipe, VoiceOver, Always On/tint or physical-device interaction evidence.
Aggregate CI and the separate iPhone Simulator UI workflow remain draft-skipped,
not passed. GitHub CodeQL run 42860889763 passed its configured
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
## Child integration — 10 November 2026 (#1721)

PR #1722 targets `copilot/implement-watch-home-complications`, not main. The
source heads were rechecked as #1703 `49274b607937ba2d0fa917fb79d7451193337b44`
and #1711 `42eb81d8c287f602dbd154fa7119395e9a3c56bc`. Merge `1abeb743`
has both the assigned child and #1711 as parents; its common source base is
`741e0378`. Neither source PR was pushed to, merged, closed or retargeted.
The sections below describe earlier, separate-branch qualification, not acceptance
of this integrated revision. Primary retains integration/release ownership.

The dashboard remains first, with the original actions on the second horizontal
page. Only `WatchLogLiftShortcut` is inserted below its existing Gym/Run summary;
Workouts See more and the other dashboard sections remain. The widget bundle
retains all eight existing kinds plus the circular Log lift kind. The phone
bridge and backend retain both independent task and lift capture services.
One typed `WatchAppLink` allow-list connects all widget URLs to the app's
navigation handler; URLs cannot provide capture text or authorize a write.

### Failure investigation and evidence

- [Home run 42863688521](https://github.com/DanAakesen/jarvis/actions/runs/42863688521)
  passed Watch simulator, physical-architecture Release and paired-phone builds,
  but capture failed. Boot/install/first capture consumed nearly two minutes.
  Later `launch --terminate-running-process` calls repeatedly returned PID 13313,
  then 18242, after roughly 30 seconds each. `personal-new-task.png` was written
  at 17:35:11 UTC; the whole capture step timed out at 17:35:40. This is not
  evidence that the task form itself hung, or that those filenames show the
  intended screens.
- [Lift run 42858279527](https://github.com/DanAakesen/jarvis/actions/runs/42858279527)
  likewise passed all three builds. Its external `simctl openurl` failed with
  `LSApplicationWorkspaceErrorDomain` 115. Source registration already existed
  in the Watch app's actual plist, and `project.yml` uses that plist. Adding the
  documented URL name/role completes metadata; it is **not** a verified fix for
  115. Apple guidance retrieved here does not define that error or establish
  that watchOS cannot deliver complication URLs.
- Downloaded both actual artifacts (13788881507 and 13785018601).
  Visual inspection of the latter's `log-lift.png` shows a black system launch
  spinner, not the capture form. It is byte-identical to `log-lift-missing.png`
  and the Home artifact's `tasks.png` (SHA256 prefix `7368c8e23d147f49`).
  `log-lift-saved.png` is byte-identical to `project-tasks.png`
  (`f28208976b70084e`). These captures cannot establish save-state acceptance.

The workflow now separates boot/metadata inspection, rendering and external URL
delivery. It checks out and records the exact PR head, compares built/installed
plists, terminates explicitly, rejects a reused PID, and waits for a destination's
DEBUG-only nonce/screen/PID receipt before taking a screenshot. Boot and rendering
have separate bounded budgets; simulator logs survive failure. Both screen-size
captures are required. The larger overall job budget accommodates the observed
16-minute paired-phone build and separate capture work; no build or route check
is removed. Receipts establish view appearance, **not** visual correctness.
The external URL check still fails on any `openurl` error and additionally requires
actual `onOpenURL` and destination receipts. No fixture-route fallback turns a
failed URL test into success. Actual installed-complication taps remain distinct.

### Approved-source comparison

All three original #1705 PNGs were retrieved from
`009750f0932e6d49af370af73618160ed8ef6fae` and compared with the actual older
lift artifact in a labelled contact sheet outside the repository:

| Approved source | Observed old native capture | Acceptance |
| --- | --- | --- |
| Circular plus/dumbbell complication | App preview page with a small centered glyph and navigation chrome, not an installed watch-face complication | Artwork preview only |
| Full scrolling Home with Log lift below Gym/Run | Old Voice/Dictate/Factory launcher, no dashboard section visible | Wrong scene for this comparison |
| Log lift editable field, mic, Save and Voice | System launch spinner, no form controls | Failed capture |

These are not integrated-head comparisons or device approval. Fresh intended
captures still require inspection. PR #1700 and issue comments were rechecked:
the exact approved nutrition/task-list images are still absent; do not synthesize
replacements or sign off from their descriptions. Physical Ultra 2/smaller Watch
fit, large text, VoiceOver, Always On/tint, installed taps, speech permission,
English/Danish dictation/voice and real history readback remain device checks.

### Apple guidance

Direct Apple retrieval failed DNS. Official API/HIG text was read through the
available research search service, not claimed as a successful full-page fetch:

- [`widgetURL`](https://developer.apple.com/documentation/swiftui/view/widgeturl(_:))
  specifies a URL in the containing app; use one modifier per widget.
- [WidgetKit scene linking](https://developer.apple.com/documentation/widgetkit/linking-to-specific-app-scenes-from-your-widget-or-live-activity)
  describes activation of the containing app and delivery to `onOpenURL`.
  This supports matching destinations, not treating external `simctl openurl`
  as proof of an installed complication tap.
- [`CFBundleURLTypes`](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleurltypes)
  and [custom URL schemes](https://developer.apple.com/documentation/xcode/defining-a-custom-url-scheme-for-your-app)
  describe schemes, identifier and role. `WKApplication` alone is not registration.
- [HIG Complications](https://developer.apple.com/design/human-interface-guidelines/complications)
  prioritizes essential, readable, current information. Existing data complications
  retain availability/freshness; the approved lift launcher never fabricates data.
- [WatchKit text input](https://developer.apple.com/documentation/watchkit/wkinterfacecontroller/presenttextinputcontroller(withsuggestions:allowedinputmode:completion:))
  collects text through a system modal and completion; opening it does not
  guarantee immediate microphone recording. Dictation remains editable until Save.
- [Simulator screenshots](https://developer.apple.com/library/archive/documentation/IDEs/Conceptual/iOS_Simulator_Guide/InteractingwiththeiOSSimulator/InteractingwiththeiOSSimulator.html)
  record the current display, not proof that the intended app scene is ready.

### Integrated validation boundary

On the merged backend, 1,585 targeted health/tool/voice/task tests across 72 files,
178 vault/store tests across five files, backend build and lint passed.
The real SQL integration command for `watch-task-submission-store.integration.test.ts`
failed its isolated-loopback-SQL configuration guard; no SQL execution passed here.
The initial merged Core checkpoint passed 62 targeted tests. Five new workflow
regressions and DEBUG/release parsing of the parent's changed Watch files passed.
Final Core/persistence and exact-head native/security results must be distinguished
from those checkpoints in the PR evidence. Draft-skipped CI is not a pass.
No live model call, real user write, deployment or device send was performed.

Task persistence qualification adds ten regressions: both mode drafts and native
field state, termination before acknowledgement, byte-identical create retry after
clock/timezone change, definite rejection and deliberate revision, edit refresh
and reapplication, saved receipts and fail-closed corrupt/unwritable storage.
The persistence owner reports Core build and 37 combined focused tests passed.
Review then identified two persistence bugs: definite edit conflicts failed to
offer Refresh, and saved edit receipts could mask a subsequently changed task.
Both are corrected with regressions for conflict retention and original/saved/
third-version reopening; the persistence owner reports 36 task-flow tests, Core
build and DEBUG/Release parsing passed after those corrections.
Its full 650-test run reported six source-literal assertion failures caused by
the parent's shared-URL/action receipt refactor, not a clean full-suite pass;
the affected source guards now check shared enum use and destination cases.
The initial failures are retained here rather than described as unrelated.
After correcting only those parent-owned guards,
`swift test --package-path apps/ios/Packages/JarvisCore -j 2 --filter
'WatchDashboardSourceTests|WatchAppLinkTests'` passes all 12 tests. The persistence
owner's completed checks were accepted without repeating its test suite.

Create and edit drafts now survive dismissal/restart in local ApplicationSupport
files. An interrupted create remains locked for the same explicit retry; an
interrupted edit requires refreshing the existing source. Confirmed saved results
remain terminal on disk until deliberately starting another create; a storage
failure cannot silently replace a pending write. Synthetic fixtures bypass those
files. This is local state/test evidence, not physical process-kill acceptance.

The post-commit security scan of `0f86f224` found no Actions alerts; Swift
database creation failed, and the overall scan timed out before all languages
completed. This is incomplete security coverage, not a clean application scan.
The exact-head native run 42874479453 was still queued when checked. No intended
new captures or successful external URL delivery are established by that run.
Child PR #1722 has the correct Home base; its generated `[WIP]` title still needs
the requested `fix-main:` prefix. This environment has no PR metadata-write tool.
## Combined direct-main qualification (#1728; 10 November 2026)

Current delivery **#1729 → main** supersedes the older child/stacked directions
below. Full source heads are #1727 `25f8ed781f31c6d0ef534b21d8d48f62f5e08bdd`
and #1722 `9e4c76c0e211e943e5581b6e12e9a75fc4c08ed1`, on main
`ddc626ff60a78580059a8376fa0e658703cf3545`. Integration merge:
`39764627fe474761acd842e3e48b4015d1471c3e`; runtime repair:
`c09b462db5dc4bdb739144b2074ce89e03523eef`. Source PRs and live Factory task 24
remain untouched. This is not a Watch redesign or a new approval gate.

Final runtime **`6669570bebb8510c9cb3a79df9c0cceadfa6abf8`** adds the visible
destination gate and task/dashboard layout repairs described below. Restoring
references and recording this handoff do not qualify the runtime for release.

### Finished source run and concrete failure

[42875315079 attempt 2](https://github.com/DanAakesen/jarvis/actions/runs/42875315079/attempts/2),
job **130049104735**, finished with failure at exact source `9e4c76c0`.
Simulator Watch, physical Watch Release architecture and paired iPhone simulator
builds all passed; the phone build completed **19:08:28 UTC**. Built/installed
`WKApplication` and URL scheme checks passed. External URL verification was
**skipped**, not successful and not a new reproduction of error 115.

Capture log: task-edit launched **18:55:37.866 UTC**, PID **13783**, nonce
`3835E597-8B30-42AF-835B-65C0C385A249`. At **18:56:11.156**:
`No fresh destination receipt for task-edit; refusing a launch-spinner capture`.
Simulator diagnostics record a **10-second scene-create watchdog violation** at
**18:55:48.998**, with foreground watchdog termination disabled in Simulator.
This identifies the failing scene/capture, not the precise root cause of the
watchdog. It was not the step's eight-minute timeout or a failed architecture build.

[Artifact 13793598118](https://github.com/DanAakesen/jarvis/actions/runs/42875315079/artifacts/13793598118)
contains ten PNGs/receipts, simulator diagnostics and all three build logs
(archive SHA-256 `e9d2ab701b9ff4e2a2be8df1d03b90817f79d95d78c3916eec860f0afa97d28a`).
The device was an **Ultra 3 49 mm/watchOS 26.4 simulator**, not physical Ultra 2.

### Actual images versus approved references

All ten source images were inspected together against the approved references.
Eight show their expected fixture destinations: dashboard, actions, chat, health,
lifts, new-lift, Factory new-task and tasks. **Project and task-detail show startup
screens despite matching fresh receipts**. A `.task` receipt is not evidence that
the compositor has rendered the target. No task-edit, personal Auto/Manual,
lower-dashboard, smaller-Watch or external-route acceptance follows.

| Actual image | SHA-256 | Observed comparison |
| --- | --- | --- |
| dashboard.png | `54568a6b57f509896d95d4ccd832eebbfb9d6884ea55eaa6105d65a69e682072` | Up Next/timeline/event visible; lower dashboard not shown. |
| tasks.png | `dbdfad60bf933aa9ce682f0d69301d4040d6df525e95a06ffd138ae4faa53c0e` | Overdue and Today visible; Upcoming wraps; reference count badge/chevrons absent and overdue styling differs. |
| task-detail.png | `f1fb53477a9d84b6fd10ce9d730c9395c32efef0ca7e08275722721cac652df2` | Startup scene, not detail; receipt is insufficient. |
| project.png | `b3140ed50c3ff8adc830bfbe3f6f43865b022e8bdacdb6e5f0c7caf44c475ece` | Startup scene, not project tasks. |
| chat.png | `dbc942211d4715d2bb2302e0487d887dd07d10b133cb5ea1576f13c6643c8fa2` | Amber user bubble/plain assistant/input retained; shorter transcript/higher composer than reference. |
| health.png | `be31786895a352f47a0aeeff3a56977ccd6423b53793c9e0e3015b3add1de9e5` | Count, amber stems/curve and dashed goal retained; not installed-complication proof. |

Exact approved reference bytes are restored, not generated: dashboard/four
approved task-screen PNGs from `ada3116a996d13de689d3e1d26dcf701205bb4c6`,
three quick-lift PNGs from `009750f`, photo reference from
`c3d69b5d78c51131e2b71aca24d55cf88a9fcd8d`. Task “proposal” filenames retain
their recorded approval. Missing exact nutrition/task-list complication images
remain a limitation; descriptions or later unapproved refinements are not substitutes.

### Targeted repairs and remaining qualification

DEBUG entry now initializes navigation state before scene rendering and opens
task detail/edit/create directly rather than chaining startup pushes and sheets.
Failures retain a `*-failed.png` diagnostic, never a successful capture. External
URL delivery runs independently after capture failure, still using actual
`simctl openurl` plus `onOpenURL`/destination receipts. These changes require a
fresh native run and actual image inspection; no claim that error 115 is fixed.

The capture pipeline now uses Apple's built-in Vision OCR after receipt matching
to require screen-specific visible labels/content before moving a pending image
to its successful filename. Unknown screens and startup/wrong-scene content fail
closed; the Tasks capture also requires unbroken “Upcoming”. Recognized text and
SHA-256 receipts are retained. URL routes require matching PID/nonce in both
callback/destination receipts and recognized target content. Linux matcher tests
are not OCR or native-rendering evidence, and OCR is not reference fidelity or
interaction acceptance. Project/Factory-create/new-lift capture routes also start
directly instead of chaining startup presentations.

Today/Upcoming now receive the full row width, use compact unbroken labels and
adapt vertically at large text sizes. The + is in the native top-right toolbar;
the actual loaded Today count uses “+” when more pages remain and hides when
unavailable. Plain navigation rows have explicit chevrons and readable full titles.
Dashboard uses amber section markers/current-time guide, a three-hour timeline,
prominent relative timing and a quieter menu. Deliberate deviations: native bottom
page dots/system clock, count within the Today tab, and no ornamental vertical
section rail. These preserve native behavior and the project's no-accent-border
rule; post-change native fidelity has not been inspected. Capture now separately
targets Workouts, Body Fat, Tasks and Recent Notes, not just the first viewport.

The repair retains Apple's
[NavigationStack](https://developer.apple.com/documentation/swiftui/navigationstack)
state-driven navigation and
[onOpenURL](https://developer.apple.com/documentation/swiftui/view/onopenurl(perform:))
delivery boundaries. Existing Apple/HIG references in this record remain authoritative;
fresh retrieval of those API pages was DNS-blocked in this Linux environment.
No replacement approval step or custom navigation framework is introduced.

Successful edit receipts now accept whitespace-canonicalized titles, preserve
source identity and remain terminal across restart/refresh without duplicate
writes. The extra ten-second Auto parser deadline is removed; the caller's finite
lifetime/cancellation and durable retry identity remain. A model-port test does
not measure real provider latency or WatchConnectivity behavior.

Local combined runtime checks: **701 Core**, **349 workflow** tests pass;
backend task capture **48 tests**, build/lint pass. Exact final-head unsigned
Watch/device/paired-phone, iPhone UI/captures, signed build/upload qualification,
actual URL routing and physical English/Danish input/voice/accessibility checks
remain open. Watch run **42883542851** at `c09b462d` is queued; draft aggregate/
iPhone runs skipped initially. After the orchestrator made #1729 ready and fixed
its title, CI **42885710209** runs and iPhone **42885710449** queues at `c09b462d`;
none covers the final runtime follow-up yet. The orchestrator owns review, final acceptance,
merge and release; deployment/TestFlight is already authorized after qualification.
