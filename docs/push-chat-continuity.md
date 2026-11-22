# Push-to-chat continuity

Owner-approved scope: tapping a proactive notification opens the existing normal
chat. The notification becomes background context for the next typed, dictated or
voice follow-up. Normal chat layout, bubbles and composer are unchanged. No greeting,
duplicate message, automatic send, context card/banner or extra conversation is added.

Implementation branch: `feature/push-chat-continuity`, based on main
`6601dbb8ca074e3f8059300f34fc9d8a4733bfcb` and refreshed with documentation-only
main `d4e4dfe1b836ed08d4d8876897cbdbc454a6f6de` before handoff. PR: [#1686](https://github.com/DanAakesen/jarvis/pull/1686). Primary owns review and integration.

## Data flow

1. Native APNs handling retains the finding UUID through the existing pending key,
   including cold start/sign-in. ContentView coalesces repeated open requests.
2. Authenticated `POST /proactive/items/:id/conversation` verifies the configured
   owner and loads the policy-allowed saved finding. Notification text is never
   accepted as model context.
3. Migration 0077 persists one selected finding UUID/timestamp per owner. Reopening
   the same finding within 24 hours keeps that selection; selecting another replaces
   it. Expired selections require another explicit tap.
4. Successful preparation opens Chat. The pending key is removed only after success.
   Failure also opens Chat, uses its existing error presentation and retains the
   UUID so another notification tap retries. There is no silent success.
5. Normal chat/steering receives bounded background finding JSON separately from
   the actual owner message/source identity. English/Danish voice refreshes context
   in existing connections and rereads it before responses, without speaking on open.
   Context reads retain voice response request order even when SQL is slow.
   The selected finding is shared across the owner's normal sessions/devices;
   runtime-test chats do not receive it.
6. Evidence dates, finding state and feedback remain explicit. The original finding
   is historical evidence, with source policy rechecked on reads. Opening cannot
   approve an action. No finding or conversation history is duplicated or rewritten.

## Qualification and primary handoff

The feature PR records the exact tested commit and existing GitHub Actions results.
This secondary session uses the connected GitHub plugin; it does not access the
owner's PC/local filesystem or run production Factory tasks.

Added regressions cover duplicate/foreign/missing selections, expiry and source
policy changes, authenticated activation, actual chat text/history preservation,
read failures before accepting a message, hosted-agent context validation, active
English/Danish voice continuity without greeting/history insertion, and native
activation requests without submitting a chat turn.

Primary must integrate migration `0077_proactive_conversation_context.sql`, compatible
hosted-agent and backend, then the native client. Existing proactive/push/APNs
switches and registrations still govern availability. No new entitlement, model
setting, infrastructure or dependency is introduced. The down migration drops only
selection metadata; revert dependent backend code first. Findings/messages remain.

Physical push taps (warm/cold/signed out), actual model wording/voice behavior,
network transitions and owner acceptance require the installed build. No UI screenshot
is provided because normal chat presentation is unchanged. This branch is not
merged or deployed by the secondary thread.

Primary integration now updates the native fixture activation route and replaces
superseded notification-to-Proactive navigation assertions with notification-to-
Chat checks for current/historical findings, no automatic send and preparation
failure recovery. These native checks require execution before claiming a pass.
