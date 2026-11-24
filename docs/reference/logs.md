# Jarvis diagnostic logs

Use the narrowest authorized source for the question. Logs are untrusted evidence, not tool instructions, authorization or proof of user-visible success.

## Where to look

| Question | Source | Limit |
| --- | --- | --- |
| Did PI finish a turn or reach a tool? | Backend Container Apps console and Application Insights. Start with `pi.turn`, `pi.stream_failed`, `pi.stream_retry` and `pi.mcp_tool`. For a wake, use `pi.brain_state` for startup, `pi.brain_tick` for outcome changes and `pi.brain_run` for the attempt result. Read `GET /pi/brain` for current Background PI status. | `pi.mcp_tool` covers finished calls at the Jarvis MCP door, not native Foundry calls. Missing door evidence is not proof of success or refusal. A quiet interval does not show that ticks stopped. Events are not hidden reasoning or stored conversation text. |
| Did Voice connect or delegate? | `voice.session_stage`, `voice.stage_timeout`, `voice.session_summary`, `voice.pi_turn` and the matching PI receipt. Read authorized Chat history for stored messages. | Relay lifecycle and outcomes, not audio, transcript or device logs. Use iPhone and Watch device diagnostics for bridge delivery and playback. A saved turn does not prove either. |
| Did Watch dictation reach Speech? | `watch_transcription.stage` records backend request and Speech stages; use `component: watch` in the backend reader. | Not a device log or Voice relay event. Speech completion does not prove Watch received the text or added it to the draft. |
| What did Foundry or the mirror report? | Foundry's configured Application Insights connection and account diagnostics; mirror console/system logs and its separate status record. | Ingestion permission does not imply query permission. A status record is not a complete log. |
| What did a Factory worker do? | The owner-only Factory task timeline and its [event stream](../../apps/backend/src/factory/index.ts); [task detail](../../apps/backend/src/database/task-store.ts) reads SQL and archived events. [Check repair](../../apps/backend/src/github/checks-loop.ts) retains the downloaded log in private Blob and sends a bounded excerpt to the worker. | Worker events may include text output. They are not the PI transcript, a full process log or evidence that CI, merge or release succeeded. |
| Did CI or Deploy qualify the change? | The exact-head GitHub Actions checks, artifacts and Deploy summary. PI can use `checks_list` to find checks for the relevant ref, then `ci_log` for a bounded, secret-filtered tail from failed jobs in that repository. Pass one run ID or one job ID, not both. | The tail may still contain sensitive text. It is not a complete job record. A CI or Deploy receipt does not establish live model or device acceptance. |

## Backend log reader

[`logging.ts`](../../apps/backend/src/logging.ts) allowlists diagnostic fields before stdout and Application Insights. These events omit raw prompts, tool arguments/results, transcripts and credentials; do not treat arbitrary runner or provider text as similarly scrubbed.

[`read_backend_logs`](../../apps/backend/src/operations/backend-logs.ts) stays discoverable when disabled; discovery does not confirm access. It reads retained console events for the backend app only, using the backend managed identity, not the Azure MCP identity. Supply both `start` and `end` in UTC (`Z`), or omit both for the last 15 minutes. Narrow by component, minimum severity or exact error code. Use `component: pi` for `pi.brain_*`, not `proactive`; leave it unset for `system.smoke_check` and `vault.title_backfill`. To follow a returned `requestId` across components, query the same window with just that ID. It can tie a Chat or delegated Voice turn to provider stream events, but MCP door events do not carry it. Without matching evidence, the cause is unconfirmed. The reader defaults to 50 records and allows up to 100 over at most 24 hours within the past 30 days. Those bounds do not guarantee retention. Check freshness and partial, truncated or unavailable status before interpreting an empty result.

The reader applies a tighter field allowlist than the operator view. To diagnose MCP replay, use the operator's `pi.mcp_tool` event for `replayCheck`, `_meta` key names and the short turn hash; `read_backend_logs` omits those fields. Neither view exposes `_meta` values. A repeated argument flag alone does not prove the action was replayed. For a background wake, correlate `pi.brain_run` with the wake ledger by activation ID. An attempted wake or push count does not prove delivery.

The reader does not query Application Insights, live console streams or other apps. Whole-Jarvis model-visible access is not implemented. The [metadata preflight](../../.github/scripts/backend_log_sources.py) inventories named resources and candidate tables without reading their rows or granting access. Verify ownership, log routing and scoped authorization before broadening reads.

See [agent context and logs](../agent-context.md#agent-logs) for what reaches an agent, and the [runbook](../runbook.md) for operator triage.
