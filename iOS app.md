# iOS app

## Status: design discussion only

**Three directions are confirmed:** a GitHub-based macOS build approach, reuse of Jarvis's existing backend, and native SwiftUI with native iOS features and controls. The owner has since stated the usage context and essential capabilities, and confirmed the design decisions, recorded below. Nothing else is confirmed. No implementation or setup is authorized.

**Next step: reach an agreed version 1 design/prototype before native implementation.** The design is being iterated locally on the owner's Windows PC with an HTML concept board (see the design workflow below). The native build, device and setup remain undecided; cloud execution is not assumed.

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
- **Areas open from a right-edge swipe sidebar, with no visible button or handle.** It suits one-handed right-thumb use and scales to many areas: chat and voice, notes, health, banking later and more. A bottom tab bar was rejected because it costs the full-screen chat and voice view, and a left sidebar because it is hard to reach one-handed. Settings sit at the top; pinned shortcuts and a "Jump or ask" control sit within thumb reach at the bottom. The owner chose swipe-only for the prototype and will judge it by using it. The sidebar is a custom SwiftUI component; iOS has no stock right-edge drawer.
- **Composer.** An iOS take on the web composer: glass, two rows, add, microphone and send. The owner likes the direction; the design is not final.
- **Orb.** The existing Jarvis orb design carries over. How to render it natively is open.
- **Presence.** The phone has no presence picker and always uses On the move.
- **Tools.** No paid design tools or subscriptions.

## Proposed design workflow

This is a proposal, not an approved set of requirements or permission to run captures. The owner agreed to the concept board described below. Status on 29 October 2026:

1. Prepare a local copy with test data and a local-only preview/sign-in approach, without removing production login. *Not started; the concept board uses synthetic data and does not need it.*
2. Capture a mobile-size inventory of the existing pages, menus and dialogs, and record the features each provides. *Not started; still needed before version 1 scope is agreed.*
3. Propose native iOS screen flows and layouts using native navigation and controls. *In progress in the concept board: chat, voice, notes and navigation.*
4. Compare the current screens with layout alternatives and agree which brand elements to retain. *In progress; the orb and the composer look are retained so far.*
5. Create an interactive prototype and refine it with Dan. *In progress: the concept board.*
6. Obtain Dan's approval of the version 1 scope and design before native implementation. *Not started.*

Browser screenshots at mobile dimensions are evidence of the web app, not validation on a native device. A web prototype can demonstrate flows and visual ideas, but cannot establish actual native behaviour.

**Concept board.** A self-contained HTML page that shows the app inside an iPhone frame, with the Dynamic Island, light and dark themes, a keyboard state and an approximation of Liquid Glass (Clear and Tinted). It uses synthetic data only, runs in the Copilot app's Browser canvas or any Chromium browser, and needs no Mac and no paid tool. It lives in the design session's scratch folder, not in this repository. Screenshots given to outside tools must use synthetic data only.

## Build and preview approach discussed

Dan already owns an Apple Developer account and does not own a Mac. Expo was rejected. The preferred GitHub route would use standard GitHub Actions macOS runners to build and sign SwiftUI, with distribution through TestFlight, without Dan owning a Mac. Workflow configuration and signing still need to be agreed.

Pricing notes checked **2026-10-29**: standard GitHub-hosted runner compute is free for this public repository. Private-repository usage has plan-dependent included compute; the published paid macOS reference is **USD $0.062/minute**. Storage allowances and charges are separate. No costs, build triggers or configuration have been approved. See [Actions billing and usage](https://docs.github.com/en/actions/concepts/billing-and-usage) and [runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing).

Native UI changes require a build. CI screenshots/video and an invitation-only TestFlight beta are possible preview routes; there is no instant browser preview of the actual native app. [TestFlight builds expire after 90 days](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).

Signing, Entra redirect configuration and credential storage need separate approval when relevant. No secrets belong in the repository.

## Unconfirmed scope and open choices

Login and chat, followed by photos and native voice, was discussed as a possible first milestone. **This is not confirmed version 1 scope.** The owner has since named generative UI workspaces and app control as essential; how they fit into version 1 is open. Design comes first; other existing features must not be silently dropped.

Open choices include:

- version 1 screens and features, and which existing areas the sidebar lists;
- the final composer design, pinned shortcuts and native rendering of the orb;
- how workspaces appear on a phone (sheet, full screen, several at once);
- access to the swipe-only sidebar with VoiceOver and other assistive technology;
- hands-free start routes (Action Button, Siri, AirPods, CarPlay) and background audio, whose iOS limits are unverified;
- how presence interacts with workspaces: today On the move never asks the owner to look at a screen, while generated workspaces are shown on request;
- how the active client is chosen when a phone and a desktop are both connected;
- the minimum iOS version, exact build triggers, bundle ID, signing and native authentication.

This document does not choose them.

Existing migration and logging work continues independently. This document neither authorizes nor changes that work.
