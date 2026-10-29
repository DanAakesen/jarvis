# Shared Jarvis policy with managed native Responses (#1350)

`ManagedPolicyClient` in `agents/jarvis/managed_policy_client.py` is a local,
explicitly injected transport variant of `AzureOpenAIResponsesClient`. It delegates
to the same `complete_chat` / `_complete` application loop rather than duplicating
its guards. No production selection, environment factory, agent, role, credential,
deployment or cutover is added here. Current remains the default.

The only shared model-client changes are a default `_create_response(request)`
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

Requests contain only conversation, current input delta, current shared policy
instructions and streaming. Registered tools are verified once before native
creation/inference and the shared loop's actual advertised schemas must still
match at request time. No per-request tool override is sent. Unsupported store,
previous-response, token-limit and reasoning override fields are not forwarded.
The harness output-budget difference remains explicit; local Current output limits
are not a managed provider cap. Force-final synthesis cannot disable registered
functions using unsupported `tool_choice`; if the provider still requests calls,
the shared no-more-calls guard fails closed without repeating the action.

The verifier must fetch the actual immutable prompt-agent version, validate the
normal-chat schemas, disabled built-ins, identity definition/model/effort and
endpoint selector, and reject drift. New dynamic catalogue/schema changes require
an explicitly reviewed definition update. The application owns all injected
resource lifetimes; `close()` does not dispose shared transports. Existing caller
turn cancellation/deadlines and backend tool deadlines remain in force. Stream
close and ledger completion use the existing settings' backend HTTP timeout;
there are no additional tunable limits or retry policies.

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
