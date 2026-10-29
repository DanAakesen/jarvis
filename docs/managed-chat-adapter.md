# Managed main chat protocol adapter (#1350)

`agents/jarvis/managed_copilot.py` implements the existing text streaming contract
for a new prompt agent with harness type `microsoft_copilot_preview`. It is an
optional protocol implementation; runtime selection and durable backend binding
are separate integration work. Keeping Current available for comparison/rollback
is the migration goal; no runtime selection is changed here.
The adapter does not create agents or change production configuration.

Inject an agent-scoped `AsyncOpenAI`, existing `BackendToolClient`, explicit
`ManagedTarget`, settings provider, asynchronous definition verifier, verified turn context provider and durable
`NativeConversationBindings`. `agent_client_options(project_endpoint, agent_name)`
provides the endpoint, API version and preview header matching the public
`azure-ai-projects` 2.9.0 helpers. Supply the existing asynchronous credential token
callable using `https://ai.azure.com/.default`. SDK retries must be disabled; the
adapter rejects clients with retries enabled. The application owns client cleanup.
No additional production package is needed.

The owner approved retaining the Python bridge temporarily to preserve voice
fallback, using existing Jarvis tools only with extra built-ins disabled, and
keeping test conversations out of normal chat history. This remains a local
protocol checkpoint; these decisions do not provision or activate a target.

Before inference, requested model and reasoning effort must match the explicit
target. These values are not silently rewritten or sent as target overrides;
the configured prompt agent owns them. Configuration metadata is not evidence of
provider access. Read back the actual agent definition/version, model and effort,
harness, tools, instructions and built-in policy before enabling a target. Live
availability and selected-role parity remain unverified here.

Every request uses the persisted native conversation, including each
`function_call_output` continuation. Only the current verified user message is
submitted; older application messages are not replayed over native history.
Prepared identity/mode/language/source instructions come from the caller on every
round. The context provider must capture the authenticated application session and
stored source message. The adapter checks this source against the actual latest
user message and passes it to `BackendToolClient.call`; provider arguments never
supply that authority. Backend authorization, approval checks, SQL memory,
subscription workers and durable artifacts remain application-owned. Harness
built-ins require separately verified policy; this adapter does not make them
safe merely by declaring backend function tools.

The binding provider must implement the protocol in the adapter with real durable
storage. Its exclusive lease must cover the session and target for the whole
turn across concurrent workers. It must validate session ownership/target
association, atomically claim the source message before inference, persist the
native conversation ID before the first response, and reject previously claimed
sources even after interruption. `finish_turn(source, success)` records completion;
a failed or uncertain turn requires explicit recovery. Do not automatically clear
claims or retry actions. A new conversation created but not successfully bound
must be reconciled by the provider/application; inference has not started in that
case. The adapter does not delete durable conversations when a client closes.
No backend binding endpoint is invented here.

Text deltas stream as strings. Pre-tool text produces the established
`AcknowledgmentBoundary`, then tools execute sequentially through the backend.
Completed provider responses alone may dispatch tools. Failed, incomplete,
unterminated or empty final responses raise fixed diagnostic codes, even after
partial text. A closed/cancelled generator closes its inner stream and records
failure. A turn deadline, cleanup deadline and tool-round bound limit work.
Duplicate call IDs and duplicate name/canonical-argument pairs stop the turn
without executing the repeated action. Exceptions do not include raw provider
errors, prompts or tool arguments. No blind network or action retry occurs.

Requests include only conversation, input, prepared instructions and streaming.
Functions are registered on the agent, together with a disabled built-in toolset.
No per-request tool override is sent: its harness override semantics have not
been established. The required asynchronous `definition_verifier(target, settings,
catalogue)` runs before conversation creation/inference and must validate a real
provider readback against the current backend catalogue. Synthetic metadata
passes offline fixtures only. Schemas remain `strict:false`; `strict:true` and reserved `___`
names fail visibly. Unsupported harness controls such as `store:false`,
`previous_response_id` and `max_output_tokens` are omitted. The adapter currently
rejects images and reflex-note inputs explicitly. Native Voice Live EN/DA backend
relay and hosted Danish fallback are unchanged; `complete()` rejects direct
voice routing. Foundry Memory, audio input and WebSocket response creation are
not introduced.

Offline validation:

```sh
/tmp/jarvis-1350-venv/bin/python -m pytest agents/jarvis/tests/test_managed_copilot.py -q
/tmp/jarvis-1350-venv/bin/ruff check agents/jarvis/managed_copilot.py agents/jarvis/tests/test_managed_copilot.py
```

The fixtures are synthetic. They establish local request/continuation/error and
cleanup behavior, not live Foundry availability, durable backend wiring or full
identity/approval/acknowledgment parity.

References checked 29 October 2026:
[function calling](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/tools/function-calling),
[Copilot quotas and limitations](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/limits-quotas-regions),
and the public 2.9.0 wheel `_patch.py` / `models/_patch.py` helpers.
The [harness setup guide](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/use-tools-skills-copilot-harness)
returned a retrieval timeout during this local task; no live provider call was made.


## Definition and immutable-version readback

`managed_copilot_definition.py` constructs wire JSON using documented public SDK
2.9.0 models: `PromptAgentDefinition(kind="prompt", model=..., reasoning={"effort":
"high"}, harness={"type":"microsoft_copilot_preview"}, instructions=..., tools=...)`.
The tools include only the current backend functions with `strict:false` plus
`MicrosoftCopilotToolsetPreview(type="microsoft_copilot_toolset_preview",
default_config={"enabled":false})`. The SDK explicitly states that omitted
default configuration enables built-ins. This disables filesystem read/write,
shell, web and subagents by default, including future built-ins unless an override
re-enables them. No skills or extra tools are added.

After separate provisioning approval, the SDK operations are
`project.agents.create_version(agent_name=..., definition=...)` and
`project.agents.get_version(agent_name=..., agent_version=...)`. The pure
`validate_managed_agent_version` helper checks name, exact version, active status,
non-draft, harness, model, reasoning, instructions, exact function schemas, no
skills, and disabled default/no enabled overrides. It rejects unsupported settings.
The caller must separately verify the agent endpoint's version selector resolves
to that checked immutable version; a successful readback alone does not pin an
endpoint configured for latest. Registry/catalogue drift must fail activation or
be reconciled with an explicitly reviewed new version. Per-turn language/mode
instructions must continue to be composed by shared application policy rather
than rewriting the verified baseline definition implicitly.

The approved ChatTerraHigh profile means actual model `gpt-6.1-terra` and effort
`high`, not a deployment literally named ChatTerraHigh. The synthetic role fixture
records that pair. `infra/main.bicep` declares deployment `gpt-6.1-terra`, model
version `2026-10-26`, GlobalStandard; account and project location inherit
`resourceGroup().location`. These declarations do not prove current live deployment
state or actual region. A supported Copilot region, project/deployment availability,
quota and Terra reasoning/tool support must be checked with real target readbacks.
No model substitution is authorized.

## Shared policy integration: activation blocked

The protocol is independently testable but must remain unavailable in production
until the retained bridge's policy behavior is integrated and tested. Reusing
`BackendToolClient.call` preserves server authorization; it does not reproduce all
application-loop policy. The existing reusable boundaries are:

| Existing code | Required integration behavior |
| --- | --- |
| `model_client.py:complete_chat`, `CHAT_INSTRUCTIONS`, `PRE_TOOL_ACKNOWLEDGMENT`, `CHAT_FORMAT_INSTRUCTIONS` | EN/DA choice, acknowledgment enable/continuation state, reflex receipt context and chat format. The adapter currently receives prepared instructions and explicitly rejects reflex inputs. |
| `model_client.py:personalize_instructions` and `_complete` setup | Shared identity/personality, mode/source boundaries, live composition refresh, backend `context()` reference JSON, channel, food receipt and capability-discovery instructions. These are caller-owned and absent from the protocol's own prompt construction. |
| `calendar_flow.py` helpers used by `_complete` | Pending-proposal origin checks, matching complete multi-event batches, later confirmation, safe streamed prefixes, evidence-backed receipts and terminal rendering. The adapter does not replace these guards. |
| `_complete.append_steering`, `current_steering_fetcher`, `current_chat_phase_setter`, `current_chat_turn_id`, `current_message_id` | Apply verified interruption messages/language, change authoritative source before later tools, and propagate phases. Adapter currently snapshots one source for the entire turn. |
| `_tool_call_key`, `_tool_call_fingerprint`, `_uncertain_action_result`, backend execution metadata | Classify read/action effects, retain uncertain receipts, and avoid duplicate mutation execution across retries/continuations. Adapter conservatively rejects all repeated fingerprints; it lacks the current read/action recovery semantics. |
| `_complete` mode-tool refresh | Recompose instructions after successful `set_presence_mode`/`set_away_mode`; adapter currently keeps one prepared instruction snapshot. |
| `_complete` completed-response usage handling, `BackendToolClient.record_model_usage`, telemetry context variables | Attribute sanitized usage to actual model and role, acknowledgment bounds, turn timing and terminal states. The adapter currently does not report usage or reproduce all acknowledgment gates. |
| `StreamingModelClient` in `model_contract.py` | Existing `session_settings()` awaits settings provider; `complete_chat(messages, language, settings=..., reflex_note=...)` streams existing chunk types. Direct `complete()` is rejected to preserve native voice routing. `close()` leaves injected resources application-owned. |

Settings callbacks must be asynchronous (`BackendToolClient.model_settings` is a
compatible callable). The context callback is synchronous and captures an already
verified current-turn snapshot, ideally from existing context variables. The
runtime must provide an exclusive durable lease/claim/recovery implementation;
the backend session CAS binding alone does not serialize turn execution or stop
multiple native conversation creates. Dedicated protocol tests do not establish
calendar, steering, approval, source, usage or voice parity.

## Provisioning checkpoint

The existing deployment metadata identifies project `jarvis-20261003200000` in
account `jarvis-20261003200000-rmw7kae3bza6a`, resource group `rg-jarvis`.
Bootstrap metadata records Sweden Central; Bicep gives the Foundry account and
project that resource-group location. Deploy 40852006540 confirms these target
names and hosted version 163. Source declares the existing Terra deployment
`gpt-6.1-terra`, model version `2026-10-26`, GlobalStandard. Passing chat smoke
establishes current inference, not compatibility of a newly created Copilot agent.

The proposed first action is one new prompt agent, recommended name
`jarvis-main-copilot-preview`, in this existing project with Terra/high, existing
Jarvis function schemas and the disabled built-in toolset. The name and persistent
creation still require owner authorization. Pin only this new endpoint to its
returned version, read back the persisted definition and test one real text turn.
Do not change the existing `jarvis` endpoint or choose another model/region.

The existing GitHub Actions deployment identity already creates agent versions
using OIDC and its existing Foundry project access. No new credentials are needed.
The candidate still needs the provisioning command/production assembly; the
current normal deployment job creates only the existing hosted agent.

The current official [setup guide](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/use-tools-skills-copilot-harness)
requires Foundry User at project scope for the creating/invoking caller. It
requires the new agent instance identity's separate Foundry User assignment only
for Toolbox or generated Foundry Files. Those capabilities are outside this
initial function-only bridge, so no new instance-identity role grant is proposed.
Function execution keeps the existing Python/backend identity and approvals.
Read the caller's effective access before requesting any missing permission; if
needed, request only Foundry User (`53ca6127-db72-4b80-b1b0-d745d6d5456d`) for the
exact retained caller at this project. Never infer that project and agent instance
identities are interchangeable, and do not add account/subscription-wide roles.
