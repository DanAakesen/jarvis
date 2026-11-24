# PI cutover and retirement gates

PI serves normal Chat and Voice without an engine selector. The native GPT-Live replacement in [#1974](https://github.com/DanAakesen/jarvis/issues/1974) is separate from retiring the remaining parked runtime. The [Phase 7 approval](https://github.com/DanAakesen/jarvis/issues/1887#issuecomment-6981225174) covered the default switch only. Neither closed issue authorises broader harness or resource deletion.

Use the [architecture map](../architecture.md) for current routing and [the plan](../../PLAN.md#next-steps-and-blockers) for device acceptance.

## Owner acceptance

| Area | How | What good looks like | Reference |
| --- | --- | --- | --- |
| Chat | Use normal Chat for a day; there is no engine choice | Quality at least as good as before; first text about 1.1 to 1.3 s warm, about 3.3 s cold; honest errors and write receipts; delete confirmation and tool parity with Voice | Timing is the November trial baseline, not a new measurement. [Current Chat and Voice contract](../architecture.md#chat-and-voice) |
| Voice | Start normal Voice (first answer takes a few seconds), ask something that needs a tool, say a backchannel ("mm-hm") while it works, then ask a follow-up | A short sentence from PI before a tool call, then a short spoken answer. A backchannel does not stop PI; a new delegated request can supersede it. Later turns about as fast as warm chat; Chat and Voice remember each other | [Voice diagnostics](../reference/logs.md#where-to-look) |
| Brain | Use **Proactive suggestions** on the main iPhone Settings page. Open Proactive for the last review and next check. | Useful reach-outs without duplicates; honour the owner settings and background limits | [Proactive flow](../architecture.md#proactive-wake-and-inbox-review) |
| Watches | "Keep me updated on X"; list; stop | Looks and reports as asked, shows the estimated cost per watch and does not send duplicate messages | [Proactive flow](../architecture.md#proactive-wake-and-inbox-review) |
| Reach | Verify the intended GitHub and Azure bridge configuration | Reads and actions work on real questions, or PI says plainly it does not have access | [Tool discovery](../architecture.md#tools-retries-and-failure-copy) and [configuration names](../agent-context.md#configuration-names-only) |
| Cost | Use available status evidence; no live measurement without approval | A plain turn about 0.05 DKK, a tool turn about 0.17 DKK | Historical per-turn reference, not a new measurement. [Cost and safety](../agent-context.md#cost-and-safety) |

Watch and web follow the same PI route. Camera and screen sharing in web Voice return `not_supported`. Old harness code remains for isolated runtime tests, not as a normal fallback.

## Retirement gates

Broader retirement is **not approved**. [#1972](https://github.com/DanAakesen/jarvis/issues/1972) covers verified dead backend code, not blanket approval to remove the parked runtime.

1. Confirm at least two weeks on PI by default without a revert or unplanned outage. The owner must accept Chat, Voice, Proactive, Inbox and standing watches in normal use. Compare latency, cost and quality with the acceptance targets above using existing evidence; live tests require approval.
2. Obtain the owner's written acceptance of harness preview risk (or verify general availability) and approval of the exact removal scope. Before removing anything, tag the last good release with the old path and record rollback steps. Rollback is a reviewed revert and redeploy, not an engine switch.
3. Rescan the exact merge base. Check isolated test clients, backend imports, CI, Deploy and Bicep. Retain shared PI dependencies, including Chat recovery, tool lookup and the proactive queue. Do not delete stored data or migrations. Verify that any proposed Foundry or Azure removal is exclusive to the parked runtime; source does not prove live usage or ownership.
4. Move shared dependencies first. Remove obsolete client and backend paths together, then remove their delivery wiring. Retire dedicated resources only after verification and once the previous release is no longer needed for rollback.

[Decision A](../../PLAN.md#open-decisions-af) retired the scheduled slot runner, not the legacy harness. Keep the PI queue and scheduled Inbox review as described in [architecture](../architecture.md#proactive-wake-and-inbox-review).
