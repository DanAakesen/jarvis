# Decisions

Read [PRODUCT.md](../PRODUCT.md) for requirements and [PLAN.md](../PLAN.md) for what to do next. Merged code and offline fixtures are not live provider or physical-device acceptance.

## Standing rules

| Date and source | Rule |
| --- | --- |
| 2026-11-21 — Dan, recorded in [#2011](https://github.com/DanAakesen/jarvis/issues/2011) and [#2012](https://github.com/DanAakesen/jarvis/issues/2012) | Do not add PI approvals, confirmations or guardrails except for DELETE actions. Prefer model judgement; use deterministic logic for exact results. Keep banking outside that ruling until Dan decides its policy. |
| 2026-11-16 — Dan's PI migration direction, [cutover checklist](pi/cutover.md); reaffirmed in the 2026-11-22 owner handoff | Build and test the replacement, then delete the old path in an explicit final phase. No fallback, dual path or shim. A deliberate short break is acceptable if called out. |
| 2026-11-22 — Dan's owner handoff; [engineering rules](agent-context.md#development-workflow) | No paid or live tests, including `measure_pi`, provider/model smoke, Foundry probes and benchmarks, without approval of the exact command. Ask before adding cost. |
| 2026-11-22 — Dan's owner handoff; [merge workflow](agent-context.md#development-workflow) and [CI](../.github/workflows/ci.yml) | Keep related work in fewer, larger issues and PRs. Open only review-ready PRs, not placeholders. An agent never merges its own PR. Require independent exact-head review and green exact-head CI. High findings block; Mediums become fixes or tracked follow-ups. |
| 2026-11-22 — Dan's owner handoff | Work locally. Cloud sandboxes are billed; do not open one unless Dan approves. Workers use `gpt-6.2-sol` at the highest reasoning effort. |
| 2026-11-22 — Dan's owner handoff | Consult Astra on real decisions. `CopilotAndCodex.md`, Astra's advice file, exists only on Dan's machine. Never commit it. |
| 2026-11-22 — Dan's owner handoff | Do not ask Dan to test before the build lands or retest a fix in flight. Once shipped, name the build and give exact checks in daily-core order. |
| 2026-11-22 — Dan's owner handoff | Answer first, keep replies very short and put a legend on diagrams. |

## Decisions of the last 14 days

Add each confirmed decision (`#N`) or learning (`LN`) at the top of **Decisions of the last 14 days**, newest first, using the next unused number in its own series; move entries older than 14 days to the monthly archive and add a dated index link, preserving their IDs and anchors. Keep this page under 20 KB.

### 22 November 2026 — Give Notes one title and a file inventory ([#2031](https://github.com/DanAakesen/jarvis/pull/2031))

- **Decision:** Keep file inventory separate from search chunks (`0103`) so title-only notes can list. Use the leading H1 or readable filename and read pins by path. Refresh newest-first on open and show one headline without rewriting saved Markdown.
- **Evidence:** Offline fixtures cover saves, refreshed lists/pins and partial backfill. Deploy passed at `ee34f2c3e`; device acceptance is pending.

### 22 November 2026 — Keep the established PI tool names and never replay an uncertain effect ([#2033](https://github.com/DanAakesen/jarvis/pull/2033), [#2032](https://github.com/DanAakesen/jarvis/pull/2032), [#2030](https://github.com/DanAakesen/jarvis/pull/2030))

- **Decision:** Use `find_tools`/`call_tool` for weather, calendar and reminders. Drop #2030's three direct names; keep paging, the 24,000-character read cap, receipts, effect metadata and Danish aliases. Keep `list_capabilities` whole (not paged).
- **Why:** Build 122 reported a weather session-policy denial before any tool call reached the door. A stale Foundry catalogue is plausible, not proven. Send the corrected tool overview to the existing conversation without reset, rebind or compaction.
- **Decision:** Retry rate-limited requests only when safe and within the turn deadline, using the same request and results. Never replay accepted native work with tool/output evidence. Return the completed-tool receipt if the reply fails. Include iPhone Gym notes on the first `gym_lifts list` page without moving or duplicating them.
- **Evidence:** [Gateway fixtures](../apps/backend/src/pi/gateway.test.ts) cover safe retry and the accepted-stream boundary; [parity replay](../apps/backend/src/voice/chat-voice-parity.test.ts) covers Notes, Tasks and iPhone Gym. [Infrastructure](../infra/main.parameters.json) sets Terra to 600K tokens/min. #2032 and #2033 deployed after the 122 upload and apply to that build. Live rate-limit wording, cause and tool access in an existing conversation remain unverified. The owner raised the PI monthly cap above the default, per the handoff. Its value lives in the deployment env `JARVIS_PI_MONTHLY_CAP_DKK` (default `100`), not read back here.

### 22 November 2026 — Show iPhone Voice and Chat state from what actually happened ([#2034](https://github.com/DanAakesen/jarvis/pull/2034), [#2027](https://github.com/DanAakesen/jarvis/pull/2027), [#2028](https://github.com/DanAakesen/jarvis/pull/2028))

- **Decision:** Keep draft edits local, cancel only obsolete follow work, follow the live Voice exchange unless Dan scrolls back, and show the active Voice state in Chat. Thinking persists during tool work; audio completion does not wait for transcript writes. One Proactive settings panel, editable Notes titles, and Voice caption scroll that does not close Voice.
- **Why/evidence:** #2027 and #2028 shipped in 122. #2034 is in the next build with Notes #2031. The [iOS follow modifier](../apps/ios/Jarvis/JarvisChatFollowLatest.swift) and [relay fixtures](../apps/backend/src/voice/relay-events.test.ts) cover transitions. #2034 reports 37 offline parity scenarios. Scrolling, labels, interruptions and gestures need device acceptance.

### 22 November 2026 — Recover Watch capture and show an honest reconnect ([#2029](https://github.com/DanAakesen/jarvis/pull/2029), [#2013](https://github.com/DanAakesen/jarvis/pull/2013))

- **Decision/why:** Recover broken dictation/Voice routes instead of presenting a stale connected state. For stopped playback, report every response it silenced; a missing completion receipt can leave Voice stuck on Speaking.
- **Evidence:** [Watch recovery](../apps/ios/Packages/JarvisCore/Sources/JarvisCore/Watch/WatchVoiceRecovery.swift) and [playback ledger tests](../apps/ios/Packages/JarvisCore/Tests/JarvisCoreTests/VoicePlaybackLedgerTests.swift). TestFlight 121 carried #2013; 122 carried #2029. First-press capture, route changes and call recovery still need device acceptance.

### 22 November 2026 — Keep write effects and receipts explicit ([#2023](https://github.com/DanAakesen/jarvis/pull/2023), [#2016](https://github.com/DanAakesen/jarvis/pull/2016))

- **Decision:** Log finished calls without arguments, results or IDs. Replay requires the same `_meta` call ID, tool and arguments. Keep the first receipt for successes or `outcomeUnknown`; a distinct request still runs. A JSON-RPC ID or equal arguments alone is not enough.
- **Evidence:** [MCP fixtures](../apps/backend/src/pi/mcp.test.ts) cover repeated and uncertain writes. The [effect map](../apps/backend/src/core/tool-effects.ts) classifies calls. Keep GitHub comment receipts outside the 4,000-character text and Danish aliases searchable on the first try. Live `_meta` IDs are unverified; no new approvals.

### 22 November 2026 — Share turn ordering, cancellation and failure wording ([#2024](https://github.com/DanAakesen/jarvis/pull/2024), [#2017](https://github.com/DanAakesen/jarvis/pull/2017))

- **Decision:** Claim the shared conversation FIFO across Chat and Voice. A waiting turn can expire before admission; Voice supersedes only its own earlier delegation. Release the grant and lock before the next turn, and bound provider cancellation. It is not a rollback of tool effects.
- **Why/evidence:** Parity fixtures cover both arrival orders, one stored typed turn/answer and a stuck cancel. `failureCopy` gives both channels one plain sentence per class. Only an actual turn failure looks Failed; say when something may have happened rather than asking for a blind Retry.

### 22 November 2026 — Prove tool reach and stream contracts offline ([#2022](https://github.com/DanAakesen/jarvis/pull/2022), [#2021](https://github.com/DanAakesen/jarvis/pull/2021), [#2020](https://github.com/DanAakesen/jarvis/pull/2020), [#2004](https://github.com/DanAakesen/jarvis/pull/2004))

- **Decision:** Check the registered Jarvis surface with [tool conformance](../apps/backend/src/pi/tool-conformance.test.ts); [parity replay](../apps/backend/src/voice/chat-voice-parity.test.ts) flags undeclared channel differences. #2021 started with 24 scenarios (27 tests). Separate fixtures only where interfaces differ.
- **Evidence:** Gateway fixtures fragment streams by byte. Native harness work needs the full stream, not a second response. Answer only completed client-owned calls and recover terminal-only text. Live event shapes and non-DELETE gates outside ordinary PI Chat/Voice were not re-audited.

### 22 November 2026 — Make brain work and follow-ups observable ([#2025](https://github.com/DanAakesen/jarvis/pull/2025), [#2019](https://github.com/DanAakesen/jarvis/pull/2019), [#2018](https://github.com/DanAakesen/jarvis/pull/2018), [#2014](https://github.com/DanAakesen/jarvis/pull/2014))

- **Decision:** Queue verified GitHub releases/issues/comments/PRs/default-branch failures, failed reminder delivery and timed calendar clashes. Producers record and dedupe; the model judges interruption. Wakes get the Chat tool overview plus wake-only tools. Keep the existing source switches and leave the legacy slot engine in place.
- **Why/evidence:** [Signal fixtures](../apps/backend/src/pi/brain/signals.test.ts) pin producer scope; `pi.brain_tick`/`pi.brain_state`, `/pi/brain` and `/pi/status` describe skip reason and turn kind. The old claim of no wakes was not reliable before events were registered. Background PI remains off by default.
- **Decision:** Price cache reads once, keep foreground/proactive accounting separate, and clean up only scratch wake/smoke conversations. Preview the first sentence without breaking Danish/English abbreviations or emoji, link the exact message and feed `useful`/`wrong` to the next otherwise due wake. Offline wake and receipt fixtures support the contract. Live signal delivery, judgement and cleanup were not exercised here.

### 21 November 2026 — Delegate the whole spoken request ([#2001](https://github.com/DanAakesen/jarvis/pull/2001), [#2000](https://github.com/DanAakesen/jarvis/pull/2000), [#1997](https://github.com/DanAakesen/jarvis/pull/1997), [#1993](https://github.com/DanAakesen/jarvis/pull/1993))

- **Decision:** Use the whole open owner turn after the quiet window, store it once, and let PI finish through ordinary speech/barge-in. `offset_ms` is logged, not a transcript cutter. A new delegation or session end can supersede work.
- **Why/evidence:** Prior requests lost words at the offset and captions/state could disagree with playback. The relay fixtures use captured event shapes; natural audio and transport interruptions remain device checks.

### 21 November 2026 — Keep live agents Foundry-owned ([#1998](https://github.com/DanAakesen/jarvis/pull/1998), [#1994](https://github.com/DanAakesen/jarvis/pull/1994), [#1992](https://github.com/DanAakesen/jarvis/pull/1992))

- **Decision:** Foundry owns `jarvis-pi` instructions and `jarvis-pi-live` instructions, voice, greeting and `store`. Deploy seeds version 1, preserves owner edits and checks the technical contract. Keep `KEEP THIS BLOCK` unchanged. Active versions `v26` and `v16` were last reported in the handoff, not checked against the live portal.
- **Why/evidence:** A code-owned `store` check blocked Deploy; preserving live settings is intentional. [Provisioner tests](../.github/scripts/tests/test_pi_agent.py) are offline proof of that split, not a production readback.

### 21 November 2026 — Apple granted the CarPlay entitlement (Dan's report)

- **Decision:** Treat hands-free in-car conversation as a major use case. Dan reported that Apple granted **Voice Based Conversation**. This supersedes the pending entitlement status in the historical decisions.
- **Status:** Owner-confirmed grant; capability activation, app shipping and road/device behavior unverified.

### 21 November 2026 — Start from tools people can actually find ([#1996](https://github.com/DanAakesen/jarvis/pull/1996), [#1999](https://github.com/DanAakesen/jarvis/pull/1999), [#2002](https://github.com/DanAakesen/jarvis/pull/2002), [#2003](https://github.com/DanAakesen/jarvis/pull/2003))

- **Decision:** Search local tools first, resolve exact names and aliases, bind activity to the owner message, and show progress without ending the turn. Diagnose harness item shape, dead streams and weather phases. Do not add a completion classifier, answer buffer, GPT-Live output gate, fresh-conversation replay or read-only default.
- **Why/evidence:** Build uploads: [117](https://github.com/DanAakesen/jarvis/actions/runs/44920585768) (#1996); [118](https://github.com/DanAakesen/jarvis/actions/runs/44933285803), [119](https://github.com/DanAakesen/jarvis/actions/runs/44945898531) and [120](https://github.com/DanAakesen/jarvis/actions/runs/44954608415) (spoken-turn and stream follow-ups); [121](https://github.com/DanAakesen/jarvis/actions/runs/44996709049) (#2013); [122](https://github.com/DanAakesen/jarvis/actions/runs/45043429429) (#2027, #2028, #2029 and #2030). Uploads are not device acceptance.

### 20 November 2026 — Keep Memory separate and use one PI voice action path ([#1983](https://github.com/DanAakesen/jarvis/pull/1983), [#1984](https://github.com/DanAakesen/jarvis/pull/1984))

- **Decision:** Personal Memory belongs in SQL with stable identity and source history, not in a Vault bucket. GPT-Live replaces the old native voice runtime and delegates the owner turn to PI; no ordinary fallback.
- **Why/evidence:** An indexed note is not an owner fact, and the voice model must not run a second tool surface. [SQL Memory store](../apps/backend/src/database/memory-store.ts) and [PI voice relay](../apps/backend/src/voice/pi-voice.ts) show the separate stores and delegated path.

### 20 November 2026 — Store notification receipts with the result ([#1985](https://github.com/DanAakesen/jarvis/pull/1985), [#1991](https://github.com/DanAakesen/jarvis/pull/1991), [#1995](https://github.com/DanAakesen/jarvis/pull/1995), [#1986](https://github.com/DanAakesen/jarvis/pull/1986))

- **Decision:** Durable reply pushes follow the exact stored message; reminders track per-device delivery independently of schedule success. Store situation patches and follow-up outbox changes together; only current, verified evidence can ground a reach-out. Make reply previews useful without exposing credentials.
- **Why/evidence:** Retries, restarts or one device's failed delivery must not create extra messages or lose pending deliveries. Repository SQL fixtures cover durable receipts and revisioned follow-ups. APNs and device acceptance remain separate.

### 18–19 November 2026 — PI is the normal runtime; situational state is not the source archive ([#1910](https://github.com/DanAakesen/jarvis/pull/1910), [#1964](https://github.com/DanAakesen/jarvis/pull/1964))

- **Decision:** Make PI the default for Chat and Voice. Use one compact, model-maintained, revisioned situational state grounded in canonical source records. Keep isolated runtime tests separate. Require a distinct acceptance gate before deleting legacy paths.
- **Why/evidence:** One engine prevents drift; a compact working state can go stale and cannot replace the Vault, SQL or provider as source of truth. See the [cutover checklist](pi/cutover.md) and archived rollout notes.

### 15–17 November 2026 — Use the Vault for Loose Ends and keep the harness built-ins

- **Decision:** Keep durable Loose Ends notes in one Vault layout; capture, nudge and the rebuildable index are not new sources ([#1848](https://github.com/DanAakesen/jarvis/pull/1848), [#1896](https://github.com/DanAakesen/jarvis/pull/1896)). Keep harness built-ins; route GitHub and Azure through Jarvis MCP ([#1917](https://github.com/DanAakesen/jarvis/pull/1917), [#1915](https://github.com/DanAakesen/jarvis/pull/1915), [#1918](https://github.com/DanAakesen/jarvis/pull/1918)). A tool change needs its own evidence.

### 9–14 November 2026 — Keep earlier delivery decisions as history

- **Decision:** Explicit reminders are distinct from proactive suggestions; preserve honest scheduled and delivered states ([#1706](https://github.com/DanAakesen/jarvis/issues/1706), later #1995). Native Watch capture and Live Activity depend on the actual voice session and transport, not a screen flag ([#1796](https://github.com/DanAakesen/jarvis/issues/1796), [#1798](https://github.com/DanAakesen/jarvis/issues/1798), [#1807](https://github.com/DanAakesen/jarvis/issues/1807)).
- **Status:** These decisions predate the PI and GPT-Live cutovers; their dated entries in the November index record the earlier rationale and evidence, not a second current path.

## Open questions and proposals

[A–F in the plan](../PLAN.md#open-decisions-af): legacy deletion, direct manual kcal entry, context compaction, Foundry instruction reduction, Foundry administration, and banking approvals. None is standing authorization. Provider call-ID support, catalogue refresh in an existing conversation, and live/device behavior are verification questions, not design decisions.

## Index of older decisions

Each index lists the dates, outcomes and archive links, with proposals separate. The November index also links to the full evidence for recent summaries.

- [October 2026 index](archive/decisions-index-2026-10.md) · [October full text](archive/decisions-2026-10.md).
- [November 2026 index](archive/decisions-index-2026-11.md) · [November full text](archive/decisions-2026-11.md).
- Code pointers [L1–L78](archive/decisions-2026-10.md#l1) and [L79–L137](archive/decisions-2026-10.md#l79) resolve in the [October Learnings table](archive/decisions-2026-10.md#learnings). Search by ID or use its anchor (`#l78`); L33 and L34 remain reserved.

### P7-23 latency evidence

[Archived P7-23 table](archive/decisions-2026-10.md#p7-23-latency-evidence).

<a name="catalogue-count-is-not-a-global-limit-22-october-2026-1204"></a>

### Catalogue count is not a global limit

[Archived tool catalogue ruling and route inventory](archive/decisions-2026-10.md#catalogue-count-is-not-a-global-limit-22-october-2026-1204).

### Daily renamed to Health

[Daily rename and legacy feeds](archive/decisions-2026-11.md#daily-renamed-to-health-legacy-feeds-retired-p15-78-2026-11-04) records the route aliases. The name change is not a new authorization to remove existing routes.

<a name="keep-the-first-web-push-proof-dark-and-user-triggered-17-october-2026-p13-01-917"></a>

### Keep the first Web Push proof dark and user-triggered (17 October 2026; P13-01 / #917)

[Read the archived entry](archive/decisions-2026-10.md#keep-the-first-web-push-proof-dark-and-user-triggered-17-october-2026-p13-01--917).

### P14-35 — Daily v182 unresolved delivery questions (19 October 2026; #1095)

[Read the archived entry](archive/decisions-2026-10.md#p14-35--daily-v182-unresolved-delivery-questions-19-october-2026-1095).

### Schema field-mapping scope

[Read the archived entry](archive/decisions-2026-10.md#schema-field-mapping-scope).

### Selected tool packaging

[Read the archived entry](archive/decisions-2026-10.md#selected-tool-packaging).

### Favorites query contract

[Read the archived entry](archive/decisions-2026-10.md#favorites-query-contract).
