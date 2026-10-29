# iOS app

## Status: design discussion only

**Only three directions are confirmed:** a GitHub-based macOS build approach, reuse of Jarvis's existing backend, and native SwiftUI with native iOS features and controls. Nothing else is confirmed. No implementation or setup is authorized.

**Next step: reach an agreed version 1 design/prototype before native implementation.** Dan may do this locally on his PC. The execution location, device and setup are undecided; cloud execution is not assumed.

Jarvis is Dan's single-owner personal AI side project, not a multi-user commercial product. Keep the solution small and avoid overengineering.

## Design direction

The existing web design system is not the iOS design. First inventory the current features and screens, then design navigation, screen flows and controls for native iOS. Selected brand colours and visual character may carry over; which aspects to retain remains open.

[GitHub Replica](https://github.com/github/replica) was identified as the newly open-source prototyping option. It uses design guidance to build interactive web prototypes; it is not a SwiftUI or native-app generator. Whether or how to use, install or host it is unconfirmed. No Replica Hub or team infrastructure is assumed.

## Proposed design workflow

This is a proposal, not an approved set of requirements or permission to run captures or build a prototype:

1. Prepare a local copy with test data and a local-only preview/sign-in approach, without removing production login.
2. Capture a mobile-size inventory of the existing pages, menus and dialogs, and record the features each provides.
3. Propose native iOS screen flows and layouts using native navigation and controls.
4. Compare the current screens with layout alternatives and agree which brand elements to retain.
5. Create an interactive prototype and refine it with Dan.
6. Obtain Dan's approval of the version 1 scope and design before native implementation.

Browser screenshots at mobile dimensions are evidence of the web app, not validation on a native device. A web prototype can demonstrate flows and visual ideas, but cannot establish actual native behaviour.

## Build and preview approach discussed

Dan already owns an Apple Developer account and does not own a Mac. Expo was rejected. The preferred GitHub route would use standard GitHub Actions macOS runners to build and sign SwiftUI, with distribution through TestFlight, without Dan owning a Mac. Workflow configuration and signing still need to be agreed.

Pricing notes checked **2026-10-29**: standard GitHub-hosted runner compute is free for this public repository. Private-repository usage has plan-dependent included compute; the published paid macOS reference is **USD $0.062/minute**. Storage allowances and charges are separate. No costs, build triggers or configuration have been approved. See [Actions billing and usage](https://docs.github.com/en/actions/concepts/billing-and-usage) and [runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing).

Native UI changes require a build. CI screenshots/video and an invitation-only TestFlight beta are possible preview routes; there is no instant browser preview of the actual native app. [TestFlight builds expire after 90 days](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).

Signing, Entra redirect configuration and credential storage need separate approval when relevant. No secrets belong in the repository.

## Unconfirmed scope and open choices

Login and chat, followed by photos and native voice, was discussed as a possible first milestone. **This is not confirmed version 1 scope.** Design comes first; other existing features must not be silently dropped.

Open choices include version 1 screens/features, navigation, retained brand elements, prototype workflow, exact build triggers, bundle ID, signing and native authentication. This document does not choose them.

Existing migration and logging work continues independently. This document neither authorizes nor changes that work.
