# PI cutover checklist and deletion inventory

PI serves normal Chat and Voice without an engine selector. The broader harness and resource deletion (Phase 8, [#1887](https://github.com/DanAakesen/jarvis/issues/1887), P15-176) is **not approved**.

Use the [architecture map](../architecture.md) for current routing. Recheck this inventory against the code when the cutover is approved; old file names and proposed deletions below are not instructions to execute today.

## 1. What the owner tests in normal use

| Area | How | What good looks like | Reference |
| --- | --- | --- | --- |
| Chat | Use normal Chat for a day; there is no engine choice | Quality at least as good as before; first text about 1.1 to 1.3 s warm, about 3.3 s cold; honest errors and write receipts; delete confirmation and tool parity with Voice | Timing is the November trial baseline, not a new measurement. [Current Chat and Voice contract](../architecture.md#chat-and-voice) |
| Voice | Start normal Voice (first answer takes a few seconds), ask something that needs a tool, say a backchannel ("mm-hm") while it works, then ask a follow-up | A short sentence from PI before a tool call, then a short spoken answer; speech alone never stops PI, and only a new delegated request (the newest one wins) or ending the session does; later turns about as fast as warm chat; chat and voice remember each other | PR #1908; `voice.pi_turn` and `voice.turn_timing` logs |
| Brain | Use **Proactive suggestions** on the main iPhone Settings page. Open Proactive for the last review and next check. | Useful reach-outs without duplicates; honour the owner settings and background limits | [Proactive flow](../architecture.md#proactive-wake-and-inbox-review) |
| Watches | "Keep me updated on X"; list; stop | Looks and reports as asked, shows the estimated cost per watch and does not send duplicate messages | [Proactive flow](../architecture.md#proactive-wake-and-inbox-review) |
| Reach | Verify the intended GitHub and Azure bridge configuration | Reads and actions work on real questions, or PI says plainly it does not have access | [Tool discovery](../architecture.md#tools-retries-and-failure-copy) and [configuration names](../agent-context.md#configuration-names-only) |
| Cost | Use available status evidence; no live measurement without approval | A plain turn about 0.05 DKK, a tool turn about 0.17 DKK, month inside the cap | Historical per-turn reference, not a new measurement. [Cost and safety](../agent-context.md#cost-and-safety) |

**Known limits:** Watch and web follow the same PI route. Camera and screen sharing in web voice return `not_supported`. The old harness still exists for isolated runtime tests and is not a normal fallback. The combined PI situational loop now owns the proactive slots through the persisted event/slot ledger; ordinary source policy and budget rules still apply.

## 2. PI-only normal route and release receipt (#1966)

[#1910](https://github.com/DanAakesen/jarvis/pull/1910) made PI the normal default. #1966 removes the compatibility selector from normal clients and makes infrastructure preserve the working PI tuple.

| Change | Detail |
| --- | --- |
| Chat | Every normal turn uses PI. Older clients may send `engine: "pi"`; `current` and unknown values are rejected. Isolated runtime-test sessions retain their own runtime |
| Voice | `/voice` and compatibility `/voice?engine=pi` use PI. Any other engine query closes 1008 |
| iPhone | `ChatEngine`, the saved choice, Settings selector, PI test pill and normal-client engine parameters are removed. `PiBrainStatus` still supplies background status |
| Watch and web | Neither sends an engine. They use the same PI route; PI web voice does not support camera or screen sharing |
| Infrastructure | Bicep receives a validated secure PI configuration captured from the old backend, rather than losing values during the infrastructure revision |
| Readiness | `pi-agent` runs before smoke, waits for its exact backend revision and supplies the accepted release receipt |
| What stays | Isolated runtime-test support, the old harness/resources pending phase 8, Background PI in Proactive and all proactive ledgers |

Rollback is a reviewed revert and redeploy of the prior release. There is no runtime switch back to Current.

## 3. Deletion gate

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
| Inbox review and alerts | Share `FindingsStoredContext` from `proactive/types.ts` | Scheduled PI wake |

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
| `proactive/model.ts`, `proactive/prompt.ts` | Whole | Slot model and prompt removed; no PI import (the brain's `../prompt.js` is `pi/prompt.ts`). Health modules have their own `model.ts` |
| `proactive/events/reasoner.ts`, `events/event-prompt.ts`, `events/pipeline.ts` (the old event pipeline: rules, batches, reasoner, push cap) and the reasoner branch of `events/wiring.ts` | Whole / split | `pipeline.ts` is the only caller of the reasoner and imports `FeedbackLine` from `event-prompt.ts`, and `wiring.ts` builds both the reasoner and the brain consumer, so they go together and `wiring.ts` keeps the queue and the brain consumer. Keep the queue, producers, dedupe, outreach store and channels; `JARVIS_PROACTIVE_EVENTS_ENABLED` (the old pipeline's switch) goes with them |
| `proactive/engine.ts`, `proactive/detect.ts`, `proactive/composition.ts`, `proactive/scheduler.ts` | **Decision A** | The old slot engine is deleted. `composition.ts` also wires the event queue and the brain, so it is split, not removed |
| `proactive/types.ts`, `proactive/policy.ts`, `proactive/events/rules.ts` | Split | Stores and `home/brief.ts` import the shared types; `database/proactive-store.ts` imports `findingAllowed`, `itemAllowed`; the closed source and category lists and keyword scope go only with decision A |
| `index.ts`, `app.ts`, `config.ts` | Split | Remove the old agent construction, canary, managed runtime and reflex wiring; config: the Foundry chat agent name, Copilot agent name, version, fingerprint and compatibility settings (`JARVIS_CHAT_AGENT_NAME`, `FOUNDRY_COPILOT_*`). **Keep** the model-backed approval interpreter wiring (`approval-interpreter-foundry.ts`, `approvalInterpreter` in `index.ts`): it runs on the Foundry chat-completions model and serves the kept tools' approvals (review finding on #1909). `JARVIS_PROACTIVE_EVENTS_ENABLED` belongs to the event pipeline decision, not to this list |

**[Decision A, 22 November 2026](../decisions.md#22-november-2026--one-continuous-conversation-and-direct-settings-access).** Dan approved deleting the old slot engine and enabling Inbox capture and automatic nudges. Background PI owns 07:00, 18:00 and Check now. An eligible claimed slot reviews the Inbox once and hands nudges to alert delivery. If an earlier PI event covered the slot, Inbox still reviews it without repeating the PI turn. Exact owner reminders and planning from vault changes keep their own triggers. Legacy model-generated todos and generic slot findings have no producer.

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
| Docs | Review the managed harness migration and adapter experiment when retiring the old path. Removed comparison and provisioning notes stay in Git history. Update the live guides to describe only what remains. |

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
| Phase 8: delete exactly the list in section 4 | | |
