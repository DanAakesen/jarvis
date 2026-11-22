# PI cutover checklist and deletion inventory

Prepared for [#1887](https://github.com/DanAakesen/jarvis/issues/1887) (P15-176), 16 November 2026, and updated by #1966 on 19 November. **PI is the normal Chat and Voice default; #1966 removes its normal-route selector and makes infrastructure preserve the exact PI configuration. Phase 8's broader harness/resource deletion is still not approved.**

Use the [architecture map](../architecture.md) for current routing. Recheck this inventory against the code when the cutover is approved; old file names and proposed deletions below are not instructions to execute today.

```mermaid
flowchart LR
    T["Phase 7<br/>PI normal default<br/>Current kept selectable"] --> C1["#1966\nPI-only normal clients\nexact PI config retention"]
    C1 --> D["Daily use<br/>owner acceptance and no revert"]
    D --> G{"Deletion gate<br/>7 checks, section 3"}
    G -->|"owner approves in writing"| X["Phase 8<br/>delete exactly the list in section 4"]
    G -->|"no"| R["Fix PI<br/>old code still there,<br/>no code switches to it"]
    C1 -. "release problem" .-> B["Revert the reviewed change,<br/>redeploy the prior release"]
```

## 1. What the owner tests in normal use

| Area | How | What good looks like | Reference |
| --- | --- | --- | --- |
| Chat | Use normal Chat for a day; there is no engine choice | Quality at least as good as before; first text about 1.1 to 1.3 s warm, about 3.3 s cold; honest errors and write receipts; delete confirmation and tool parity with Voice | Timing is the November trial baseline, not a new measurement. [Current Chat and Voice contract](../architecture.md#chat-and-voice) |
| Voice | Start normal Voice (first answer takes a few seconds), ask something that needs a tool, say a backchannel ("mm-hm") while it works, then ask a follow-up | A short sentence from PI before a tool call, then a short spoken answer; speech alone never stops PI, and only a new delegated request (the newest one wins) or ending the session does; later turns about as fast as warm chat; chat and voice remember each other | PR #1908; `voice.pi_turn` and `voice.turn_timing` logs |
| Brain | Settings > Proactive, Proactive suggestions on | Useful reach-outs without duplicates; honour the owner settings and background limits | [Proactive flow](../architecture.md#proactive-wake-and-the-old-engine) |
| Watches | "Keep me updated on X"; list; stop | Looks and reports as asked, shows the estimated cost per watch and does not send duplicate messages | [Proactive flow](../architecture.md#proactive-wake-and-the-old-engine) |
| Reach | After the owner provides `PI_GITHUB_TOKEN` (fine-grained token, see `docs/agent-context.md`) and runs `infra/setup-azure-mcp.ps1` | Reads and actions work on real questions; or PI says plainly it is not attached | `docs/agent-context.md`, "PI reach" |
| Cost | Use available status evidence; no live measurement without approval | A plain turn about 0.05 DKK, a tool turn about 0.17 DKK, month inside the cap | Historical per-turn reference, not a new measurement. [Cost and safety](../agent-context.md#cost-and-safety) |

**Known limits:** Watch and web follow the same PI route. Camera and screen sharing in web voice return `not_supported`. The old harness still exists for isolated runtime tests and is not a normal fallback. The combined PI situational loop now owns the proactive slots through the persisted event/slot ledger; ordinary source policy and budget rules still apply.

## 2. PI-only normal route and release receipt (#1966)

[#1910](https://github.com/DanAakesen/jarvis/pull/1910) made PI the normal default. #1966 removes the compatibility selector from normal clients and makes infrastructure preserve the working PI tuple.

| Change | Detail |
| --- | --- |
| Chat | Every normal turn uses PI. Older clients may send `engine: "pi"`; `current` and unknown values are rejected. Isolated runtime-test sessions retain their own runtime |
| Voice | `/voice` and compatibility `/voice?engine=pi` use PI. Any other engine query closes 1008 |
| iPhone | `ChatEngine`, the saved choice, Settings selector, PI test pill and normal-client engine parameters are removed. `PiBrainStatus` stays in Proactive settings |
| Watch and web | Neither sends an engine. They use the same PI route; PI web voice does not support camera or screen sharing |
| Infrastructure | Bicep receives a validated secure PI configuration captured from the old backend, rather than losing values during the infrastructure revision |
| Readiness | `pi-agent` runs before smoke, waits for its exact backend revision and supplies the accepted release receipt |
| What stays | Isolated runtime-test support, the old harness/resources pending phase 8, Background PI in Proactive and all proactive ledgers |

Rollback is a reviewed revert and redeploy of the prior release. There is no runtime switch back to Current.

## 3. Deletion gate (from `docs/pi/plan.md`, section 7)

| # | Check | State |
| --- | --- | --- |
| 1 | The owner says he is happy with PI in daily use (his word, recorded in `docs/decisions.md`) | Open |
| 2 | At least two weeks as the default, no revert, no unplanned outage | Open |
| 3 | Chat, voice, proactive, inbox and watches each verified live, not only in tests | Open |
| 4 | Latency, cost and quality at or better than the gate A targets on real use | Open |
| 5 | The owner has accepted the preview risk in writing (the harness is in public preview, no SLA; with no fallback code a Foundry outage is a PI outage), or the harness is generally available | Open |
| 6 | The last release with the old path is tagged and the rollback steps are written in `docs/agent-context.md` | Open: tag the release the flip merges from, then write the steps |
| 7 | This inventory is reviewed by a reference scan on the day of the deletion (section 5) | Scan done 16 November on `main`; repeat before deleting |

## 4. Deletion inventory for phase 8

Method and limits are in section 5. **Whole** means no remaining caller was found once the old path goes. **Split** means other kept code imports named symbols, so the file is reduced, not removed. Nothing below touches data: no table, migration, blob or vault note is deleted.

### 4.1 Move first (couplings that break the build if the folder simply goes)

| Coupling | Where | What to do |
| --- | --- | --- |
| The PI agent's persona is built from `agents/jarvis/identity-contract.json` | `.github/scripts/provision_pi_agent.py` (`instructions_text`) | Move the file next to the PI agent (`agents/pi/`) and point the provisioner at it |
| The backend reads three files from `agents/jarvis/` | `apps/backend/src/core/identity-composition.ts` (`identity-contract.json`), `core/presence-instructions.ts` (`presence-instructions.json`), a drift test against `limits.json` in `core/tool-registry.ts`; `apps/backend/Dockerfile` copies the first two; `.dockerignore` lists them | Move `identity-contract.json` and `presence-instructions.json` to the backend, update the Dockerfile and `.dockerignore`; drop `limits.json` and its drift test, or move the limits into TypeScript |
| A PI test reads the old Python adapter for the preview header | `apps/backend/src/pi/definition.test.ts` (`agents/jarvis/managed_copilot.py`); `pi/definition.ts` comment | Pin the header value in the test itself |
| The PI gateway uses shared helpers from the old chat module | `pi/gateway.ts` imports `parseEvents`, `FOUNDRY_AGENT_SCOPE` and the `ConversationAgent*` types from `core/chat-agent.ts`; `voice/pi-voice.ts` imports the types | Move those into a PI or shared module, then remove the hosted-agent invocation |
| The PI MCP server uses the old voice lookup | `pi/mcp.ts` imports `searchVoiceTools`, `shortenVoiceDescription` from `voice/voice-tools.ts` | Move both into `pi/` |
| The brain imports a retry constant | `pi/brain/runner.ts` imports `MAX_EVENT_ATTEMPTS` from `proactive/events/rules.ts` | Move it to the event queue module |
| Kept proactive hooks import a type from the slot engine | `proactive/alerts.ts`, `reminders.ts`, `todo-writer.ts`, `inbox/proactive-hook.ts` import `FindingsStoredContext` from `proactive/engine.ts` | See decision A below |

### 4.2 The old chat harness: Python agent (all of `agents/jarvis/`, after 4.1)

Whole: `chat_runtime.py`, `model_client.py`, `tool_lookup.py`, `conversation_memory.py`, `jarvis_tools.py`, `response_coordinator.py`, `voice_runtime.py`, `calendar_flow.py`, `state.py`, `main.py`, `model_contract.py`, `chat_telemetry.py`, `response_telemetry.py`, `stream_keepalive.py`, `visual_context.py`; the `managed_*` bridge: `managed_bindings.py`, `managed_copilot.py`, `managed_copilot_definition.py`, `managed_definition_fingerprint.py`, `managed_policy_client.py`, `managed_policy_compatibility.py`, `managed_policy_template.py`, `managed_provider_cause.py`, `managed_runtime_factory.py`; `Dockerfile`, `pyproject.toml`, `requirements*.in|txt`, `README.md`, `tests/` (3 files), `scripts/` (smoke test). `limits.json`, `presence-instructions.json` and `identity-contract.json` leave through 4.1.

### 4.3 The old chat harness and old proactive pipeline: backend

| File | Verdict | Boundary |
| --- | --- | --- |
| `core/chat-agent.ts` | Split | Remove the hosted-agent invocation and Foundry session helpers; keep what 4.1 moves |
| `core/managed-policy-compatibility.ts`, `core/managed-target-reader.ts`, `core/chat-canary.ts`, `core/managed-runtime-routes.ts`, `core/runtime-test-availability.ts`, `database/runtime-session-store.ts` | Whole | Callers are the old chat route and `index.ts` wiring only |
| `core/recoverable-chat.ts` | **Keep** | The chat turn route keeps every turn, PI and old, in `recoverableTurns` (`RecoverableChat`) for the recover and stop endpoints; the scan first marked it as old-path-only by mistake (review finding on #1909) |
| `core/runtime-session.ts` | Split | Also imported by `core/conversation-store.ts`, `database/conversation-store.ts`: remove the isolated runtime-test sessions and keep what the conversation store needs. Migration `0069_runtime_test_sessions.sql` stays; data stays |
| `core/conversation.ts` | Split | Keep the shared stream, steering and acknowledgment handling that PI uses. Remove the non-PI agent branch (`app.conversationAgent`), runtime-test sessions, managed routes and the old reflex classifier use; then the `engine` field and test switch go (section 4.5) |
| `core/capability-instructions.ts`, `core/capability-index.ts` | Split | `core/settings.ts`, `core/agent-contract.ts` and the old realtime path import them; remove the 15,000-character catalogue prompt once the old voice path and old chat are gone |
| `core/approval.ts`, `core/approval-interpreter*.ts` | **Keep** | Used by Google, Factory, inbox, vault, health, proactive and `core/pending-action.ts`. The plan's candidate (regex phrase approvals) is not deletable on current evidence; the old voice path's use (`classifyApprovalReply`) goes with it |
| `core/reflex.ts` | Split | `core/index.ts` imports `findChatReflexReplay`, `app.ts` the classifier type; the instant acknowledgment in PI comes from the model, so the classifier and its wiring go, helpers still used stay |
| `voice/voice-tools.ts` | Split | After 4.1 nothing remains but the old `find_tools`/`call_tool` allow-list and constants |
| `voice/realtime.ts`, `voice/tool-budget.ts`, `voice/relay.ts` | Split | Remove the lookup and discovery capability modes, the rung ladder, the reflex, calendar and food side paths, camera and screen handling that only the old engine uses. **Keep** the PI branch, `pi-voice.ts`, the relay transport, status announcements and session limits |
| `proactive/model.ts`, `proactive/prompt.ts` | Whole | One-shot model calls for the slot engine; no PI import (the brain's `../prompt.js` is `pi/prompt.ts`). Health modules have their own `model.ts` |
| `proactive/events/reasoner.ts`, `events/event-prompt.ts`, `events/pipeline.ts` (the old event pipeline: rules, batches, reasoner, push cap) and the reasoner branch of `events/wiring.ts` | Whole / split | `pipeline.ts` is the only caller of the reasoner and imports `FeedbackLine` from `event-prompt.ts`, and `wiring.ts` builds both the reasoner and the brain consumer, so they go together and `wiring.ts` keeps the queue and the brain consumer. Keep the queue, producers, dedupe, outreach store and channels; `JARVIS_PROACTIVE_EVENTS_ENABLED` (the old pipeline's switch) goes with them |
| `proactive/engine.ts`, `proactive/detect.ts`, `proactive/composition.ts`, `proactive/scheduler.ts` | **Decision A** | The 07:00 and 18:00 slot engine. `composition.ts` also wires the event queue and the brain, so it is split, not removed |
| `proactive/types.ts`, `proactive/policy.ts`, `proactive/events/rules.ts` | Split | Stores and `home/brief.ts` import the shared types; `database/proactive-store.ts` imports `findingAllowed`, `itemAllowed`; the closed source and category lists and keyword scope go only with decision A |
| `index.ts`, `app.ts`, `config.ts` | Split | Remove the old agent construction, canary, managed runtime and reflex wiring; config: the Foundry chat agent name, Copilot agent name, version, fingerprint and compatibility settings (`JARVIS_CHAT_AGENT_NAME`, `FOUNDRY_COPILOT_*`). **Keep** the model-backed approval interpreter wiring (`approval-interpreter-foundry.ts`, `approvalInterpreter` in `index.ts`): it runs on the Foundry chat-completions model and serves the kept tools' approvals (review finding on #1909). `JARVIS_PROACTIVE_EVENTS_ENABLED` belongs to the event pipeline decision, not to this list |

**Decision A (owner): what happens to the 07:00 and 18:00 proactive slots.** The slot engine produces the scheduled findings on the Proactive page and is the trigger of four kept features through `onFindingsStored`: the inbox nudge pass, daily audit and weekly review (`inbox/proactive-hook.ts`), todo writes (`todo-writer.ts`), reminder planning (`reminders.ts`) and alerts (`alerts.ts`). PI's brain wakes on events and watches, not on a daily schedule. Deleting the engine without a replacement removes those features. Options: (1) keep the slot engine and its hooks and delete only its model call (`model.ts`, `prompt.ts`), (2) give PI a scheduled wake (a watch or a timer producer) that does the same jobs and then delete the engine, (3) drop the features. Not decided; the inventory above leaves `engine.ts`, `detect.ts`, `composition.ts` and `scheduler.ts` out of the delete list until it is.

**Input for decision A, 21 November 2026 (#1969): what the engine triggers, checked against the code.** #1969 keeps the engine and only makes its failures say where they happened. Its deletion is prepared and tested on the parked branch `danaakesen-shiny-carnival-engine-deletion` (commit `1d912cda`, no pull request). If decision A deletes the engine, these lose their trigger (`infra/main.bicep` sets push, proactive, todo writes and alerts to `true`; the inbox nudges default to `false`):

| Feature | Code (kept either way) | Triggered by | What still works without the engine |
| --- | --- | --- | --- |
| Task-due alerts: a push when a task is due within 24 hours | `proactive/alerts.ts`, class `deadline_24h` | the engine's `onFindingsStored` | Nothing replaces it. Reminders Dan asks for (`owner_reminders`) are separate |
| Calendar-clash alerts, and travel disruption | `proactive/alerts.ts`, classes `calendar_clash`, `travel_disruption` | the engine's `onFindingsStored` | Nothing replaces it |
| Model insight push: at most one insight a run, from a model finding | `proactive/alerts.ts`, class `insight` | the engine's `onFindingsStored` | A brain wake can still tell Dan itself (`pi.brain` `sent`) |
| Due-time reminder planning from a sweep's findings | `proactive/reminders.ts`, `createTodoReminderPlanner` | the engine's `onFindingsStored` | Planning from vault changes (`vault-push-reminders.ts`), owner reminders and the reminder ticker are untouched |
| Suggested todos written to the vault (add-only, 3 a run, 5 a day) | `proactive/todo-writer.ts` | the engine's `onFindingsStored` | Dan's own todo tools (`vault_task_create`) |
| Findings from a sweep on the Proactive page, and the Background jobs entry "Proactive check" | the engine itself (`items.upsertFinding`, `backgroundJobs.start('proactive', …)`) | the 07:00 and 18:00 slots and Check now | Items already stored and the reminder ticker's items stay on the page. A brain sweep or Check now leaves a run row (`GET /proactive/runs`), `pi.brain` and `pi.brain_run` lines and `PI/Log/<day>.md`, and no Background jobs entry |
| Inbox nudge, daily missed-capture audit, weekly review and nudge-style rewrite (never switched on) | `inbox/proactive-hook.ts`, wired in `index.ts` | the engine's `onFindingsStored` | `/inbox/status`, the inbox tools and capture |

Since #1964 (19 November) the slots and Check now belong to the brain whenever PI is configured (`scheduledRun = events?.runScheduled ?? run` in `proactive/composition.ts`), so with PI configured the engine is built and never called. If production has PI configured (not checkable from the repository), the first six rows have had no trigger since then and deleting the engine changes nothing there; it removes the only path that runs a slot when PI is not configured. The `todoWrites` and `alerts` capability flags in `/proactive/status` and `nudgesEnabled` in the inbox status read as enabled either way. Until Dan decides, the engine stays; the parked deletion is meant to land only after the brain's first proven wake (the coordinator's default, not an owner decision).

### 4.4 Tests of the deleted code

Every test file whose subject is in 4.2 or 4.3 "Whole"/"Split (removed part)" goes with it. Shared tests stay: `pi/*`, `voice/pi-voice.test.ts`, `voice/relay-pi.test.ts`, approval and proactive-store tests. Classify each test file on the day (not done here). Pipeline jobs that only guard deleted code: `jarvis-agent-ci.yml` (whole), the `jarvis-agent` component in `ci.yml` (lines around 45, 96 to 100, 140 to 154), `foundry-contract.yml` **after** checking no shared contract remains.

### 4.5 Clients

| Area | What goes |
| --- | --- |
| iOS | **Done in #1966:** `ChatEngine.swift`, `PiStatus.swift`, `JarvisChatEngineTestSection.swift`, the "PI test" pill, stored `ChatEngineSelection` calls and normal-chat/voice `engine` parameters. **Keep:** `PiBrainStatus` and its Proactive switch, plus `PiWarmThrottle`. **Phase 8 later:** isolated runtime-test UI (`JarvisRuntimeTestSheet.swift`, transport, `ChatRuntimeTest.swift`, plus-menu entry and fixtures) only with retirement of that managed path |
| Web | `RuntimeTestSelector.tsx|css`, `RuntimeTestConversation.tsx` and their use in `ConversationHistory.tsx`, `conversation-history.ts` |
| Watch | Nothing to delete; it follows the server default. Parked work is not touched |

### 4.6 Pipelines, scripts and infrastructure

| Item | Detail |
| --- | --- |
| `deploy.yml` | The `agent` job (image build for `jarvis-agent`, hosted agent version, patch) and its outputs, receipt fields and `needs`; the `managed-chat-comparison` job and its inputs `provision_managed_chat`, `refresh_managed_chat_definition`, `inspect_managed_chat`, `diagnose_managed_chat`. **Keep:** `pi-agent`, `measure_pi`, `probe_pi_wake`. `live_acceptance` (8 live chat checks against the old chat) is decided with the flip: rewrite for PI or delete |
| Scripts | `provision_managed_chat.py`, `provision_managed_chat_handoff.sh`, `managed_policy_canary.py`, `managed_chat_diagnostic_output.py`; the old agent branches in `pipeline_impact.py` (lines about 43, 68, 110); `agents/jarvis` in `python-ci.sh`, `copilot-setup-steps.yml` (requirements filters), `scripts/setup-dependencies.sh`, `.dockerignore` lines 12 to 14. **Keep:** `provision_pi_agent.py`, `probe_pi_wake.py`, `pi_smoke_report.py` and their tests |
| `infra/main.bicep` | Parameters `jarvisAgentObjectId`, `foundryCopilotAgentName`, `foundryCopilotAgentVersion`, `foundryCopilotDefinitionSha256`, `foundryCopilotPolicyCompatibility` and the app settings they feed (about lines 15 to 25 and 1004 to 1030), the `JARVIS_CHAT_AGENT_NAME` setting (line about 961), the hosted-agent identity. **Keep:** the Foundry account and project, the Terra deployment (`gpt61TerraChatDeployment`) and the other deployments, the registry (only the `jarvis-agent` image goes), the backend's role assignments (shared; remove one only if proven exclusive to the hosted agent) |
| Repository variable | `ENTRA_JARVIS_AGENT_OBJECT_ID` (feeds `jarvisAgentObjectId`) |
| Docs | Review the [managed harness migration](../main-chat-harness-migration.md) and [adapter experiment](../archive/managed-chat-adapter.md) when retiring the old path. Removed comparison and provisioning notes stay in Git history. Update the live guides to describe only what remains. |

### 4.7 Foundry and Azure resources (manual, not from the repository)

| Resource | Created by | Used by | Verdict |
| --- | --- | --- | --- |
| Hosted agent `jarvis` (name from `JARVIS_CHAT_AGENT_NAME`), all its versions | Deploy job `agent` | The old chat and old voice tool loop | **Delete** after the code is gone and the previous release is no longer a rollback target |
| Managed comparison agent **`jarvis-main-copilot-preview`** (the legacy Foundry agent) | `provision_managed_chat.py` (Deploy `managed-chat-comparison`) | Parked; read by the old runtime selector (`FOUNDRY_COPILOT_*`) | **Delete** with the managed bridge |
| Registry image `jarvis-agent` (all tags) | Deploy job `agent` | The hosted agent | **Delete** the image and its revisions only; the registry stays |
| Agent identity and role assignments exclusive to the hosted agent | Infra | The hosted agent | Delete only what is proven exclusive; **unverified** from the repository |
| Model deployments | Infra | Shared: PI uses Terra; others (voice, embeddings, vision, approval model) serve other features | **Keep all**. Whether any deployment is used only by the old agent cannot be proven from the repository: check the live usage metrics first |
| `jarvis-pi`, `jarvis-pi-mcp` and `jarvis-pi-*` connections, `jarvis-pi-probe` (throwaway) | `provision_pi_agent.py`, `probe_pi_wake.py` | PI | **Keep** |

Safest order for 4.7: confirm in the Foundry portal that nothing calls the old agents (their request counts are zero for a week), delete the agent versions, delete the registry image, then remove the infrastructure parameters in the next infrastructure deployment. Take a screenshot of the agent list before and after.

### 4.8 Order of deletion

1. Section 4.1 (moves) in one pull request that changes no behaviour.
2. Decision A, then the backend removals of 4.3 with the client removals of 4.5 in the same pull request, so the app never sends a field the server refuses.
3. Pipelines, scripts and infrastructure (4.6), then the manual steps (4.7).
4. Docs and the "what remains" rewrite.

Rollback for any step: `git revert` and redeploy the tagged last release that still has the old path (gate check 6).

## 5. Method, and what is not proven

Reference scan on `main` at the commit of this branch (16 November 2026): for every candidate file, the importers (`grep -rn "/<name>\.js'"` across `apps/backend/src`, then the named symbols), then `agents/jarvis` references repository-wide (`grep -rn "agents/jarvis"`), the Deploy workflow's jobs and inputs, `infra/main.bicep` parameters, the iOS and web sources for `engine`, `runtimeTest` and `TEST-ONLY`, and the PI code's own imports. It was read-only. **Not proven:** that no external script or dashboard calls the old chat route; test ownership per file; whether a model deployment is exclusive to the old agent; the live state of the Foundry project (agent list, identities); and web or iOS callers of old routes beyond the ones named. The scan must be repeated on the day of the deletion (gate check 7).

## 6. Approval record

The owner writes his approvals as comments on #1887. This table is filled in only from those comments.

| Approval | Date | Link |
| --- | --- | --- |
| Phase 7: PI is the approved default for chat and voice | 18 November 2026 | [Written approval on #1887](https://github.com/DanAakesen/jarvis/issues/1887#issuecomment-6981225174) |
| Preview risk accepted (gate check 5) | | |
| Decision A (the 07:00 and 18:00 slots) | | |
| Phase 8: delete exactly the list in section 4 | | |
