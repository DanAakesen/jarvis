# Intelligent notifications across Jarvis

Research date: 9 November 2026. Source baseline: main `d4127ca9`. Status: proposal for Jarvis2 primary; no runtime, production configuration, permissions or live data changed. User asks for intelligent, data-driven notifications across all Jarvis data, using Peak activity notifications as an example. This is research authorization, not activation of recurring health/coaching automation.

## Finding

Extend the existing proactive engine rather than create a second assistant or separate per-page notification rules. The missing capabilities are broader evidence access, historical context, relevance selection, adaptive timing, and native iPhone delivery. Generated wording alone does not close these gaps.

The screenshot contains four activity alerts with the same displayed age, overlapping weekly target/streak messages and two weekly reset messages. Different targets could be legitimate independent goals; the image does not prove incorrect calculations or reveal Peak's algorithm. Jarvis should reconcile active goals and source identities before generating one relevant message, rather than emitting one message per goal or check. A missing workout upload must not become a claim of zero activity.

## Current source implementation

| Area | Evidence in main | What remains |
| --- | --- | --- |
| Proactive collection | `apps/backend/src/proactive/sources/registry.ts` registers todos, calendar, mail, weather, Factory, news, travel and an unavailable X placeholder. | No health, nutrition, sleep, general note or durable-memory reader. Calendar-derived travel facts are not a live disruption provider. Source availability depends on configured integrations. |
| Task coverage | `sources/todos.ts` selects open high-priority tasks, caps 40 facts and prioritizes due windows. | Ordinary commitments and broad undated work are not comprehensive coverage. |
| Intelligence | `engine.ts`, `model.ts`, `prompt.ts` combine deterministic deadline/clash findings with one tool-less model summary. Model output cites supplied references and is schema checked. | At most 80 facts/32 KiB of prompt data; no follow-up retrieval, historical time series, structured goals, baselines or prior-delivery context. References existing does not prove a generated claim is entailed by them. |
| Timing | `scheduler.ts`, `time.ts`: 07:00/18:00 Copenhagen checks, manual checks, catch-up, 22:00–07:00 quiet hours. Separate reminder ticker and vault-push planner exist. | A fixed review cadence cannot react promptly to arbitrary new workouts, changed meetings or a resolved issue. Preserve existing reminder behavior when extending triggers. |
| Alert selection | `alerts.ts` accepts scheduled/catch-up time-critical deadline, clash and travel classes. Model findings are normal/FYI and cannot self-escalate. | Normal useful model insights do not become automatic pushes through this path. Need a separate eligible normal-insight policy, not weakening urgent rules. |
| Delivery | `index.ts` wires proactive `createSystemPushSender`; `push-delivery.ts` uses browser Web Push/VAPID and bounded mostly fixed headlines. Native APNs exists separately for approvals/chat replies and ActivityKit. | Proactive findings need native APNs delivery, categories and navigation. Existing APNs presence is not proof that this path works on iPhone. |
| History/feedback | Durable findings, deduplication, snooze, seen/dismiss, useful/wrong feedback and explicit scope/category preferences exist. | `engine.ts`/`prompt.ts` do not retrieve feedback, prior outcomes or delivery history for model selection. No evidence of learned personal ranking in that path. |
| Health foundation | `/health/sync`, workouts/lifts, nutrition, training-target stores and native HealthKit readers exist. Training goals include daily steps, gym/week and runs/week; missing goals are null. | No proactive adapter consumes these stores. No `HKObserverQuery`/`enableBackgroundDelivery` implementation or HealthKit background-delivery entitlement was found in the iOS app. Historical completeness and workout de-duplication must be preserved. |
| Memory | `core/memory.ts` has explicit, provenance-backed preferences, decisions, project facts and unfinished tasks. | Not supplied to proactive generation. Existing memory rejects sensitive health information: do not bypass that by copying raw health into generic memory. |

Code presence is not live qualification. Production feature-switch state, push credentials/tokens, effective saved preferences, current health completeness and actual device receipt were not inspected. Existing docs contain historical activation claims; this report does not turn them into current verified state.

## Proposed processing

1. **Read bounded changes and relevant context.** Reuse existing source registry/stores and add domain adapters for health/training, nutrition, notes/commitments and approved memory. Each fact needs stable identity, source version, event time, observation time, freshness/completeness, sensitivity and an authenticated destination. Include effective goal version and period. Missing, stale, denied and zero are distinct states.
2. **Calculate facts in code.** Compute counts, percentages, trends and periods from canonical data. Use personal baselines only when history is sufficient. Preserve units, Copenhagen/DST boundaries, local daily versus weekly windows, and existing HealthKit/manual-workout reconciliation. Do not invent streaks or infer an unset target. New connectors need small explicit read contracts; “all data” means authorized connected data, not unrestricted access.
3. **Retrieve context for the candidate.** Pull only relevant goal history, calendar availability, commitments and notification history. Avoid pouring the full vault, mailbox or health archive into every prompt. A bounded read-only retrieval stage can broaden the current tool-less summarizer later; it must inherit existing access/personal-work preferences and source-text distrust.
4. **Ask the model whether anything is worth attention.** Return zero or more structured candidates: evidence IDs, claim/metric references, why now, proposed next action, expiry, title/body and intended destination. Model judges usefulness and composes varied wording. Explicitly allow silence, positive progress and combined cross-domain insights; avoid pressure language unsupported by the facts.
5. **Validate and choose the channel.** Resolve every reference; verify numerical claims against computed metrics and textual claims against cited evidence; re-read mutable source/goal versions before sending. Check action feasibility, freshness, exclusions, snooze, sensitivity, expiry, deduplication and the configured attention budget. Do not use model-reported confidence as a truth check. Choose push now, next digest, in-app only or suppress. A normal insight must not become time-sensitive merely because the model calls it urgent.
6. **Persist before delivery.** Extend the durable finding/delivery ledger with a semantic topic, entity/goal/window identity, evidence version, expiry and outcome. Add delivery claims/outbox behavior where the existing per-path ledger cannot protect retries/concurrency. Group the same underlying issue across sources. Rephrasing a message must not reset its cooldown. Re-check for task completion, a fresh workout or a changed meeting before dispatch; expire stale pending alerts.
7. **Deliver through one preference-aware coordinator.** Share a finding ID across iPhone APNs, browser and in-app feed. Avoid sending the same insight to every registered surface independently. Add native routing to a finding and optional chat continuation with the original evidence. Keep approvals and owner-requested reminders distinct so their semantics and guarantees do not change.
8. **Use feedback cautiously.** Feed explicit useful/wrong and too-often/not-relevant signals into bounded ranking/context, with explainable user controls. An ignored notification is weak evidence, not permission to change a lasting preference. No automatic calendar booking, task completion or live Factory execution follows from a suggestion.

The model should not decide arithmetic, identities, deadlines, delivery retries or access rights. This preserves the user's no-hardcoding intent: no fixed motivational scripts, invented targets or independent per-feature alert rules; reusable data contracts and delivery guardrails remain necessary.

## Examples of generated opportunities

Illustrative only; these are not observations about the owner's data.

- Training plus calendar: current progress against a saved weekly goal and a suitable free period could support a single optional workout suggestion. A free slot alone is not proof of availability, recovery or suitability.
- Tasks plus calendar: a commitment due tomorrow and a busy afternoon could justify offering a short preparation block.
- Notes plus meetings: an unresolved decision linked to tomorrow's meeting could prompt preparation, grounded in the actual note and event.
- Mail plus tasks: a requested reply and an existing related task should become one follow-up insight, suppressed if a verified reply already exists. Header-only mail access cannot establish message-body commitments or replies; fetch through authorized existing tools or withhold the claim.
- Factory: a verified blocker or completed result can support a concise update; reuse existing task notifications instead of duplicating them.
- Nutrition/progress: identify a supported longer-term pattern only with adequate logged coverage. Missing meals are not proven low intake. Detailed health claims stay inside the authenticated app.

## Triggering and Apple constraints

Use source-change triggers where available (persisted task/note changes, committed health uploads, calendar/mail updates, Factory events), coalesced by entity/window. Keep periodic reconciliation for missed events and historical trends. Store changes that arrive during quiet hours for re-evaluation afterward, not blind replay. Global quiet hours and budget remain policy, not prompt suggestions. Event-driven checks need debouncing and bounded model calls; do not run a model for every step sample.

The server can send an APNs visible alert without the app being foregrounded; it cannot read HealthKit directly. iPhone HealthKit observer/background delivery can improve uploads but is system-controlled. Silent pushes are not a reliable clock or guaranteed health refresh. If data is stale, suppress negative/inactivity claims rather than send “0 workouts”.

Apple advises against sensitive personal/confidential details in push notifications. Health, private mail and work information require a minimal, nonsensitive push and authenticated detail view; simply hiding previews is not a substitute for excluding sensitive payload content. Retain consent/provider boundaries when supplying any data to model processing. Respect Focus and normal interruption levels; remote acceptance does not prove display or reading.

Official sources checked 9 November 2026:

- [HealthKit observer queries](https://developer.apple.com/documentation/healthkit/executing-observer-queries)
- [HealthKit background delivery entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.healthkit.background-delivery)
- [Background pushes are not guaranteed](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app)
- [App Review Guidelines, section 4.5.4](https://developer.apple.com/app-store/review/guidelines/)
- [Notification guidance](https://developer.apple.com/design/human-interface-guidelines/notifications)

## Delivery proposal for primary

A. Create an offline evaluation set from fixtures across every intended domain. Include positive progress, genuine opportunities and cases requiring silence. Replay source changes, missing data and duplicate goals. Produce proposed notifications and suppression reasons in shadow mode, with no sends or automatic writes.

B. Reuse the proactive foundation, add structured evidence/goal/time-series access, history-aware ranking and a common delivery policy. Implement adapters against canonical stores rather than per-screen data. Add APNs finding delivery and native routing; reconcile the existing browser/reminder/approval paths.

C. Qualify native foreground/background/locked-device behavior and phone/Watch routing, opt-out/privacy, duplicate/retry handling, expiry and source changes. Owner chooses which domains and interruption level to enable; primary owns configuration, installation and rollout. Begin with the best-covered domains while preserving the cross-app architecture, rather than claiming all sources ready at once.

D. Add feedback-informed selection and longer baselines only after evidence quality and actual notification usefulness are measured. Track duplicate/stale/unsupported rates, useful/wrong feedback, qualified delivery outcomes and model cost. A click alone is not success. Record why the system stayed silent and why it sent.

Acceptance should include: goal changes invalidate old candidates; completed/replied/resolved items suppress pending pushes; missing sync never means zero; one issue across multiple sources yields one notification; one account does not receive duplicate browser/native alerts by default; sensitive payloads contain no private details; exact reminders survive ranking changes; quiet hours and opt-outs work through retries/restarts; no proactive work starts Factory tasks or changes records without existing authorization.

## Coordination and limits

Open PR #1526 covers native Proactive/settings UI; this proposal concerns broader source coverage, reasoning, timing and delivery. Primary should reconcile that PR before assigning UI edits. No overlapping implementation was started. Prior Daily scope excluded new coaching/recurring health automation; this research proposes the new owner-requested direction but does not silently enable those excluded features or change global policy.

Assessment used source inspection on latest main and official Apple documentation. No tests were run because no runtime code changed and dependencies are absent in the research checkout. No live owner data, cloud resources or production secrets were queried. Native delivery, source completeness and end-to-end usefulness remain unverified until primary qualification.
