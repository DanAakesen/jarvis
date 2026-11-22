# Product

## Purpose and users

Jarvis is Dan's personal assistant and a way to run the Jarvis project itself. It is single-user, works in Danish and English, and reaches the same conversation and tools from Chat and Voice. Web, iPhone and Watch are different surfaces, not separate assistants. Documentation and default UI copy are English.

## North star

Dan, 21 November 2026 (excerpt; tracked in [#2012](https://github.com/DanAakesen/jarvis/issues/2012) and [#2011](https://github.com/DanAakesen/jarvis/issues/2011)):

> "the goal with PI was to get a dots / duet / muse / grok bot experience, that is always on, … and can be proactive, and know me super well when i manually reach out."

**P0:** Every tool works the same in Chat and Voice, with no errors. **P1:** Jarvis anticipates what needs attention. **P2:** Polish and everything else. [PLAN.md](PLAN.md) owns release and acceptance state.

## Daily core

1. **Jarvis project** — issues, PRs, workers and releases.
2. **Notes** — find, read, create and edit notes.
3. **Tasks** — find, create, complete and follow up on tasks.
4. **Workouts** — read sessions and gym history, and log workouts and lifts.
5. **Nutrition** when logging food — kcal logged and left today, and protein still needed.
6. **Banking**, later — ask Dan again before anything that moves money.

## Page requirements

### Chat and Voice parity

- Keep one conversation and the same PI tool dispatcher, owner identity and stored evidence. Voice should sound like Jarvis, understand the entire spoken request and handle interruption, silence and reconnect. Typing in Chat while Voice works queues one request and gets one reply.
- Chat can follow the active Voice exchange, show when it is listening, thinking or speaking, and let Dan scroll back without yanking him to the bottom. Show a chart, map or note on screen when easier to see than hear; do not force a web handoff on iPhone.
- Explain failures in one plain sentence shared by Chat and Voice. A stop, stale history refresh, or a working reply with a failed tool is not a failed send. If an action finished but the reply did not, show or say the recorded receipt. Say to check before retrying only when the action may already have happened.
- Push replies open the exact stored message on iPhone or Watch. An accepted reminder schedule is not proof of device delivery. Show what actually happened.

### Tools

- Ordinary Chat and Voice use PI. `find_tools` and `call_tool` reach Jarvis tools and `gh_`/`az_` operations through the same MCP connection. Native harness work runs in Foundry; durable code changes use Factory workers. GPT-Live handles voice, not a second tool engine.
- Find the right tool from ordinary Danish or English requests, including the daily core on the first search. Retrieve supported results and distinguish empty, stale, partial and unavailable data. Return paging and write receipts intact; never say a write happened without evidence.
- Use model judgement for routing and answers. Keep deterministic checks where the exact result matters: access boundaries, identity, persistence, idempotency and receipts. The PI approval exception is DELETE; do not create an app-wide policy change from that product rule.

### Software Factory — task view

Show actual issues, PRs, worker state and releases, and surface what needs Dan's attention. From Chat or Voice, Dan can ask about the project, start work in an identified project, and follow or steer an existing worker. A coding change is not delivered just because a worker stopped: show the real PR/check/release state. See the [historical task lifecycle](docs/archive/product-2026-10-to-11.md#task-lifecycle) for the state model.

### Notes

The Vault is the source of truth. Find and read a note by title or content in Chat or Voice. An explicitly saved note should be visible on the relevant first page, including notes with only a title. The editor, list, graph, pins and reader should agree on the title, with the readable filename used when Markdown has no title. Show the headline once, preserve links and explicit aliases, and do not overwrite a stale draft silently. Title editing is merged; [#2031](https://github.com/DanAakesen/jarvis/pull/2031) tracks the pending inventory/title fixes.

### Tasks

List Tasks by their current state, not by stale chat text. Dan can create, find, update or complete a task from either conversation channel, then see the same outcome in Tasks. Keep general tasks distinct from Factory issues and workers. Preserve the reminder's time and target; distinguish saved, failed delivery and confirmed delivery.

### Workouts

Show recorded workouts and lift history without double-counting or treating missing values as zero. Logging in iPhone Gym must be visible to the tool as well as to the screen. Chat and Voice must find the same lift, report the recorded result and let Dan correct a wrong entry.

### Nutrition

When Dan logs food, answer for the current Copenhagen day: kcal logged, kcal left and protein still needed, using the recorded entries and configured targets. Explain missing targets or incomplete data instead of inventing totals. Log or correct food through supported conversational tools. **Open:** manual kcal entry directly on the Nutrition screen; see [plan decision B](PLAN.md#open-decisions-af).

### Proactive

The brain should decide whether a change needs attention, explain why now, and open the exact message with its evidence and follow-up context. Example: heavy snow when the calendar shows a two-hour drive. That is a product goal, not verified weather/travel automation. GitHub events, failed reminders and calendar overlaps are available as signals in code; they follow their source switches. Dan controls Background PI in **Settings → Proactive**. It starts off; status must say whether it ran, skipped or failed. Explicit reminders and the legacy 07:00/18:00 checks are not the same thing as a brain wake.

### Memory vs Vault Knowledge

| Layer | Source and contract |
| --- | --- |
| **Session context** | Current conversation, active work and tool receipts. Use these first when they answer the request. |
| **Personal Memory** | Durable owner facts, preferences, corrections and commitments in Azure SQL, with source attribution and history. A clear “remember this” in Chat or Voice writes here, not to the Vault. Confirm only after commit. Corrections update the same identity; forget resolves an exact memory before deletion. Do not infer sensitive facts or save credentials. |
| **Vault Knowledge** | Authoritative Obsidian/GitHub notes, tasks, plans and research. Indices are retrieval aids. Retrieval from the Vault does not turn a note into a memory. Query either or both as the request needs. |

### CarPlay

In-car use is a major use case: hands-free conversation, short spoken answers, and relevant proactive heads-ups without asking Dan to read or operate the phone. Dan reported Apple's **Voice Based Conversation** entitlement grant on 21 November 2026. The grant is not evidence that the capability is configured, shipped or working in a car.

### Watch

Start dictation and Voice on the first press, recover the route when it drops, and keep listening, speaking and reconnect states truthful. Chat and Voice use the same PI results as iPhone. A reply notification should open its exact conversation/message without dropping a draft or interrupting active Voice. Physical Watch acceptance is separate from Apple build and JarvisCore tests.

## Success criteria

- Dan's daily core succeeds in order on both Chat and Voice, with matching tool outcomes, no duplicate effects and no extra approval on a non-DELETE PI action. A complete reply or a truthful partial-result receipt reaches him once.
- A saved note is findable right away; task and workout changes are readable on the other surface; nutrition totals reflect actual logged data. Memory and Vault writes go to the intended stores.
- A useful proactive alert explains its signal, opens the right message and supports “do that” against the same evidence. A dismissed, paused or disabled source does not disturb the owner by accident.
- Offline replay proves declared contracts, not a working phone or a live provider. Use the recorded TestFlight build and explicit device checks in [PLAN.md](PLAN.md) before marking them accepted.

## Out of scope

- Banking integrations or money movement, multi-user/team administration, and a new standalone Windows or CarPlay rollout in the current P0 work.
- A second Chat/Voice runtime, an automatic switch back to the old harness, or an unapproved legacy deletion. No silent default read-only mode or extra PI approval.
- Manual kcal entry or Foundry admin writes before Dan settles their scope. No unapproved paid provider checks or cost increases.

## Standing rules

- **Model first.** Leave choices to PI unless an exact result is needed. Do not add approvals, confirmations or guardrails except for DELETE actions. Banking is a separate unresolved product decision.
- **One path.** Build the new path, test it, then delete the old path as an explicit last phase. No fallback, parallel compatibility path or shim. A short deliberate break during cutover is acceptable only when called out.
- **No unapproved cost.** Work locally; no new cloud sandboxes without approval. No live or paid tests (`measure_pi`, model/provider smoke, Foundry probes or paid benchmarks) without Dan approving the exact command. Do not add cost without his approval. Workers use `gpt-6.2-sol` at the highest reasoning effort.
- **Few, substantial issues and PRs.** Open a PR only when ready for review. Agents never merge their own PR. Independent exact-head review and green exact-head CI are required; High findings block, Mediums become fixes or follow-ups.
- **Use Astra for real decisions.** The frontier advisor's `CopilotAndCodex.md` is local and untracked; never commit it.
- **Ask for a device test after delivery.** State the build and exactly what to test in daily-core order. Do not ask for a retest during an in-flight fix. Lead with the answer and keep replies short; put a legend on diagrams.

[Dated rule sources](docs/decisions.md#standing-rules) · [Architecture](docs/architecture.md) · [Design](DESIGN.md) · [Full product history](docs/archive/product-2026-10-to-11.md).

### Daily

[Original Daily migration and source exclusions](docs/archive/product-2026-10-to-11.md#health-migration-approved-p12). Current owner-facing requirements are under Workouts and Nutrition above.

### Web notifications and confirmations (P6-22)

[Historical web notification and confirmation contract](docs/archive/product-2026-10-to-11.md#web-notifications-and-confirmations-p6-22). See the current PI rules above for Chat and Voice.
