# Productivity blockers — 8 November 2026

Dan requests a review of anything that prevents requested Jarvis work from
finishing, following repeated approval questions and an interrupted Current test.
This review covers the chat transport, runtime test UI, tool execution and approval
boundaries. It is a source review, not evidence that every listed failure occurred
in his session. The exact cause of that live interruption remains unconfirmed.

## Corrected in the current delivery

- **Total chat deadlines:** the Foundry adapter imposed 210 seconds on the whole
  response and the conversation route cancelled work after 15 minutes. PR #1647,
  merged as `0e1767edd21d94d9682fcd6e25fb555c83003564`, keeps a connection setup
  limit but removes both total execution deadlines. Hosted and backend streams
  send transport keepalives; actual tool and model-phase events accompany replies.
  CI 42490162058 passed. Deploy 42490995273 updated both images and passed
  readiness/chat checks. Full acceptance initially failed on
  `research_runner_transport`; its read-only retry then passed. The deployment is
  qualified. A live run beyond the former limit is unverified.
- **Late disconnect:** iOS previously spent its reconnect budget from message
  submission, so a first disconnect late in a healthy turn could fail immediately.
  PR #1646 starts that budget at disconnection and reattaches to the same turn
  with GET. It never repeats the write request. Clock-controlled regression
  coverage simulates a disconnect after twenty minutes; final Core/native checks
  passed. Physical-device reconnect remains an owner check.
- **Invisible progress and refresh losing output:** the runtime test sheet ignored
  acknowledgment/tool events and cleared partial output during history refresh.
  PR #1646 renders live activity and retains unsaved output until a saved final
  result or successful reattachment is available. Final native isolation/progress
  checks passed in 42500193416 and 42501271718; owner-device testing remains.
- **Direct Factory requests needing another yes:** PR #1636 already accepts a
  verified direct request for its actual own-repository scope. The deployed
  policy is described in [the earlier review](approval-friction-review.md).
  A direct-request production write remains untested; task 23 used the older
  later-yes path and subsequently stopped for disk capacity.
- **Navigation waiting for unused camera setup:** native 42485644758's retained
  stackshot shows Chat initialization waiting in `VoiceCameraCapture.init` →
  `CIContext.init` → Metal library loading on the main thread. The placeholder
  camera was constructed even when no camera was open. PR #1646 now creates its
  image context lazily on the serial camera frame queue. Native navigation and
  camera-sheet checks passed; physical camera encoding remains an owner-device check.

## Remaining findings, ordered by impact

| Priority | Confirmed code behavior and user impact | Required follow-up and proof |
| --- | --- | --- |
| High | Factory pending proposals and duplicate-request receipts live in process-local maps and expire after ten minutes. A restart loses them immediately. A delayed approval cannot recover its exact proposal; after receipt expiry an uncertain create no longer has its original deduplication protection. | Persist scoped proposal, owner instruction, action fingerprint, state and outcome. Revalidate changed targets before execution. Test approval after twenty minutes, restart and concurrent delivery; one owner request must create at most one issue. Do not merely extend the timer or retry an uncertain create. |
| High | Approval interpretation errors, its five-second timeout, capacity limit and unavailable model become `neither`. The request adapter discards `path: failed`; callers then use wording that says Dan's instruction was unclear, or show another proposal. This turns an infrastructure failure into another question for the owner. | Carry an unavailable result separately from actual ambiguity, preserve the original request/proposal, and report a recoverable service problem. Test model timeout/unavailability versus genuine ambiguity; neither path may invent approval or repeat a write. |
| High | Uncertain Copilot inference/tool completion intentionally leaves a durable turn claim unresolved. This prevents duplicate execution, but the test UI only offers generic blocked/recovery guidance, with no complete reconciliation flow. | Read the existing provider response and recorded tool outcomes, then reconcile the same claim. Provide an inspect/recover path without starting a second turn. Test a lost response after a successful action and verify exactly one action. Do not automatically clear the claim. |
| High | In-flight normal chat/replay state is in backend memory. Shutdown aborts it; replay is retained for ten minutes after completion. Final replies are stored, but unfinished execution is not restart-durable. Removing a total deadline does not solve a deployment or replica restart during work. | Introduce durable operation/turn status and resumable progress where execution can be reconciled. Test backend replacement mid-turn and reconnect without resubmitting writes. Keep completed SQL history available when replay expires. |
| Medium | Most hosted tool calls have a 30-second read timeout; research uses a separate 320-second default. A slow write can therefore return an unknown outcome although the outer chat remains alive. The current error correctly tells the agent to check status rather than retry. | Measure slow operations and return durable job IDs/progress for genuinely long work. Test an accepted action whose response arrives late; status lookup must recover its result without another mutation. Keep bounded network failure detection. |
| Medium | The runtime test sheet disables closing while a turn runs, and its model/session is owned by that sheet. Long work can trap the owner in the tester. Simply enabling dismissal would lose the visible session on reopening. | Retain test sessions above the sheet or provide a session history picker, then allow navigation while work continues. Test leave/reopen during execution and recover the same session, acknowledgment, tools and final reply. |
| Medium | The generic GitHub confirmation helper still always stages a later-reply approval for issue/PR closure, PR merge, and public/default-branch file writes. Thus an explicit, fully scoped instruction can still trigger a second question for those operations. Ordinary issue editing, draft PR creation, private non-default-branch writes and workflow dispatch do not all use this gate. | Extend verified instruction reuse by operation and exact resource/version, distinguishing a review request from an execution request. Preserve changed-head checks, public-content review and failing-check handling. Test explicit scope, changed scope/head, quoted instructions and replay. This is not a blanket removal of confirmations. |
| Medium | The ordinary semantic approval reply is limited to 280 characters; longer replies become `neither` before interpretation. Direct Factory requests have a separate 20,000-character limit. A longer approval message with explanation can be rejected despite being clear. | Use a bounded but practical reply size and test complete long approvals, conditions and changed scope. Never truncate away a qualifier or infer approval from just the first words. |

The Factory capacity failure is a separate, confirmed operational blocker: task 23
retained scaffold commit `3ace0ad86092026e99a52f5f791c9fdb376afcc1` before
`disk_low`. The 128 GiB worker implementation is merged, but provisioning hit Azure
quota. No approval or timeout change supplies that missing capacity. Do not create
a second scaffold task to get around the existing stop.

## Release workflow follow-up

The quota-only change #1649 triggered a full normal deployment (42503216228):
`pipeline_impact.py` treats unrecognized workflow/script paths as inputs to every
production component. `worker-quota.yml` and `request_worker_quota.py` therefore
invalidated otherwise unchanged images and infrastructure. The additional deployment
continues through its normal checks after infrastructure work began.
Before the next quota-workflow code change, classify these administration-only
files explicitly and test that CI still runs their contracts while production
components are not invalidated solely by those files. This improvement is recorded,
not implemented in build 84.

## Source references

- [Approval interpreter](../apps/backend/src/core/approval-interpreter.ts):
  `MAX_APPROVAL_REPLY_CHARS`, `createApprovalInterpreter`, `safeDecision`,
  `approvalDeciderFor`; five-second decision limit, four concurrent model calls,
  twenty calls per minute and thirty-second failed-decision cache.
- [Pending action](../apps/backend/src/core/pending-action.ts) and
  [approval messages](../apps/backend/src/core/approval.ts): eligibility, expiry,
  consume-once behavior and unclear/missing proposal wording.
- [Factory tools](../apps/backend/src/factory/tools.ts):
  `pendingIssueCreations`, `requestedIssues`, `issueCreationTtlMs` and
  `confirmIssueCreation`; [GitHub tools](../apps/backend/src/factory/github-app-tools.ts):
  `approval`, `writeHandler` and operation-specific gates.
- [Hosted tool client](../agents/jarvis/jarvis_tools.py): `read_timeout` and
  `httpx.TimeoutException`; [defaults](../agents/jarvis/state.py).
- [Copilot adapter](../agents/jarvis/managed_policy_client.py): `complete_chat`,
  `claim_turn` and `finish_turn`.
- [Conversation route](../apps/backend/src/core/conversation.ts),
  [replay owner](../apps/backend/src/core/recoverable-chat.ts),
  [iOS chat client](../apps/ios/Packages/JarvisCore/Sources/JarvisCore/Chat/JarvisChatClient.swift)
  and [runtime test sheet](../apps/ios/Jarvis/JarvisRuntimeTestSheet.swift).

## Boundaries that should stay

Owner authentication, specific resource authorization, compare-and-swap checks,
explicit cancellation, bounded buffers and no replay of an uncertain write are
necessary. Their failures need an actionable explanation and recovery path.
The custom normal chat loop has no fixed tool-round cap; its two-round cap applies
only to smoke tests. The remaining 210-second diagnostic in `chat_runtime.py` is
an admin test, not the ordinary chat path. Neither is evidence that normal work
still has the removed total deadline.

Conversation context is bounded and can include a persisted summary. Whether that
summary retains the owner's active scope/authorization needs a separate regression
case; this review does not claim that all older context is discarded. Likewise,
platform/proxy lifetime limits need deployed transport evidence, not assumptions
based on local clocks. These are qualification gaps, not confirmed causes of Dan's
test failure.
