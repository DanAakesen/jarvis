# iOS app

## Status: foundation phase authorised; Phase 1a is the first work

**Three directions are confirmed:** a GitHub-based macOS build approach, reuse of Jarvis's existing backend, and native SwiftUI with native iOS features and controls. The owner has since stated the usage context and essential capabilities, confirmed the design decisions and, on 29 October 2026, answered the version 1 checklist. These are recorded below, and anything not recorded there is a proposal or still open. On 30 October 2026 the owner gave the go for the foundation phase, so implementation is authorized under the build plan, starting with Phase 1a. Later phases still need their own go.

**Next step: Phase 1a, the project skeleton and checks.** The design reference is the concept board and the system-surfaces gallery in `docs/ios/design/`. The backend contract is [docs/ios/integration-contract.md](docs/ios/integration-contract.md) and the proposed phased plan is [docs/ios/build-plan.md](docs/ios/build-plan.md). The device (an iPhone 16 Pro Max) and the bundle ID are chosen, and the App ID and its App Group were registered on 30 October 2026 (capabilities in the build plan). The build, signing and upload route still has to be proven; cloud execution is not assumed.

Jarvis is Dan's single-owner personal AI side project, not a multi-user commercial product. Keep the solution small and avoid overengineering.

## Usage context and essential capabilities

The owner stated on 29 October 2026 that the iPhone app will mostly be used while lifting weights, running on a treadmill and driving. Hands-on time must be minimal and the screen is only looked at now and then, so much of the experience should be hands-free: a voice-first, next-generation experience rather than a phone UI with voice added.

Two existing web capabilities are essential on iOS as well:

1. **Generative UI workspaces.** The owner asks for something and Jarvis builds a UI and shows it on screen. The web app does this with typed generated views: versioned declarative JSON drawn by fixed renderers, with supplied HTML, JavaScript and CSS never executed (see [PRODUCT.md](PRODUCT.md)). iOS needs native renderers for the same views.
2. **Jarvis controls the app itself.** Jarvis opens, closes and arranges workspaces and navigates the app by voice or chat. This is not a screen, but it is part of the iOS app. The web app does it through the workspace command interface, which validates each command, delivers it to the active client and waits for that client's acknowledgement, so iOS needs a native client for the same interface.

Design implications, proposed and not yet confirmed:

- Every primary action works by voice or chat; touch is the fallback.
- Screens read at a glance from arm's length: large type, high contrast, state shown by the orb and one short line, workspaces built around a few large values.
- While driving, the app works with audio alone; the screen is never required.
- Touch targets stay generous, and touch interaction stays within one-handed, right-thumb reach on a large iPhone.

## Design direction

The existing web design system is not the iOS design. First inventory the current features and screens, then design navigation, screen flows and controls for native iOS. Selected brand colours and visual character may carry over; which aspects to retain remains open.

[GitHub Replica](https://github.com/github/replica) was identified as the newly open-source prototyping option. It uses design guidance to build interactive web prototypes; it is not a SwiftUI or native-app generator. The owner ruled it out on 29 October 2026: it needs macOS or Linux and a recent Node version, so it does not run on his Windows PC. No Replica Hub or team infrastructure is assumed.

## Design decisions confirmed so far

The owner confirmed these on 29 October 2026 while reviewing the concept board. They are design decisions only and do not authorize implementation or setup.

- **Native look.** Native iOS glass materials and standard iOS controls, not a copy of the web chrome.
- **No bottom tab bar.** Chat and voice switch from the composer, which frees the full screen for both.
- **Areas open from a right-edge swipe sidebar, with no visible button or handle.** It suits one-handed right-thumb use and scales to many areas: chat, notes, health, banking later and more. A bottom tab bar was rejected because it costs the full-screen chat and voice view, and a left sidebar because it is hard to reach one-handed. The sidebar stays narrow and its rows are right-aligned, so icons and text sit close to the right edge, within thumb reach, instead of being dragged away from it. Settings sit at the top. Areas are listed from the thumb end upward: Chat first (the one area for chat and voice, named simply Chat), then Notes, Health, Software Factory (shown with a code icon), banking (later) and the remaining areas. The owner removed the "Jump or ask" control, and has since agreed to remove the row of pinned shortcuts at the bottom and to keep the list low, nearest the thumb (see the version 1 answers below). The owner chose swipe-only for the prototype and will judge it by using it. The sidebar is a custom SwiftUI component; iOS has no stock right-edge drawer.
- **Composer.** An iOS take on the web composer: glass, two rows, add, microphone and send. The owner likes the direction; the design is not final.
- **Orb.** The existing Jarvis orb design carries over. How to render it natively is open.
- **Presence.** The phone has no presence picker and always uses On the move.
- **Tools.** No paid design tools or subscriptions.

## Version 1 answers (29 October 2026)

The owner answered a 23-row version 1 checklist on 29 October 2026. Each row carried a recommendation and a Yes accepts it. These answers settle version 1 only. They do not authorize implementation or setup: the owner answered No to starting the foundation phase, so nothing is built until the owner gives the go. The owner gave that go on 30 October 2026 (see Build and process).

**Hands-free**

- A hands-free session is one the owner starts (Action Button, Lock Screen button, Siri phrase or a tap). There is no always-listening wake word.
- The session keeps running with the screen locked, and the screen stays awake while the app is in front.
- A session ends by itself after 10 minutes of silence.
- A phone call or Siri pauses the session, and one tap resumes it.

**Device and distribution**

- iPhone 16 Pro Max on iOS 27.2, with an Apple Watch. Version 1 is iPhone only: no iPad, Watch app or Mac. The minimum iOS version is 26, for the native Liquid Glass.
- The bundle ID `com.danaakesen.jarvis` and the App Group `group.com.danaakesen.jarvis` are registered (30 October 2026), with the capabilities listed in [docs/ios/build-plan.md](docs/ios/build-plan.md).
- TestFlight only, for the owner alone: no App Store release and no App Store review.
- App text is in English. Voice switches between English and Danish, as on the web.

**Accounts and data**

- Microsoft sign-in once. The app stays signed in for 10 days idle and 30 days at most, which is the existing owner session on the backend.
- **The Face ID lock is on by default**, set up at the first sign-in. This changed the proposal, which was optional and off by default. Proposed and not confirmed: it covers what is on screen and never interrupts a running voice session, with the device passcode as fallback.
- Apple crash reports only, with no analytics SDKs.
- No Health or location data in version 1.
- No offline mode. A lost connection shows a clear state and retries, and nothing is queued.

**Navigation and screens**

- The duplicate row of pinned shortcuts at the bottom of the sidebar is removed.
- The sidebar list sits low, nearest the thumb, and runs upward from there.
- A one-time hint teaches the edge swipe, and VoiceOver gets an Open sidebar action.
- Workspaces open as a full-height sheet, one at a time.
- Version 1 is chat, voice, workspaces, app control and settings. Notes and Health follow, and areas that are not built yet show dimmed as Coming later.
- **Approvals from the Lock Screen are allowed.** The proposal was that the Lock Screen never approves anything; the owner rejected it and does not want approvals blocked there. Proposed and not confirmed: yes or no only, device authentication before a decision applies, and text that names exactly what is approved. On the backend an approval stays owner-only, single-use and short-lived (see the integration contract).

**Build and process**

- TestFlight uploads run automatically after each merge to main, and by hand.
- Signing is automatic through an App Store Connect API key, with no certificates and no Mac. Proving this end to end is part of the foundation phase.
- The design docs are committed to the repository with sample content only.
- Small backend endpoints may be added later for push and Live Activity tokens.
- **Foundation phase: authorized on 30 October 2026.** Phase 1a, the skeleton and checks, is the first work. The owner earlier answered No on 29 October 2026; the go replaces that answer.
- **Cost guard (30 October 2026).** Build and test as much as possible off the Mac, and make every paid Mac run count. Logic lives in the pure-Swift `JarvisCore` package, tested on Linux on every push. The Mac check runs only for ready pull requests that touch `apps/ios/` or shared inputs, and never uses xlarge runners. The TestFlight workflow builds and uploads in one job on merge. The rules are in the build plan.

The technical defaults in the build plan (build machine, project generator, export compliance, code split, test data, screenshots, Swift language mode, app icon and keep-alive upload) stand because the owner raised no objection. The technical defaults in the build plan (build machine, project generator, export compliance, code split, test data, screenshots, Swift language mode, app icon and keep-alive upload) stand because the owner raised no objection. They are defaults, not owner-confirmed decisions. The cost guard is an owner decision. surfaces (owner intent, not version 1)

The owner wants to use Jarvis in CarPlay and on the Apple Watch in time, and music may become relevant. None of this is version 1 and nothing is authorized. The research is in the build plan:

- **CarPlay.** Apple has a voice-based conversational category. It needs Apple's approval on request and iOS 26.4 or later. An app gets only one CarPlay category, so Jarvis cannot also be the audio app, and CarPlay shows no notifications for conversational apps. Testing needs a real car or head unit, because the CarPlay Simulator is a Mac app.
- **Apple Watch.** Live Activities appear on a paired Watch without extra work. A native Watch app is a separate target with its own App ID.
- **Music.** MusicKit lets Jarvis start Apple Music playback for a subscriber. Other players have their own integration routes, which are not researched.

## Proposed design workflow

This is a proposal, not an approved set of requirements or permission to run captures. The owner agreed to the concept board described below. Status on 29 October 2026:

1. Prepare a local copy with test data and a local-only preview/sign-in approach, without removing production login. *Not started; the concept board uses synthetic data and does not need it.*
2. Capture a mobile-size inventory of the existing pages, menus and dialogs, and record the features each provides. *Not started. Version 1 scope has been accepted, so this inventory now serves to confirm that no existing feature is dropped.*
3. Propose native iOS screen flows and layouts using native navigation and controls. *In progress in the concept board (chat, voice, notes, navigation, generated workspaces and app control) and in the system-surfaces gallery (Lock Screen, Dynamic Island, widgets and controls, StandBy and car dock, sign-in, the Face ID lock and connection lost).*
4. Compare the current screens with layout alternatives and agree which brand elements to retain. *In progress; the orb and the composer look are retained so far.*
5. Create an interactive prototype and refine it with Dan. *In progress: the concept board and the system-surfaces gallery.*
6. Obtain Dan's approval of the version 1 scope and design before native implementation. *Partly done: the owner accepted the version 1 scope on 29 October 2026 but has not given the go to start the foundation phase.*

Browser screenshots at mobile dimensions are evidence of the web app, not validation on a native device. A web prototype can demonstrate flows and visual ideas, but cannot establish actual native behaviour.

**Concept board.** A self-contained HTML page that shows the app inside an iPhone frame, with the Dynamic Island, light and dark themes, a keyboard state and an approximation of Liquid Glass (Clear and Tinted). It also simulates the two essential capabilities: a generated workspace appears as a sheet, one at a time, with hand-built sample content rather than the typed generated views, and a Say menu stands in for speech so that a spoken or typed command can open and close workspaces and navigate the app. It uses synthetic data only, runs in the Copilot app's Browser canvas or any Chromium browser, and needs no Mac and no paid tool. It is committed as `docs/ios/design/board.html`. A companion page, `docs/ios/design/surfaces.html`, draws the system surfaces around the app with sample content. Both are self-contained HTML files: GitHub shows their source, so download them and open them in a browser. Screenshots given to outside tools must use synthetic data only.

## Build and preview approach discussed

Dan already owns an Apple Developer account and does not own a Mac. Expo was rejected. The preferred GitHub route would use standard GitHub Actions macOS runners to build and sign SwiftUI, with distribution through TestFlight, without Dan owning a Mac. The owner accepted automatic TestFlight uploads and API-key signing on 29 October 2026 (see the version 1 answers); the workflow configuration and signing still have to be proven. That the account is the paid Developer Program, with the owner as Account Holder or Admin (needed to enable App ID capabilities and to create the API key), is still inferred and not confirmed. Observed on 30 October 2026: the portal accepted the App ID registration and its capability changes, which fits that role but does not say which one it is.

Pricing notes checked **2026-10-29**: standard GitHub-hosted runner compute is free for this public repository. Private-repository usage has plan-dependent included compute; the published paid macOS reference is **USD $0.062/minute**. Storage allowances and charges are separate. No costs or workflow configuration have been approved beyond the cost guard in the build plan (30 October 2026), and the build triggers follow it. See [Actions billing and usage](https://docs.github.com/en/actions/concepts/billing-and-usage) and [runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing).

Native UI changes require a build. CI screenshots/video and an invitation-only TestFlight beta are possible preview routes; there is no instant browser preview of the actual native app. [TestFlight builds expire after 90 days](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).

Signing, Entra redirect configuration and credential storage need separate approval when relevant. No secrets belong in the repository.

## Open choices

The owner accepted the version 1 scope on 29 October 2026 (see the version 1 answers above). The earlier idea of login and chat, then photos and native voice, as a first milestone is superseded. Other existing features must not be silently dropped: Notes and Health follow, and the rest are later, not removed.

Open choices include:

- which areas the sidebar lists after Health, and in what order;
- the final composer design and the native rendering of the orb;
- hands-free start routes (Action Button, Lock Screen button, Siri, AirPods, CarPlay) and background audio, whose iOS limits are unverified, including whether the microphone can start on a locked phone;
- how presence interacts with workspaces: today On the move never asks the owner to look at a screen, while generated workspaces are shown on request;
- how the active client is chosen when a phone and a desktop are both connected;
- how the Face ID lock and Lock Screen approvals work with a running voice session (the safeguards above are proposals);
- CarPlay, Apple Watch and Music, which are later and need their own decisions (CarPlay also needs Apple's approval);
- the exact build triggers, the signing route (the API key's role and an end-to-end proof) and native authentication.

This document does not choose them.

Existing migration and logging work continues independently. This document neither authorizes nor changes that work.
