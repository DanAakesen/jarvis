# Decisions

Read [PRODUCT.md](../PRODUCT.md) for requirements and [PLAN.md](../PLAN.md) for what to do next. Merged code and offline fixtures are not live provider or physical-device acceptance.

## Standing rules

| Date and source | Rule |
| --- | --- |
| 2026-11-23 — Apple Maps | Use on-device MapKit for Chat and Voice. Keep map data temporarily on iPhone, save the owner’s lookup and hand navigation to Apple Maps. Nearby requires a checked radius; don't substitute an unrestricted lookup. A supplied origin works with location permission denied. [Apple’s Maps terms, Attachment 6](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/). |
| 2026-11-22 — Dan, [#2009](https://github.com/DanAakesen/jarvis/issues/2009) | Jarvis may administer Foundry instructions, versions, activation, models and deployments at Dan’s request. Preserve the protected backend tool contract. |
| 2026-11-21 — Dan, recorded in [#2011](https://github.com/DanAakesen/jarvis/issues/2011) and [#2012](https://github.com/DanAakesen/jarvis/issues/2012) | Do not add PI approvals, confirmations or guardrails except for DELETE actions. Prefer model judgement; use deterministic logic for exact results. Keep banking outside that ruling until Dan decides its policy. |
| 2026-11-16 — Dan's PI migration direction, [cutover checklist](pi/cutover.md); reaffirmed in the 2026-11-22 owner handoff | Build and test the replacement, then delete the old path in an explicit final phase. No fallback, dual path or shim. A deliberate short break is acceptable if called out. |
| 2026-11-22 — Dan's owner handoff; [cost and safety](agent-context.md#cost-and-safety) | No paid or live tests, including `measure_pi`, provider/model smoke, Foundry probes and benchmarks, without approval of the exact command. Ask before adding cost. |
| 2026-11-22 — Dan's owner handoff; [merge procedure](agent-context.md#merge-and-release-procedure) and [CI](../.github/workflows/ci.yml) | Keep related work in fewer, larger issues and PRs. Open only review-ready PRs, not placeholders. Require independent exact-head review and green exact-head CI. High findings block; Mediums become fixes or tracked follow-ups. |
| 2026-11-22 — Dan's owner handoff | Work locally. Cloud sandboxes are billed; do not open one unless Dan approves. Workers use `gpt-6.2-sol` at the highest reasoning effort. |
| 2026-11-22 — Dan's owner handoff | Consult Astra on real decisions. `CopilotAndCodex.md`, Astra's advice file, exists only on Dan's machine. Never commit it. |
| 2026-11-22 — Dan's owner handoff | Do not ask Dan to test before the build lands or retest a fix in flight. Once shipped, name the build and give exact checks in daily-core order. |
| 2026-11-22 — Dan's owner handoff | Answer first, keep replies very short and put a legend on diagrams. |

## Decisions of the last 14 days

Add confirmed decisions here, newest first. When an entry is older than 14 days, keep a dated link to its text in Git history in the relevant [monthly index](#index-of-older-decisions). Preserve existing IDs and anchors; do not duplicate the text.

### 23 November 2026 — Use the local day boundary for capped work

Use the next Copenhagen midnight, not a fixed-hour delay, so queued work can be checked as soon as the allowance resets across daylight-saving changes.

### 23 November 2026 — PI can diagnose its backend requests

Dan approved scoped backend diagnostics in Chat and Voice. Keep other apps, device logs and raw content outside the reader; use [the log reference](reference/logs.md) for what can be correlated.

### 23 November 2026 — Resume the accepted Chat turn and verify internal TestFlight availability

Use server turn state and committed history on return to Chat; do not resend the owner message. After upload, read Apple's processing and internal beta state for the same build instead of inferring availability. [#2043](https://github.com/DanAakesen/jarvis/pull/2043).

### 23 November 2026 — iPhone entry points and Watch navigation

On iPhone, one manual entry adds one meal with kcal and optional protein grams. Omitted macros remain unknown. Log workout and Log lift belong in Home’s + menu beside Upcoming. Watch keeps its existing destinations and uses the native clock and Back area.

Use one Copenhagen-day nutrition calculation for the Today card and the assistant. Choose one daily active-energy total so iPhone and exporter data do not count the same activity twice. [#2055](https://github.com/DanAakesen/jarvis/pull/2055).

### 23 November 2026 — Scoped Azure MCP capabilities

Allow only the pinned Azure MCP leaves for inventory, scoped storage, metrics, health and workbooks. Exclude raw Log Analytics queries: the MCP identity's role union can bypass table-level controls. The separate backend identity handles bounded log reads and queue operations. See [the tool boundaries](architecture.md#tools-retries-and-failure-copy).

### 22 November 2026 — One continuous conversation and direct Settings access

Dan confirmed that Chat and Voice share one ongoing conversation. Future context compaction must preserve it. On iPhone, the single Proactive suggestions switch belongs directly on the Settings page.

Dan approved manual kcal entry, Inbox capture and automatic nudges, retiring the old scheduled engine, and Foundry administration covering instructions, versions, activation, models and deployments. He turned on Background PI. Banking remains out of scope.

### 22 November 2026 — Qualify the exact PR tree before merge ([#2038](https://github.com/DanAakesen/jarvis/pull/2038))

- **Decision:** The author may merge a reviewed PR after its exact head passes the gates on current `main`. Merge through a PR; Deploy requires a qualification receipt for the merged tree. Use the [merge procedure](agent-context.md#merge-and-release-procedure).

### 22 November 2026 — One source of truth for agents, only current key files, delete working material

- **Decision:** [`.github/copilot-instructions.md`](../.github/copilot-instructions.md) owns the working rules and document map; `AGENTS.md` links to it. Key files describe current state. Delete obsolete working material and shipped design references; use Git and PRs for history.
- **Why:** Keep context small enough to onboard agents from the checkout. [Agent context](agent-context.md#agent-context) describes how Factory workers get the pointer.

### 22 November 2026 — Give Notes one title and a file inventory ([#2031](https://github.com/DanAakesen/jarvis/pull/2031))

- **Decision:** Keep file inventory separate from search chunks (`0103`) so title-only notes can list. Use the leading H1 or readable filename and read pins by path. Refresh newest-first on open and show one headline without rewriting saved Markdown.
- **Why:** A file can exist without search chunks. Index it separately so it can still appear in Notes and pins.

### 22 November 2026 — Keep the established PI tool names and never replay an uncertain effect ([#2033](https://github.com/DanAakesen/jarvis/pull/2033), [#2032](https://github.com/DanAakesen/jarvis/pull/2032), [#2030](https://github.com/DanAakesen/jarvis/pull/2030))

Use only `find_tools` and `call_tool` for weather, calendar and reminders. Refresh the overview in the existing conversation rather than resetting it. Keep receipts and don't replay accepted work with tool/output evidence; a retry has to fit the turn deadline.

### 22 November 2026 — Show iPhone Voice and Chat state from what actually happened ([#2034](https://github.com/DanAakesen/jarvis/pull/2034), [#2027](https://github.com/DanAakesen/jarvis/pull/2027), [#2028](https://github.com/DanAakesen/jarvis/pull/2028))

- **Decision:** Keep draft edits local, cancel only obsolete follow work, follow the live Voice exchange unless Dan scrolls back, and show the active Voice state in Chat. Thinking persists during tool work; audio completion does not wait for transcript writes. One Proactive settings panel, editable Notes titles, and Voice caption scroll that does not close Voice.
- **Why:** Keep draft changes off the expensive transcript update path; preserve the reader's scroll position. The [plan](../PLAN.md) owns physical testing.

### 22 November 2026 — Recover Watch capture and show an honest reconnect ([#2029](https://github.com/DanAakesen/jarvis/pull/2029), [#2013](https://github.com/DanAakesen/jarvis/pull/2013))

- **Decision/why:** Recover broken dictation/Voice routes instead of presenting a stale connected state. For stopped playback, report every response it silenced; a missing completion receipt can leave Voice stuck on Speaking.
- **Implementation:** [Watch recovery](../apps/ios/Packages/JarvisCore/Sources/JarvisCore/Watch/WatchVoiceRecovery.swift) and the [playback ledger](../apps/ios/Packages/JarvisCore/Tests/JarvisCoreTests/VoicePlaybackLedgerTests.swift). See the [plan](../PLAN.md) for device acceptance.

### 22 November 2026 — Keep write effects and receipts explicit ([#2023](https://github.com/DanAakesen/jarvis/pull/2023), [#2016](https://github.com/DanAakesen/jarvis/pull/2016))

- **Decision:** Log finished calls without arguments, results or IDs. Replay requires the same `_meta` call ID, tool and arguments. Keep the first receipt for successes or `outcomeUnknown`; a distinct request still runs. A JSON-RPC ID or equal arguments alone is not enough.
- **Evidence:** [MCP fixtures](../apps/backend/src/pi/mcp.test.ts) cover repeated and uncertain writes. The [effect map](../apps/backend/src/core/tool-effects.ts) classifies calls. Keep GitHub comment receipts outside the 4,000-character text and Danish aliases searchable on the first try. Live `_meta` IDs are unverified; no new approvals.

### 22 November 2026 — Share turn ordering, cancellation and failure wording ([#2024](https://github.com/DanAakesen/jarvis/pull/2024), [#2017](https://github.com/DanAakesen/jarvis/pull/2017))

- **Decision:** Claim the shared conversation FIFO across Chat and Voice. A waiting turn can expire before admission; Voice supersedes only its own earlier delegation. Release the grant and lock before the next turn, and bound provider cancellation. It is not a rollback of tool effects.
- **Why/evidence:** Parity fixtures cover both arrival orders, one stored typed turn/answer and a stuck cancel. `failureCopy` gives both channels one plain sentence per class. Only an actual turn failure looks Failed; say when something may have happened rather than asking for a blind Retry.

### 22 November 2026 — Prove tool reach and stream contracts offline ([#2022](https://github.com/DanAakesen/jarvis/pull/2022), [#2021](https://github.com/DanAakesen/jarvis/pull/2021), [#2020](https://github.com/DanAakesen/jarvis/pull/2020), [#2004](https://github.com/DanAakesen/jarvis/pull/2004))

- Qualify registered tools and channel differences offline. Read the full Foundry stream; answer only completed client-owned calls and preserve terminal-only text.

### 22 November 2026 — Make brain work and follow-ups observable ([#2025](https://github.com/DanAakesen/jarvis/pull/2025), [#2019](https://github.com/DanAakesen/jarvis/pull/2019), [#2018](https://github.com/DanAakesen/jarvis/pull/2018), [#2014](https://github.com/DanAakesen/jarvis/pull/2014))

Verified GitHub, failed-reminder and timed calendar events queue through source switches; code dedupes and the model judges interruption. Background PI defaults to off. Keep foreground and wake accounting separate, clean up only scratch conversations, and link a notification to its exact stored message. Feedback goes to the next otherwise due wake. [Architecture](architecture.md#proactive-wake-and-inbox-review) owns the active scheduler.

### 21 November 2026 — Delegate the whole spoken request ([#2001](https://github.com/DanAakesen/jarvis/pull/2001), [#2000](https://github.com/DanAakesen/jarvis/pull/2000), [#1997](https://github.com/DanAakesen/jarvis/pull/1997), [#1993](https://github.com/DanAakesen/jarvis/pull/1993))

- **Decision:** Use the whole open owner turn after the quiet window, store it once, and let PI finish through ordinary speech/barge-in. `offset_ms` is logged, not a transcript cutter. A new delegation or session end can supersede work.
- **Why/evidence:** Prior requests lost words at the offset and captions/state could disagree with playback. The relay fixtures use captured event shapes; natural audio and transport interruptions remain device checks.

### 21 November 2026 — Keep live agents Foundry-owned ([#1998](https://github.com/DanAakesen/jarvis/pull/1998), [#1994](https://github.com/DanAakesen/jarvis/pull/1994), [#1992](https://github.com/DanAakesen/jarvis/pull/1992))

- **Decision:** Foundry owns `jarvis-pi` instructions and `jarvis-pi-live` instructions, voice, greeting and `store`. Deploy seeds version 1, preserves owner edits and checks the technical contract. Keep `KEEP THIS BLOCK` unchanged.
- **Why/evidence:** A code-owned `store` check blocked Deploy; preserving live settings is intentional. [Provisioner tests](../.github/scripts/tests/test_pi_agent.py) are offline proof of that split, not a production readback.

### 21 November 2026 — Apple granted the CarPlay entitlement (Dan's report)

- **Decision:** Treat hands-free in-car conversation as a major use case. Dan reported that Apple granted **Voice Based Conversation**. This supersedes the pending entitlement status in the historical decisions.
- **Status:** Owner-confirmed grant; capability activation, app shipping and road/device behavior unverified.

### 21 November 2026 — Start from tools people can actually find ([#1996](https://github.com/DanAakesen/jarvis/pull/1996), [#1999](https://github.com/DanAakesen/jarvis/pull/1999), [#2002](https://github.com/DanAakesen/jarvis/pull/2002), [#2003](https://github.com/DanAakesen/jarvis/pull/2003))

- **Decision:** Search local tools first, resolve exact names and aliases, bind activity to the owner message, and show progress without ending the turn. Diagnose harness item shape, dead streams and weather phases. Do not add a completion classifier, answer buffer, GPT-Live output gate, fresh-conversation replay or read-only default.
- **Why:** Discovery and progress belong to the same turn as the request; a second classifier or runtime would hide the failure rather than fix it.

### 20 November 2026 — Keep Memory separate and use one PI voice action path ([#1983](https://github.com/DanAakesen/jarvis/pull/1983), [#1984](https://github.com/DanAakesen/jarvis/pull/1984))

- **Decision:** Personal Memory belongs in SQL with stable identity and source history, not in a Vault bucket. GPT-Live replaces the old native voice runtime and delegates the owner turn to PI; no ordinary fallback.
- **Why/evidence:** An indexed note is not an owner fact, and the voice model must not run a second tool surface. [SQL Memory store](../apps/backend/src/database/memory-store.ts) and [PI voice relay](../apps/backend/src/voice/pi-voice.ts) show the separate stores and delegated path.

### 20 November 2026 — Store notification receipts with the result ([#1985](https://github.com/DanAakesen/jarvis/pull/1985), [#1991](https://github.com/DanAakesen/jarvis/pull/1991), [#1995](https://github.com/DanAakesen/jarvis/pull/1995), [#1986](https://github.com/DanAakesen/jarvis/pull/1986))

- **Decision:** Durable reply pushes follow the exact stored message; reminders track per-device delivery independently of schedule success. Store situation patches and follow-up outbox changes together; only current, verified evidence can ground a reach-out. Make reply previews useful without exposing credentials.
- **Why/evidence:** Retries, restarts or one device's failed delivery must not create extra messages or lose pending deliveries. Repository SQL fixtures cover durable receipts and revisioned follow-ups. APNs and device acceptance remain separate.

### 18–19 November 2026 — PI is the normal runtime; situational state is not the source archive ([#1910](https://github.com/DanAakesen/jarvis/pull/1910), [#1964](https://github.com/DanAakesen/jarvis/pull/1964))

- **Decision:** Make PI the default for Chat and Voice. Use one compact, model-maintained, revisioned situational state grounded in canonical source records. Keep isolated runtime tests separate. Require a distinct acceptance gate before deleting legacy paths.
- **Why/evidence:** One engine prevents drift; a compact working state can go stale and cannot replace the Vault, SQL or provider as source of truth. See the [cutover checklist](pi/cutover.md).

### 15–17 November 2026 — Use the Vault for Loose Ends and keep the harness built-ins

- **Decision:** Keep durable Loose Ends notes in one Vault layout; capture, nudge and the rebuildable index are not new sources ([#1848](https://github.com/DanAakesen/jarvis/pull/1848), [#1896](https://github.com/DanAakesen/jarvis/pull/1896)). Keep harness built-ins; route GitHub and Azure through Jarvis MCP ([#1917](https://github.com/DanAakesen/jarvis/pull/1917), [#1915](https://github.com/DanAakesen/jarvis/pull/1915), [#1918](https://github.com/DanAakesen/jarvis/pull/1918)). A tool change needs its own evidence.

## Open questions and proposals

The [plan](../PLAN.md#open-decisions-af) owns unresolved choices and acceptance. Provider call-ID support and live/device behavior are verification questions, not design decisions.

## Index of older decisions

The [October](archive/decisions-index-2026-10.md) and [November](archive/decisions-index-2026-11.md) indexes point to full historical decisions in Git. Search October learnings by `LN` (for example `L63`); L33 and L34 remain reserved.

### P7-23 latency evidence

[P7-23 table in Git history](https://github.com/DanAakesen/jarvis/blob/3851f4d96cc6d33b2c4b55f6a0c8ae29d1816177/docs/archive/decisions-2026-10.md?plain=1#L8138).

<a name="catalogue-count-is-not-a-global-limit-22-october-2026-1204"></a>

### Catalogue count is not a global limit

[Tool catalogue ruling and route inventory](https://github.com/DanAakesen/jarvis/blob/3851f4d96cc6d33b2c4b55f6a0c8ae29d1816177/docs/archive/decisions-2026-10.md?plain=1#L1559).

### Daily renamed to Health

[Daily rename and legacy feeds](https://github.com/DanAakesen/jarvis/blob/3851f4d96cc6d33b2c4b55f6a0c8ae29d1816177/docs/archive/decisions-2026-11.md?plain=1#L2667) records the route aliases.

<a name="keep-the-first-web-push-proof-dark-and-user-triggered-17-october-2026-p13-01-917"></a>

### Keep the first Web Push proof dark and user-triggered (17 October 2026; P13-01 / #917)

[Decision in Git history](https://github.com/DanAakesen/jarvis/blob/3851f4d96cc6d33b2c4b55f6a0c8ae29d1816177/docs/archive/decisions-2026-10.md?plain=1#L4152).

### P14-35 — Daily v182 unresolved delivery questions (19 October 2026; #1095)

[Decision in Git history](https://github.com/DanAakesen/jarvis/blob/3851f4d96cc6d33b2c4b55f6a0c8ae29d1816177/docs/archive/decisions-2026-10.md?plain=1#L2535).

### Schema field-mapping scope

[Decision in Git history](https://github.com/DanAakesen/jarvis/blob/3851f4d96cc6d33b2c4b55f6a0c8ae29d1816177/docs/archive/decisions-2026-10.md?plain=1#L2540).

### Selected tool packaging

[Decision in Git history](https://github.com/DanAakesen/jarvis/blob/3851f4d96cc6d33b2c4b55f6a0c8ae29d1816177/docs/archive/decisions-2026-10.md?plain=1#L2638).

### Favorites query contract

[Decision in Git history](https://github.com/DanAakesen/jarvis/blob/3851f4d96cc6d33b2c4b55f6a0c8ae29d1816177/docs/archive/decisions-2026-10.md?plain=1#L2651).
