# Managed main chat protocol adapter (#1350)

`agents/jarvis/managed_copilot.py` implements the existing text streaming contract
for a new prompt agent with harness type `microsoft_copilot_preview`. It is an
optional protocol implementation; runtime selection and durable backend binding
are separate integration work. Keeping Current available for comparison/rollback
is the migration goal; no runtime selection is changed here.
The adapter does not create agents or change production configuration.

Inject an agent-scoped `AsyncOpenAI`, existing `BackendToolClient`, explicit
`ManagedTarget`, settings provider, verified turn context provider and durable
`NativeConversationBindings`. `agent_client_options(project_endpoint, agent_name)`
provides the endpoint, API version and preview header matching the public
`azure-ai-projects` 2.9.0 helpers. Supply the existing asynchronous credential token
callable using `https://ai.azure.com/.default`. SDK retries must be disabled; the
adapter rejects clients with retries enabled. The application owns client cleanup.
No additional production package is needed.

Owner decisions remain pending on temporarily retaining the Python bridge,
disabling extra harness built-ins, and using separate test history. This module
is an independent local protocol checkpoint, not approval or final wiring for
those choices.

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

Requests include only conversation, input, prepared instructions, function tools
and streaming. Schemas remain `strict:false`; `strict:true` and reserved `___`
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
