# iOS app build plan

Status: preparation only. The owner answered the checklist on 29 October 2026 but has not given the go for the foundation phase, so nothing in this file is authorised work. It is the shortest path from nothing to a Jarvis build on the owner's iPhone, plus a list of what is still unproven.

Related documents: `iOS app.md` (confirmed decisions), `docs/ios/integration-contract.md` (backend endpoints the app talks to) and `docs/ios/design/` (the concept board and the surfaces gallery).

Basis labels: **Checked** means the official GitHub or Apple page was read. **Not re-read** means a research finding or memory not yet confirmed on the page. **My call** is a design choice.

## Defaults

| Choice | Pick | Basis |
| --- | --- | --- |
| Build machine | GitHub-hosted `macos-26` with a pinned Xcode 26.x. Free for public repositories, at most 5 concurrent macOS jobs. | Checked: runner names and the 5-job limit. Not re-read: free for public repos, Xcode 27 image failures, the 28 April 2026 SDK requirement. |
| Project file | XcodeGen (`project.yml`). Do not hand-write the project file. Avoid Tuist: its agent flow needs an interactive browser login. | Not re-read |
| Signing and upload | `xcodebuild` with an App Store Connect API key and automatic signing, straight to TestFlight. No Fastlane, no certificates in the repository, no Mac. | Checked: the flags are in Apple's manual. Proven end to end in phase 1. |
| Build number | The GitHub run number. Every upload needs a higher number. | My call |
| Export compliance | `ITSAppUsesNonExemptEncryption` set to NO in the app's Info.plist: standard HTTPS only. It is the owner's declaration to Apple. | Not re-read |
| Code split | A pure-Swift `JarvisCore` package with no Apple-framework imports, and a thin SwiftUI app layer. | Checked: Linux limit. My call: design. |
| Test data | A fixture transport that replays recorded sample conversations. | My call |
| Screenshots | Best effort on every pull request, never a gate. | Not re-read |
| Swift mode | Swift 6 compiler in Swift 5 language mode. | My call |
| Minimum iOS | 26 (native Liquid Glass). | Checkbox in the checklist |
| Devices | iPhone 16 Pro Max on iOS 27.2, plus an Apple Watch. The phone has the Action Button and the Dynamic Island. Builds stay on Xcode 26.x although the phone runs a newer iOS: an app built with an older SDK runs on a newer system, and the Xcode 27 images are rough (Gotcha 2). | Owner answer. Not re-read: older SDK on a newer iOS. |
| Bundle ID | `com.danaakesen.jarvis`, being registered by the owner. The Home Screen name can differ from the store name. | Owner answer |
| Face ID lock | On by default and offered at the first sign-in. A Settings switch turns it off. It gates the screen, not the token, and never interrupts a running voice session. | Owner answer for on by default. My call: the details. |
| Lock Screen approvals | Allowed. Yes or no only, with device authentication before the action and text that names what is approved. Backend work: integration contract, sections 7 and 8. | Owner answer for allowed. My call: the safeguards. |
| Keychain class | AfterFirstUnlock, this device only, for the session token. Classes that need an unlocked phone cannot be read by a notification action or in CarPlay. | Checked for CarPlay: the CarPlay developer guide. My call: the choice. |
| App icon | The orb, drawn and shown to the owner before the first upload. | My call |
| Keep-alive | A monthly scheduled upload, because TestFlight builds become unavailable 90 days after upload. | Checked: Apple's TestFlight page |

## Phase 1 is two pull requests

Not started. The owner has not given the go for the foundation phase (checklist row 23), so these are planned steps, not work in progress.

**1a. Skeleton and checks.** Needs only the bundle ID. No Apple account steps and no secrets.

**1b. TestFlight upload.** Needs the owner's setup steps 1 to 7. Phase 2 (Shell) can start as soon as 1a merges, because CI proves it compiles.

Both pull requests add workflow files, so the owner merges them.

### 1a deliverables

- `apps/ios/project.yml`: one iPhone-only app target, deployment target 26.0, the bundle ID `com.danaakesen.jarvis`, a local dependency on `Packages/JarvisCore`.
- `apps/ios/Packages/JarvisCore`: a SwiftPM package that builds on Linux, with one passing test. It later holds protocols for the HTTP transport, the SSE stream, the WebSocket, audio input and output, and the token store. Apple implementations live in the app target; fakes live in the tests.
- `apps/ios/Jarvis`: a SwiftUI app showing a blank glass screen, with the orb as app icon and `ITSAppUsesNonExemptEncryption` set to NO.
- `.github/workflows/ios-ci.yml` and the repository wiring below.

### How a new CI component is wired in this repository

Read from the current main branch. The offline tests enforce most of it, so a miss shows up as a red test, not a silent gap.

1. `.github/scripts/pipeline_impact.py`
   - Add `ios` to `CHECKS`.
   - In `checks_for`, return only `ios` for paths under `apps/ios/`. The catch-all at the end otherwise selects every check for an unknown path.
   - In `deploy_parts`, return an empty set for `apps/ios/`. Otherwise an unknown path counts as an input to every production deployment part, and each iOS change would look like a backend, web and infrastructure change.
   - Add `ios-ci.yml` and `ios-testflight.yml` to `CHECK_ONLY_WORKFLOWS` for the same reason.
2. `.github/workflows/ci.yml`
   - Add the plan output `ios: ${{ steps.impact.outputs.ios }}`.
   - Add a job named `ios` with `needs: plan`, `if: needs.plan.outputs.ios == 'true'` and `uses: ./.github/workflows/ios-ci.yml`. Match the existing job blocks line for line: the test searches for those exact lines.
   - Add `ios` to the `needs` list of the `result` job. The test requires that list to equal `plan` plus every entry of `CHECKS`, and the evidence step fails if a selected check is missing from it.
3. `.github/scripts/tests/test_pipeline.py`: extend the selection, deployment-part and wiring tests for the new component.
4. Documents: `docs/agent-context.md` (commands, CI), `docs/architecture.md` (the new area), `docs/decisions.md` (confirmed choices), `PLAN.md` (an iOS phase).
5. Conventions to copy from the existing workflows: every third-party action pinned by full commit SHA with a version comment, `permissions: contents: read` at the top, a `timeout-minutes` on every job.

Draft pull requests and pushes to main do not run `ci.yml`, so macOS minutes are only spent on ready pull requests. A selected `ios` check that fails blocks `CI result`, which is why the screenshot step must never fail the job.

### `ios-ci.yml`

- `on: workflow_call`, `runs-on: macos-26`, a timeout.
- Pin the Xcode version with `xcode-select` after listing what the image provides.
- Install XcodeGen at a pinned release, run `xcodegen generate`.
- Run the `JarvisCore` tests with `swift test`.
- Build the app for the iOS Simulator with code signing switched off.
- Best-effort screenshot, three attempts, `continue-on-error: true`, uploaded as an artifact. Fallback: test attachments kept with `lifetime = .keepAlways`, read through `xcresulttool`.
- No secrets, and no reference to the signing environment.

### 1b: `ios-testflight.yml`

A separate workflow, not called from `ci.yml`.

- Triggers: push to main touching `apps/ios/`, a monthly schedule, and manual dispatch. Never `pull_request` or `pull_request_target`, so fork pull requests can never reach the secrets.
- A GitHub Environment named `ios-testflight`, limited to the main branch. Three secrets: `APP_STORE_CONNECT_KEY_P8` (the key file contents), `APP_STORE_CONNECT_KEY_ID` and `APP_STORE_CONNECT_ISSUER_ID`. One plain variable, `APPLE_TEAM_ID`. The owner sets them with `gh secret set` and `gh variable set`, never in chat. Names are proposals.
- `concurrency` group `ios-testflight` with `cancel-in-progress: false`.
- Steps: write the key to a temporary file with mode 600 and delete it in a final step that always runs. Generate the project. `xcodebuild archive` with automatic signing, `-allowProvisioningUpdates`, the three `-authenticationKey...` flags, and the build number from the run number. `xcodebuild -exportArchive` with an export-options file that selects automatic signing, the team and the upload destination. Fallback if direct upload misbehaves: export the app file and upload it with `xcrun altool --upload-app` using the same key.
- Never print the key, the key ID or the issuer ID.

## Apple Developer portal: App ID setup (owner)

Enabling capabilities needs the Account Holder or Admin role, and changing an App ID invalidates its provisioning profiles, so they must be regenerated afterwards (Checked: Apple's capabilities pages). The owner is registering the App ID now. This is where each item lives.

| Where | Item | Why | When |
| --- | --- | --- | --- |
| Capabilities | Push Notifications (leave the sub-option empty) | Alerts, silent updates and Live Activity updates. | Now |
| Capabilities | Time Sensitive Notifications | Lets a decision request break through a Focus mode. | Now |
| Capabilities | App Groups, then create `group.com.danaakesen.jarvis` and attach it | Shares state between the app, its widgets and its Live Activities. | Now |
| App Services | MusicKit | Lets Jarvis start Apple Music. | Now, it costs nothing |
| Separate request | CarPlay, category Voice-based conversational | Voice in the car. Apple must approve it, and it then shows as a managed capability. | When CarPlay work starts |
| Later App IDs | The Watch app and the widgets extension each get their own App ID | Each target has its own bundle ID. | When those targets exist |

Everything else in the portal list is not needed. HealthKit joins when Watch workouts arrive, because version 1 has no Health data.

Basis: Checked for the role, the profile rule and MusicKit being an App Services tick. Not re-read: the exact name of the Push sub-option, whether Time Sensitive is a plain tick, and whether Xcode registers the Watch and widget App IDs by itself.

## Later: CarPlay, Watch and Music (owner intent, not version 1)

Read from Apple's CarPlay Developer Guide dated 13 October 2026 and Apple's entitlement request page (Checked), unless marked.

CarPlay

- The fit is the voice-based conversational category. Voice is the main way in, answers show no text or imagery, an audio session is held open only while voice is active, and the voice control screen is shown whenever voice is on. Recording is allowed only together with that screen. The template stack is at most 3 deep. The app must never tell the person to pick up the iPhone.
- The entitlement key is `com.apple.developer.carplay-voice-based-conversation` and it needs iOS 26.4 or later. The minimum iOS is 26, so the CarPlay code sits behind an availability check, or the minimum rises when this work starts. The owner's phone runs a newer iOS.
- Apple approves the category on request: the owner asks at developer.apple.com/contact/carplay and agrees to the addendum. After approval it shows as a managed capability: enable it on the App ID, save, regenerate the provisioning profile and add the entitlement to the app. Use manual signing for that profile until automatic signing with the API key is shown to handle managed capabilities (Not re-read).
- An app has one CarPlay category (EV charging with fueling is the only allowed pair). Jarvis cannot also be the audio app.
- CarPlay shows no notifications for conversational apps.
- CarPlay is used with the phone locked. Keychain items that need an unlocked phone are unreadable, and the complete and complete-unless-open file protection classes must not be used. That is why the token class above is AfterFirstUnlock.
- Small widgets and Live Activities show in CarPlay without an entitlement.
- CarPlay Simulator is a Mac app (it moves into Device Hub with Xcode 27) and needs a phone on a USB cable. There is no Mac, so testing needs a real car or head unit.
- Unproven: whether a personal TestFlight-only app is eligible, which Apple decides, and how Jarvis would start playback in the car while it is the voice app.

Apple Watch

- Live Activities appear on the Watch without extra work. A native Watch app is outside version 1 and would add its own App ID and target.

Music

- MusicKit lets Jarvis start Apple Music playback for a subscriber. Other players such as Spotify have their own integration routes, which are not researched here.

## Gotchas

1. Simulator screenshots fail about half the time on the current images ("Timeout waiting for screen surfaces"). Best effort only.
2. The Xcode 27 images are rough: high job failure rates and a simulator that only registers one device. Stay on `macos-26` with Xcode 26.x until that settles.
3. The ARM runners have 7 GB of memory. Build one scheme at a time.
4. `macos-14` retires on 2 November 2026. Do not use it.
5. TestFlight builds become unavailable 90 days after upload. The monthly upload is the cure.
6. Each upload needs a unique, rising build number. A re-run keeps its run number, so a re-run after a successful upload would be refused as a duplicate. Fold the attempt number in if that ever matters.
7. Without `ITSAppUsesNonExemptEncryption`, TestFlight holds each build on a Missing Compliance question.
8. Internal testers need no Apple review. Only external testers do.
9. The simulator cannot prove Bluetooth, AirPods, call interruptions or background audio. Voice needs a real phone.
10. App Store Connect names are unique store-wide. The owner has chosen the store name and it is deliberately not recorded in this repository. The Home Screen name can differ.

## What cloud agents can and cannot do

- Copilot cloud agents run on Ubuntu or Windows only (Checked). They cannot compile SwiftUI or run the Simulator.
- They can build and test the pure-Swift `JarvisCore` package if a Swift toolchain is present in their environment. Whether it is present, or `copilot-setup-steps.yml` must install one, is unproven.
- The Mac runner in CI is the only compile check for the app layer, so red CI is the main feedback loop. Keep each pull request small so a failure is cheap to fix.
- Keep at most two builders running at once, as for every other area.

## Unproven: settle in this order during phase 1

1. The API-key role for cloud signing. Apple's cloud-managed signing page lists Account Holder or Admin, so expect to need Admin. Confirm on the first upload.
2. Whether `xcodebuild` turns on push and App Groups from the entitlements file (its manual says it can create and update app IDs for automatically signed targets). The owner ticks them in the portal now, so this only matters for capabilities added later.
3. The archive step under automatic signing with the key, and the exact export-options spellings for Xcode 26. The flags themselves are confirmed.
4. A Swift toolchain in the cloud agents' environment.
5. Voice protocol gaps: tool and error message shapes, background audio, Bluetooth, microphone recovery after the phone locks, and whether the WebSocket upgrade accepts an Authorization header (the subprotocol carries the token today).
6. Whether a personal TestFlight-only app can obtain Apple's CarPlay conversational-app entitlement.
7. Starting the microphone from a locked phone (Action Button, a shortcut or a Lock Screen control), and what the Face ID lock does to it.
8. Approval notifications when the system hides previews on the Lock Screen. If the text cannot be shown, the actions must not be offered blind.
9. Whether Approve and Decline appear and work on the Apple Watch, including the authentication step.
10. The passcode fallback of the Face ID lock (`deviceOwnerAuthentication`) on a cold start, on return from the background and in CarPlay.
11. Whether App Intents (Action Button, shortcuts, Siri phrases) need no capability tick. About 90 percent sure; confirm when the first one is built.

## Phase 1 acceptance

1a is done when:

- `apps/ios/` contains `project.yml`, the `JarvisCore` package with a passing test and the SwiftUI app target.
- `ios-ci.yml` runs from `ci.yml` only when `apps/ios/` or shared inputs change, and `CI result` passes with the `ios` check selected.
- The offline pipeline tests pass with `ios` wired in, and an iOS-only change does not alter any production deployment fingerprint.
- The documents listed above are updated.

1b is done when:

- A merge to main produces a build in TestFlight with a rising build number, using no certificate in the repository.
- The owner installs it and sees the orb icon and a blank glass screen.
- The monthly schedule and manual dispatch both start the workflow.
- Fork pull requests demonstrably cannot read the signing environment.
