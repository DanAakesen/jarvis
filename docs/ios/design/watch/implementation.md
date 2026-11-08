# Apple Watch implementation handoff

Branch: `feature/apple-watch-companion`. PR: https://github.com/DanAakesen/jarvis/pull/1652. Primary: Jarvis2 primary, session `01a1adc7-aebe-76f2-b63d-a852c887204f`.

## Implemented

- XcodeGen Watch app and WidgetKit extension, targeting watchOS 26 with the existing iPhone SDK baseline. JarvisCore declares watchOS support. Watch app reuses the Jarvis app icon. Target device is the owner's Ultra 2; reported watchOS 27.2 needs readback.
- Home: compact Voice, Dictate and Factory rows; Jarvis heading and menu. Chat: iOS-style user bubbles, assistant text, input with mic/voice controls, explicit Send for populated drafts, streamed replies and reconnect history. System dictation appends to an editable draft and never automatically submits.
- Menu: today's incomplete due tasks, last seven days of workouts, lift history/add/edit/delete. Lift creation retains a submission UUID for idempotent retry; deletion requires confirmation. Factory provides selected-project task lists/details only, no task execution, approval or release controls.
- Four complications: rectangular daily steps/active energy and weekly gym/run/active energy; circular Tasks Today, Dictation and Voice launchers. Phone-local HealthKit statistics aggregate steps and active energy; background reads do not prompt. Missing or permission-hidden samples stay unavailable. Snapshots expire after 15 minutes or date rollover. Sensitive complication data uses privacySensitive.
- WatchConnectivity allow-list with bounded requests, correlation, reply timeout and no offline queue. iPhone authenticates using existing JarvisClient; no account token, backend URL or arbitrary HTTP proxy crosses to Watch. Sign-out stops Watch voice and clears context. Snapshots refresh with existing phone widget refresh and Watch foreground refresh. Health boundaries follow iPhone Calendar.current; cumulative HealthKit statistics avoid manually adding duplicate sources.
- Duplex voice: Watch captures/plays PCM16 using shared VoiceAudioEngine. Phone connects existing VoiceSessionClient and relays bounded chunks through ordered acknowledged messages. Watch exposes mute/end. Existing iPhone Voice Live Activity controls that same session and is the intended paired-Watch live tile. A phone watchdog ends abandoned sessions after 15 seconds without Watch audio/heartbeat. Disconnect stops local capture.
- WatchDesign.swift supplies shared Watch-native controls because UIKit-backed iOS JarvisControls cannot link on watchOS. SwiftUI paths/system glyphs approximate the approved art; reference PNGs are not fake functioning UI.

## Validation

- Linux Swift 6.2: all 532 JarvisCore tests passed, including six new WatchContractTests for manual-send drafts, request bounds, expiry/midnight, unavailable health, cumulative chart, lift validation/retry identity and wire allow-list.
- Swift frontend parsing and git diff --check passed locally.
- Unsigned Watch app and all four complications built on Xcode 26.6 at b0e662fd. Later revisions need their own CI evidence; final status belongs in this PR.
- PR-only watch-build.yml compiles Watch and iPhone without signing. DEBUG --watch-fixture previews use synthetic data and make no backend requests; captures target an available Ultra simulator. Final native build/screenshot results are recorded separately below.

## Unverified and remaining

- Physical-device capture/playback, WatchConnectivity latency, Bluetooth/speaker routes, wrist-down/silent/background runtime, phone wake/lock behavior and interruptions. Owner accepts testing after primary-coordinated installation, not as a pre-build approval gate. Background audio configuration does not guarantee an unlimited session.
- End/mute from the mirrored iPhone Live Activity on the actual Watch. Existing Activity behavior is reused; no device verification is claimed.
- Signing/provisioning new Watch and widget bundle IDs with the existing App Group. No developer portal or production configuration changed here.
- Full watchOS localization, Dynamic Type/VoiceOver, Always On/tint and owner visual acceptance. Initial Watch copy is English. Native spacing must be checked against references.
- Lists are bounded to 30 health rows / 20 Factory tasks. Full history stays on iPhone. Oversized responses fail visibly; compact DTOs/paging may be needed for long histories.
- A cold-start phone must initialize signed-in composition before serving requests; otherwise Watch asks the owner to open/sign in on iPhone. Standalone/offline operations are unsupported.

## Primary integration

Review the exact CI revision and approved references, arrange signing and installation using the primary release process, then run owner-device checks. Secondary does not merge, deploy, publish or start/recover live Factory tasks. Visual approval is complete; implementation/device acceptance is separate. Design PR #1648 is superseded for integration by this branch, which preserves its reference assets and requirements.
