# Shared Jarvis policy with managed native Responses (#1350)

`ManagedPolicyClient` in `agents/jarvis/managed_policy_client.py` is a local,
explicitly injected transport variant of `AzureOpenAIResponsesClient`. It delegates
to the same `complete_chat` / `_complete` application loop rather than duplicating
its guards. No production selection, environment factory, agent, role, credential,
deployment or cutover is added here. Current remains the default.

The transport integration uses a default `_create_response(request)`
method forwarding the original request unchanged, one call site using that seam,
and `chat_model_tools` extracting the existing normal-chat `get_system_health`
operation-property filter. Current request construction and function-loop behavior
are otherwise unchanged. Managed registered schemas must use this shared filter,
not the broader unfiltered backend catalogue.

The shared loop continues to own identity/personality and mode composition,
EN/DA instructions, backend context as reference JSON, food approval/receipt and
capability instructions, acknowledgment size/continuation handling, calendar
origin/batch checks, safe streamed calendar prefixes and receipt rendering,
backend tool execution/authorization, effect-aware repeated-action and uncertain
receipt handling, steering/phases, mode refresh, and role/model usage accounting.
The managed service owns its reasoning/harness and conversation history. Its
client-side function-output bridge remains necessary: existing Jarvis application
policy decides which requested functions actually run and what receipts mean.
This is a staged replacement of the provider harness, not a second permanent
main agent or removal of application authorization policy.

## Construction and verified boundaries

Inject the existing agent-scoped AsyncOpenAI with retries disabled, existing
BackendToolClient, durable bindings, an asynchronous definition verifier and a
synchronous verified runtime context provider. `ManagedPolicyTarget` extends the
offline target with required `agent_version` and lowercase 64-character SHA256
`fingerprint`; root constructs the fingerprint from the verified endpoint,
agent/version and definition. The requested model/effort must exactly match the
target. No model or reasoning substitution occurs. `session_settings` uses the
existing backend reader and rechecks the target. A local tuple/hash is not evidence
of provider access or a verified endpoint selector.

`ManagedPolicyTurnContext(session_id, source_message_id, current_input_start)`
comes from authenticated application state. `current_input_start` is the index in
supplied `ModelMessage` inputs immediately after prior history, before this turn's
visual/attachment/caption reference messages are appended. The retained runtime
must capture `len(messages)` there. The final user message must carry the same
verified source ID. Do not derive this boundary from prompt text, a model flag or
an untrusted request parameter.

The first native request includes fresh trusted backend reference context and
`messages[current_input_start:]`, plus any verified steering already appended by
the shared loop. Prior SQL/history messages are skipped because native history
already owns prior turns. Later requests send only newly appended local user
steering/control notes and `function_call_output` receipts. Provider-owned
message/reasoning/function-call output is already in the native conversation and
is filtered out, rather than replayed. A cursor tracks original input positions;
it does not use text matching to guess whether an item was already sent.

Requests contain only conversation, input and streaming. A new turn or policy
change prepends one typed `developer` message containing the complete current
shared policy to the unchanged current input delta. Registered tools are verified once before native
creation/inference and the shared loop's actual advertised schemas must still
match at request time. No per-request tool override is sent. Unsupported store,
previous-response, token-limit and reasoning override fields are not forwarded.
The harness output-budget difference remains explicit; local Current output limits
are not a managed provider cap. Force-final synthesis cannot disable registered
functions using unsupported `tool_choice`. When the shared request omits tools,
the native stream enforces a final-text-only boundary: any function item, including
a new action with different arguments, fails before dispatch. Text-only synthesis
can complete. No extra provider suppression parameter is sent.

### Trusted policy input (6 November 2026)

Activation [42219195236](https://github.com/DanAakesen/jarvis/actions/runs/42219195236)
successfully provisioned and pinned the comparison at 13:17:00 UTC. Its canary
then failed at `response_start` with HTTP 400, `invalid_payload`, parameter
`instructions`, exception `BadRequestError` at 13:17:58. This identifies the
rejected top-level request field; no raw error or policy content was retained.

The shared request builder now uses the typed message form in Microsoft's
[Foundry input contract](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/aiproject#openaiinputmessage):
`type: message`, `role: developer`, and one `input_text` content part containing
the exact full instructions string. That role has precedence over user input.
The policy still comes exclusively from the shared application composition path.
Reference text, attachments, steering and tool outputs are not promoted into it.
There is no top-level `instructions` override, truncation, policy omission or
change to registered tools, definition verification, claims or source boundaries.

The builder adds current policy after cursor selection on the first response of
each application turn and whenever its exact composed text changes, including
mode changes. A per-turn in-memory record is updated only after response creation
returns; identical policy is omitted on tool continuations. New turns always
start with fresh policy, including on an existing native conversation. No cursor
positions or caller input lists change. Foundry prepends native history to new
inputs and persists completed response input items, so a new developer policy
follows earlier items and precedes current reference/user/tool inputs. One full
policy per turn/change therefore remains in native history; this patch neither
deletes history nor introduces an undocumented compaction or database schema.
Existing conversation and uncertain-turn recovery rules still apply. The harness preview's live
acceptance of this input form remains subject to the full-policy canary; the
general Responses schema alone is not proof of successful managed inference.

### Policy-shaped activation canary (6 November 2026)

`managed_response_request` builds the same conversation/input/stream
request for `_create_response` and the fixed administrative canary. Shared
`runtime_instructions` extracts the existing format/channel/food/capability clauses
without changing their content; both paths then use `personalize_instructions`
with selected identity, mode, preferences and backend capability settings. A local
HTTP fixture compares the unchanged complete policy prefix to an actual policy turn.
The canary appends a fixed qualification clause containing a policy-only sentinel,
then sends a conflicting user instruction. It requires that exact sentinel and
repeats the check with an updated policy and sentinel on the same conversation.
Both turns use the production input cursor and request builder; provider history
stays intact. Ignored or stale policy, a plain acknowledgment, tool output and
oversized replies cannot produce compatibility evidence.
The probe sends synthetic reference/user messages, executes no tools and bypasses
owner context and claims. It therefore validates provider compatibility without
claiming full owner-session acceptance. It cannot consume or release an owner source.

Success after both turns adds `requestShape: managed_policy` and the target-bound
compatibility receipt, required by activation. Failure adds
one bounded stage plus the existing safe provider-cause contract below. Handoff
logs independently validate these fields; no provider message, request, schema or
instruction content is printed. The 210-second invocation bound, no retries and
cleanup of only the freshly created synthetic conversation remain unchanged.

### Safe policy failure diagnostics (#1373)

`managed_policy_turn_failed` remains the closed reason for an unknown inference
outcome; `managed_policy_setup_failed` still describes failure before inference
and tools. Both can carry `providerCause`: integer `httpStatus` (100–599),
provider `code`, known request-field `param`, and `exceptionType` from closed
vocabularies in `managed_provider_cause.py`. A regex-safe string is not sufficient:
unknown identifiers are omitted. Up to four known code/target pairs from Azure's
documented `error`, `details` and `innererror` structure can accompany administrative
diagnostics as `details`. Traversal is limited to 16 nodes and three nested levels.
Exception messages, raw response bodies, headers and request values never enter
this object. Existing public keys remain compatible; downstream chat decoders can
continue to omit the additional administrative detail pairs.

The hosted error event, backend `conversation.reply_failed` log, backend chat
error event, browser `ChatTurnError` and retained system smoke entries preserve
these fields through independent allow-lists. Smoke HTTP responses retain them
only alongside an eligible failed check's closed reason; degraded entries keep
the existing HTTP reason-omission behavior. The browser error retains structured
metadata, not provider message text. No retry, claim release or default-runtime
change follows from a 4xx; that recovery policy remains an owner decision.

The older #1373 failure did not identify its rejected parameter. The 6 November
activation above established rejection of `instructions` for the actual
full-policy canary. After the developer-message correction, run 42227506332 instead
returned HTTP 400 `invalid_request` with no parameter. The remaining constraint is
isolated by two fixed comparisons. [42239012647](https://github.com/DanAakesen/jarvis/actions/runs/42239012647)
accepted plain strings and simple user messages but rejected typed developer input.
[42245489142](https://github.com/DanAakesen/jarvis/actions/runs/42245489142) also
accepted typed user input while rejecting string developer and both system forms.
Both trusted roles are therefore rejected in response inputs on this target.
The next [request comparison](managed-chat-provisioning.md#6-november-diagnostic-request-comparison)
checks the documented conversation-items channel, with exact policy-only sentinels,
conflicting user input and a second policy update on each owned conversation.
The stored-policy diagnostic [42252117950](https://github.com/DanAakesen/jarvis/actions/runs/42252117950)
also failed both roles with `managed_probe_policy_not_applied` at `response_stream`
at 16:26:57 UTC. A successful storage/inference call did not satisfy the required
policy sentinel. The safe result does not identify whether the first or replacement
turn failed; both must pass before this channel can be used. No accepted trusted,
dynamic policy form is established, and the production request builder remains
unchanged. Any future stored-policy implementation must preserve uncertain-write
ownership, advance its turn-local cache only after acknowledged writes, retain
native history and keep trusted policy out of visible runtime conversation history. Synthetic 400 fixtures continue to test safe propagation and
no replay. Additional fixtures reject top-level overrides, verify full-policy
preservation in developer input, and prove that rejection of the developer input
or message list fails the canary even when a plain-string probe would pass.
Provider acceptance and a real Copilot test-chat turn still need live verification.

The verifier must fetch the actual immutable prompt-agent version, validate the
normal-chat schemas, disabled built-ins, identity definition/model/effort and
endpoint selector, and reject drift. New dynamic catalogue/schema changes require
an explicitly reviewed definition update. The application owns all injected
resource lifetimes; `close()` does not dispose shared transports. Existing caller
turn cancellation/deadlines and backend tool deadlines remain in force. Stream
close and ledger completion use the existing settings' backend HTTP timeout;
there are no additional tunable limits or retry policies.

## Compatibility evidence before owner turns

Pinned metadata/settings alone is insufficient. The backend now requires the
explicit [complete-policy activation receipt](managed-chat-provisioning.md#complete-policy-compatibility-gate)
for availability, new and existing owner-session sends, and durable turn claims.
The receipt binds project, native agent/version, definition fingerprint, selected
chat model/effort and policy transport revision. `managed_text_canary` can produce
it only after complete-policy inference succeeds. The current failed target has
no qualifying receipt. Internal administrative metadata/probes remain independent
of this gate and cannot claim owner sources. Future transport changes must bump
the revision and qualify again; cached evidence from a previous transport is not
accepted. This repair does not claim that the provider incompatibility is fixed.

## Native ledger and interruption

An exclusive durable session/target lease claims the initial verified source
before any shared calendar preflight or provider call. Native conversation creation
and bind finish before inference. Bind errors and uncertain provider outcomes do
not trigger blind retries or replacement conversation creation. Every subsequent
steering source must be attached through `binding.attach_source(source_id)` under
the same active claim before another model request or a tool under that source.
Missing/refused attachment fails closed. Root owns this capability and its server
authorization; the adapter cannot manufacture permission from the initial claim.

The shared steering fetcher is the only component that changes the authoritative
source; it runs at model-round boundaries. Calendar pre-model work uses the claimed
initial source. The wrapper sets/resets `current_message_id` around the whole
shared generator, including its cleanup. A successful turn completes the original
claim once; attached sources belong to that same claim. A known provider-terminal
failure can be recorded failed only if no backend tool call occurred in this turn.
Cancellation, generator close, incomplete streams, unverified terminal shape,
unknown provider error and any failure after a backend tool leave the claim active
for explicit reconciliation. No lease implementation may clear those claims merely
because the Python context exited. Source replay must remain rejected.

## Explicit activation gates

Images fail before claim/inference with `managed_policy_image_unverified`. This
avoids silently losing an image or replaying a potentially accepted native request
through the existing caption retry. Text captions and attachment reference text
are preserved by the explicit input boundary. Reflex receipt context goes through
the existing shared `complete_chat` path unchanged. Direct voice completion is
rejected; native EN/DA Voice Live relay and hosted Danish fallback are unchanged.

The owner declined extra filtering from normal search, recent context or rolling
summaries. Existing application memory behavior remains; no reset is performed.
This adapter refuses direct `summarize_conversation` and smoke mode; the retained
application's existing summarizer remains separate. Native history import or
reconstruction is not introduced. Production assembly, image handling, target
access, registered-tool support and live acceptance still need verification.
The older `ManagedCopilotClient` is an offline
protocol checkpoint, not the activation path: its simpler loop does not share
these policies and its boolean-failure cleanup does not represent the active-claim
uncertainty contract.

## Local evidence

The dedicated tests run actual shared application code through installed
AsyncOpenAI and synthetic MockTransport HTTP. They check native input boundaries,
no history/provider-output replay, fresh backend reference and identity/context
instructions, reflex receipt text, usage attribution, source-bound tool dispatch,
durable steering attachment, unchanged calendar receipt rendering, mode refresh,
effect-aware action deduplication, explicit image/settings gates and ledger
uncertainty. They do not prove deployed definitions, real access, durable SQL
integration, provider reasoning, image fallback or live voice behavior.

```sh
/tmp/jarvis-1350-venv/bin/python -m pytest agents/jarvis/tests/test_managed_policy_client.py agents/jarvis/tests/test_model_client.py -q
/tmp/jarvis-1350-venv/bin/ruff check agents/jarvis/managed_policy_client.py agents/jarvis/tests/test_managed_policy_client.py agents/jarvis/model_client.py
```
