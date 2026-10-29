# Main chat harness migration (#1350)

Replace the custom main chat harness with the managed Microsoft Copilot harness
in Foundry. The frontend, backend, native voice relay, identity, tools,
permissions/approvals, SQL memory, blob artifacts and separate subscription-backed
Factory workers remain required. Keep the existing chat runtime temporarily for
comparison and rollback. No production default change or runtime removal belongs
to the initial work. Track the approved stages in
[issue #1350](https://github.com/DanAakesen/jarvis/issues/1350).

## Baseline investigation

Deploy [40928130267](https://github.com/DanAakesen/jarvis/actions/runs/40928130267)
passed the managed text canary at 18:12 UTC on 29 October and all Current chat
checks. Separate research acceptance still failed. The owner subsequently reported
failed real Copilot test replies; no first-failure cause is established from that
warning. The bounded canary bypasses user context, durable claims and tool work.

The follow-up repairs a reproduced optional function-status mismatch and keeps
fixed managed codes visible through the application. A stateful production-wrapper
fixture proves safe follow-up after known setup/terminal failure, retained consumed
sources, and blocked/no-replay behavior after uncertain inference or a synthetic
action. Native allocation now follows shared context preparation. These are local
regressions, not live proof. Existing uncertain claims are not reset by this change.

PR #1353 merged as `9f831509` after exact-head qualification. Its normal
[Deploy 40852006540](https://github.com/DanAakesen/jarvis/actions/runs/40852006540)
passed backend, hosted agent and deterministic readiness. At 09:55 UTC all chat
smoke entries passed, including canary, identity, capabilities, GitHub read, jobs,
navigation, timestamp and plain approval. Research independently reported
`research_runner_failed`, so overall live acceptance still failed. This confirms
the corrected selected-settings chat smoke path; it does not prove ordinary chat,
research, or two-runtime parity.

PR #1351 merged as `938bb48f` after full CI
[40839366476](https://github.com/DanAakesen/jarvis/actions/runs/40839366476).
Deploy [40840605441](https://github.com/DanAakesen/jarvis/actions/runs/40840605441)
then passed backend deployment, hosted agent activation and readiness, but failed
live acceptance at 08:23 UTC on 29 October. All five required chat scenarios
reported `model_bad_request_reasoning`. Research remained down separately.

The smoke builder forces effort `none`; only its Terra branch explicitly sends
that value. This connects the live rejection to that source path, but does not
prove why Azure rejected it or reveal the saved chat effort. Microsoft's
[Terra announcement reproduced on its model catalog page](https://techcommunity.microsoft.com/tag/model%20catalog)
explicitly lists `none`, and the [OpenAI model contract](https://developers.openai.com/api/docs/models/gpt-6.1-terra)
also supports that effort. Azure's [reasoning guide](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning)
lists Terra reasoning and Responses support. None of these sources explains this
project's rejection. Do not remove a documented parameter, substitute another
effort or rewrite the owner's settings from this evidence.

The follow-up retains fixed distinctions for known provider error codes and the
exact `reasoning` versus `reasoning.effort` subfield. Unknown metadata still uses
the earlier classification. The missing fact is whether the live service reports
an unsupported parameter, unsupported value or another invalid request. No raw
provider code, subfield, message or body is copied into logs or reports.

Research uses the separate subscription-backed runner. Its probe previously
discarded every failure. Fixed reasons now distinguish settings reads, runner
HTTP/auth/transport/protocol failures, timeout/abort, known usage limit, failed
execution and missing/invalid results. The fixed prompt, selected role settings,
45-second limit, polling, cleanup and acceptance rules are retained. This is
independent diagnostic evidence, not a claim that research shares the chat fault.

Deploy [40654306679](https://github.com/DanAakesen/jarvis/actions/runs/40654306679)
on `004933741d2319e86f002ca0849921bf735773bf` passed research and all chat smoke
checks at 08:22 UTC on 28 October. Deploy
[40828872899](https://github.com/DanAakesen/jarvis/actions/runs/40828872899)
applied services and hosted agent 159 and passed deterministic readiness, but
live conversation acceptance failed. Capabilities, GitHub read, jobs, navigation
and plain approval reported `error_badrequesterror`. The canary is an aggregate
failure; research runs through a separate Factory tool path.

All files under `agents/jarvis`, including dependency pins, match between that
successful source commit and current main `c05cfada`. The smoke tool allowlist
remains `get_system_health`, `github_read`, `list_jobs` and `workspace_command`;
`read_backend_logs` is excluded. This comparison does not identify a root cause
or prove that live settings, deployment configuration and provider behavior match.

The first diagnostic change maps an OpenAI SDK `BadRequestError`'s known top-level
request field to one fixed `model_bad_request_*` code. Nested schema/property
names and values are discarded. Unknown, missing, oversized or non-string fields
retain `error_badrequesterror`. No provider message, provider code, response body,
request URL, model/deployment value or credential is added to the error stream or
failure log. The same finite code set passes the existing backend status and
release-artifact allowlists. Every rejection still fails acceptance; request
construction, selected model, retries and approvals are unchanged.

This is diagnostic preparation, not a baseline fix. A reviewed release and the
next actual smoke result are needed before choosing a correction. Do not infer
the rejected field from the earlier exception class or change the saved model
without evidence and the applicable authorization.

## Approved manual test UI

Dan approved **Test agent runtime** in the existing chat menu. Choose **Current**
or **Copilot**, then open a separate, clearly labelled conversation. Normal chats
stay unchanged, and a conversation cannot switch runtimes midway. The baseline
diagnostic change does not implement this UI. Dual-send, global
default changes, a new page and replacement voice runtimes are not part of this
approval. The owner later approved retaining the Python bridge temporarily for
voice fallback, existing Jarvis tools only with extra harness tools disabled,
and keeping test conversations out of normal history.

The local candidate implements the selector and a new labelled modal test view,
with scoped SQL session history and normal draft/session preservation. Current
uses the retained bridge. Copilot is unavailable until live definition/settings,
durable execution coordination and shared policy behavior pass. Protocol tests
and synthetic screenshots are not that acceptance. See
[the adapter's exact remaining gates](managed-chat-adapter.md).

The owner confirmed this is his personal side project and is not yet in use.
Do not add extra exclusion from search, recent context or rolling summaries, or
multi-user product architecture. The normal UI feed remains separate as approved;
internal source/context reads retain their existing global behavior. No context
wipe or deletion is authorized.

## Manual comparison checklist

Use the test conversations once both paths are available. Start a fresh separate
conversation for each runtime and scenario. Paste identical inputs and follow-ups,
and attach the same synthetic image where needed. Keep the model and settings
equal where supported; record any difference rather than treating a model
comparison as proof of harness parity. Use synthetic or deliberately public test
material. Do not create, send, log, delete or approve real actions for this check.

1. **Identity and role:** “Who are you, what is your role here, and which actions
   need my approval?” Compare Jarvis identity and the actual approval contract.
2. **Multi-turn constraints:** “Plan a 30-minute review of a fictional project.
   Use three steps, use no paid services, and do not change anything.” Then:
   “Make it 15 minutes and retain the other constraints.” Check retained context,
   arithmetic and instruction following.
3. **Read-only issue status:** “Read public issue #1350 in DanAakesen/jarvis.
   Summarize its approved stages and open questions. Do not change the issue or
   start a worker.” Check the answer against the issue and verify no mutation.
4. **Meal estimate:** Attach the same synthetic food photo, then ask: “Estimate
   protein, calories and fat for this photo. State uncertainty. Do not log it or
   create a pending food proposal.” Compare units, uncertainty, image handling and
   absence of writes; agreement alone does not prove nutritional accuracy.
5. **Long read-only analysis:** Give both conversations the same synthetic long
   issue text. Ask: “Summarize the requirements, contradictions and open questions.
   Do not change anything.” Leave the screen during processing, return, and check
   completion, retained output and honest recovery feedback. Do not assume both
   paths already implement this successfully.

For each run, note the runtime, model/configuration differences, input and result.
Compare correctness, instruction following, completion and elapsed time. Separate
observed answers from provider/tool receipts. Report partial or failed runs and
unknown costs. Automated comparisons will also cover approvals, interruptions,
long tasks, voice parity, completion accuracy and cost using test data. No pass
threshold has been approved yet.

Check native EN/DA Voice Live separately: real audio, barge-in, transcripts, tool
integration and the Danish fallback. This protects the retained voice path; it is
not a comparison between two replacement voice harnesses. No voice-parity claim
is established by text-only tests or a playback receipt alone.

## Open decisions and provider limits

The model/region, exact new agent grants/connections and parity/cost acceptance
criteria remain unresolved. Present concrete persistent access changes for owner
approval at action time. Do not reuse backend-log access approval as harness
authorization or copy subscription credentials into the managed agent.

Microsoft's [setup guide](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/use-tools-skills-copilot-harness)
and [limits](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/limits-quotas-regions)
describe a public preview without an SLA, requiring a new prompt agent. Verify
model availability, including Terra, in the selected project and region. The
documented preview does not support direct audio/WebSocket input, Foundry Memory,
strict function schemas or BYOM. Preserve native audio, backend validation and
durable application storage. Conversations and workspaces do not replace
cross-conversation personal memory, durable artifacts or Factory heartbeats.
Built-in harness tools are enabled by default; their configuration and approval
boundaries need review before creating the agent. No model, grant or capability
selection is implied by this document.

## Local validation of the diagnostic candidate

The follow-up passes 1,019 hosted tests, hosted Ruff/byte compilation, 349 focused
backend tests, the full backend suite (6,902 passed, one skipped), backend
lint/build and 13 sanitizer tests. The research fixtures
exercise terminal cleanup, timeout cancellation, unchanged dry-run inputs and
reason filtering through retained/HTTP reports. Normal exact-head
qualification remains required for this follow-up; previous-head CI does not
qualify it. Current main `82fff9f5` and its separate log diagnostics are preserved.

The unchanged hosted baseline passes 930 tests. The candidate passes 944 hosted
tests, hosted Ruff and byte compilation, 280 backend system-status/chat-agent/
canary/status tests, backend lint/build, contracts build and 12 smoke-sanitizer
tests. The backend tests exercise the actual SSE parser, canary and retained/HTTP
status report for every allowlisted reason. The new hosted tests use real SDK
exception objects and verify failure-only responses and content-free logs.

Python is the pinned 3.12.14; local Node 24.19.0/npm 11.9.0 differ from CI's
Node 22/npm 10. Dependency installation encountered public-mirror 403s, then used
the same public package versions and integrity hashes. The committed lockfile is
restored byte-for-byte. An optional ambient Ruff check of the smoke formatter
finds the same four pre-existing import/exception-style findings on both baseline
and candidate; its existing test and byte-compilation checks pass. No check was
weakened and no exception behavior was changed to satisfy those style findings.
Normal exact-head qualification, independent review and live diagnosis remain
pending. No UI/browser, audio/provider or production verification was performed.
