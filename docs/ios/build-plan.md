# iOS app build plan

Status: the foundation phase is authorised. The owner answered the checklist on 29 October 2026 and gave the go for the foundation phase on 30 October 2026. Phase 1a has merged; phase 1b adds the owner-started TestFlight workflow. The owner must configure its environment and start the first run after merging that workflow. Later phases still need their own go. Every screen needs the owner's approval before it is built, merged or shipped (see Screen approval gate). This file is the shortest path from nothing to a Jarvis build on the owner's iPhone, plus a list of what is still unproven.

Backend rule (confirmed 30 October 2026): Jarvis is one unified backend with several frontends. The iPhone app reuses the routes, streams, tools, and artifacts the web app already uses, with no iOS-specific backend paths. An iPhone screen that needs something the web app does not already use is raised as an explicit decision before the backend changes. Anything an iPhone design needs that the backend does not already provide is flagged to Dan, who decides whether that backend build starts then.

Related documents: `iOS app.md` (confirmed decisions), `docs/ios/integration-contract.md` (backend endpoints the app talks to) and `docs/ios/design/` (the concept board, the Workspaces concept page and the surfaces gallery).

Basis labels: **Checked** means the official GitHub or Apple page was read. **Not re-read** means a research finding or memory not yet confirmed on the page. **My call** is a design choice. The Checked pages were read on 29 October 2026. Runner images and their open issues change often, so recheck them before the first build.

## Defaults

| Choice | Pick | Basis |
| --- | --- | --- |
| Build machine | GitHub-hosted `macos-26` with a pinned Xcode 26.x (26.6 is the image default, with older 26.x versions installed beside it). Free for public repositories, but only while this repository stays public. At most 5 concurrent macOS jobs. Never use xlarge labels (see Cost guard). | Checked: runner names, the 5-job limit, free use on public repositories, the Xcode versions on the image (version 20261013.0424.1) and the 28 April 2026 SDK requirement (uploads need Xcode 26 or later). Gotcha 2 covers the Xcode 27 image. |
| Project file | XcodeGen (`project.yml`). Do not hand-write the project file. Avoid Tuist: its agent flow needs an interactive browser login. | Checked: XcodeGen is not archived, its last push was on 13 October 2026 and its latest release is 2.46.0. Not re-read: the Tuist login claim, and XcodeGen's support for Xcode 26 and Swift 6. |
| Signing and upload | `xcodebuild` with a Team App Store Connect API key (an Individual key cannot use the provisioning endpoints) and automatic signing, straight to TestFlight. No Fastlane or certificates in the repository. | Checked: the flags, in a mirror of the `xcodebuild` manual page (all three `-authenticationKey` flags are needed together), and Apple's rules for Team and Individual keys. The first workflow archive/export/upload remains unproven (Unproven 1 and 3). |
| Build number | The GitHub run number. Every upload needs a higher number. | My call |
| Export compliance | `ITSAppUsesNonExemptEncryption` set to NO in the app's Info.plist: standard HTTPS only. It is the owner's declaration to Apple. | Checked: Apple says to set NO when the app, including the libraries it links, uses no encryption or only exempt forms, and that encryption built into the operating system, such as HTTPS through `URLSession`, is typically exempt. The same page says exempt encryption might still call for a year-end self-classification report to the US government. Whether that applies is the owner's call and is not researched here. |
| Code split | A pure-Swift `JarvisCore` package with no Apple-framework imports, and a thin SwiftUI app layer. | Checked: Linux limit. My call: design. |
| Test data | A fixture transport that replays recorded sample conversations. | My call |
| Screenshots and UI gate | Ready iOS pull requests run the simulator smoke flow, attach every screen in light/dark and Danish/English, compare the captures with rendered board references, and publish the paired images and results as a 14-day artifact and PR comment. | P15-32 extends the existing one-job, one-simulator-boot hook. |
| Swift mode | Swift 6 compiler in Swift 5 language mode. | My call |
| Minimum iOS | 26 (native Liquid Glass). | Checkbox in the checklist |
| Devices | iPhone 16 Pro Max on iOS 27.2, plus an Apple Watch. The phone has the Action Button and the Dynamic Island. Builds stay on Xcode 26.x although the phone runs a newer iOS: an app built with an older SDK runs on a newer system, Apple has announced no iOS 27 SDK requirement for uploads, and the Xcode 27 image still has open problems (Gotcha 2). | Owner answer. Checked: no iOS 27 SDK upload requirement is announced as of 29 October 2026. Not re-read: older SDK on a newer iOS. |
| Bundle ID | `com.danaakesen.jarvis`, registered on 30 October 2026 as an explicit App ID named Jarvis. The Home Screen name can differ from the store name. | Owner answer. Observed: read back from the portal. |
| Face ID lock | On by default. Lock on cold start and after 60 seconds in the background; use LocalAuthentication and the device passcode fallback. Settings controls remain a separate screen issue. | Owner answer for on by default; 60 seconds follows the proposed default in the integration contract and is the P15-16 implementation choice. |
| Lock Screen approvals | Allowed. Yes or no only, with device authentication before the action and text that names what is approved. Backend work: integration contract, sections 7 and 8. | Owner answer for allowed. My call: the safeguards. |
| Keychain class | AfterFirstUnlock, this device only, for the session token. Classes that need an unlocked phone cannot be read by a notification action or in CarPlay. | Checked for CarPlay: the CarPlay developer guide. My call: the choice. |
| App icon | The orb, drawn and shown to the owner before the first upload. | My call |
| Keep-alive | A monthly reminder to the owner to run the manual upload, because TestFlight builds become unavailable 90 days after upload. An automated keep-alive of the last approved build can be added later if the owner wants it. | Checked: Apple's TestFlight page. Owner decision, 30 October 2026: no unapproved upload. |

## Screen approval gate

Owner decision, 30 October 2026: the owner approves every screen before it is deployed. This supersedes the automatic uploads on merge in checklist row 19.

1. Every screen is its own issue and its own pull request.
2. Design gate: the dispatcher shows the owner the concept frame for the screen, and no builder starts on that screen until the owner has approved it.
3. Code gate: the owner approves the screen's pull request before it merges.
4. Ship gate: the TestFlight upload workflow runs by manual dispatch only, started by the owner, so nothing reaches the owner's phone unapproved.
5. A screen that has not been approved is never built, merged or shipped.
6. A UI pull request is not ready for review without the XCUITest screenshots, matching board renders and comparison result attached to its PR comment and artifact.

Phase 1a has no real screens (only an empty shell), so the gate does not apply to it.

## Native iOS standards

Owner decision, 30 October 2026: everything built for the iPhone follows the iOS standard way as much as possible and does not hardcode values each time something is built. The concept board cannot show this, but it applies when the app is built. The concept board is a visual reference only, not a source of literal values.

1. System first. Use native components and styles: standard SwiftUI controls, `NavigationStack`, sheets with detents, Liquid Glass materials and the system glass button styles, SF Symbols, Dynamic Type, system colours and semantic tokens, and the system pickers and permission flows (for example the ReplayKit broadcast picker and AVFoundation capture). Light and dark appearance, reduced motion and reduced transparency then work automatically.
2. Scrolling is the system behaviour: native `ScrollView` and `List`, system momentum and rubber-band bounce, overlay indicators, the iOS 26 scroll edge effects under glass bars, interactive keyboard dismissal, and scroll position and pull to refresh through system APIs. No custom scroll implementations and no fake scrollbars. The scrolling on the concept board is only an approximation.
3. One shared layer for anything custom: a design-token and reusable-component layer is the single place for colours, spacing, radii, typography, glass modifiers, button styles and icons. No per-screen hardcoded values and no one-off styling.
4. A custom component needs a stated reason why no system component fits. The reason goes in the screen issue and the pull request.
5. Every screen issue and pull request is checked against this section as part of its acceptance.

## Cost guard

Owner decision, 30 October 2026: build and test as much as possible off the Mac, and ship as much as possible on every GitHub build. Make every paid Mac run count. A Mac run is the only compile check for the SwiftUI layer, because the owner's PC has no Swift toolchain (WSL is not installed) and cloud agents run on Ubuntu.

Why: standard `macos-26` runners are free today because the repository is public and the account is personal. Larger macOS runners are billed even for public repositories and are not available to a personal account, so never use `xcode-27-xlarge` or any other xlarge label. Design as if the minutes were billed. GitHub lists $0.062 per macOS minute for private repositories (docs: Actions runner pricing), so a 10 to 15 minute run would cost roughly $0.60 to $0.90 (estimate). Billing starts the moment the repository goes private.

Rules:

1. Keep logic in the pure-Swift `JarvisCore` package, which builds and tests on cheap Linux on every push. Cloud agents get the toolchain through `copilot-setup-steps`. The SwiftUI layer stays thin.
2. `ios-ci.yml` has a Linux job (`JarvisCore` build and tests, plus sanity checks of `project.yml`, the app/extension plists and their entitlements) and one Mac job that needs Linux to pass first. P15-11's ReplayKit extension and App Group are covered by those metadata checks; screen work adds no Mac job.
3. The Mac job runs only for ready pull requests that touch `apps/ios/` or shared inputs, never for drafts or pushes to main (`ci.yml` already behaves this way). It uses `concurrency` with cancel-in-progress per pull request, `timeout-minutes: 20` and a SwiftPM cache. It builds and runs the `JarvisUITests` target on one iPhone simulator boot with `CODE_SIGNING_ALLOWED=NO`. A debug-only fixture exercises sign-in, sidebar drag/button, every navigable destination, each Chat attachment-menu entry, Voice start/end and the Needs you Done action. It attaches every screen in light/dark and Danish/English; a structural/color comparison against the rendered `docs/ios/design/board.html` and `workspaces.html` references fails above tolerance 0.38. The existing Factory-state matrix stays in this boot. The test target and reference renderer add no job or simulator boot.
4. The TestFlight workflow builds, archives and uploads in one job, started by the owner by manual dispatch, so the ship run is also the only compile run for that upload. Uploads happen only when the owner starts them, which also lowers Mac minutes.
5. Authors keep pull requests in draft until the Linux checks pass and the change is final, and batch related changes. The expectation is one Mac run per pull request.
6. Owner safety net: set a GitHub Actions budget in Billing, so usage stops at the limit if the repository ever becomes private.
7. The dispatcher reviews Actions billing usage at the end of each iOS phase.
8. A local Linux Swift toolchain for the owner is optional and needs the owner's go.

## Phase 1 is two pull requests

Authorised on 30 October 2026 (checklist row 23 is now Yes). Phase 1a has merged. Phase 1b waits for the owner's GitHub environment and Apple key setup.

**1a. Skeleton and checks.** Needs only the bundle ID. No Apple account steps and no secrets.

**1b. TestFlight upload.** Needs the owner's setup steps 1 to 7. The workflow runs by manual dispatch only, started by the owner. Phase 2 (Shell) can start as soon as 1a merges, because CI proves it compiles, but each screen still passes the screen approval gate.

Both pull requests add workflow files, so the owner merges them.

### 1a deliverables

- `apps/ios/project.yml`: one iPhone-only app target, deployment target 26.0, the bundle ID `com.danaakesen.jarvis`, a local dependency on `Packages/JarvisCore`.
- `apps/ios/Packages/JarvisCore`: a SwiftPM package that builds on Linux, with one passing test. It later holds protocols for the HTTP transport, the SSE stream, the WebSocket, audio input and output, and the token store. Apple implementations live in the app target; fakes live in the tests.
- `apps/ios/Jarvis`: a SwiftUI app showing a blank glass screen, with the orb as app icon and `ITSAppUsesNonExemptEncryption` set to NO.
- `.github/workflows/ios-ci.yml` (a Linux job and a gated Mac job, as set out in the Cost guard) and the repository wiring below.

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

Draft pull requests and pushes to main do not run `ci.yml`, so macOS minutes are only spent on ready pull requests. A selected `ios` check that fails blocks `CI result`: UI behavior failures, missing screenshots and board drift beyond tolerance fail the check. Artifact upload and the PR comment still run after a failure when screenshots were produced.

### `ios-ci.yml`

- `on: workflow_call` and `workflow_dispatch`, with two jobs and a timeout on each.
- Linux job (`ubuntu-latest`): `swift build` and `swift test` for `JarvisCore`, plus sanity checks of `project.yml`, the plist and the entitlements.
- Mac job: `needs` the Linux job, `runs-on: macos-26`, `timeout-minutes: 20`, `concurrency` with cancel-in-progress per pull request and a SwiftPM cache.
- Pin the Xcode version with `xcode-select` after listing what the image provides.
- Install XcodeGen at a pinned release, run `xcodegen generate`.
- Build and run the `JarvisUITests` target on the selected iPhone simulator with `CODE_SIGNING_ALLOWED=NO` and parallel testing disabled. Use only the debug UI-test fixture; no live account, backend or voice service is required.
- Keep screenshot capture, comparison and the established P15-19 Factory-state matrix in the same one-boot Mac job. Pair each app capture with the matching board render, upload both plus results as a 14-day artifact, and create/update the PR comment with the reference/capture map.
- The screenshot harness forces the requested light/dark theme through an explicit Debug launch argument, independent of the simulator's remembered app preference. The comparator samples background luminance for every theme-named app and board capture; a light background in a dark capture (or the reverse) fails the gate.
- Structural comparison downsamples the 440×956 point frames into a 22×48 grid and checks mean RGB drift and luminance structure. The 0.38 tolerance is a broad structural gate, not pixel-perfect acceptance; missing references, captures, or requested-theme backgrounds fail.
- No signing secrets or reference to the signing environment.

### 1b: `ios-testflight.yml`

A separate workflow, not called from `ci.yml`.

- Trigger: manual dispatch only, started by the owner. No push trigger and no schedule, so nothing is uploaded unapproved. Never `pull_request` or `pull_request_target`, so fork pull requests can never reach the secrets.
- A GitHub Environment named `ios-testflight`, limited to the main branch. Secrets: `APP_STORE_CONNECT_KEY_P8` (the key file contents), `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `JARVIS_API_BASE_URL`, `JARVIS_ENTRA_CLIENT_ID`, `JARVIS_ENTRA_AUTHORITY_URL` and `JARVIS_ENTRA_API_SCOPE`. One plain variable, `APPLE_TEAM_ID`. Create these names exactly as written with `gh secret set` and `gh variable set`, never in chat.
- `concurrency` group `ios-testflight` with `cancel-in-progress: false`.
- One job builds, archives and uploads, so a manual run is also one Mac run and no separate compile run comes first.
- Keep-alive: the monthly upload is a reminder to the owner to run this workflow, not a schedule. An automated keep-alive of the last approved build can be added later if the owner wants it.
- Steps: check out, select Xcode 26.6, install XcodeGen 2.46.0 and generate the project; write the key to a temporary file with mode 600 and delete it in a final step that always runs. `xcodebuild archive` uses automatic signing, `-allowProvisioningUpdates`, the three `-authenticationKey...` flags, the team variable and the run number as `CURRENT_PROJECT_VERSION`. `xcodebuild -exportArchive` uses the committed export-options template with the team supplied at runtime, automatic signing and the upload destination.
- Never print the key, key ID, issuer ID or team value. Xcode build output is withheld from workflow logs so signing identifiers cannot leak through tool diagnostics. When the archive or export step fails, it prints only a filtered excerpt (at most 40 lines) with 10-character identifiers, GUIDs and runner temp paths masked.
- Owner setup, after the workflow merges: create the `ios-testflight` GitHub Environment and restrict deployments to `main`; add the seven named secrets and `APPLE_TEAM_ID` variable to that environment; confirm the Actions budget guard is in place. Keep the `.p8` key in the owner's protected setup only, never in chat or the repository.
- To ship, the owner opens **Actions → iOS TestFlight**, selects the `main` branch and clicks **Run workflow**. Do not dispatch it from a pull request or another ref. A merge to `main` does not run it.
- The first real run is unproven (Unproven items 1 and 3 below). The owner should check the signing key's role supports provisioning, the archive succeeds with automatic signing, Xcode accepts the export options and completes the direct upload, the build number rises, and the build appears in TestFlight for installation. The workflow has not been run as part of this change.
- Fallback, not enabled by default: if direct upload fails in the first real run, export the `.ipa` and upload it with `xcrun altool --upload-app` using the same key and IDs. Add that path only after the owner confirms the direct-upload failure.

## Apple Developer portal: App ID setup (owner)

Enabling capabilities needs the Account Holder or Admin role, and changing an App ID invalidates its provisioning profiles, so they must be regenerated afterwards (Checked: Apple's capabilities pages). The App ID and its App Group were registered on 30 October 2026 at the owner's request, in the owner's signed-in portal session, and the saved state was read back from the portal. Apple warned on save that adding or removing a capability invalidates provisioning profiles that include the App ID. None existed yet. This is where each item lives.

| Where | Item | Why | State |
| --- | --- | --- | --- |
| Capabilities | Push Notifications (Broadcast left off) | Alerts, silent updates and Live Activity updates. | Done |
| Capabilities | Time Sensitive Notifications | Lets a decision request break through a Focus mode. | Done |
| Capabilities | App Groups, with `group.com.danaakesen.jarvis` created and attached | Shares state between the app, its widgets, Live Activities and the P15-11 ReplayKit extension. | Done for the app; extension App ID provisioning remains to be verified before signed device testing |
| Extension App ID | `com.danaakesen.jarvis.broadcast`, with the existing App Group enabled | Registers the P15-11 ReplayKit broadcast target for signed installation. | Owner portal/provisioning check required before device testing |
| App Services | MusicKit | Lets Jarvis start Apple Music. | Done, it costs nothing |
| Capabilities | HealthKit (Clinical Health Records left off) | The owner's pick, ahead of need. Version 1 has no Health data. | Done |
| Capabilities | Side Button Access | The owner's pick. Lets a voice assistant start from the side button through an App Intent. Apple limits it to Japan, on iOS 26.2 or later. | Done |
| Capabilities | Maps | The owner's pick. Nothing in the current design uses it. | Done |
| Capabilities | Push to Talk | The owner's pick. The contract describes an open microphone with no push to talk, so nothing in the current design uses it. | Done |
| Capabilities | In-App Purchase | Apple's default, locked on. Unused. | Done |
| Separate request | CarPlay, category Voice-based conversational | Voice in the car. Apple must approve it, and it then shows as a managed capability. | Later: when CarPlay work starts |
| Later App IDs | The Watch app and the widgets extension each get their own App ID | Each target has its own bundle ID. | Later: when those targets exist |

No other portal capability is needed for this screen. Data Protection stays off: if it is ever used, the level must not be complete, because CarPlay and a locked phone cannot read such files (see the CarPlay notes). A tick only permits a capability, and the app's entitlements file decides what a build uses. Camera, microphone, location, photos and Face ID need no portal tick: each needs a purpose string in the app's `Info.plist`, and iOS shows its own Allow prompt.

Basis: Checked for the role, the profile rule, MusicKit being an App Services tick, and Time Sensitive being a plain tick (Apple lists the capabilities that need extra steps, and it is not among them). Checked in a mirror of the `xcodebuild` manual page: with `-allowProvisioningUpdates` it creates and updates app IDs, profiles and certificates for automatically signed targets, so the Watch and widget App IDs may register themselves (Unproven 2). Observed on 30 October 2026, read back from the portal after saving: the ticked capabilities above, MusicKit on, the group attached, the Push sub-option being Broadcast (left off), and Apple's profile-invalidation warning on save. Checked in Apple's documentation, read the same day: the Side Button Access limits, and the rule that camera, microphone, location, photos and Face ID need an `Info.plist` purpose string and no portal tick.

## Later: CarPlay, Watch and Music (owner intent, not version 1)

Read from Apple's CarPlay Developer Guide dated 13 October 2026 and Apple's entitlement request page (Checked), unless marked.

CarPlay

- The fit is the voice-based conversational category. Voice is the main way in, answers show no text or imagery, an audio session is held open only while voice is active, and the voice control screen is shown whenever voice is on. Recording is allowed only together with that screen. The template stack is at most 3 deep. The app must never tell the person to pick up the iPhone.
- The entitlement key is `com.apple.developer.carplay-voice-based-conversation` and it needs iOS 26.4 or later. The minimum iOS is 26, so the CarPlay code sits behind an availability check, or the minimum rises when this work starts. The owner's phone runs a newer iOS.
- Apple approves the category on request: the owner asks at developer.apple.com/contact/carplay and agrees to the addendum. After approval it shows as a managed capability: enable it on the App ID, save, regenerate the provisioning profile and add the entitlement to the app. Apple says Xcode 15 and later supports automatic signing for managed capabilities, with CarPlay as an example, and that some need a manual entitlements edit (Checked). Whether `xcodebuild` with the API key does the same in CI is untested: try automatic signing on the first CarPlay build and fall back to a manually signed profile if it fails.
- The portal's Capability Requests list already shows "CarPlay Voice Based Conversation" with no status (Observed, 30 October 2026). Apple says capability requests need the Account Holder role (Checked), so the Account Holder files the request when CarPlay work starts. Whether this list and the contact form named above are one route is unconfirmed.
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

1. A simulator screenshot timeout ("Timeout waiting for screen surfaces") is a visual-gate failure, not a best-effort pass. Recheck this runner issue when updating the pinned Xcode/image.
2. Xcode 27 has its own runner image (`xcode-27` and `xcode-27-xlarge`, arm64 only, generally available since 15 October 2026) and it still has open problems. Checked on 29 October 2026: the keychain can fail to unlock, which matters for signing (https://github.com/actions/runner-images/issues/14837), the watchOS 27.0 simulator runtime is registered twice (https://github.com/actions/runner-images/issues/14946), downloads can stall, and the Metal toolchain is missing. Stay on `macos-26` with Xcode 26.6 and revisit before Apple's next SDK deadline.
3. The ARM runners have 7 GB of memory (Checked: GitHub's runners reference lists 3 vCPUs and 7 GB for the standard arm64 macOS runner). Build one scheme at a time.
4. `macos-14` retires on 2 November 2026 (Checked: the announcements in the `macos-26` image readme). Do not use it.
5. TestFlight builds become unavailable 90 days after upload. A monthly manual upload by the owner is the cure.
6. Each upload needs a unique, rising build number. A re-run keeps its run number, so a re-run after a successful upload would be refused as a duplicate. Fold the attempt number in if that ever matters.
7. Without `ITSAppUsesNonExemptEncryption`, App Store Connect asks the encryption questions for each new version, and the key lets the owner skip them (Checked: Apple's export compliance pages). That TestFlight shows this as a Missing Compliance hold on every build is Not re-read.
8. Internal testers need no Apple review. Only external testers do.
9. The simulator cannot prove Bluetooth, AirPods, call interruptions or background audio. Voice needs a real phone.
10. App Store Connect names are unique store-wide. The owner has chosen the store name and it is deliberately not recorded in this repository. The Home Screen name can differ.

## What cloud agents can and cannot do

- Copilot cloud agents run on Ubuntu or Windows only (Checked). They cannot compile SwiftUI or run the Simulator.
- They can build and test the pure-Swift `JarvisCore` package if a Swift toolchain is present in their environment. GitHub's page on the agent environment does not list Swift as preinstalled, so install it in `copilot-setup-steps.yml`, for example with `swift-actions/setup-swift` (its readme says it works on Ubuntu runners; pin it by full commit SHA like every other action). Not re-read: which Swift version it installs, and whether the agent's own shell finds the toolchain.
- The agent's firewall does not apply to processes that run in the setup steps, only to processes the agent starts itself (Checked), so a toolchain download belongs in the setup steps. Package fetches the agent runs itself are filtered, so keep `JarvisCore` free of third-party packages or resolve them in the setup steps (my inference).
- Cloud sandbox sessions exist as well. Setup steps and the runner choice apply only to GitHub Actions sessions (Checked).
- The Mac runner in CI is the only compile check for the app layer, so red CI is the main feedback loop. Keep each pull request small so a failure is cheap to fix.
- Keep at most two builders running at once, as for every other area.

## Unproven: settle in this order during phase 1

1. The API-key role for signing. Apple says only an Admin account can create Team keys and that Individual keys cannot use the provisioning endpoints, so the key must be a Team key (Checked). The role the key needs for `-allowProvisioningUpdates` is not stated: the cloud-managed certificates page names Account Holder or Admin only for rotating certificates, not for signing (Checked). Start with an Admin-role Team key, confirm on the first upload, then try a lower role. An Admin-role key held as a CI secret is powerful, which is why 1b limits the signing environment to the main branch.
2. Which capabilities `xcodebuild` can switch on by itself. Its manual says it creates and updates app IDs for automatically signed targets (Checked, in a mirror of the manual page) but does not say whether that includes push or App Groups from the entitlements file. The owner ticks them in the portal now, so this only matters for capabilities added later and for the Watch and widget App IDs.
3. The archive step under automatic signing with the key, and the exact export-options spellings for Xcode 26. The flags themselves are confirmed.
4. A Swift toolchain in the cloud agents' environment. It is not documented as preinstalled: install it in the setup steps and confirm that the agent's shell finds it.
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

- A manual dispatch started by the owner produces a build in TestFlight with a rising build number, using no certificate in the repository.
- The owner installs it and sees the orb icon and a blank glass screen.
- A merge to main does not start the workflow, and there is no schedule.
- Fork pull requests demonstrably cannot read the signing environment.
