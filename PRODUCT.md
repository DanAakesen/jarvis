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
6. **Banking** — later; ask Dan before anything that moves money.

## Page requirements

### Chat and Voice parity

- Keep one ongoing conversation across Chat and Voice, including through future compaction. Returning to Chat must show the accepted turn or its saved reply without sending it again. Support asking “Where am I?” using the phone’s timestamped, approximate location when available. Keep the same PI tool dispatcher, owner identity and stored evidence. Voice should sound like Jarvis, understand the entire spoken request and handle interruption, silence and reconnect. Typing in Chat while Voice works queues one request and gets one reply.
- Chat can follow the active Voice exchange, show when it is listening, thinking or speaking, and let Dan scroll back without yanking him to the bottom. Use Apple Maps on iPhone for nearby places, route estimates and departure times with a chosen buffer. For a nearby business, show a matching local place or say that none was found. If no starting location is available, ask for an address instead of broadening the search. Let Dan select an ambiguous place and open Directions. Show a chart, map or note on screen when easier to see than hear; do not force a web handoff on iPhone.
- Explain failures in one plain sentence shared by Chat and Voice. A stop, stale history refresh, or a working reply with a failed tool is not a failed send. If an action finished but the reply did not, show or say the recorded receipt. Say to check before retrying only when the action may already have happened.
- Push replies open the exact stored message on iPhone or Watch. An accepted reminder schedule is not proof of device delivery. Show what actually happened.

### Tools

- Dan can inspect Foundry agents and model deployments, edit instructions or an agent model in a new version, and select the serving version from Chat or Voice. Preserve the protected backend tool contract.
- Ordinary Chat and Voice use PI. `find_tools` and `call_tool` reach Jarvis tools and `gh_`/`az_` operations through the same MCP connection. Native harness work runs in Foundry; durable code changes use Factory workers. GPT-Live handles voice, not a second tool engine.
- Find the right tool from ordinary Danish or English requests, including the daily core on the first search. Retrieve supported results and distinguish empty, stale, partial and unavailable data. Return paging and write receipts intact; never say a write happened without evidence.
- Use model judgement for routing and answers. Keep deterministic checks where the exact result matters: access boundaries, identity, persistence, idempotency and receipts. The PI approval exception is DELETE; do not create an app-wide policy change from that product rule.

### Software Factory — task view

Show actual issues, PRs, worker state and releases, and surface what needs Dan's attention. From Chat or Voice, Dan can ask about the project, start work in an identified project, and follow or steer an existing worker. A coding change is not delivered just because a worker stopped: show the real PR/check/release state.

### Notes

The Vault is the source of truth. Find and read a note by title or content in Chat or Voice. A saved note should appear on the relevant first page, even with only a title. The editor, list, graph, pins and reader use the same leading H1 or readable filename. Show the headline once, preserve links and explicit aliases, and do not overwrite a stale draft silently. Editing the title does not rename or move the file; an explicit folder move saves with the draft. A missing note can still be unpinned by path. See [PLAN.md](PLAN.md) for device results.

### Tasks

List Tasks by their current state, not by stale chat text. Dan can create, find, update or complete a task from either conversation channel, then see the same outcome in Tasks. Keep general tasks distinct from Factory issues and workers. Preserve the reminder's time and target; distinguish saved, failed delivery and confirmed delivery.

### Calendar

Browse and edit the primary Google Calendar used by Home, Chat and Voice. Schedule combines appointments with tasks and keeps their actions distinct.

### Appearance

Dan can change or reset the accent colours and the shared Gradient, Frost and Glass finish on iPhone. The paired Watch picks up the saved settings when it connects. Individual iPhone cards can override colour, not finish.

### Workouts

Show recorded workouts and lift history without double-counting or treating missing values as zero. For the training target, count gym sessions and runs. Walks belong in the overall workout count and step history. Saved max lifts record the best weight and reps for each exercise. Logging in iPhone Gym must be visible to the tool as well as to the screen. Chat and Voice must find the same lift, report the recorded result and let Dan correct a wrong entry.

### Nutrition

When Dan logs food, answer for the current Copenhagen day: kcal logged, kcal left and protein still needed. Explain missing targets or incomplete data instead of inventing totals. Chat and Voice can log or correct food. On iPhone, kcal and optional protein grams add one meal. Today’s remaining kcal are resting target + active energy − deficit − logged intake across Nutrition, Chat and Voice. If a logged meal lacks protein grams, the amount still needed based on known entries is an upper bound.

### Proactive

The brain should decide whether a change needs attention, explain why now, and open the exact message with its evidence and follow-up context. Example: heavy snow when the calendar shows a two-hour drive. That is a goal, not verified weather/travel automation. GitHub events, failed reminders and calendar overlaps follow their source switches. **Proactive suggestions** on the main iPhone Settings page controls the background reviews; it defaults to off. Status shows whether a review ran, skipped or failed. Exact-time reminders use their own delivery path.

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

- The current daily core succeeds in order in Chat and Voice, with matching tool outcomes, no duplicate effects and no extra approval on a non-DELETE PI action. A complete reply or a truthful partial-result receipt reaches Dan once.
- A saved note is findable right away; task and workout changes are readable on the other surface; nutrition totals reflect actual logged data. Memory and Vault writes go to the intended stores.
- A useful proactive alert explains its signal, opens the right message and supports “do that” against the same evidence. A dismissed, paused or disabled source does not disturb the owner by accident.
- Offline replay proves declared contracts, not a working phone or a live provider. Use the recorded TestFlight build and explicit device checks in [PLAN.md](PLAN.md) before marking them accepted.

## Out of scope

- Multi-user or team administration.
- A second Chat/Voice runtime, an automatic switch back to the old harness, or an unapproved legacy deletion. No silent default read-only mode or extra PI approval.
- No unapproved paid provider checks or cost increases.

## Standing rules

- **Model first.** Leave choices to PI unless an exact result is needed. Do not add PI approvals, confirmations or guardrails except for DELETE actions.
- **One path.** Build the new path, test it, then delete the old path as an explicit last phase. No fallback, parallel compatibility path or shim. A short deliberate break during cutover is acceptable only when called out.
- **No unapproved cost.** Work locally; no new cloud sandboxes without approval. No live or paid tests (`measure_pi`, model/provider smoke, Foundry probes or paid benchmarks) without Dan approving the exact command. Do not add cost without his approval. Workers use `gpt-6.2-sol` at the highest reasoning effort.
- **Few, substantial issues and PRs.** Open a PR only when ready for review. Independent exact-head review and green exact-head CI are required; High findings block, Mediums become fixes or follow-ups.
- **Use Astra for real decisions.** Astra's advice file, `CopilotAndCodex.md`, exists only on Dan's machine. Never commit it.
- **Ask for a device test after delivery.** State the build and exactly what to test in daily-core order. Do not ask for a retest during an in-flight fix. Lead with the answer and keep replies short; put a legend on diagrams.

[Dated rule sources](docs/decisions.md#standing-rules) · [Architecture](docs/architecture.md) · [Design](DESIGN.md).
