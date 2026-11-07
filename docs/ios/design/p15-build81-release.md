# Build 81 qualification and release

## Owner acceptance checklist

Use build 81 and the Current runtime. These device checks are still outstanding;
automated/native qualification below is not an owner's pass. Keep test messages
read-only and distinct. Do not resend the widget prepare request: issue 1634 /
task 23 already exists and remains blocked by disk capacity.

1. From Home, send "List my next three upcoming tasks. Do not change anything."
   Confirm one user message, an immediately cleared composer, a visible response
   or progress state, and final content without the previous false offline error.
   Repeat once directly from Chat with different text.
2. Send using the button, then keyboard Send, then system dictation. Each should
   clear once. Type a new draft while Jarvis works; the new draft must survive
   completion and delayed text/dictation callbacks.
3. During a tool-using reply, check one active progress indicator. Tool activity
   belongs to the assistant, expands while active and collapses after the final
   response. A short follow-up should produce one content-sized user bubble.
   Long-press a final Jarvis reply and select part of a sentence.
4. During a read-only reply, briefly interrupt connectivity, restore it, and
   inspect the conversation before sending again. Accepted-turn recovery must
   not duplicate the message. A failure must say interrupted/timed out with a
   recovery path; a final reply is not guaranteed through every outage.
5. Scroll Notes, Health, Factory and Settings. Headers and the Notes/Factory
   footer containers should remain transparent around individual glass controls.
   Check long task titles wrap and metadata shows scope/priority without Inbox.
6. Spot-check prior requested changes: widget light-mode supporting text and
   destinations, labelled health settings, Home section/agenda layout, Health body
   graph, and no Away mode or empty Background activity bar. The selected Notes
   redesign and Ember background are not present in this build.

For any failure, retain the build number, screen, input method, approximate time,
network conditions and screenshot. Mark only the exercised item passed.

## Changes

Home and Chat now receive small native SSE frames while the connection remains
open, preserving accepted turn identity for GET recovery. Streams use a separate
240-second idle budget; ordinary requests retain their configured bounds. Timeout
and interrupted-connection messages no longer assert the phone is offline. The
historical device exception was not captured, so exact reproduction is not claimed.

Backend #1636 accepts verified direct own-code requests without a redundant later
yes, preserves plan-first proposals and permissions, and reuses active tasks.
Repeated creates for one instruction/scope share the same process-local result.
Jarvis must verify task status before claiming work is running or complete.

## Exact source and checks

- Backend PR #1636: qualified head `278790ad634bc891176833ad285e5927e4827443`,
  merged `93a0f6292e3d0292f3b9fe05ce2bccb358b230e2`, identical tree
  `805c2ac58bb1977ecd73aa608608c250e77ac3bd`. CI 42397991835 and CodeQL passed;
  backend reported 326 test files, 7,408 passed tests and one existing skipped test.
- iOS PR #1635: qualified head `837deeb6d04a4831e48984915648aa73461fff61`, merged
  `185cc06795f34b4791c555fed6f939d3436aa381`, identical complete tree
  `680ef40d4c43ee305e0f7fe01cb35b819a371ab5`. CI 42398890076 and CodeQL passed.
- Final iOS tree `45ba946474afeb0f5c85d80bcaf19eae49273043` matches native source
  `ddfa26e1836885b60eeb761eaeb54b4feb92e3a3`. The application tree remains
  `f3f0eed1e6006c4fdb18b46a505e9c21f6597b14` across both native runs.

Native 42396567474 ran four cases: both production URLSession adapter cases and
Home-to-Chat handoff passed. Its Chat helper failed a three-second multi-query
empty-editor observation. Recorded native values were empty and hittable; all five
captures were inspected. The test's repeated remote accessibility reads consumed
the polling deadline. No production composer change was made in response.

The corrected helper matches the editor and empty value in one query, then checks
visibility separately, retaining the same three-second deadline and all remaining
interaction assertions. Native 42398644148 ran that one Chat case: one passed,
zero failed/skipped. The three unchanged cases retain their prior passes; source,
call sites and fixtures are unchanged. Final captures inspected include empty
focused editor after Send/keyboard Send, one compact follow-up bubble, final
collapsed tool activity and preserved next draft. Physical dictation/device
network transitions remain device acceptance, not simulated proof.

Retained artifacts:

- 13584311993, `p15-stream-evidence-1`, ZIP SHA-256
  `27a45c656a013212b5f16eebafa506f479a0bd0b52454e9edb2ce3ec22264ac8`.
- 13584568924, `p15-stream-chat-evidence-1`, ZIP SHA-256
  `0731c62350442354575b16878501ad0c1aa2826098893d519bef29a9b5449849`.

The failed run remains retained; no test was disabled and no deadline increased.
Validation-only workflow changes stay on `codex/widget-contrast-validation`.
Main duplicate Simulator 42399723745 was cancelled before boot after exact tree
verification. Do not rerun these native cases for unchanged source.

## Delivery

Approval Deploy 42398836350 passed readiness and live conversation acceptance:
14 entries were okay, with the disconnected PC bridge recorded as down. This
verifies normal service acceptance, not a new direct Factory write; no duplicate
widget task was created to test the policy.

Final-source Deploy 42399723720 passed readiness and live acceptance without reapplying unchanged services. TestFlight 42400008493 uploaded build 81 from exact main 185cc067. The upload step succeeded at 18:18:15 UTC / 19:18:15 Copenhagen; the workflow completed successfully. Apple processing and physical-device availability are not independently confirmed.

## Existing widget request

Issue #1634 / Factory task 23 created checkpoint `b3878f83` and scaffold commit
`3ace0ad86092026e99a52f5f791c9fdb376afcc1` on `jarvis/task-23` at 17:30:31 UTC.
Factory reported `Needs attention: disk_low` at 17:32:28 UTC. Coding began and
committed work is retained; completed validation and a delivery PR are unconfirmed.
The exact free bytes were not available through the connected read-only evidence.
Do not lower the disk guard blindly or duplicate the task. Existing Recover uses
its saved branch after the disk condition is investigated.

Notes redesign remains an image-approved target, not implemented by this release.
Copilot comparison remains unavailable without trusted compatibility evidence.
