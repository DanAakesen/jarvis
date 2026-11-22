# Decision archive: November 2026

Historical snapshot from `docs/decisions.md` at `0ff1d1650e99`, through the 22 November handoff. See the October archive for the original mixed-month decision table. Use the current [document](../decisions.md) for active requirements and decisions.

Original wording is retained except for public-repo redactions and link/anchor maintenance. Commands and statuses below are historical, not authorization to run anything.

## 22 November 2026 — Price PI cache reads correctly, clean up wakes, and make reach-outs actionable (Refs #2011)

- Apply the Azure GPT-6.1 Terra meters to new PI ledger rows: [amount omitted] for cache reads, [amount omitted] for uncached input and [amount omitted] for output, per million tokens. Foundry usage has no cache-write count; the [amount omitted] meter is documented but input not reported as a cache read is estimated at 6.7. An unreported round that started uses 18,000 input tokens (about 18,008 observed), plus estimated output. No backfill, migration or change to the general Foundry usage meter. Foreground and proactive caps stay separate.
- Delete only the scratch conversations created for a wake or smoke, after any outcome. Cleanup waits at most five seconds, logs failure and does not change the turn result. Keep the owner conversation, the existing situational context and the 30-event batch. Which events deserve a message stays with the model.
- Use the existing reply outbox and exact session/message link. Render the first sentence in a title of up to 60 characters and body of up to 180. Chat and Voice still read the same durable evidence and follow-up IDs. Store `useful`/`wrong` feedback on the exact message; the latest rating reaches the next otherwise due wake in one line, even after a pause. It stays available until a newer rating, without scheduling a wake or changing preferences.
- Node 22.23.3 ignores the `ss` locale extension for sentence segmentation. Keep the built-in boundaries except after common Danish and English abbreviations such as `kl.`, `f.eks.` and `Dr.`. Keep the code-point caps, but clip at a whole grapheme so emoji, flags and accents stay intact.
- This is offline qualification, not evidence of live model judgement, Foundry cleanup or delivery on an iPhone or Watch. No change to Foundry instructions, the owner switch or the parked legacy engine.

## 22 November 2026 — Retry rate-limited PI requests without replaying effects (Refs #2012)

- Build 122 hit a `rate_limit_exceeded` terminal event after a work-status read and again after a task was completed. The 46–47 s elapsed was within both turn deadlines. The 60 s connect timeout stops waiting for headers, not an accepted response; the cause of the limit (request rate, token rate or provider capacity) is still unverified.
- Retry HTTP 429 and output-free rate-limit failures on the same request, up to twice per turn, using the provider's delay when longer than the backoff and only if the wait fits. A follow-up uses the results already built, not another tool dispatch. Do not resubmit approvals or replay an accepted native stream with output or tool evidence. The current Foundry endpoint has no documented retry for a terminal failure of one internal round; resending the message could execute the write under a new call ID.
- A finished tool and an unfinished model reply are different outcomes. Use dispatcher's confirmations for Chat and Voice receipts and keep the turn failed in the ledger. Only uncertain work gets the check-before-retrying language; do not show a failed-send Retry beside a saved receipt. No approval or action policy changed.
- iPhone Home/Health writes lifts to Gym notes, whereas web, Watch and assistant writes use SQL. Show recent iPhone notes on the first `gym_lifts list` page without moving or duplicating data. An unspecified “What did I log?” still spans workouts, meals and tasks; no alias can identify which one Dan meant. Offline replay confirms the store mismatch, not where Dan's particular lift is.

## 22 November 2026 — Keep the two PI tool names that existing conversations know (Refs #2012)

- Build-122 Test 9 said weather access was denied by the current session policy. The supplied trace shows `toolCount: 0` and no `pi.mcp_tool` weather call, consistent with denial before the tool reached the backend. `provision_pi_agent.py` configures one MCP entry with no `allowed_tools` and `require_approval: never`; its fingerprint sees the MCP connection settings, not the server's `tools/list` contents. `ensureConversation()` reuses the stored provider ID for the owner and `agentName`, without a catalogue or agent-version check. [OpenAI's Responses docs](https://developers.openai.com/api/docs/guides/tools-connectors-mcp) describe reuse of `mcp_list_tools` in context, but [Microsoft's Copilot harness docs](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/use-tools-skills-copilot-harness) do not document its session policy refresh rules. A stale session allowlist is plausible, not proven.
- Restore `find_tools` / `call_tool` for weather, calendar and reminders, not a second connector path. This retains #2030's read cap, effect metadata, replay checks and Danish aliases. The restarted backend sends the corrected tool overview on the first turn even when it reuses the provider conversation. There is no provider rebind, history replay or Foundry instruction edit. Once the backend change ships, Dan can repeat the weather question in his current conversation; there is no reset or explicit Retry requirement.
- Chat and Voice used the same vault search/read path. The supplied 363-byte `vault_read` success followed by a rate limit is consistent with a successful read and failed reply, not an unreadable note. Replay both a full answer from the note contents and a failure after the read; the latter gives the recorded read confirmation, not invented content.
- A plain turn submits new input and the bound conversation ID, not the SQL transcript. [Foundry conversations](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/runtime-components) persist input and output items. The reported 84–116K input tokens are about 66–98K above the 18K fresh-prompt baseline when there is one round, so accumulated provider context (including earlier tool results) likely dominates; `pi.turn` cannot itemise that split and sums usage across gateway rounds. Cache reads reduce the bill, not the reported context size. [Azure OpenAI compaction](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses#context-compaction) can carry a compact state for supported Responses calls; support and preservation of details on the managed Copilot conversation endpoint are unverified. Do not reset, prune or compact the owner's conversation in this change.

## 21 November 2026 — Week summary 2026-11-21: index of the 20–21 November decisions

Index only: no new decision, evidence or trade-off. Each row names the detailed entry by its heading and says what it replaced. The summary of the state is in `PLAN.md` ("Week summary 2026-11-21"), `docs/architecture.md` ("System map") and `docs/agent-context.md` ("Working rules"). Entries marked "end of file" sit near the end of this file, not at the top.

| Topic | Detailed entry (heading) | Status |
| --- | --- | --- |
| North star, priorities, approvals | Not a decision entry. Recorded in `PRODUCT.md`, "North star", and in issues [#2012](https://github.com/DanAakesen/jarvis/issues/2012) (P0) and [#2011](https://github.com/DanAakesen/jarvis/issues/2011) (P1) (Dan, 21 November 2026, relayed by the Dispatcher session) | Current. P0: every tool call behaves the same in Chat and Voice, with no errors. P1: proactive intelligence. Dan's rule, as relayed: no approvals, confirmations or gates except DELETE actions. #2021 reports that no non-delete confirmation is reachable by a Chat or Voice PI turn (not re-checked) |
| Voice cutover (#1984) | "Replace direct Voice Live with one PI-delegated GPT-Live agent"; "GPT-Live review corrections (post-2db2a87)"; "GPT-Live voice fidelity (#1988)" (#1993) | Current, except the points listed as superseded below |
| Foundry owns the agents | "2026-11-20 Voice agent instructions, voice and greeting are Foundry-owned" (#1992, end of file); "2026-11-20 Main agent (`jarvis-pi`) instructions are Foundry-owned" (#1994, end of file); "2026-11-21 Voice agent `store` is Foundry-owned" (#1998, end of file) | Current. Replaces the cutover entry's immutable `jarvis-pi-live` (code-set voice, `store: false` verified) and the `jarvis-pi` instructions that were in the fingerprint and the readback |
| Tool baseline | "21 November 2026 — PI finds and calls its tools reliably: the approved baseline (#1967)" (#1996, end of file) | Current. Replaces the #1910 start-up warm-up of the GitHub and Azure bridges. PR #1987 was closed unmerged and only read |
| Speech and PI | "2026-11-21 Voice: speech never cancels PI's work" (#1997, end of file) | Current. Replaces the "Dan starting to speak cancels the turn in flight" row (#1908) of "16 November 2026 — PI phase 6: voice runs through the PI agent, the relay drives it (#1887, P15-176)" |
| Whole spoken request | "2026-11-21 Voice: Dan's request stays whole and reaches PI (#1988, #1967)" (#2000, end of file); "2026-11-21 Voice: the whole spoken turn goes to PI; `offset_ms` no longer cuts it (#1988, #1967)" (#2001, end of file) | #2001 is current. It replaces the `offset_ms` rule of #1993 and #2000, and the 0.6 s quiet windows of #2000 and of the GPT-Live cutover entry, with the whole open turn and 1.5 s (`VOICE_TURN_QUIET_MS`). 0.6 s remains only for grouping the assistant's output |
| PI failures and harness items | "21 November 2026 — Log why PI chat turns fail and retry a dead stream once (Refs #1967)" (#1999); "21 November 2026 — Log which item the harness sent before a tool approval failure (Refs #1967)" (#2002) | Current. #2002 changed logging only |
| Gateway and native harness calls | "21 November 2026 — Native harness calls finish on their own; only client-owned ones are answered (Refs #1967)" (#2004) | Current (merged 21 November, 21:47 UTC), except the completion and later-output rules changed by #2020 (next row). Replaces the rule that any harness `function_call` or approval request ends the turn (`approval_or_function_call_item`), which #2002 had only made visible in the logs |
| Gateway stream hardening | "21 November 2026 — Harden the gateway stream handling against five contract gaps (Refs #1967)" (#2020) | Current. Supersedes "`status: completed` or no status" in the #2004 entry: a call is client-owned only when a `completed` status, or a `done` event or completed-output entry without a status, shows its item finished. It also changes what counts as later output (an `mcp_call` that was only added now counts; closing an item that opened before the call does not) and adds reply text that only a done event or the completed output carries. Offline only; whether the provider emits these shapes is unknown |
| Wake and Chat parity | "21 November 2026 — A wake opens like a new Chat conversation: same tool overview, parity tests (Refs #1967)" (#2014) | Current. Replaces the wake path that sent only the trusted context and the wake text: the tool overview note now reaches a wake through the same helper as Chat |
| Proactive signals | "21 November 2026 — The queue hears what matters to Dan, as plain events (P1-2, Refs #1969)" (#2018) | Current. Supersedes the older rule that only finished workflow runs and deployment results queue from GitHub (marked in place in the #1858 entry). Producers only record and the brain decides. Offline fixtures only; Dan ticks `Release` in the live GitHub App and observes real events behind the PI switch |
| Seeing the brain | "21 November 2026 — See the brain: tick and skip logging, status, turn attribution, and the old engine's failures (Refs #1969)" (#2019) | Current once merged. Logging, status and failure naming, plus three scheduler fixes; no model call, no new gate. Registers `pi.brain`, `pi.brain_run` and the other `pi.*` and `proactive.*` events that were exported as bare `backend.event`. The old 07:00/18:00 slot engine is kept and instrumented: its deletion is parked and decision A (`docs/pi/cutover.md`) is open. Not run live: the first real `pi.brain_tick` and `pi.brain_run` lines after deploy are the check |
| Chat and Voice parity | "21 November 2026 — Chat and Voice are held to the same behaviour by offline replay tests (Refs #1967, #1988)" (#2021) | Current. Changes how Voice words an unexpected failure or an empty reply (now Chat's sentence), what the voice warm-up sends (the persona and situation block once) and the channel label on a spoken turn's tool activity. Five product choices are left for Dan (the entry's list) and the live check is open |
| MCP door ledger and replayed requests | "21 November 2026 — Every MCP door call is logged; only a replayed request is answered twice (Refs #1967)" (#2016) | Current, as amended in place on 22 November (#2012): counting, writer classification and the replay of an uncertain write changed. The entry records two rejected designs (answer any identical action twice; use the JSON-RPC id as an identity) and an amendment of 22 November. Whether Foundry sends a call id is unverified |
| Write safety | "22 November 2026 — A write is told as it happened, counted by what it did, and an uncertain one is not written twice (Refs #2012, #1967)" (end of file) | Current once merged. Adds no approval, refusal or gate. Amends the #2016 entry in place |
| Voice screen stuck on Speaking | "2026-11-21 Voice: stopping the player reports every response it silenced (#1988)" (#2013, end of file); "22 November 2026 — Follow live Voice in iPhone Chat" | Keep #2013's per-response receipts. The build-122 follow-up also restores Thinking during tool work and removes the dependency on transcript writes for audio completion. Dan's device retest is open |
| Weather | "21 November 2026 — Make the weather tool log its phases and retry a stalled fetch (Refs #1967)" (#2003) | Current |
| Memory, pushes, reminders, proactive | "20 November 2026 — Personal Memory is SQL-owned, never a Vault bucket (#1968)" (#1983); "20 November 2026 — Durable reply delivery belongs to the stored message (#1970)" (#1985); "20 November 2026 — Reply previews are useful by default (#1989)" (#1991); "20 November 2026 — PI state changes are server-owned patches, and follow-ups stay in the one event queue (#1969)" (#1986); "20 November 2026 — Owner reminder scheduling is not device delivery (#1990)" (#1995) | Current. #1991 removed the broad health, financial and identity preview fallback that #1985 had added |

Rejected by Dan, so not to be rebuilt without a new decision (list in the #1996 entry): a GPT-Live output gate or exact-transcript matching (the idea to speak PI's commentary exactly); fresh conversation rotation and replay; the request/completion classifier; pre-call action refusal; per-tool contracts; withholding or buffering the final answer; `pi_incomplete`; Memory write contracts; wake receipts; durable-work enforcement; persona as a Foundry `pi_context` input. PI stays unrestricted: no guardrails or read-only defaults were added. Dan's rule of 21 November 2026, as relayed: no approvals, confirmations or gates except DELETE actions (`PRODUCT.md`, "North star"). The #2021 entry reports that no non-delete confirmation is reachable by a Chat or Voice PI turn (not re-checked here).

## 22 November 2026 — Chat and Voice wait on the same PI conversation (Refs #1967, #1988)

- **Decision:** The gateway admits Chat and Voice in arrival order. Crossing channels does not stop the active request; a new delegation supersedes only the previous turn in that voice session. A wait counts against the existing 180 s gateway deadline and the shorter 90 s Voice deadline; an expired waiter is removed without sending its message to PI.
- **Cancellation:** A stopped response releases its tool grant and conversation lock before the next request. For a known unfinished response the gateway waits at most 5 s for one best-effort cancel request, even when the stream itself does not finish closing. Before `response.created` it has no ID to cancel, so it logs that and stops locally. The cancel does not promise that a write was undone or that Foundry stopped if it did not answer.
- **Deadline copy:** Both channels use #2017's `failureCopy` classes. A timeout before model admission uses the clean sentence. An in-flight timeout warns about possible partial work when the gateway saw a tool, a follow-up response or work on the grant. Voice sends the sentence before waiting for provider cancellation; the next turn still waits for the lock.
- **Startup:** Audio does not wait for the optional proactive receipt context. A read still has a 1.5 s bound and a diagnostic when unavailable. The relay refreshes at the delegated turn boundary so a newer receipt is not lost.
- **Evidence:** Offline stub streams cover cross-channel ordering, supersession and session end, timeout copy and lock release, and startup with a stalled context read. No live provider or device acceptance was run.

## 21 November 2026 — Harden the gateway stream handling against five contract gaps (Refs #1967)

- **Evidence:** an independent advisor reproduced five offline contract failures on the real `respond()` at `6379822d` (in-memory `fetch`, 420 generated cases, byte-fragmented streams): all 101 gateway tests passed, 21 new shape groups were added, 16 passed and 5 failed. Whether the provider emits these shapes in production is **unknown**; this is defensive hardening of the documented client-owned loop, not a fix for a production failure.
- **Kept (#2004):** each `function_call` / approval is classified after the whole stream, by call id. Native (the harness ran it): a `function_call_output` for its id, its own non-null `output`, or other output after it, in the events or the completed `output` list. Client-owned (completed, nothing after it): answered once with one follow-up `responses.create` on the same `conversation` (no `previous_response_id`, no `store`). Unknown: left alone and logged. The stream is always read to its terminal event.
- **Five gaps closed, all inside the stream handling of `respondOnce`:**
  1. **Statusless add without completion.** An item with no `status` that was only added (no `output_item.done`, not in the completed `output`) counted as completed and got a follow-up. Completion is now positive evidence: a `completed` status, or a `done` event or completed-`output` entry that carries no status. Without it the call is unknown (`incomplete_item`). A statusless item that does have a `done` event or `output` entry is still completed and client-owned when nothing follows it. This supersedes "`status: completed` or no status" in the entry below.
  2. **Text only in the terminal event.** The completed response's `output` text was dropped when no text deltas came, so the reply was empty although the turn was `ok`.
  3. **Text only in `response.output_text.done`.** That text was dropped too. For 2 and 3 the gateway remembers what each `(item, content index)` streamed as deltas. An item is found by its id, else by its output index, and takes every name each event gives it, so a completed entry under another id at the same position is the same message. A done event or the completed `output` adds only the missing suffix, and nothing when its text does not start with what was streamed, so a reply is never corrupted and delta plus final never duplicates. Text events that name no item are matched in order: deltas that name none are matched front first against the text a done event or the completed `output` gives, and what done events that name none gave is remembered, so the completed `output` that repeats it adds nothing. Only `output_text` parts of `message` items are read; reasoning and refusal parts are not.
  4. **`mcp_call` added after a completed call.** Only the `mcp_call` done event counted as later output, so the call was still answered when it was missing. An `mcp_call` `added` now counts as later output (native).
  5. **Prior item closed after the call.** The `done` event of a message (or any item) that opened before the call counted as output after it and suppressed the follow-up. The gateway now remembers which items were open when each call arrived: a done event for an item first seen after the call is later output; one for an item that was already open before it only closes it, so the call stays client-owned. An item that names neither an id nor an output index cannot be matched, so closing it counts as output after the call, as before; an `output_text.done` that names no item counts only when it brings text. At most 2048 items are tracked per response; past that the reply is whatever streamed and nothing is reconciled, so nothing can repeat.
- **Not changed:** PI stays unrestricted: no refusal, guardrail, approval or fallback was added (approvals exist only for delete actions). Request envelope, follow-up body, round and item limits, retry rules, logging fields and `rule` names are unchanged; `HarnessCall.completed` is internal.
- **Tests:** `gateway.test.ts` feeds every new shape and the regression controls (native with later text or a result item, client-owned, replay, `failed` / `incomplete` / `cancelled` / `in_progress` statuses, null item, `shell_call` items, failed / incomplete terminals, truncated frame, delta plus the same text in the final output) as 1-67 byte chunks from a seeded LCG over seeds 0-19 with non-ASCII text and an emoji, and asserts the error flag, reply, request count, summed usage, request envelope and the exact follow-up input. Eight earlier fixtures that relied on a statusless, only-added call being client-owned now carry `status: completed`.
- **Review of `51fb996d` (Astra), one Medium and three Low, all addressed:**
  - **Medium, repeated text.** An `output_text.done` that names no item matched the unnamed deltas and consumed them but kept nothing, so the completed `output` that repeated it emitted the same text again ("HelloHello"; two done-only texts the completed `output` repeated gave "One.Two.One.Two."). The text of such done events is now remembered and matched first when the completed `output` arrives. The completed messages are fed with and without an `id`.
  - **Unnamed done after a call.** An `output_text.done` that names no item and only closes text that streamed before a call had made the call native, which the base did not do. It now counts as output after the call only when it brings text.
  - **Surviving mutants.** Pinned with tests: the item limit (its exact boundary), done-only text after a call, `content_index` on deltas and on done events, an `mcp_list_tools` closed after a call, an empty done text, and that only `output_text` parts of messages are reply text. Each branch added here was also removed by hand, one at a time, and a test failed every time.
  - **Naming (Low).** Ids and output indices are stable between the events and `completed.output` in Microsoft's reference Foundry server. This is read from its source (`azure-ai-agentserver-responses`), not from a captured stream of our agent, because a live call is out of scope: every text event of a part (`output_text.delta`, `output_text.done`, `content_part.*`, annotations) is stamped with the same `item_id`, `output_index` and `content_index` when its builder is created, `output_text.done` is the joined deltas, and `completed.output[output_index]` is the item of its `output_item.done` (gaps stay `null`). Matching by id, else by position, therefore also covers a harness that keeps only one of the two.
  - **Known limits (offline matrix of random streams over delta, done and completed naming, 4000 per class):** streams whose events are all named (both names, one name each with an `output_item.added` that gives both, position only, id only) were exact in all 16000 runs. Text that names no item is matched only in order, so an authoritative text that does not start with the front of the unmatched text adds nothing: text can be missing, never repeated (1161 of 4000 in a class of unnamed deltas and dones, 477 of 4000 with named done events). Text that is only partly named can repeat when two events of one message share no name (deltas with only an `item_id` and a completed entry with no `id`) or when an unnamed done follows named deltas. A conformant server names every text event, so neither is expected; closing them would need order-based matching of such events, which is not added.
- **Not verified:** offline only. No live or paid call was made, so whether the harness emits any of these shapes is still open.

## 21 November 2026 — Chat and Voice are held to the same behaviour by offline replay tests (Refs #1967, #1988)

- **Request (Dan, P0):** prove with offline replay that Chat and Voice behave the same for the same owner request, and fix every divergence that is not an intentional channel difference. PI stays unrestricted: no guardrail, fallback, output gate or new approval was added, and a non-delete write must finish in one turn in both channels.
- **Harness:** `apps/backend/src/voice/chat-voice-parity.test.ts` (with `parity-*.testkit.ts`) drives one scripted scenario through the chat route (`POST /conversation/sessions/:id/turns`, `/steer`, `/cancel`, `/events`) and through the voice relay (`/voice` with a stub GPT-Live), on the **real** PI gateway, MCP door, `/tools/:name` route, conversation module, relay, activation grants, ledger store interface and logger allowlist. Only the edges are stubbed: a scripted Foundry harness (SSE responses, `function_call`/`task`/`mcp_call` items, holds for cancellation) that plays the model's `find_tools`/`call_tool` over the live MCP door with the live turn reference, a GPT-Live stand-in that speaks `session.commentary.append` back as its output transcript, and in-memory conversation/PI/vault/gym stores. Notes, tasks, gym lifts and the Google calendar run the **production tool code**; the Factory/GitHub and nutrition tools are contract fixtures with the real names and shapes because their stores are SQL/GitHub backed.
- **What is compared (facets, printed as a side-by-side table per scenario with `--reporter=verbose`):** what Dan reads/hears, stored owner and assistant messages (order, ids, duplicates), the exact PI input with the persona/situation/capability blocks and the voice line separated, Foundry requests and follow-ups, MCP tool calls, tool calls recorded for the owner message, the grant (stored owner message, session, results, discovered tools, closed with the turn), the ledger rows and usage records, the `pi.turn` log through the real logger allowlist, and tool activity events. Every facet must be equal unless it is a declared intentional difference whose exact shape is also asserted.
- **Scenarios:** Dan's daily-core requests (Jarvis work status then create an issue; save then find a note; create a task due tomorrow, complete it, what is due today; log a bench press, what was lifted last week; log chicken and rice, calories logged and left, protein still needed), a tool failure with a plain cause, a non-delete write finishing in one turn with no confirmation, a native harness `task` call, a client-owned call with exactly one follow-up, very large tool results, Danish input, stop and supersede, speech or a second message while PI works, a proactive message arriving mid-turn, replay/duplicate delivery/reconnect, blocks delivered once per conversation in both orders, a brain wake mid-turn, the monthly cap and an unreadable spend, and four PI-level failures.
- **Intentional channel differences (asserted, not ignored):** voice carries `[Channel: voice …]` in the PI input; voice speaks the first progress note and the answer, chat shows every note and streams the answer; a spoken turn is stored as GPT-Live's transcript (`gpt-live-1`, progress note included, no reply push) and a chat turn as PI's text (`pi`, reply push queued); the voice session warms PI when it opens, chat clients call `POST /pi/warm`; a stopped chat turn shows a notice, a stopped or superseded voice turn says nothing and its spoken note stays as a transcript; a chat error carries a machine code; chat steering continues one stream while a new voice delegation is its own turn; a second typed message is refused with 409 while a spoken aside is stored; a meal records `captureMethod` text in chat and voice when spoken; every voice session is stored as language `en`; the grant, ledger row and `pi.turn` log name their channel.
- **Divergences found and fixed (one commit each):**
  1. **The persona and situation block reached PI twice in a voice conversation.** `warm()` recorded a persona-only hash while a turn compares persona plus situational state, so the first turn after the voice warm-up sent everything again, and a warm-up right after a chat turn was never "fresh" and overwrote the hash, making the next turn repeat it too. The warm-up now sends and records exactly what a turn sends (persona plus `activations.situation.context`), so the blocks arrive once per conversation whichever channel speaks first, and a voice session that opens on a warm conversation sends no warm-up.
  2. **The same failure was told two ways.** An unexpected error or an empty reply was "I could not finish the reply. A task action may still have completed; check its status before trying again." in chat but "PI could not answer that…" / "PI sent no answer…" in voice, and the voice texts dropped the warning that an action may already have run. Both channels now use the one sentence `piTurnFailedMessage` (`pi/errors.ts`), the text the web client already recognises. Gateway errors still carry their own `userMessage` in both. (Superseded the same day by the plain-failure-words entry below: that sentence was itself a technical wording, so `piTurnFailedMessage` is gone and each failure class has one plain sentence in `failureCopy`, shown in Chat and spoken in Voice, which keeps this parity.)
  3. **A voice turn's tool activity was labelled `chat`.** The PI door never sent the channel, so `tool-call-started/finished` for a spoken turn had `source: "chat"` and the web voice orb could never show "Using a tool" (it reads `source: "voice"`). The door now sends `x-jarvis-pi-channel: voice` for a spoken turn and the route labels it `voice`. Only the activity label changes; work presentation, reflex replay and approvals are untouched.
- **Found, not changed (Dan decides):** chat rewrites a meal-estimate reply to the server's canonical nutrition list (`presentNutritionList`, `conversation.ts`) while voice speaks PI's sentence; the chat-only reflex classifier can run read tools before PI answers (`runChatReflex`); voice sessions are always stored as `en`; a turn refused before it starts (budget stop, busy, preflight) writes no `pi.turn` record in either channel; a spoken failure is stored as a transcript but a chat failure is not stored.
- **Confirmation gates (rule: approvals only for delete):** no non-delete confirmation is reachable by a Chat or Voice PI turn. Residual machinery is listed with file and line in the PR; the phone-call approval (`phone/approval.ts`) is the only live non-delete gate and belongs to the phone channel. No gate was added or removed.
- **Harness timing (independent review, 22 November):** the first version of S12b said Dan's next words as soon as PI was held, without waiting for the first progress note to be spoken and stored. If the stub's speech reached the relay late, the note joined the reply to those words, voice stored one merged transcript and S12b failed with no real divergence (reproduced by delaying only that note by 1.2 to 2.1 s; it also failed once in about 13 loaded runs). Steps now wait for what the relay has observed instead of a clock; S12a-c also run with the first note 1.8 s late, the stub speaks in order (a slow start delays what follows, nothing is spoken out of order), S14 waits on a barrier (`voice.settle()`) instead of a fixed window, and a failing row prints both sides. Test-only; no production code changed.
- **S14 replay (PR #2027 review):** the first CI attempt found five raw rows but no replay mutation. Delaying the answer on `main` reproduced the same shape: the note and answer had been stored separately across the 0.6 s Voice quiet window, not duplicated. S14 still exercises the calendar tool, stream replay, duplicate delivery and reconnect, but sends one answer without a progress note. The exact row count, text, order and IDs are checked; the progress scenarios still test delayed notes.
- **Only a real trace can prove:** that real GPT-Live speaks each commentary verbatim and splits its transcript the way the stub does; that Foundry stores, cancels and replays real conversations and `function_call` items as scripted; real latencies against the 90 s voice and 180 s gateway deadlines; what the iPhone, Watch and web render for `source: "voice"` tool events; the Factory and nutrition tools' own logic and the SQL stores (fixtures and in-memory stand-ins here); and the live ledger's `context_hash` after the warm-up change.

## 21 November 2026 — Every MCP door call is logged; only a replayed request is answered twice (Refs #1967)

- **Evidence:** production Chat, 20:09 UTC, a `weather` call: the backend answered HTTP 200 after 8.0 s, Foundry logged `pi.mcp_call_failed code=failure elapsedMs 12.8 s`, and `pi.turn` said `ok`. Three records, three stories, and no per-call line on our side. `pi.mcp_call_failed.elapsedMs` counts from the start of the turn, not the call, so it was never the call's own duration (if the call began about 4.8 s into the turn the numbers agree; a reading of the code, not confirmed). A tool answer with `outcome: error` is an HTTP 200 whose MCP reply carries `isError: true`, the most likely source of Foundry's `failure` (not confirmed for that call). There is **no evidence that Foundry replays a call**.
- **Amended 22 November 2026, after independent review of the first corrected head (`2ec17f1`):** (1) the JSON-RPC request id is no longer an identity: only a call id in `_meta` is, and a request without one is never recognised (blocker, below); (2) the ledger line gains `metaKeys`, the names of the request's `_meta` keys, so the harness's real call-id key can be read from live lines; (3) the claim that a failed or refused call "did nothing" is withdrawn, and the claim that unreliable ids "can never swallow an intended repeat" is replaced by what the safeguard really covers.
- **Ledger:** `find_tools` and `call_tool` each write one `pi.mcp_tool` line when they finish, however they end (also a refusal for a forged or closed reference, and an exception): `tool`, `outcome` (`ok`, `refused`, `error`), `elapsedMs` (the call's own time), `resultBytes` (UTF-8 bytes given to the model), `truncated`, `duplicate`, `sameArgsRepeat`, `replayCheck`, `metaKeys` (names of the request's `_meta` keys, sorted, each `^[A-Za-z0-9_.:/-]{1,64}$`, at most 12, never their values; absent when there is no `_meta`), `turnHash` (first 8 hex of the SHA-256 of the turn reference, never the reference), `channel` (`chat`, `voice`, `wake`, `smoke`; absent when the reference resolves to no live turn) and `provider` (`local`, `gh_`, `az_`; for `find_tools` the remote catalogue the search waited on, else `local`). Never arguments, `_meta` values or result text. All fields are in the `logging.ts` allow-list and tested in `logging.test.ts`; `mcp.test.ts` reads the real sanitised output and also checks what the door hands the logger before the allow-list.
- **Rejected first design:** the first version of this change answered any second identical action call of a turn (same tool, same canonical arguments) with the first result. Review rejected it: it silently swallows legitimate identical repeats (three sets of the same lift as three `gym_lifts` creates, two identical food entries, tasks or reminders, parallel identical calls the model emits on purpose), the model sees a success-looking result and tells Dan everything was logged while one row exists, and nothing shows that Foundry replays calls. Silent suppression of an intended action is worse than a rare duplicate, and PI is unrestricted and must be useful.
- **Rejected second design (the JSON-RPC id as a fallback identity):** the door is stateless (there is no MCP session; `ctx.sessionId` is undefined), so a client that opens a new connection for each model round numbers its requests 1, 2, 1, 2, ... An identical search plus an identical action in a later round is then byte-identical to a retried POST, and the `id_reused` guard cannot see it, because each id asks for the same thing as before. Every later deliberate repeat returned `duplicate: true` without running: reproduced by the reviewer with the real MCP SDK client over loopback, and by `mcp.test.ts` (the action ran once and answered `run: 1` three times). The id is therefore not used at all.
- **Replay recognition:** an identical action under a different request **always runs**. A request is a replay only when it carries the same **call id** as an earlier one and asks for the same tool with the same canonical (sorted-key) arguments. The call id is a string in the request's `_meta` under a key ending in `call_id` or `callId` (`requestIdentity`); nothing else is an identity, and **a request without one is never recognised** (`replayCheck: no_id`). A replay gets the first result with `duplicate: true` and does not run again, also while the first is still running. Only an action counts (`effectOf`, below); reads and unclassified tools always run. Only a success is kept: a refusal declined the action and an error reported no success, so a replay of either runs again, and a replay that waited on a first run which failed runs the call itself. That is a choice, not proof that an error did nothing: the tool route (`core/index.ts`) also reports `error` after the tool has run, when its result is an invalid generated view or cannot be serialised or is over 1 MiB, and when the audit record then fails (an HTTP 500, which the door reports as an error); a tool can also fail or be aborted part-way. A replay of such a call can therefore run its effect a second time. Nothing is refused and no approval was added. **Amended 22 November 2026 (#2012):** a failed audit record no longer makes the route fail after the tool ran, and an error that says the call may have done its work (`outcomeUnknown`, including an unexpected error from a write) is kept like a success, so its replay is answered with it and not run again; see "22 November 2026 — A write is told as it happened".
- **What the safeguard covers, and what it does not:** every door request of a turn, searches included, is noted with what it asked for under its call id. Once a call id has been seen asking for something else, `replayCheck` is `id_reused` for the rest of that turn and nothing in it is taken for a replay. That catches a call id reused for **different** requests (a harness that gives every request the same id). It cannot catch one reused for **identical** requests: that looks exactly like a replay. Recognition therefore rests on the harness's call ids being unique per call, which is **unverified**. If Foundry sends no call id at all, nothing is ever recognised, `duplicate` never appears and only the ledger works. Whether Foundry sends one, and under which key, is **not known**: the harness spike never ran (`docs/harness-trial/spike-results.md`), so the key match (`call_id`, `callId`, `tool_call_id`) is a guess; `metaKeys` shows the real keys and `replayCheck` shows whether the matcher found one.
- **`sameArgsRepeat`:** true when an earlier action of the same turn with the same tool and canonical arguments had run, or was still running, and this call ran too. It changes nothing. An earlier refusal or error does not count (it reported no success); a replay is `duplicate`, not a repeat. Without a call id it cannot tell a retried POST from a deliberate repeat.
- **Which calls:** `effectOf(tool, arguments)` in `core/tool-registry.ts` decides what a call is: the tool's `execution.defaultEffect`, or, for a tool that classifies its operations (`gym_*`, `inbox_nudge_style`, `inbox_capture_credential`), the operation named in the arguments, `unclassified` when it names none (the rule the older agent used). A `list` of an action tool is a read. `grant.actions.count` still uses `defaultEffect`, unchanged. Only a short list is classified `action` today (the inbox, PI brain, watch, situation, memory and gym tools, and `create_task`), so most writers (calendar, mail, vault, Health food, GitHub) are never replay-recognised until they are classified. Remote `gh_`/`az_` calls are out of scope. **Amended 22 November 2026 (#2012):** the count now uses `effectOf` too, and the writers are classified in `core/tool-effects.ts`; remote calls are still out of scope. Gateway stream handling (#2004), cost accounting and result-size limits are unchanged. A call rejected by schema validation before it reaches the door (a malformed reference or name) writes no line.
- **Steering:** the `call_tool` description is unchanged. The sentence the first version added ("an action repeated with the same arguments is not run again") would now be false. The Foundry-owned instructions are untouched.
- **Measurement plan:** after the next deploy, over normal use, read the `pi.mcp_tool` lines. (1) `replayCheck` and `metaKeys`: do action requests carry a `_meta` call id, and under which key? If `replayCheck` is `no_id` on almost every action line, recognition is off and the absence of `duplicate` proves nothing; widen the key match (one line, `callIdKey` in `pi/mcp.ts`) only on what `metaKeys` shows. This step needs Log Analytics: `read_backend_logs` (`safeHistoricalLogFields`) keeps only booleans, numbers and a short list of categorical strings, so it drops `replayCheck`, `metaKeys` and `turnHash`. (2) `duplicate = true`: a request really was delivered twice; compare the two lines' `elapsedMs` and the turn's `pi.mcp_call_failed` to see whether Foundry redelivers after its own timeout or failure. (3) `sameArgsRepeat = true` with `duplicate = false`: an identical action that ran anyway; group by `turnHash` and `tool`, and read the timing (a line started at its `time` minus `elapsedMs`): overlapping lines are parallel calls or a retry still in flight, later lines are separate sets or entries. Without a call id this cannot prove which, so decide from that evidence only, and never propose a suppression rule from `sameArgsRepeat` alone. Until `duplicate` appears in production no request is ever answered twice.
- **Not verified:** offline tests with stubbed tools and bridges only, no live Foundry call.

## 21 November 2026 — A wake opens like a new Chat conversation: same tool overview, parity tests (Refs #1967)

- **Evidence (code reading; no wake has run in production):** `runBrain` built its first message from the trusted context and the wake text only. Chat also sends the tool overview note (`pi/capabilities.ts`: connection states plus the capability index by area) with the first turn of a conversation, so a proactive wake started with less knowledge of its tools than Chat.
- **Choice:** one gateway helper, `overviewFor(conversationId)`, decides whether a turn carries the overview, and both `stream` and `runBrain` call it; the inline copy of that decision in `stream` is gone. A wake always runs in a new Foundry conversation, so it always carries the overview, and it never writes `noteSent` (which belongs to Dan's conversation), so a wake neither uses up nor repeats Chat's overview. The note itself is unchanged: it names Chat's tools by area, and the brain-only tools stay described by their own tool descriptions and the `jarvis-brain` skill.
- **Parity is tested, not enforced by a new rule:** `pi/mcp.test.ts` asks the real `find_tools` door for every registered tool by exact name in a Chat grant and in a wake grant, and requires wake = Chat + the brain-only tools (what the brain factory registers, `watch_look`, and whatever `brainOnlyTools` lists); a failure prints "only in a wake" and "only in chat". `pi/gateway.test.ts` sends one Chat turn and one wake through the gateway and requires the same turn line, trusted context, environment note and overview in the same order (turn reference and message masked, so structure is compared, not wording), and that a wake leaves Chat's overview state alone.
- **Unchanged on purpose:** wake guards (the Proactive source switches still narrow what a wake can discover and call), budgets, the `jarvis-brain` skill and the Foundry-owned instructions. No guardrail, approval, fallback or second path was added. Cost: at most 1,500 characters (about 400 tokens, an estimate) more per wake, inside the 90k-token worst case the budget check already reserves.
- **Only a real trace can confirm:** that a live wake uses the overview to find its tools.

## 21 November 2026 — Plain failure messages, and "Failed" only when a turn failed (Refs #1967)

- **Evidence:** Dan's TestFlight feedback: red Chat text "PI asked for an approval or client tool the gateway does not answer. The agent definition must run Jarvis tools without harness approval." (`pi_failed`, `pi/gateway.ts`), "Chat is working but showing failed" (build 115), "Pi test failed", "Call to GitHub failed", and earlier "my weather service failed". The same failure read differently on each screen: the iPhone showed the gateway's own sentence, the web a generic one, Voice spoke the gateway sentence aloud, and a tool row said "Failed" beside a good reply.
- **One table of words:** `packages/contracts/src/failure-copy.js` holds every sentence the server sends for a failed turn (`failureCopy`: one plain sentence per class) and the few the web client says itself (`clientFailureCopy`). Chat shows it and Voice speaks it in the same words: #2021's parity suite compares the two (`what Dan gets: failure text` must be equal), and a shorter spoken variant would break that facet, so each class has one sentence that is short enough to say and plain enough to read. `piTurnFailedMessage` from #2021 is gone: its wording was the old technical sentence, and `failureCopy` now carries that parity. Rules, enforced by `failure-copy.test.js`: first person, what happened and what Dan can do, no internal name (PI, Foundry, gateway, harness, MCP, approval), no status code or number, one sentence of at most 100 characters, and `chat` equal to `voice`. The backend and the web import it, so the web's exact-match allowlist of server sentences cannot drift; the iPhone strings are Swift resources, and the same test checks that the two iPhone sentences that mean the same as a contract entry are identical.
- **Codes stay, words change:** `PiGatewayError(code, kind, { detail })` keeps the six codes (`pi_not_configured`, `pi_budget_exhausted`, `pi_unavailable`, `pi_timeout`, `pi_failed`, `pi_unsupported`); `userMessage` (Chat) and `spokenMessage` (Voice) come from the table. The technical cause moved into `detail` and into the error message the log already carries: `conversation.reply_failed` now logs `PI gateway failed (pi_unavailable: http_404)`. An HTTP answer is `http_<status>`; the provider's own short code and the gateway's stream reasons (`stream_broke`, `stream_ended_without_completed`, `client_call_without_id`, `too_many_client_calls`, `client_tool_round_limit`, `connect_timeout`, `turn_deadline`, ...) keep their tokens; the budget stop logs the spend (`spent_250.00_of_250_dkk`). The SSE `error` event keeps its shape (`error` is the sentence, `code` the stable code). No client has a details field for a chat failure, so none was added. The iPhone shows the server's sentence for every turn error, with or without a `code` (every error the server sends for a turn is a fixed sentence from the table), so it reads what the web reads; before this it showed its own `errTurn` for a codeless error such as an empty reply or an over-long one. The deploy smoke report prints the code and the technical detail next to the sentence. Since #2004 a harness approval or function call no longer fails the turn; the three ways a client-owned call still can (no id to answer, more than 16 in one response, the round limit) now say the same plain "I couldn't finish that reply" sentence instead of the gateway wording.
- **Honest about what may have happened:** "I couldn't finish that, but nothing was done, so please try again." is said only when Foundry itself ended the turn before any output and the turn's grant shows no tool request, result, action or push; a timeout says nothing was done only with no tool call in flight or recorded, and a turn that reached a second response always counts as having reached a tool, even when only the completed response's output listed the call and no streamed event showed it. A stream that merely stopped may still run on Foundry's side, so it never gets that sentence. Only the first response of a turn can be judged this way: a later response exists because the first ended on a client-owned call, so the turn has already streamed text or reached a tool that the grant may not show (a native harness call never touches it), and a quiet failure there says part of it may already be done. Every other failure after the model started says part of it may already be done and to check before trying again.
  The 22 November #2012 rate-limit decision refines this rule: give recorded outcomes where available and reserve the warning for work that cannot be verified.
- **"Failed" only when a turn failed:** (1) a saved reply can no longer be followed by an error: `RecoverableChat` drops an `error` frame after `done` and never lets the replay cap replace a `done` frame, the clients read up to 4 MiB of a reply stream (web `maxChatStreamBytes`, iPhone `maximumStreamBytes`; progress frames stop at 1 MiB and `done` carries the saved reply, so a saved reply is never failed for its size; before this both clients refused a stream over 1 MiB before reading `done`), and the web ignores an `error` after `done` (before this the web turned a saved reply into a failed turn); (2) Dan's Stop is no longer shown as a failed turn with Retry on the iPhone (the server's "stopped" event can arrive before the stop request returns; `ChatTurnEnding` in JarvisCore decides), and the web shows a reply that was stopped from another device as a status, not a red alert (the main web chat has no Stop control; only the runtime test dialog has one, and it is unchanged); (3) a history refresh that fails right after a reply no longer shows a turn error on the iPhone; (4) a tool that did not work says "Didn't work" and a refused one "Not done" (iPhone, web; "Not allowed" implied a rule that does not exist); (5) an empty reply says "I didn't get an answer back".
- **What the model sees:** the confirmation of a failed or refused tool call is now `Not done. <the tool's own plain cause>` (it used to name the tool and drop the cause for every tool except mail and images: "Not done: weather failed."). A tool that throws something that is not a `ToolFailure` is described by the error's class (name and code only, never its message) and by what the call does (`effectOf`: the operation the call names, or the tool's default; `unclassified` when the tool does not say; `unexpectedToolFailure`), instead of "Tool execution failed". Only a call that reads can say plainly that nothing changed ("Not done. It did not finish in time."). For any other call, including one on a tool with no declared effect, a call that may have been delivered (a timeout, a dropped connection, a stop, an unknown error) says "…so it may or may not have gone through. Check before trying again." and not "Not done.", because the request may already have been acted on and a retry of a write would do it twice (a local service that ran the side effect and then dropped the socket gave `UND_ERR_SOCKET` and was reported as "could not reach" before this). Only a connection that was never made (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `UND_ERR_CONNECT_TIMEOUT`) says "It could not reach the service it needs, so that request was not sent."; any sign that the request left wins over a sign that it did not. The result carries `outcomeUnknown: true` in that case, and `confirmToolCall` does not add "Not done." to it. The error's class is logged as `tool.execution_failed` (`tool`, `failureClass`, `effect`, error and cause name and code), where before the original exception was logged nowhere. A tool's own `ToolFailure` text is unchanged: it is the tool's declaration of its own failure and keeps "Not done.". No provider text is added.
- **"Pi test":** it is the isolated comparison sheet in the Plus menu, not the model for normal Chat. #2017 did not change it. See the following #2010 decision for the iPhone label and recovery.
- **Unchanged on purpose:** PI stays unrestricted: no guardrail, refusal, classifier, retry rule or fallback was added; the retry and harness-call rules are as before. No approval or confirmation step was added (owner rule, 21 November 2026: none except for deletes); the messages that exist only because of a non-delete approval gate are listed in the pull request and were not removed. Diagnostics screens (Status page, smoke output) keep their technical names. Not reworded: history/image loading texts on the web, Watch texts (already a fixed plain sentence), voice session close reasons (protocol detail), `agents/pi/instructions.md`.
- **Verified/not verified:** offline backend, web and contracts tests; the new tests fail on the old code. Swift was not run here: JarvisCore tests (`ChatTurnEndingTests`, `ChatFailureWordsTests`) and the app build run in CI. No live Foundry, device or paid run.

## 22 November 2026 — iPhone draft updates and truthful reply status (Refs #2026, #2010)

- **Typing evidence from the code:** UIKit wrote to `JarvisChatModel`'s published draft. Every draft-driven Chat redraw could rebuild `renderedRows`: two maps of the loaded transcript plus `ChatToolPlacement`'s full pass, even though no message changed. A separate observation boundary leaves that work out of the keystroke path. It does not cache history, change motion or change the screen-sharing poll. `ChatMessageGrouping` has no caller on this path; the timestamp shown on a selected row is not required for typing. This is not an Instruments or device timing result.
- **What the status describes:** keep reading after Stop; a saved reply wins, and only a server-confirmed owner stop says it stopped. On a connection loss after acceptance, show a neutral notice until history yields the stored reply linked to that turn. If acceptance was never observed, retain Retry, restore the text without replacing a newer draft, and keep #2017's connection wording. A replaced reply is not a failure. Unfinished text and tool outcomes stay separate from the answer. A server-reported test failure still requires history review before another send.
- **Numeric history order:** keep IDs as strings on the wire. Qualify the base ID in SQL's `ORDER BY`; sorting on the string output alias put `10` before `9` and could discard a real message instead of the lookahead row. The same rule applies to the other queries that order by converted numeric IDs. No schema or API change.
- **Default for the missing screenshot:** treat “not updated correctly” as the iPhone transcript, reply notices and isolated test result, not Settings or historical Activity rows. **Test a reply** is the earlier Jarvis setup or Copilot, not a test of the normal Chat model. Neither choice uses normal Chat history.

## 22 November 2026 — Follow live Voice in iPhone Chat (Refs #2008, #2010)

- **State:** GPT-Live supplies input/output transcript deltas, output audio and delegation, not the OpenAI Realtime speech edges. An input delta can be a backchannel, not an end-of-speech signal. Keep the established grouping and interruption rules. The relay reports Thinking for pending work when no audio is being produced. Native Speaking lasts until the matching local playback drains or is cancelled. Publish audio completion without waiting for the history write; it does not certify that a reply was saved.
- **Chat:** use the actual bottom edge rather than a lazily laid-out sentinel. Follow saved Voice appends and edits to the current row, but not while Dan reads older messages. The existing minimised Voice controls belong in the composer stack so the status stays visible while typing.
- **Review follow-up (#2034):** the relay holds Thinking between delegating an answer to speech and receiving audio, with a bounded wait if none arrives. Only a manual scroll changes the follow preference; recheck the bottom after layout instead of relying on the size-change anchor. Live history reads are coalesced and cannot produce a typed-turn failure notice. The iPhone scroll policy is tested offline; the precise trigger for the build-122 device symptom is not proven.
- **Performance evidence:** the old refresh re-sorted all loaded messages and created ISO8601 formatters in its comparison loop. Chat also rebuilt tool placement on each redraw, and streaming captions published through the root Voice model and searched from the first entry for each delta. Stored IDs already provide server order; merge by that key, ignore unchanged pages, and build display rows once per history change. Caption updates search from the recent end and the Voice badge observes only the state it displays. This confirms paths that get more expensive as history grows, not that they were the sole cause on the phone. No change to the neural background or screen-share poll; no evidence of a leak or accumulating observers.

## 21 November 2026 — See the brain: tick and skip logging, status, turn attribution, and the old engine's failures (Refs #1969)

- **Evidence:** zero `pi.brain_run` lines in 30 days, no way to tell a switched-off brain from an idle one, 19 `proactive.failed internal_error` lines on 18-20 November, and an hourly call of about 4k tokens nobody could name. The first has a code cause, reproduced offline: the log boundary rewrites every event that is not in the `events` set of `logging.ts` to `backend.event` with no fields, and neither `pi.brain_run` (the gateway's line for every wake) nor `pi.brain` (the loop's own line) was registered. A brain that was on could have woken all month and left nothing to find by name. Whether it did is not known from the repository.
- **Logs, numeric and enum fields only, allowlisted in `logging.ts`, vocabulary in `pi/brain/outcomes.ts` (imported by the loop and the allowlist, so they cannot drift):** `pi.brain_tick` once when the tick outcome changes (`off`, `paused`, `no_sources`, `empty`, `spaced`, `daily_cap`, `budget_exhausted`, `quiet_hours`, `policy_changed`, `filtered`, `watches_unavailable`, `done`, `failed`), with `queued`, `wakesToday`, `spendMonthDkk` and `nextDueInSec` (absent when nothing is scheduled). The first pass after startup counts; the 30 s passes that never read the queue (`idle`) do not, so a switched-off brain logs `off` once, not every 30 s. `pi.brain_state` once at startup (`enabled`, `paused`, or `reason: unreadable`). `pi.brain` and `pi.brain_run` are now registered; every 07:00/18:00 or Check now sweep that ends without a wake leaves one `pi.brain` line with its reason (the run row already had it).
- **Status:** `GET /pi/brain` (owner, database-only, never starts a model) adds `lastTick` (`at`, `outcome`; in memory, so null until a pass has read the queue since the backend started), `nextDueAt` (null: nothing scheduled), `today.wakes` and `today.costDkk` (the turn ledger since Copenhagen midnight). Queue depth (`slots.queue`), wakes against the allowance (`today.usedTurns`) and month DKK (`month.costDkk`, `budget.spentDkk`) were already there. `enabled: false` is "off". `enabled: true` is "on", and it is idle when `nextDueAt` is null: `lastTick` is then null after a restart that found nothing waiting (the ticker does not read the queue until something is due), or `empty` once a pass has looked and found nothing.
- **Attribution:** `GET /pi/status` adds `lastTurn.kind` and `turns`: `last24h` per ledger kind (`chat`, `warm`, `smoke`, `brain`: count and DKK) and the newest 20 turns of any kind, with `activation.type` and `source` for a wake (`timer`, `manual`, an event source such as `github`, `reminder` or `calendar` (the signals of #2018), `mixed`). No SQL change. There is no `watch` ledger kind (a look rides inside a `brain` wake, `pi_watch_look`), so a wake that only a due watch caused now carries `activationSource: watch` instead of `mixed`. If the hourly call is a warm-up it shows as repeated `warm` turns, if it is a wake as `brain` with its source; I could not see production, so it is still unnamed. Lead, unverified: the iPhone Chat screen calls `POST /pi/warm` on appear and on every return to the foreground (`warmPiIfNeeded`, one attempt per 5 minutes per app run), and a warm-up sends the full persona context, so a phone that comes to the foreground about hourly would make exactly this call.
- **The old engine's failures:** a `proactive.failed` line carried a reason and sometimes a run id, never where it came from or what was thrown (`internal_error` from the engine's `finish` write, the scheduler's catch-alls for startup, slot, the run record and the event tick, and the manual check route; `hook_failed` and `job_update_failed` from the engine), and two failures left no line at all (an engine run that threw, a heartbeat that failed). Each now adds `errorClass` (the class name of what was thrown, never its message), and all but a failing hook or job update add a `stage` (`startup`, `slot`, `run`, `run_finish`, `heartbeat`, `event_tick`, `manual_run`, `manual_run_finish`); the two silent ones log. A run stopped on purpose (quiet hours, a restart, its deadline, a lost lease, changed preferences) is still not a failure. Reproduced in tests: a failing `finish` leaves the run `running` until its lease lapses (the line Dan saw, with a run id), an engine run that throws, a failed heartbeat, a throwing hook, a failing event tick, slot read or claim, startup write and manual run.
- **Fixed, found while reproducing (not proven to be the cause of the 19):** one failed startup write (`markInterruptedOnStartup`) stopped the scheduler, and with it the brain's tick, for the life of the process; a slot was marked handled before its settings read and claim, so one transient database error lost the day's 07:00 or 18:00 sweep; a ledger write failing after a scheduled wake turned a wake that happened into a `failed` run (the tick path already tolerated it). The scheduler now logs and carries on, retries a slot whose claim threw on the next tick (until the slot is 12 hours old), and logs `spend_record_failed`.
- **The same defect in thirteen more events, found in review:** `pi.turn_record_failed` and `pi.usage_record_failed` (a failed ledger write, which would make `GET /pi/status` and `today.wakes` undercount without a trace), `pi.mark_warm_failed`, `pi.situation_stale_failed`, `pi.smoke_failed`, `pi.watches`, `proactive.reminder_tick`, `proactive.alert`, and the event path's `proactive.events`, `proactive.events_disabled`, `proactive.event_model_failed`, `proactive.event_producer` and `proactive.event_source` were not in the `events` set either, so each was exported as a bare `backend.event`. They are registered now, each with its own words and numbers only (a kind of turn, an activation id, a code, a reason, a source name, counts, a duration), and a test reads the backend source for `pi.*` and `proactive.*` event names, so a new one cannot be added unregistered. `pi.situation_stale_failed` names the activation `activationId`, like `pi.brain_run`. The historical reader behind `read_backend_logs` (`safeHistoricalLogFields`) dropped `errorClass`, `trigger`, `activationType`, `activationSource` and `activationId`, so a read-back `proactive.failed` showed only its reason and stage and `pi.brain_run` none of its activation; they are kept (each is already validated by pattern or enum, and the activation id is a server-generated UUID that ties a wake to its ledger turn), as is `classes` (the alert classes of `proactive.alert`). A run id or item id is still left out of historical reads.
- **The old 07:00/18:00 slot engine is kept in this change, and decision A stays open.** With PI configured the brain's `runScheduled` has run every sweep and every Check now since #1964 (`scheduledRun = events?.runScheduled ?? run`), so the engine is built and never called; without PI it is the only thing that runs a slot. This change instruments it and does not delete it. The deletion (the engine, `prompt.ts`, `vault-mirror.ts`, the engine's model, `detectFindings`, their wiring and the engine-only log words; the hook modules stay) is prepared and tested on the parked branch `danaakesen-shiny-carnival-engine-deletion` (commit `1d912cda`), with no pull request. The coordinator's default, not a decision of the owner, is to land it only after the brain's first proven wake. Until then one old path stays alive, which the no-fallback rule would not normally allow; the coordinator made that exception, not this change. What would lose its trigger is listed in decision A of `docs/pi/cutover.md`. When the parked deletion lands, its own docs replace this bullet, the pending "Input for decision A" note in `docs/pi/cutover.md` and the two parked rows in `PLAN.md`; remove them, or the docs will say both things.
- **No guardrail, approval, read-only default or fail-closed path was added; PI stays unrestricted.** Nothing was switched on: turning the brain on is the owner's `PUT /pi/brain`.
- **Verified / not verified:** offline tests only (backend lint, build and the full suite, listed in the pull request). Not run: a live brain wake, a deploy, the loopback SQL contract (no SQL change here). The first real `pi.brain_tick` and `pi.brain_run` lines after deploy are the live check.

## 21 November 2026 — The queue hears what matters to Dan, as plain events (P1-2, Refs #1969)

- **Why:** Dan's Proactive Intelligence list is GitHub issue and release updates, reminders and the calendar. The queue only took `workflow_run` and `deployment_status`; pull requests, checks, issues and the calendar were dropped or never read, and a failed reminder delivery left no trace except the schedule row.
- **Choice:** producers only record that something happened. No model call at ingestion and no rule about whether Dan hears about it: the brain decides, with the actor, repository and times in the event. PI stays unrestricted; no guardrail, approval, default or fail-closed behaviour was added.
- **Kinds (source `github`, tracked repositories only):** `release.published`, `issues.opened`, `issues.closed`, `issues.reopened`, `issue_comment.created`, `pull_request.opened`, `pull_request.closed` (merged only; a close without a merge is not queued), `pull_request.review_requested`, and `check_run.failure` (completed and failed on the repository's default branch; a check failing on a pull request branch belongs to that pull request). Also `reminder.delivery_failed` (source `reminder`) and `calendar.clash` (source `calendar`). Pushes and the Jarvis label stay out: a push is not news and the label starts a task.
- **Stable keys, made only of the payload:** a replayed delivery, or GitHub redelivering it under a new delivery ID, is the same event, whatever the clock or the wording says. The queue dedupes on the key (identity plus material); the GitHub producers set the material to the key itself. A genuinely new occurrence has a new key: an issue closed again carries its new `closed_at`, a reopen its `updated_at`, a re-requested review its `updated_at` and reviewer, a re-published release its `published_at`. Comments are keyed by comment ID, check runs by check-run ID. Summaries are cut by UTF-16 unit (the column is `NVARCHAR(400)`) without splitting an emoji. Free text from a payload that reaches `detail` (branch, workflow, environment, tag, check name) is cleaned like the summary: control, format (zero-width, bidirectional, tag) and line or paragraph separator characters become spaces, so a fork's branch name cannot carry invisible text into the wake.
- **`pull_request.closed` means merged.** The old pipeline's rule `github:pull_request.closed -> routine_closed_without_merge` described a producer that never existed and would now filter every merge, so it is deleted; the model decides.
- **Reminder failure:** the reminder ticker reports `reminder.delivery_failed` only after `finishClaim` returned true for a terminal failed or suppressed-by-delivery outcome (provider rejected, retries exhausted, invalid token, registration removed or expired, delivery window passed, evidence lost). A reminder still `retrying` says nothing. Identity is `reminder:<schedule id>` and the due time is the material, so one failure is one event and a rescheduled reminder that fails again is a new one. A queue failure is logged (`delivery_failed_event_unavailable`) and never changes the delivery result; the schedule row stays authoritative. Not signalled: `no_subscription` (nothing was attempted), an unreadable task list, a reminder more than 7 days late. **The event rests on the Todos source:** `detail.evidenceSources: ['todos']`, the first key so the wake's 400-character `detail=` clip cannot cut it. `message_dan` accepts only evidence the wake itself supplied, and the runner supplies one tuple per source an event rests on, so an event that rests on none can never back a message. The first version declared none and `message_dan` refused it for every source. With Todos off, a failed reminder is not queued; one queued earlier is settled `source disabled` (reopenable). The reminder itself still fires, and its failure stays readable through `owner_reminders.read`. Telling Dan about a failed reminder while Todos is off would need an evidence source of its own; that is not built.
- **Calendar clash:** the 15-minute calendar poll finds overlapping timed entries in the facts it already read (no second read, no model). One event per pair; identity is the pair, material the two entries and their time ranges, so a moved entry supersedes the pending clash instead of adding a second. All-day entries and entries that only touch never clash. The first poll of a never-seen calendar is a baseline like every other fact.
- **Source switches:** the queue's entrance (`createEventPath().sink`) does not queue an event while a Proactive source it rests on is switched off. `eventSourceSwitches` gives those sources: the one its own source follows (`github` and `worker` follow **Factory**, `calendar` follows **Calendar**) plus any it declares in `detail.evidenceSources` (a failed reminder follows **Todos**, as follow-ups already did); `alert`, `timer` and `cost` rest on none. An event queued before a switch went off is still settled by the brain as `source disabled` (reopenable). The brain builds the wake's evidence from the same list, so the switch, the entrance and the evidence `message_dan` accepts cannot drift apart; the brain and the activation service had a private copy of this mapping each, which are deleted. Worker results are gated the same way as a side effect.
- **GitHub App:** `docs/github-app-manifest.json` now lists `release` (`issue_comment`, `issues`, `pull_request` and `check_run` were already there); a test fails if the receiver accepts an event the manifest does not list. The file is the setup reference only: the live App needs `Release` ticked in its settings by Dan.
- **Not built:** polling GitHub, cancelling a pending clash whose entries were moved apart, filtering Jarvis's own comments, issues and pull requests (they carry the actor; the brain decides), health, location and weather events.
- **Independent review (22 November 2026, head `1dcc588`):** one High and one Low, both fixed. High: `reminder.delivery_failed` could be queued but never back a `message_dan` push, because it rested on no Proactive source, so the wake carried no evidence for it (reproduced with the real brain loop and the real tool over `/pi/mcp`); the docs claimed more than worked. The existing tests called `comms.send` directly or hand-seeded the wake's evidence, which bypassed that gate. Low: a fork pull request's head-branch name reached `detail` without cleaning.
- **Verified/not verified:** fixtures only, no model, GitHub, Azure or APNs call. `pi/brain/signals.test.ts` runs every new kind through the real brain loop and the real `message_dan` over `/pi/mcp`, with the evidence tuple built only from what the wake prints, and fails for a kind the wake cannot back with evidence (removing the reminder's `evidenceSources` reproduces the review's refusal). Real webhook deliveries and the brain's judgement of the new events are Dan's to observe.

## 21 November 2026 — Native harness calls finish on their own; only client-owned ones are answered (Refs #1967)

- **Evidence:** production Chat, 20:11 UTC, "use a sub-agent to check my calendar": `pi.harness_item` showed a `function_call` named `task`, then the gateway threw `approval_or_function_call_item` and closed the stream. The Foundry trace of the same turn shows the `task` was **not** waiting for the client: the harness had already run a native synchronous sub-agent (it searched, called `calendar_list_events` through our MCP, and answered), and Foundry's outer request recorded HTTP 500 because the gateway abandoned the stream. The first version of this fix (answering `task` with "not available") was wrong for that reason and was replaced before merge.
- **Choice:** a `function_call` or `mcp_approval_request` never ends or throws the stream. The gateway reads to the terminal event (`response.completed` / `failed` / `incomplete`) and then decides per call who owns it. **Native** (the harness ran it, nothing is sent): a `function_call_output` for its `call_id` is in the stream, the item carries its own `output`, or any other output (text, reasoning, another item) follows it, in the events or in the completed response's `output` list. **Client-owned** (answered): the response ended with the call unanswered and its item complete (`status: completed` or no status; a finished item without a status counts as completed; superseded in part by #2020: an item counts as complete only on positive evidence, a `completed` status or a `done` event or completed-output entry, so an item that was only added with no status is unknown; what counts as later output changed too: an `mcp_call` that was only added now counts, and closing an item that opened before the call does not). `function_call_arguments.done` only finishes the arguments string and never completes the item. **Unknown** (left alone, logged as `incomplete_item`): the item has any other status (`in_progress`, `failed`, `incomplete`, `cancelled`) and nothing followed, because answering a call the harness may be running could repeat its work. This follows Microsoft's documented client-side loop (a call the response ends on is answered with a `function_call_output` on the same conversation) while tolerating the native shape the trace showed.
- **Follow-up:** only for client-owned calls, one `responses.create` on the same `conversation` (no `previous_response_id`, no `store`) with a `function_call_output` per call carrying the honest default ("not available in this environment, use the Jarvis tools through `find_tools` and `call_tool`") and a `mcp_approval_response` (`approve:true`) per genuine approval request. At most 8 responses per turn inside the turn deadline and cancel signal. More than 16 client-owned calls in one response fail the turn; native calls are never capped (up to 512 are tracked, beyond that the stream is still read and they count as native when output follows). There is no `task` handler: a native `task` is never answered, and a `task` that is client-owned gets the default and is logged as `answered_task_client_owned`.
- **No re-execution:** a call id is settled once per turn; a replayed one is ignored (`rule: replayed`). The gateway never starts an agent and never executes shell or other code. PI stays unrestricted; no guardrail was added.
- **Retry safety (#1999) kept:** a stream that carried any call or tool output is never retried, and only the first response of a turn can be.
- **Logging:** `pi.harness_item` with `trigger: harness_call` for every function call and approval: bounded name, argument key names only (max 12, `^[a-z0-9_.-]{1,32}$`), `argumentsLength`, `classification`, `rule`, `round`, `elapsedMs` and, when answered, `outcome`; `pi.turn` adds `rounds`, `clientItems` and `nativeCalls`. Never values, ids or output.
- **Only a real trace can confirm:** that every native call really shows one of the native signals (result item, own output, later output, or the final `output` list) before `response.completed`; whether a genuine client-owned call is accepted while the previous response reads `in_progress`; the real shape of an approval request's `status`; and whether native children ever outlive `response.completed`.

## 21 November 2026 — Make the weather tool log its phases and retry a stalled fetch (Refs #1967)

- **Evidence:** on TestFlight build 119 a Chat `weather` call returned after exactly 8015 ms (the tool's own `requestTimeoutMs`) and the agent told Dan "my weather service failed". An earlier call that day took 473 ms and Open-Meteo answers in 100-250 ms from outside, so the provider is not down. The log could not say which step stalled, and the agent only ever saw the generic "Tool execution failed" because a timeout is not a `ToolFailure`.
- **Diagnosis:** every weather step now logs `weather.phase` with only `phase` (`geocode`, `forecast`, `home_location`, `report`), `outcome` (`ok`, `timeout`, `network`, `http_status`, `invalid`, `too_large`), `status` (HTTP, when there was one), `attempt`, `elapsedMs` and `host` (`open-meteo-geocoding` or `open-meteo-forecast`; fetch phases only). No place, coordinate, query, response text or request id. It is in the `logging.ts` allowlist and covered by `logging.test.ts`. `report` is the whole job path of a `report` call, so it carries the outcome of the fetch that failed inside it.
- **Retry:** each fetch gets one transparent retry, only after a timeout, a network error, HTTP 429 or HTTP 5xx. It never retries another 4xx, an unreadable or oversized answer, or after the caller aborted. The overall 8 s budget is unchanged: an attempt may use at most 3 s, and a second attempt only starts when at least 1 s of the budget is left. The normal answer takes 0.1-0.5 s, so 3 s is more than ten times the usual time and a stalled connection is cut off early enough that the new connection can still finish; a stall in the place lookup leaves 2 s for the forecast. Two 3.5-4 s attempts were rejected because two stalled lookups would leave no time for the forecast. There is no pause before the retry; a 429 right after a 429 will mostly fail again, but the spec asks for one immediate retry and the budget caps the cost.
- **Home location:** a call with no `location` uses the saved home city and coordinates without geocoding; the settings read is bounded to 2 s and logged as `home_location`. A named place never reads settings and never waits on them (a hung settings read would otherwise delay the geocode), so it always geocodes, even when it is the home city.
- **What the agent sees:** a `ToolFailure` that names the cause and step, for example "The weather provider did not answer in time at the forecast step after 2 tries." or "The weather provider returned HTTP 429 at the place lookup step after 2 tries." The existing refusals and the "invalid weather forecast" / "invalid place result" messages are unchanged.
- **`report: false` check:** that path returns before any job, workspace item, status view or artifact work (`weather.test.ts` fails if it touches them); the only extra calls on a plain data request are the two fetches, plus the bounded settings read when no place is named. The `report` path keeps its own 1 s progress timeout and 8 s job budget, and the caller's abort signal now cancels the job (it is closed as cancelled) instead of letting it run to the budget.
- **Whole milliseconds:** `AbortSignal.timeout` rejects a fractional delay, and what is left of the budget is fractional, so each attempt's timeout is floored and the signal is built inside the guarded block. Tests run the real 8000/3000/1000 ms budget on a stub clock with fractional time.
- **Unchanged:** provider, keys, caching, every other tool, PI, voice and the gateway.
- **Verified/not verified:** offline tests with a stubbed fetch only. Which step stalled in production is not known until the next occurrence logs `weather.phase`.

## 21 November 2026 — Log which item the harness sent before a tool approval failure (Refs #1967)

A production Chat turn failed with `approval_or_function_call_item` and `sawTool:true` but `toolCount:0`, so the harness sent an approval or function-call item before any Jarvis MCP call, and the log did not say which. Microsoft documents approvals only for customer-configured MCP tools, nothing for the built-in harness tools. `pi.harness_item` now records the shape of that item (type, name, server label, whether `id`/`call_id` exist, the length of `arguments`, status) plus the distinct event and item types seen so far (at most 25 each), and the same for any output item type the gateway does not handle, once per sanitised label and at most 5 times per stream. Nothing else changed: the turn still fails exactly as before, and no approval answering, retry or guardrail was added until the real item is captured. Arguments, output, ids as values and free text are never logged.

## 21 November 2026 — Log why PI chat turns fail and retry a dead stream once (Refs #1967)

- **Evidence:** on TestFlight build 117 two typed Chat turns failed with
  `pi_failed`, one after 12 output tokens and about 32 s of silence, one after
  3.96 s with no text and no tool; a retry in the same minute worked. The cause
  could not be read: the log allowlist dropped `pi.stream_failed`,
  `pi.mcp_list_failed` and `pi.mcp_call_failed` fields and the `toolCount` and
  `azureCatalogue` of `pi.turn`, and several `pi_failed` sites logged nothing.
- **Diagnosability:** every `pi_failed` site logs `pi.stream_failed` with a
  distinct `reason` and how far the attempt got (time to first event, text or
  tool seen, previous turn cancelled within two minutes). The allowlist exports
  only fixed vocabularies and scalars; never prompts, replies, tool arguments,
  tokens or provider messages.
- **Resilience:** `respond()` retries the Foundry call once, after 750 ms, only
  when nothing observable can have happened: a turn grant exists, no output,
  unparseable or half-received frame was seen, no MCP request, tool result,
  action or push is on the grant (also after the pause), and the failure is
  transient (a stream that ends or breaks, or `response.failed`/`error` with
  `server_error`, `rate_limit`, `rate_limit_exceeded`, `too_many_requests`,
  `temporarily_unavailable` or `timeout`; never `incomplete`, content filters,
  tool errors or unknown codes). A stream that merely stopped must have its
  response cancelled and confirmed first. It logs `pi.stream_retry`, keeps the
  conversation and message, bills once and honours cancel and the turn
  deadline. PI stays unrestricted: no classifier, completion check, refusal,
  gate or answer buffering was added. A review found the first version retried
  too widely (any failure code, unread frames, an in-flight tool call, an
  unconfirmed cancel); this is the narrowed rule.
  The 22 November #2012 rate-limit decision extends it to two bounded retries of
  the current request on rate limits. The other transient failures keep this rule.
- **Open:** the failed first attempt's own input cost is not billed (as before
  for a stream with no output); whether Foundry stores the message of a failed
  response in the conversation, so the retry could show it twice, is unverified.

## 20 November 2026 — Owner reminder scheduling is not device delivery (#1990)

- **Authoritative request:** `dbo.owner_reminder_schedules` remains the exact
  owner request and recurrence/lease authority. Tool creation may confirm only
  saved/scheduled; it cannot claim APNs or phone delivery.
- **Separate outcome:** migration `0102` stores one outbox row for each selected
  native registration at the first due claim. Safe aggregate state, reason,
  attempt count, provider outcome/status, recipient counts and next retry are
  returned from `owner_reminders.read`; raw tokens, device data and provider
  bodies remain internal.
- **Recipient snapshot:** the first due selection is immutable for that
  occurrence. A newly registered device never joins an in-flight reminder by
  accident. Repair registration and explicitly reschedule if required.
- **Retry boundary:** only APNs `429`, `5xx` or transport/reset is transient.
  There is one five-minute retry (two total attempts). Original `fire_at`
  remains stable; `next_attempt_at` moves. If the final outcome cannot be
  persisted after its lease, evidence is explicitly unavailable rather than
  being renamed to provider acceptance/rejection.
- **Identity:** the APNs collapse ID is deterministic for schedule + original
  occurrence, and SQL leases/unique rows prevent a concurrent or restarted
  worker from opening a second outbox occurrence.
- **Registration lifecycle:** invalid-token, expiry, unregister and direct
  delete terminalize reminder rows by stable `device_reference` alongside
  reply/approval outcomes and preserve tombstone exclusion.
- **Acceptance boundary:** provider acceptance is not device display or owner
  acknowledgement. A physical iPhone/Watch five-minute reminder, deep-link and
  duplicate check is owned by Dan after parent PR/release qualification.

## 20 November 2026 — GPT-Live voice fidelity (#1988)

- **Voice:** the immutable `jarvis-pi-live` definition's output voice and instructions
  are Foundry-owned (2026-11-20 decision below). The provider remains the native full-duplex speech front end;
  client delegation stays `type: client`, with the same PI conversation,
  grants, tools and result path used by Chat. The runtime does not compare or
  buffer approved provider text, and it does not add a second semantic answer
  gate.
- **State:** GPT-Live readiness, transcript/delegation events, microphone state
  and actual output playback drive explicit Listening, Thinking, Speaking,
  Reconnecting and Ended evidence. A transport failure is visible and bounded;
  late callbacks cannot revive an ended or failed session.
- **Transcript identity:** input/output deltas carry stable event IDs and
  assistant output carries one response ID. Native output stays one ordered
  group across its pauses; a new owner turn closes that group before its
  persistence and the next owner message, so restored history retains
  Dan/Jarvis order. Duplicate/replayed Watch events are suppressed by stable
  delivery ID.
- **Watch/history:** Watch history carries explicit `dan`/`jarvis` role instead
  of deriving owner colour from incidental transport state. History with equal
  timestamps is ordered by the canonical numeric message ID. The paired v2 Watch
  event wire requires a delivery ID and serializes state/caption barriers; there
  is no mixed-version compatibility shim.
- **Evidence:** offline provisioner, backend, web and portable Swift checks are
  part of the source change. No live model call, provider/audio probe, Deploy,
  physical iPhone/Watch acceptance or paid smoke is authorized.

## 20 November 2026 — Personal Memory is SQL-owned, never a Vault bucket (#1968)

- **Domain boundary:** Session context, Personal Memory and Vault Knowledge remain separate. `dbo.memories`/`memory_history` is the authoritative Personal Memory store; Vault notes are authoritative Knowledge and stay on the Notes/Graph API paths. `/memory` returns only numeric SQL memory identities.
- **One live path:** the existing `core/memory.ts` is the production module. Its `memory_remember/search/list/history/correct/forget` tools enter the normal tool registry, `/tools` and PI MCP without a second discovery implementation. The same store serves foreground PI, background reads and owner-screen APIs.
- **Authority:** direct remember language is checked against the stored current Dan message, so automatic capture may be disabled without disabling an explicit remember request. Model-labelled `sourceIntent` is descriptive, not authority. Conversation writes validate category, key, source text and content together before embedding. Secrets are never stored; sensitive health/financial details are not automatically captured. Corrections preserve the stable key/history and forget still requires one resolved memory.
- **Settings provenance:** migration `0091` records Settings actions with the server-generated request UUID and authenticated owner ID. A Settings correction creates a Settings-sourced revision; deletion creates a Settings-sourced audit row. Neither reuses or relabels the memory's original capture message.
- **Legacy credentials:** valid separators and camel/no-separator forms are normalised before credential classification, so `api_key`, `access.token`, `authToken`, `bearer_token`, `private_key` and related token families have the same policy as spaced or hyphenated forms. PI search/list/history omit credential-like records from every serialized field; Settings redaction is not the authority for PI safety.
- **iOS pagination:** `JarvisMemoryPage` retains the raw API count and next offset. The Memory screen filters Vault rows only for display and advances from `nextOffset`, so an all-Vault legacy page cannot loop at offset zero or skip a mixed page.
- **All Memory paths:** the same classifier now gates proactive facts, PI situation commit/read/lookup and embedding backfill. Unsafe backfill rows are durably quarantined by migration `0092` before any provider call; safe correction clears quarantine. PI context never falls back to a Settings-only redaction.
- **Legacy PI state:** SQL PI situation reads may structurally accept a previously stored row only to sanitise it. Unsafe summary/ref/fact/follow-up content is removed, derived JSON and hash are rewritten atomically with a revision increment, and the activation then continues from the safe row. New commits remain strict and are refused rather than stored.
- **Explicit sensitive corrections:** an authenticated Settings correction may update permitted health or financial Personal Memory. It still rejects credentials; the broader sensitive-content refusal remains limited to automatic capture.
- **Recall:** PI uses bounded, source-linked `memory_search` in fresh Chat and Voice conversations when a durable owner fact may matter. Vault search is a separate query with separate provenance; no Vault note is promoted into Memory by indexing or API shape.
- **UI freshness:** committed `memory_remember`, `memory_correct` and `memory_forget` activity invalidates Memory pagination. Web reloads page zero and supports Load more using the raw server page count, while filtering any legacy Vault records only for display; iPhone invalidates Settings caches and reloads an open Memory screen. No unavailable or failed operation is represented as a successful write.
- **Evidence:** deterministic backend, web and Swift checks only. No live provider/model call, deployment, paid smoke or physical-device acceptance is authorized by this decision.

## 20 November 2026 — GPT-Live review corrections (post-2db2a87)

- Model activation is read from ARM, matching the Foundry deployment resource
  schema; the project data-plane session API is not treated as the deployment
  source of truth.
- Long assistant transcripts update only the matching message/session/role row.
  The client protocol is `jarvis.voice.v2`; v1 is explicitly refused with no
  alias.
- Native transcript deltas remain in one candidate across silence. `event_id`
  deduplicates delivery, and `start_ms`/`end_ms` plus delegation `offset_ms`
  associate the owner turn (superseded by #2001: the timestamps are validated and
  `offset_ms` is logged, but none cuts a turn; every input delta joins the open turn). Raw PCM never refreshes inactivity; transcript and
  explicit control activity do.
- Bicep does not configure `JARVIS_VOICE_AGENT_NAME`. The provisioner sets it
  only after the voice agent is active/pinned and then waits for the backend.
- Camera/screen rejection is visible and terminal for that session's visual
  controls: clients stop capture and disable retries instead of continuing an
  unacknowledged audio-only upload flow.
- SQL startup rejection is consumed immediately. Only clean completion emits
  `jarvis.session.ended`; provider/restart/startup failures emit an explicit
  retryable/non-retryable failure and reconnect only when the event allows it.
- A single terminal state machine owns clean versus failed completion. A clean
  path can send `session.close` only after provider readiness, must observe
  `session.closed`, finish persistence and enqueue `jarvis.session.ended`
  before it emits a `1000` terminal close. Pre-provider, connecting, send,
  drain, transport, acknowledgement and cleanup failures remain 1011 and
  forbid wall-clock voice usage. Web, iPhone and Watch release successful
  ownership only after Jarvis terminal evidence (or an already-ended state);
  failed ownership is always torn down without publishing Ended.
- Optional Live format echoes are not readiness proof or a rejection when
  absent; an explicit conflict is rejected against provisioned PCM 24 kHz.
  Commentary chunks are at most 256 UTF-8 bytes, below 500 tokens even at one
  token per byte. Provider cumulative audio seconds are retained, deduplicated
  and written as the session's voice minutes.

## 20 November 2026 — Replace direct Voice Live with one PI-delegated GPT-Live agent

- **Model:** the Sweden Central Foundry account has one voice deployment,
  `gpt-live-1`, model `gpt-live-1`, version `2026-09-10`, `GlobalStandard`,
  capacity 10. The two 2.1 deployments leave the Bicep template.
- **Voice agent:** Deploy provisions and pins one immutable
  `kind: voice` / `sub_protocol: live` / `model_type: self_deployed` agent named
  `jarvis-pi-live`. It uses PCM 24 kHz, a first-seed output voice (Foundry-owned afterwards, see the 2026-11-20
  decision at the end of this file), and `delegation: { type: "client" }`, with `store: false`. `foundry_managed_agent` is deliberately not
  used because it would create a separate prompt conversation and bypass the
  stored-message/per-turn PI grant.
- **Boundary:** the owner `/voice` socket stays unchanged. The backend alone
  connects to the exact GPT-Live Foundry route with managed identity and
  `VoiceAgents=V1Preview`, translates Jarvis PCM to native Live audio, translates
  microphone state to native mute/unmute, and emits Jarvis-normalised captions,
  audio, readiness and playback groups to web/iOS/Watch.
- **Authority:** on client delegation, the relay groups the current transcript
  for 0.6 seconds with a three-second bound, persists Dan's owner message, then
  uses the existing PI gateway and `dbo.pi_conversation`. PI's commentary and
  final answer return under the same delegation ID; existing MCP discovery,
  call, cap, receipt, cancellation and storage contracts remain authoritative.
- **Cleanup:** the normal `pi-agent` Deploy phase runs after Bicep/backend/agent
  deployment. It provisions/pins the voice agent, confirms a ready configured
  backend revision, and only then idempotently deletes both replaced 2.1
  deployments through ARM. Omitting them from incremental Bicep is not treated
  as deletion.
- **Acceptance:** source compile/static checks are complete when recorded in
  `PLAN.md`; no paid model call, voice session, Azure probe, deploy or smoke was
  run. Dan's physical iPhone/Watch/web audio, latency, acoustic barge-in,
  captions and provider acceptance are explicitly open. Direct Voice Live
  entries below are dated historical evidence, not current routing guidance.

## 20 November 2026 — Reply previews are useful by default (#1989)

- **Decision:** ordinary stored reply text is the lock-screen preview. Clean
  control characters, collapse repeated whitespace and truncate to 160 Unicode
  characters; do not substitute a generic body because a reply mentions health,
  medical, medication, finance, account or identity context.
- **Boundary:** `show_actions` chooses approval actions for that registration;
  it does not opt a device into a private reply body. Both SQL outbox insert
  paths persist the same safe preview for every recipient.
- **Protection:** retain only the existing `shouldRedact` credential/secret
  guard at the preview source boundary. Do not reuse the broader
  Memory/Vault-sensitive classifier and do not add a notification-only privacy
  regex, setting or approval flow.
- **Scope:** the message/outbox transaction, retry schedule, APNs collapse ID,
  exact session/message route and iPhone/Watch state machines are unchanged.

## 20 November 2026 — Durable reply delivery belongs to the stored message (#1970)

- **Identity:** confirmation dedupe and reply cancellation are separate. A
  durable claim pairs confirmation ID with the owner-message turn; a
  per-device approval-delivery row records the accepted/failed/invalid result.
  Timestamps have no dedupe role.
- **Persistence:** the conversation message and per-device outbox row commit in
  one transaction. The old process-local ledger and callback-only sender are
  retired, with no dual or fallback path.
- **Recovery:** Chat awaits or reconciles the same-turn approval before storing
  the reply outbox. Accepted APNs cancels only that registration's pending
  duplicate; failed transport/provider delivery leaves it eligible. An
  APNs-accepted result is retried idempotently in SQL. The turn remains blocked
  on an unresolved sending row rather than ageing a known/uncertain acceptance
  into failure. Separately, the leased SQL worker retries only transient reply
  APNs failures at 1/5/20/60 seconds,
  at most five attempts, until one-hour expiry. State-write failures preserve
  the sending lease instead of becoming provider rejection. A stable
  message-derived collapse ID covers the crash window after Apple accepted but
  before SQL recorded that result. Permanent invalid-token responses remove the
  registration and invalidate its pending rows.
- **Registration lifecycle:** expiry, unregister and provider invalid-token
  deletion terminalize approval/reply rows by immutable `device_reference`
  inside the same transaction. The registration delete trigger is a backstop;
  `SET NULL` can only observe an already-terminal row. Permanent invalid-token
  rejection also stores an owner/token-hash tombstone; the same token cannot
  re-register after foreground refresh or restart, while a new token can.
  Upsert, invalidation and expiry claiming serialize on the same owner lock and
  resolve every current registration for the exact token, so a stale claim cannot
  miss a replacement registration. Recipient reads defensively exclude
  tombstoned hashes even if a stale row is written.
- **Preview:** the stored one-line body follows the #1989 useful-by-default
  policy above. Credentials/secrets retain their existing source guard; broad
  personal-content classification is not part of notification delivery. Logs
  and status expose no body, IDs or token; terminal counts are diagnostic
  evidence.
- **Routing:** `jarvis.reply` is a dedicated iPhone/Watch tap branch carrying
  exact `sessionID`/`messageID`. Watch keeps the target pending across active
  chat, voice and dictation instead of discarding it. Once opened, active
  scope is retained separately and scopes history/reconnect/foreground refresh
  until leave/send/sign-out. Proactive findings and approval actions keep their
  existing categories and handlers. Leave during an opening clears only that
  target's persisted pending entry; equality-checked clearing preserves a newer
  unrelated tap.
- **Continuity:** the same server-side outbox envelope accepts optional source
  evidence for #1969. Proactive scheduling, GPT-Live and voice protocol code
  remain untouched.
- **Acceptance boundary:** deterministic unit/migration/loopback-SQL fixtures
  prove the store and worker contract. Live APNs, Mac SwiftUI compilation and
  physical iPhone/Watch behaviour remain owner release acceptance.

## 20 November 2026 — PI state changes are server-owned patches, and follow-ups stay in the one event queue (#1969)

- **State ownership:** the backend creates a valid `pi_situational_state` before the first PI turn. PI receives exact revision/hash/policy evidence and normally uses bounded `situation_patch`; a compatibility whole-state commit remains accepted but is not the agent's normal path. Source observations carry stable provider identities and material hashes. Failed/cancelled activations and failed refreshes can stale only their affected source or linked facts.
- **Vault concurrency:** PI watch methods transform the latest GitHub Vault content/SHA and retry ordinary conflicts. A sustained conflict is visible and never falls back to a cached whole-body write. The SHA-aware watch index refreshes on Vault pushes and before due/list reads.
- **One scheduler:** evidence-linked follow-ups with `dueAt` are queue rows in `dbo.proactive_events`, with stable identity, material hash and `not_before_at`. Material updates supersede the active row; cancellation marks it processed and retains its evidence. There is no follow-up timer or shadow brain.
- **Activation integrity:** SQL owns the owner lock and the combined decision for pause, Copenhagen-day allowance, spacing, quiet hours and the `proactive_event_batches` insert. A caller-side check followed by `startBatch` is not accepted as a reservation.
- **Continuation context:** `message_dan` stores the exact outgoing text, evidence references, pending follow-up IDs and Chat session/message IDs in the owner-scoped `pi_message` ledger. `proactiveConversationContext` exposes that bounded receipt to both Chat and Voice so "do that" resolves to the suggestion Dan received. This does not change Personal Memory or the push sender.
- **Dedupe:** queue admission and source refresh compare stable source/provider identity plus material content, not prose or list position. Repeated identical material is quiet; a genuine material change is eligible once.
- **Evidence/limits:** qualification is offline only (unit/replay/build/lint plus isolated loopback SQL and migration down). Gateway completion, GPT-Live transport, Personal Memory and the push sender remain owned elsewhere. No live model/provider, deployment or paid call is part of this decision.
- **Independent-review corrections:** composition must pass the situation service into the event path; the event consumer reconciles a transactional revisioned outbox before claiming work and is woken after a commit. Slot time/day/quiet is sampled after the owner lock. `message_dan` evidence is matched to server-known wake/situation records. Chat text and the continuation receipt are one idempotent SQL transaction. Policy CAS, due-ordering, Watch content/SHA pairing and per-turn Voice context are part of the acceptance contract, not follow-up debt.
- **Exact authority and generations:** PI state refs are derived from durable provider/verified-live-lookup receipts; model fields never mint authority. Source disable epochs gate old evidence after re-enable. Queue invalidations use an explicit reopenable bit and a fresh event ID per reopened generation, while delivered material remains deduped. Batch reservation compares the full policy revision and holds provisional worst-case monthly spend; actual spend atomically reconciles that reservation.
- **Observation generation:** original provider occurrence time (`observedAt`) is separate from server receipt time (`verifiedAt`). Provider status/authority/state/outbox share one SQL transaction, and `markFailed` uses the same stale-visibility contract. Lookup receipts are generation-scoped and remain inert until a matching verified state commit. Invalidated authority rows are retained and marked stale; a newer verification creates the next active generation.
- **Atomic observation admission:** SQL returns accepted/not accepted before any state-side write; older results cannot leave a status, authority or outbox tail. Lookup receipts remain pending until an exact state commit activates them. Situation evidence used by `message_dan` is revalidated under the Chat/receipt transaction; a mid-wake source advance refuses delivery, while event evidence stays on the event path.
- **Stale-link reconciliation:** invalidation never discards linked facts, summary or follow-ups from the persisted working graph. `observeResult` retains them as stale input; the next ordinary refresh of the same stable identity/material remaps them to the new active verified generation, clears fact staleness, restores summary visibility and emits the follow-up upsert. A material change stays stale/cancelled.

## 19 November 2026 — One PI route and an exact, release-owned backend configuration (#1966)

- **Normal route:** PI is the only Chat and Voice engine. The old saved device selector, test badge and normal-client `engine` parameters are removed. An older Chat client may explicitly send `pi`; `current` and unknown values are refused. Isolated runtime-test sessions keep their separately selected runtime and are not a fallback for normal Chat or Voice.
- **Release state:** ordinary infrastructure deployment owns preservation, not post-deploy repair. `deploy_bicep.sh` captures the previous complete PI tuple into a private secure parameter; Bicep restores PI core, GitHub, Azure MCP and monthly-cap settings. A missing/mismatched tuple fails closed before deployment instead of becoming a green but stripped backend.
- **Readiness receipt:** the `pi-agent` job runs before readiness, waits for and returns the exact backend revision it configured, and `release_state.py` records that revision with the PI job attempt. A smoke or receipt based on an older backend revision is not acceptable evidence.
- **Owner controls:** engine selection is gone. Background PI remains a distinct, off-by-default policy switch in Proactive settings with independent read/save loading and Retry; Status expansion shows checked time and evidence instead of repeating its subtitle.
- **Scope boundary at that time:** this removed the selector, not the old
  voice deployment resources. The 20 November GPT-Live decision above is the
  explicit approved cutover and supersedes that deferred deletion gate.
- **Evidence:** offline deployment-script, backend, web, contracts, Bicep and Swift checks are required. Live provider, deploy, TestFlight and physical-device verification remain separate owner/Dispatcher evidence.

## 19 November 2026 — PI situational intelligence uses SQL truth, one grant and one combined slot ledger

- **State:** `dbo.pi_situational_state` is the only compact owner-scoped PI situational state. Its bounded JSON is revision/hash checked and source linked; raw source and conversation archives remain in their current authoritative stores. Foundry/Conversation state is not truth, and Foundry Memory is not a dependency.
- **Activation:** one `PiActivationService` envelope spans Chat, Voice, scheduled, manual and event invocations. The same `jarvis-pi` agent, four existing Skills plus `jarvis-situational-context`, Jarvis MCP and tool catalogue are used. A harness invocation produces one `pi_turn` row; internal iterations do not create hidden turns.
- **Cadence/cost:** `proactive_event_batches` is the persisted combined slot reservation. The owner chooses 1–12 background activations per Copenhagen day; ten-minute spacing, queue leases/deduplication, quiet behaviour and [amount omitted] preflight worst case remain exact. A recent event can satisfy the next scheduled sweep. The effective proactive hard cap is [amount omitted].
- **Default:** the existing `pi_switch.brain` row remains off when absent. Timer and source pollers do no automatic work while off/paused; enabling never creates an extra fallback or compatibility model path.
- **Policy:** disabled sources are excluded before automatic reads and MCP admission, and stale source facts are never reused proactively. Non-empty summaries and follow-ups need fresh raw refs, so an unsupported summary cannot survive a source switch. `message_dan` carries category, Personal/Work/unknown scope and evidence source IDs, and the server enforces category/source/scope policy plus owner guidance before delivery. A direct owner Chat/Voice request may use the underlying tool. Location is independent from Weather, coarse, permissioned, observed and freshness labelled.
- **Delivery UI:** the existing Proactive page/settings on iOS and web show turns, costs, actual spend, source/state/activation freshness and recovery. There is no new main screen.
- **Evidence:** deterministic backend, web, contracts, workflow-script, isolated SQL and JarvisCore checks cover the implementation. No live paid provider/model call, deploy or TestFlight action is part of this decision. CI at the exact PR head and the owner's physical-device/live checks are separate acceptance evidence.

## 18 November 2026 — Keep the PI tool reference on line one (#1922, Build 113)

The managed instructions read the tool reference from the first line. The normal chat formatter put the owner's context before it whenever context was first sent or changed. A test of the normal PI chat route reproduced the missing reference on a reused owner conversation; putting the reference first lets the contract-following harness fixture discover and call Azure through Jarvis MCP. The smoke's environment note is not that context block. Run 44185584236 proved Azure reach in a separate conversation, not what happened on the phone. Keep the existing turn grant and tool checks; use content-free counts to tell catalogue, selection and execution failures apart in device testing.

## 22 November 2026 — iPhone TestFlight corrections (Refs #2005, #2007, #2008)

- **Notes:** a nonempty leading Markdown H1 is the title; otherwise use the
  readable filename rather than taking the first line from the note. Renaming
  a headingless note inserts an H1 after any frontmatter, keeps the body and
  filename, and uses the existing SHA-checked save. A body-only edit does not
  add a heading.
- **Proactive:** Settings owns the iPhone's only master switch; the Proactive
  editor keeps source and policy controls. On means the backend can start a
  background wake (`available && enabled && !paused`), not that it will start
  one immediately. A backend pause reads as Off on iPhone. Turning Off writes
  the owner flag only, not the pause setting; turning On clears an existing
  pause by revision before enabling the flag. Reminders, the web UI and
  scheduling limits are unchanged.
- **Voice:** replace the Resize button and top-left Close from #1958 with a
  scroll-free resize grabber and top-right Close. Use the existing full-screen
  carousel when expanded. The footer means the Previous/Next row, not the
  main call controls. Voice minimising listens only over the orb and status,
  not to a whole-screen drag checked against saved rectangles.
- **Verification:** native compilation belongs to Apple CI; Dan owns
  acceptance on an iPhone. No live model, provider or paid check is needed.

## 18 November 2026 — iPhone Voice keeps visuals for the current call (#1958, P15-210)

Use the existing phone workspace events to populate a local Voice carousel, without changing the backend window contract. A new ID appends and takes focus; an update to an existing ID replaces that page. Close clears the carousel, Collapse returns from full screen, and minimising the call keeps its visual history. Use the existing glass controls over the page and let the HTML document own its heading and authored colours; WebKit gets the active appearance, Jarvis theme variables and readable defaults. Apple compilation, rendering and live call acceptance remain unverified.
The control placement and resize interaction were superseded by #2008.

## 19 November 2026 — Treat Vault Mirror and Status uncertainty as evidence, not a green/red guess (#1962)

Production Deploy run 44348929578 applied main
`318b923be74e601719ebd03c839c823dd6d4cbfd` on 18 November with the mirror
switch `true`, write-back `on`, caps `25/3`, a successful infrastructure job
and a rebuilt mirror image. That proves the desired job configuration was
submitted and accepted; it does **not** prove a scheduled execution ran. This
cloud worktree could not read Container Apps executions through ARM because its
managed-identity endpoint was unreachable. A missing/stale status blob is not
used as evidence that the job is off.

Read-only Container Apps evidence subsequently established the live state:
execution `job-jarvis-vault-mirror-29917610` started at 02:50 UTC on 19
November; the platform marked it `Failed`, while the runner completed with
`needs-attention`, `reason=guard-tripped`, 151 approved files, 11 pending
Obsidian write-backs, one conflict, no pushed/written/deleted files and no
credential match in 13.686 seconds. The same bounded summary repeated every
ten minutes for at least six hours. **The job is running.** The planner trips a
safety guard, returns no actions and exits non-zero, so the platform's
`Failed` execution is not a stopped schedule. Eleven pending Obsidian changes
are below the configured change cap of 25; because the old log discarded
`guardReasons` and proposed per-direction counts, the exact guard cannot be
named safely from the current execution evidence. The runner now retains and
logs those fixed enums/counts, and the Status page displays them.

| Choice | Why |
| --- | --- |
| An explicitly enabled mirror is fail-closed in `deploy_bicep.sh`: invalid App ID/caps, missing Dockerfile, registry/digest, or image-build failure stops before Bicep | Silent fallback produced a successful release while the one explicitly requested component was ambiguous |
| Deterministic readiness verifies the scheduled job, its dedicated identity/client ID and required runtime setting names, and waits for one fresh terminal execution, then parses only the allow-listed runner JSON | The job's resource definition is not execution evidence; bounded logs prove outcome and secret usability without vault paths, values or note text |
| Ordinary `needs-attention` remains a warning; `reason=guard-tripped`, no execution, config drift, `failed` and missing runner evidence fail readiness | A guard trip applies zero actions and is the current blocked state; an isolated conflict still warrants visible attention without claiming the job is off |
| The mirror contract carries fixed `guardReasons` plus proposed change/delete counts per direction; `GET /status` projects these with `lastRunAt`, `outcome` and safe `readReason`; the UI says **No status yet**, not **Not set up** | A repeated guard trip is diagnosable without a note path or guess; a missing status document does not identify a missing Azure job |
| PI is the active Foundry chat/voice subject. Bounded chat, voice, brain and embedding runtime results are current for 15 minutes, then unknown/stale | Catalogue or code configuration is not live health, and PI brain/turn evidence is available without adding another paid request |
| A successful PI agent provisioning job is required for an accepted release receipt | PI is now the normal chat and voice path, so optional-test failure must not become a successful default-engine release |
| Agent runner remains unknown until a completed runtime or research smoke result exists | Active-session count and configuration do not prove the Foundry runner is healthy |
| Last backend error is degraded for five minutes, then OK with a retained timestamp | It is an incident marker, not a permanent failure indicator |

The deploy smoke records its requested chat or voice capability as degraded
with `budget_exhausted` before returning a 409, matching ordinary PI stream
preflight refusals rather than leaving the status row healthy or unknown.

The readiness wait is 1,200 seconds. That is the ten-minute scheduling
interval plus the job's eight-minute replica timeout and a two-minute margin
for terminal log reads; the probe rejects a shorter positive wait. A
120-second remainder after scheduling was enough to notice the new run but
not enough for that healthy run to finish.

Post-merge Deploy 44477956290 proved the mirror identity itself was valid:
`UserAssigned`, one matching ACR binding, the expected client ID and the
required env names. ARM returned the assigned-identity key with lowercase
`resourcegroups` and the registry binding with `resourceGroups`; the probe's
raw string comparison therefore rejected the same resource. Readiness now
compares the two complete resource IDs case-insensitively, as ARM semantics
require, while retaining exact type, cardinality, name-prefix, client-ID and
required-setting checks. A different identity still fails.

Dan subsequently made the source-precedence decision explicit: ordinary
differences must drain without a manual attention backlog. The reconciler now
uses Obsidian immediately for an unclean/no-base conflict, selects whole paths
up to the existing per-run change/delete caps and defers the rest to the next
schedule. Hard empty-side, missing-base and deletion-ratio guards remain, as do
per-path secret/size/path/content refusal. The current 11 pending Obsidian
changes and one conflict are therefore next-run work, not an owner checklist.
No cap, secret, policy or Azure setting is raised or bypassed.

No production setting, secret, policy, state blob, schedule or resource is
changed by this decision. The exact read-only command is in `infra/README.md`;
the next qualified Deploy will execute it through the existing OIDC identity.

## 17 November 2026 — The PI smoke runs as three requests, not one (#1910, P15-209)

After the Azure MCP wake-up fix, `measure_pi` still failed with HTTP 504. The backend log showed the Azure read inside the smoke completing in 7.3 s, so Azure reach worked; the whole smoke (cold turn, warm turns, tool and voice turns, GitHub, Azure and four tool-choice turns, each one to fifteen seconds) now takes about four minutes, and the Container Apps ingress ends one request at 240 s.

| Choice | Why |
| --- | --- |
| `POST /pi/smoke` requires `part`: `core` (baseline, cold, warm, tool and cancelled turns), `voice` (the PI leg of a voice turn) or `reach` (GitHub, Azure, tool choice). Each part has its own scratch conversation and reports its own checks and cost | No request approaches 240 s, and the checks and what they measure are unchanged. The voice turns now start a fresh conversation instead of following the warm turns; the voice checks do not depend on that |
| The workflow script calls the parts one after another and merges checks and cost into the one summary | One summary, one pass or fail, as before. A failing part names itself in the error. There is no unsplit path |
| Each part is cut off at 220 s inside the backend and 235 s in the script | A part that is slow fails visibly under 240 s instead of as a 504 with no detail |


## 17 November 2026 — The Azure MCP server's cold start must not look like "Azure is not attached" (#1910, P15-208)

Two `measure_pi` Deploys on main failed after the voice-visuals merge: the first on `reach_azure` and `mcp_listing` (GitHub and the other checks passed), the second as "HTTP 504, no detail". The agent was v15 with Azure and GitHub attached, and an earlier run had listed 17 Azure tools and read 22 resources.

**What the Deploy logs show.** In the first run the model answered "the Azure tools aren't attached" and the smoke recorded "azure: FAILED to list" while GitHub listed 118 tools. The second run's PI step ran from 21:01:47 to 21:05:49, 242 s: the smoke is one request and the Container Apps ingress ends a request at 240 s. In the earlier passing run the Azure turn took 50 s, so a cold start was already tens of seconds.

**Cause, from the code (the build environment has no Azure access; the container logs below were read by the owner's session).** The Azure MCP server scales to zero (0.25 CPU, 0.5 GiB). The backend loaded its tool list only when a search asked: that search waited 8 s and returned nothing, so PI said Azure was not attached. The background refresh was cancelled after 90 s, before a slow cold start could finish, and the failure was then cached for 60 s with an empty list, so a search or the smoke in that minute saw "no tools" without trying again. The smoke then waited up to 100 s per server one after the other, which can push it past 240 s. No change in #1933, #1934, #1936 or #1953 touches this path; what changed is that the earlier run found the server already awake.

| Choice | Why |
| --- | --- |
| The backend starts loading each remote catalogue when it starts (`bridge.warm()`), and `/pi/warm` calls the same (superseded 21 November 2026: bridges start idle, see the #1967 decision) | The wake happens at deploy and when the app opens PI, not inside the owner's first question. The list is kept 30 minutes, so Azure questions after that do not need the server awake |
| The refresh may run 200 s, not 90 s | The ingress holds a request for a stopped app up to 240 s; cancelling earlier killed a start that was about to finish |
| A failed first list is not cached; the next search retries (single-flight). With a list in hand, a failed refresh keeps it and retries in a minute | The 60 s empty cache turned one slow start into a minute of "no tools" |
| `find_tools` adds a note when a server is still loading or unreachable (with a reason that never repeats server text); the PI instructions say what to do with it | A server PI has not heard from yet is not "not attached". This is information for the model, not a gate: nothing is blocked or routed elsewhere |
| The smoke lists both servers at once and reports the failure reason; the Deploy sends one request to the Azure MCP server first and prints the HTTP code and time | Keeps the smoke inside the ingress limit and turns the next run into evidence: the printed time is the cold start, the reason says timeout, HTTP status or connection |

**Container log evidence (added after the owner's session read `ContainerAppConsoleLogs_CL`, 17 November).** In the first failing run the Azure MCP container started at 20:54:36Z and listened on :8080 two seconds later; its first MCP request arrived at 20:54:45Z and finished as HTTP 499 after 5.6 s, which means the client closed the request. There was no server error, crash or out-of-memory line. So the server is ready within seconds and the failure is a client that gave up on the first, slow call (the first request on a fresh .NET process). Which client timeout fired was not identified from the logs; waking the server at backend start, a refresh that is retried at the next search instead of cached as empty, and the model being told the server is still loading cover it whichever it was.

To confirm: run `measure_pi`. If Azure still fails to list, the smoke line now says why, and `ContainerAppConsoleLogs_CL` for `ca-jarvis-azmcp-*` is the next place to look (an out-of-memory restart at 0.5 GiB would show there and would call for more memory, not a longer wait).


## 17 November 2026 — Voice visuals reach the phone through `workspace_command`; the panel belongs to the session; one eased orb (#1939, P15-205)

Build 112 findings: visuals in voice did not work, Jarvis did not know it could show them, a card was on screen when voice started, the orb moved without an easing, `show_in_chat` failed, Show data and some buttons did not work, and the owner feared a route to the web workspace.

| Finding | Root cause (from the code) | Choice |
| --- | --- | --- |
| Jarvis did not know it could show visuals in voice | The PI instructions said a voice turn "uses none of this" and to search by what a thing is, never how it looks; the per-turn voice note said only to keep answers short and offer chat; the `workspace_command` description opened with its target rules, and `find_tools` gives only the top three matches their full description (the rest are cut to 240 characters), so a search that did not rank it first never showed the visual use | The model is told, never gated: the voice note (every spoken turn), the PI Voice section, the lead of the `workspace_command` description and the realtime voice instruction say the phone shows what Jarvis puts on screen, and name the tool. Nothing decides for the model when to show something |
| Visuals could go to a browser tab | `target: active` is the device that reported its snapshot last; the phone reported only when it connected | `WorkspaceRuntime.reportActive()` runs when Voice opens and starts, so the phone is the latest reporter |
| `show_in_chat` in a spoken turn | A PI voice turn carries no voice header, so the tool queued a block in a voice session that no reply would ever take | The tool checks the session's channel and refuses anything but a typed chat session, pointing to `workspace_command`. One check replaces the voice-header check |
| Card at voice start, with an "Open web app" link | **Inferred from the code, not reproduced:** content presented earlier stayed in `presentedView` (for example when a sheet could not show over another and was never dismissed) and the Voice page rendered it as the panel; knowledge-graph and code views, which the backend pushes when "show work" is on, had no iPhone renderer and showed an unsupported card whose link opened the web app | Starting a new voice session drops what was open (content presented while a session is minimised still carries over into the panel). The two views now draw natively (code with line numbers; the graph card gives the count and opens the Notes graph). The web link, `JARVIS_WEB_APP_URL`, its Info.plist key and `makeWebAppURL` are removed; no iPhone path opens the web app |
| Orb moved without an easing | The orb's size followed a measured height set inside an animation on the way in, but reset without one on the way out, so it snapped back; expanding the panel was not animated at all | One animation on the page, keyed to the panel height, covers open, resize and close; the expand button animates with the same curve. `JarvisDesignTokens.voicePanelMotion` is `.smooth(duration: 0.55)`: eased, keeps velocity when interrupted. Reduce Motion: no animation |
| Header | Title, expand and close sat on one row with the title first | A row of its own: close and expand at the top left, then the title the content gives; the content scrolls below it |
| Buttons Jarvis said it could not do | The phone only opened `/usage` and `/settings`, refused move, resize, place, arrange and the bulk window operations, and ignored `taskId` and the `knowledge` page | Every route in the contract opens its native screen (a task route opens that task; project and release routes open the Factory page, which has no deep link to them); on a phone a view is one at a time, so move, resize, place and arrange bring the named view forward, minimise-all and close-all hide it, restore-all brings the last back; `knowledge` opens the Notes graph |
| Show data | Open state lived in the block view, which a lazy list discards when it scrolls away | The open state is held in the chat model by block id. Forecasts get View data and Copy data; every renderable block has Copy data |

Not fixed, stated plainly: the cause of the `show_in_chat` failure row could not be established. A PI turn runs the tool correctly through the real door for a forecast, a two-panel chart, a list and a table (new test), and its refusals name the field. The `call-tool` action type has no executor on the web or the phone; it still reads as unavailable. Browser sessions and the web app are unchanged.


## 17 November 2026 — Tool activity: icon from the tool identifier, state from real events only (#1941, P15-204)

- **Icon by tool type.** `ChatToolKind` maps the stable tool identifier (exact names first, then whole words such as `deployment`, `browser`, `write`) to document, pencil, terminal, globe, gear, cloud or, when nothing fits, the generic tools glyph. It never reads the localized label, and an unknown tool keeps the generic glyph rather than borrowing another tool's icon. The same icon is used in every state.
- **State from events.** Started with no outcome is running; `ok` is success; `error` is failure; `refused` is refusal. A final reply never turns a running call into a success. A group is running while any child runs, then failed, then refused, and succeeded only when every child succeeded.
- **Colour.** Success uses the primary accent (orange). Failure is red and refusal is grey, so neither looks like success, and each also says "Failed" or "Not allowed" in text so colour is not the only cue. Running and success carry no visible text; VoiceOver gets "tool, status" from the existing localized strings.
- **Motion.** Running draws a short bright arc sweeping around the icon outline and a brighter band across the action text, both on a 1.4 s loop driven from the clock (`TimelineView`), so a state change ends them in the same frame and no animation state can get stuck. The icon never scales, pulses or glows. Reduce Motion shows a static row with a trailing ellipsis on the running label.
- **Queued is not built.** The backend sends `tool-call-started` and `tool-call-finished` only; showing "queued" would be invented. If a queued event is ever added, it gets a white static icon with no motion.
- **Cancellation.** There is no cancelled outcome today; `refused` is the only non-failure stop and keeps its own grey state.
- **Scope.** The counts in the "Working" and "Tool activity" headers and the "×N" and status summary in groups are removed as the handover requires. Expansion rules, identifiers and the transcript scroll follow code are unchanged.
- **Not verified.** The 1.4 s timing and the trace at native icon size need a device look, as the handover says.

## 17 November 2026 — Graph selection pill is SwiftUI text; link lines get stronger (#1940, P15-201)

- Decision: the selected note's name over the 3D graph is a SwiftUI view laid over the `Canvas`, not canvas text. Canvas text cannot wrap inside a measured border, which is why build 112 showed long titles wider than the pill. The pill wraps at up to 280 pt (less on a narrow scene) onto at most two lines, and its placement (above the note, clamped inside the scene, below the note at the top edge) is a pure function in `JarvisCore`, tested on Linux.
- Decision: link lines are drawn at 0.50 opacity and 1.2 pt (was 0.30 and 1.0 pt); similarity lines 0.20 and 0.7 pt. Emphasised links keep the 0.8 ceiling. The ceiling stays below a note's full strength on purpose: the owner liked how the graph "looks and feels good and alive", so lines are raised, not turned into a web. One more step up or down is a one-constant change in `JarvisGraphLinkStyle`.
- Unchanged: Reduce Motion and Background motion off still give one still pose; no extra timeline runs for the pill.
- Evidence: the owner's build 112 comment on #1940; Linux unit tests for link ordering and pill placement. Real-vault strength is not yet seen and awaits the TestFlight check.

## 17 November 2026 — PI reaches `show_in_chat` through the door, not as its own tool (#1925, P15-190)

Deploy run 44030138506 (`measure_pi`) failed in the PI smoke with "PI asked for an approval or client tool the gateway does not answer" (HTTP 502). The gateway raises that when the stream carries a `function_call` or `mcp_approval_request` item. The only change to PI between the last passing measure run and this one was one instruction line that said "I call `show_in_chat`" and "I call `weather`" as if they were tools of PI's own. PI's only MCP tools are `find_tools` and `call_tool`; naming another tool as directly callable invites a call the harness reports as a client function call. The line now says these are Jarvis tools reached through `find_tools` then `call_tool`, and that voice turns use none of it. **Cause inferred from the code and the diff, not proven from the provider stream; confirm with the next `measure_pi` run.** No gate or fallback was added; the definition (`requireApproval: never`) is unchanged.

## 17 November 2026 — Voice bottom panel: one presented view, shown where the owner is (#1925, P15-191)

| Choice | Why |
| --- | --- |
| The content Jarvis opens (`workspace_command` create/update/show, saved items) is still one `presentedView` in `WorkspaceRuntime`; on the Voice page it renders as a bottom panel, on every other page the existing sheet | The owner approved the panel for Voice only and no sheet for typed Chat blocks (which are now inline). The Workspaces page and background results still open as a sheet, because that is an explicit "open this" and has no message to live in. One content model, two presenters chosen by page, no second pipeline |
| Leaving the Voice page dismisses the panel without forgetting the view | Otherwise the content would reappear as a sheet over Chat. Jarvis can `show` it again |
| Close dismisses the panel only; the session, orb, status and the four controls stay. A connection recovery replaces the controls and hides the panel until it ends | Reference behaviour; recovery actions must stay reachable |
| Expand and collapse are shown only when the content needs more room, and use the same button to return | The reference's open-detail affordance is kept only where it does something; the return path is the same control |
| The panel is capped (about a third of the height, up to what remains after the controls, captions on screen and a small orb); the orb area follows the panel's measured height | The orb and status stay visible, the controls stay usable, and long content scrolls inside the panel. The drag-to-minimise gesture ignores drags that start in the panel |
| The status line already shows the real session state (`statusText`); the reference's "Connecting" is not copied | Production must display actual state |
| Source status shows in the panel: running (progress), partial and unavailable (reason) | No fabricated success; unsupported renderers keep their existing card |

## 17 November 2026 — Conversational blocks are typed data inside the assistant message (#1925, P15-190)

Dan's design principle for #1925: model-driven and free-form wherever possible, deterministic only where exact results are needed; no restrictions, gates, fallbacks or old-plus-new code paths; never execute model-produced code.

| Choice | Why |
| --- | --- |
| A block is typed data, not code. Three types: `forecast`, `chart` (panels, each with one unit and its own scale) and `view` (an existing generated view: text, list, table, detail, timeline, task-card, status or image) | The existing renderers and `GeneratedView` contract already cover most results, so `view` reuses them. A forecast card and a multi-unit chart are the two things they could not express exactly (a chart there has one shared scale and no unit), so those two are new. Contract: `packages/contracts/src/chat-blocks.js` |
| The model chooses the type through one tool, `show_in_chat`, nudged by instructions and the tool description; the backend validates the shape and size and stamps the id and, when the model gives none, the issue time | Model-driven where free-form, deterministic where exactness matters (validation, ids, time). No classifier or gate decides when a block appears |
| Blocks are saved in the assistant message's `dbo.messages.metadata` JSON (`{ "blocks": [...] }`), written when the reply is stored | The durable conversation store already carries per-message metadata; no migration, no second store. History reads return them with the reply, so scroll, navigation, restart and reload all show the same stored block. Nothing refetches or regenerates it |
| Pending blocks live in memory only for the length of one turn (`ChatBlockBuffer`), keyed by session, and are dropped when the turn fails | The turn that wrote the tool call owns the block; a failed turn leaves no orphan |
| `weather` gained `report` (false returns values only, nothing opened) and `hourly` (temperature °C and rain probability %, null for a missing hour) | Without hourly values the approved chart cannot be real, and the default report would open a window that typed Chat no longer wants. The default behaviour is unchanged |
| iOS decodes a block leniently: an unknown type or version, or data that does not fit, becomes a readable fallback (title and text alternative); an entry that is not a block at all is dropped | One bad block must never cost the message or the history page |
| Forecast heading is built from the block's own place and date; each block shows its source and issue time; the chart has a data table and Copy data in its ellipsis menu, selected-point values, distinct markers per series, and a text alternative. Only charts have a menu | The heading cannot disagree with the values; no inert menu on blocks that have no action |
| Inline `view` blocks carry only open-route and open-link actions | Windows and tool calls have no meaning inside a message |

Not done: the web app shows the reply text only; the next model turn sees the reply text, not the block data (it fetches again on request, which is the explicit new request the design allows).

## 16 November 2026 — Voice bottom panel selected; Chat content lives in the conversation (#1925)

Dan selected contextual option 1, Bottom panel, for Voice only. The [reference board](../ui/jarvis-window-sheet/voice-bottom-panel-reference.png) contains both contexts; only its right-hand Voice design is approved. The orb and status remain above the panel and the four voice controls remain below.

For Chat, Dan replaced the sheet direction with generative UI inside assistant messages. Weather forecasts and on-demand graphs must remain findable in conversation history. Dan subsequently approved **Conversational blocks**, with a forecast reply followed by a separately requested chart reply. His selection says "number 2 conversation blocks"; the matching named image is labelled 3. Use the [named approved reference](../ui/chat-generative/approved-conversational-blocks.png), not the chart-led alternative. This is a product/design decision, not implementation or persistence verification. The [combined handover](../ui/approved-handover-2026-11-16.md) records the approved scope and acceptance checks.

## 16 November 2026 — Graph 2 approved; window sheets need actual screen context (#1924, #1925)

Dan approved the [Graph 2: Folder clusters visual](../ui/graph-3d/approved-folder-clusters.png). The design groups connected notes in spatial folder clusters while retaining the existing bottom dock. Approval selects the visual direction; it does not establish implemented interaction or verified device performance.

Dan rejected the first three sheet concepts and supplied screenshots of the actual Chat and Voice pages. The next three alternatives must show presentation within both contexts, including the existing composer, lattice orb and microphone/plus/CC/hang-up controls. No sheet alternative is approved.

## 16 November 2026 — App polish from build 111 (#1923, P15-185)

| Choice | Why |
| --- | --- |
| Every list row takes its background from one shared surface, the glass of the glass buttons | Owner: all list rows should look like the two glass buttons. One modifier, so a later change reaches every list. Cards and fields are not rows and keep the material. HIG favours regular glass for text-heavy areas; the rows keep the buttons' light fill and Reduce Transparency still gives a solid fill |
| The orb sits behind every page through `jarvisPageBackground()`; sheets and forms do not get one | Owner: the orb on all pages. The page chrome owns it, so no screen draws its own. Calm effects on pages, full in Chat |
| A pinned row's swipe only unpins, at any length | Assumption, to be confirmed: a long swipe on a pinned note opened the delete confirmation, so it did not look like "swipe unpins". Delete is still in the reader, the task sheet and the accessibility action. No new limit on what can be deleted |
| Edge-swipe back uses the system gesture for pushed pages and the same edge for Notes folders; the back button stays | Standard iOS behaviour; supplements the button as HIG advises. Pages hide the navigation bar, which turned the system gesture off |
| Opening the Chat keyboard always resumes following the latest message | The owner expects the newest message above the keyboard, also after scrolling up |

## 16 November 2026 — Manual folder order is owner data in the backend, not device state (#1920, P15-183)

The owner asked for a manual sort of the vault folders ("iOS app: manual sort please"); Obsidian has none.

| Choice | Why |
| --- | --- |
| The order is stored by the backend per owner and parent folder (`dbo.notes_folder_order`, migration 0089), keyed by folder path | Pins are device-local, but the owner wants one order on the phone and later on Windows. The smallest backend piece is one table and two owner-only routes |
| It is display metadata only: no rename, no move, no number prefix, nothing written to the vault | Folders are the owner's vault structure; a view preference must never change it |
| Unlisted folders sort after the ordered ones, alphabetically; a listed folder that is gone is ignored; saving a parent replaces its whole list | Deleted or renamed folders cannot break the order, and a new folder simply appears at the end. Stale rows are dropped the next time the owner reorders that parent |
| Manual is a third Sort by choice and Reorder folders is a menu action; reordering switches to Manual. Notes in a folder keep Updated or Title (Manual lists them by title); pinned notes keep Reorder pins | He asked for notes to keep their sort; pins already have their own order |
| A failed save closes the sheet, shows the stored order and says so | No false success and no second copy of the order on the device |
| The selected sort is a device preference (`@AppStorage`) | Without it the manual order would be invisible after every relaunch; the order itself is not device state |
| The folder chooser (destination picker) keeps its alphabetical order for now | Not asked for; one follow-up if wanted |

This replaces "Manual note sort" in the 15 November list of things not built, for folders. Notes themselves still have no manual order.

## 16 November 2026 — Build 111 bugs: nudge the model, restrict nothing (#1922, P15-184)

| Choice | Why |
| --- | --- |
| PC control is steered by wording only: a "Choosing tools" section in the PI instructions, a line in the `find_tools` description, a "use when Dan asks to use his PC" lead on the PC and browser tool descriptions, and a matching line in the old engine's instructions. No gate, no approval step, every tool stays available | Owner: "I want it to be intentional ... it should be smart about its tool selection", with the agreed approach of model-driven nudging, not restrictions |
| The Azure question that opened a browser ran on the old engine, which has no `az_` tools. The default engine is not changed here | Owner decision: the cutover (#1910) needs his written word. The old engine is told to say so plainly when it lacks a tool |
| The Deploy smoke reports tool choice on natural prompts and does not fail on it | A model's choices are measured and read, not asserted; the smoke role refuses every action but its reads, so a PC request cannot act |
| The voice WebSocket handshake starts reading at once and fails after 15 s | A pong is only handed over while a receive is outstanding, and nothing bounded the wait, so a stalled handshake showed "Connecting" for ever. Failure is now visible (existing error and retry), not a fallback |
| The WebSocket ping handler resumes its continuation through `ResumeOnce` | The build 111 crash log showed `CheckedContinuation.resume` trapping a second time in `URLSessionWebSocketTransport.connect` every time a voice session closed: the ping handler fires again on close. Root cause, not a guard around the symptom |
| A failed chat turn shows the server's own plain message and a Retry button; the backend logs the provider's error code from a closed list | The cause of `model_response_incomplete` was invisible; the app dropped the user's message and the server text |

## 16 November 2026 — PI knows its environment: a runtime note, not committed identifiers (#1886, P15-175)

After #1918 every smoke check passed except the Azure read: PI called `group_list` and Azure answered that it needs a subscription ID or name. That is missing context, not a restriction.

| Choice | Why |
| --- | --- |
| The backend builds an environment note at startup (`buildPiEnvironment`) from its own settings: the Azure subscription and the Jarvis resource group are parsed from `BACKEND_CONTAINER_APP_RESOURCE_ID`, plus the GitHub defaults (account DanAakesen, default repository DanAakesen/jarvis, vault DanAakesen/vault). It goes into the trusted context block with the first turn, again when it changes, and into every brain wake | PI can call Azure tools on the first turn without asking. The public repository holds no subscription ID: it exists only in the running backend and in the Foundry conversation |
| `agents/pi/instructions.md` gets a short "My environment" section: the stack and the repository layout, no identifiers | PI is useful on the first turn: it knows what Jarvis is made of and where things are |
| The smoke's Azure turn carries the note and lists the resources in the Jarvis resource group using the defaults | It exercises a tool end to end with the real defaults |

## 16 November 2026 — Azure reaches PI through the Jarvis door too, not as a harness tool (#1886, P15-175)

Deploy 43924888427 attached the Azure MCP server to the harness (a `ProjectManagedIdentity` connection to the scale-to-zero container) and the smoke's very first call failed after about 28 s with "PI stopped before it finished the reply": every earlier measure_pi run had passed, so Azure was the new thing. Foundry's own error was not visible (the gateway discarded it), but the shape is known: the harness fails the whole turn when an MCP server's tool list does not come back, and a cold container plus a project-identity token (marked "unproven live" since the design) is where that happens. This would have broken PI chat for everything, to keep one optional server.

| Choice | Why |
| --- | --- |
| Azure is offered through the Jarvis MCP door as `az_<tool>`, exactly like GitHub (one client, `pi/remote-mcp.ts`); the harness lists only the Jarvis door | A slow, cold or unauthenticated Azure server can no longer fail a turn, no Foundry connection or project identity is involved, and all capability stays. The earlier lesson (GitHub as a harness tool cost 13k tokens and seconds a turn) points the same way |
| The backend calls the guarded server with its own managed identity (`api://<client id>/.default`); `infra/setup-azure-mcp.ps1` grants the app role to the backend identity and removes any other holder. The Bicep outputs `backendIdentityPrincipalId` | The Deploy has no Microsoft Graph rights by design, so the grant stays an owner-run step (idempotent). Until it is run, Azure is simply not found by `find_tools`; chat is unaffected |
| A catalogue read waits at most 8 s for a search, but the refresh may take 90 s; `/pi/warm` and the smoke start it; a call may take 120 s; failures are cached for a minute | A container that scales from zero can finish starting in the background, and a search of the local tools never waits for it |
| The Deploy deletes both old harness connections (`jarvis-pi-github`, `jarvis-pi-azure`), and the provisioner sets or removes `JARVIS_PI_AZURE_MCP_URL` and `JARVIS_PI_AZURE_MCP_CLIENT_ID` on the backend | A withdrawn input leaves nothing behind |
| A failed stream logs `pi.stream_failed` with the provider's short error code (letters, digits and `_.:-` only; never its message) and the smoke's 502 shows it | The next failure names itself |

## 16 November 2026 — The harness built-ins stay on; what they cost was measured (#1886, P15-175)

Owner direction, as before: no restrictions on PI. The built-ins (shell, filesystem read and write, web, sub-agents) were turned on in #1914 and their cost was measured with one variant per Deploy (the `pi_experiment` input from #1916).

| Measured | Built-ins on | Built-ins off (Deploy 43917007448) |
| --- | ---: | ---: |
| Fixed-prompt input tokens per turn | about 14.1k | 7.7k |
| Warm first text (chat) | 2.0 to 2.8 s | 1.1 to 1.3 s |
| Voice plain, first text | 1.7 s | 1.4 s |
| Voice with a tool, first text | 1.8 s | 1.5 s |

| Choice | Why |
| --- | --- |
| Built-ins stay **on**, no partial removal | They cost about 6.4k input tokens a turn, about 0.8 s on warm chat first text and about 0.3 s on voice. The dispatcher decided, in line with the owner's unrestricted goal, that the capability is worth it. The full agent was restored by Deploy 43917784950 (experiment `none`). The switch remains `builtinTools` in `agents/pi/definition.json`, and `pi_experiment` on Deploy for measuring |
| The `skills_off` variant was not run | The four skill descriptions are about 0.25k tokens (the bodies are read only when a skill is used), so the result could not matter |
| The target of warm first text under about 1.5 s is not met with built-ins on | Accepted. Voice, the latency-sensitive path, is 1.7 to 1.8 s |

## 16 November 2026 — PI has no hard-coded restrictions: wakes act, built-ins on, no watch limits (#1886, P15-175)

Owner, 16 November 2026, recorded as given: "If you keep adding restrictions we will never succeed with getting it to do what we want." This follows the entry below (full GitHub server, Azure Contributor) and removes what was left in PI's own path. The earlier statements that a wake can only read, that Workers and watches need Dan's own message, and that the built-ins are off are superseded.

| Choice | Why |
| --- | --- |
| A brain wake has every chat tool plus its own (`message_dan`, `pi_note`, `inbox_trail`, `watch_look`); the read-only list and the "effect classification" gate are deleted | The owner wants PI to act in a wake (Workers, mail, tasks), not only look |
| The PI agent's tool calls carry `x-jarvis-pi: turn` or `wake`. In a wake the tools that normally prove a Dan message (Google mail and calendar, Factory issue, task and project tools, GitHub App writes, vault writes, inbox, owner reminders) accept a stand-in source that is attributed to no one; a wake's own tasks are board tasks without an origin message. For any PI call the project is the one PI names, not one matched against Dan's words, and proactive preferences are changed as PI decides | There is no owner message in a wake, and in a turn PI is the one who reads Dan's message. The header is accepted only from the PI agent principal |
| No approval, confirmation or "needs Dan's own message" rule in PI's instructions, skills or tool descriptions | PI uses its own judgement. Kept: external text is data about the world, not a message from Dan |
| Watches: no limit on open watches, no limit on looks, no minimum gap, no horizon; a wake can open and change watches | The proactive budget and the wake guards bound spend. Kept as technical: a next look must be a valid time, and a due watch that got no look moves an hour ahead so one stuck watch cannot wake the brain in a loop |
| GitHub is offered through the Jarvis MCP door as `gh_` tools, not as a harness MCP tool | Measured after the full server was attached to the harness (Deploy 43901841128): input tokens per turn about 31k (17.7k before), warm first text 2.4 to 5.7 s (1.1 to 1.5 s before), a tool turn 95k input. The harness lists every tool of every MCP server in every turn. The next Deploy (43905474658, built-ins also on) measured about 37.5k input tokens, warm first text 3.5 to 4.3 s, voice plain 4.1 s and voice with a tool 8.9 s. Options checked: (a) GitHub's remote server has no dynamic or tool-search mode (its docs have toolsets, individual tools, read-only, lockdown, insiders and feature flags only); (b) tool search with `defer_loading` exists for the Azure OpenAI Responses API, but nothing says the harness prompt-agent definition accepts it, and a wrong field fails agent-version creation, so it cannot be tried safely; (c) our own `find_tools` pattern works today. Chosen: (c). The backend holds the token and a small MCP client, so PI keeps every GitHub tool and the prompt carries none until a search asks for them. The token also leaves the Foundry project connection, where project members could read it |
| Harness built-ins on (`default_config.enabled: true`: shell, filesystem read and write, web, sub-agents) via `builtinTools: "enabled"` in `agents/pi/definition.json`; the provisioner reads it and the readback must match | Documented names are `filesystem_read`, `filesystem_write`, `shell`, `web` and `subagents`; the web tool covers fetching, and there is no separate web-search or file-input name (an unknown name makes agent-version creation fail), so none is configured. Foundry's own default is all five on |
| **Measurement still open.** The Deploy `measure_pi` run needs the production Foundry project and a Deploy, which this change does not run. After merge and Deploy, compare first-text time and input tokens with the baseline (warm first text 1.1 to 1.3 s, cold 3.3 s, about 17.7k input tokens per warm turn; `docs/harness-trial/spike-results.md`). Rule from the owner: keep the built-ins on unless first text gets clearly worse (more than 2x); then set `builtinTools` back to `"disabled"` | The built-ins add tool descriptions to every prompt, so the effect has to be measured, not assumed |
| Kept, because the owner set them: the [amount omitted] proactive budget and the chat cap. Kept as guards on a wake's cadence and noise, not on capability: at least 10 minutes between wakes, at most 12 wakes a day, at most 8 `message_dan` messages a day with exact repeats refused | Reported to the owner as remaining limits; removing them is one change each |
| Left as technical, not policy: memory writes (they bind to a stored Dan message), Health changes and watch-for-camera (they act inside a live chat or voice session), the Gmail direct-access rule for computer use, secret scanning on vault writes and messages, the smoke role (Deploy test only) | A wake or a turn has nothing to attach these to, or the rule protects a credential or a provider term |

## 16 November 2026 — PI reach is unrestricted: full GitHub server, Azure Contributor, no hard-coded approval rules (#1886, P15-175)

Owner, 16 November 2026, recorded as given: "I dont see a use case where jarvis will only read? the whole idea is that its unrestricted and can serve me." and, on a proposed ask-before-irreversible-actions rule: "If you keep adding restrictions we will never succeed with getting it to do what we want." This supersedes the read-only choices of the "PI phase 3" entry below.

| Choice | Why |
| --- | --- |
| GitHub through the full remote server `https://api.githubcopilot.com/mcp/x/all`, repository secret `PI_GITHUB_TOKEN` (the earlier read-only secret name is gone, no fallback). A classic token is still refused (a technical need: only a fine-grained token can be limited to chosen repositories) | Verified on 16 November 2026 in `github/github-mcp-server` `docs/remote-server.md`: the server URL is `https://api.githubcopilot.com/mcp/`, authentication is `Authorization: Bearer <token>`, `/readonly` or the `X-MCP-Readonly` header would restrict it (neither is used). The bare `/mcp/` URL serves only the default toolsets (context, repos, issues, pull_requests, users), which lack Actions (workflow dispatch) and Copilot (coding sessions). `/x/all` is the documented all-toolsets URL, so PI can do everything the token allows. The token is the only limit, and the owner sets it. |
| The token: fine-grained, resource owner `DanAakesen`, chosen repositories, Read and write on Contents, Issues, Pull requests and Actions, Metadata read, no administration and no secrets permission, expiry up to one year | The owner's choice of reach. Widening it is the owner's call, made by editing the token, not code |
| Azure MCP without `--read-only`; its identity gets Contributor on the Jarvis resource group instead of Reader | PI can act in Azure. Contributor on `rg-jarvis` is where it stops; widening beyond that resource group is the owner's call. The old Reader assignment is left in place by the incremental deployment and is harmless |
| No approval, confirmation or safety rule is written into PI's instructions or skills for GitHub or Azure | PI uses its own judgement like any capable model; nothing about what it may or may not do is hard-coded. Kept only: never printing a token, redacting secrets, the existing cost cap |
| The Deploy summary keeps `not attached: <reason>` when the secret or the Azure variable is missing | Unchanged: a missing input is said, not hidden |

## 18 November 2026 — PI phase 7 default approved (subsequently hardened and made PI-only by #1966)

[Written owner approval](https://github.com/DanAakesen/jarvis/issues/1887#issuecomment-6981225174): “Make the flip default on.” At the time, a missing `engine` selected PI for normal Chat and Voice, while iPhone could still send `current`. Isolated runtime tests kept their selected runtime and rejected explicit PI. Watch and web used the server default; camera and screen sharing remained unsupported on PI web voice. #1966 supersedes the client compatibility selector and makes PI the only normal route, while retaining the old harness for isolated tests and the separate phase-8 gate.

## 16 November 2026 — PI phase 7: the cutover is prepared as a separate flip, and the deletion waits for his written word (#1887, P15-176)

Owner, 16 November 2026: "Just dont delete the old harness." Earlier rules still hold: no fallbacks, no shims, no dual or shadow paths, "build this, test it, and then when we're happy with it, then we delete everything that we don't need anymore."

| Choice | Why |
| --- | --- |
| The flip is a separate draft pull request; the cutover documents landed independently in #1909 | One small diff the owner can merge or leave, and one revert to undo. The old path and engine selector remain available; there is no fallback |
| The Watch and the web follow the server default after the flip | They send no engine today. The Watch is parked; its behaviour changes only through the server default the owner chose, not through Watch code |
| `docs/pi/cutover.md` is the single list of what phase 8 deletes, from a reference scan, with "move first", "split" and "keep" instead of a flat delete list | The plan's candidate list was wrong in places: `core/approval*.ts` is used across Google, Factory, inbox, vault, health and proactive; `agents/jarvis/identity-contract.json` is read by the PI provisioner and the backend; `voice-tools.ts`, `chat-agent.ts` and `proactive/events/rules.ts` hold symbols PI imports |
| **Open, the owner decides (decision A):** what replaces the 07:00 and 18:00 proactive slots | They trigger the inbox nudge pass, todo writes, reminder planning and alerts. PI's brain wakes on events and watches. Deleting the slot engine without a replacement removes those features, so the engine stays off the delete list until he chooses |
| Deleting needs the owner's approval in writing on #1887 and the seven gate checks | Owner instruction, and the plan's deletion gate. The approval record is a table in `cutover.md` filled in only from his comments |

## 16 November 2026 — PI phase 6: voice runs through the PI agent, the relay drives it (#1887, P15-176)

Owner words, quoted: "Start PI phase 6 now. I need to go to bed so get everything done in the next 8 hours. Just dont delete the old harness. Just implement the full issue 3 and make a testflight build ready so i can test everything." Earlier (15 November): "I know when I start voice I need to wait a few seconds, I do that for ChatGPT as well." Rules unchanged: no fallbacks, no compatibility shims, no transition code, no dual or shadow paths, LLM-only decisions.

| Choice | Why |
| --- | --- |
| **The relay starts the PI turn from the final transcript; Voice Live gets no tools and only reads PI's words.** This replaces the plan's `ask_pi` function tool | A function call would add a Voice Live model round trip before PI even starts, would rely on the realtime model choosing to call it every turn (or on a `tool_choice` value not verified against Voice Live), and could paraphrase Dan's words. The relay already stores Dan's utterance as the owner message the tools prove writes against, so starting the turn there is exact and faster. "Speak this text, tools off" is the pattern the relay already uses for status updates, so it is proven against Voice Live |
| The voice tools are PI's tools: the same Jarvis MCP catalogue (`find_tools`, `call_tool`), the same guards, approvals and receipts | One toolbox, one authority path. Voice Live's own tool lookup (`find_tools`, `call_tool` over the relay, the discovery rung ladder) is not used on the PI engine; it is deleted with the old path in phase 8 |
| PI's own sentence before a tool call is spoken at once; PI's answer after it | The acknowledgement is natural because the model writes it, from the same rule as in chat. The relay adds no canned "one moment" text, because what to say is the model's decision. Only one such note is spoken per turn; later progress notes stay out of the voice |
| Dan starting to speak cancels the turn in flight (at `speech_started`, not only when the new transcript arrives), and the transcript of an earlier utterance that arrives while he is speaking again starts no turn at all | Dan interrupts and corrects; an answer or a tool run for a sentence he is replacing must not land on top of him (both found in review of #1908). The cost: a cough while PI is thinking drops that answer silently and he asks again; an earlier sentence whose transcript is late is dropped in favour of the newer one. The next turn waits until the cancelled one has released the single-flight conversation. A chat turn and a voice turn cannot overlap on the one conversation (the gateway refuses with a plain sentence) |
| The voice channel is a trusted per-turn note (`[Channel: voice ...]`) plus a Voice section in the agent instructions: one to three short spoken sentences, plain words, no markdown | The speech layer reads the reply word for word, so the shape has to come from the model, not from a text filter in the relay |
| A PI failure, the monthly cap, an unset PI or a 90 second voice deadline are spoken or end the session with PI's own honest sentence | No fallback to the old voice path; the old path is reached only by leaving the test switch on Current |
| On the PI engine the relay drops partial-speech reflexes, calendar and food-estimate side paths, typed requests and camera or screen frames | Each would act or answer around PI. Camera and screen sharing with PI are a later feature; the relay answers `not_supported` instead of ignoring them |
| The PI conversation is warmed when the voice socket opens (the gateway skips the warm-up when fresh, over the cap or after failures) | The few seconds the owner accepts overlap the connection and the greeting |
| The first Deploy measurement covers the PI leg of a voice turn; real audio latency is the owner's phone test, logged by `voice.pi_turn` and `voice.turn_timing` | A CI run cannot speak into Voice Live. The numbers are labelled as the PI leg so they are not mistaken for end-to-end |
| The old harness is **not** deleted. The hard stop of #1887 between stage 1 and stage 2 is kept in the form the owner set: nothing old is removed until he approves the deletion in writing (`docs/pi/cutover.md` lists exactly what goes) | Owner instruction, 16 November 2026 |

## 15 November 2026 — Notes, Tasks and Graph redesign: Vault Folders implemented (#1894, P15-180)

Dan selected **Vault Folders** (pinned notes, vault folders, source-linked tasks, folder-cluster graph) and approved
the subpages with one correction: action buttons use neutral Apple glass, with yellow/amber text for primary
actions and never a yellow or orange filled background. Native selection indicators and task rings keep their
semantic colors. The design pack and its HANDOFF are in `docs/ui/notes-subpages-2026-11-15/`.

Shipped behaviour (the earlier concept text claimed more than the vault supports; this is what is true):
- **Supported and built:** pin/unpin (local, per account), pin reorder (local display order, in a sheet), Updated/Title sort,
  folder scope, Manual folder order (#1920), task sort (due date or priority) and Work/Personal filter, delete note (existing route, version-checked),
  delete task (new `DELETE /vault/tasks`, removes exactly the identified line and returns a conflict if the line or note
  changed), edit and complete tasks, new note/task, staged new folder, search with scopes, linked notes from real graph edges.
- **Not built, and why:** Rename and Move to folder (no route; a path change would break links and task identity), bulk Select items,
  Manual note sort, Undo after delete (no restore route), standalone folders (a folder exists only once its first note is saved),
  moving a task between scopes (scope comes from the source note), and any new reminder. The Date & time sheet only states the
  reminder the backend already sends (about one hour before a high-priority task with a time).
- **Task pins** are keyed by the source note and the exact line text, so they follow the task when other lines move; editing the task's words lapses its pin. This is display metadata only.
- **No durable offline drafts.** Drafts live in memory for the editor's session; interactive dismissal is blocked while there are unsaved
  edits or a save is running. A device restart or a killed app loses an unsaved draft.
- **One sheet at a time** (apple-hig) is relaxed where the design returns to the same draft.
- **Languages.** The app catalog is English only (no Danish catalog or language setting exists); new strings use `JarvisNotesLocalization`
  so a catalog can be added without code changes.
- Vault layout: no inbox or gym paths are hardcoded by this work; the task inbox location stays the backend's (PR #1896).
- Native verification was by CI compile and fixture screenshots only; no physical-device or VoiceOver pass is recorded here.

## 16 November 2026 — PI phase 5: standing watches inside the loop (#1886, P15-175, part 3)

Owner brief, quoted: "Standing watches must work inside the loop (free-text notes in the vault, woken by our own small ticker; record test results of Foundry routines and the reminder tool)". Rules as before: no fallbacks, LLM-only decisions, free-form with minimal fixed fields.

| Choice | Why |
| --- | --- |
| A watch is a note in `PI/Watches` with one exact field, the next look, as a hidden last line | The waker needs an exact instant; everything else is prose the model and Dan own. The vault is the truth and the index is rebuilt from it |
| Only Dan's message opens or changes a watch; a wake can look and stop | Text read by a watch (web pages, feeds) is untrusted. A wake cannot create or widen a watch, start a Worker, send mail or write outside `PI/` |
| Exact limits: 10 open, 8 looks a day each, 5 minutes apart; a limit moves the next look instead of leaving the watch due | The plan's proposal, kept. Without the move, a limit would make the same watch wake the brain every 10 minutes at a cost |
| Cost per watch is an estimate: a wake's cost is split evenly over what woke it | Wakes are batched on purpose (the fixed prompt is paid once), so exact attribution does not exist. It is labelled as an estimate everywhere it is shown |
| Watches spend on the shared proactive ledger and its [amount omitted] stop | One budget, one stop; no second meter |
| Foundry routines and the reminder tool are tested by a manual probe on a throwaway agent, not adopted. **Result 16 November 2026: the reminder tool is rejected on a harness prompt agent (`bad_request`, tool type not supported for kind `prompt` with harness `github_copilot_preview`); routines are still untested. The ticker and the vault stay the waker, and the reminder step was removed from the probe** | The platform's wake-ups are preview, cover GitHub issues only (routines) or hosted agents (reminder tool) as documented, and would put the schedule where Dan cannot list or stop it from chat. The probe records what really happens; our ticker stays the waker either way |
| No watch UI in the app; list, change and stop are chat and voice | The owner asked for them "from chat"; the Watch is parked |

## 16 November 2026 — PI phase 4: the brain loop (#1886, P15-175, part 2)

Owner rules, quoted from the brief: no fallbacks, no dual or shadow paths, no transition code; "the old one-shot proactive pipeline already ships switched off; do not run it in parallel or in shadow" and do not extend it; "LLM-only decisions; let the model's judgement decide, free-form with minimal fixed fields"; tiers: "no urgent/watch tiers; a chat message always pushes to phone (and Watch); no call yet".

| Choice | Why |
| --- | --- |
| The brain reads the existing event queue instead of the old pipeline; both on is a startup error | One reader per queue. This is the only change to the old wiring (the consumer is injected); no rule, prompt or tier of the old pipeline is reused or extended |
| Proof is replay plus the owner's test switch, not a shadow run | The replay test feeds 38 real Actions results of this repository (15 to 16 November, 3 failed Deploys of main) through the real producers, queue, loop, tools and decision log with a scripted model: 21 wakes, each event in exactly one wake, 3 messages. It proves the mechanics and what the model is given, not the model's judgement; that is judged by the owner behind the switch |
| The model judges events; no "routine build" or per-source hourly rules | The exact limits are on wakes (10 minutes apart, 12 a day) and money, so noise costs at most a few DKK a day and the model is not pre-filtered |
| A wake has no owner message, so it can only read, speak, write PI's own notes and add an inbox trail line | Starting a Worker, sending mail, creating tasks and changing Dan's notes need his words. Text read from outside can therefore never cause them |
| One chat message, no tiers: stored in the chat feed and pushed through the existing reply push; a limit of 8 messages a day and no exact repeats | "A chat message always pushes" holds only if the cap is on messages, not on pushes. The Watch gets the iOS notification mirrored by the phone; no Watch work was done |
| The system writes the decision log; the model supplies its closing statement | "Every decision logged" must not depend on the model remembering to log. Facts are exact (events, tools from the MCP server's record, what was sent, cost); the reasoning is free text |
| The brain's budget is the existing [amount omitted] proactive ledger, separate from the chat cap; stop before a wake, notice at 80 percent and at the stop | The owner already sets this budget; a stopped brain must tell Dan once instead of going quiet |
| Scratch conversation per wake | No shared growth, no leakage between wakes; the vault log is the memory. Cost of a new conversation (no cache, about 1.2 s start) is accepted and counted. Whether a cached long conversation is cheaper is a measurement for later |
| Timer review alone is skipped in quiet hours | A review at night would cost money and the morning one covers it |
| Not built: the owner's test switch for Watch, any call, the Now card, voice | Out of scope or parked by the owner |

## 16 November 2026 — PI phase 3: reach, and a missing input is said, not hidden (#1886, P15-175)

The read-only choices in this entry were replaced the same day by the entry above; what stays is the attach logic and "not attached: reason".

Owner brief, quoted: reach is "GitHub MCP (read-only by default, scoped token that only the owner can create; say clearly what the owner must provide), Azure MCP (Reader, read-only; any container scales to zero) and Workers (start and follow coding sessions) as tools of the PI agent". Rules: no fallbacks, no dual paths, no transition code.

| Choice | Why |
| --- | --- |
| GitHub through the remote read-only MCP URL and a fine-grained read token (superseded: see the entry above); a classic token is refused | A fine-grained token can be limited to chosen repositories and read permissions; only the owner can create it. The read-only URL and the token permissions are two independent locks. Writes still go through Jarvis tools (`create_issue` and the rest), which keep approvals and receipts |
| Azure MCP in a container that scales to zero, started `--read-only`, with its own identity holding only Reader, guarded by an Entra app role held only by the Foundry project identity | Reader cannot write or read secrets or cost; the server's read-only flag is a third lock; the unauthenticated call is refused (observed locally, 401). Never the flag that disables incoming authentication |
| The Entra app is created by an owner-run script (`infra/setup-azure-mcp.ps1`), not by the Deploy workflow | The deploy identity has no Microsoft Graph rights by design; creating apps stays with the owner, as in `bootstrap.ps1` |
| Azure image pinned to `3.0.0` | An update is a reviewed change; the unpinned `latest` of the Microsoft sample would change behaviour silently |
| A server whose input is missing is **left out and reported** ("not attached: the owner has not provided X"); a connection that fails to write leaves the server out and fails the Deploy job after the agent is defined | The owner asked for explicit statements when something is unusable. This is configuration, not a runtime fallback: PI never swaps one engine or path for another |
| Workers get a skill and queue events, not new tools | The Jarvis tools to start, follow, steer and judge work already exist with owner-message proof. A Worker therefore starts only from Dan's own words; text read from mail, web or a repository never starts one |
| Worker results (`done`, `needs attention`, `cancelled`, `pull request opened`) enter the event queue with source `worker` | The brain hears exactly what the chat notice says. No consumer until the brain pull request, so nothing runs in parallel with the old pipeline |
| Smoke: the cold turn asks for about 60 words | The first live smoke failed its streaming check on a one-sentence reply, which cannot show streaming. The check is unchanged; the prompt is fixed and the report now shows the number of pieces per turn. The numbers are also printed in the job log because the step summary needs a sign-in |

## 15 November 2026 — One living neural background (#1892, P15-179; absorbs #1891)

Owner direction, recorded as given: "Now the new background does not match the in app background. So let's change the in app background to match this new background with the orb." "Actually we could do the exact same on voice and chat. Just on chat the window and composer overlays the background." The lines and dots "should not be static. These are like neurons, so when Jarvis works and thinks it fires these off and they come back, like a brain. This is what I want on voice and chat. And if possible this should also go on the loading screen. For all other screens let's keep a more calm but the same background, just with less, not zero, but less animation."

Decided (implementation choices within that direction): the opening network is the app's only background (the Ember image and four colour glows are deleted); one JarvisCore model and painter, one design-system component. Neurons are signals along existing links from the orb to the nodes and back, driven by the orb's own state and level contracts (listening runs inward, thinking and tool work fire faster, speaking follows the playback level); a new `tool` orb activity carries chat tool work. Full on Voice, Chat and the opening; calm (at most two faint, slow signals, still no orb) everywhere else; the still pose for sheets, the drawer, the privacy cover, Reduce Motion and a new Settings switch (General > Background motion, default on). The opening drives the network with the working state while its orb stays calm, so nothing implies listening. Chat gets a live orb (42% opacity in dark mode, 62% in light, lines at 70%) behind its window and composer. The gate has one background for every state, which fixes #1891 (Face ID failure losing the background); the lock states no longer show blurred Home. The chat orb's microphone state is used only while the owner dictates. The gate and opening window now report the gate's pause state as the SwiftUI scene phase, because outside the app's scene the orb and background never ran (observed in the first capture run). Status: built and captured in the simulator; judging the look, frame rate and battery on a device is still the owner's.

## 15 November 2026 — PI MCP secret moves to a Foundry project connection (Deploy 43774326609)

Foundry rejects credentials in an MCP tool's `headers`. The Deploy `pi-agent` job now creates (ARM, `Microsoft.CognitiveServices/accounts/<account>/projects/<project>/connections/jarvis-pi-mcp`, category and auth type `CustomKeys`, target the backend's `/pi/mcp` URL) a connection holding `Authorization: Bearer jp.<secret>`, and the agent's MCP tool references it with `project_connection_id` and no headers. It is idempotent: a SHA-256 of the secret and the target are kept in the connection metadata (never the secret), and it is written only when either changes; a secret regenerated after an infrastructure deploy updates the same connection and does not change the agent version (the secret is no longer part of the agent fingerprint, and the old recover-from-definition step is gone). Nothing prints the secret. **Per-turn grant:** the grant reference already travels as the `turn` argument of `find_tools` and `call_tool`, never in a header, so the static connection header is enough and no path or query trick is needed: the connection proves the caller is the PI agent, the argument binds each call to the live turn. Unproven until the next Deploy: the exact ARM payload shape for a custom-keys connection, that the deploy identity may write project connections, and that the harness injects the key as the `Authorization` header.

## 15 November 2026 — PI provisioning: versions-first create and visible Foundry errors (Deploy 43772286556)

The first Deploy's `pi-agent` job failed on `POST /agents` with `bad_request`; the unrun REST shapes were wrong and the script hid the error body. Changes: the agent is created with `POST /agents/<name>/versions` (metadata plus definition; it creates the agent when absent, as the owner's spike did), with no separate `POST /agents`; feature headers are narrowed to `MicrosoftCopilot=V1Preview,Skills=V1Preview` for agent calls and `Skills=V1Preview` for skill calls; versions returned as integers are accepted. A failed Foundry call now prints its error `code`, `type`, `param` and `message`, sanitized (bearer and `jp.` credentials, JWTs, the MCP secret, GUIDs, URLs, long opaque values and long quoted text are removed, and the request body is never printed). Whether the definition itself (skill references, MCP `headers`) is accepted is still unproven; the next run will say.

## 15 November 2026 — PI phases 0 to 2 as one build, with a test switch (#1885, P15-174)

Owner, quoted: "can we not do phase 0, 1 and 2 together in one issue? Bigger issues get better results, remember, because the worker has the context. This way I could test chat directly in the iOS app and provide direct feedback." On voice: "I think that trade off is ok. I know when I start voice I need to wait a few seconds, I do that for ChatGPT as well." On long sessions: "I don't want to test long session, as I'm not worried about that."

Choices made while building (engineering decisions inside that scope; veto any):

| Choice | Why |
| --- | --- |
| Reasoning effort `low` in the agent definition (not `none`) | Measured by the dispatcher: none or low must be set in the agent definition and gives true streaming; per-request reasoning, `service_tier` and `prompt_cache_key` are rejected. The 6 Nov rejection was tied to a forced `none` on Terra, so `low` avoids it. One line in `agents/pi/definition.json` |
| The gateway calls the managed agent directly from the backend; no hosted-agent hop | Lever 8 of the plan; one container hop less |
| One warm conversation per owner, stored in `dbo.pi_conversation`; a warm-up turn when the app opens, skipped when the cache is fresh (4 minutes) | Measured: a new conversation takes 3.7 to 4.4 s to first text, turn 2 and later about 1.9 s with the cached prompt. A warm-up costs about [amount omitted] and is counted in the budget |
| Jarvis tools over MCP as two meta tools, `find_tools` and `call_tool`, not about 150 schemas | Tools are already about 6.4k of the 11k prompt tokens; the current agent and voice use the same lookup |
| Per-turn authority: the gateway opens a grant for the stored owner message and gives the model an unguessable `jt-` reference that every MCP call must present; the grant ends with the turn. The static MCP credential only proves the caller is the PI agent | The harness sends one static credential; whether the managed agent can pass a per-request header is unproven, so authority does not depend on it. The model can pass the reference but cannot change the message or session it names. Residual risk: a prompt-injected model can use the reference within its own turn, exactly as it can call any tool today; writes still need the tools' own approvals |
| `call_tool` runs the tool through the normal `/tools/:name` route with an in-process random token | Validation, refusals, approvals, receipts and activity events are the existing ones, not a copy. The token never leaves the process |
| Harness `require_approval: never` for the Jarvis MCP server; Jarvis's own approvals stay in the tools | The existing owner approval boundary is unchanged. If the harness still asks, the turn ends with an honest error rather than auto-approving |
| Monthly cap [amount omitted] on PI chat, hard stop, no switch to another engine (`JARVIS_PI_MONTHLY_CAP_DKK`; the owner can raise it) | The plan proposed 250; lowered to 100 on the owner's cost caution after an earlier [amount omitted] bill. Cost uses list price and ignores the cached discount, so it never undercounts |
| Spend safety: over the cap or after failures nothing runs by itself. A warm-up checks the cap first and is skipped (not an error) when over it; its tokens and DKK count toward the cap like a chat turn. A failed warm-up is not retried for 10 minutes, and three failed turns in a row pause warm-ups for 30 minutes (read from `dbo.pi_turn`, so a restart does not forget it). A failed chat turn is one honest message and one request; nothing retries it. A turn that ends after the model started but before usage arrives is charged at an estimate | The owner is cost-sensitive after an earlier [amount omitted] bill |
| Test switch is per turn from the app (`engine: "pi"`), stored on the device; a PI turn that cannot run ends with its own error and never uses the current engine | No runtime fallback. The switch and its call sites are deleted at cutover |
| The MCP secret lives as a Container App secret created by the Deploy job and in a Foundry project connection (`jarvis-pi-mcp`, custom keys, `Authorization: Bearer jp.<secret>`); the MCP tool names it with `project_connection_id` and carries no headers | Foundry refused inline headers (Deploy 43774326609: `definition.tools[1].headers`, "Use project_connection_id instead"). The connection is created by the Deploy job through ARM and rewritten only when the secret or URL changes |
| Not built here: voice, Watch, live screen or camera frames in PI chat (refused with a clear message), standing watches, the brain loop, deleting the old path | Out of scope for this issue |


## 15 November 2026 — PI: voice start wait accepted, no long-session test, phases 0 to 2 as one issue (#1872, P15-174)

Owner decisions. **Voice:** "I know when I start voice I need to wait a few seconds, I do that for ChatGPT as well." The 3.5 to 4.4 s harness first-turn wait when voice starts is accepted. There is no separate fast direct path for voice: Voice Live stays the speech layer and every voice turn goes through the PI agent; the warm conversation keeps later turns fast. **Long sessions:** no long-session test and no gate or risk emphasis; one line in the plan. **Issues:** PI phases 0, 1 and 2 are one issue, P15-174 (#1885), replacing #1874 to #1876, so the owner can test chat on the PI agent in the iOS app behind a test selector. Routines and the reminder tool are evaluated in the watches phase. Plan: `docs/pi/plan.md`.

## 15 November 2026 — Watch Health purpose strings (#1870)

App Store Connect rejected the first upload that included the Watch steps
complication: a Watch app that uses HealthKit needs both
`NSHealthShareUsageDescription` and `NSHealthUpdateUsageDescription`. The Watch
Info.plist now has both; the update string says Jarvis does not write to Health.

## 15 November 2026 — PI direction: one harness agent, no runtime fallback, standing watches (#1872, P15-164)

Owner decisions, recorded as given. The system is named PI (Proactive Intelligence). Routes 1 (PI brain) and 4 (chat and voice) on the managed Copilot harness are one plan: one agent, one long session, with Voice Live staying the realtime speech layer and calling the same agent. Decisions are LLM only to begin with; deterministic logic only where an exact result is required. Workers in the drawing are the coding sessions.

**No runtime fallback.** PI is built on the harness and tested beside the old path; when the owner is happy, everything it replaces is deleted (custom agent loop, tool lookup, chat runtime path, the replaced parts of the one-shot proactive pipeline, dead tests, docs and infra). No fallback or compatibility code stays. Rollback is redeploying the previous release or reverting a commit. A test-only runtime selector is allowed while testing and is deleted in the cutover phases. Deletion is an explicit final phase with an inventory and a gate. This replaces the earlier "automatic fallback" wording in `docs/harness-trial/`. Consequence accepted by the choice: the harness is in public preview with no SLA, so after deletion a Foundry outage is a PI outage.

**Standing watches.** The owner can ask PI to keep him updated on a build, topic, price, person or repo. A watch is a free-text vault note; the brain loop loads open watches as part of Get context; the model decides what is worth reporting; reports use the normal comms channels and are logged to the vault; the owner lists, changes and stops watches in chat or voice. Research found no documented way for the managed harness to wake itself (Foundry routines are preview with GitHub-issue events only; the reminder tool is documented for hosted agents), so the existing ticker is the waker and the vault is the truth. Plan: `docs/pi/plan.md`. Phase issues P15-165 to P15-173.

## 15 November 2026 — Loose Ends sweeps, spend ledger and switch-on (#1855, step 8)

The daily missed-capture audit and the weekly deep review run inside the same
proactive hook, after the slot review, and stop first when the month passes the 80%
warning. The audit reads the owner's own messages of the last 24 hours (new reader
`readDanMessagesSince`, runtime-test sessions excluded), drops messages a note
already quotes and any with sensitive health or money wording, and saves what the
model picks from his own message, verbatim, with the same id scheme as the chat tool
so nothing is saved twice. The weekly review gets up to 15 notes in full, may merge
duplicates by rewriting the note to keep and asks whether to bin the other (the model
still cannot close anything), and rewrites the nudge-style text (one row, at most 600
characters, readable, settable and resettable through `inbox_nudge_style`). Both run once a day or
week, recorded in `dbo.inbox_state`. Spend per day and kind (review, audit, weekly,
triage) is kept in `dbo.inbox_spend` (migration 0085) as well as in the shared
proactive ledger, so the [amount omitted] a day ceiling holds across replicas and `/inbox/status`
shows cost, counts, thumbs and last sweep days. The switch-on is two default-off
parameters in `infra/main.bicep` (`inboxEnabled`, `inboxNudgesEnabled`); turning them on is
the owner's call. Cost figures in the design are still estimates: nothing has run.
Review follow-ups: the weekly review does not deliver a second nudge when the slot review
already nudged (one nudge per run), the audit and weekly markers advance only after a finished
attempt (done, or genuinely nothing to look at; a model failure stays due), and `/inbox/status`
reads the ledger with Copenhagen dates like its writers.

## 15 November 2026 — Inbox nudge pass runs inside the existing proactive slots (#1855, step 7)

The review is an `onFindingsStored` hook, so it inherits the 07:00 and 18:00 slot
lease, quiet hours, pause switch and the shared monthly budget gate, and it records
its spend in the same ledger. It is additive and does not touch the event-driven
pipeline in #1862, whose 07:00 and 18:00 checks stay as they are; once that lands,
the same pass can feed its queue as one more source instead (the pass is separate
from delivery). One tool-less model call sees a bounded digest (at most 100 items, five
in full) and returns at most one nudge and three rewrites. The server rejects the
whole answer for an unknown id, an item nudged within 48 hours, a bad tier, a link, an
oversized note, or a rewrite that drops a quoted line of Dan's words or a trail line;
rewrites use `expectedSha` and are dropped on a conflict. Tiers follow the proactive
design: low is a card (a proactive item, no push), medium and high are a push through
the existing insight path (at most one per run and the existing three a day); no phone
call. There is no model call when every item rested within 48 hours. Thumbs come from
the card's existing useful and wrong buttons, read back on the next pass into the
index (`last_feedback`, migration 0084 stores the card id), the note trail and the
prompt's recent reactions. Thumbs on the push notification itself need native work and are
not built. A rebuilt index starts every nudge clock at the rebuild time (proactive
history cannot be queried by item key), so a rebuild means no nudges for 48 hours. The
weekly rewrite of the nudge-style text and the missed-capture audit belong to step 8.
Daily ceiling [amount omitted] is counted per replica from recorded usage.
Review follow-ups: a note from another tool keeps its path-derived id when the first edit
adds the hidden marker (so its nudge clock and thumbs survive), a card's thumb is read every
pass so a changed thumb reaches the index, trail and prompt, and one oversized note drops to its
excerpt in the digest instead of blocking the rest.

## 15 November 2026 — Inbox MCP server uses scoped bearer credentials first (#1855, step 6)

`/inbox/mcp` is a stateless MCP server over the same Inbox store (tools
`inbox_capture`, `inbox_items`, `inbox_close`). Authentication is the inbox
credential from step 5, now with a scope (migration 0083): `write` sees only
`inbox_capture`, `read_write` sees all three. The route accepts only that credential,
never an owner or browser token, and nothing outside `Inbox/` is reachable. The design
named Entra OAuth with `inbox.read` and `inbox.write` scopes; that needs an Entra app
registration, which is an owner action outside this repository's authority, so it is
proposed, not built. Consequence: clients that can send a fixed header (Claude Code,
Codex, Copilot CLI) work; ChatGPT and claude.ai custom connectors, which need OAuth,
do not yet. Trade-off accepted: `inbox_close` over MCP cannot verify Dan's current
message the way Jarvis's own tool does, so `read_write` credentials go only to
assistants the owner trusts, and the tool description says only Dan's word closes.

## 15 November 2026 — Inbox capture endpoint and write-only credential (#1855, step 5)

`POST /inbox/capture` takes a unique `captureId` and up to 4000 characters of raw
text. Callers are the owner (iPhone companion, web) or a **capture credential**
(`ji.` plus 43 characters): hashed at rest, owner-bound, revocable, at most five,
no expiry, and accepted only on this one route, so it can add items and read
nothing. It follows the Watch credential pattern: a transport-peer budget (30 a
second) runs in an early root hook before authentication can touch SQL, then 60
captures a minute per credential. Migration 0082 holds the hashes. The owner issues
and revokes credentials through `inbox_capture_credential` in chat (the secret is
shown once, in the owner's own chat) or the owner-only `/inbox/credentials` routes.
Raw text is structured by one low-effort call to the chat model (usage recorded under
chat); a missing, busy, invalid or over-allowance model only costs structure, the
raw text becomes the note and the owner's words are always kept verbatim. The daily
allowance is 60 calls per replica, an approximation of the [amount omitted]/day inbox ceiling
until step 8 measures cost. Idempotency: the client's key derives each note's id, the
store resolves a supplied id in the vault before writing, and a repeat answers
"Already in the inbox". The Watch path in this step is the Shortcut, which runs on
Apple Watch; a native Watch-app action is a follow-up because it cannot be compiled
or tested here.
Review follow-ups: one attempt per capture key at a time (in-process lock, and a fresh
reservation row answers 409 "already being saved"; an older one is an unknown outcome and the
vault is checked first), a capture that already landed is recovered from the vault before the
model is asked again, triage has its own 12-second deadline inside the capture's 30 so a stalled
model costs only structure, and the verbatim quote limit is 16 KB so the 4000-character contract
holds in any language (the design said 4 KB).

## 15 November 2026 — Inbox tools for chat and voice (#1855, step 4)

Three tools over the one Inbox module: `inbox_capture`, `inbox_items`, `inbox_close`,
registered only when `JARVIS_INBOX_ENABLED` is exactly `true` (default off). Capture
and close verify Dan's current stored message like `vault_write`, so mail, web or note
text can never create or close an item; reading needs only the owner or agent
principal. The note quotes Dan's message verbatim: the model may select a passage, but
it is used only when it really occurs in the message, otherwise the whole message is
quoted. The capture id is derived from the owner message id and the title, so a
retried tool call lands on the same note, and an unconfirmed earlier attempt is
reread from the vault by id before anything is written again. If the index database
is down, capture still saves to the vault. Routing guidance ("ideas and asks, not
dated tasks or facts about Dan") lives in the capability index category label and the
tool descriptions rather than as an extra positional flag through the voice and chat
instruction builders. Like the task tools, all three are sensitive and refused on phone
calls. Logs carry only the action, tool and outcome.

## 15 November 2026 — Inbox index shape (#1855, step 3)

Migration 0081 (0080 belongs to the proactive-events queue, #1862, which must merge first) adds one table, `dbo.inbox_items`: item id, path and sha (a cache so
a sync rereads only changed notes), last nudged time, and the owner's last thumb
(`up` or `down`). A row with no path is a capture reservation. The capture id
becomes the note's hidden id (derived from the client's capture key), so the vault
itself answers "did this capture land?" and a lost table cannot cause a duplicate:
a retry of an unknown outcome rereads the vault by id before writing. Rebuild lists
`Inbox/`, restores last-nudged times from proactive history where known and
otherwise sets them to the rebuild time (no nudge storm); a note written by another
tool is a new, never-nudged item. Closed notes drop out of the index. Reservations
are pruned after seven days. The down migration drops the table: it is rebuildable
and thumbs are also written to the note's trail. This replaces the design's
`capture_key` column, which would not survive a rebuild.

## 15 November 2026 — Event-driven proactive path with GPT-6.1 Terra and three tiers (#1858)

Owner: "for the model we should do gpt 6.1, that is very very cheap. so that should be very little. GO ahead and build this but without the calling to begin with." Tiers: low, medium and high; calls come later.

- **Queue**: a table in the existing Azure SQL database (`proactive_events`, migration 0080), read by the existing 30-second proactive ticker. No new Azure service. Source, kind, summary and outcome are free text; state is derived from columns, not an enum.
- **Cheap rules first, then the model**: exact checks with no model call (stale, routine success, source off, hourly cap, unchanged timer context), then one GPT-6.1 Terra call per batch of up to 10 events at low reasoning effort, with vault, memory, todo, calendar, factory and health context and recent thumbs. The model picks the tier and the words. At most 12 batches and 6 pushes a day; the monthly hard stop (default [amount omitted]) applies before every call.
- **Tiers**: low is a Now feed card that opens the finding; medium and high are a push. The call is not built: it is one more `OutreachChannel` for `high`. Quiet hours do not apply to this path (the owner's phone is on Do Not Disturb at night); the old 07:00 and 18:00 path and reminders keep theirs.
- **Never send mail**: the path has no tool and no write access; it only writes words.
- **Feedback**: thumbs up or down per outreach, stored in `proactive_outreach` and fed back as context. The Proactive page's useful and wrong buttons rate the same outreach.
- **Mail and calendar**: polled every 15 minutes through the existing read-only sources. Gmail push needs Google Pub/Sub (a new service) and calendar watch needs a public receiver with renewal, so neither is used. Health reaches the model as context, not as events.
- **GitHub**: only finished workflow runs and deployment results queue; pull request, push and check events do not (failed workflows cover builds; the timer review covers stalled repositories). *Superseded on 21 November 2026 (P1-2): releases, issues, comments, pull requests (opened, merged, review requested) and failed default-branch checks now queue; pushes still do not.*
- **Budget meter fix**: Terra was unlisted and priced at the highest listed rate (Luna), about five times too low. It is now priced at [amount omitted] input and [amount omitted] output per million tokens (Azure OpenAI list price, Global short context, checked 15 November 2026; cached-input discounts ignored). Unlisted models still fall back to the highest listed rate, which is now Terra's.
- **Switch**: `JARVIS_PROACTIVE_EVENTS_ENABLED` (Bicep `proactiveEventsEnabled`, default false) so the existing checks keep running alone until the new path is proven.
- Evidence: unit and SQL Server 2022 integration tests, listed in PLAN.md. Not observed: live traffic, push delivery, a real model call, real cost. Estimates in `docs/proactive-events/design.md` are computed, not measured.

## 15 November 2026 — Loose Ends build: Inbox store (#1855, step 1)

Owner go-ahead on the inbox loop ("go on loose ends"); build order follows #1855.
Confirmed shape: one `Inbox` module in the existing backend serves chat and voice
tools, HTTP and MCP, so safe path, redaction, size limit and idempotent create live
in one place; the private vault repo is the source of truth; no new Azure services.
Step 1 choices (reversible, within the approved design): live notes are
`Inbox/<yyyy-mm-dd> <title>.md`, closed notes sit in `Inbox/Closed/` and closing is
one atomic Git Data API commit (move plus trail line), never a delete. A note
carries no status field; its only mechanical element is the hidden
`<!-- jarvis-inbox:id -->` comment, which callers can never plant. The folder is
outside the task scope, so checkboxes in an idea never become tasks. A note is
capped at 8 KB and the verbatim quote at 4 KB. Interrupt tiers for nudges (step 7):
low is a card in the Now feed; medium and high are push; no phone call for now.


## 15 November 2026 — Watch dictation and voice on the first press (P15-160 / #1856)

Build 105 feedback: dictation hung and ended with "transcription timed out", voice
stopped with "the iPhone companion disconnected", and the voice button needed about
ten presses. Backend stage logs showed the direct Watch request spending 6.8 s before
a speech token and then producing no result until the 20 s server deadline, while the
next request through the iPhone finished in about 4 s.

Findings from the code, not yet confirmed on a device:
- The Watch gave the direct request 22 s of a 25 s deadline, so a failing direct
  attempt left the phone fallback about three seconds and the owner saw a timeout
  even though the phone path works.
- Every request stamped its clock before the body arrived, and the log allow-list
  dropped any stage it did not know, so upload time, token time and recognition time
  could not be told apart.
- The speech token was fetched from managed identity on each request.
- Voice start held the shared `busy` flag, disabled the button without feedback for up
  to 40 s, and a stale phone-side dictation answered "busy" until its 60 s watchdog.
- The Watch ended voice 3 s after WatchConnectivity reported the phone unreachable,
  and the phone ended it after the same 3 s. A short flap therefore killed the session.

Decisions:
- Cache and prewarm the speech token with the existing refresh-ahead cache used for
  Voice Live. A failed refresh is logged and retried, never hidden.
- Log `audio_received` (bytes and audio duration), `token_requested`, session start,
  speech start and end, first interim result, numeric provider error codes and the last
  stage reached when the deadline fires. Add these to the log allow-list; no audio,
  transcript, token or provider text is logged.
- Treat a stopped recognizer session with no end-of-stream event as finished after
  2 s: return the recognised text if there is any, otherwise fail honestly. This
  refines the #1812 rule that a stop alone is not success.
- The 20 s server deadline is unchanged. The Watch transcribing deadline is now 30 s.
  When the phone is reachable the direct attempt is limited to 10 s and the phone gets
  the rest; without a reachable phone the direct attempt keeps 22 s. The honest
  timeout message is unchanged.
- The phone replaces an abandoned dictation when a new one starts, and stops a leftover
  dictation when voice starts, instead of answering busy.
- Voice start no longer uses `busy`. The composer shows Starting voice or Connecting
  to iPhone with a Cancel button, and the voice button is disabled only while that row
  is visible. A quick `unavailable` or `busy` start failure is repeated up to three
  times with the same request ID. This replaces the #1810 rule of never replaying a
  start: the phone answers a repeated ID from its reply cache or reports busy while the
  first copy runs, so it cannot open a second session. Capture start is retried twice
  for a failing first audio-session activation.
- A reachability loss during a live voice session shows "Reconnecting to iPhone…". The
  Watch waits up to 10 s after its 3 s debounce and confirms with a heartbeat; the
  phone waits 15 s. Audio is not sent during the gap and the stall check is paused.
  If the iPhone does not return, the error still says the companion disconnected, or
  that voice ended on the phone while it was out of reach.
- Watch reachability, activation and start timings are logged to the unified log
  (categories WatchConnection and WatchVoice).

Open: none of this is verified on a paired Watch. The cause of the missing recognition
result on the direct path is not proven; the new stage logs are meant to show it.

## 14 November 2026 — How the cognitive lattice orb is built and where it stops (P15-143 / #1834)

- **One generator.** The orb is grown, not drawn from an image: `JarvisLatticeModel` (seed 1834, 112 nodes in a
  shell, two middle shells and a five-armed heart star, 262 connections) and `JarvisLatticeScene` (a pure per-frame pose) live in
  JarvisCore, so the app, Live Activity, widgets and Watch share them and Linux CI tests them. The web builds the
  same network from the same arithmetic; `apps/web/src/jarvis-lattice.golden.json` is the contract both test against
  (regenerate with `JARVIS_WRITE_LATTICE_GOLDEN=1 swift test --filter JarvisLatticeGoldenTests` only on purpose).
- **Contracts kept.** `JarvisOrbActivity`, `JarvisOrbState` and the wake/state/level model are unchanged apart from
  two corrections: `input` now releases at 6/s instead of snapping to 0 when listening ends (web and Swift), and
  the animator integrates a `flow` clock so faster signals never jump. The old whole-orb scale pulse was removed
  because the brief keeps the glass steady. The microphone is never touched by the orb or the opening.
- **Detail by size** (minimal below 56 pt, reduced to 120 pt, full above) keeps hubs readable at 18 pt and holds
  frame cost down; widgets, Live Activities and Reduce Motion draw one still pose. Live Activities pose the orb for
  the session phase.
- **Watch.** The owner ruled the orb applies there too ("this is app wide, everywhere"), so the wave glyph is gone:
  the orb is still in lists and the Voice Session complication and animates only in a live voice strip.
- **Opening screen.** Cold start only, enforced by one gate model per process. It ends when authentication and one
  forced Today refresh have settled (success or visible failure), or 8 seconds after authentication; no minimum
  wait. Progress is never invented: the bar is a moving segment, and a measured fill exists only for work that
  reports it (none does today). Sign-in and failure states crossfade to their own screens. The launch screen is the
  same static dark colour. Quick off switch: Settings > General > Opening screen (a local setting, default on) and
  `--no-opening` in debug.
- **Icons.** The iPhone and Watch icons and the web favicon, touch and PWA icons are composited from
  `cognitive-lattice-transparent.png` on the opening's near-black navy; the Watch version is larger for its round mask.
- **Not decided here.** Dark and tinted iOS icon variants, a measured startup progress source, and real (not synthetic)
  iPhone audio levels for the orb stay open.
- **Verification state.** See PLAN.md. Simulator rendering was captured in macOS CI; device behaviour (Face ID timing,
  Live Activity and WidgetKit rendering, VoiceOver, Reduce Motion, small screens) is not verified and needs the owner.

## 15 November 2026 — Watch steps are read on the Watch (#1859)

The owner reported the steps complication was "more than a half day behind". Cause: steps reached the complication only as an iPhone-built snapshot, requested over WatchConnectivity while the Watch app was running or on a 15-minute background refresh that needs the phone in reach, so with the phone away or asleep nothing refreshed. Decision: the Watch reads steps from its own HealthKit (`WatchStepsMonitor`: observer query, hourly background delivery, the existing 15-minute background refresh and a 60-second foreground loop), saves them into the existing shared health snapshot and reloads only the steps complication. Steps only grow within a day, so a lower Watch or iPhone count never replaces a higher one. Steps carry their own age (`stepsAt`, 20-minute freshness); a stale value stays visible with "Saved … ago", never presented as current. The widget extension does not read HealthKit itself, so only the Watch app needs the HealthKit and background-delivery entitlements. The timeline keeps its 15-minute `.after` policy. A statistics result with no quantities (access denied or no samples yet) is unavailable, never zero steps, and yesterday's count is not shown as today's. Readings only extend a snapshot the iPhone has pushed and are ignored after a phone sign-out (including queries already in flight), so they cannot repopulate the cleared cache. Paired-device behaviour (permission prompt, background delivery cadence, signing with the new capability) is unverified.

## 14 November 2026 — Inbox loop design and build plan recorded (#1836)

The design (capture, note format, tools and prompts, nudge scheduling, feedback,
cost, failure modes, privacy) is in `docs/inbox-loop/design.md`. It is a
**proposal awaiting owner review**; the 14 November decision above stands. Build
issues P15-147 to P15-157 (#1839 to #1847, #1849, #1850) are phased, each dark behind a default-off
flag. Capture is tool-agnostic: the vault is the contract, with one Inbox service behind Jarvis tools, an HTTP route and an MCP server (design section 3.1). Open owner questions are listed at the end of the design. Cost figures are
estimates until measured.

## 14 November 2026 — Inbox loop is vault-backed and model-driven (#1835)

The owner's loose ideas and asks are captured as one free-text note per item in a
vault inbox folder; the Jarvis model decides how to structure, link, nudge or bin
each one. No fixed status values or heavy schema. Jarvis keeps only a small,
rebuildable index (last nudged, thumbs up/down) and feeds due nudges into the
proactive queue. GitHub holds an item only when it becomes real work. General
principle: design model-driven by default so quality improves as models do, and
use deterministic logic only where exact results are required. Diagram in
`docs/inbox-loop/inbox-loop.png`; the design is in progress (#1836).

## 14 November 2026 — Cognitive lattice orb everywhere (#1832)

The owner selected the cognitive lattice orb as the single Jarvis orb for every
surface (iPhone, Watch, widgets, Live Activity, web, app icon), with a
procedurally rendered, animated internal network rather than a flat image. A cold
start always shows the new opening screen (orb, white "Jarvis", slim amber bar
with no caption) while fresh data loads; a warm resume skips it. Real progress
fills the bar only when measurable, otherwise a moving amber segment is used.
References and the full brief are in `docs/ui/opening-final-2026-11-14/`.
Supersedes the earlier warm orb retune.

## 14 November 2026 — Keep current priorities in p0.md (#1828)

The repository root holds `p0.md`: current Jarvis priorities only, short and
edit-friendly so the owner can refine it on the move. It is not a plan or
history; `PLAN.md` and this log keep those. A separate cross-project `p0.md`
lives in the private vault. Top priority recorded there: an inbox loop that
turns the owner's loose ideas and asks into structured items with proactive
follow-ups, plus proactive Jarvis within a [amount omitted] per month budget.

## 13 November 2026 — Follow voice captions (#1823)

Keep complete current-turn voice captions in memory and follow the newest text
in the existing bounded phone caption area rather than truncating to two lines.
Watch receives user transcription deltas as well as final text, and sends long
voice text in bounded transport chunks rather than silently truncating it.
Native rendering and paired-device behavior still need device verification.

## 13 November 2026 — Bound Watch dictation transcription (P15-131 / #1812)

Treat end-of-stream as a successful terminal recognition event instead of
waiting indefinitely for a separate stop event. A stop alone does not establish
success because a provider error can arrive later. Keep continuous recognition
for bounded recordings, but use English only. Configure the Speech
SDK's 60-second unthrottled send window so its default two-times-real-time
pacing does not itself exceed the server deadline for long clips. Bound server
transcription to 20 seconds and the Watch's transcribing state to 25 seconds;
limit direct attempts to 22 seconds to leave a short phone-fallback window.
Allow cancellation and offer keyboard recovery if the remaining time is insufficient.
Log sanitized stages and durations rather than audio, transcripts or credentials.
The existing credential scope, rate limits, audio bounds and concurrency limit
remain unchanged. Production recognition of long clips, diagnosis and
paired-Watch acceptance remain open.

## 13 November 2026 — Chat agent no longer requires a language field (hotfix)

The English-only change stopped the backend sending `language` to the hosted chat agent, but the agent still required it and answered HTTP 400 "Invalid request", so every chat turn failed while voice kept working. The agent now treats `language` as optional and defaults to English, still accepting it from older callers, including per-message history entries. Backend and agent are tested separately and the live acceptance run is manual-only, so no automated check covers this contract; a cheap backend-to-agent payload contract check is a recorded follow-up.

## 12 November 2026 — Watch voice startup and capture recovery (P15-130 / #1810)

Voice startup runs conversation-session creation, managed-identity token acquisition and optional proactive-context lookup concurrently. Prewarm the process-local Voice Live credential and refresh it before expiry; keep refresh errors visible and never log token values. Bound proactive context to 1.5 seconds and continue with fallback instructions if it fails or arrives late, because optional database context must not hold up the voice connection. The Watch shows Connecting during a 15-second companion wait and reports interruption, route change, cancellation or capture failure rather than attributing stream termination to network speed. Keep Watch dictation's separate capture state and timeout. Local regression checks do not replace paired-device and production latency acceptance.

## 12 November 2026 — Follow every chat update (#1803)

The shared iOS follow-latest modifier observes message contents and active-turn
state, including streaming text and tool outcomes, instead of only the final
assistant message ID and an incoming-content Boolean. A conditional native
`defaultScrollAnchor(.bottom, for: .sizeChanges)` keeps content above the composer as
the transcript or viewport changes size. Manual scrolling and text selection
continue to gate all automatic movement; active sending does not override them.
No new controls or user-facing copy. Native iPhone acceptance remains unverified.

## 12 November 2026 — English-only app language (P15-124 / #1799)

Remove the app-language setting and all language pickers, language-specific copy,
prompts, model/voice options and route parameters. App interface, prompts and
realtime voice configuration use English; the realtime model follows Danish or
English that the owner speaks or writes. Danish conversation and user-authored
content remain data. Ignore legacy stored language settings and use English as
the safe fallback. Set English as the Xcode development language. This supersedes
the bilingual app-copy and language-setting requirements in earlier decisions.

## 12 November 2026 — Watch record-and-transcribe dictation (#1794)

The WatchKit text-input controller opens the system-selected input method and cannot force dictation. Use bounded Watch microphone capture and the paired iPhone's authenticated backend connection for transcription only, with no assistant response or tools. Keep system text entry for offline drafts and explain connection failures. Paired-device audio, transcription and interruption behavior remain unverified.

## 12 November 2026 — Build images on the GitHub runner, not in ACR Tasks

Images are built with `docker build` on the GitHub runner and pushed to ACR;
ACR Tasks (`az acr build`) is no longer used. Reason: ACR build seconds were
about [amount omitted] on a busy deploy day, while Actions minutes are free for this
public repository and pushing an image costs only storage. Image names, tags,
build arguments and the digest lookup are unchanged. The deploy identity pushes
with its existing Contributor role on the resource group, so no new role
assignment is needed.

## 12 November 2026 — One bilingual realtime voice route (P15-110 / #1770)

Use the existing English realtime deployment (`gpt-realtime-2.1`) and shared
prompt for both English and Danish speech through `/voice`. Azure Speech
transcription uses automatic language detection; the spoken language, not a
voice-language selection, determines the response. Remove `/voice/da`, the
`jarvis-voice-mai` hosted-agent setup, Danish-only voice settings and route
pickers. Preserve Danish app localization, chat, notes and the chat-language
choice.

Stored `mai-transcribe` selections fall back to `azure-speech`; removed
`voice.da.voice` settings are ignored. Do not edit Azure resources by hand.
`jarvis-voice-mai`, its MAI Transcribe deployment and its MAI Voice deployment
become unused and need later manual cleanup. The ACS phone-call bridge requires
the hosted-agent protocol and cannot use the realtime socket as-is, so it stays
unregistered until a separate protocol bridge is implemented.

## 10 November 2026 — Integrate loading and Factory details in a child (#1715)

Retain #1704's app-wide static structure, retained refresh and context/account
safeguards alongside #1710's task order, expandable request, compact public
timeline, independent HTTP pagination and batched SSE replay. The child targets
`copilot/simplify-factory-task-page`; #1710 remains the single delivery PR.
Main's reminder fix and independent Watch/chat work are preserved.

Recovered #1710 simulator evidence shows the full Live Activity notice overlapping
task content at accessibility XXXL. Put that existing notice in the scrolling
task list, preserving text and recovery rather than hiding or truncating it.
After UI-test attachment export, check destination state, boot only if shut down
and wait before captures; cleanup skips devices already shut down. Capture
recovery must not change the recorded test failure or waive any test.

The four Today line-limit failures reproduce with identical measurements in
main run 42802233122, whose iOS/workflow sources equal integration main
`741e03782c8d887c5da6f67263b10d43f0c65af1`. Leave those independent tests
unchanged. Factory timeout/interaction failures remain unqualified until an
exact-final-head native run; source checks are not rendered acceptance.

## 10 November 2026 — Native Factory task detail (#1708)

Use the owner-requested Actions / Details / Request / Timeline / Usage / Artifacts
order. Cap Request at five rendered lines and measure real overflow. Condense
adjacent ACP transport noise and preserve exact public message chunks, error
visibility and loaded counts; keep expanded history separate from the compact
task page. Diagnostics must not expose raw ACP parameters, thoughts or tool
inputs/outputs. Removing the Disk section does not remove monitoring or alerts.

Source inspection confirms the publisher's top-level fallback produces
“acp notification” while public text is nested in
`data.params.update.content.text` for `session/update` / `agent_message_chunk`.
Production event distribution was not measured, and live task 24 was not touched.
Preserve PR #1704's task-detail structure/retention/request guards from head
`0bffc61d30ae5d66a6203684aa8f53d975e8d1c7`; the primary orchestrator owns final
main integration and release. Simulator captures and device acceptance are not
claimed from the Linux development environment.

Review follow-up (#1710, comment 5845353676): use the explicitly permitted
incomplete-history presentation rather than adding a backend latest-page API.
Oldest-first HTTP history may omit recent updates while SSE is delayed/offline;
even successful `ready` covers active SQL events only. Keep the localized
coverage warning until HTTP pagination reaches the end, preserving older pages.
Batch replay in groups of at most 100, yield between groups, and refresh task
status once at `ready`, not once for every replayed state change. Keep live
delivery immediate and retain validated short batches on connection failure.

## 10 November 2026 — Explicit timed reminders bypass quiet hours (#1706)

Supersedes the quiet-window refusal in #1239 and the all-reminder night gate in
P13-13/P14-24. A verified direct owner request can create, update or snooze a
future reminder during 22:00–07:00 Copenhagen. Existing owner/session, task,
time-range and idempotency checks remain. The runtime catalogue states this rule.

Owner schedules and vault tasks carrying the current `remindAtDue` marker are
processed at night. The marker-specific key and current vault task are checked
before a vault send; a timestamp, null alert key or source run never establishes
owner intent. Explicit sends are individual `owner_reminder` requests with a
server-only owner-request marker; automatic batches cannot inherit the exception.
The shared sender applies it before both APNs and Web Push. Unsolicited insights,
suggestions and automatic deadlines retain quiet hours and their existing gates.

Vault sends acquire a compare-and-set claim using the pending fire time, with a
two-minute lease and fenced completion. Existing terminal rows remain terminal;
no old schedules are rewritten. Recurrence keeps the existing Copenhagen
calendar semantics: nonexistent spring times skip an occurrence. Offset-qualified
owner schedules preserve either autumn instant; vault HH:mm tasks keep the
existing second-occurrence resolver. Provider acceptance remains separate from
device display, and a crash after acceptance but before persistence remains an
uncertain delivery outcome. Local qualification and SQL/device limits are recorded
in docs/agent-context.md. No deployment or live notification was performed.

## Direct owner requests — 10 November 2026

Dan directs Jarvis to execute owner-requested actions without another approval or prescribed wording, and to preserve the two sign-out dialogs. Interpret a request using the conversation; retain owner authentication, resource checks, stale-write handling, secret protection and safe treatment of untrusted content. Telephony is a separate unused integration, not browser/app voice.

## Watch startup connection feedback — 9 November 2026

An initial unreachable WCSession callback is connection status, not evidence that a send failed. Reserve interrupted-action alerts for actual active interactions. Keep passive history errors inline and discard obsolete read results. Preserve pending drafts, acknowledgement boundaries and manual recovery; do not add an offline queue or automatic resend.

## 2026-11-10 — Simplify the Watch rectangular complication

The owner approved the amber vertical-stem steps concept after rejecting small text on the Ultra 2. Show only the large daily step count, full-width cumulative chart and dashed daily-goal reference; remove all other visible labels and metrics. Preserve missing data and actual hourly coverage. Weekly workout designs are deferred. Startup reconnect recovery remains separate in PR #1692; neither change is merged or deployed by this secondary thread. The actual shared view was inspected in an isolated Ultra-family Health preview; installed watch-face rendering and physical acceptance remain unverified.

## 2026-11-10 — Watch task creation and native form inputs

The owner requests a Factory plus after project selection, typing/dictation for every free-text field, dictatable exercise and swipe/Crown reps/sets. Extend the old read-only Factory boundary for explicit task creation only, via the existing authenticated iPhone Factory client and idempotent submission contract. Replace oversized steppers with native pickers and treat valid empty health history as empty rather than disconnected. Preserve the primary's separate #1697 startup/steps integration. Secondary tests use isolated fixtures and never execute live Factory work. Implementation/CI/device acceptance are distinct; all 555 Core tests, CI, CodeQL and all three unsigned native builds passed at e4a5ab28. Four native views were inspected; selected-project visual verification and real device interaction remain open.

## 9 November 2026 — Configurable Home brief and independent daily activity

The owner requests a model-generated, evidence-grounded Home brief with an editable instruction and 1–6 visible lines (default 3). Consolidate identity, general/personality, presence-mode and Home editors in one Instructions destination while preserving separate scopes and stored values; expose the same preferences through web and existing settings tools. Home guidance must not become ordinary chat instructions.

Active kcal means merged HealthKit activeEnergyBurned, including activity outside workouts and excluding basal energy. Exercise minutes means appleExerciseTime, independently of workout count. Home and Health share these definitions across Today/7d/14d/30d in Copenhagen time. Missing readings remain unknown; explicit zero is preserved. Repeated daily sync replaces coverage rather than adding another source. Secondary implementation and qualification are tracked in PR #1689; primary owns integration/deployment and device acceptance.

## 2026-11-09 — Execute resolved owner requests directly

Dan explicitly rejected approval cards, repeated confirmation turns, prescribed
sentences and Present-mode blockers. Apply that decision across shared actions,
Google, GitHub/Factory, health, vault/workspaces, settings and browser voice.
Keep actual access checks, secret protection, revision checks and duplicate-write
protection; questions and untrusted source content do not authorize writes.
Telephone callers remain a distinct identity boundary. Legacy pending endpoints
are compatibility code, not a requirement for new owner requests. PR #1690 merged
as `70c669c9`; CI 42661574458 and CodeQL passed. Production run 42663408198
deployed backend and hosted-agent changes and passed readiness/live conversation
acceptance. Real owner use remains a separate acceptance check.

## 2026-11-09 — Owner requests do not need a second approval

The owner explicitly rejects repeated approvals and prescribed command wording.
Personal is the default unless Work is stated or an existing work item is referenced.
A time without a date means today in Copenhagen, not tomorrow. Use conversational
context for follow-ups. Keep authentication, resource permissions and write integrity.
Reminder parser removal and task defaults shipped in PR #1688. Broader direct
execution is implemented and under qualification, as recorded above.

## 9 November 2026 — Keep notification continuity inside normal chat

The owner approved direct push-to-chat continuity with the existing chat page.
Keep the finding behind the scenes, preserve the actual next owner message, and
add no duplicate push text, cards, banners or automatic sends. Typed/dictated/voice
follow-ups use one owner-scoped durable selection. Opening never authorizes a write.
A new selection replaces the previous one; repeated taps retain its identity and
24-hour lifetime. Current facts require verification against the original timestamps.
Primary owns integration/deployment; implementation, tests and owner acceptance
remain separate stages. This supersedes opening Proactive for normal insight pushes.

## 9 November 2026 — Complete Factory rollout before owner testing

The owner will leave Factory unused until the permanent managed-worker rollout
is complete. Do not add a temporary compatibility path for the outgoing image.
Release the cleaned source, build and qualify its fresh image with five concurrent
workers, then activate it before requesting owner testing. Existing Factory tasks
are disposable tests; the owner also requested removal of legacy GitHub tasks and
issues. Issue #1634 was closed as not planned and its execution label removed;
this does not assert that its separate SQL task record was deleted.

The owner reported the app-wide parallel-task limit was 3, then chose 37 to match
the accepted Azure quota. The owner is changing the setting; saving/readback is
not independently verified. Existing project limits also constrain admission and
must be checked through the owner app/tool path before claiming 37 task throughput.

## 9 November 2026 — Keep the current 300-core sandbox quota

The owner accepts 300 SandboxCores for now. The qualified persistent-root profile
uses 8 cores per worker, so the quota permits up to 37 simultaneously allocated
workers when no other regional sandboxes consume it. Stopped workers release
their core allocation. Keep live qualification at five workers, finish managed
Factory cutover and retire the dedicated VM. Do not submit another quota increase
without a new owner instruction. The design can retain its 100-worker ceiling;
800 cores and model-provider capacity would be needed to operate that full target.
Readback 42611441981 confirms limit 300 and usage 40 during the five-worker test.

## Managed Factory delivery update — 9 November 2026

The owner has authorized Azure Container Apps Sandboxes as the managed JIT
replacement and limited live qualification to **five concurrent workers**.
The production concurrency target remains 100 with 128 GiB isolated workspaces.
After managed Factory acceptance and cutover, remove the VM and all dedicated
resources, roles, runtime code and configuration. Preserve shared backend and
Foundry chat/voice services. Existing Factory test tasks need no migration.
Group provisioning succeeded in workflow 42585522896. Qualification 42589074806
identified HTTP 401 during private image import (registry/managed-identity auth).
Image import now uses a short-lived ACR token from the existing deployment login;
no registry admin account is enabled. Worker runtime identity is unchanged. Factory cutover, live acceptance and VM retirement remain pending.
The runtime implementation now adds a durable per-session sandbox assignment,
independent Blob mailboxes with rotating container-scoped user-delegation SAS,
lease-fenced allocation, progress/token forwarding and independent idle stop.
Uncertain creation is reconciled by labels rather than repeated. Disk resume
restarts a process protected by a filesystem lock; uncertain task claims remain
interrupted rather than replayed. Completed/cancelled SQL tasks release their
sandbox/disk after the worker is idle. The group retains up to 1,000 sandbox
resources separately from SQL’s configurable admission limit (up to 100); stopped bindings
skip management polling. Partial disk cleanup is retried after sandbox deletion.
This runtime code is not yet deployed or live-tested.
The separately prepared retirement change removes the VM template, quota workflow,
launcher/inspection scripts, shared-mailbox identity access and VM routing/config.
It must not be merged until managed cutover and dedicated-resource cleanup pass.
See [qualification and evidence](../factory-concurrency-correction.md).

## 8 November 2026 — Retain workout measurements when combining Home sources

Home's vault/manual/HealthKit merge must retain the primary session, date and
recorded values while filling missing duration, active energy and source IDs from
the matched source. A duplicate representation is not a reason to discard its
measurements. Retain the existing compatible-session/two-hour match window;
choose the nearest unmatched primary row once per source so metrics are neither
copied across several logs nor lost for a distinct unmatched workout. This only
changes the read projection; it does not write or migrate health/vault records.
The nested-source regression reproduces zero Today totals before the fix and all
533 Core tests pass after it. App delivery/device verification remain separate.

## 7 November 2026 — Authorize 128 GiB workspaces with automatic compute shutdown

The owner approved proceeding with 128 GiB workspaces at the discussed indicative
storage/compute pricing. This supersedes the earlier proposal-only status. The
current Factory worker is a Foundry session with 120-second idle expiry, separate
from the backend Container App configured with one minimum replica. Foundry's
current documented session budget cannot be resized to 128 GiB through the
deployment definition. A replacement worker needs verified capacity, task/control
integration, recovery, and automatic deallocation after work; stopping a container
is insufficient to establish stopped VM compute charges. No worker migration or
storage purchase is claimed yet. Keep one owner status ledger in PLAN.md and
distinguish shipped/native-verified changes from owner acceptance.

## 7 November 2026 — Select Ember for the next iOS bundle

The owner selected background 3 from the replacement PNGs: warm near-black
charcoal with restrained amber illumination. Preserve orange controls, readable
secondary text, and transparent header/footer regions. Implement alongside the
approved Notes design, while holding the next TestFlight build until the owner
finishes bundling additions. This is an accepted visual direction, not a released
change. The storage pricing discussion does not authorize or record a provisioned
worker migration.

## 7 November 2026 — Retain native evidence across a test-observation correction

Run 42396567474 passed transport/recovery and Home, but failed the first Chat
empty-editor observation. Retained native values and captures were empty/hittable;
three remote reads consumed the helper's three-second polling budget. Query
identity/value together and assert visibility separately, keeping the deadline
and every interaction assertion. No production composer change was justified by
that evidence. Run 42398644148 then passed the one affected case. Reuse the three
unchanged passes only with source/call-site identity; preserve the failed artifact.

Approval #1636 is live after 42398836350. iOS #1635 merged with the exact qualified
tree and Deploy 42399723720 passed. Build 81 upload is tracked in
`docs/ios/design/p15-build81-release.md`. Do not infer scaffold completion from
issue creation: task 23 committed code, then stopped with disk_low.

## 7 November 2026 — Deliver native stream acceptance before waiting

Flush URLSession SSE lines while the connection remains open. A 16 KB-only buffer
can hide the message ID required for safe GET recovery and discard it on failure.
Use a separate 240-second stream idle budget; keep ordinary request bounds and
never replay an unacknowledged POST. Replace the inaccurate offline claim with
separate interruption/timeout copy. Both native URLProtocol cases passed in 42396567474;
the exact owner request transport exception was not retrieved.

## 7 November 2026 — A clear coding instruction should not require a second yes

Dan explicitly requested that the approval layer be reviewed and toned down after
“Prepare the widget in Jarvis now” still asked permission. Supersede the blanket
own-code later-reply rule with a server-verified direct-request path for issue
creation and starting requested coding work. Keep discussion/plan-first requests
as proposals, and reuse existing active tasks. Natural restatements may approve
an unchanged existing proposal without special words. Unchanged boundaries include
identity/session provenance, project selection, permissions, public attachments,
archive, merge/deploy and other action families. This is a concrete Factory
correction; direct live acceptance and broader follow-up remain distinct.

## 7 November 2026 — Recover approval state before recreating work

Later model turns do not retain private tool results. Add a session-bound read of
the actual staged issue rather than relying on prose to reconstruct its code or
scope. A mistaken create retry preserves a live draft. Missing state may stage a
new own-repository replacement, explicitly requiring another later approval. This
breaks the recovery deadlock without turning a bare yes into authority for unseen
work. Retain the process-local TTL and disclose its limit. Publish this backend
correction separately so the owner can retest scaffold preparation while iOS input
and chrome verification continues. No live scaffold write is claimed by tests.

## 6 November 2026 — Diagnose request shapes without changing the managed target

After the confirmed instructions-override repair, the live provider still returned
HTTP 400 `invalid_request` without a parameter. Published limits do not establish
a further model or input-role incompatibility. Compare four fixed synthetic inputs
on the same verified target through the existing authenticated administrative
boundary. Use separate owned conversations, bounded attempts/cleanup, no tools,
owner history or claim changes, and no retries. A separately selected diagnostic
path must exit before provisioning, pinning or backend configuration.

Retain only known nested provider codes/targets and independently filter output
before logging. A regex-safe string is not sufficient proof that it contains no
private data. Diagnostic completion is evidence for investigation, never runtime
readiness; the production-policy canary and actual isolated owner conversation
remain separate acceptance checks. Do not reduce the trusted policy, change the
approved model profile or create another version merely to make a simpler probe pass.

## 6 November 2026 — Qualify the managed policy provider request

The old fixed canary omitted the message list and per-turn instructions present
in the failing real Copilot request. Share its request builder and full normal
chat instruction composition with the production policy path, retaining the
fixed synthetic input, existing bridge credential, no tool execution and owned
conversation cleanup. Require an explicit policy-request success marker during
activation, and independently revalidate content-free provider diagnostics before
printing them. This does not create an owner authorization bypass or alter claims.

#1373 retained only a live 4xx, not its exact rejected parameter. Current Microsoft
[harness documentation](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/use-tools-skills-copilot-harness)
and [limits](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/limits-quotas-regions#microsoft-copilot-harness-preview)
were reviewed on 6 November; neither establishes that per-turn instructions or
message-list input must be removed. Preserve the actual request until a new safe
provider cause identifies a concrete incompatibility. Local regressions prove the
old false-positive canary gap; a real owner turn remains required live acceptance.

## 6 November 2026 — Explicit native runtime tests and comparison refresh

The owner requested repair of the disabled web Copilot choice and equivalent
runtime testing in iOS, while keeping normal voice/chat unified. Keep experiments
in an explicitly labelled sheet with immutable runtime binding and scoped history.
Expose a specific missing-activation reason and a read-only availability retry;
never enable Copilot from UI configuration alone. Native client tests cover exact
binding, scoped history and recovery that cannot clear an uncertain managed claim.

Tool and identity revisions make the earlier exact single-version provisioner
insufficient. Add a default-off, explicitly requested comparison-definition refresh:
reuse one exact manifest match or create one immutable version, preserve earlier
versions, verify identity/pin/readback/fingerprint, then run the existing canary.
No automatic retry follows an uncertain write; a subsequent reviewed invocation
can discover and reuse its unique exact match. Reject ambiguous/unowned inventory.
No new credential, grant, default-runtime change or claim reset is authorized by
this implementation. The user has authorized this scoped release; the coordinator
owns backend/agent-before-TestFlight deployment and live acceptance. Local fixture
evidence does not establish live managed inference or native device behavior.

## 5 November 2026 — Notes and Home widgets (P15-89 / #1593)

- Six more widgets (small, medium, large for Notes and for Home) join the Gym and Factory ones in the `JarvisWidgets` extension. No buttons, no control items; a tap opens the matching app page through `widgetURL` (`jarvis-widget://notes` or `home`, handled by `onOpenURL` in `ContentView` via `JarvisWidgetLink`).
- Snapshot: `JarvisWidgetSnapshot` gains `notes` (today's open tasks with title and time or date, latest notes with title and edited time) and `home` (approvals needed, runs in progress). Version stays 1: a custom decoder reads missing sections as loading, so older snapshots still decode. Home also draws the Gym, Factory and Notes sections already in the snapshot for its tiles and rows; its timeline schedules a stale entry for each of them.
- The publisher adds no new endpoint: tasks and notes are read through the same cached repositories (`.tasks`/`open`, `.notes`/`home`) as the Home page, and Home is derived from the Factory numbers (approvals = awaiting, running = running).
- The Home orb is `JarvisWidgetOrb`, a static SwiftUI copy of the shared orb look (dark glass, cyan rim, orange tangled centre), because the widget target cannot compile the app's `JarvisOrb` without a `project.yml` change (that file belongs to #1591). `JarvisDesignSystemGuardTests` allows it by file name. Switch to the shared orb once the target compiles it.
- Loading draws a static skeleton for the new widgets. Stale data is dimmed with an "Updated HH:mm" line. Strings are in `JarvisWidgetCopy` (da and en, same placeholders).
- Not verified here: no Xcode, so the widget views, previews and publisher are compiled by CI only; JarvisCore `swift test` covers the snapshot, builders, phrases, timeline and links.

## 5 November 2026 — Widgets embedded again (P15-88 / #1591)

The owner added the existing App Group to the `.widgets` App ID in the Apple developer portal, so the extension can be signed. Decision: embed `JarvisWidgets` in the Jarvis app again and remove the temporary skip from P15-87 (Refs #1589). The iOS CI check now asserts the embed. Widget sources and user-facing strings are unchanged.

## 1 November 2026 — iOS preview builds and release train (P15-50 / #1502)

Allow a write-authorized manual TestFlight dispatch from an intended PR branch
as well as `main`, with an explicit branch input validated against the selected
workflow ref. Keep all signing and app configuration in the protected
`ios-testflight` environment. Non-main uploads are marked as previews in the
workflow build notes and never create release tags; the existing main upload
path remains unchanged.

Keep JarvisCore build/tests, the iOS Simulator build, Python/source-contract
tests and CodeQL blocking. PR XCUITests still run and upload screenshots, but
their failure is reported in the existing PR comment rather than failing the
aggregate `CI result` gate. Run the suite nightly on `main`; a failure opens or
updates one tracking issue. Release cadence is one build per 15-minute test
window, shipping at the window boundary even when work is partly done, with
preview builds before merge.

## 1 November 2026 — main merge and bilingual calendar approval evidence (P15-46 / #1494)

Merge current main rather than rewriting branch history. Preserve #1493 Chat
Markdown/HTML behavior, #1500 bell controls, all existing screenshot steps and
both conflicting decision entries. The resulting `39a8cc87` merge has two
parents; merged approval regressions passed locally.

The owner requested Danish/English calendar Approve/Decline screenshots. Reuse
the existing in-app confirmation sheet, approval localization resources,
Simulator fixture transport and ready-PR iOS screenshot artifact. Synthetic
review data is not evidence of a live calendar write; fixture actions stay
disabled and real writes retain the existing approval gate. Calendar
confirmations use SwiftUI's native large sheet detent so review and controls
have room; other activity sheets retain their existing detents.

Before this native follow-up, read these Apple sources through the browser:

- [SwiftUI Button](https://developer.apple.com/documentation/swiftui/button)
- [HIG: Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)
- [presentationDetents(_:)](https://developer.apple.com/documentation/swiftui/view/presentationdetents(_:))
- [XCTAttachment.init(screenshot:)](https://developer.apple.com/documentation/xctest/xctattachment/init(screenshot:))

Follow their standard action/label, system style, accessibility, touch-target,
sheet sizing and screenshot-attachment APIs. No custom approval control or
system notification action is added, and no deliberate platform deviation is
identified. Browser retrieval worked despite the direct-fetch hostname failures
recorded below. These sources support this follow-up, not a claim of source
review before the original implementation. Mac CI rendering/capture remains
unverified locally.

## 1 November 2026 — Apple documentation requirement and P15-46 review

The owner requires relevant Apple API documentation and HIG review before iOS
implementation, platform behavior where available, and a PR source/deviation
list. The P15-46 native diff changes only approval JSON validation limits and
tests, retaining Foundation `JSONDecoder`/`Codable` and the existing authenticated
transport. It introduces no custom navigation, gestures, sheets, capture or
Live Activity behavior. No deliberate platform deviation was identified in this
diff; the approval count and string-size limits are application/server contracts.

Relevant sources for review:

- [JSONDecoder](https://developer.apple.com/documentation/foundation/jsondecoder)
- [Encoding and Decoding Custom Types](https://developer.apple.com/documentation/foundation/archives_and_serialization/encoding_and_decoding_custom_types)
- [URLSession](https://developer.apple.com/documentation/foundation/urlsession)
- [HIG: Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts)

These links were attempted during the review follow-up, not read before the
original implementation. Direct retrieval failed with hostname resolution
errors, and the first web search returned no usable results. Source review
remains unverified; these references were not relied on before implementation.

The status-check follow-up also attempted
[Declaring Your Actionable Notification Types](https://developer.apple.com/documentation/usernotifications/declaring-your-actionable-notification-types)
and [HIG: Notifications](https://developer.apple.com/design/human-interface-guidelines/notifications).
Direct retrieval still failed. Search returned a cited HIG Notifications excerpt
about offering simple tasks through notification actions; this is secondary
search evidence, not a full Apple-page review. P15-46 reuses in-app approval
controls and changes only native feed decoding limits. It does not add system
notifications, notification categories or `UNUserNotificationCenter` actions.
No new native behavior or deliberate platform deviation is introduced by this
documentation follow-up; full Apple source review remains outstanding.

## 1 November 2026 — bind offers to existing approvals (P15-46 / #1494)

The calendar claim guard excluded questions, so an actionable conversational
offer could finish without a staging receipt. Calendar staging was also absent
from the browser approval feed. Require staging in shared instructions and give
unstaged hosted calendar offers one bounded corrective round. Do not parse prose
into write arguments or treat the initiating instruction as later approval.

Expose the same staged calendar action to the existing owner-only tap endpoint
using an opaque browser ID, not its conversational code. Both paths consume once;
partial/unknown outcomes remain visible and are never automatically replayed.
Register shared module services on the common Fastify ancestor so sibling routes
see the same instance. No migration, dependency, authorization relaxation or
deployment is included. Offline checks are not live model/device acceptance.

## 1 November 2026 — lock-independent tasks and task activities (P15-49 / #1498)

A persisted background job owns its execution, not its request, progress window
or observing SSE connection. Research already detached its runner, but required
the initial Workspace acknowledgement before starting it; losing that client
incorrectly failed the persisted job. Make initial progress delivery optional,
preserve validation and explicit cancellation, and recover from durable state.
Tracked weather uses the same rule while retaining its synchronous forecast
response. Persist the report and Workspace-item link before optional display;
use the existing result-open route for recovery. Migration 0072 extends result
references to `html_app` jobs and refuses destructive rollback when links exist.

Start task activities automatically for Factory and background jobs. Keep waiting
state and briefly retain real terminal state; never infer completion from a
running-only feed. Use existing WidgetKit surfaces for task Dynamic Island content,
localized settings recovery and explicit stale-state feedback. Only actual
confirmations expose approval actions. Add owner-only SQL token registration and
APNs task update/end delivery with a protected provider key and explicit environment;
do not introduce push-to-start, deploy credentials or claim live delivery here.
The plist flag and embedded extension existed; APNs entitlement and delivery
plumbing did not. Apple compilation, signing, locked-phone rendering and delivery
remain separate acceptance evidence.

The review follow-up uses Apple's `BGTaskScheduler` for short, discretionary
reconciliation of existing activities, with launch registration, permitted
identifier, fetch mode, bounded requests and exactly-once completion on expiry.
This cannot guarantee execution or update timing. Keep server-owned execution
and ActivityKit pushes as the lock-safe mechanism; do not put an SSE data stream
in background URLSession, which Apple provides for file transfers.
Apple references: [background strategies](https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app),
[BGTaskScheduler](https://developer.apple.com/documentation/backgroundtasks/bgtaskscheduler),
[background file transfers](https://developer.apple.com/documentation/foundation/downloading-files-in-the-background)
and [ActivityKit push notifications](https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications).

## 1 November 2026 — native Chat Markdown, tool alignment and HTML apps (P15-45 / #1492)

Render Jarvis chat replies with SwiftUI Markdown while keeping user messages as
plain text; tool rows remain unboxed and use the assistant column's leading edge.
Use the existing generated-view event, artifact model and owner-authenticated HTML
route for HTML apps. Render only validated artifacts in a nonpersistent WKWebView
with a restrictive CSP, no file access, and no JavaScript bridge to app data. Keep
the web-only `window.jarvis` actions unavailable on iOS rather than expanding the
native permission surface for this issue. Add simulator UI verification and named
calendar-answer screenshots to the existing ready-PR iOS job, without another
simulator boot.

## 1 November 2026 — approval flow polish and APNs delivery (P15-51 / #1504)

Approval controls keep progress local to the selected decision, render only
Approve and Decline directly above Now, and use the shared orange/stone treatment
and Danish/English copy. Request the standard notification permission after sign-in
and device unlock, before an approval exists. Send one APNs alert when a core
confirmation is persisted or a calendar proposal is staged; do not create a
local copy or a duplicate plain push. Keep task Live Activities separate.

Use an actionable notification category for approval actions rather than an
approval Live Activity. This follows Apple's actionable-notification and remote
notification guidance, with ActivityKit push documentation reviewed for the
separate task activity: [Declaring Your Actionable Notification Types](https://developer.apple.com/documentation/usernotifications/declaring-your-actionable-notification-types),
[Generating a Remote Notification](https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification),
and [Starting and Updating Live Activities with ActivityKit Push Notifications](https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications).
The direct Apple page fetch was unavailable in this environment; web search
provided the official documentation references. The explicit deviation is no
approval Live Activity and no second push to remove an alert resolved on another
device; stale alerts are rejected by the existing endpoint and removed on refresh.
Delivery is best-effort, opt-in and requires protected APNs configuration.
Mac compilation, rendered UI, and physical-device delivery remain unverified.

## 1 November 2026 — Combined iOS screenshot job timeout

Keep the one-boot simulator workflow and all screenshot/upload steps, with a
30-minute job limit instead of 20. Run `41261737993` completed its build,
captures, upload, and comment, but was marked cancelled at the 20-minute limit
after adding the sidebar coverage alongside Health. The extra bounded time
allows the complete evidence set and cleanup without reducing coverage.

## 1 November 2026 — P15-41 sidebar input recovery (#1484)

Concurrent dispatcher handover (`622dc0f`, superseded by the reconciliation below):
that implementation moved the drawer to `JarvisSidebarDrawerLayer`, a
`zIndex(1)` root layer driven by `JarvisNavigationModel`, and removed it from
ContentView. Voice restore/minimize and fixture side effects used
`onChange(of: navigation.currentDestination)`. Reading the code found no single
proven cause: the drawer had been
inside the content subtree that the gate blurs and hit-test-disables, and a toolbar
action reaches it only through the shared model. Its temporary English debug badge
showed an open flag, count of open requests and last three changed-state writes
with call-site tags. Those fields and the duplicate wrapper/badge are superseded;
they were not native recovery evidence. Focused CI still runs only `SidebarNavigationTests`
(Danish/English). Apple references: [ZStack](https://developer.apple.com/documentation/swiftui/zstack),
[zIndex](https://developer.apple.com/documentation/swiftui/view/zindex(_:)),
[EnvironmentObject](https://developer.apple.com/documentation/swiftui/environmentobject),
[onChange](https://developer.apple.com/documentation/swiftui/view/onchange(of:initial:_:)),
[ToolbarItem](https://developer.apple.com/documentation/swiftui/toolbaritem) and
[HIG Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars).
Native/device behavior is unverified (no Xcode here).

Comment 6562637427 tests a layering hypothesis after preview build 23 (cad7cd0)
reportedly still fails to open visibly. Move the conditional drawer/dim layer to
the gate root's last ZStack child at zIndex(1000), outside ContentView and content
modifiers. Keep authentication/privacy windows and omit the drawer when covered;
zIndex cannot elevate app content over a separate UIWindow.
Temporarily show a screenshot-readable bottom badge in device releases with
button-only tap count, sidebar Boolean, last static caller tag and last three
before/after write requests, including no-ops. No private content is logged.
Remove badge/recording before merge. Root layering is an authorized experiment,
not verified recovery. References: [ZStack](https://developer.apple.com/documentation/swiftui/zstack),
[zIndex](https://developer.apple.com/documentation/swiftui/view/zindex(_:)) and
[UIWindow.windowLevel](https://developer.apple.com/documentation/uikit/uiwindow/windowlevel).
Indexed excerpts were consulted; direct Apple retrieval remains unavailable.

Reconciliation preserves `226a1ae` and `622dc0f` in branch history while retaining
one drawer/badge implementation. The drawer is outside content modifiers,
omitted when `shouldCoverContent` is true, and remains below the unchanged
alert+1 privacy UIWindow. The badge is above the drawer and hidden from
accessibility outside the existing simulator navigation-test fixture.
Static caller enums replace file/line strings; every request, including no-op
path binding and reset requests, enters the bounded three-entry trace. Only the
actual menu Button uses the counted `menu` tag. A synchronous model navigation
event preserves ContentView-owned side effects even when Voice is selected
again; root theme preference and UIKit-window geometry refresh cover the
drawer's sibling placement. Native/device recovery remains unverified.

Comment 6562578040 separates Chat's bell/menu into individual trailing ToolbarItems
with a fixed [ToolbarSpacer](https://developer.apple.com/documentation/swiftui/toolbarspacer).
The sidebar launcher is outermost at the far right; the bell is to its left.
Bilingual sidebar UI tests assert separated frames in that order. Native visual
verification remains pending; no custom glass fill is added.

Comment 6562283849 selects SF Symbol `sidebar.trailing` for the shared sidebar
launcher on Chat, Health, Notes and Factory. Preserve its no-fill styling,
44-point target, accessibility identifier and Danish/English labels.
References: [Apple SF Symbols](https://developer.apple.com/sf-symbols/) and
[HIG Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars).

Comment 6562281755 replaces further bisecting after preview build 22 reportedly
keeps the menu visible but does not open. One reference navigation model is owned
above ContentView and injected through SwiftUI's environment; menu controls invoke
its open method directly. A conditional topmost dim layer and trailing drawer
replace foreground offsets/blur and drag-generation machinery. The separate edge
gesture commits only on completion. Delete bisect tests/probes and run the new
bilingual visible-drawer test class alone in CI as requested; this focused gate
does not establish broader controls/voice acceptance. Preserve ios-testflight.yml
for the owner's revert. Device recovery and native execution remain unverified.
Relevant platform references are [EnvironmentObject](https://developer.apple.com/documentation/swiftui/environmentobject),
[StateObject](https://developer.apple.com/documentation/swiftui/stateobject),
and [transition](https://developer.apple.com/documentation/swiftui/view/transition(_:)).
Use these APIs rather than a custom state observer; the right-side drawer remains
an explicit owner-approved deviation from leading/system split-view navigation.

Owner correction: Chat's menu belongs at the top right beside the bell, matching
the right-side drawer. Use native `ToolbarItemGroup(placement: .topBarTrailing)`,
keeping both labels, the 44-point target and plain no-extra-fill style.
[Apple ToolbarItemGroup](https://developer.apple.com/documentation/swiftui/toolbaritemgroup)
and [topBarTrailing](https://developer.apple.com/documentation/swiftui/toolbaritemplacement/topbartrailing)
were reviewed through indexed guidance; no custom toolbar layout is introduced.
Run 41333021582 still fails navigation; all four root counters pass, with no
alerts/sheets reported. Add an independently observed button-only action counter
and expose write histories in every variant. This evidence is not a confirmed
root-cause fix; native five-second placement/reliability results remain pending.

The missing-button hypothesis describes main, not this PR: 8488515 added Chat's
real toolbar Button; G CI logs report its existence and executed open writes.
Available `git log -S` main history has no Chat launcher removal. Add matching
no-fill, localized 44-point launchers to Notes/Health/Factory custom headers,
passing the same committed open callback; this gap is not the demonstrated
first-Chat-tap stale-render failure. Reuse SwiftUI Button and the existing plain
toolbar style. [Apple Button](https://developer.apple.com/documentation/swiftui/button)
and [HIG Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)
are the applicable platform references; direct Apple fetch fails DNS here,
so native/browser verification remains unavailable locally. No custom gesture
replacement or new fill is introduced.

Round-three diagnostic scope (owner-authorized): temporarily filter the initial
scheme test to NavigationBisectTests and restore it before final delivery.
Run 41327428995's G Danish/English histories include menu writes false→true while
render probes remain closed, contrary to the reported init-only result. No root
cause is confirmed. Compare root counters inside/outside the gate, bounded native
presentation/window metadata, AX modal candidates and system-alert interruption
handling without bypassing authentication/privacy protection.
Apple references: [XCTest interruption monitor](https://developer.apple.com/documentation/xctest/xctestcase/adduiinterruptionmonitor(withdescription:handler:))
and [SwiftUI disabled](https://developer.apple.com/documentation/swiftui/view/disabled(_:)).
Indexed guidance consulted; direct native execution is unavailable on Linux.
XCTest interactions trigger the monitor; only known permission dismissal buttons
are handled. No custom replacement for a platform presentation API is introduced.

The product owner requires Apple API documentation and HIG review before every
iOS implementation, platform APIs over hand-rolled equivalents, and a PR list of
consulted pages and justified deviations. Record this contributor-wide requirement
in `docs/agent-context.md` under iOS Phase 1c. This PR's review is retrospective
and limited to indexed Apple guidance because direct page access failed; it does
not establish full-page review before the earlier commits. The same section lists
references and the retained right-side drawer, test-only coordinate tapping, and
offline fixture exceptions with their reasons.

Remove the animation observer's asynchronous progress feedback: its `0.001`
update tolerance can leave positive reveal progress while the closed drawer's
tap catcher still intercepts input. Settled progress and accessibility derive
from navigation's open flag; only the live drag is transient. Gesture
cancellation needs no separate saved start value, and commands invalidate
in-flight drags. Keep the existing reveal design and animation, isolate the
opening gesture to the right edge, and add the requested localized Chat menu
launcher, which was absent from this revision.

Gate the existing Mac iOS job on repeated XCUITest sequences in both languages,
retaining the result bundle even on failure. Offline simulator fixtures cover
navigation, sheets, keyboard input, and full-screen/minimized voice controls;
they do not prove microphone transport or device behavior. Linux checks are
not UI reproduction. Baseline build-18 and after-fix simulator results remain
pending until macOS execution; do not treat cycle screenshots as baseline evidence.

Run [41286956749](https://github.com/DanAakesen/jarvis/actions/runs/41286956749)
subsequently compiled both native targets but all three tests failed at the
launcher's initial `isHittable` precondition, before any tap or repeated cycle.
Its retained video shows Chat, while toolbar snapshots include both valid button
frames and invalid window geometry. Do not infer a physical navigation failure
from this precondition alone, or mask one by increasing the timeout. Use an
enabled, finite, onscreen native-toolbar frame for a physical center tap and
continue requiring the actual sidebar/sheet transition. Preserve edge-swipe,
bottom-control and repeated-cycle checks. The test-only correction adds explicit
failure screenshot/hierarchy evidence; physical input remains unverified until
the revised simulator sequence runs.

Run [41291487261](https://github.com/DanAakesen/jarvis/actions/runs/41291487261)
fails at the initial Chat input check, before any sidebar action. Its retained
Danish accessibility hierarchy contains a second full-screen login-failure gate
window over Chat; English and interruption launches log unbalanced appearance
transitions for the gate's hosting controller. These do not establish a residual
sidebar blocker. Initialize simulator navigation fixtures unlocked before first
render, without real authentication clients, rather than creating and immediately
removing a loading window. Preserve background privacy covers and device
authorization. Disable dismissed window input before hiding it and explicitly
synchronize the overlay after gate loading. The single-window failures still
require a fresh simulator run; this candidate fix is not device acceptance.

Run [41294736529](https://github.com/DanAakesen/jarvis/actions/runs/41294736529)
still fails at launch. Its English/interruption hierarchies show one window, no
keyboard, and an enabled input at `{{104,796},{83.3,22}}`; the Now bar ends above
it. PR #1491 run 41294540199 also fails composer hittability. Neither observation
proves a Now-bar overlap. The closed sidebar and decorative ellipses remain in
the accessibility tree: establish `.contain` boundaries before ancestor hiding
modifiers so child hiding is preserved. Explicitly gate navigation-host input on
the sidebar Boolean, exclude composer glass from hit testing, and stop opting
the live navigation shell out of keyboard safe-area handling. Preserve visuals,
copy, mounted navigation identity, and all test assertions.

Accessibility snapshots do not identify the UIKit hit recipient. A simulator-only
navigation-fixture probe therefore logs native hit ancestry, input bounds,
clipping and interaction flags, never message text, with bounded output. Retain
the complete failing XCUITest hierarchy in both logs and result attachments.
These boundary corrections need native verification; do not call the shared
touch-blocking root cause established until the simulator evidence supports it.

Run [41298280795](https://github.com/DanAakesen/jarvis/actions/runs/41298280795)
passes the English/short-drag launch-input checks. Danish still shows a login
failure window over unconfigured Chat; after the English menu tap Chat remains
unshifted and the closed-state edge strip is present, with no sidebar row buttons.
The short-drag failure leaves Chat and its
keyboard visible after the opening swipe. Do not attribute these to translated
labels or close-animation timing: the English failure is the first menu tap.
Remove `.onEnded`'s dependency on `@GestureState`: Apple documents automatic
reset when gestures end or become inactive. Commit the final drag value using
captured committed state and generation, validate the start policy, and replace
recognizers on navigation commands. Add the sidebar's own `.contain` boundary
before hiding/action modifiers. Ignore unchanged navigation-path binding writes
so SwiftUI synchronization cannot close a drawer without a navigation change.
Log simulator gate fixture selection and fixture sidebar commands, without
arguments, credentials or content, to distinguish startup from command delivery.
Keep every UI test action, timeout and assertion.
Indexed GestureState, updating/onEnded and accessibility-container guidance was
reviewed before these edits; direct Apple retrieval remains blocked.
The Danish startup path and missing-row fix still require native evidence.

Run [41304146202](https://github.com/DanAakesen/jarvis/actions/runs/41304146202)
passes both launch-input checks and all three short-drag/background cycles.
Both language repetition tests fail the first menu tap; their printed trees
show Chat unshifted, the closed edge strip present, and no sidebar rows.
The plain menu label only expands its frame, unlike the bell's explicit hit
shape. Define `contentShape(Rectangle())` inside that existing 44-point label
to make the whole target interactive without changing visuals or routing.
Indexed Apple Button and ContentShapeKinds.interaction guidance was reviewed
before editing; direct Apple retrieval remains DNS-blocked. This is a targeted
hit-region correction, not proof that the complete native flow now passes.
Retain `ios-scheme.xcresult` from the earlier full-scheme invocation: its failure
currently stops the screenshot step before the dedicated navigation bundle is
created. Keep both test invocations and every UI assertion and timeout intact.
Build-18 before/after and physical-iPhone acceptance remain outstanding.

Run [41308630589](https://github.com/DanAakesen/jarvis/actions/runs/41308630589)
still fails the first menu tap in each language; interruption recovery passes.
The retained full-scheme app console reports `navigationFixture=true` and
`sidebar=false requested=true` for both failing launches, with no subsequent
close command. The hit-shape correction did not resolve the failure.
Navigation was read only inside the deferred GeometryReader content, not during
the owning view's body evaluation. Read it once in `ContentView.body` before
creating that closure, and use this per-evaluation snapshot for reveal, hit
testing and accessibility. This registers the render dependency without a new
state owner, copied persistent state, navigation-host identity reset or test
workaround. Indexed Apple State/GeometryReader guidance was consulted; direct
retrieval remains blocked. Native confirmation of this correction is pending.

The dispatcher requires a committed-state-only tap-catcher. Remove its remaining
active-drag/progress fallback: a closed drawer has no full-screen close surface.
Use `withAnimation` on committed sidebar commands instead of the implicit shell
animation. Keep `@GestureState` automatic cancellation reset, existing visual
tokens and all UI tests; add no diagnostics. Indexed Apple GestureState,
updating and withAnimation guidance was reviewed; native acceptance is pending.

Run 41313041566 records first-menu open commands in both failing launches,
unshifted Chat, no covering gate window, and startup AttributeGraph cycles.
Capture navigation, live drag and generation before deferred geometry, and
derive reveal from committed state plus translation without stored start
progress. This targets stale shell evaluation, not test timing; causality and
native recovery are not yet confirmed. No UI test or diagnostics are changed.

The dispatcher authorizes a temporary simulator-fixture CI bisect instead of
waiting for debugger access. A–F separately test baseline, no edge gesture,
no tap-catcher, no animation, window-sized plain shell and an outside-toolbar
launcher. Each has an independent Danish/English test; render and gate probes
are visually transparent, accessible to automation and noninteractive. Preserve
the production gates and strict regression tests. A passing variant is isolation
evidence, not sufficient device acceptance; remove variants after confirming
the culprit and retaining the fix.

Round-one A–F probes remain closed, with root input available. The closed
drawer's `sidebarDisabled` describes its expected hit-testing gate, not the
toolbar button's enabled state. Round two separately reports launcher enablement
and bounded tagged navigation writes, then isolates decoration, the legacy input
probe/gate modifier and navigation effects. Independent J launches compare
element versus coordinate taps; neither establishes VoiceOver activation.
Native winning-variant selection and cleanup remain pending.

Comment 6561353007 separates shell lifetime from session data lifetime. Sign-in
keeps ContentView and its navigation host/state installed; only session-owned
screen content resets, while workspace state/streams and prior voice resources
are explicitly cleared. Retain the full shell reset only for real sign-out, with
the privacy gate covering content before teardown. Do not inject the interactive
Microsoft provider into background content: existing clients read the current
Keychain session on each request, verified by a retained-client sign-in/revocation
regression. Apple [StateObject](https://developer.apple.com/documentation/swiftui/stateobject)
and [id(_:)](https://developer.apple.com/documentation/swiftui/view/id(_:))
documentation were read through the browser. Launch logs/probes distinguish
initializer evaluations from actual installed StateObject markers without
publishing diagnostic changes during initialization. The five-second bilingual
menu tests add strict hittability and real-sidebar assertions; existing waits
and assertions remain. G's epoch-zero stale render is not attributed to session
resets, and native acceptance remains pending.

## 1 November 2026 — native Voice restart and stationary orb (P15-40; #1482)

Follow-up after ambient main (#1479): preserve the tangle's geometry while
expanding its Canvas for blur margins, feather the entire centre to zero alpha
before its bounds, and animate opacity rather than rectangular-layer brightness.
The screenshot artifact pairs all three Voice states in both themes with the
approved board. Fresh pixel inspection remains required before visual acceptance.
Run 41264871752 compiled the app successfully but timed out during the combined
capture at the 20-minute job limit. Increase that existing job's bound to 30
minutes without dropping upstream captures or adding another Mac job.

Build-14 feedback requires fresh Voice to connect after End without Refresh.
Invalidate the screen generation before teardown, close the old transport,
release capture/playback and activate a fresh audio session before reading its
input format. Reopening the screen auto-starts from ended as well as idle/failed.
Use the approved board's red End fill and the existing shared cyan-rimmed,
dark-glass orb with an orange/amber tangled centre; animate the centre, not the
sphere, with Reduced Motion and inactive-scene pauses. Keep all Voice copy in
Danish/English resources. Extend the existing ready-PR simulator capture rather
than adding another Mac job. Synthetic screenshots, Apple compilation and live
device acceptance remain separate checks; none is established by Linux tests.
## 1 November 2026 — approval expiry grammar and #1501 synchronization (P15-46)

Merge main `32af478` in `c84e6bc` with both parents and decision-log entries
intact. Retain task Live Activity/lock fixes and all calendar screenshot steps.
The lock-screen preview inserted `RelativeDateTimeFormatter` output into
`Expires at %@` / `Udløber kl. %@`, producing mixed absolute/relative grammar.
Use `Date.FormatStyle` hour/minute with the selected app locale, matching
the existing real notification. Keep both templates and authorization unchanged.

Before the correction, read
[RelativeDateTimeFormatter](https://developer.apple.com/documentation/foundation/relativedatetimeformatter)
and [Date.FormatStyle](https://developer.apple.com/documentation/foundation/date/formatstyle)
through the browser. Apple warns that relative phrases are standalone strings
and embedding them can be ungrammatical; Date.FormatStyle supports localized
absolute date/time components. No deliberate platform deviation or custom
formatter is introduced. New local regressions pass; Mac rendering and live
acceptance remain unverified.
## 1 November 2026 — screen sharing start and Needs you cleanup (P15-53, #1514)

Share screen no longer opens a dead sheet. The Chat and Voice screens host a
hidden `RPSystemBroadcastPickerView` for `com.danaakesen.jarvis.broadcast` and
trigger its system Start Broadcast sheet on tap; the system view exposes no
programmatic API, so the app sends `touchUpInside` to its inner button (a
documented-by-practice deviation). A pure `ScreenShareSession` in JarvisCore
reports starting, live, stopped and failed from the extension's heartbeat
(20 s start timeout), and reports an installed-extension check failure plainly
instead of presenting a sheet. Chat shows the state in the composer.

"Needs you" now lists only approvals, activity items and failed research jobs
(retryable). Finished routine jobs (proactive checks, images, apps) never
appear; other failures (such as the weather forecast) form one collapsed,
dismissible "Other failed checks" group, dismissed through the existing
`POST /jobs/:id/dismiss`. Background activity still lists every job. New
strings are in Danish and English. Linux tests cover the state machine, job
grouping, dismissal route and localization; Apple-target compilation and
on-device broadcast acceptance remain unverified.

Apple docs read: RPSystemBroadcastPickerView, ReplayKit broadcasting,
Human Interface Guidelines (Alerts, Disclosure controls, Feedback), SwiftUI
DisclosureGroup and UIViewRepresentable.

## 1 November 2026 — Chat polish batch (P15-52, #1506)

Replaces #1486, #1490 and #1496. Composer and header follow `docs/ios/design/board.html`.

- **Composer:** two-row glass card with the input on the first line and plain 44 pt
  icon buttons below (plus menu, Voice, Send/Stop). Only Send has a small orange
  disc (34 pt) when enabled; secondary controls use the stone accent. The `.bar`
  material behind the composer and Now bar is removed. The mode segmented control
  is now a single Voice button (`chat.mode`).
- **Header:** no toolbar background or divider; the list uses
  `scrollEdgeEffectStyle(.soft)` so messages fade under the header and composer.
- **Send root cause:** the Dan message was inserted only when the server's `user`
  event arrived, and the list scrolled to the bottom anchor in the same update
  (skipped entirely with Reduce Motion). The model now inserts an optimistic row
  and clears the draft at once, replaces it with the server row, and restores the
  draft if the server never acknowledged it. The scroll runs after layout and
  also on the last message id, sending state and streaming text.
- **Plus menu:** native SwiftUI `Menu` anchored to the plus button (replaces the
  popover). Native menus cannot be opened programmatically, so the
  `--screenshot-chat-plus-menu` capture now shows the closed composer.
- **Camera and video:** `AVCaptureDevice.DiscoverySession` lists only the lenses
  the device has (ultra-wide, wide, telephoto) for the front or back camera. The
  flip button and lens menu appear in the photo sheet and on the video tile; the
  last choice is kept in memory for the app session. Video is a 132×176 tile
  above the composer with stop, flip and lens controls.
- **Tests:** `ChatComposerUITests` (send bubble visible, menu near the button,
  camera sheet) runs with `SidebarNavigationTests` in iOS CI. The camera sheet
  test uses `--ui-test-camera-sheet` because the simulator has no camera.

Apple documents used: Human Interface Guidelines for
[Menus](https://developer.apple.com/design/human-interface-guidelines/menus),
[Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars),
[Text fields](https://developer.apple.com/design/human-interface-guidelines/text-fields)
and [Layout](https://developer.apple.com/design/human-interface-guidelines/layout);
SwiftUI [Menu](https://developer.apple.com/documentation/swiftui/menu),
[scrollEdgeEffectStyle](https://developer.apple.com/documentation/swiftui/view/scrolledgeeffectstyle(_:for:)),
[ScrollViewProxy](https://developer.apple.com/documentation/swiftui/scrollviewproxy);
AVFoundation [AVCaptureDevice.DiscoverySession](https://developer.apple.com/documentation/avfoundation/avcapturedevice/discoverysession)
and [AVCaptureSession](https://developer.apple.com/documentation/avfoundation/avcapturesession).
Deviations: the Send disc is the only filled control; lens labels use the
0.5×/1×/2× shorthand on the button with full names in the menu. Nothing was
compiled or run here (no Xcode on this runner); Mac CI and device acceptance
remain pending.

### P15-52 follow-up — Dan's device checklist (build 28)

- **Composer:** two rows only. Row one is the text field. Row two is plus, Dictate and
  one trailing slot: Voice (stone disc) while the field is empty, Send (small orange
  disc) once there is text, Stop while Jarvis answers. Same slot and size; no mode
  toggle. Identifiers: `chat.mode` (voice), `chat.send`, `chat.stop`, `chat.dictate`.
- **Dictate:** `ChatDictation` uses `SFSpeechRecognizer` (on-device when supported) with
  `AVAudioEngine`; `NSSpeechRecognitionUsageDescription` added to Info.plist.
- **Attach:** Files and Photo library are items of an Attach submenu inside the native
  plus menu; the separate confirmation dialog that jumped is gone.
- **Camera:** sheet adds flash (auto/on/off via `AVCapturePhotoSettings.flashMode`) and a
  Photo/Video switch; Video closes the sheet and starts the live video preview.
  Lens and front/back were already in. Recording video clips to a file is not built;
  Video means the live preview Jarvis sees.
- **Video preview:** small tile in the top right of the chat window (no strip above the
  composer) with stop, torch (`AVCaptureDevice.torchMode`), flip and lens controls.
- Apple docs: HIG [Menus](https://developer.apple.com/design/human-interface-guidelines/menus),
  [Camera](https://developer.apple.com/design/human-interface-guidelines/camera),
  [Dictation](https://developer.apple.com/design/human-interface-guidelines/dictation);
  [SFSpeechRecognizer](https://developer.apple.com/documentation/speech/sfspeechrecognizer),
  [AVCapturePhotoSettings.flashMode](https://developer.apple.com/documentation/avfoundation/avcapturephotosettings/flashmode),
  [AVCaptureDevice.torchMode](https://developer.apple.com/documentation/avfoundation/avcapturedevice/torchmode).
  Not compiled or run here; Mac CI and device check pending.
## 2026-11-01: iPhone sidebar edge swipe, plain toolbar icons (#1484)

The drawer stays a root-owned, top-most layer. The edge swipe is a
`UIScreenEdgePanGestureRecognizer` (`edges = .right`, the drawer side) installed
on the window by `JarvisSidebarEdgeOpener`; it recognises simultaneously, never
cancels touches, and commits state only when the pan ends and passes
`JarvisSidebarGesturePolicy.shouldOpen`. The leading edge stays with the system
back swipe. The drawer and scrim close by tap or by a trailing swipe
(`shouldClose`). The Chat toolbar bell and `sidebar.trailing` button are
separate items with `sharedBackgroundVisibility(.hidden)`; sidebar icons use the
stone secondary accent. The temporary debug badge and write log are removed.
Apple docs: UIScreenEdgePanGestureRecognizer, UIGestureRecognizerDelegate,
SwiftUI ToolbarContent.sharedBackgroundVisibility, ToolbarSpacer, Human
Interface Guidelines (Toolbars, Sidebars, Gestures). Device behaviour is
unverified until the next preview build.

## 2026-11-01: iPhone sidebar is a reveal, not an overlay (#1484)

Dan's design requirement: the page slides sideways and the sidebar sits behind
it. `JarvisSidebarReveal` (root, inside the gate's blur/hit-testing group)
offsets the page by `-drawerWidth * progress`; the drawer renders only while
progress > 0. Progress is the root model's committed state or, during a swipe,
the transient `dragProgress` (cleared by every state write, by cancel/failed
pans and by a gesture-state reset). While open the page is not hit-testable and
a catcher over it closes on tap or trailing swipe; the toolbar button and edge
pan are unchanged. Reduced motion disables the spring and live tracking
animation. The earlier scrim is gone, which also removes any layer that could
sit over the drawer rows (item taps: scrim no longer overlaps rows, rows carry
no gestures). Device behaviour is unverified until the next preview build.

## 2026-11-01: sidebar swipe fixes after build 28 (#1484)

The window-level `UIScreenEdgePanGestureRecognizer` did nothing on device and is
removed. Opening is now a SwiftUI `DragGesture` on a 20pt full-height trailing
strip above the page inside `JarvisSidebarReveal` (`highPriorityGesture`); the
close swipe is on the page catcher. Both read translation in the global space
(the views move with the page, so a local space fed the offset back into the
drag), set no animation while a finger is down, and animate with a spring on
release. Programmatic `navigate(to:)` now marks a short window in which a
shrinking path echoed through the `NavigationStack` binding is dropped as stale;
this is a hypothesis for "items close the drawer but stay on Chat" and is not
confirmed. A TEMPORARY on-screen debug line (path, current/shown destination,
last writes) is in the root and must be removed once Dan confirms.

## 2026-11-01: Merge of the base navigation branch and main

Confirmed: merging `copilot/p15-41-fix-unreliable-navigation` (2530c471) and
`origin/main` keeps the reveal, the 20pt open strip, plain stone icons and the
temporary debug line, and drops the base's `JarvisSidebarDebugBadge`,
`JarvisSidebarDiagnostics` and typed `caller:` tags. Kept from the base: the
drawer is not gated by the page's blur, hit-testing or accessibility hiding
(`JarvisSidebarReveal(isEnabled:)` makes it inert while the gate covers the
app), the stored theme is applied at the root because the drawer sits outside
`ContentView`, and `JarvisNavigationModel.navigationRequested` delivers voice
and fixture side effects before the route changes. `ios-testflight.yml` equals
`origin/main`.

## 2026-11-01 — P15-52 camera-sheet UI test matches the menu item by title

Run 41347453078 failed `testCameraSheetOpensFromThePlusMenu` because `chat.plus.camera` was not found once the native menu item was enabled. The test now matches the item by identifier or by its localized title (Kamera/Camera). Not yet run on a Mac; the navigation branch had no new commits when this was pushed.

## 2026-11-01: One navigation UI test run, trace in the failure message

Confirmed: CI run 41347453078 showed the menu-size assertion failing at 43.99999999999999
(now compared with a 43.5 tolerance) and the Software Factory item tap not showing its
screen. The class runs once in the screenshot step (it ran twice, taking about 30 minutes)
with 60/90 second per-test limits, and fails the run after screenshots. The two
five-second-delay menu tests were folded into the English menu test. The item test now
waits for `factory.segment.board` (always rendered) and puts the temporary on-screen
navigation trace (`debug.navigation.trace`) in its failure message. The cause of the
non-navigating item is still unconfirmed.

## 2026-11-01: Merged navigation 062ef8b; camera-sheet test runs in English only

The navigation branch now runs its UI classes once in the screenshot step with 60/90 second per-test limits, and ChatComposerUITests is listed there. The camera-sheet test looped over two languages (about 30 seconds each) and would hit that limit, so it now covers English only; the Danish menu title is still matched by the other tests.



## 2026-11-01: Sidebar drawer above the page, clipped to the revealed strip (P15-41)

CI run 41351802814 showed the drawer never became hittable after a menu tap and
the item tap never left Chat. The drawer sat *behind* the page in z-order, so a
page layer (the close-tap catcher) could take row taps and only close the drawer.
The drawer is now drawn above the page and clipped to the strip the page has
uncovered, so it looks revealed but no page layer can cover its rows. The trace
element is queried without a type, the container is no longer required to be
hittable (its rows are), and per-test time allowances are 120/150 s because a
cold simulator launch took 38 s. Unconfirmed on device until the next preview
build; the temporary debug line stays until Dan confirms.

## 2026-11-01: Camera-sheet UI test hardening (P15-52)

The combined head failed `testCameraSheetOpensFromThePlusMenu` at the shutter wait (39 s). Cause not confirmed without Xcode. Two likely suspects were changed: `stopVideo()` (called on any non-active scene phase and on disappear) no longer runs under the `--ui-test-camera-sheet` hook, so it cannot dismiss the stub sheet; and the sheet container is now `.accessibilityElement(children: .contain)` so its `chat.cameraSheet` identifier cannot hide `camera.shutter`. The test queries any element type, waits 10 s and prints the hierarchy on failure.

## 2026-11-02: Root screen chosen from the navigation model, not a NavigationStack path (P15-41)

CI trace after tapping a sidebar item was `path=[softwareFactory] current=softwareFactory shown=-`: the model
was correct but the stack never pushed the destination. The visible root screen is now selected directly from
`navigation.currentDestination` inside a plain `NavigationStack` (kept only for nested pushes such as Factory task
detail), so a root destination cannot be dropped by a path push. Unconfirmed on device until the next preview build.

## 2026-11-02: Root screen host observes the navigation model directly (P15-41)

CI on f5a5d64 showed `current=softwareFactory shown=chat open=false`: the model and drawer updated but the screen
stayed on Chat, with both the path push and the `currentDestination` switch. The drawer reads the model in its own
body; ContentView read it only inside its `GeometryReader` closure, which is not a reliable subscription. The root
screen is now built by `JarvisDestinationHost`, which holds the model as `@ObservedObject`. This is the best reading
of the code, not reproduced; confirm on the next preview build.

## 2026-11-02: Item tap crash/hang after the host change (P15-41)

CI on e636f8b: the Danish item test lost the app connection and the English one logged "Unable to monitor event loop"
after tapping Software Factory, so the screen now renders but the app stalls or dies. No recursive update, force
unwrap or main-thread loop was found by reading the code; the likely trigger is the render pass itself. Mitigations,
not confirmed: the screen swap runs with animations off (`transaction(value:)`), so the drawer spring no longer animates
a whole-screen layout; the debug `shown` report is published after the view update and only when it changed. The menu
test keeps the 2 s existence check and gives the geometry checks a separate 6 s allowance, because each snapshot can
take about a second on a loaded simulator.

## 2026-11-02: Sidebar item tap crash was a Factory format string (confirmed)

The crash report in the CI `ios-scheme` xcresult (run 41370702750) shows `EXC_BAD_ACCESS` in `String(format:)` called from `JarvisFactoryBoardRow.rowContent` (`JarvisFactoryArea.swift:791`). `factory.blockedBy` and `factory.issueNumber` used `%@` but were given `Int` values, so the Factory board crashed whenever a fixture card had a blocker. Both strings now use `%ld` in Danish and English. The earlier navigation workarounds were not the cause. CI already uploads crash reports inside the xcresult artifact.

## 2026-11-02: P15-54 sidebar audit, trace removal, picture-only camera (#1516)

The temporary navigation trace (`debug.navigation.trace`, `debugWrites`, `debugShown`) is removed. Sidebar UI tests now assert on a `screen.<destination>` identifier that `JarvisDestinationHost` adds for the current destination, and one test taps every sidebar item in Danish and English. Proactive, Status, Usage and Banking still render the title-only placeholder because no screens exist for them; they do not fall through to Chat. A JarvisCore test checks every `%` format string in both languages against the argument types its call sites pass; the Int placeholders in `chat.failedChecksSummary` and the workspace strings now use `%ld`. The camera sheet is picture-only (video toggle and its strings removed). Lens buttons (0.5×, 1×, and the telephoto factor derived from the lens field of view) sit above the shutter, with flash and switch camera on either side of it, like the stock Camera app. The video preview tile grew from 132×176 to 156×208 pt. Not built or run here (no Xcode); CI and a device check are needed. Apple docs used: HIG Camera/Buttons/Layout (tap targets of at least 44 pt), AVFoundation `AVCaptureDevice.DiscoverySession`, `AVCaptureDevice.Format.videoFieldOfView`, SwiftUI `accessibilityIdentifier` and `Observable`.

## 2026-11-02: Camera sheet always renders its controls; voice entry points (P15-54 follow-up)

CI run 41406349242 (accessibility tree of `testCameraSheetOpensFromThePlusMenu`) shows the `.large` sheet window present (402×812 at y=62) but with no exposed children, so `camera.shutter` never existed. The sheet is now built whether or not a capture device exists (a placeholder `VoiceCameraCapture` stands in), its controls are laid out in a plain `VStack` with the preview and background behind it as hidden decoration, and the shutter and lens buttons are disabled instead of absent when the session has no input. The test also checks a `camera.lens.wide` button and that no mode picker exists. This is the best reading of the tree; it is not run here and needs the next iOS CI run. Voice entry points found in code: the composer voice button (`chat.mode`) and the mini bar restore button. The Live Activity intents do not open the app (`openAppWhenRun = false`), there is no URL scheme or notification deep link to voice, and the backend `navigate` page list has no voice page, so those paths do not exist. `VoiceEntryPointUITests` covers both real entry points, and a JarvisCore test covers voice navigation from each state. The reported "Navigating to voice failed" is not reproduced; the cause is unconfirmed.

## 2026-11-02 — P15-54: voice start survives view-task cancellation

- Status: accepted (Dan: the composer voice button is the only voice entry point).
- `VoiceScreenModel.start()` now runs the session start in an unstructured task. Cancelling the voice screen's `.task` (for example when the host re-renders) no longer turns `Task.checkCancellation()` into a failed session. Generation checks still cancel a superseded start.
- No `%d`/`%@` mismatch exists in the voice screen: its strings have no format placeholders, and `LocalizedFormatStringTests` covers the voice tables.
- `VoiceEntryPointUITests` asserts the mic control is hittable after tapping the composer button, in Danish and English. Not run: no Xcode here.

## 2026-11-02 — P15-54: placeholder destinations keep the sidebar button

- Status: accepted.
- CI on 0d162a8 failed `testEverySidebarItemShowsItsScreen*` at the step that reopens the sidebar: after Proactive (a title-only placeholder) the screen had no `navigation.openSidebar` button, so the user could not leave it. This was an app bug, not a test-query problem.
- `JarvisPlaceholderView` now shows its title and `JarvisSidebarMenuButton` in a top row, like the other destinations. The test is unchanged. Not run: no Xcode here.

## 2026-11-02 — P15-54: Banking stays a disabled "later" sidebar row

- Status: accepted; open question for Dan below.
- CI on ee5e2e0: the Banking step failed because the Banking row is disabled (`JarvisDestination.banking.isNavigable == false`, shown with the "later" label per the 29 October 2026 sidebar decision). Tapping it does nothing by design. It is not a placeholder screen, and it runs no loop or heavy work. The Danish timeout was the descendants query after the failed step.
- `SidebarNavigationTests` now has one test per navigable item and language, each waiting on the single `screen.<destination>` identifier, so one slow item cannot use the whole allowance. A separate test asserts the Banking row is disabled and does not navigate.
- If Dan wants Banking to open a placeholder, set `isNavigable` to true and update the navigation tests that pin banking as disabled.

## 2026-11-02 — P15-55: shared Apple-style control layer, first slice

- Status: accepted; the issue is only partly done (see below).
- `apps/ios/Jarvis/JarvisControls.swift` is the one place for control chrome: `JarvisIconButton` (icon-only glass, 44 pt), `JarvisSheetToolbar` (check mark to confirm, X to close, both trailing, no text), `JarvisChip` (capsule filter/legend pill) and `JarvisFilledCircleButton` (composer send). The Notes, Factory new-task, Steer and Health lift sheets, the note editor save, the camera close X (now right-aligned, icon-only) and the send button use them. Accessibility labels keep the old Danish/English strings, and `sheet.cancel` is kept for UI tests; `sheet.confirm` is new.
- Dictation: the recogniser starts a shorter transcript after a pause, which overwrote the field. `DictationTranscript` (JarvisCore, unit tested) commits a restarted segment so earlier words stay.
- Not done in this slice: message survival on backgrounding, screen-share frame streaming and wording, voice video, dictation waveform and field growth, chat transcript sync, 2x lens, notifications grouping, mode control (needs an iOS client for the presence route), add-item sheet fields, Health detent/toggle, sidebar blur, native orb, remaining screens. Usage and Status are placeholders on iOS in this branch, so the first-load error could not be reproduced here; the web pages are unchanged.
- Apple documentation used: Human Interface Guidelines (Buttons, Toolbars, Sheets), SwiftUI `ToolbarContent`, `ButtonStyle.glass`, `LabelStyle.iconOnly`, `buttonBorderShape`, and Speech `SFSpeechRecognitionResult`. Not compiled: no Xcode here; JarvisCore tests pass (254).

## 2026-11-02 — P15-55: live screen/camera frames reach Jarvis as live input, not attachments

- Status: accepted. Traced end to end after build 42 evidence (Dan, issue #1518).
- Root causes found:
  1. iOS Chat attached one frame as `Screen.jpg`/`Video.jpg` at send time. The backend turned it into a text description at upload (10 s limit; failure became "File content could not be extracted"), so the model saw a described "file", then called `attachment_list`/`attachment_read`/`watch_for`. Nothing ever posted to `/vision/watch` from iOS (only the web app does), so `watch_for` had no feed and Jarvis said it could not confirm one.
  2. The broadcast extension refreshed its active marker and frame file only when ReplayKit delivered a frame, which it does only when the screen changes. On a still screen the 5 s freshness lapsed: Chat showed "Screen sharing stopped" and `latestFrame()` returned nil. The Chat status loop also stopped as soon as the state left busy, so it never recovered.
- Fix: Chat now uploads the frame to `/screen/frames` (mode `handle`) and sends the turn with `visualContext` (`source` screen or camera, `frameId`, `turnId`). The existing frame store resolves it to the real image for the model, and the context text now says "a live screen share" or "a live camera view", never a picture upload. Chat and Voice also stream sampled frames to `/vision/watch` every 2.6 s (`LiveFrameStreamer`, bounded rate and size, stops on 404 or repeated failure, sends DELETE on stop). The extension keeps a 1 s heartbeat that refreshes the marker and last frame. Old `Screen.jpg`/`Video.jpg` attachments are hidden from the Chat history.
- Tests: JarvisCore (`LiveFrameStreamerTests`, visual context in `JarvisChatClientTests`), Python `test_image_context.py`, backend `visual-context.test.ts`. Not verified: SwiftUI and the broadcast extension were not compiled here; the stream needs a device check, including the vision budget and the 2.5 s per-source rate limit shared with the per-turn frame upload.

## 2026-11-02 — P15-55: one corner radius, one glass surface, transparent chat header

- Status: accepted (Dan's instructions on PR 1518; not compiled here, needs iOS CI and a device check).
- Branch state: main (`d2d0e9a`, PR 1517) is already an ancestor of this branch, so there was nothing to merge.
- The sidebar stays on the right, as it is now.
- One global corner-radius token, `JarvisDesignTokens.surfaceRadius` (24 pt). The composer, Now bar, bubbles, video and camera tiles, plus-menu, Health panels and activity cards derive from it instead of per-view values.
- The Now bar is 36 pt high (was 44 pt) and uses the same radius as the composer.
- The chat header bar is transparent with no line: `jarvisAmbientBackground(transparentNavigationBar: true)` hides the navigation bar background and the top scroll-edge effect is hidden.
- Every control that floats over content keeps Apple's glass behind the control itself. The header buttons no longer hide their system glass (`sharedBackgroundVisibility(.hidden)` removed). Non-toolbar surfaces use the shared `jarvisGlassSurface(cornerRadius:)` in `JarvisControls.swift`: `glassEffect` (iOS 26 is the deployment target, so no older-OS branch is needed) with a `regularMaterial` fallback under Reduce Transparency.
- The "Screen sharing stopped." line no longer shows once sharing ends; only starting, live and error states show a status line.
- Not done yet from Part 1: the remaining screens' ad hoc controls, Usage chips, the Health toggle and burger/plus removal. Which page counts as the main shell for the burger needs Dan's answer, because the sidebar is the only navigation entry.

## 2026-11-02 — P15-55: clear glass, composer rim and orange composer icons (Dan, PR 1518)

- Status: accepted; not compiled here, needs iOS CI and a device check against `docs/ios/design/board.html`.
- Glass: the board's glass is clear with a light fill (`--g-fill-bar`). `JarvisGlass.surface(tint:)` is now `Glass.clear` with `JarvisDesignTokens.glassFill` (white 44% light, blue-grey 36% dark), replacing `.regular` for the composer, Now bar, bubbles, chips and activity cards. Reduce Transparency still falls back to a material.
- Composer rim: `jarvisRim` in the shared layer follows the board's `data-cs` states (idle 0.4 opacity, 1.5 pt, 40 s lap; typing 0.9, 2 pt, 14 s; listening 0.9, 2 pt, 8 s; thinking 1.0, 3 pt, 7 s). The earlier agreement (P14-32, DESIGN.md) is a thin 2 pt rim, no hover rim, and a steady rim under reduced motion; that is kept. Colour is the orange primary accent with a warm glint, not the web's teal.
- Pulse: random 2.5–7 s gaps, random 1.2–2.6 s duration and random depth (0.1–0.25, thinking 0.25–0.5), never periodic. Reduce Motion gives a static rim with no sweep and no pulse.
- Cost: one stroked shape redrawn at 12 fps, no mask, blur or shadow. The board's outer glow is left out because it needs an offscreen shadow.
- The board shows no rim on the Now bar, so it gets none.
- Composer icons: voice (waveform), dictation (mic) and send (paper plane) are orange primary-accent icons with no background, from `JarvisComposerIconButton`. The trailing slot is voice when the field is empty and send when there is text. `JarvisFilledCircleButton` is removed.

## 2026-11-02 — P15-55: the composer rim does not animate in fixture/UI-test runs

- CI on d6f6300 failed `ChatComposerUITests.testPlusMenuOpensNextToThePlusButton` (then hung past its allowance). `chat.plus` and the camera menu item were not changed; the new rim's endless `TimelineView` and `withAnimation` pulse loop kept XCUITest from ever seeing the app idle. `jarvisRim(isAnimated:)` is false when `model.fixtureMode` is on, so fixture and UI-test runs show a static rim. Real runs keep the sweep and pulse; Reduce Motion still makes both static. Not compiled or run here; needs the iOS UI test job to confirm.

## 2026-11-02 — P15-58: Usage, Status and Proactive pages (#1525)

- Status: accepted; SwiftUI not compiled on Linux, needs iOS CI and a device check.
- Logic, clients and copy sit in `JarvisCore/Insights` so they are tested on Linux; the views only render them.
- Preferences are read-only in the Proactive editor. The backend derives them and `PATCH /proactive/settings` rejects them; the issue asked for an editable list, which would have failed every save.
- Add to tasks uses the Notes client (`createTask`, personal scope); there is no proactive route for it.
- `POST /proactive/runs` returns 202, so Check now accepts it (200 alone would have shown a false failure).
- UI tests use `JarvisInsightsFixtureTransport` behind `--ui-test-navigation` with a fixed clock, no polling and no stale timer, so XCUITest can go idle.
- The Apple documentation site could not be fetched in this environment; the PR lists the pages the design follows.

## 2026-11-02 — P15-57: Today (Home) page and chat/voice transition (#1523)

- Status: accepted from the issue; not compiled or run here (no Xcode on this runner). Needs the iOS CI job and a device check against `docs/ios/design/today.html`.
- Home is a normal pushed destination (`.today`); `JarvisNavigationState()` still defaults to Chat so existing fixtures and tests keep starting on Chat. Normal launches, and sign-out, go to Home. The `--ui-test-today` argument (simulator only, with `--ui-test-navigation`) starts on Home with fixed fixture data.
- No calendar-list route exists for the phone, so Next up reads a `JarvisTodayCalendarSource`; production binds the unavailable source and shows "Calendar unavailable". Nothing is invented.
- Gym logs save through the existing vault notes path (`POST /notes`, `Personal/Gym log/…`), behind the `JarvisGymLogStore` protocol. The unavailable store never reports success; an unconfirmed write locks Save so it cannot be duplicated.
- Steps come from HealthKit (read-only); workouts come from saved Gym logs. Hourly bars are a running total for 06:00–22:00; future hours are disabled. The target line is 8,000.
- Bars below 44 pt wide (14d and 30d) keep a full-height 44 pt+ hit area and are individually reachable by VoiceOver with a caption and value, which is the accessible alternative.
- The chat/voice carry-over is a `matchedGeometryEffect` namespace (composer and orb). Reduce Motion turns the geometry match off and leaves a cross-fade. The rim and greeting shimmer are static in fixture runs so XCUITest can go idle.
- `.github/scripts/tests/test_pipeline.py` now allows exactly one leading toolbar item on Chat: the Home button that appears only when Chat was opened from Home.

## 2026-11-02 — P15-55: notifications grouped per category (iOS)

- The notification sheet shows one row per category with the latest update and an "+ N earlier" count. Older items sit in a lazy disclosure. A group with older items has one clear-all control; the toolbar has a clear-everything control. The grouping is `NowFeedActivityGrouping` in JarvisCore (tested).
- The backend has one dismiss route per item, so clear-all dismisses item by item, treats a missing item as dismissed, stops on any other error and reloads once. A bulk route would need a backend change and was not added.
- The sheet close X keeps its existing toolbar chrome and `chat.notifications.done`; a repo test pins that source.
- Not compiled here (no Xcode). Still open: mode control, orb, burger icon (which page is the main shell?), Usage chips, Health toggle and detent, add-item sheet, camera lenses and preview, navigate-away send, dictation waveform, transcript sync.

## 2026-11-02 — P15-55: composer icon identifiers restored

- A bulk edit had hard-coded `sheet.cancel` on `JarvisComposerIconButton`, so `chat.send`, `chat.mode`, `chat.dictate` were missing in the UI tree. The button uses its `identifier` again. `chat.send` exists whenever the draft is non-empty; the UI test needs no change.

## 2026-11-02 — P15-55: build 44 slice (draft, Now bar status, title, voice image message)

- A sent message is never restored to the composer. Cancelling the send task on navigate-away used to put the text back; `discardOptimisticMessage` no longer restores.
- The Now bar no longer shows thinking or tool status and is not shown just because a turn is sending. The status line ("Thinking…", tool status) is the text of the Jarvis bubble until real text streams in.
- The chat header has no title.
- Voice shows an image message only for real failures (`daily_limit`, `budget_exhausted`, `budget_unavailable`). The caption path, `frame_rate_limited` and `frame_unavailable` are expected in a continuous stream and are silent.
- Not done yet from the build 44 list: reply push notification (1), merged Notifications sheet (4), dictation waveform (6), Camera vs single photo in Voice (8), Live Activity audio line and buttons (10, 11), sidebar blur (12) and the page-by-page application of the shared layer (13). Nothing was compiled (no Xcode).

## 2026-11-02 — P15-55: Voice menu has "Enable video" and "Camera" (item 8)

- Two separate items. "Enable video" / "Aktivér video" is a toggle with on/off state and starts or stops live video (`startCamera`/`stopCamera`). "Camera" / "Kamera" takes one photo and sends it with the next turn. It works with video on or off.
- With video off, `beginPhotoSession` runs the camera only for the viewfinder: nothing is streamed and the session is not told video is on. The viewfinder sheet's `onDismiss` calls `endPhotoSession`, which releases the camera. Turning video on during a photo session replaces the temporary capture.
- Not compiled here (no Xcode).

## 2026-11-02 — P15-55: sidebar rows centred as one block

- The navigation rows are one block centred vertically between the header rule and the bottom safe area (`JarvisSidebar`). The bottom safe-area inset moved from inside the scroll content to below the scroll area, so the free space is measured between the two insets and the space above and below the block is equal. Row order, size and spacing are unchanged. If the rows do not fit, the content grows past the minimum height and scrolls from the top. Not compiled here; the iPhone SE and Pro Max screenshots come from iOS CI and need a device check.

## 2026-11-02 P15-55: dictation waveform and plus-menu CI retry

- Dictation shows `JarvisWaveform` between the plus button and the dictate button while listening: a centred line of 48 bars driven by the microphone RMS (about 20 updates per second, newest right). Reduce Motion drops the interpolation. It only exists while listening, so UI-test runs are unaffected. Not compiled here (no Xcode); needs iOS CI and a device check.
- CI on e7165a3 failed only `testPlusMenuOpensNextToThePlusButton`. The log shows a 69 s "Setting up automation session" for that test (others 1-8 s), which points at a slow simulator rather than a changed `chat.plus` control. The rim is already static in fixture mode. The failed run was re-run on the same commit to confirm; no test was weakened.

## 2026-11-02 P15-55: CI on cd256f5

- PC bridge job: `BrowserExecutorTests.Browser_executor_falls_back_to_cdp_when_extension_is_disconnected` failed in `FakeCdpTarget.DisposeAsync` (`ObjectDisposedException` on the HttpListener). It is a test-teardown race in code this PR does not touch, so it is treated as flaky and re-run.
- iOS UI job: `testSentMessageBubbleIsVisibleAboveComposer` hung past its 2 minute allowance (a different test than on e7165a3; the plus-menu test passed). Both hangs are idle-wait symptoms. `JarvisRim` no longer builds a `TimelineView` at all when static (fixture or Reduce Motion), instead of a paused one, so nothing can schedule frames in UI-test runs. Not verifiable without Xcode; the next iOS CI run is the check.

## 2026-11-02 P15-55: Voice orb versus the board's chat-bubble mini core

- Checked `JarvisOrbView` (dark glass sphere, cyan rim, orange/amber tangled centre) against the board's `.working-core` / `drawMini` mark. The Voice screen already renders `JarvisOrbView` through `VoiceOrbView`, the same view the gate and lock-screen preview use, so Voice matches Dan's description and nothing is drawn twice. No change made.
- Difference noted: the board's mini core is only the amber tangle on a transparent canvas, with no sphere or rim, and the iOS chat bubble does not draw a mini mark (status text is the bubble text). If the chat bubble should show the mark, it must reuse `JarvisOrbView` at about 24 pt rather than add a second drawing. Not compiled or compared on a device here.

## 2026-11-02 P15-61: shared page header for Health, Factory and Notes (#1531)

- Decision (owner-approved board `docs/ios/design/pages.html`): every page except Chat, Settings, Voice and Home uses one `JarvisPageHeader` (`apps/ios/Jarvis/JarvisPageHeader.swift`): a bold ~32 pt title (scales with Dynamic Type and wraps, never truncates) level with 44 pt glass action buttons and the sidebar button, then `JarvisPageHeadline` (one data sentence, orange key words), then one `JarvisPageHeroCard`. Loading and error states pass no phrase, so only the title shows. Usage, Status and Proactive (PR 1526) and Home (PR 1524) can adopt it with `JarvisPageHeader(title:language:) { actions }`; it was not on main when this was written, so it is created here.
- Phrases are pure functions in `JarvisCore/Pages/JarvisPagePhrase.swift` (`{braces}` mark key words), written from real data and tested on Linux in Danish and English: Factory from the board counts or the releases, Notes from the task list (overdue, due today) or the graph, Health from the period's workouts and steps against the targets.
- Health: the plus opens a chooser, Log lift or Log workout. The Workout sheet uses P15-60's `JarvisWorkoutSessionType`, `JarvisWorkoutDraft` and `JarvisVaultState` as the single source of truth. The save sits behind `JarvisWorkoutLogging`, which `JarvisHealthClient` implements by calling `createWorkout`; `JarvisHealthArea(workoutLogger:)` can override it.
- Factory: the plus moved from the bottom dock to the header; the segmented control moved into the bottom dock above the search with more space between them. Task rows have a GitHub mark button (`GitHubMark` asset, Primer Octicons `mark-github`, MIT) that opens the issue; tapping the row opens the task in Jarvis. Group headers are a pressable bordered surface with the chevron at the far right. The "1 kører · 1 på pause" sub-line exists only in the web board mock; the iOS code never rendered it, so nothing was removed.
- Notes: the plus moved to the header with reset or refresh. No pinned or unsorted concept was added. The task list now also loads on the notes and list tabs so the headline and hero can show there.
- Shared files touched: `JarvisDesignSystem.swift` (`JarvisList` gains an optional head row; existing call sites are unchanged). Glass and button styles are untouched (PR 1528).
- Not compiled here (no Xcode): needs iOS CI and a device check.

## 2026-11-02 P15-60: Gym log in the vault

- Workouts (`daily.workout_entries`) and lifts (`daily.lift_entries`) stay the record. Each row has a `revision` and a `vault_synced_revision`; the vault copy is finished only when the two match, so "pending" is derived, never stored as a flag that could lie. Responses carry `entry.vault` (`synced` or `pending`). A failed or missing vault write keeps the row, answers with `pending`, and the owner-bound retry job (every 5 minutes, 25 entries, stops at the first vault failure) finishes it. Repeating the same create (same idempotency key) also retries the copy.
- The writer keeps one note per Copenhagen day at `Health/Gym log/YYYY-MM-DD.md`, one `##` section per session, lifts as lines under their session and unassigned lifts in a separate section. Every owned line ends in a `<!-- jarvis:kind:id -->` marker, so edits replace the line, deletes remove it, repeats change nothing and text the owner added is kept. Writes use the todo writer's stale-write pattern (read, apply, write with the SHA, re-read on conflict, 3 attempts, 256 KiB cap). User text has comment delimiters and control characters removed and secret-like text withheld.
- Lifts store `gym_day` when created (the session's day if linked) so a later session delete cannot move a lift to another note. Deleting a session moves its lifts to the unassigned section. Lifts saved before migration 0074 are marked as already handled and are not back-filled into the vault.
- `GET /daily/workouts?days=7|14|30&limit=` lists recent workouts; `POST`, `PATCH` and `DELETE /daily/workouts` follow the lift routes (owner only, no agent or connector tokens). The note text is Danish by default with English labels available in the writer.

## 2026-11-02 P15-59: Build 45 fixes (live chat, voice media, orb, controls, location)

- Chat stays event driven: the composer is never disabled while Jarvis answers. A message sent mid-turn goes to the existing `POST /conversation/sessions/:id/steer` route (`JarvisChatClient.steerTurn`) and joins the running turn; a 409 means no turn is active and the text returns to the composer. `.activityChanged` refreshes history when no turn of this client is streaming, so replies finished during voice or screen sharing appear unprompted.
- The backend's historical callback dispatcher is superseded by #1970: the
  durable message transaction now owns the `jarvis.reply` per-device outbox,
  stable identity and retries. The same device registrations/APNs configuration
  and foreground suppression remain.
- Thinking text is localized and context aware (`ChatThinkingPhrase`) and lives in the assistant bubble with a shimmer and the shared `JarvisOrbView` mini core; the Now bar never shows it. The voice orb drops its rotation and non-uniform scale so it is the same mark as the mini core, only larger.
- The Now bar is the last element above the composer: screen-share status and errors sit above it, pending attachments sit inside the composer, and the static Away/Idle title is gone. The background sheet and the bell sheet are one `ActivitySheetKind.activity` area.
- Floating glass buttons use the chat header size (`chatMinimumTapTarget`, 44 pt). Rows already on glass and toolbars use `JarvisInlineIconButton` (no second background).
- Weather uses the device: `JarvisDeviceLocation` asks for When In Use permission, reverse-geocodes one coarse fix and saves city and coordinates (rounded to 0.01 degrees) into the existing home-location setting that the weather tool reads.
- Voice photos taken while live video is off now reach the assistant on the next turn, and sent photos, video frames and screen frames show in the voice transcript area.
- Unverified: SwiftUI compilation, UI tests and APNs delivery need the Mac job and protected configuration.
- Orb unification (P15-59, Dan's follow-up): `JarvisOrbView` (glass sphere, cyan rim, rotated/bent rendering) is deleted. `JarvisMiniCoreView` (amber filament tangle on a transparent canvas, uniform breathing, steady under Reduce Motion) replaces it in the gate/Face ID screens (2 call sites in `JarvisGateRootView`: sign-in and lock), Voice (`VoiceOrbView`), the chat streaming bubble, the lock-screen notification preview and both Voice Live Activity views. Settings and Factory render no orb. The sphere-only design tokens are removed. Not compiled on a device here.

## 2026-11-03 P15-64: Approval follow-up reply, one push per event, notification caps

- Decision: tapping Approve or Decline on a calendar card (`POST /now/confirmations/:id`, from the notification or the Now sheet) always posts one Jarvis chat message into the session that proposed the change (`postApprovalReply`). It states the outcome (done, not changed, or unverified) and ends with one follow-up question, in the session language. Confirmations owned by `OwnerInteractionService` already block the chat turn that asked for them, so that turn writes its own reply.
- Push rule: historical `PushLedger` behaviour is superseded by #1970's durable
  exact-turn claim and per-message/device outbox. The original event-only intent
  remains: an approval may suppress the reply from its own turn, while unrelated
  turns and restart recovery cannot be suppressed by process timestamps.
- Flood source: every task state change while away called `notify()`, which inserted a new Now-feed alert row with a random key, with no dedupe, cap or expiry. The feed shows up to 100 rows, so the Notifications page filled up.
- Caps (`core/notification-policy.ts`, enforced in `recordNotification`): the same kind and text is stored once per rolling 24 hours (dismissed rows count, so a dismissed message does not return); at most 10 stored notifications per kind (`info`, `success`, `warning`, `error`) per rolling 24 hours; stored notifications leave the feed after 7 days. Other alert, release and attention rows keep their own rules.
- Routes (owner only): `POST /now/activity/:id/dismiss`, `POST /now/activity/groups/:category/dismiss` and `POST /now/activity/clear`. Group and clear use the same visibility rules as the feed read, so they never dismiss hidden rows.
- Unverified: live APNs delivery and the iOS Notifications page wiring.

## 2026-11-02 P15-60: Gym log in the vault

- Workouts (`daily.workout_entries`) and lifts (`daily.lift_entries`) stay the record. Each row has a `revision` and a `vault_synced_revision`; the vault copy is finished only when the two match, so "pending" is derived, never stored as a flag that could lie. Responses carry `entry.vault` (`synced` or `pending`). A failed or missing vault write keeps the row, answers with `pending`, and the owner-bound retry job (every 5 minutes, 25 entries, stops at the first vault failure) finishes it. Repeating the same create (same idempotency key) also retries the copy.
- The writer keeps one note per Copenhagen day at `Health/Gym log/YYYY-MM-DD.md`, one `##` section per session, lifts as lines under their session and unassigned lifts in a separate section. Every owned line ends in a `<!-- jarvis:kind:id -->` marker, so edits replace the line, deletes remove it, repeats change nothing and text the owner added is kept. Writes use the todo writer's stale-write pattern (read, apply, write with the SHA, re-read on conflict, 3 attempts, 256 KiB cap). User text has comment delimiters and control characters removed and secret-like text withheld.
- Lifts store `gym_day` when created (the session's day if linked) so a later session delete cannot move a lift to another note. Deleting a session moves its lifts to the unassigned section. Lifts saved before migration 0074 are marked as already handled and are not back-filled into the vault.
- `GET /daily/workouts?days=7|14|30&limit=` lists recent workouts; `POST`, `PATCH` and `DELETE /daily/workouts` follow the lift routes (owner only, no agent or connector tokens). The note text is Danish by default with English labels available in the writer.

## P15-63: one design system layer for buttons, orb and page scaffold (3 November 2026)

- Decision: the four competing icon-button variants collapse into `JarvisIconButton` (with `JarvisLabelledButton`, `JarvisMenuButton` and the sheet buttons), every orb is a `JarvisOrb`, and `JarvisPageScaffold` is the page frame. `VoiceOrbView`, the gate and sidebar button styles and `jarvisToolbarButtonStyle()` are gone. Screens no longer call `glassEffect`; they use `jarvisGlassSurface(cornerRadius:tint:)`.
- Enforced by `JarvisDesignSystemGuardTests` (source scan in the normal JarvisCore CI job). Exceptions: `JarvisControls.swift`, `JarvisDesignSystem.swift`, and `JarvisOrbCanvas.swift` (the orb drawing that `JarvisOrb` wraps).
- Orb distortion: `JarvisOrbCanvas` draws into an explicit square frame and `JarvisOrb` adds a fixed aspect ratio and circular clip. Not verified on a device from this environment (no Xcode).
- The Live Activity extension compiles `JarvisControls.swift` for `JarvisOrb`.
- Migration finished in the review round: Voice dock, camera controls, shutter, Today cards and tabs, Health period menu, Chat approval, Notes, Workspaces, Factory, Settings and sheet toolbars use the shared buttons. `JarvisLabelledButton` gained subtitle, selected and leading options, and `JarvisLabelledMenu`, `JarvisShutterButton`, `JarvisOrbButton` and `JarvisComposerMenuButton` joined the shared layer. The guard now also rejects `.buttonStyle(.glass`, `.glassProminent`, `.bordered` and `.borderless` in screens. `.buttonStyle(.plain)` stays only on whole-row taps (note rows, disclosure headers, chart slices, sidebar rows); the Live Activity keeps WidgetKit `Button(intent:)`.
- Web-exact orb (owner feedback on build 56): the old pulsing `JarvisMiniCoreView` is deleted. `JarvisOrbCanvas` (one `TimelineView` + `Canvas`, 30 fps, still under Reduce Motion or `isStatic`) ports the web stage orb (`apps/web/src/JarvisStageOrb.ts`, `jarvis-orb-motion.ts`, `InputOrbCore.tsx`): dark glass sphere, cyan `#52dcfa` rim profile with wake front, listening ripples, thinking inward rings and speaking rings, nine woven ribbons, 460 motes, tool comets, and the amber `#ffb45c` core of 64 nodes, 64 filaments, 10 loops and 220 sparks with the web's seed (71, Park-Miller), stir, pulse and fire curves. The motion model and geometry live in JarvisCore (`JarvisOrbAnimator`, `JarvisOrbMotion`, `JarvisOrbGeometry`) and are unit-tested on Linux. `JarvisMiniCoreActivity` became `JarvisOrbActivity`. Differences from the web: a Canvas projection instead of three.js shaders (no fresnel shell veil or fine thread bands), orthographic instead of perspective, and synthetic audio levels while speaking or listening. Not compiled or seen on a device from this environment.
- `ComponentGalleryUITests.testOrbAnimatesBetweenTwoFrames` takes two screenshots 0.8 s apart and fails if they are identical; both ComponentGalleryUITests tests are now in the iOS CI `-only-testing` list.
- Rebase onto main and PR retarget wait for #1538 (still open); they need the owner because the agent cannot force-push or change a PR base.
- True circle buttons (owner feedback on build 58): `JarvisIconButton` and `JarvisMenuButton` render one fixed 44 by 44 pt circle (`buttonStyle(.plain)` + `jarvisGlassCircle()`, a clear interactive `glassEffect` in `Circle`), no longer the system `.glass` button style, which pads the label. The count badge is an overlay and never changes the layout size. The Chat header, Today, Workspaces and Settings refresh draw their own circle (`chrome: .glass`) and hide the system toolbar glass with `.sharedBackgroundVisibility(.hidden)`; sheet check and X stay `.onGlass`. `ComponentGalleryUITests` and `ChatComposerUITests` assert the frames are square 44 pt. Labelled text buttons (Retry, Load more) keep their text design. Not seen on a device from this environment.
- Pills and tabs (owner feedback on build 58): `JarvisLabelledButton` and `JarvisLabelledMenu` are plain buttons on a shared interactive capsule glass, one line, with 16 pt horizontal and 10 pt vertical padding and a 44 pt minimum height. `JarvisTabStrip` is the one tab strip and segmented control (a horizontally scrolling row of those capsules, never wrapping); every `.pickerStyle(.segmented)` (Notes tabs, Notes task scope, Health mode, Usage range and breakdown, Status filter, Proactive tabs and scope) was replaced, and the guard test rejects new ones. Tab identifiers are `<prefix>.<index>` (Notes keeps `notes.tab.<tab>`), and the UI tests find them by prefix and label. The Notes scope menu moved out of the search capsule. Status badges use 14/10 pt padding. Not seen on a device from this environment.
- One circle button, 48 pt (owner correction after build 58): the Chat header was wrong too, because the system toolbar drew its own glass container around our frame and clipped it. `JarvisDesignTokens.iconButtonDiameter` (48 pt) and `iconButtonGlyphSize` (20 pt) are the only size of `JarvisIconButton`, `JarvisMenuButton` and the sheet check and X; the circle is `jarvisGlassCircle()` with `contentShape(Circle())`. The `chrome` option and `.onGlass` are removed. Every `ToolbarItem` that holds our buttons carries `.sharedBackgroundVisibility(.hidden)` so the system draws no second container; the badge stays an overlay. The UI tests assert 48 pt square for the Chat header and the gallery.

## 2026-11-03 P15-67: Fast merge gate, separate Simulator check

- Decision: `CI result` gates merge on quick jobs only. The iOS Simulator job moved to `ios-simulator.yml` and reports separately. Reason: it took 43 of the median 44 minutes and failed 9 of 13 failed runs, so every PR waited on it.
- Trade-off: a PR can merge before the Simulator result arrives. A failure on `main` opens or updates one tracking issue, and the PR comment still warns when UI tests fail. Copilot ready qualification no longer waits for the Simulator.
- Not changed: UI tests were not skipped, deleted, retried or weakened. Sharding and a smoke subset stay open until the Simulator timing is measured.

## 2026-11-03 Merge order and deploy qualification

- Decision: merge a PR only when its tested head already contains current `main`. Deploy requires a CI receipt whose tree equals the tree of `main` after the merge, so a PR merged behind a newer `main` ships nothing (`exact_qualification_missing`).
- Evidence: the backend changes of P15-64 merged right after P15-67 and the Deploy plan job failed with that code. A small up-to-date PR re-qualifies `main`.
- Consequence: when two PRs are ready, merge one, then update the other from `main` and wait for its quick gate before merging it.

## 2026-11-03 Home layout and log sheets (P15-65)

- Decision: Home has no title. Order is headline, activity hero, Home sections, Chat composer. Typing on Home no longer jumps to Chat; voice becomes send while typing and send hands the text to Chat. Log workout and Log lift are two sheets with a date (default today); nothing saves without a date.
- Evidence: Build 56 testing showed both log buttons opened the same sheet and a lookalike composer.
- Consequence: lifts are a fixed list mapped to a gym session; HealthKit stays off until the entitlement is provisioned.

## 2026-11-03 Home matches the board, with the shared composer (P15-70)

- Decision: Home follows `docs/ios/design/today.html`: a 32 pt bold phrase with orange key words (Danish by default), the workouts and steps card with all five muscle rows even when empty (donut "0 af 1", step ring, hourly bars, 8.000 goal line), two equal quick-action tiles (round chip, title, last workout or last lift), a Today / Tasks control with counts and a round plus, then one day list card. The phrase sits at the very top under the status bar, with no title and no sidebar button (Dan, #1553); the sidebar opens by edge swipe.
- Decision: Chat and Home use one composer, `JarvisComposerBar`: plus on the left, dictation and voice on the right, voice becomes send while typing, orange rim, no orb. Only the surrounding screen differs.
- Evidence: TestFlight build 60 showed a small English sentence, a tiny ring with "No workouts" and unequal pills, side by side with the board.
- Consequence: `TodayUITests.testHomeMatchesTheBoardInDarkAndLightDanishAndEnglish` attaches Home screenshots for da/en and dark/light; compare them to the board before merging.

## 2026-11-03 P15-68: Settings and Notifications on the shared header, Health empty state

- Decision: Settings uses `JarvisPageHeader` (title, refresh, sidebar button). The notifications sheet draws its own header in content (bold title, Clear all, close) and hides the navigation bar, so there is one background and the close button is a centred circle. Group rows swipe left to dismiss, with a VoiceOver action as the alternative. Health shows an empty state (`health.notAuthorised`, da and en) and no headline when the backend reports no readable sources, for example while the HealthKit entitlement is off.
- Evidence: Health and Notes already used the shared header and headline. UI tests cover titles and shared button identifiers for Health, Notes, Settings and the notifications sheet.
- Not verified: no Simulator run or before and after screenshots in this change. Status, Proaktiv and Proaktiv settings stay with #1548.

## 2026-11-03 P15-72: icon button test root cause and HealthKit

- Decision: `JarvisPageHeroCard` no longer sets `accessibilityIdentifier("page.hero")`. On the Simulator that identifier replaced the identifiers of every control inside the card, so `ComponentGalleryUITests.testIconButtonsAreSquareAndTheBellKeepsItsSizeWithABadge` could not find `gallery.icon`. The test keeps its explicit identifier allowlist of simple icon buttons (never toggles, pills or tabs).
- Decision: the iPhone app enables the HealthKit capability and `com.apple.developer.healthkit` entitlement (CI checks both) so Home can read steps when the owner allows it. Nothing is written to Health or uploaded.
- Evidence: the failing run's accessibility tree showed `identifier: 'page.hero'` on all gallery buttons. The iOS Simulator workflow already fails the run when any UI test fails.
- Not verified: no Simulator run in this environment (Linux); the App ID and profile need HealthKit enabled in the Apple developer portal before the next TestFlight build.

## 2026-11-03 P15-74: Pages B fixes

- Decision: Health keeps one hero, the Aktivitet card (`JarvisHealthRingsSection`), with the period menu in its accessory slot. The duplicate Home activity and steps card, and its "not available" messages, are removed from Health.
- Decision: the Notifications page is titled Notifications / Notifikationer, and every label on it (away mode, pending confirmations, retry, loading, categories) comes from `JarvisChat.strings` in da and en.
- Decision: the Notes preview fixture now answers `GET /api/vault/tasks` first, so the headline and hero show in screenshots. Before, the tasks request failed and the page showed only the title, tabs and one row.
- Not verified: no Simulator run in this environment (Linux). Simulator screenshots (da/en, dark/light), the dark Notes render and the bottom bar overlap still need checking on a Mac.

## 2026-11-04 P15-76: build 66 feedback fixes

- Decision: a success is a log entry, never a notification. `notification-policy.ts` only admits info, warning and error; the feed hides stored success notifications; migration `0075_dismiss_success_notifications` dismisses the ones already stored (its reverse batch is a no-op, because dismissed rows are not restored). Task completion and model deployment success no longer notify. Recording a notification also purges notification rows older than the expiry window.
- Decision: the Notes "Could not load notes" root cause was strict client parsing. `JarvisNotesClient` threw for the whole list when one entry failed validation (for example a dot-prefixed folder or an over-long path). Unusable entries are now skipped. Not confirmed against production, which is not reachable from this environment.
- Decision: remembered lift names are stored on the device (`JarvisLiftNameMemory`, UserDefaults). No backend table, because only the owner's phone logs lifts. New-note folders are chosen from the folder tree; a folder exists once a note is saved in it, so no folder endpoint was added.
- Decision: the Home calendar is not wired in the app. `JarvisTodayDependencies.calendar` stays unavailable because the backend has no owner-facing calendar read route (calendar is agent-only), so Home says that instead of "not available". Workouts read the vault Gym log and were affected by the same notes parsing failure.
- Decision: refresh buttons are removed; every page uses pull to refresh. The plus sits beside the tabs. Home and Health share `JarvisPeriodSelector`. Sheets open at medium and expand to large.
- Not done: the Tasks tab keeps its date groups (no four-way segmented filter yet); Health sections are not restyled; the Home calendar has no data source.
- Not verified: no Simulator build or screenshots (Linux); the iOS app edits are not compiled here. JarvisCore tests (377) and backend checks pass.

## 2026-11-04 P15-76: Factory layout, shared search and headers

- Decision (superseded by the next entry for the project pill): on the Software Factory page the project and filter options sit under the hero, on the same row as the section title, not in a full-width bar above it. The bottom dock has no background; the segment pills and the search field are 12 pt apart.
- Decision: every page's search field is the shared `JarvisSearchField` (48 pt glass capsule; the text field has the identifier and the clear button `identifier.clear`). Health, Notes, Settings and Factory use it.
- Decision: all Factory kanban columns start collapsed (`defaultCollapsedColumns()` is every column); the owner expands each one.
- Decision: pages other than Home and Chat use `JarvisPageHeader` with the navigation bar hidden, so the shared ambient background shows through with no bar or line. Usage and Workspaces were the two that differed (own header; native large title with a bar and a material search background) and now match.
- Not done: the Notes tab row still sits between the title and the headline/hero; moving it under the hero needs every tab state (loading, empty, error) to render the row itself. Usage has no headline or hero yet. Settings is a list without a hero. Not compile-verified (Linux).

## 2026-11-04 P15-76: Factory filter button and task rows (board update from Dan)

- Decision: the project pill is gone. One round 48 pt glass funnel button (`factory.filters`, accessibility label "Filters" / "Filtre") sits right-aligned on the first section header row. Its small menu checks the selected project and also holds the agent and state filters. On the Releases tab, and on an empty board, it sits alone above the list.
- Decision: task rows inside a section are indented 16 pt, opaque, with a hairline outline, a 12 pt corner radius and a slightly smaller title (callout) and metadata (caption2). Section headers stay the larger glass buttons.
- Note: the board rows are in a `LazyVStack` and have no swipe actions today, so none were changed. Not compile-verified (Linux).

## 2026-11-04 P15-77: Build 67 feedback fixes

- Root cause, Factory "Offline": the board watch counted a cleanly closed event stream as a failure and only a "board" event reset the count, so three clean closes showed Offline while online. A load error also set Offline for any error. Now only network errors count, a connected stream resets the count, and a clean close is not a failure (`JarvisFactoryConnectionPolicy`).
- Root cause, hero count mismatch: the hero total counted only cards with a Jarvis task while the list shows every card. Hero, phrase and list now read the board columns.
- Root cause, calendar: the backend had no phone-facing calendar route and the app wired `JarvisUnavailableCalendarSource`. Added `GET /calendar/events` and `JarvisBackendCalendarSource`. Today also no longer skips loading notes when the calendar fails.
- Likely root cause, workouts: the vault listing is sorted oldest first and was capped at 4 pages (200 notes), so recent logs could be cut off; the cap is now 20 pages and Health cardio workouts are merged in. Not reproduced against production.
- Decision: large numbers use `JarvisNumberFormat.compact` (1.2k, 12k, 1M; Danish comma).
- Decision: every page except Chat, Settings, Voice and Home uses `.jarvisPageHeader` (transparent safe-area inset; content scrolls behind it). Settings keeps its list header. One loader, `JarvisLoadingView`, replaces all `ProgressView` spinners (guard test). A second row of tabs uses the full-width `JarvisSegmentedBar`; the Notes folder pills stay a carousel.
- Decision: Home and Chat share `JarvisComposerPlusMenu`. Home sends a typed message through `JarvisChatHandoff` (Chat sends it once its history is loaded, after a short lift-off animation that honors Reduce Motion); a plus-menu choice on Home opens Chat and performs it there. Home's old New task / New note entries were removed from the composer plus (the Home tiles remain).
- Not done / not verified: no Xcode in the sandbox, so none of the app-target UI was compiled or run on a simulator or device. Health data other than steps and cardio workouts is authorized but not displayed. Status and Proactive got the header, tabs and plus changes but no new hero. Hero icon colors on Factory use the existing tints.

## 2026-11-04 P15-79: Build 68 feedback, first slice
- Decision: every Apple Health workout counts on Home. `JarvisGymSessionType` gains `strength` (Health strength, shown as "Strength training") and `other`; both are excluded from manual logging (`loggable`). A Health strength workout is dropped only when a non-cardio vault gym log exists within two hours.
- Decision: Home's workouts card shows Active time and Active kcal (34 pt, hairline between) instead of a workout types list. Workout entries carry duration and active energy from HealthKit.
- Decision: the task checkbox is `JarvisCheckButton` (no border, animates to a check mark, then completes). The Notes search scope menu was removed; search covers notes and tasks.
- Not done: the rest of #1573 (page pattern tests, Health carousel, Notes hero and list, Factory layout). Nothing was compiled or run on a device.

## 2026-11-04 P15-79: One loading animation (item 17)
- Decision: `JarvisLoadingView` is the only loading animation, with `Size.area` and `Size.inline` variants. Busy buttons in `JarvisControls.swift` (4 sites) and the Settings loading skeleton now use it. The guard test also fails on `.redacted(reason: .placeholder)` skeletons and on any indeterminate `ProgressView` outside the view (determinate `ProgressView(value:)` bars and the WidgetKit Live Activity surface stay).

## 2026-11-04 P15-79: Notes folders collapsed and Recent strip
- Decision: Notes folders (Notes and List tabs) start collapsed on first open; expansion is per session (`@State`). The Notes tab shows a Recent strip (label "Seneste" / "Recent") of the 5 most recently modified notes, taken from the knowledge graph nodes via `JarvisNotesPresentation.recentNotes`. 140 pt hairline cards (radius 16) open the note. It is hidden when a folder filter is active, while searching, on empty or failed loads, and uses `JarvisLoadingView` for loading. The strip sits in the list head after the hero; moving the segmented bar below the hero (item 12) is still open.
- Not verified: nothing was compiled or run on a simulator; the UI test only asserts when notes data exists in the launch scenario.

## Daily renamed to Health; legacy feeds retired (P15-78, 2026-11-04)

- The legacy Daily calendar and Gmail feeds, the `daily_feed` tool and the calendar/attention Health query sources are deleted. Calendar and Gmail use only `apps/backend/src/google`. Tables are kept; no migration was added.
- Backend module, routes, web module, contracts and env switches are renamed to Health: `/health/*`, `JARVIS_HEALTH_ENABLED`, `VITE_HEALTH_ENABLED`. The old `JARVIS_DAILY_ENABLED` and `VITE_DAILY_ENABLED` are read as fallbacks.
- Temporary alias: every `/health/*` route is also served at `/daily/*` (`apps/backend/src/health/legacy-alias.ts`, nutrition export paths included). `/daily/capabilities` still reports `module: "daily"`. Remove the alias, the env fallbacks and the web `daily/*` redirect once no build 67 or earlier client remains.
- Stable identifiers are unchanged: source ids `daily.*`, SQL schema/table names, persisted view ids `daily-*`, `DAILY_HEALTH_*` host variables, and the `daily-health` lock name.
- iPhone sync: see the next entry.

## 2026-11-04 P15-80: On-device cache (stale-while-revalidate)

- `JarvisRepository` and `JarvisCache` in JarvisCore (`Cache/`) give stale-while-revalidate reads: fresh cache makes no request, stale cache is shown then refreshed, a failed refresh keeps the cached value and reports the failure. Freshness per kind: calendar 2 min, notes and tasks 5 min, Factory and status 1 min, usage 2 min.
- Storage is JSON files under the Caches directory (excluded from backup), one folder per account. SwiftData was not used so the layer stays pure Swift and testable on Linux CI. No tokens are cached; they stay in the Keychain.
- The cache is cleared on sign-out and on every new sign-in (`JarvisAppCache.clear()`); `bind(account:)` clears on account change.
- Conditional requests: the Usage client sends `If-None-Match` and maps 304; the backend emits ETags since P15-81.
- Signposts (`OSSignposter`, category `repository`) wrap each page open and refresh.
- Wired so far: Usage page (repository plus `LazyVStack`). Notes, tasks, calendar, Factory, status, proactive, Health and settings views still read from their clients and are follow-ups. Health stays read directly from HealthKit.
- Requests on Usage: first open 1, repeat open within 2 min 0 (before: 1 on every open). Not measured on a device.

## 2026-11-04 P15-79: Notes tab bar under the hero
- Decision: on Notes the Notes / Tasks / List / Graph bar is the last row of the scrolling head (header, phrase, hero, tab bar, Recent strip, list). It stays at the top only while the hero has no data (loading, error, empty), on Graph, and while searching, so the tabs are always reachable. Not compiled or run on a device.

## 2026-11-04 P15-79: Health plus menu reuses the Home log sheets
- Decision: Health's plus menu (log a workout, log a lift) presents `JarvisTodayGymSheet` with the Home model, exactly like the two Home tiles. The Health-only `JarvisHealthNewWorkoutSheet` and `JarvisHealthNewLiftSheet` are removed, so each sheet has one implementation. `testHealthPlusAndHomeTilesOpenTheSameLogSheetsInDanishAndEnglish` compares the sheet identifiers from both entry points. Not compiled or run on a device.

## iPhone Health sync into the existing ingest path (P15-78, 2026-11-04)

- The iOS app reads HealthKit (quantities, sleep, workouts; last 7 days per sync) in `apps/ios/Jarvis/JarvisHealthKitSync.swift` and posts a Health Auto Export-shaped payload to the existing `/api/health/ingest`. No new tables or migration: the existing normaliser writes the same `daily.*` tables the web reads.
- Idempotency: the payload is canonical, and `Session-Id` is `ios-` plus the SHA-256 of the payload (`JarvisHealthPayloadBuilder`), with `Automation-Id: jarvis-ios`. A retry of identical data is acknowledged; changed data gets a new id.
- Credential: the app obtains the Health upload credential from `/api/health/upload-credential` (create, rotate if one exists) and keeps it in the Keychain (`health-upload`). Rotating replaces the automations app credential, which is intended once parity is confirmed.
- Truthful status: the Sync button on the Health page shows complete only when every type was read and uploaded; otherwise it lists the missing types or reports failure. iOS does not reveal denied read types, so only failed reads are listed.
- iOS now calls `/health/*` and accepts module `health` or `daily`. The `/daily` alias stays until builds ≤67 are gone, since those builds are still installed; removal criteria above are unchanged.
- Not done: background delivery (`HKObserverQuery` / `BGTaskScheduler`) and a backend-side coverage readout beyond the existing `daily.sync` source.

## 2026-11-04 P15-81: Cache wired into all pages, ETag on the backend

- Status, Proactive, Settings, Health, Notes, Factory, Home (calendar, notes, tasks) and pending confirmations (new kind `notifications`, 30 s) read through `JarvisRepository`. Cached data shows at once, a stale entry refreshes in the background, and a failed refresh keeps the cached data visible. Pull-to-refresh, retry, live loops and SSE events force a refresh.
- Writes invalidate the affected kinds (`JarvisAppCache.invalidate` / `invalidateAll`): notes, tasks, Factory task creation, proactive feedback, settings, and confirmation decisions.
- Backend: `conditional-get.ts` adds a SHA-256 `ETag` and `Cache-Control: private, no-cache` to 200 responses of an allowlisted set of GET routes and answers a matching `If-None-Match` with 304. Mutations are never conditional. JarvisCore clients use `JarvisClient.conditionalGet`.
- Not cached: Health lifts, Notes search, graph and single-note reads, Factory releases, later pages of a note list. Health data reads are POSTs without a validator, so they only use the freshness window.
- Element-level loading: each Home card and Health/Notes/Factory section keeps its own state; the only loading view is `JarvisLoadingView`. `JarvisCachedSection` is the shared per-card loader.
- Requests per page (derived from code, not measured on a device). Before: every visit refetched. After: 0 inside the freshness window, 1 conditional request (304) when stale. Status 1→0/1, Proactive 3→0/3, Settings 1→0/1, Notes 3–4→0/3–4, Factory 2→0/2, Home 3→0/3.
- Not verified: no Xcode in the sandbox, so the app-target edits were not compiled or run. JarvisCore (`swift test`) and backend (`vitest`, `tsc`, `eslint`) checks pass.

## iPhone Health sync moves to an owner-only route with an anchor (P15-86, 2026-11-04)

- Replaces the P15-78 path through `/api/health/ingest`. The app now calls `POST /health/sync` with the normal owner sign-in; only the owner user token is accepted (agent, connector and other users get 401/403). The app no longer creates or rotates the Health upload credential, so the automations app credential is left alone.
- Body: `{ anchor?, samples[], sleep[], workouts[] }`; every row carries its HealthKit UUID. The backend validates strictly (ids, metric names, ISO instants, finite values, at most 20,000 rows, 8 MiB), converts the rows to the existing Health Auto Export shape and writes through the existing normaliser and `writeNormalized`, so the same `daily.*` tables are used. No migration.
- Idempotency: the ingestion id is `ios-` plus the SHA-256 of the sorted, de-duplicated rows, recorded in `daily.health_ingestions` under automation `jarvis-ios`. An identical retry returns `status: "replayed"` and writes nothing; the same id with different content in one request is a 400. Metric days are recomputed from the rows received, so the app sends each metric whole (one request per metric, one for sleep, one for workouts) and the incremental window starts at the start of the anchor's day. Workouts are keyed by their UUID. Nutrition metrics are read and sent but still dropped by the existing normaliser (Jarvis meals are canonical).
- Anchor: the end of the last fully read window, kept in `UserDefaults` with the last-sync time. A partial sync (a type failed to read) does not move it. First sync reads 7 days.
- UI: the Sync button becomes the shared `JarvisLoadingView` while running, then shows a success or partial line, or an error line with a Try again button, plus the last-sync time. All strings are in Danish and English (`JarvisHealth.strings`).
- Verified: backend tests/tsc/eslint and `swift test` for JarvisCore. Not verified: the app target was not compiled here (no Xcode); CI is the compiler. Background delivery is still open.
- Apple docs used: [HealthKit](https://developer.apple.com/documentation/healthkit), [Authorizing access to health data](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data), [HKSampleQueryDescriptor](https://developer.apple.com/documentation/healthkit/hksamplequerydescriptor), [HKAnchoredObjectQuery](https://developer.apple.com/documentation/healthkit/hkanchoredobjectquery) (considered; a date anchor was chosen so each metric day is re-sent whole), [Human Interface Guidelines: Loading](https://developer.apple.com/design/human-interface-guidelines/loading), [Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback), [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), [Privacy](https://developer.apple.com/design/human-interface-guidelines/privacy). Direct fetches of Apple pages were not verified in this environment.


## 2026-11-04 P15-85: Notes hero and rows, Factory layout, Home chips

- Notes page order is header, data phrase, Overview hero, the Notes / Tasks / List / Graph segmented bar, then the list; the bottom holds only folder chips, search and plus (the scope menu is removed). The hero (`JarvisNotesOverviewHero`) shows a link count, four hairline-separated columns (Notes, Open tasks, Overdue, Today) and a per-folder colour bar with legend from the graph (`JarvisNotesPresentation.folderShares`). A Recent strip (`recentNotes`) sits under the bar.
- Notes folders are collapsed by default: a rounded outlined header row (dot, name, count pill, chevron) and a transparent, 20 pt rounded, 0.5 pt outlined container indented 16 pt with hairline row separators. Content has a 190 pt bottom inset.
- Factory: the filter moved from the header to the second row, right of the segmented bar; the dock holds only search and plus. Columns already start collapsed.
- Home: Today / Tasks due use the full-width `JarvisSegmentedBar` with the plus on its right.
- Home composer (checked by reading code): `sendDraft` plays the lift-off animation then hands the text to Chat, which sends it once history has loaded. Every plus-menu choice is handed to Chat, which performs it (video and screen share turn on there). Same `JarvisComposerBar` and `JarvisComposerPlusMenu` as Chat.
- Not verified: no Xcode in the sandbox, so the app-target edits were not compiled or run. JarvisCore `swift test` passes. HIG pages used: Layout, Lists and tables, Segmented controls, Menus, Typography.

## 2026-11-04 P15-82: Gym and Factory home screen widgets

- Eight widgets (four Gym, four Factory) live in the existing `JarvisWidgets` extension next to the Live Activity. No controls, no Live Activity change.
- The app writes one versioned JSON snapshot (`widget-snapshot.json`, `JarvisWidgetSnapshot`, version 1) into the `group.com.danaakesen.jarvis` container; the widgets only read it. It holds display numbers, localised task text and opaque task/confirmation ids. No tokens or secrets. Each topic (Gym, Factory) is a section with its own status and age, so one failed refresh never blanks the other.
- Timelines are scheduled, not pushed: `JarvisWidgetTimeline` emits an entry now and one when the data turns stale (two refresh intervals: Gym 30 min, Factory 15 min) and asks WidgetKit to reload after one interval. Stale data stays on screen with "Opdateret HH:mm". A failed refresh keeps the last values and marks them stale.
- Widget buttons are only immediate actions: Godkend, pause, resume, retry as App Intents, bare icons with no text. The intent calls `JarvisFactoryWidgetActions`; the app installs the handler that holds the authenticated clients. If the intent runs in the extension process, the tap is queued in the App Group (action and id only, dropped after 15 minutes) and the app drains it on its next refresh. Approve needs device authentication.
- Colours: orange accent; blue only for runs versus lifts; red for failed. The only ring is the Gym medium steps ring.
- Not verified: no Xcode in the sandbox. JarvisCore (`swift test`) covers the snapshot, builders, timeline and action queue. The widget views, intents, previews, the HealthKit workout query and the app publisher were not compiled or rendered; Mac compile, preview and device checks are pending. Apple docs used: WidgetKit (Keeping a widget up to date, Making a configurable widget, Adding interactivity to widgets and Live Activities), App Intents, HIG Widgets.

## Health hero carousel and charts (P15-83)

- The Health page hero is a swipeable carousel (Training, Sleep, Nutrition) with equal card height and page dots. Every Health bar chart uses `JarvisHealthBarChart`: headline is the average (or the tapped day; tap again to return), target chip and dashed target line, weekday labels, bars grow from the baseline.
- Chart value logic (`JarvisHealthChartValues`) lives in JarvisCore and is unit tested. Missing days stay empty; averages only use recorded days.
- Sleep goal (default 8 h), kcal (2200), carbs (250 g) and fat (70 g) goals are stored on the device (`JarvisHealthGoals`, Settings > Health goals) because the Daily target API only serves training and resting/deficit/protein targets. Protein keeps using the server target.
- The hero reads sleep and nutrition days for the last seven days whatever the selected period. The separate Nutrition panel was removed; its protein chart is the Nutrition hero chart. HealthKit already requests every readable type (`JarvisHealthKitAccess`); shown data comes from the Daily reads and shows an empty state when there is none.
- Not verified: no Xcode in the sandbox, so the app-target edits were not compiled. JarvisCore `swift test` passes.

## 2026-11-05 P15-90: Pages stuck on loading in build 71

- Cause: the build 71 Health conditional reads still requested `/daily/*` (capabilities and both target routes) while the backend serves `/health/*`, and a repository refresh had no hard bound, so a stalled request kept pages on the loading view. Notes also reused its loaded state after a change because the reload after a save or create was not forced.
- `JarvisRepository` now bounds every refresh (`JarvisRepositoryKind.refreshTimeout`, 20 s). A timeout ends in `failed(JarvisClientError.timedOut)`; cached data stays visible, otherwise the error state with pull to refresh shows. `JarvisCachedSection` also turns a stream that ends while still loading into the error state.
- The iOS client uses `/health/*` only. `JarvisRepositoryTests` fails on any `path: ["daily"` in JarvisCore, and `apps/backend/src/health/ios-route-contract.test.ts` checks every client `/health/*` path against the backend routes.
- Notes forces a reload after a save, create or task change (`refreshVersion > 0`) in addition to the existing cache invalidation.

## 5 November 2026 — P15-92 shared native page implementation

Implement the owner's build-74 reference from #1603 through shared SwiftUI
components: section headlines, grouped rows, one initial page skeleton, and
confirm-left/cancel-right sheet actions. Keep native 44-point targets and Dynamic
Type even where the HTML board draws a smaller period control. Use the existing
Mac screenshot workflow; its selected component UI suite now exercises the page
order, loading controls and sheet-action geometry. This records implementation
of the approved issue; native visual acceptance remains pending in
`ios/design/p15-92-verification.md`.

Dan approved a narrow exception to #1598's prohibition on editing `ios-ci.yml`:
run the existing screenshot artifact upload with `if: always()`. Run 42075818100
had captured images but skipped their upload when it reached the job timeout.
Keep the existing runner, test selection and timeout; this change preserves
available evidence and does not turn failing tests into successful tests.

## 5 November 2026 — P15-93 Notes follows the published three-tab board

Issue #1599 and board PR #1603 supersede P15-12's separate List tab. Notes owns
root/direct-folder browsing with Back and a count derived from the displayed
notes. Root notes use the backend's empty folder string; the client must not
reject them as malformed summaries. Recent tracks successful openings in the
account-bound cache, survives note refresh, and clears on sign-out.

The New note picker stages a child of the open folder and explains that the note
save persists it. The separate New folder sheet uses owner-only `POST /notes/folders`;
the backend writes an empty `.gitkeep` marker so Git can retain a folder without
inventing a note. The folder inventory already includes paths from non-Markdown
files, while the marker never enters note counts or the graph. The existing
task-create route gains optional normal/medium/high priority, encoded with the
same Markdown markers used by task editing; old callers may omit it. The backend
and folder-creation changes must be deployed before releasing the new client.
No deployment is included.

Graph nodes share folder colors with the legend. Labels appear for search or
selection, with an explicit Open action; accessible titles/folders remain on all
nodes. Native visual acceptance is pending in `ios/design/p15-93-verification.md`.

## 5 November 2026 — Home and Factory follow the merged board (P15-94 / #1600)

Keep Factory's Needs Dan tasks in Board while removing its separate tab. Board
and Releases share one glass segmented surface. Preserve default collapsed
columns, indented outlined rows, filter placement and search/create placement;
legacy Needs Dan screenshot entry expands and reveals that column.

Home uses the shared row spacing and separators and keeps Today / Tasks due,
as shown by the merged board. Issue #1600 explicitly gives the board precedence
over conflicting grouping feedback. The Delegated wording remains an open
clarification, not a new task-data contract. Native visual acceptance is pending.

## Native board corrections supported by screenshots (Refs #1600; 5 November 2026)

Factory UI tests now use the existing Simulator navigation fixture, the observed Button role for GitHub links, and explicit expanded/title/hittability checks. The default failure recording showed a sign-in cover; the legacy-entry accessibility tree showed the task action.

## 5 November 2026 — Health source parity and dashboard (P15-95 / #1601)

Use merged HealthKit statistics for step counts; raw overlapping source samples
were being added by the normalizer. Re-read 30 days of steps/workouts/body values
for late or corrected records. Display current permitted phone readings without
requiring an upload, while keeping retained server data and failures visible.
Keep Copenhagen day boundaries and recognize older numeric workout names.

Read Home's existing vault lift notes into Last lifts instead of changing or
migrating the owner's logging workflow. Bound note reads and disclose partial
coverage. Keep the board's three hero periods, one training donut and section
order. Body trend uses a labelled 30-day window and dated values. This is local
implementation; native visual and real-device HealthKit acceptance are pending.

P15-95 also labels HealthKit body-fat values as fractions (0–1), allowing the
existing normalizer to retain the correct percentage (0.20 becomes 20%).

## Native board corrections supported by screenshots (Refs #1601; 5 November 2026)

Last lifts is an explicit accessibility container so its Log child keeps its identifier. The native test retains the Log-to-shared-sheet assertion and scrolls in bounded short steps. The first native comparison prompted a compact chart headline, Training divider and smaller shared hero/chart geometry.

Fresh Mac verification is pending. This workspace has no Swift or Ruby executable;
the unchanged pipeline suite currently reaches 59 passing cases and 15 setup errors
from missing Ruby. No project/workflow change, merge, deployment or TestFlight upload.


## 5 November 2026 — Health summaries use recorded data for the selected period

Sleep and Nutrition summaries now follow the selected period. Core regressions
cover bounds, missing observations and duplicate daily records. Sleep uses stage
proportions and real average/night-count summaries; bedtime/wake-up are absent
from the current contract. Nutrition shows actual logged meals without a target.
See `p15-95-verification.md` for screenshot provenance and pending native checks.


## 2026-11-05: P15 Health backlog and retained history

Use anchored HealthKit query pagination and complete-day upload requests rather than discarding a quantity at the whole-window cap. Keep the existing owner-only API and 20,000-item request bound; reject an oversized single day honestly, before any upload. A partial local step snapshot replaces only matching Copenhagen days and cannot mark retained history fresh. Regression tests cover multi-day backlogs, rejection, local midnight and explicit zero readings.

## 5 November 2026 — P15-96 current Usage response and remaining board pages

The Usage decoder required `dailyToolUsage`, whereas the current backend emits
`healthToolUsage` and period `toolCalls`. Accept both current responses and old
cache entries, keep the scopes separate, and report missing counts as unknown.
Retain the existing conditional-read and account/period cache boundary. New
regressions cover the actual backend shape, legacy data, every period's ETag
read, invalid counts, rolling range edges and the all-time chart cap.

Audit Usage, Status, Proactive, Notifications and Workspaces against the
published reference and shared page pattern. Workspaces has a separate older
reference; do not call the main board's Home fallback a Workspaces reference.
Keep native interactions and Dynamic Type. Shared grouped rows replace the
remaining inconsistent notification/source layouts. Status exposes stale
evidence and real check details. Successful background jobs stay out of the
notification sheet through its existing presentation model.

Local validation: 474 Core tests and 23 backend Usage/Now-feed tests pass.
Native screenshots and owner acceptance remain pending; the cloud network
policy still blocks the artifact download host. No pixel-match claim is made.


## 5 November 2026 — Preserve Status state text and truthful screenshot fixtures

Native evidence exposed a clipped Status state label and a Notifications capture
covered by sign-in. The row reserves readable state text, stacking it at large
Dynamic Type; the test uses the existing Simulator navigation argument. Usage
emphasizes the selected/latest bar. See `p15-96-verification.md`. Corrected native
verification is pending; previous UI-test success is not visual acceptance.

## 5 November 2026 — Preserve shared heading contrast inside List

Native Workspaces screenshots show List section headings dimmed twice by the
inherited foreground style. The shared component now uses explicit semantic
`Color.secondary`; see `p15-92-verification.md` for image provenance. The prior
head passed 46/46 UI tests. Corrected native captures and owner acceptance remain
pending. No additional workflow/project change or release action is included.

## 6 November 2026 — Confirm successful native actions

The owner explicitly requested subtle haptics and interruptible completion feedback
for lift saves, tasks and note creation. Notes introduces the reusable confirmation
and applies it after successful client writes. No API or persistence contract changes.
Physical haptic feel remains a device check; simulator verification is pending.

## 6 November 2026 — Restore the working Linux Swift runner for release

GitHub changed ubuntu-latest to Ubuntu 26.04 during this authorised release.
Both Notes job 127618762897 and integration job 127619905299 failed before tests:
the pinned setup-swift action does not support 26.04. The earlier combined Core
job 127601636763 used Ubuntu 24.04 and passed 493 tests. Pin only the Linux job in
`ios-ci.yml` to ubuntu-24.04, restoring that known working environment. This is a
necessary compatibility exception to the board issues' no-workflow-edit scope,
within the owner's subsequent instruction to finish verification and release
directly. It does not change checks, Mac execution, signing or TestFlight. Recheck
CI rather than treating the infrastructure failure as a successful test result.

## 6 November 2026 — Shorter Home and successful-action polish

The owner selected these two previous suggestions for this release. Home keeps
event/task priorities while health stays in the cards. Confirmations follow successful
writes, and Home completion errors are surfaced rather than swallowed. The existing
lift/workout saved state remains persistent and dismissible. No Chat change, backend
contract change or new dependency is required. Native verification is pending.

## Health page accessibility (5 November 2026)

The Health hero indicator previously announced page position but offered no adjustment, and the explicit page transition ignored Reduce Motion. Keep the native pager and existing visual geometry, expose bounded increment/decrement actions on its indicator, and disable the explicit animation under Reduce Motion.

## 6 November 2026 — Correct native accessibility-size overlap

Insights run 42124893661 passed 50/50 native UI tests, but screenshots at accessibility
XXXL exposed transparent-header overlap, clipped totals and crowded period labels.
The shared header/controls and Usage layout now adapt at accessibility sizes. Chat
has no callers of these components and is unchanged. Fresh native captures remain
required; the previous test pass is not visual acceptance.

## 2026-11-05 — Extend the approved board alignment to Settings and Voice

The owner expanded the non-Chat page scope to include Settings and Voice and
authorized TestFlight after verification for the 6 November morning target.
Settings adopts the board's bottom segments and meaningful section groups while
retaining existing native detail/save flows. Large text uses a scrolling segment
strip and stacked row values. Chat and the shared orb remain unchanged.

## Settings native geometry correction (5 November 2026)

Native artifact 13461059102 exposed truncated four-way section labels and decorative symbols expanding beyond their reserved row width at accessibility XXXL. Use the existing continuous glass segmented bar from P15-94, with its full hit target, switch Settings to the shared scrolling strip above default text size, and retain fixed semantic symbol geometry. Existing callers keep their defaults; Chat is unchanged.

## 6 November 2026 — Final combined native findings

Run 42134678739 compiled and passed 61/62 UI tests. The new completion test opened
Tasks due for fixture tasks due today; the recording confirms the production
split is correct. Select and expand Today while retaining both removal and
continued-usability assertions. Explicitly select dark for the lift success capture.

Actual Health images still showed truncated monthly endpoint dates and normal-size
rows behind the pinned title. Use native AxisValueLabel anchors/intrinsic width and
restore the iOS soft scroll-edge effect, retaining the AX material. Apple API docs
were read directly; no new dependency or custom blur is needed. Verify these actual
findings in one combined Settings run before the final merge. Chat remains unchanged.

## 6 November 2026 — Explicit native material behind scrolled custom headers

Run 42141442953 passed all 62 UI tests; the later standalone capture sweep timed
out with attachments retained. Monthly endpoints and task/lift feedback are
accepted from actual images. The shared soft scroll-edge style did not prevent
rows crossing the custom header. Observe the Boolean top-edge crossing using
onScrollGeometryChange and add native regular material only while scrolled.
Preserve the transparent resting board and existing AX material. Recheck the
same native suite once for this observed finding; keep all assertions and avoid
a duplicate integration run. Chat and signing remain unchanged.

## 6 November 2026 — P15 release acceptance

Accept the final combined source after 62/62 native tests, 493 Core tests, CodeQL
and actual screenshot inspection. Merge Settings last, compare the complete
app/test tree, and upload through the existing TestFlight workflow after the Notes
backend dependency passed readiness and live acceptance. Build 75 uploaded
successfully at 02:54:03 UTC. Chat and the shared orb remain unchanged.
See `ios/design/p15-release-2026-11-06.md` for exact evidence and device limits.

## 6 November 2026 — Match task rows to the owner's board

Correct Notes → Tasks from the owner's supplied device and board screenshots.
Use the shared quiet checkbox, explicit rounded group boundaries and one compact
metadata line with a trailing due date. Keep native List swipe behavior and existing
confirmed-write feedback. Render Markdown titles for display only; preserve stored
source. Expand the synthetic fixture because a single short task failed to expose
this discrepancy. Native screenshot acceptance remains pending. Apple's Lists and
tables guidance supports succinct rows with full detail disclosure; the exact
composition and geometry come from the approved board.

## 6 November 2026 — Collect owner feedback before qualification

The owner is testing build 75 and explicitly paused CI until saying OK. PR #1614
was opened immediately before that instruction; all triggered CI/native/CodeQL
runs were cancelled and the PR was converted to draft. Do not push this local
batch, restart checks, merge or upload until the owner releases the hold.

Apply shared selector geometry and press feedback at the component layer, including
periods and scrolling alternatives. Use primary foreground for section headings.
Replace the manual Health sync block with pull-to-refresh on Health and Home,
awaiting Apple Health ingestion before fresh reads. Coalesce overlapping sync
requests and retain honest failure/partial feedback. No new native acceptance is
claimed. Apple's glassEffectID guidance was read for matching glass shapes within
a GlassEffectContainer; exact response/padding remains an app design choice.

## 6 November 2026 — Tool diagnostics and one native conversation

The owner expanded the held batch to cover reminder failures, general backend
schema/error visibility, first-launch voice, missing voice transcripts and Home
send/camera handoffs. This authorizes functional changes to Chat; it does not
change the agreed Chat appearance or release hold.

Expose exact tool schemas through named capability lookup and voice discovery,
retaining provider-specific flattening only where function registration requires
it. Route strict voice validation through the same bounded explanation path as
HTTP, and derive generic constraints from registered schemas. Accept one-shot
reminders and normalize equivalent zoned times without relaxing owner intent,
quiet hours or duplicate-write protection.

Keep one visible chat/voice history, with transport IDs internal. Notify history
readers after transcript persistence, bind pending Home actions directly, and wait
for initialization before automatic send. Activate the audio session before
building its graph and make capture startup/readiness failures recoverable.
373 backend tests passed; the final shared-schema follow-up passed 101 affected
tests, build and lint. Native compile, actual cold-start reproduction and device
verification remain pending under the owner's hold.


## 6 November 2026 — Approved workflows and resumed release

The owner accepted the everyday-workflow assessment and clarified that self-change
covers features as well as bugs and always needs his approval. Implemented shared
identity revision 2 and server-side own-repository proposal gates, retaining the existing
Factory execution and confirmation machinery. Ordinary task/reminder requests use
high-priority vault tasks so the existing Azure job discovers them. An explicit
at-time marker avoids silently sending the legacy one-hour warning. Independent
and recurring schedules retain owner_reminders, without changing task deadlines.

The owner then requested animated loading throughout the app and explicitly
approved building and releasing after checks and UI inspection. This supersedes
the earlier no-CI hold. Shared shimmer and active-scene dot animation are included.
Native qualification, backend/agent readiness and TestFlight upload are still
pending; do not interpret authorization as evidence that those steps passed.
## 2026-11-06 — Keep selector text in the native glass content layer

Actual captures from native run 42185446322 exposed label refraction despite all
68 UI tests passing. Apply the effect directly to the padded label-bearing view,
as described in Apple's [custom Liquid Glass guidance](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views),
instead of a detached clear background inside GlassEffectContainer. Keep a quiet
material rail, native selected-lens interaction and shared press timing. Complete
labels fall back to scrolling when a segmented row cannot fit. Explicit compact
priority metadata and bounded completion glyphs address the accompanying task-row
layout defects. The retained images establish the defects; corrected Simulator
inspection is still required. The Apple Markdown documentation was read directly
after the connected web reader could not consume its Markdown content type.

Final qualification: run 42202162500 passed all 68 UI tests, and corrected native
task/selector captures were inspected. The verified candidate merged through
#1614 as ab464314. Backend deployment, comparison activation and TestFlight
outcomes are recorded separately in the device-feedback delivery record; this
source qualification does not by itself establish those live outcomes.

## 6 November 2026 — Release verified app while comparison activation continues

The normal backend dependency and live conversation acceptance passed before
TestFlight dispatch. Upload the accepted app source independently of the optional
Copilot comparison repair, following the owner's release authorization and existing
partial-delivery cadence. Build 76 uploaded from ab464314 at 12:14:34 UTC; Apple
processing remains unconfirmed. Runtime availability continues to enforce its
existing verification boundary. A selectable option alone never proves inference.

After provisioning returned only azure_request_failed, add content-free operation
diagnostics and a separate GET-only inspection mode before any mutation retry.
PR #1615 preserves ownership/identity checks and exact-version reuse after an
uncertain write. It adds no grant, default runtime change or automatic write retry.
Its CI/CodeQL passed; live inspection and activation outcomes belong in the
device-feedback delivery record.

## 6 November 2026 — Preserve per-turn policy in supported managed input

The live Copilot canary reached the provisioned target but rejected top-level
instructions with HTTP 400, invalid_payload, parameter instructions. Send the
complete composed policy as typed developer input, which the documented Foundry
message contract gives precedence over user input. Preserve the original roles
of references and tool outputs. Both actual turns and the canary use the same
request builder; do not replace the canary with a simpler request that bypasses
the failed policy path.

Send full policy at each application turn and exact policy change. A turn-local
cache avoids identical tool-continuation repeats and updates only after response
creation returns. Native policy input persists once per turn/change; no history
deletion or new database state is introduced. Existing claims and uncertain-write
handling remain unchanged. PR #1619 passed CI/CodeQL and merged as cac5d05d;
live provider acceptance is recorded separately in the delivery record.

## 6 November 2026 — Owner corrects Body trend and shared surfaces

The owner rejects measurement rows and flat selector/header/dock backings in
build 76. Replace Body trend rows with real date-aware native plots, preserve a
single observation as a point and expose measurement details. Separate units and
mark partial/stale data. Use one content-bearing clear-glass surface for joined
selectors to match Search without nested refraction. Medium widgets share top-left
headings and compact content within their existing margins. These are approved
choices; fresh native evidence is required before release.

The first Copilot request matrix succeeds for plain/simple-user messages but fails
for typed developer/full-policy requests. Keep both role and encoding as hypotheses;
qualify fixed controls before changing the trusted policy transport. Diagnostic
completion is not comparison acceptance.

## 6 November 2026 — Correct rendered detail loading and require policy compatibility

Native 7acb inspection confirms blank measurement detail due to its initial empty
Group; mount a concrete loading container before data. Preserve decimal readings
in graph/records and selected reading/scroll on Back. AX charts fit; use slow held
test drags to avoid coast, keeping full visibility assertions. Widget headers fit
with a 1.17 pt optical symbol/text offset; allow up to 2 pt within unchanged 16 pt bounds.
Fresh native qualification remains required: df56bcaa retains e0d6821e’s
app/test tree and corrects two archive-retention assertions. CI, 502 Core tests
and CodeQL passed; native 42258268925 remains active.

The stored trusted-role diagnostic also failed policy application after user-only
requests succeeded. Do not discard or demote Jarvis policy to enable Copilot. The
compatibility gate requires exact target/model/effort/transport evidence from two
full-policy precedence/replacement turns; discovery and execution both enforce it.
Give web/iOS a specific explanation while Current remains usable. This is a
reviewed correction direction; deployment and live verification are recorded
separately and must not be inferred from local tests.

## 6 November 2026 — Rendered task headings and native failure boundaries

The df56bcaa images show sticky plain-List task-group headers covering rows in both
languages. Keep each heading as a clear first row in its section, preserving native
swipe actions. Reuse primary-color section headings throughout Health details.
These are actual rendering corrections, separate from test-only widget AX text
width and camera-menu synchronization assumptions. Do not add camera delays or
retry taps without a confirmed application defect. Retain both widget languages
before assertions and every failed attempt's evidence. Candidate dce71639 includes
accepted main and needs its own exact CI/native qualification before release.

## 6 November 2026 — Reuse settled widget geometry within unchanged assertions

The dce71639 gallery exceeded 120 seconds because each repeated AX frame/identifier
query crosses the application boundary. Read one snapshot per settled element and
reuse its frame; retain every bounds, alignment and disabled-action assertion.
The other 67 native cases passed and all production source is unchanged. Run only
the corrected gallery with the same limits, exact-source provenance and failure
artifacts. Both language widget captures and corrected heading/scroll views were
visually accepted; this does not establish SpringBoard or physical-device behavior.

## 6 November 2026 — Release the verified UI corrections as build 77

PR #1621 merged at 380782a0 with identical qualified full/app trees. Accept native
coverage as 67 unchanged full-suite passes plus one corrected gallery-only pass,
with explicit source proof and actual bilingual captures. Keep the failed full-run
record. Normal Deploy 42281871580 passed readiness and all 15 Current checks before
unchanged TestFlight 42282578034 uploaded build 77 at 19:54:10 UTC / 20:54:10 Copenhagen.
Copilot remains unqualified because trusted-policy compatibility failed; this
release does not activate it or treat plain provider responses as sufficient.

## 6 November 2026 — Home hierarchy and transparent chrome follow-up

The owner requests Home, Quick actions and Upcoming section headings; larger
left-aligned hero titles with equal top/leading inset; right-aligned periods;
orange calendar/task icons; native task swipe completion; transparent headers on
all other pages and transparent Notes/Factory footer containers. The owner also
accepts loading animations, which remain unchanged. Implement these through shared
hero/header/background components and the existing native List and completion
path. Source implementation is prepared; new rendered acceptance is pending.

## 6 November 2026 — Route every widget tap to its topic

The owner accepts widget layouts and requests matching-page navigation. Gym and
Factory lacked widgetURL, and Info.plist did not register the scheme already used
by Notes/Home. Apply one topic URL at the shared configuration root, remove the
six child modifiers, and register the scheme alongside Microsoft authentication.
Keep existing root navigation and the authentication gate. Verify actual cold/warm
URL delivery; native rendering and physical WidgetKit-host taps remain distinct.

## 6 November 2026 — Correct Home geometry measurement and largest-text layout

Native 42292434058 passed 69/70 cases. Actual normal Home padding is correct;
the glass accessibility frame excludes painted insets. Measure from the page and
section heading instead. AX XXXL captures show crowded Home tiles/activity values:
stack those groups and permit action-label wrapping. Keep the 69-pass failed run
as evidence, rerun affected Home/widget paths, and prove other page/Chat source
unchanged rather than repeating the entire suite/capture sweep.

## 6 November 2026 — Release Home/chrome/widget corrections as build 78

Merge qualified c4e14155 as ca5ca838 after CI/CodeQL, actual normal/AX screenshot
review and 15 focused Home/widget passes. Retain 55 unchanged native cases with
source proof; keep the prior failed geometry assertion in the record. Full/iOS
trees match after merge, so cancel automatic main Simulator before boot. Normal
Deploy 42306089293 passes readiness and all 15 Current checks, then unchanged
TestFlight 42306553415 uploads build 78. Widget destinations retain sign-in/lock
handling; loading motion, widget appearance and Chat appearance are preserved.

## 7 November 2026 — Use required structured input for managed policy

Use Microsoft's documented agent instruction templating to carry the complete
current Jarvis policy, instead of response instruction overrides or developer/system
message roles that the live harness rejected. The single required string has no
default; user/reference/tool data cannot populate it. Every response supplies the
current policy, including continuations and mode updates. Pin and hash the exact
template/schema and bump the transport receipt revision. Keep the two-turn policy
precedence/update canary as the activation boundary. Availability skips readback
when missing activation evidence already proves unavailability. Live compatibility
remains pending; a failed canary must leave Copilot disabled.

Sources reviewed on 7 November: [Structured inputs](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/structured-inputs),
[Copilot harness](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/use-tools-skills-copilot-harness)
and [service limits](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/limits-quotas-regions).

## 7 November 2026 — Classify the failed Copilot policy probe

Structured-input activation 42365966747 returned completed text but failed the
exact policy sentinel. Keep Copilot disabled. Add only a synthetic turn number
and closed streamed/final text classifications so the next bounded check can
distinguish ignored policy, stale policy, extra text and a streaming discrepancy.
Do not print response text, weaken exact matching or reinterpret normal Current
acceptance as Copilot compatibility. Reuse the matching agent version; retain this
failed attempt and require live evidence before changing the transport again.

## 7 November 2026 — Darken widget labels and replace Notes with Tasks

Follow the owner's screenshots: use one darker light-mode supporting text style
across all Home Screen widget families and preserve accepted layout/accents. Keep
stale timestamps explicit without fading light-mode content. The Notes widget is
now Tasks: remove latest-note content from all sizes, show due-today tasks and make
its tap select the Tasks tab. Retain installed kind IDs/URL compatibility and the
snapshot format. Drop the publisher's unused Notes fetch so Tasks availability
cannot depend on it. Existing in-app Notes functionality remains unchanged.

## 7 November 2026 — iOS activity cleanup and reliable Tasks widget routing

The owner removes Away mode from iOS and asks the Now bar to disappear when empty.
Use the visible background-job presentation for both sheet and bar, preserving
failed/active jobs and approvals. Retain backend/web presence semantics. Native
widget checks exposed task-tab handoff failure; one root-owned binding replaces
the consumed request. Separate per-language widget checks preserve the original
geometry assertions and deadlines while avoiding repeated AX round trips.

Instrumented Copilot activation confirms initial structured policy works but a
second policy is ignored in the same native conversation (42369093453, turn 2,
stream/final previous_policy). Keep Copilot disabled; faithful policy-update
compatibility is not established. Do not deploy during the owner's E2E project test.

## 7 November 2026 — Chat feedback, selection and oversized GitHub reads

Confirmed owner requests: persist Settings labels; select reply text natively;
size short owner bubbles to content; show one copy per sent message; show an
acknowledgment and live tools followed by collapsed tools beneath Jarvis's final
reply; keep working/reconnecting status visible until the turn ends. Exact saved
identity replaces steering placeholders; text matching is not a deduplication key.
Stopped recognition sessions invalidate queued callbacks before cancelling audio.
History grouping cannot transfer calls across voice/chat/test sessions.

A real read showed issue page 7 at 1,099,352 bytes, exceeding the existing 1 MiB
limit. Preserve the limit and split oversized windows, with no writes or partial
allocation. The corrected read returned all 1,626 records. Keep own-code approval
requirements unchanged. Native candidate checks remain pending.

## 7 November 2026 — Release the qualified Chat, Settings and scaffold fixes

PR #1629 is merged as 2504bc6a. Exact-head CI/CodeQL, 20 scoped native cases using
unchanged-source reuse, and retained widget/navigation evidence qualify this batch.
Failed fixture attempts remain recorded; the final two cases pass in 42377707190.
The merged full/iOS trees match the tested source, so main Simulator 42378965945
was cancelled before boot. Accepted normal deployment 42378966004 precedes the
single TestFlight upload 42380495562, build 79. Preserve the owner's separate
approval before creating the widget issue/starting its coding task. Copilot's failed
second-policy check remains a separate unresolved limitation. See the scoped
release record for hashes, visual review, upload time and device-only checks.

## 7 November 2026 — Reopen build 79 regressions; recover actual issue proposals

Owner screenshots supersede earlier acceptance of sent-draft clearing, progress
and transparent chrome. Track all reports in the build 79 feedback ledger and
qualify the actual focused-keyboard/scrolled states. Factory will expose its saved
proposal to the next verified conversation turn, following the existing Calendar
recovery pattern; a guessed create retry must not overwrite approved scope. Keep
later-message approval, session isolation, expiry and at-most-once consumption.
Process-local proposals remain unavailable after restart; report that honestly.

The independent review also confirms that fresh own-repository replacement staging
is permitted after missing/expired state, while the current yes cannot approve it.
This avoids a recovery loop without approving or writing anything implicitly.

Native verification found that replacing the SwiftUI editor to clear it dismissed
the keyboard, and vertical TextField Return inserted a newline despite its Send
label. Use one stable UIKit text view in the shared composer, with explicit Return
handling, ordinary focus ownership and revision reconciliation. Preserve composition,
paste and the existing size cap. Keep the failed run and verify all three callers.


### 7 November 2026 — selected Notes library refinement

The owner selected Recent Focus with pinned notes, recents and optional folder
browsing, retaining the Notes / Tasks / Graph entry point. The requested revision
uses title-led pinned tiles in a horizontal carousel, moves their pin icon to the
section heading, and places New folder at the browse sheet's bottom right. Preserve
the approved rendered editor and visible Raw access to complete Markdown/metadata.
The revised image is a design target; build 80 does not implement this redesign.

## Copilot policy refresh implementation (7 November 2026)

The provider captures structured policy when creating a native conversation. The
managed adapter now starts a new provider conversation for every verified Jarvis
turn and whenever policy changes during a tool loop. It seeds the same verified
Jarvis history and completed tool call/output pairs without rerunning tools or
promoting content to instructions. Unchanged-policy continuations send only deltas.

Native rebinding uses the active source claim plus an exact compare-and-swap of the
previous native ID. Owner/session checks, consumed-source deduplication, uncertain
turn locks and immutable target checks remain. No database schema change is needed.
The compatibility revision is jarvis-fresh-policy-v2; previous receipts cannot
enable this transport. The synthetic two-turn gate uses the production rotation
helper and includes the earlier assistant answer in the second request.

Focused local agent tests: 116 passed. Backend route/store/compatibility tests:
39 passed before adding the additional compare-and-swap test. Type checking passed.
Full CI, SQL integration and live activation remain required before availability.
## 2026-11-07 — Complete the approved delivery bundle

The owner explicitly requests Factory end-to-end operation with 128 GiB workspaces,
a working Copilot harness and comparison, Notes redesign and Ember background now.
This supersedes the earlier next-build hold. Notes and Ember implementation is on
the delivery branch; native qualification and release remain to be established.
Local account-bound pins avoid modifying vault metadata. A lossless Markdown
projection keeps Raw as an exact escape hatch and preserves existing conflicts.
## 2026-11-07 — Provision a persistent 128 GiB Factory worker

The owner explicitly authorized this migration and asked for working end-to-end
delivery now. Foundry sessions expose no supported 128 GiB storage setting, so
Factory coding uses a separate disk-backed worker. The backend remains available;
worker compute deallocates when idle and its disk remains. A private identity-based
mailbox avoids public ingress and additional API application-role bootstrapping.
Qualification must prove capacity, provider access, idle deallocation and the
existing task-23 recovery path. Source implementation is not live acceptance.


### 7 November 2026 — Copilot qualification and Notes/Ember delivery

Copilot PR #1639 deployed; the refreshed production definition passed the live
two-turn policy canary in run 42418951594 at 22:10 UTC. The comparison option is
enabled and Current remains default. Owner multi-turn/tool quality comparison is
still pending. Notes/Ember PR #1638 merged as a55e7350, with full CI 42418217434
and native verification 42417916004 passed. TestFlight 42419435807 successfully
uploaded build 82; Apple processing and device acceptance are not inferred from upload.
The 128 GiB worker remains in PR #1640 until qualification/provisioning passes.


### 7 November 2026 — Factory worker live provisioning failure

PR #1640 merged as a59ed107 after CI 42421336106 passed. Backend release
42422162191 passed readiness and live conversation acceptance. Runner workflow
42422208795 built both images, then failed the Azure deployment before activation.
The script omitted the underlying Azure error identities; add bounded code-only
diagnostics and read-only failed-deployment inspection. Reuse the already-built
image only with source qualification and unchanged build-context checks. The 128
GiB workspace is not yet confirmed provisioned, and task 23 has not been recovered.


### 7 November 2026 — Preserve Azure CLI inner error identities

Read-only inspection 42425496166 confirms no Factory VM exists. Reusing the qualified
image in 42425613824 again failed validation before activation. Azure CLI can emit
its general InvalidTemplateDeployment error separately from the detailed inner
errors; diagnostics now collect every bounded code-only JSON segment and embedded
Code field. The workspace remains unprovisioned until live capacity and idle checks
pass. Owner Copilot comparison instructions now include changing a conversational
format rule while retaining note/task context; this supplements the passed live
application-policy canary without claiming they are the same test.


### 7 November 2026 — Azure quota blocks Factory activation

Diagnostic PR #1643 passed CI 42425881356 and CodeQL, then merged as 91adf10e.
Normal deployment 42426666246 passed readiness and live conversation acceptance.
Worker provisioning 42426685636 reused the qualified image and returned
InvalidTemplateDeployment plus QuotaExceeded before activation. The selected
Standard_D2as_v5 requires two available vCPUs in Sweden Central; the exact limiting
quota and usage have not been read. The owner has been asked for Standard DASv5
family and Total Regional vCPU quota details. Bootstrap grants the deploy identity
Contributor and RBAC Administrator at rg-jarvis only, not subscription quota rights.
No migration, worker execution or idle billing proof is claimed. Task 23 still has
its saved branch commit and no delivery PR; do not duplicate its Prepare request.
Copilot remains enabled after its passed live policy canary, and build 82 remains
uploaded with Notes/Ember. Their owner acceptance is pending independently.


### 8 November 2026 — Keep reply metadata close to its message

The owner reports that the timestamp, Jarvis reply and Tool activity look detached.
Use compact message-detail spacing and remove padding intended for a bubble from
the unboxed Jarvis reply. Retain the shared 44-point tool disclosure, paragraph
layout and inter-message spacing. The normal and Current/Copilot test conversations
share the correction. This changes presentation only, not runtime/tool behavior.
Native qualification and TestFlight delivery are pending.


### 8 November 2026 — Defer owner Copilot comparison and save testing scope

The owner has no time for the full comparison now and asks to save it. Preserve
all prompts and steps in docs/runtime-comparison-owner-test.md and mark owner
comparison deferred, separate from the passed automated compatibility canary.
Consolidate unverified device behavior, accepted appearance decisions and the
blocked Factory recovery in docs/ios/design/p15-owner-test-checklist.md.


The owner also repeats that Writing reply is part of Chat, not the Now bar. Move
the single status from the composer dock into the transcript between live tools
and streamed text. This supersedes the previous pinned-row choice. Extend the
existing turn-feedback check to require the status inside the actual ScrollView;
retain its single-row, cleared-editor, next-draft and final tool-collapse checks.


### 8 November 2026 — Notify only when the PC bridge is offline

The owner explicitly rejects online bridge notifications. Persist online/control
changes as dismissed state, quietly clearing any offline warning; a later offline
transition reopens it. Identical dismissed offline observations remain dismissed.
The Now-feed query also hides legacy online entries before any socket reconnect,
without deleting activity history or suppressing unrelated alerts. Retain serialized
transactional writes and refresh only after commit. SQL integration covers legacy
rows, quiet recovery, dismissal persistence and a later outage. Deployment pending.

## 8 November 2026 — Long-running replies must not expire by elapsed time

Accepted owner requirement: remove fixed total turn limits and provide ongoing
progress in normal and test conversations. Keep connection/operation failure handling
and bounded replay. SSE heartbeat comments establish transport liveness only; the UI
must not present them as completed work. Reconnection attaches to the original turn
without repeating actions. The exact owner failure is not diagnosed by these code
limits alone; live qualification remains required.


### 8 November 2026 — Open notification tasks and repair Factory history

The owner cannot open Task 23 from Notifications, sees an error opening P11-13,
and cannot tap issue-only In progress cards. Add task navigation for newest/older
notifications and running rows, keeping dismiss separate and completing sheet
dismissal before navigation. Issue-only cards open their existing GitHub issue.

Confirmed contract mismatch: iOS required taskId in history, while the backend
returns TaskEventRecord without it. Accept task-scoped history and retain strict
live-event ID matching. Correct fixtures instead of adding an invented field to
the API. Build 83 was cancelled before upload to bundle these corrections with
chat spacing/progress; the bridge change is live after Deploy 42477261659.
New source qualification and replacement TestFlight delivery are pending.


### 2026-11-08 — Transparent chrome includes scrolling behind controls

The owner answered Both when asked whether the regression concerned a rectangular
backing or missing content behind controls. Replace reserved/clipped header/footer
stacks with safe-area insets and hide Chat's bottom scroll-edge backing. Preserve
the selected Ember background and control-level glass/accessibility behavior.
Native scrolling captures and viewport-underlap checks are required before build
84; older chrome passes do not establish this newly clarified behavior.

Native 42480914532 confirmed the older task link and board/history path after the
accessibility containment fix. The attention test still failed: its retained
hierarchy exposes the correct button at y=360.6 above the medium sheet viewport
(y=476.5). Replace fast one-way swipes with bounded, directed drags; keep the same
navigation assertions and timeout. Requalify alongside the shared chrome change.


### 2026-11-08 — Inspect chrome after passing geometry checks

Native 42482352002 passed all 12 cases on 82171fce, but the actual scrolled Factory
capture shows readable row text colliding with the fixed title when every edge
effect is hidden. Retain underlap and restore only the native soft top treatment;
keep bottom controls floating. Recheck the refined chrome in actual captures
before upload. Passing viewport geometry alone is not visual acceptance.

The owner reported a good quick Copilot smoke test and requested one combined
prompt plus an explanation of how to compare it with Current. The saved guide now
leads with one real-data planning, read-only Factory status and isolated test-item
write/update/readback task. Exclude labelled test items from planning inputs and
keep model/settings equal. This does not establish multi-turn policy or voice
quality; the former automated canary and extended guide remain separate evidence.


### 2026-11-08 — Make the harness comparison self-contained

The owner has no appointments tomorrow and rejected the agenda-based prompt.
Replace it with a fixed-budget sample shopping task: save/read a Personal note,
update the same note after a price correction, create one undated Personal task,
and verify both. The expected final total is [amount omitted] with [amount omitted] remaining.
Only the runtime label differs between fresh Current and Copilot conversations;
model/settings stay equal. Judge actual saved results, owner intervention and
time, without treating one successful run as proof of general superiority.
This supersedes the planning prompt above; the combined owner test is pending.


### 2026-11-08 — Compare the implemented harness boundaries before benchmarking

The owner requests actual architectural differences first, then a test design.
Source inspection confirms the live Copilot adapter reuses the custom application
loop, tools, context and approvals; the transport, provider conversation/policy
handling, definition validation and durable claims differ. Built-ins are disabled.
Document a controlled project exercise with a later instruction change and
recovery case. Shared internal memory and the test sheet's hidden acknowledgment/
tool events prevent claiming fully isolated inputs or complete UI measurements.
The saved guide labels the proposed live driver as unimplemented and retains the
shopping prompt only as optional smoke coverage. No default/runtime/tool policy
change or personal-data mutation is made by this investigation.

## 8 November 2026 — Lift edits and progressive actions

Owner-approved behavior: tap to edit an existing lift; short left swipe exposes an
icon-only pencil and farther swipe exposes trash beside it. No full-swipe deletion.
Retain the backing entry identity and legacy-note SHA; preserve unrelated note
content when editing. A direct owner Delete tap authorizes deletion of that exact
lift note version, without another agent confirmation. Reuse shared controls.

Runtime recovery must retain partial output and reconnect by turn ID instead of
reposting a request. Local reconnect time is an outage budget, not a work deadline.

### 8 November 2026 — Review productivity gates by actual failure

The owner explicitly requests a broader approval/timeout review. Record findings in
`docs/productivity-blocker-review.md`: distinguish service-unavailable decisions
from owner ambiguity, retain proposals/receipts durably, and reconcile uncertain
work without duplicate actions. Existing authorization and resource checks remain.
These follow-ups are not implemented by the long-running stream fix. Cloud threads
should use separate branches and task scopes; shared GitHub and deployed services
still need coordinated integration even when local workspaces are isolated.

The owner explicitly assigns full SDLC ownership to Jarvis2 primary, session
`[identifier omitted]`. Jarvis2 secondary is development/research
only and must never deploy; integration and delivery stay with the primary. Save
the scope and handoff instructions in `docs/secondary-thread-starter.md`.

## 8 November 2026 — Active reply timer and ongoing progress

Dan selects the Codex active-turn layout: elapsed work above the reply, continuing
public progress updates and thinking/tools below. Timestamps appear only on tap.
This replaces the persistent timestamp/orb treatment, preserves transcript ownership
and native text selection, and applies to both runtime testers. Later pre-tool text
uses additive commentary events, not model-private reasoning. Implementation is
local; native qualification and deployment remain pending.

The corrected lift test in 42494078211 reached the saved row: AX showed [measurement omitted] after
a verified 82.5 input. Last lifts used a whole-number formatter. Preserve decimals
and requalify the unchanged save/reopen/swipe/delete assertions. Artifact 13622798399
SHA256: 33737f4f61e37d05e4b4927c6c3979657e488424af9b19586d946479b3a0afaf.

## 8 November 2026 — App actions must be available to Jarvis

The owner reported Jarvis refusing a fully specified dumbbell shoulder-press log.
The app save routes existed but gym actions were absent from the tool registry.
Implement shared gym tools for reads and explicit logging/edit/delete requests;
reuse persistence and vault sync rather than generic memory writes. This is an
app/assistant parity requirement, not proof that every historical app action has
been audited. Keep current-message identity and exact record targeting without
an extra confirmation or arbitrary long-turn age cutoff. Model-driven session
selection and real owner device acceptance remain to be verified after deployment.
## 8 November 2026 — Request the approved worker's compute quota

Dan explicitly asked to increase Azure quota so the approved 128 GiB worker can
be provisioned. Use the existing deployment identity and a manual main-only
workflow; request only two free standard vCPUs for Standard_D2as_v5 in Sweden
Central, based on actual family/regional limits and usage. Do not grant roles or
change the chosen size/region. Subscription quota access and Microsoft.Quota
registration are prerequisites. Submission, Azure approval, provisioning and idle
verification are separate states. Unknown quota-write outcomes are inspected,
not automatically retried. Implementation has eight passing focused tests;
no live quota request is claimed. See docs/factory-worker-quota.md.

## 8 November 2026 — Keep delivery status visible across workstreams

Dan explicitly requested recurring concise status bullets for gym chat logging;
chat/navigation/lift editing; Notes/Background 3; Copilot; 128 GiB/Factory; and
approvals/timeouts. Report implementation, qualification, deployment, readiness
for owner testing and acceptance separately. A blocked item names its observed
reason and next action. Keep PLAN.md and the build delivery record current;
passing automated checks does not establish owner-device acceptance.


## 8 November 2026 — Keep all reported work visible in delivery updates

Dan prefers the short parallel delivery-status bullets and reports Apple Watch
implementation in Jarvis2 secondary. Primary retains SDLC/integration/release
ownership; secondary does not deploy. Add Watch to the standing status without
claiming implementation completion. Track the new Notes right-sidebar crash and
missing phrase/Overview independently: the latter has a source correction in
#1653, while the crash cause remains unproven. Copilot gym refresh failed during
version inventory; #1651 must qualify and a new live canary must pass before
retesting is called ready. Quota run 42503224623 failed during inspection before
any write; this proves an access failure, not an exact failing API read or a
submitted quota request. Keep deployed, testable and owner-accepted states separate.


## 2026-11-08 — Owner accepts build 84 header/footer transparency

Dan confirmed transparency now works well across pages. Mark the backing and
scroll-behind reports accepted and preserve shared chrome during Notes repairs.
The separate Notes report is specifically build 84 freezing on the right sidebar,
not app termination. The phrase/Overview restoration is a candidate, not released;
first native qualification passed order and failed three other cases. Do not
collapse owner acceptance of chrome into acceptance of the unrelated Notes fixes.


## 8 November 2026 — Read the complete Copilot version inventory before retrying

A catalogue refresh failed after its create step when reading Azure's version
inventory; a separate read-only inspection reproduced the error. The reader did
not implement Foundry v1 cursor pagination and could request 20 full historical
definitions in one response. Read bounded single-record pages, follow has_more
and last_id, and validate every existing version before deciding whether to create
or reuse. Preserve strict ownership, unique exact matches, response/operation
bounds and content-free errors. This is a recovery fix, not permission to replay
an uncertain creation. Live root-cause confirmation and activation remain pending.

The quota workflow also exposed unnecessary full deployments for manual-only
administration files. Classify the quota workflow/request helper and comparison
provisioning helpers explicitly as non-application inputs while retaining full CI
qualification and their manual execution gates. Unknown new runtime files remain
conservative full-deployment inputs.

Reference: https://ai.azure.com/api-reference/agent-versions/list-agent-versions/.



## 8 November 2026 — Restore Notes context; investigate navigation separately

Dan reports two independent Notes regressions: opening the right sidebar crashes
the page, and the shared phrase/overview is absent. Restore the original data
phrase and Overview before the Notes / Tasks / Graph tabs while retaining the
approved carousel, folder browser and editor. Add native coverage for the restored
order and navigation through a 1,003-note synthetic library. The crash cause is
not yet proven; eager rendering/date parsing is only a lead. Qualification and
native capture review remain pending, so no released fix is claimed.


## 2026-11-08 — Keep Notes inventory work out of navigation redraws


Owner clarification, 8 November: this is build 84 freezing on the right sidebar,
not app termination. Header/footer transparency is now owner-accepted across pages
and must be preserved. First native run 42507483140 passed restored page order,
but failed the 1,003-note navigation case at the unchanged 120-second limit and
both editor-entry cases. Artifact 13628313103 (SHA256
12ab310823ace0806ac39d4664dd256b4d56c2fd8c924d9e99247f56503c3be1)
retains screenshots, the app/UI-runner spindump and hierarchy. The app main thread
was predominantly constructing accessibility snapshots; this is synthetic
large-library evidence, not proof of the exact physical-device failure.

The correction computes recency once per inventory/visit/day update off the main
actor, reuses timestamp parsers and renders individual rows lazily with the shared
grouped-row appearance. It retains every note and cancels stale projections.
Editor tests now scroll the complete target row above the dock before tapping;
the retained hierarchy placed the former target below the viewport/dock. All
existing pin/Raw/edit/save/reopen assertions and test limits remain. Fresh native
qualification is required; neither a repair release nor owner acceptance is claimed.


## 2026-11-08 — Copilot gym catalogue ready for owner retesting

PR #1651 merged as c79371d7 after full CI 42506434652 passed on retry. Normal Deploy
42507969183 passed readiness and acceptance. Read-only inspection 42509996653
reported one matching version among five and the pin on another version. The
already authorized refresh 42510264543 then reported managed_chat_provisioned and
managed_chat_comparison_canary_ok at 18:34 UTC, with live acceptance also green.
The refreshed catalogue is testable. Current stays the default; this compatibility
canary does not establish comparative quality or owner acceptance of gym writes.


## 2026-11-08 — Notes repair qualified without changing accepted chrome

The Notes correction passed full CI 42509929023, including all 530 Core tests,
and native run 42510119801 passed all four selected cases with zero failures/skips.
Qualified source ca107a8b897bdf2eab181ab504cb43bcf1344525 has iOS tree
545ad8d8c08ed50e9507d71cceadab434537fe1e. Actual restored-order, scrolled-sidebar
and light/dark editor captures were reviewed. Artifact 13629821155 has SHA256
9c0a357026019bc40ced7671358d47ed64fe7b120d23b31a969176eb9fff8755.
The 1,003-note library now passes repeated sidebar open/close, scrolling and
return-to-Chat checks. Both themes pass pin/Raw/edit/save/reopen. Existing 120/150
second test limits and every assertion are retained. Physical-device acceptance
of the freeze correction remains pending; TestFlight upload is the next step.

Temporary run 42509865676 stopped before native testing because a standalone
macOS SwiftPM invocation used the package's unsupported default macOS target.
Core was instead qualified through its existing Linux Swift 6.2 CI job. The native
runner compiled Core for the supported iOS target. No product deployment target,
test assertion or timeout was changed to bypass that validation setup failure.


## 2026-11-08 — Notes correction uploaded as TestFlight 85

PR #1653 merged as df813f348eae27961259c691b526eeadced9ea18 with complete tree
identity to qualified head 2f0fd280d6f999dd01459e97e0f43e9e12882c3e (tree
9cd04755573ea3d0e25c90d7f4157715ebcbe014). Final CI 42511384320 passed; native
42510119801 passed all four cases and 530 Core tests passed. TestFlight run
42511641193 successfully archived, signed and uploaded build 85 from this source.
Apple processing/device availability and owner acceptance of the Notes sidebar
freeze correction remain unverified. The owner's acceptance of build 84 shared
header/footer transparency remains valid. Copilot's fresh catalogue/canary is
ready; the full comparison and gym write checks remain owner tests.


## 2026-11-08 — Diagnose the failed Current comparison without replay

Use existing deploy identity access for a fixed, main-only read of recent backend
failure classifications. No permissions or service configuration change; retain
only timestamps and existing safe codes in workflow output. The isolated Current
test delivered no final answer and its expected note is absent; this is a valid
failed comparison result, not a reason to issue another mutation test blindly.


## 2026-11-08 — Repair Current before comparing it with Copilot

The owner explicitly requires Current to work before drawing a quality comparison.
The latest fixed-scope server diagnostic identifies error_runtimeerror at 20:03:46
UTC, not a timeout. Repair two concrete code defects: fatal oversized public updates
and the 512-token default for written reasoning/tool work. Segment updates within
the existing wire bound; provide a separate 32,768-token chat budget without
changing model/effort or the voice budget. Add fixed failure classifications instead
of raw exception logging. Keep access controls and uncertain-write protection.
Local regression and 1,310 agent tests pass; production completion is not yet proven.
## 2026-11-08 — Group consecutive tool attempts, preserve comparison baseline

The owner requests no adjacent repetition of the same tool name. Use one disclosure
row with count and visible refused/failed totals; expanded rows show numbered
attempts and their outcomes. Preserve chronology and real call totals. Apply the
same component to normal and isolated test Chat, and qualify both surfaces.
Copilot's saved initial/revised note is verified, but 51 displayed attempts and
refusals remain friction findings. Keep the backend unchanged for the paired
Current run; do not infer the exact refusal cause from a generic UI label or claim
that the isolated test establishes normal Chat reliability.

## 2026-11-08 — Phone-dependent Apple Watch implementation

Owner-approved: Ultra 2, manual-send dictation, no offline mode, four complications and Home/Chat visuals. Use paired-iPhone WatchConnectivity allow-list with existing clients/authentication/voice protocol; no credentials on Watch or backend routes. Factory is read-only. Watch-specific shared controls adapt UIKit-backed iOS controls. Health boundaries follow phone Calendar.current; display expires in 15 minutes. Owner accepts device voice testing after primary installation; runtime and live-tile acceptance remain unverified. PR #1652 supersedes design PR #1648 for integration and retains its approved assets.

## 2026-11-08 — Primary Watch integration keeps cached complication data

Live WatchConnectivity availability controls interactive requests, not whether a
fresh received snapshot can be displayed. Keep cached complication data through
brief/background unreachability, expire at the earlier of 15 minutes and local
midnight, and clear on explicit phone sign-out context. Primary owns signing and
release after the secondary handoff; physical Watch acceptance stays deferred.


## 2026-11-08 — Primary integration and entitlement status

Apple Watch PR #1652 is merged after primary integration review, full CI/CodeQL, 544 core tests, native Watch/widget/paired-iPhone builds and three focused native interaction checks. The final app tree matches the native-qualified tree; duplicate cancelled runs are not counted as passes. Signed TestFlight build 87 failed in 42523594128 because both Watch provisioning profiles do not match the shared App Group entitlement; nothing uploaded. Associate group.com.danaakesen.jarvis with com.danaakesen.jarvis.watchkitapp and com.danaakesen.jarvis.watchkitapp.widgets in Apple Developer before retrying. Physical Watch voice/background/live-tile acceptance remains pending.

Current repair #1658 is deployed. Acceptance evidence from 42522064440 confirms all chat probes passed; the overall release failed solely on the separate Codex research usage limit. The full owner comparison exercise remains pending and no failed user action was replayed.

The owner reports adding Azure access, but fresh-login quota runs 42522536383 and 42523572142 still return 403 AuthorizationFailed before submitting a request. No 128 GiB worker provisioning or Task 23 recovery is claimed.

The owner has requested the CarPlay entitlement from Apple. Await Apple’s reply; entitlement approval, activation and CarPlay device acceptance are not established.


### 8 November: subscription access corrected

The owner corrected the Quota Request Operator assignment from resource-group to subscription scope. Live run 42523978403 passed the previous authorization boundary but returned HTTP 400 InvalidResourceName before any quota write. The client now discovers canonical quota resource names from Azure’s catalogue, matches only the two approved resources case-insensitively, and uses returned casing for reads/writes. Missing/ambiguous resources stop without a write; catalogue pagination is bounded and confined to the same scope. Live retry and 128 GiB provisioning remain pending.


### 8 November — live quota follow-up

GitHub authentication is working again. Provisioning run 42525578592 reached Azure but failed with InvalidTemplateDeployment / QuotaExceeded; worker routing remains inactive. Quota run 42524952522 failed before writes because an approved resource was absent from its catalogue. The quota diagnostic now retains validated catalogue names, the missing requested name, and only the two approved Compute usage/limit records. This read-only evidence is needed to distinguish catalogue coverage from actual capacity; no resource allocation or quota write is added.


## 2026-11-08 — Authentication restored; quota service remains unresolved

GitHub API access and workflow dispatch work again. Actual worker provisioning 42525578592 failed QuotaExceeded and did not activate routing. Diagnostic run 42526613341 returned an empty Sweden Central quota catalogue and no matching Compute usage records. No quota increase has been submitted. Subscription access is fixed, but provider registration/regional availability still needs verification; do not label this as an authentication blocker or invent a numerical quota limit.


### 8 November — Compute registered, quota response handling

The owner registered Microsoft.Compute (Microsoft.Quota was already registered). Run 42527062741 now fails local quota response validation rather than the prior missing catalogue error; direct provisioning 42527158192 still returns QuotaExceeded. Treat integral JSON numeric values as integer counts, preserve rejection of fractions/booleans/unknowns, and resolve approved resource names using properties.name.value as documented by Azure. Ignore unrelated catalogue rows rather than allowing their metadata shape to abort the approved lookup. The precise triggering response field remains unverified; no quota submission or provisioning success is claimed.


### Backend CI budget correction

Run 42527387309 completed backend tests but cancelled the final build at the job’s 10-minute limit (GitHub annotation confirms timeout). Increase this job allowance to 15 minutes, matching the neighboring bridge/container jobs. All lint, tests and build steps remain unchanged; this is CI execution capacity, not an application/chat timeout.


### 8 November — quota usage value investigation

Run 42529215408 resolves both approved resource names but fails at usage_decode with ValueError before writes. Retain only numeric counter values/types (including negative sentinels) from the two approved quota resources; arbitrary provider text and structured bodies are excluded. The unknown usage remains rejected rather than assumed zero. This is diagnostic evidence only, not a quota increase or workspace activation.


## Approved quota and provider prerequisite (8 November)

The owner registered Microsoft.Compute and obtained the DASv5 quota increase to 2 in Sweden Central. Read-only run 42530362925 verifies family usage 0 / limit 2 and regional usage 0 / limit 12, with ready=true. No additional regional quota request is needed. Earlier unknown usage/counter failures are superseded by this successful live read; do not claim a confirmed cause for those transient values.

Provisioning 42530295512 reached deployment but failed DeploymentFailed / MissingSubscriptionRegistration and did not activate routing. The owner was asked to check/register Microsoft.Network, which the template requires for its network, NSG, NIC and outbound IP. The retained error does not name the missing provider, so confirm registration rather than treating that inference as proof.

Before first worker provisioning, verify subscription registration of Microsoft.Compute and Microsoft.Network, plus Microsoft.Quota for quota automation. The template also uses existing ManagedIdentity, ContainerRegistry, Storage and KeyVault providers and Authorization role assignments. Quota authorization is separate from provider-registration permissions. Registration and quota approval do not themselves prove a working 128 GiB workspace.


## 2026-11-08 — 128 GiB workspace provisioned and activated

The owner completed subscription quota access, Compute/Network registration and
the DASv5 increase to 2. Read 42530362925 verified family 0/2 and regional 0/12
before allocation. Provisioning 42530882044 then passed with 134145380352 workspace
bytes, 132754182144 free bytes, both credential reads, actual idle deallocation,
backendReadyVerified=true and activated=true. Artifact 13637845540 retains the proof.

This supersedes the quota/registration/authentication blockers above. One worker
is delivered; fleet expansion is not implemented. Task 23 has not been replayed
or declared complete. Owner-authenticated recovery and a complete Factory task
remain the final end-to-end acceptance; use the saved branch and never a duplicate
Prepare task. Current release record: docs/factory-worker-delivery-2026-11-08.md.


## 9 November 2026 Copenhagen — Current owner comparison completed

The owner reports a successful Current final reply after the deployed repair.
Read-only vault verification confirms creation (26170110) and revision (a796d675)
of the same Personal/HARNESS-CHECK-CIRRENT-85.md note, preserving the requested
constraints and moving work status to phase 2. Keep the actual label unchanged.
Both Current and Copilot now pass this practical exercise with first-save refusal
friction. Copilot discovered more branch context in this pair; matched latency,
cost and general superiority are unproven. Current remains the default, and this
result does not establish normal Chat/Home, Voice, later-turn or Factory parity.
Preserve earlier failed runs. Do not require another repetition merely to prove
this completed case. Refusal causes and missing routing instructions remain open.


## 9 November 2026 — Park Copilot migration; no old test-task migration required

Dan chooses to retain control of the custom harness and park the Foundry Copilot
migration for insufficient expected gain. Current remains default. Preserve the
implemented comparison path/results; no further migration or comparison rounds
are planned and no cloud resource or test UI is removed by this decision.

Dan confirms existing Factory tasks are tests and need not be migrated. Task 23
recovery is no longer a prerequisite. This does not execute bulk task deletion.
The remaining old-runner dependency is future web research/HTML reports, image
generation (`codex-tool`) and automatic/manual Codex credential refresh
(`renew-codex`). The backend and VM command allowlist need adaptation and tests
before those functions stop using the Foundry runner. No such cutover occurred
in this documentation update; native voice, personal memory and the 128 GiB VM
remain independent of the parked chat migration.

## 9 November 2026 — Preserve Factory concurrency when increasing workspace storage

Dan rejects a single-worker Factory. The product already exposes a global
parallel-task limit of 1–100; the intended behavior is simultaneous agents on
isolated, on-demand compute, with idle capacity released. Replacing all new
Foundry starts with one VM and serializing them in worker.py does not satisfy
that behavior. The 128 GiB disk qualification is valid but is not fleet acceptance.

Prefer managed infrastructure. Current Microsoft documentation describes Container
Apps Sandboxes with independent sandboxes, persistent data-disk volumes, larger
disk tiers and Microsoft-managed clusters. This option was omitted from the
earlier assessment; it requires subscription/region, API, identity, disk,
build-performance and concurrency qualification before adoption. No provider
cutover, quota increase, new worker or 100-agent load run occurs in this change.
Read-only catalogue inspection supports that qualification; a visible catalogue
is not a working sandbox or proof of available capacity. See
docs/factory-concurrency-correction.md for sources and acceptance requirements.

### Managed capacity readback — 9 November, 08:33 Copenhagen

After #1670 merged as 1d9f3074 with full CI 42579005933 and CodeQL 42579005892,
GET-only inspection 42580034945 confirms Microsoft.App Registered, sandboxGroups
available in Sweden Central with API 2026-07-01, and no groups yet in rg-jarvis.
SandboxCores is limit 300 / usage 0. This is sufficient CPU quota for 100 two-core
workers; it is not proof of a 128 GiB volume at that size, data-plane permission,
actual resource placement, completed builds or 100 live Codex/Copilot sessions.
No resources, role assignments, quota or routing were changed. The current VM
route still handles one coding task at a time. Retain the qualification distinction.

## Persistent-root workspace qualification — 9 November 2026

Run 42601169164 returned the exact storage validation: DataDisk sizes may not
exceed 107374182400 bytes (100 GiB). No equivalent spelling can provide a 128 GiB
attached disk. The replacement profile uses the documented 2XL resources:
8 vCPUs, 16 GiB memory and a 160 GiB persistent root disk. `/files/jarvis` lives on
that private disk; no DataDisk volume is allocated. Disk-mode stop/resume retains
it, and deleting the sandbox releases it. The canary checks the same sandbox ID
and a persisted marker after resume. Partial sandbox deletion is retried.

The live storage test still creates at most five workers. It must measure at
least 128 GiB free after dependency restore/build, verify POSIX operations and
five-way overlap, then verify persistence and delete its sandboxes. No model
inference is included in this infrastructure test. Runtime transport/lifecycle
qualification remains separate; neither test is a 100-agent provider load test.

The larger CPU allocation changes capacity and cost: 100 workers need 800 active
sandbox cores; the last observed quota is 300 (37 whole 8-core workers), enough
for the five-worker test but insufficient for the full target. Quota discovery
also checks the Microsoft.Quota catalogue without submitting a request. Do not
claim 100-worker capacity until quota and the matching configuration are verified.
The managed route remains inactive and VM retirement is held pending acceptance.

### Live storage acceptance — 9 November, 11:13 UTC

[42606694866](https://github.com/DanAakesen/jarvis/actions/runs/42606694866) passed
with exactly five 8-core / 16 GiB / 160 GiB sandboxes. Each measured
157728206848 bytes free after a sample .NET restore/build. All five execution
windows overlapped; POSIX checks, credential access, stop/resume persistence and
owned cleanup passed. [Retained evidence](../factory-managed-storage-evidence.json)
records the scope: no model calls or SQL task/provider concurrency proof.
Quota PUT 42606699111 failed with an opaque diagnostic; readback 42607004866
still reports 300 SandboxCores. The quota workflow defaults to inspecting request
history before another submission, and preserves bounded redacted service details.
Managed transport acceptance, cutover and VM retirement remain pending.

## 2026-11-09 — Intelligent cross-app notifications, direct owner testing

The owner accepts research items 1–3: connect relevant data, compute accurate facts and use intelligence to choose useful notifications. Items 4–5 (additional delivery-policy stage and feedback learning) and shadow mode are explicitly declined. The sole-owner app should include useful actual details rather than add privacy-redacted messages. Reuse existing proactive engine, controls, receipts and native APNs infrastructure; broaden normal informational insights and add no automatic task writes from new context. Keep current schedule and existing source/goal semantics. Implementation is PR #1669; integration/deployment/device acceptance remain primary responsibilities. This supersedes the earlier research proposal's privacy-redaction and shadow-rollout recommendations, without authorizing production configuration or unrelated Daily automation.


## Managed worker credential ownership — 9 November 2026

Runtime qualification 42617745859 identified `worker_boot_failed` in all five
sandboxes. The upload API creates `.mailbox-sas.next` as root (0644) within
worker-owned `/files/jarvis` (0700), while exec runs as UID 1000. The previous
chmod therefore failed before starting the consumer. All test workers and
temporary storage were cleaned up; cutover and VM retirement did not run.

The adapter now copies the upload into a worker-owned 0600 staging file, atomically
renames it to the live credential path, and removes the upload. Credential values
remain out of command arguments and logs; the containing directory stays private.
This also supports renewal without exposing a partially written live credential.
The runner image is unchanged. Nine adapter tests and backend typechecking pass;
live requalification is pending.


## Native APNs delivery configuration — 9 November 2026

Use the owner's existing APNs key through three Key Vault secrets (`apns-team-id`,
`apns-key-id`, `apns-signing-key`). The explicit main-only activation workflow
requires exact source qualification and enabled secret metadata before changing
the existing backend. Container Apps resolves protected references using its
already-authorized managed identity. Infrastructure deployments preserve this
activation; startup validates the key before becoming ready. Inspection reports
configuration presence only. No key is committed, logged or read by the workflow.
The owner is preparing the secrets; live activation and device receipt are pending.

## Managed Factory cutover — 9 November 2026

Run 42620552706 passed five production-adapter workers, credential access,
147 GiB free per workspace, overlapping execution, restart routing, idle stop
and resume with persisted disk content. Test resources were removed. The backend
cutover succeeded at revision `ca-jarvis-backend-rmw7kae3bza6a--0000560`.
This qualification used no model calls or live owner tasks.

VM retirement stopped before deletion because Azure CLI rejects `role assignment
list --scope ... --all`. The corrected cleanup enumerates the resource group's
role assignments through ARM, including child scopes, and retains the exact
identity/resource filters before deleting grants. Pagination cannot leave the
resource group. VM retirement and source cleanup remain pending live execution.
The owner accepts 300 sandbox cores for now; no further quota request is authorized.


## Factory VM cleanup finalization — 9 November 2026

Runtime 42625011714 again passed five workers and managed cutover. Its ordered
teardown completed role, VM, disk and network deletion, then stopped because
`storage container-rm delete` requires explicit CLI confirmation in automation.
The fix supplies `--yes` for only the authorized legacy mailbox. Recovery first
verifies the VM and all dedicated named resources are absent, then removes only
the old mailbox and deployment record. Any remaining dedicated resource stops
recovery for inspection. Final inventory/evidence and source cleanup are pending.

## Managed Factory retirement accepted — 9 November 2026

Five-worker production-adapter run 42629384227 passed delivery, overlap,
restart routing, idle stop, disk persistence/resume, owned cleanup, activation
and dedicated VM retirement. Retained evidence is in
`docs/factory-managed-runtime-evidence.json`. No model calls were made.
Remove VM templates, scripts, quota workflow, runtime fallback and configuration;
retain shared backend and Foundry chat/voice/research/image/login services.
The cleanup release requires a fresh worker image before final source retirement
is claimed live. The owner accepts the current 300-core limit for up to 37
8-core workers; further quota requests and a 100-worker test remain out of scope.

## APNs metadata access correction — 9 November 2026

Readiness run 42627268441 confirmed the backend is ready with proactive, alert,
Web Push and Health switches enabled; native APNs registration/delivery is off
and its four runtime settings are absent. The deployment identity could not list
Key Vault secrets through the data-plane API, so secret storage remains unknown.
Use the existing ARM deployment metadata API for secret names and enabled flags,
without fetching values or granting new data-plane access. The official
`azure-mgmt-keyvault` 14.1.0 SDK defines the list endpoint at API 2026-05-15 and
explicitly states SecretProperties.value is never returned by that service.
Project only names/enabled flags, bound pagination to the same vault, and retain
missing/disabled-key rejection before any APNs configuration write. Six focused
checks pass; live metadata readback and activation remain pending.
# Home brief and daily activity semantics — 9 November 2026

Dan requests a useful configurable Home phrase, an owner instruction and a
maximum-line preference, with all owner-editable Jarvis instructions accessible
in one settings destination. Primary will investigate and provide the secondary
implementation brief; secondary must not deploy. Proposed organization is
Settings → General → Jarvis → Instructions, preserving separate identity,
general-style, presence-mode and Home scopes and existing stored values.
Active kcal must include activity outside recorded workouts. Source inspection
confirms Home currently sums workout measurements for all periods. Use daily
active energy and define time as Apple exercise minutes, with honest labels and
shared Home/Health semantics. The time definition and initial 1–6 line range
(default 3) are implementation recommendations, not an already selected owner
preference. See `docs/ios/design/home-brief-activity-handoff.md` for evidence.
No Home implementation or live-device data verification is claimed.

## Final managed Factory rollout — 9 November 2026

Cleanup PR #1674 merged as 6601dbb8. Production deployment 42639280047 and
runner deployment 42639280048 passed. Fresh-image qualification 42644583506
passed five concurrent isolated workers, command delivery, restart routing,
credential/storage probes, idle shutdown, persistent-disk resume, cleanup and
activation on ready backend revision 0000568. Each worker had 146.9 GiB free.
No temporary compatibility setting was shipped. VM retirement remains proven by
42629384227; the active VM implementation/configuration is now removed too.
Factory is ready for the owner's fresh coding-task acceptance, which is distinct
from these zero-model-call canaries. Preserve the accepted 300-core quota and
owner/project admission limits; no 100-worker test or extra quota is authorized.

## Generation diagnostics — 9 November 2026

The existing main-only Chat failure diagnostics workflow now accepts the optional
`generation=true` input. It reads fixed proactive/image failure classifications
from the backend's last 24 hours and OpenAI-named Key Vault secret metadata via ARM.
It reads no secret values, prompts, image bytes or model text, performs no writes
and does not replay jobs. Historical proactive output validation did not retain
the specific failing field; this inspection must not imply otherwise.

## Image API repair and proactive diagnostics — 9 November 2026

Owner requested replacement of failed subscription-backed image generation with
the current OpenAI API. Official API documentation lists GPT Image 2.6 Sunburst
and Flare; the implementation selects Sunburst for detailed mock-ups. The backend
uses its existing Key Vault identity and private artifact storage, without a
Factory worker. Required secret defaults to `openai-api-key`; an alternate name
can be set with `JARVIS_OPENAI_IMAGE_SECRET_NAME`. Credential presence and live
API generation have not yet been verified. No new key is created by this change.

The 18:00 proactive message maps to `invalid_model_output`, not an owner approval.
Historical code collapsed response truncation/refusal, invalid JSON and finding
validation into the same reason. New content-free diagnostic stages distinguish
these paths; this does not prove which caused the historical failure or claim it
is fixed. Chat/voice harness behavior and proactive validation remain unchanged.

Proactive follow-up: reproduced a valid Foundry text response being rejected
because `tool_calls: null` / `function_call: null` were treated as attempted
tool execution. Microsoft's 2024-05-01-preview API example explicitly returns
null tool calls. The repair accepts absent/null/empty tool metadata and still
rejects actual or malformed tool calls, refusals, incomplete responses and
invalid findings. Regression tests failed before the fix. This is a confirmed
compatibility bug, not proof of the historical 18:00 response's contents.

Image timeout follow-up: the agent sent image calls with the ordinary 30-second
read timeout despite the backend's 270-second generation budget. Two regression
tests reproduced the default/configured mismatch. Image calls now use the existing
long-tool setting (320 seconds by default), like web research. This requires
releasing the Jarvis agent as well as the backend. No total chat deadline is added.

## 10 November 2026 — Static iOS structure and scoped retained refresh (#1702)

The owner-approved UX keeps static headings, labels and usable controls visible
before data, scopes loading indicators to data, and retains correct-account,
correct-context results through refresh failures with retry. Reuse existing
repositories and indicators; no visual redesign, prefetch-everything policy,
backend split or permanent offline store. Independent reads publish independently.
An observed shared-cache race allowed an earlier request to write after account
rebinding or resource invalidation; session generations and per-key revisions now
reject those obsolete results without invalidating unrelated sources.

PR #1703 owns Today/Upcoming files and semantics. This change avoids those files
and preserves existing integer stat consumers while adding explicit unknown
values to the shared stat component. Primary owns final integration, native
qualification and deployment. Linux syntax/Core checks do not establish native
layout, VoiceOver, Dynamic Type, reduced-motion or scroll acceptance.
## 11 November 2026 — Watch data while locked (#1769)

Retain last-known Watch Home and complication data locally after first unlock, including failed sections, with a saved-age label. Do not mark these owner-requested complications privacy-sensitive; explicit phone sign-out still clears the cache. This deliberately makes their health and task content visible while the Watch is locked. The earlier expiry-to-empty behavior and locked-device redaction conflict with the owner's request; physical-device verification remains open.

## 11 November 2026 — Keep activity status faithful (#1763)

Refresh iOS activity on Factory board events rather than inferring a task's state
from age. Record deliberate proactive cancellations as cancelled, not failed;
retain actual failure reasons. Task 24 handled #1706; the Factory bot reported it
Done on 10 November and #1709 was merged. Its current production state and the
reported proactive failure reasons have not been verified here. Historical job
records remain unchanged.

## Watch direct dictation credential boundary (12 November 2026; #1807)

Use the existing transcription handler, not a new general-purpose Watch API.
The signed-in owner issues or revokes the paired Watch credential through
`POST` / `DELETE /voice/watch/credential`. Issuance rotates the previous
credential; one active paired-Watch credential per owner is supported, not a
multi-device credential registry. A 256-bit opaque bearer credential expires
after 24 hours; SQL stores
only its SHA-256 hash and checks expiry on every request. It authorizes exactly
`POST /voice/watch/transcribe`, not the legacy alias, credential management,
chat, tasks, tools or voice. Existing audio-size, two-request concurrency and
90-second transcription limits still apply. The 13 November review follow-up
below replaces the initial shared credential verification window.

The phone provisions the credential through paired WatchConnectivity. The Watch
keeps it in Keychain and uses HTTPS for direct transcription, then falls back to
the phone and keyboard. Only transcription can be retried this way: it produces
draft text, not a send or tool execution. Existing chat and voice acknowledgement
rules remain unchanged. No owner account bearer credential is copied to Watch.

Threat-model assumptions:
- The paired iPhone, Watch OS/Keychain, backend and configured HTTPS endpoint are
  trusted; compromised devices and bearer-token extraction are outside this
  change's protection. A stolen token can transcribe within the limits until
  expiry or revocation, but cannot obtain owner privileges.
- WatchConnectivity pairing is the provisioning trust boundary; neither a
  client-supplied scope nor a general HTTP proxy grants access. Credentials must
  never enter logs, snapshots or complication storage.
- Revocation requires backend connectivity. Local sign-out must clear the Watch
  credential, but an offline peer may not receive that immediately; expiry bounds
  this exposure. The iPhone sign-in gate reports unconfirmed revocation instead
  of false remote success and explains the online sign-in/sign-out retry.
  Accepted in-flight transcription may finish after revocation.
- Watch network access is independent of WCSession reachability. A short wait
  handles activation races; it cannot force iOS to wake an authenticated app.
  Build 98's specific physical-device failure has not been reproduced.

Follow-up proposals, not implemented: direct chat is practical using the existing
HTTP/streaming client, but needs distinct session/turn/read scopes, ownership
checks and uncertain-send reconciliation before removing the phone relay.
Direct voice can reuse the portable voice state machine and Watch audio engine,
but needs a separate voice-only WebSocket credential, bounded session/budget
authorization, token expiry during a session, and physical-device validation of
network switching, audio routing, wrist-down runtime and battery cost.
The dictation credential must not be widened to enable either feature.

### 13 November 2026 — Recognized Watch route limits (#1808 review)

Use the existing `@fastify/rate-limit` dependency rather than custom credential
windows. Limit the canonical Watch transcription and credential-management
routes before their authentication lookups. Budget transport peers, not
unverified token strings or caller-provided forwarded headers; use short
non-extending windows so an unknown-token flood does not reserve the real
Watch's minute-long quota. Apply the longer issuance/transcription budgets only
after owner/Watch authentication. Keep revocation independent of issuance.
Each canonical route allows 30 attempts/second per transport peer with a bounded
512-peer cache. Authenticated issuance permits six/minute per owner; Watch
transcription permits 30/minute per verified credential hash. Return 429 and
Retry-After when exhausted. A different peer retains its own short budget;
a shared ingress peer can still be denied during a one-second window.
These are bounded per-replica protections, not distributed quotas or a
guarantee of availability under sustained denial-of-service traffic.

## Watch voice startup and dictation (12 November 2026)

Keep the existing phone-owned authentication and live voice transport. The Watch now waits briefly for WCSession activation/reachability before a single voice-start message; it does not replay a possibly delivered start or queue real-time audio. Dictation edits the Watch draft without a phone, while sending and task creation still require the companion. Queued transfers are opportunistic and cannot support interactive voice or provide immediate task results; blind mutation retries could duplicate writes. The #1807 decision below supersedes the lack of standalone transport for dictation only. Paired-device cold launch, locked-phone and network behavior remain unverified.
## 12 November 2026 — Proactive completion limit

Owner-reported production logs show six `completion_incomplete` events at the
2,048-token cap over 10–12 November. Raise the cap to 8,192 and use `low`
reasoning when supported instead of retrying: this keeps a single bounded call
and its existing budget reservation and usage accounting. Limit iPhone failure
visibility to seven days without removing job history. Live verification is pending.

## 12 November 2026 — Live Activity voice end returns to Chat (#1796)

Retain an explicit navigation request in the voice model instead of relying on
a rendered `.ended` transition. Consume it at the app root or foreground entry,
and prevent automatic startup until it is consumed. In-app End also returns to
Chat rather than Home. Use a UIKit background task during teardown and close the
existing backend voice socket before dismissing ActivityKit. Intent session
validation and Danish/English copy remain unchanged. Apple documentation access
was blocked; locked-device and wake-from-intent behavior still need iPhone
verification.

## 12 November 2026 — Verify Watch voice ownership before reusing it (#1798)

The iPhone voice model outlives a session. Its End paths cleared the session ID
but left `VoiceLiveActivityActions.session` registered; the Watch bridge treated
that object's existence as busy, while iPhone Start did not use that guard.
Clear the registration whenever the iPhone session ID is cleared, and check a
current ID before rejecting Watch Start. Watch-owned terminal client states also
run full teardown rather than merely updating a label.

Use the existing session-scoped heartbeat to verify retained Watch IDs against
the companion client. Clear only a confirmed missing/terminal session; an
unreachable phone is not permission to start a second session. Retain End in the
WatchConnectivity application context as well as sending a live event, and check
again on foreground/reconnection. Backend records already finalize through the
same path for explicit End, idle expiry, duration cap and socket disconnect; no
backend or database change is needed. No new strings or tests were added.
## 13 November 2026 — Pipeline Watch voice audio (P15-132 / #1814)

Use bounded, sequenced 250 ms Watch microphone packets instead of stop-and-wait. Drop short gaps rather than ending voice on the first overflow; end with connection guidance after sustained lack of progress. Serialize accepted phone-side socket writes and ignore late or duplicate packets. Pipeline phone-to-Watch playback with bounded in-flight events and ordering barriers for completion and interruption; give playback priority over nonterminal voice updates. Negotiate the window and fall back to one message for older paired apps. Log aggregate latency, in-flight counts and drops, never audio. Preserve dictation's separate capture policy. Paired-device behavior remains unverified.

Direct Watch voice is a practical follow-up using the portable voice client and audio engine, but requires a separate voice-scoped WebSocket credential, session and budget limits, expiry handling and device/network/power qualification. The existing dictation-only credential must not be widened.

## 17 November 2026 — Watch focused voice view reuses the session state (P15-206 / #1945)

Decisions: the view is a presentation of the existing session (`voiceID`, `voiceState`, `muted`); no voice ownership, networking or teardown changed. Muted overrides the label, with the underlying state kept in the accessibility value, because Jarvis can speak while the microphone is muted. The transcript is the latest real message (nothing is invented when there is none). Back is unchanged and keeps the session; to avoid an invisible microphone the menu's Chat row reads Resume voice while a session is live. End uses the existing `endVoice` teardown and Chat returns with history and draft intact. The voice status row of the composer is removed. Open: not verified on a Watch; session events (Thinking, Reconnecting, failed) are shown as the model reports them.

## 17 November 2026 — Watch Chat adaptive composer is built on the native navigation bar (P15-203 / #1942)

The owner un-parked the Watch for the approved adaptive composer. Decisions:
- Keep the system navigation bar for the back control and time (title emptied) instead of drawing a header: the content already scrolls beneath it with the system material, and the handover forbids a replacement clock.
- The composer is an overlay with a fixed end margin on the scroll content, so expanding or collapsing never moves the message being read. Reading mode is entered by a scroll geometry flip (more than 80 pt from the newest message) or a new scroll while away; it is blocked while a draft, dictation, voice start or live voice is active. Sending or reaching the end restores the composer.
- Neutral glass for the new floating controls is one Watch component (`watchGlass`, `WatchIconButton`, `WatchEdgeFade` in `WatchDesign.swift`); the orb stays `WatchOrb`. No networking, voice or draft behaviour changed. The old Voice and Dictate menu rows are gone; the `jarvis-watch://voice` and `dictate` links still open Chat and act.

Open: the 80 pt threshold, transition length, large-text and smallest-watch layout, VoiceOver focus after Reply, and Crown scrolling are unverified on a Watch or simulator; "do not collapse under a finger" is covered only by the busy rules, not by touch tracking.

## 18 November 2026 — Watch capture: both modes, explicit mono, measured input (P15-211 / #1943)

Build 113's silence check fired for dictation and live voice while Apple's own dictation worked, so the Watch hardware and the system permission are not the cause; the tap delivers exact silence in our session setup. The two paths share `VoiceAudioEngine`, so they share the capture setup, but they differ in transport and were traced separately: dictation uploads a recorded clip (earlier it reached Speech; now it is refused locally when silent), live voice streams 250 ms packets through the phone (a 10 s deaf check ends it). Decisions:
- The session mode is chosen per path: `.default` for dictation (nothing plays, so no voice processing is needed) and `.voiceChat` for live voice (echo control while the Watch speaker plays). If the tap delivers exact digital silence for 2.5 s the engine restarts once in the other mode on the same stream, logs it, and the consumer only sees audio. This is a recovery for a dead input, not a fake success: if both modes are silent the existing honest error appears. iPhone capture keeps its mode and behaviour.
- Several Watch microphone channels are folded to mono by `WatchMonoMixer` (mean of channels that carry signal) before sample-rate conversion, instead of relying on an unmapped channel-count conversion.
- The tap's input peak, channel count, rate, route, session mode and permission are logged before conversion, so the next device test shows whether the input or the conversion lost the signal. The silence message no longer tells the owner to uncover the microphone.
- Chat: the newest message hid behind the composer because a scroll margin is ignored by scroll anchors. The clearance is now real content after the last message (`WatchChatLayout.endClearance`: measured composer height, bottom safe area and a gap), kept pinned when the composer grows, and the reading threshold counts that clearance as the end.

The delayed silence check is bound to its capture (`WatchCaptureGeneration`): `stop()`, a restart and a failed start invalidate earlier tokens, so a check scheduled for a stopped capture cannot restart the engine under a newer one (review finding on #1959).

Open: none of the capture changes is verified on a Watch. Whether the cause is the mode, the channel mixing or something else is not proven; the logs from the next run decide. Build 113 backend logs (18 Nov, no device attribution) show two /voice sockets near the owner's test that reached upstream `session_updated`, played Jarvis's output audio and closed 1006 after about 19 to 23 s with no input speech, commit or transcription, and no dictation upload at all. So socket and upstream setup work and the input audio never carried speech, which matches silence from the Watch capture; it does not prove it. The earlier "no voice socket" lead is superseded.

## 22 November 2026 — Recover Watch audio and retry failures (Refs #2006)

- **Confirmed voice bugs:** the route observer ended voice for any reported
  change except category changes. That path matches Dan's build 120 message.
  The startup retry also called `VoiceAudioEngine.stop()` after installing the
  playback-finished callback, so later replies could leave voice on Speaking.
- **Confirmed dictation gaps:** both launchers use the same Watch recorder.
  After Stop, an audio interruption or screen sleep could cancel its upload;
  an empty recognition result looked like a transport failure. Keep the
  bounded upload running and report no words separately, without replaying it.
- **Decision:** take a new graph and the negotiated format for each capture.
  Check again after 250 ms: only changed ports or a stopped graph need a
  rebuild. Allow two recoveries per capture in a rolling ten seconds, with
  up to three attempts per recovery on the same stream. More instability
  stops the capture and shows Retry instead of repeatedly cutting playback.
  Install playback completion on the successful startup attempt. On a
  phone-link gap, allow ten seconds including heartbeat replies; don't replay
  audio or open a second voice session.
- **Dictation fallback:** keep the recognition deadline for an active
  transfer, but don't wait for connectivity when the direct path is
  unavailable. Try the paired iPhone once instead.
- **Still inferred:** cold/stale audio routing could contribute to build 120
  dictation failures. Prior reports show a Speech start stall (#1950) and
  silent Watch captures (#1943), not which stage failed on build 120. No backend
  change or live test; use the next Watch run to separate capture and upload.

## 17 November 2026 — Watch dictation never reached Speech; measure capture (P15-202 / #1943)

The owner heard nothing from the Watch: dictation reported a timeout and live voice never heard him. Backend logs (Log Analytics, 14:49Z) for two 10 s dictations: `audio_received` at 0.7 s and 2.6 s with 489,082 bytes / 10,189 ms (real 24 kHz audio, so capture and upload worked), the speech token acquired at the same moment, then no `recognizer_started`, `session_started`, speech or error row for 6.5 to 9.4 s until the Watch disconnected. The SDK reports start only after its Speech connection opens, so that connection never opened. The Watch transcriber was the only Speech caller using a fixed `speechRecognitionLanguage` on the universal v2 endpoint; the live partial recognizer, probed live on 6 October (L111), uses language identification there.

Decisions:
- The Watch transcriber uses language identification for Danish and English (the same call as the live recognizer). This also lets Danish dictation work. Not yet proven live: it is the most probable cause, and the next device test decides.
- Bound the recognizer start to 6 s. A start that does not finish returns 503 with the logged stage `recognizer_start_timeout` instead of holding the request until the client gives up. New stages `recognizer_starting`, `recognizer_start_failed`, `service_connected` and `service_disconnected` show where a hang stops (numeric and fixed labels only; the log allow-list carries them).
- The Watch's direct window with a reachable phone is 10 s plus the clip length (up to the server's 22 s ceiling) and the overall wait is 30 s plus the clip length (up to 120 s). A fixed 10 s window cannot succeed for a 10 s recording. This refines the 14 November 10 s rule; the server's 20 s deadline is unchanged.
- Measure the captured PCM16 peak on the Watch (`WatchCaptureLevel`, tested). Dictation with no audio or only digital silence is not uploaded; the Watch says the microphone captured no sound. Live voice ends with the same message after 10 s of unmuted silence rather than showing a listening session that cannot hear. The converter follows each buffer's actual format. The peak is logged (`WatchVoice` category).

Open: live voice shows no Watch voice socket in the backend logs (only dictation credential renewals), so the cause of "cannot hear me" in live voice is not explained; the capture-level check and the `WatchVoice` logs are the next evidence. Nothing here is verified on a Watch.

## Notes deletion and swipe thresholds — 13 November 2026

The owner requested immediate pinning on a normal swipe and confirmation before
deleting on a longer swipe or from the editor. Use 72 and 160 points respectively,
with explicit Yes/No and the note's SHA. Reuse the vault's existing Git-backed
delete rather than inventing a trash store: committed files remain in Git history,
but unsaved drafts do not. Unknown outcomes require a refresh, not an automatic retry.
Native gesture and visual acceptance is still pending.

## 15 November 2026 - Monthly budget raised to [amount omitted]

The owner approved raising the resource group monthly budget from [amount omitted]. The expected run rate with PI is about [amount omitted] per month, so a [amount omitted] budget alerted constantly without informing anything. Alerts stay at [thresholds omitted] of actual cost. This is an alert threshold, not a spending cap; the proactive PI hard stop ([amount omitted]) is separate.
## 2026-11-15 P15-181: Single vault layout, cut over together with the vault clean-up

- Decision: Jarvis uses only the new vault paths: `Personal/Task inbox.md`, `Work/Task inbox.md` and `Personal/Health/Gym log/`. The `gym-log` frontmatter type is kept. There is no dual support, no layout detection and no compatibility shim; a first draft of this change that accepted both layouts was dropped.
- The vault mirror excludes the new `_agent-activity` segment. The existing `_agent-log` rule stayed until vault PR #5 merged and has since been removed (see 2026-11-16 below). `General/Archive/Agent activity log/` is not excluded: its 19 historical logs are tracked and excluding them would make the mirror treat them as deleted.
- Rollout: this merges and the backend deploys, then the vault clean-up PRs merge in the same cutover. A short window in which the vault and Jarvis disagree about paths is accepted.

## 2026-11-16 Vault mirror: drop the `_agent-log` exclusion (#1895)

- Decision: after vault PR #5 merged, the vault folder `_agent-log` no longer exists. The mirror policy (`apps/vault-mirror/src/engine/policy.ts`) now excludes only the `_agent-activity` segment, the local, gitignored live write log. There is no old-path rule or fallback left.
- `General/Archive/Agent activity log/` holds the 19 historical logs. It is intentionally publishable, is not excluded, and stays tracked in the mirror.
- Tests assert that `_agent-activity` paths (including nested and case-folded) are never approved and that `General/Archive/Agent activity log/` is approved.

## 2026-11-17 P15-190: 3D vault graph renders as projected 3D in `Canvas`, layout and camera in JarvisCore (#1924)

- Decision: the Graph tab uses the owner-approved Folder clusters design, drawn as projected 3D in a SwiftUI `Canvas` driven by a `TimelineView` (brief option A). Layout (clusters on a Fibonacci spiral, notes placed from a hash of their id, a fixed 32-step relaxation), camera, projection, hit testing, drift and the pulse schedule are pure functions in `JarvisCore/Graph3D` with Linux tests. The UIKit layer exists only because SwiftUI has no two-finger drag. SceneKit (soft-deprecated), RealityKit and SpriteKit were not chosen; Metal stays the fallback if a device measurement misses the brief's budget.
- Evidence so far: Linux tests (determinism, order independence, 2,000 notes laid out in about 0.5 s in a debug build), the macOS CI compile of the full app and simulator captures of a three-note fixture. No gesture run or device measurement exists yet; the PR says so.
- Data and colours: only real notes and edges are drawn (self links and unknown ends dropped, one edge per pair, an explicit link beats a similarity edge). Clusters are top-level folders. Work, Personal and General use amber, green and muted violet; every other folder is neutral. This follows the handover's three colours and does not add the brief's People blue. The preview shows the service's own open task count, and "Task count unavailable" when it sends none.
- Motion: no auto-rotation; no Alive state (the Notes page cannot read Jarvis's activity, so it is dropped rather than faked); pulses run on explicit links only. Reduce Motion or Background motion off gives one still pose with no inertia and no flights.
- Removed: the old 2D layout `graphPositions` and the unused `notesGraph*` size and opacity tokens.

## 2026-11-20 Voice agent instructions, voice and greeting are Foundry-owned

- Decision: Dan tunes `jarvis-pi-live` in the Foundry portal, so Deploy no longer writes, compares or fails on its instructions, output voice, greeting or any other field the app does not depend on. Previously a portal edit was overwritten by the next Deploy (new version plus re-pin) or failed it on readback.
- Bootstrap only: if the agent does not exist, `provision_pi_agent.py` creates version 1 once from `agents/pi/voice-definition.json` and `voice-instructions.md` and pins it. Those files are only that initial seed; editing them later changes nothing. The `marin` requirement was removed from `load_voice_spec`.
- If the agent exists, Deploy never posts a version and never patches the pin. It reads the effective version (the pinned version if a pin rule exists, otherwise `versions.latest`) and verifies only the contract the backend relay depends on: model `gpt-live-1` and its deployment, `kind: voice`, `sub_protocol: live`, `model_type: self_deployed`, `delegation: { type: "client" }`, audio format `audio/pcm` at 24,000 Hz (`store` was verified until 2026-11-21; see the entry at the end of this file). Drift fails with a `voice_readback_*_mismatch` or `voice_agent_*` code and is never auto-fixed.
- Tests are offline (`.github/scripts/tests/test_pi_agent.py`); no live Foundry call was made.

## 2026-11-20 Main agent (`jarvis-pi`) instructions are Foundry-owned

- Decision: Dan tunes the `jarvis-pi` instructions in the Foundry portal ("Foundry owns the whole instruction text; I keep the tool rules as a marked block at the bottom"), so Deploy never compares, verifies or restores that text. Previously the text was part of the fingerprint and of `verify`, so a portal edit was overwritten by the next Deploy or failed it with `readback_instructions_mismatch`. Same pattern as the voice agent entry above.
- Bootstrap only: if the agent does not exist, `provision_pi_agent.py` creates version 1 once from `agents/pi/instructions.md` (identity-contract placeholders filled by `instructions_text`) and pins it. The file is a seed; a leading HTML comment says so and is stripped from the seed. The content was not changed. The backend tool contract section (`[Turn ...]` line, `find_tools`, `call_tool`) is wrapped in `KEEP THIS BLOCK: backend tool contract (start)` / `(end)` lines with a sentence that removing it breaks tool use; those lines are part of the seed, so Dan sees them in Foundry. The section sits after the identity paragraphs, not at the bottom; it was not moved.
- Code keeps owning model, harness, reasoning effort, built-in tool setting, the Jarvis MCP tool and its connection, skills, and the MCP URL. `fingerprint()` hashes only those (spec, MCP URL, skill content); the instructions are excluded, so an instructions-only edit in Foundry never creates a version. `verify()` checks the same code-owned fields on a newly created version and no longer reads the instructions; drift fails with its `readback_*_mismatch` code.
- Carry-forward: when a code-owned part changed, Deploy reads the effective version (the pinned version if a pin rule exists, otherwise `versions.latest`, via `GET /agents/jarvis-pi` and `GET .../versions/<v>`, the same mechanism as the voice agent), posts a new version whose instructions equal that version's text, verifies it, then pins it. An existing agent without a usable version or text fails (`agent_version_unknown`, `agent_instructions_unreadable`) instead of being re-seeded from the repo. An existing agent with an unchanged fingerprint gets no POST; it gets no PATCH either when a pin rule selects it. Without a pin rule (for example a run that died between the POST, which stores the fingerprint, and the pin) the latest version is still verified and then pinned, so an unchecked version never keeps serving.
- Concurrent portal edits: Deploy re-reads the effective version (id and text) right before the version POST and again right before the pin, and fails with `agent_changed_during_deploy` if it moved (or if a missing agent appeared), so an edit Dan saves while Deploy runs is never replaced by a stale carry-forward.
- The voice agent has neither gap: it verifies the effective version on every Deploy (no fingerprint skip) and never writes to an existing agent. A half-seeded one stays unpinned and serves the latest version, which is verified.
- One-time effect: the fingerprint formula changed, so the first Deploy after this change publishes one new version carrying the live text forward and pins it. The same happens if a Foundry edit does not keep the version metadata (unverified; it settles after that Deploy).
- Not verified live: no Foundry call, Deploy or provisioning run was made; tests are offline (`.github/scripts/tests/test_pi_agent.py`). Still reading the repo text as if it were live: `apps/backend/src/pi/definition.test.ts` (asserts the seed's capability-overview wording) and docs that cite `agents/pi/instructions.md` for behaviour.

## 21 November 2026 — PI finds and calls its tools reliably: the approved baseline (#1967)

- Decision: Dan reviewed the large earlier attempt (PR #1987, branch `danaakesen-fluffy-parakeet`) feature by feature and approved only seven items. They were implemented fresh on current main; the branch was only read. PI stays unrestricted: no guardrail, approval gate, read-only default or fail-closed behaviour was added.
- 1 Local-first loading: `find_tools` never waits on a remote catalogue for a local search. GitHub and Azure bridges start idle (the startup and `/pi/warm` warm-ups are removed, which supersedes the #1910 choice to wake them at startup) and load only when the query names the provider or a `gh_`/`az_` tool; a named provider gets the existing 8 s bounded wait, then a keep-going/search-again-shortly note. Trade-off: the first Azure question after a quiet period now needs a second search while the container wakes.
- 2 Exact-name calls: names shown by `find_tools`, including `otherMatches`, are callable in the same turn. Aliases did not exist on main (`tool-search.ts` only matched query words against tool names and descriptions), so a small plain table of English and Danish wording was added (`intentAliases`), plus exact-name priority.
- 3 Tool overview note: first turn of a Foundry conversation and again only when the GitHub/Azure connection state changes, within the existing 1,500-character cap (measured 1,250 characters with every area present).
- 4 Foreground budget: Chat and Voice already counted only the chat turn kinds on main, apart from Background PI. What changed: an unreadable spend no longer fails the turn; it is logged and noted in the turn's diagnostics and the turn continues. The earlier attempt's fail-closed `pi_budget_unavailable` was not ported.
- 5 Progress events: a repeated or unmatched progress line never ends a turn. Reply text is still streamed as it arrives.
- 6 Owner-message binding: tools check the exact owner message attached to the turn instead of the newest stored message.
- 7 Remote tool results prefer `structuredContent`.
- Deliberately NOT ported (Dan rejected them): the request/completion classifier, pre-call action refusal, per-tool contracts and the startup throw on missing contracts, withholding or buffering the final answer, `pi_incomplete`, Memory write contracts and payload checks, background wake receipts, durable-work enforcement, persona as a Foundry `pi_context` input, conversation rotation/replay, any GPT-Live output gate or exact-transcript matching, and any voice code change. The `jarvis-pi` instructions stay Foundry-owned.
- Not verified: no live model, Foundry, MCP or provider call, and no `measure_pi`; tests are offline. Physical acceptance stays with Dan.

## 2026-11-21 Voice: speech never cancels PI's work

Dan's rule: a backchannel such as "mm-hm", or any transcript that is not a delegation, must leave the running PI turn alone, so a voice request ends the same way as the same request typed in chat.

- The relay no longer calls `piTurns.cancel()` when an input transcript starts or a new input group opens (`apps/backend/src/voice/relay.ts`). It does not classify the utterance: GPT-Live decides whether to delegate, and the relay stops cancelling on speech.
- A new delegation while PI works still supersedes the turn in flight (`createPiVoiceTurns.start`, unchanged). Chat's steering route does the same: it aborts the model round and continues with the new message. Chat's plain send is refused while a turn is active (409), and the gateway's single-flight lock refuses overlapping turns.
- Cancellation remains the session ending (`jarvis.session.end`, disconnect, teardown) and a new delegation (for example "stop that" reaches PI as its own turn). The voice protocol has no separate stop command; none was added.
- This supersedes the earlier choice that Dan starting to speak cancels the turn in flight (#1908, `docs/decisions.md` voice section).
- A delegation still settling (before PI starts) is not dropped by later speech either: the new utterance gets its own input group and the delegation proceeds with its own owner text. Only a new delegation supersedes it.

## 2026-11-21 Voice agent `store` is Foundry-owned

- Decision: `store` on `jarvis-pi-live` is owned in Foundry like instructions, voice and greeting. Deploy no longer verifies or compares it. Reason: the Foundry portal saves new versions with `store: true` (portal version 13 did, the seeded version 1 had `false`), which failed Deploy run 44915193797 with `voice_readback_store_mismatch`. Dan owns his Foundry project and wants Traces for tuning.
- Bootstrap only: when the agent does not exist, version 1 is still seeded with `store: false` from `agents/pi/voice-definition.json`.
- Still verified on every Deploy: kind, sub-protocol, model type, model, delegation `{type: client}`, audio format PCM 24 kHz, and the `gpt-live-1` deployment. Unknown extra fields (for example `greeting`) are ignored. The `jarvis-pi` provisioning is unchanged.
- Tests are offline (`.github/scripts/tests/test_pi_agent.py`); no live Foundry call was made.

## 2026-11-21 Voice: Dan's request stays whole and reaches PI (#1988, #1967)

Dan's TestFlight build 117 lost voice tool requests (five tries at "check Azure resource groups"; Jarvis acknowledged, then asked what to check) and showed one word per line in Chat. Cause: the direct-turn persist added in #1993 ran on every GPT-Live output delta, so it stored and locked the half-built owner turn while the words still arrived; later words opened new input groups, and the delegation found an empty group, waited 0.6 s and said "I did not catch that" without starting PI.

- A direct owner turn is stored only after its input has been quiet for 0.6 s since its last delta (`VOICE_INPUT_QUIET_MS`), and never when it is the pending delegation's turn. Output starting is not a reason to close it. The reply is stored after the owner message it answers, with a three-second bound (`apps/backend/src/voice/relay.ts`).
- An empty delegated turn is not "quiet": it keeps waiting for its transcript until the existing three-second bound, and only then sends the "did not catch that" reply.
- Words timed at or before the delegation `offset_ms` join the delegation's turn (unchanged from #1993); only later speech opens a new group. The #1993 delegation-before-transcript handling and the #1997 rule that speech never cancels PI are unchanged; session end still cancels.
- The "listening" state is no longer published from an input transcript while output is playing, PI is working or a delegation is settling.
- No keyword list, classifier, output gate or guardrail was added; GPT-Live stays natural. Four log events carry ids and lengths only: `voice.delegation_received`, `voice.owner_group_persisted` (with the reason), `voice.did_not_catch`, `voice.pi_turn_started`. They are on the `apps/backend/src/logging.ts` allowlist.
- Known limit: if Dan pauses more than 0.6 s mid-sentence while GPT-Live is already answering, that part is stored as its own turn, and a delegation that arrives later cannot adopt a turn that is already stored. It then waits for the speech after it, or says it did not catch it.
- Stuck "Speaking" (a) is not fixed here. Reading the iPhone code found a likely cause, recorded in the PR: `VoiceAudioEngine.stopPlayback()` clears per-response progress without calling the playback-finished handler, so a response that was already done but still draining stays "playing" in `VoiceSessionStateMachine` after a later response's cancel stops the audio. Unverified on a device.
- Tests are offline (`apps/backend/src/voice/relay-events.test.ts`, `apps/backend/src/logging.test.ts`); no live model, provider or voice call.

## 2026-11-21 Voice: the whole spoken turn goes to PI; `offset_ms` no longer cuts it (#1988, #1967)

TestFlight build 118 (with #1993 and #2000) still fragmented Dan's weather question. Production logs of one session (backend `ContainerAppConsoleLogs_CL`, 18:26:22-18:27:40 UTC) showed why: six separate `voice.owner_group_persisted` groups (11, 22, 17, 24, 3 and 4 characters, all `direct_quiet`) for one request, a delegation at `offsetMs` 20000 that attached to an empty group and gave `voice.did_not_catch` after 3004 ms while his words went into other groups, and later delegations that started PI with 11 and 6 characters (PI asked back, `toolCount` 0). In real GPT-Live traffic the delegation event arrives while the input transcript is still arriving, and `offset_ms` is not the end of the utterance. The unit tests used idealised events and missed it.

- **Supersedes the offset rule from #1993** (and its restatement in #2000): words timed at or before `offset_ms` no longer join the delegation, and later words no longer open a new group. `offset_ms` is only logged. A delegation's request is Dan's whole open turn, all input text since the previous turn boundary, whether it arrived before or after the event.
- A turn boundary is PI starting for it or the reply to it beginning. Words after that form the next turn (a correction or new request; GPT-Live emits a new delegation if it wants one, and the existing path supersedes the running PI turn). Speech still never cancels PI (#1997); only a new delegation or the session ending does.
- A delegation waits until the turn has been quiet for 1.5 s measured from the last input delta (`VOICE_TURN_QUIET_MS`, the same window as a direct turn: a 0.6 s window cut a request at a normal pause, sent PI the first fragment and left the rest as a direct message) with the existing three-second bound, then stores the whole turn and starts PI once. This adds up to 1.5 s before PI starts when the transcript was still arriving at the delegation. Only a turn still empty at the bound gets "I did not catch that", and words arriving after that open a new turn. A newer delegation arriving while the first still waits takes over the same turn instead of orphaning its text.
- A direct turn is stored only after 1.5 s of input quiet (`VOICE_TURN_QUIET_MS`, new; 0.6 s was shorter than normal pauses inside a sentence). Chosen because the production pauses were about 0.7-0.9 s and ordinary mid-sentence pauses stay under a second; it is bounded by the three-second wait, and it delays only when the transcript is stored, never speech or PI. Consecutive phrases with no reply or delegation between them are one stored message and one caption `itemId`. Chosen over coalescing by updating a stored message because nothing stored is ever rewritten, which keeps restored history and the iOS and Watch live captions unchanged.
- Observability: `voice.upstream_event_error` now carries the upstream error `errorType`, `errorCode` and `param` (short tokens matched against bounded patterns; the message is never logged), and `voice.activity_published` logs every real activity publish with state, reason, milliseconds since the last publish and whether output, PI or a delegation was still busy. Both are on the `apps/backend/src/logging.ts` allowlist, which drops every other field.
- A delegation that arrives after GPT-Live began answering, so Dan's words were already stored as a direct turn, adopts that stored turn as its request when no reply has completed for it, nothing newer was said and it is at most 10 s old: PI runs once with the stored message id, no second Dan message is stored and there is no "did not catch that". A turn that already got a completed reply is never adopted. Log outcome `adopted_stored_turn`.
- When the session ends, Dan's words still open (no reply or delegation stored them) are stored in teardown.
- No keyword list, classifier, output gate or guardrail; GPT-Live stays natural.
- Known limits: if GPT-Live starts answering and Dan then pauses longer than 1.5 s, the next words are a new turn; a delegation cannot adopt a stored turn that already has a completed reply or is older than 10 s.
- Tests are offline (`apps/backend/src/voice/relay-events.test.ts` with event shapes from the logs above, `apps/backend/src/logging.test.ts`); no live model, provider or voice call. Three earlier relay tests encoded the offset rule and were changed.

## 2026-11-21 Offline tool conformance suite: every Jarvis tool is proven discoverable and callable (#1967, #2012)

- Decision: Dan's P0 is that Chat and Voice can do everything Jarvis has tools for, without errors. One offline suite, `apps/backend/src/pi/tool-conformance.test.ts`, now proves it for the whole registry (`docs/tool-conformance.md` is the generated table). It composes every production module from in-memory stores and stubbed services (`apps/backend/src/pi/conformance/`, one group per area), builds the real app and drives the real PI MCP door (`find_tools`, `call_tool`) the way the managed agent does. Any tool added later is covered without a hand list: tools come from `app.jarvisTools.list()`, and a new key in `production-modules.ts` or a new tool factory in the `piModule` block of `index.ts` fails the suite until a conformance group composes it. It is an owner-requested exception to the 11 November minimal-test policy; it adds about ten seconds to the backend tests and makes no network, provider or paid call.
- CI fails when: a tool breaks the harness contract (a name of 1-64 characters from `A-Za-z0-9_-`, no `___`, no harness-managed name, no `gh_`/`az_` prefix that would route it to a bridge; a description of at least 30 characters and 6 words that says when to use it; an object schema with no `strict`, `$ref`, `$schema` or unknown keyword; a schema over 2,000 tokens unless listed with a ratchet); `find_tools` does not return it (curated English and Danish phrases must put the tool in the top 3 of the first search, every other tool must be returned for a query derived from its own description); `call_tool` cannot run it cleanly over the stubs (an unhandled throw, a non-200, a hang past 10 s, a result over 200,000 characters, the generic "Tool execution failed", a refusal or failure that is not plain English, a read tool that does not answer `ok` with a structured result); the five daily-core scenarios (project, notes, tasks, workouts, nutrition) stop completing in one call with no confirmation step; or `docs/tool-conformance.md` no longer matches the registry.
- Order independence: no case depends on another. Each uses fixtures no other case changes (a case that reads what another writes asserts only what is always there), `retry_job` starts its own failed research job, and the report picks the first table phrase that finds a tool instead of the first test that ran. The file passes under `--sequence.shuffle` for 24 seeds. A hung tool fails with its own message after 10 s (the test timeout is 30 s and the client races the request against its timer, because `app.inject` ignores an abort).
- Finding, not a change: nothing asks Dan for approval in Chat or Voice. `runRequested` runs the action at once unless a phone-call context exists, and phone calling is not wired (`phoneCall: undefined`, `index.ts`), so deletes (`vault_delete`, `workspaces_manage`, `health_food_review`, `health_saved_food` `delete_plan`, `calendar_delete_event`, `mail_delete_draft`) run without asking and `memory_forget` has no approval step at all. What does refuse is listed with file and line in PR #2022.
- Search wording (`pi/tool-search.ts`), data plus three scoring fixes, no classifier: stop words in both languages and bare numbers no longer score (an English description contains "en" and "min" inside other words, so a Danish request used to land on whichever tool had the longest description); words match description words by stem instead of by substring; alias rows can match compounds (`*opgave*`) and whole phrases ("glem ikke", "tidy up"), and a `light` row (a verb such as "show" or "create") counts half so it picks between the tools of one subject instead of outranking the subject. 157 rows, 314 English and Danish phrases, are pinned in `pi/conformance/phrases.testkit.ts`; 252 rank the right tool first and 62 in the top 3. The Danish forms of "husk" are listed (`husk`, `huske`, `huskede`, `huskes`) and not matched as `husk*`, which would also match `huskeliste` (a to-do list); a bare `group` or `gruppe` no longer names the Azure bridge, only a resource group does, so "send til gruppen" never waits for a cold Azure server.
- Real defects found and fixed (each its own `fix-main:` commit, listed in the PR): untyped throws that surfaced as "Tool execution failed" (missing Factory services, GitHub repository reads, `start_issue` and `manage_repository` outages, every PC bridge failure, `message_dan`, `workspaces_open` and `folio_open`, health lift history, `pi_note`, an oversize note); `owner_reminders` dropping a second reminder asked for in the same message; Ajv erasing every argument but `operation` from health `oneOf` schemas (`health_summary`, `health_nutrition_history`, `health_coach_status`), and `$ref`/`$schema` in the zod-generated food schemas; a door body limit (256 KB) below what `create_html_view` and `vault_write` accept; one note above 300 KB stopping the whole vault index from synchronizing; Google Calendar reads failing for the whole window when one event has no title; a flaky `get_system_health` check; and 23 descriptions that did not say when to use the tool (24 descriptions changed in all, found by diffing the registry on origin/main against this head; the 24th, `workspace_command`, stopped offering a session `language` switch the clients refuse).
- Not changed, on purpose: PI stays unrestricted. No guardrail, refusal, gate, approval or fallback was added. The approvals that exist today for non-delete actions are inventoried in the PR body, not removed; Dan decides what to relax. The only production seam added for tests is `searchWaitMs` on the remote bridge (default unchanged at 8 s).
- Open for Dan (PR body): the two 12-13k-token schemas (`workspace_command`, `show_in_chat`); `health_food_lookup` is defined but never registered (lookup is the `lookup_components` operation of `health_food_review`); `browser_do_shared` cannot succeed through PI (the shared-screen context is set only by the legacy chat route); duplicate `folio_*`/legacy alias tools take find_tools slots; `docs/features.md` still promises a session language switch that `workspace_command` refuses; three or more parallel writes to one note lose all but two; the approvals and restrictions inventory, which this change lists and does not remove.
- Not verified offline: no live model, Foundry, MCP server, GitHub, Azure, Google, Open-Meteo, image or voice call. The GitHub and Azure MCP servers are stubs shaped like the real ones; the harness-managed name list is our own list of the Copilot built-ins (Microsoft's page was not reachable from the build host); the Windows PC bridge, camera and screen frames are fakes; SQL stores are re-implemented in memory.

## 2026-11-21 Voice: stopping the player reports every response it silenced (#1988)

Dan reported the iPhone Voice screen staying on "Speaking" after Jarvis had stopped talking (TestFlight builds 116-119). This closes the open item recorded under "Dan's request stays whole" (stuck "Speaking" (a)), the one cause that could be proven offline.

- **Cause:** `VoiceSessionStateMachine` counts a response as playing from its first audio delta until the audio engine reports it played out, and shows Speaking while any response is playing, whatever the backend publishes. `VoiceAudioEngine.stopPlayback()` emptied its per-response bookkeeping without reporting anything. A response the backend had completed whose audio was still queued on the device therefore stayed "playing" for good once the cancellation of a newer response stopped the player, and every later `listening` or `thinking` from the backend was held at Speaking until the session ended or reconnected. The real relay produces that order: `response.completed` for A, `response.started` for B, then `response.cancelled` for B when Dan's next transcript opens a new input group.
- **Fix:** the per-response counting moved from the engine into `VoicePlaybackLedger` (JarvisCore) with the same finish and buffer-played rules, and `stopPlayback()` now reports every response it held through the existing playback-finished handler, which is how the iPhone session client and the Watch bridge already learn that a response ended. A response is reported once, whichever of the player's completion callback or the stop gets there first; a late completion for a response already reported changes nothing in the state machine. The iPhone Voice screen and the Watch share the engine, so both are covered. No new message, setting, backend or UI change: the backend receives the `jarvis.voice.playback.completed` receipts it already accepts.
- **Evidence:** the JarvisCore regression test (`VoicePlaybackLedgerTests`) ends on Speaking with the old behaviour and on Listening with the fix. A throwaway exhaustive replay (not committed) of every legal backend ordering of up to three responses through the real state machine found 156,153 orderings that end on Speaking for good with the old bookkeeping and none with the fix; the shortest was A created, A audio, A completed, B created, B cancelled.
- **Not proven, not changed:** whether the player's completion callbacks run before the old `removeAll()` when it is stopped is not established here, so how often this happened on Dan's iPhone is unknown. The response-counting rule exists since #1993 (build 117); build 116 predates it, so its symptom is not explained by this. Also unproven and untouched: audio-engine interruptions or route changes that stop the player without callbacks (the iPhone has no handler for them), a provider that streams audio without pauses (the relay would stay in `speaking`), and a slow transcript write holding back `response.completed` and `listening`, which both follow persistence.
- **Found, provable, not fixed here:** while PI is still working after an acknowledgement, the relay's last published state stays `speaking` (it never republishes `thinking` when the output ends), and the iPhone replaces it with Listening when the audio ends, so Thinking is not shown. Restoring the backend's last state on the phone without first fixing the relay would show Speaking instead.
- Tests are offline (JarvisCore on Linux); the app target is compiled only by the macOS Apple Watch build job. No live provider, device or paid call. Dan's device retest is still needed.

## 22 November 2026 — A write is told as it happened, counted by what it did, and an uncertain one is not written twice (Refs #2012, #1967)

- **Evidence:** offline reproductions on main after #2022 and #2016 (Astra's T-009 findings (a) to (d), and the review addenda (e) to (g)). (a) A plain `issue_comment` (no attachment, not public) called `createComment` directly, so any repeat posted twice; only the attachment path had the once-per-instruction receipt. (b) The tool route ran the tool, stored the audit row, and rethrew when the store failed: Fastify answered 500, the door said "The tool could not run" and recorded the call as failed, and the model's retry wrote again. (c) `create_issue` throws "Issue X was created as CODE, but its executor handoff could not be confirmed"; the confirmation Dan reads dropped it or, after #2017, put "Not done." in front of it. (d) The door counted an action only when the tool's default effect was `action`: an unannotated issue comment counted as no action and a gym `list` counted as one. (g) The same "Not done." sat in front of the PC bridge's "…the action may not have happened", because a `ToolFailure` could not say its outcome was unknown. (e) did **not** reproduce: `parseInput` already normalises `fireAt` to a UTC instant, so 10:05Z and 11:05+01:00 were one reminder; the key now hashes `intent.fireAt.toISOString()` and a test pins it; that test passes on main without this change (there was no bug to fix), and fails only if the key hashes the raw string again. (f) Real: the schema the model reads still offered a session `language` action with values da and en, and the reflex list counted it, after #2022 had made the contract refuse it.
- **(a) The issue is the receipt.** The plain comment goes through `oncePerIssueInstruction` per instruction and per draft (an identical repeat is answered from the first attempt, a different comment still posts), and ends with an invisible `<!-- jarvis-comment:session:message:hash -->` marker. A repeat reads the issue's comments first and answers `alreadyPosted` when it finds the marker, which covers a restart and a post whose reply never arrived. Failures are not remembered (the issue is the record, so a retry looks again); a 4xx answer from GitHub says nothing was posted, while no answer or a 5xx (which can come after GitHub stored the comment) says it may have been. Not being able to read the comments never refuses the comment. Rejected: a new SQL receipt table (the Factory's own event comments already use a marker and `readComments`), and a process-local receipt alone (it forgets on restart). The comment is no longer posted without the marker, so Dan's text is followed by an HTML comment he cannot see on GitHub. The marker is the `receipt` argument of `createComment`: the words stay limited to 4,000 characters (as on main), and the receipt, one short single-line HTML comment that cannot close early, rides on top and is validated on its own. A first version appended it to the words before the limit was counted, so a comment of about 3,900 to 4,000 characters, which posts on main, threw before anything was sent and was then told as "may have been posted"; the test now runs the real issue client over a fetch-level GitHub stub with the longest marker the backend can write (UUID session, 19-digit message id) at 3,990 and 4,000 characters. A comment with no words in it is refused up front ("The comment has no words to post. Nothing was posted."; main refused it too, with a vaguer failure), so the marker alone is never posted.
- **(b) A lost audit row never fails a write.** The route keeps the reply the tool made, logs `tool.audit_failed` (tool, outcome and error kind only, never the error's text, added to the log allow-list) and still finishes the activity with the real outcome. The reflex executor already answered a lost audit row without failing ("may have completed, but its result could not be recorded"). A write is not refused when the audit store is down: no gate was added.
- **(c) and (g) A failure that says what may have happened is shown as written.** `ToolFailure` takes `{ outcomeUnknown: true }`; the tool route and the reflex executor pass it into the result, where `confirmToolCall` (#2017) drops "Not done.", and the PI door keeps the call like a success, so a replay (the same call id) is answered with it and the write is not made twice. **The rule:** a ToolFailure whose own text says the work may have happened, or that only part of it was done, carries the flag; one that says nothing was done ("Nothing was written", "No reminder was created") or that fails before any work is the tool's own claim and keeps "Not done.". The first pass over the code was by hand and missed sites (the review of 22 November found them: `vault_write`, the HTML app, image, recipe and workspace command texts); `core/tool-failure-flags.test.ts` now reads the production source and fails for any ToolFailure whose text is written out in the call and says "may have", "may not have", "may or may not", "could not be confirmed", "not confirmed as", "could not be verified or saved", "outcome is unknown", or "saved / created / stored / applied / queued / completed, but", and has no flag; and for a flagged one that says nothing was done. It cannot see a text built from a variable or by another function; those were read by hand. **Flagged (48 call sites in 16 files):** PC bridge: the three "may not have happened" texts (disconnected, timed out, unreadable) wherever they are thrown. Factory: `create_issue` "created, but the handoff could not be confirmed", "could not confirm whether the issue was created", the unconfirmed GitHub write and image publication, "created, but its Factory task could not be queued" (2), an unconfirmed PR merge, and a plain issue comment when GitHub gave no answer or a 5xx. Google: the `uncertain` kind. Health: the "may have committed" receipts of food, food review, saved food and the three Health MCP routes, a coach profile update that "could not be confirmed", a recovery period "not confirmed as saved". Inbox: an item that could not be closed. Vault: `vault_write` "could not be confirmed" (a replay of an append would append twice) and the vault task tools' "the task save outcome is unknown" (`TaskWriteError.outcomeUnknown` was already set for the HTTP routes; the tool dropped it). Workspaces: the HTML app and image "was saved, but ..." failures (7 texts) and the workspace command texts "the client may already have applied it" (cancelled, 10 seconds without an acknowledgement, a tab that disconnected). Recipes: "The task completed, but its recipe could not be saved". Proactive: finding feedback that "could not be verified or saved". **Not flagged on purpose:** `start_issue`, `manage_repository`, `workspaces_open` ("nothing was started / added"), the Health stores' "could not be saved / updated / deleted" (workouts, lifts, nutrition and training targets, nutrition persistence), "Nothing was confirmed" for reminders and proactive preferences, and the vault's "Nothing was committed by this attempt": each says it was not done, so "Not done." is true. **Known, not flagged:** a task cancel whose state changed but whose sandbox cleanup failed says "Task is Cancelled, but sandbox cleanup could not be completed" (`factory/dispatcher.ts`: a free-text reason from the task controller, and the dispatcher has no offline test), so it still reads "Not done."; and `manage_model_deployment` says only "Model deployment operation failed." for any unexpected error. `start_issue` says "nothing was started" only for the steps before any write, lets a caller's cancel through, and shows an issue's own reason (a secret-like word, an empty or oversized text) as a refusal.
- **(d) and the replay half of (b) at the door.** The count uses `effectOf` (the operation named). Only 31 of the 157 tools then registered declared an effect (32 of 158 since #2025 added `proactive_message_feedback`, which declares its own), so `core/tool-effects.ts` classifies the other writers (70 tools, plus operation maps for `owner_reminders`, `health_coach_status`, `health_nutrition_history`, `health_nutrition_targets`, `task_routines`, `task_recipes` and `workspace_command`) and lists the 56 tools that only read or show; the registry merges the table (a tool's own declaration wins, so a test double that declares its own effect is left alone; the conformance suite fails when a production tool's own declaration differs from its row in the table, but an identical second declaration passes, because the registry hands the suite one merged value), and the conformance suite fails for a tool that is neither declared, listed as a writer, nor listed as read-only. Only writes are listed on purpose: the legacy Python agent treats an unclassified call like an action, so classifying writers changes nothing for it, while classifying reads as `read` would stop its call caching. A dotted `operation.field` for `health_food_review` was rejected because the Python validator refuses it; it is `action`. Classifying the writers also gives them #2016's replay recognition. A call whose route answer never came (a 5xx or an exception after the tool could have started) is reported "may or may not have gone through" for an action, and an error that says so (`outcomeUnknown`, an unexpected error from a write too, since #2017) is kept like a success: an identical replay (same call id) is answered with it and not run again. A failure that claims nothing happened, a refusal, and a request rejected before the tool started (4xx, 503) run again as before, and a new call under a new call id always runs. Rejected: counting every ok call of an unclassified tool as an action (it would call every read-only wake an action) and refusing a replay of an uncertain write (nothing is refused). Remote `gh_`/`az_` calls are still neither counted nor recognised: the bridge drops the MCP `readOnlyHint`.
- **First-search discoverability.** The conformance suite proves the phrases #2022 chose; 50 more pairs (English and Danish) of the same intents put the wrong tool first on the first search (for example "tick off the milk task" returned cancel_task, create_task and get_task, and "open an issue for the Jarvis project" never returned create_issue). They are fixed as 49 new plain-data rows in `intentAliases` plus one engine field, `also` (a row counts only next to its noun, so "tick off" and "rename" mean a vault task when a task is named and a verb inside a task's content does not capture the query), and the 50 pairs are added to the phrase table so both languages are enforced: 78 of the 100 phrases failed on the old table. Main's search engine is otherwise unchanged. A phrase for a capability that does not exist (the voice language) is not a row.
- **Reworked from #2023.** After #2022 merged, #2023 was reduced to what main lacked: the html-view window ids and update, the brain refusal wording, the Danish memory key, finding a note straight after writing it, Google free slots and the receipt of a refused write, `set_theme` glow and radius 0, `get_usage` rounding and the log limit text, the two giant tool schemas sent with their repeated parts once, the Chrome-keys and `codex_prompt` ordering fixes, `browser_do` texts and `browser_do_shared` from PI, the disliked-meal key, the gym and food texts, and the Factory task data and issue-start texts. Dropped because #2022 fixed the same bug (main's wording wins): `workspaces_open` not-found, the reminder key, the system-health clock skew, the grouped Health arguments and the recursive `$ref`, the PC bridge typed failures, the GitHub outage texts and untitled events. #2023's own suite is dropped; #2022's covers it.
- **Left as main has it:** `health_query` still answers a lift source with a redirect to `gym_lifts` (the assistant is not offered the browser accessor); reading the lifts there instead would save a call.
- **Not verified:** all offline. Whether Foundry sends a call id (so replay recognition is on) is still unmeasured. Dan's live Chat and Voice retest of the daily-core scenarios is open. The comment marker has not been seen on a real GitHub issue.

## 22 November 2026 — Shorten large PI reads and list three quick tools on the existing MCP connection

The later build-122 decision supersedes direct MCP registration only.

- Large tool results remain in the conversation and can be sent again on later model calls. Reduce the old 200,000-character door cap to 24,000 characters for successful read results. Measure the serialized `result` in UTF-16 code units, so `totalCharacters` describes the original JSON length. Keep paging/status and top-level evidence fields (`confirmation`, `receipt`, `receipts`, `verifiedRef`) intact even if those fields alone exceed the cap. Shorten the rest to a JSON preview, and say when the first array item does not fit. The door adds a shortened-result notice to the original confirmation without changing what was audited. Keep `list_capabilities` whole: it has no way to fetch a missing page of tools or features. Do not shorten errors, write results or remote results without an explicit read-only annotation. This changes payloads, not access, execution or auditing.
- List `weather`, `calendar_list_events` and `owner_reminders` beside `find_tools` and `call_tool`. Use the existing registry and one dispatcher: the same turn, tool, arguments and `_meta` call id identify a replay across both call forms. Weather's report still saves and opens a workspace item unless `report: false`; calendar is read-only; reminders use their existing per-operation effects. Keep the Foundry-owned instructions unchanged.
- If weather saves a report but cannot finish setting it up, mark the failure as partial so replaying the same call does not create another report.
- Three Danish phrases for #2025's `proactive_message_feedback` missed on the first search. Add noun-scoped aliases and English/Danish fixture pairs without changing the ranking algorithm.
- **Trade-off:** every turn can see three more schemas, but common calls need no search. The before/after query in `docs/agent-context.md` measures search count and input tokens from normal use. Only offline fixture results are verified; the savings and harness selection are not measured live.

## 22 November 2026 — Raise the Terra deployment from 150K to 600K tokens per minute (Refs #2012)

- Dan's build-122 test: tasks, project status, nutrition and Voice turns that used a tool showed a failure although the tool had succeeded (a task was marked done, then the turn said "part of it may already be done"). The production log shows `pi.stream_failed ... code rate_limit_exceeded` on the model round after the tool result, 38–63 seconds into the turn, at 17:13, 17:43, 17:58, 17:59 and 18:05 UTC.
- Cause (observed, log plus `az cognitiveservices account deployment show`): the `gpt-6.1-terra` deployment had a token limit of 150,000 per 60 seconds. A PI request carries 84K–116K input tokens, so a turn with a tool makes two or more requests and goes over. Turns without a tool make one request and passed.
- Decision (Dan approved "apply live now and merge the Bicep change"): raise `terraChatCapacity` to 600 (600K TPM, 600 requests per minute) in `infra/main.parameters.json` and, the same day, on the live deployment with the same model, version and SKU. GlobalStandard is pay-per-token with no reserved purchase, so a higher limit adds no standing cost; the PI monthly cap still stops spend. Region quota is 4,000.
- Not changed here: the gateway still gives up on a rate limit without retrying, and the 100K-token context per request. Both are separate work (gateway retry with a truthful outcome; conversation compaction needs Dan's decision).
