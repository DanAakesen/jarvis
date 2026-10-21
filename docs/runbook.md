# Operations runbook

Draft for Dan's review (P6-06). Production operations are for Dan or an
authorized operator; cloud coding agents have no Azure access. Never put secret
values in commands, logs, notes, or this file. Use resource names and endpoints
from the `jarvis-infra` deployment outputs instead of guessing them.

## Deploy

1. Merge the authorized change to `main`. The **Deploy** workflow runs for
   production changes; documentation-only changes do not deploy. A manual
   `workflow_dispatch` of **Deploy** from `main` redeploys all components.
2. **Runner deploy** is a separate workflow. It runs from `main` and requires
   `JARVIS_INFRA_DEPLOYMENT_NAME` to identify the successful infrastructure
   deployment (currently `jarvis-infra`).
3. Both workflows queue in `jarvis-production-deploy`; do not start a competing
   deployment elsewhere. Follow the Actions run and its summary. The backend
   deploy waits for the new Container Apps revision to become ready; the old
   revision continues serving if that check fails. The smoke checks require
   backend `/health` and, for infrastructure changes, the Foundry hosts.
4. Confirm the relevant Deploy or Runner deploy jobs and smoke checks succeeded.
   A successful build alone is not production acceptance.

## Voice startup diagnosis

After deployment, the owner should make one voice attempt, end it, and find its
`voice.session_summary` by `reqId`. `voice.session_stage` records each stage with
milliseconds since `request.started`: session creation, credential, settings,
away mode, project context, upstream connecting/open, update sent and readiness.
`session_update_sent` means the socket send completed, not that Azure accepted
the configuration. English waits for `session.updated`; Danish accepts
`session.created` or `session.updated`.

On the Danish route `voice.stage_timeout` warns after 15 seconds connecting or
awaiting readiness; English uses the tool-budget attempts below instead. On
either route a readiness failure closes the browser with **4010**, “Voice service
did not become ready”; the client shows a plain retry message and keeps its existing backoff.
Settings plus model-catalogue, away-mode and project-context reads each have a
five-second fallback deadline. Session creation has a ten-second deadline and
ends with `voice.connection_failed` rather than falling back.

The exactly-once summary records language, first closer (`browser`, `upstream`,
`relay` or `shutdown`), close code, duration, reached stages/timings, allowlisted
upstream event types, and the latest startup `session.update` tool count/UTF-8 bytes plus
the five largest tool definitions (server-owned names and UTF-8 bytes).
It survives browser-first closure and cancellation. No transcripts, instructions,
tool arguments, payloads or close-reason text belong in these new diagnostics.

English tool-budget fallback. Each English attempt uses a fresh socket and logs
`voice.tool_budget_attempt` with `rung` (R0-R4), `toolCount`, `toolBytes`,
`instructionsBytes`, `frameBytes`, `outcome` (`ready`, `timeout`, `error` or
`closed`) and `elapsedMs` since connect (deadline 8 s for R0, 6 s for R1-R4).
`voice.tool_budget_selected` names the rung that reached `session.updated`;
`remembered: true` means the session started at the rung remembered from an
earlier session in this backend process and it worked without stepping down. The
summary carries `toolBudgetRung` and `toolBudgetAttempts`. Read them like this:

- Ready at **R0**: the full frame works; the stall of 21 October is not present.
- Ready only at **R1**: the `daily_*` tools or `proactive_recent_items` are the cause.
- Ready only at **R2**: the total tool size matters, not one tool; compare `toolBytes`.
- Ready only at **R3**: the size of the tool list, not one tool, is the cause (R2's
  half-size list still failed).
- Ready only at **R4**: the instruction text is the cause. Voice works without tools
  and says so; use chat for actions.
- `voice.tool_budget_exhausted` (close 4010, `toolBudgetRung: null`): every rung
  failed, so the cause is not in the request content (service, region or
  credentials); check Azure Monitor and Voice Live status.

The remembered rung is not re-probed upwards; restart the backend to try R0 again.
No instructions, tool names, payloads or arguments appear in these logs.

In the Voice Live resource's Azure Monitor metrics, compare `TotalCalls` split
by operation for the same UTC window: `onHandshake` confirms accepted sockets;
`VoiceLive_SessionDone` and `VoiceLive_ResponseDone` help distinguish accepted
connections from completed sessions/responses. Handshakes without SessionDone
are not proof that `session.update` was accepted. Use summary stages to locate
the stall; do not infer a schema limit or service degradation from counts alone.
Microsoft's [session-update contract](https://learn.microsoft.com/en-us/python/api/azure-ai-voicelive/azure.ai.voicelive.models.clienteventsessionupdate?view=azure-python)
expects `session.updated`. No applicable numeric tool/schema/instruction or
combined-context limit was verified for the deployed API version in this change.
The harmless `connection.upgrade_failed` duplicate-registration noise is tracked
separately and is not a voice-stage failure.

## Enable Health Gmail attention and calendar reads

These feeds are off by default and this procedure does not claim they are
enabled. Enabling them requires a separate reviewed deployment change; do not
set the flag as an ad hoc portal override.

1. Confirm the backend Health module is already enabled. In a reviewed change,
   add `JARVIS_DAILY_FEEDS_ENABLED: 'true'` to the backend container environment
   in `infra/main.bicep` and extend
   `apps/backend/src/daily/default-off.test.ts` so the switch is allowed only in
   that deployment file and is set exactly once to `true`. Do not change the
   web build switch to enable these backend feeds. Deploy through the normal
   Deploy workflow above; the flag remains off if absent or `false`.
2. Before the deployment, complete the existing Google OAuth consent procedure
   in [Google Calendar and Gmail setup](../infra/README.md#google-calendar-and-gmail-setup).
   The consent must include the calendar-list read permission used to enumerate
   the owner's calendars. If that permission has not been consented, update the
   configured consent screen as documented there and rerun the setup procedure
   to replace the protected refresh token. This runbook records the step; it
   does not perform consent or access a token.
3. After deployment, use the authorized Health read-only acceptance procedure
   to confirm the feeds are composed, source coverage is reported truthfully,
   and missing permission or partial data is not presented as an empty success.
   The read endpoints and capability discovery are backend behavior; this
   change does not add the attention list or agenda to the web page.
4. To disable the feeds, remove the flag or set it to `false` in a reviewed
   deployment change, deploy normally, and confirm the feed routes are absent
   and the feed sources are no longer advertised. Do not remove existing
   retained rows as part of disabling the flag.

### Chat capability smoke diagnosis

Read the retained result with the ordinary authenticated `GET /status`; this
does not rerun checks. `GET /status/smoke` actively runs provider and chat
checks, so use it only as part of an authorized normal deployment smoke, not
for diagnosis or repeated probing. The `chat_capabilities` reason is one of
`capabilities_discovery_missing` (no matching discovery receipt),
`capabilities_discovery_wrong` (wrong tool or operation),
`capabilities_discovery_failed` (matching call did not succeed),
`capabilities_receipt_incomplete` (successful receipt omitted a required
Notes, Calendar or GitHub capability), or `capabilities_reply_incomplete`
(the reply omitted required wording). These reasons classify which existing
predicate failed; they do not relax the assertion that real successful
`get_system_health/list_capabilities` discovery, all three capabilities and
their mention in the reply are required. The reason alone does not establish
the original production cause; until a normal recovery deployment and released
acceptance confirm the result, treat that cause as unidentified.

For mixed backend/web versions, both HTTP routes retain the legacy rule that
only down checks include a reason. Internal snapshots also retain allowlisted
degraded reasons. An authorised normal smoke run exports `system.smoke_check`
with only `checkId`, `status` and an allowlisted check-specific failure `reason`
to stdout and Application Insights; an ordinary retained Status read does not
repeat it. Use those events for safe warning details instead of broadening the
wire contract or retrieving raw provider text. The event is diagnostic evidence,
not an accepted-green release certificate.

A bare `agent_error` now means an unexpected exception that is neither a labelled
backend-side invocation failure nor a hosted error event (or no agent is
configured). Backend-side failures report `agent_auth_unavailable`,
`agent_request_failed`, `agent_http_<status>` (`agent_http_other` for an unlisted
status), `agent_response_invalid`, `agent_stream_failed` or `agent_stream_ended`;
a hosted error event without a safe code is `agent_error_code_missing` and one
with an unlisted code is `agent_error_code_unlisted`. A conversation check that
threw one of these runs once more before its result is final, so a passing
artifact may hide a rescued first failure; `system.smoke_check` records only the
final result. Assertion failures and timeouts are not retried.

The local consolidated #831/#832 recovery trace on main `81580919` found no
matching exact-format numeric model-round records in the authorised existing
workspace for 14 October 17:32–17:34 UTC. The failed smoke-only retry therefore
does not establish which capability predicate failed. The smoke role omits
normal-chat capability instructions; do not treat that source observation or
timings as a proved live cause. Review/publication and a normal release's safe
reason readback remain coordinator-owned. No blind smoke retry, new credentials
or access grant is required or authorised by this diagnostic change.

P9-107 deterministic fixtures demonstrate a separate reply false-negative:
successful discovery with all three canonical receipt categories followed by
“I can help with Notes, calendars and GitHub tools” failed only the reply
predicate. The reply now accepts whole-word `calendar` or `calendars`, as Notes
already accepts singular/plural wording. Receipt requirements are unchanged;
synonyms, partial words, missing categories and missing/failed/wrong discovery
still fail. This controlled equivalence does not identify the historical
deployed cause or establish live recovery. Production acceptance remains open
under #820; the coordinator owns normal deployment smoke and released acceptance.

## Factory board 502 diagnosis and acceptance

For #811, a successful Deploy or `/health` response is not board acceptance.
The existing deployment principal is authorized only for `GET /status/smoke`,
not `/factory/board`. Do not broaden its permissions, bypass authentication,
extract an App key/token, or ask for new user credentials to run a board probe.
The authenticated UI and an authorized operator own the post-deploy readback.

1. Record the exact PR head's CI result, merge, Deploy run, serving revision and
   UTC request time. Perform one authorized `GET /factory/board?project=2`
   with a 60-second client deadline and a 1-MiB response cap; do not poll/retry
   indefinitely. Require HTTP 200, `stale: false`, project ID `2`, repository
   `DanAakesen/jarvis` and the **complete** shared `isFactoryBoard` contract,
   including six ordered columns and `.sssZ` timestamps. Validate privately;
   do not publish the board body, request headers or credentials.
2. On failure, the operator reads `factory.board_read_failed` (or
   `factory.board_project_lookup_failed`) at that time. Only `stage`, `reason`,
   bounded HTTP `status` and boolean `stale` are exported. Stages distinguish
   project lookup, token issuance, GitHub source, SQL task overlays, release
   reads and response construction/validation/size. Stale-cache refresh failures
   retain their diagnostics even though the client receives a stale 200.
3. `token` with `invalid_token_lifetime` or `invalid_token_permissions` means
   local validation rejected the mint response; existing lifetime/permission
   validation is unchanged. `request_failed` with 401/403 at `token` versus
   `source` distinguishes issuance from downstream rejection. Status 429 or
   5xx identifies an upstream refusal, not a reader deadline. Source
   `result_limit`, `response_too_large`, `incomplete_response` and
   `invalid_response` identify the relevant bounded/validation failures.
   `timeout`/`cancelled` do not justify increasing budgets. `unexpected` means
   the cause is not classified; never copy raw exception messages to logs.
4. Fix only the stage supported by that readback and a regression. The reported
   CLI success uses a different GitHub identity and does not establish that
   App issuance or App-scoped reads work. The short production failure timings
   alone do not prove token expiry, permissions, rate limits or SQL failure.
5. After a fresh complete board passes, read Project 2 again and verify the
   signed-in web renders #790 **Done**, #792 **Ready**, #793 **Done** against
   that readback. Coordinate with #810's UI owner; preserve the original Note
   and checkout. Fixture tests and deployment smoke cannot close this gate.

### P14-43 source response size (20 October 2026)

Each GitHub response is now capped at 4 MiB, checked against both declared
`content-length` and consumed stream bytes. The public board response remains
capped at 1 MiB: issue bodies are source data, not board-card output.
Pagination remains 100 items × 10 pages per list, with eight concurrent requests
and a 25-second source deadline. Three primary lists therefore allow at most
30 requests / 120 MiB source JSON, before parsing/copy overhead; dependency
lists keep the same bounds. Oversized, incomplete, repeated and foreign-repository
pages still fail closed. See the P14-43 decision for closed-window headroom.

The issue's production evidence identifies `stage: source`,
`reason: response_too_large` for this recurrence. After deployment, the authorized
operator must observe a fresh complete HTTP 200 board as above and no new
`response_too_large` warnings in the recorded observation window. Keep #1127
open until that is observed; local tests and deployment success are insufficient.

`factory.board_task_event_failed` is a separate path: the event subscriber reads
`taskStore.get(taskId, 0, 0)` to resolve the project and publishes an invalidation;
it does not read GitHub. `kind: internal` is the safe fallback for an unclassified
exception (including a missing task), not evidence of a response-size failure.
Its production cause remains unverified and needs separate task-store evidence.

Confirmed offline correction for the earlier incident: both cache rejection paths previously replaced
the original error, and stale fallback hid refresh failure. Typed boundary
diagnostics now survive those paths and the stdout/telemetry allowlist.
Those earlier diagnostics alone did not establish the historical runtime cause.

## Factory board source latency (#813)

The local 16 October cache-ownership correction is not released or performance
acceptance. Ordinary publication invalidates only its project and preserves its
pending owner. A dirty owner can execute at most one immediate complete
follow-up; invalidation during that follow-up returns an explicitly stale,
expired snapshot, not a fresh cache entry or an endless loop. Both reads use
the existing per-read source bounds and whole-board validation. A follow-up
failure retains its original typed diagnostic and last validated fallback.
Task project-lookup failure is reported without globally invalidating caches.
Client cancellation does not own shared source cancellation. No live timings
or historical #811 cause are established by these local source changes.
An outer branch failure preserves its first typed cause but retains ownership
until all started source/task/release branches settle. Error responses or stale
fallback can therefore wait for existing cleanup; branch limits are unchanged.
LRU eviction also expires any outstanding reference before removing the cache
entry, so a waiter cannot settle fresh after losing invalidation reachability.
This conservative stale result is not a fabricated source failure and does not
dirty the owner or trigger an extra automatic source read.

The 2026-10-13 baseline is 90 observed `/factory/board` requests on revision
`--0000307` between 22:14 and 23:08 UTC. All returned HTTP 200; median latency
was 10.065 s, p95 12.915 s, and maximum 19.211 s. The cohort includes cache
hits; it is not a cold-only benchmark and does not identify a slow stage.

After the authorized deployment, compare normal production request telemetry
for the serving revision with this baseline. Record the time window, request
count, status distribution, median, p95, maximum, and stale status where
available. Separate cache hits only when existing telemetry can identify them;
do not infer cold/warm status from latency or issue extra load to manufacture a
comparison. Keep payloads, credentials, and private records out of the report.
Use the authorized readback above to confirm a fresh, complete shared board and
canonical placement. Report any missing telemetry or cache classification as a
limitation. This comparison measures latency only and does not establish the
cause of #811's historical 502s.

The 14 October 2026 acceptance of backend `75a3cbe` / Deploy `38507005838`
failed its latency comparison: the observed actual board read times were
9.661 s and 10.365 s, with no accepted improvement against the mixed-cache
10.065 s baseline median. One rail entry produced 14 browser fetch starts, two
HTTP 200 completions, and twelve aggregate `AbortError`s; this does not prove
all 14 attempts reached the backend. No manual Refresh, Retry, or cache-bust was
used. The bounded backend window
03:49:30–03:51:10 UTC on healthy revision 312 returned 546 rows below its
600-row limit: two board HTTP 200 completions, 49 webhook HTTP 202 responses,
40 Now HTTP 200 responses, and 62 database-status HTTP 200 responses. Thirteen
GET starts were route-unclassified with no completion in the window, so they do
not establish receipt of the remaining client starts. No selected request or
Factory failure event appeared, which does not prove client aborts did not
occur. There were no per-phase events or matching invalidation versions/abort
times. The separate app-scoped dependency query returned no matching rows.
Browser/backend clock domains were not assumed synchronized. API contract,
rendered placement, and the 100-card Done cap reconciled separately from
performance. Browser fetch-to-header times were 9.748 s / 10.322 s and cloned
body times were 9.850 s / 10.487 s.

After the diagnostic follow-up is reviewed and deployed, correlate board
`request.started`, `factory.board_read_timing`, and `factory.board_phase` by
`reqId`. The summary `outcome` and `statusCode` describe the handler/source
computation decision and reply status, not proof of HTTP completion or client
receipt. Use `request.completed` separately as the server-side `onResponse`
status/time observation; even it does not establish client receipt. Compare an
observed summary `cachePath` and `stale` fields before separating cache hits,
shared waits, source loads, or stale fallbacks. `cacheElapsedMs` is the awaited
cache operation time (including the full load for `source_load`); it is not an
additional phase duration. A phase event is emitted when its instrumented work
boundary executes, but a missing event cannot establish that work was skipped:
telemetry can be missing, sampled, cropped, or outside the observation window.
Per-stage values are monotonic wall
durations; source, task, and release work runs concurrently, so their durations
overlap and must not be added. A response phase `part` marks assembly versus
serialization. `durationCensored` and `cacheElapsedCensored` mean the actual
duration exceeded the 60-second reporting bound and was omitted, not clipped.
`durationUnavailable` and `cacheElapsedUnavailable` mean a valid clock duration
could not be produced; no numeric value is exported.
Correlate webhook invalidations by their
request ID and bounded origin/project/version fields. Historical task-event
prelookup invalidations were marked `all_projects`; the local correction emits
one project-scoped invalidation only after successful task lookup.
These diagnostics were not present in the failed production window and do not
retrospectively attribute it.

The released consumer/source trace suggests a possible lifecycle of validated
board update, 150 ms debounce, reload-key change, and effect-cleanup abort.
Backend invalidations also advance cache generation while earlier loads may be
in flight. Actual SSE versions, per-attempt abort times, and invalidation
reasons were not captured, so neither path is established as the historical
trigger. Do not claim the diagnostic follow-up proves a performance correction
or explains #811's separate historical 502s.

## Roll back a deployment

### Backend Container Apps revision

If a new revision fails its readiness check, the previous revision keeps serving;
inspect the failed Deploy run before taking further action. For an unhealthy
revision that already became active:

1. From `jarvis-infra` outputs, identify `backendAppName`.
2. In the Azure portal, open that Container App's **Revisions and replicas**.
   Activate the last known-good revision so it serves in the app's single-revision
   mode. Do not delete the failed revision before recording its name and the
   failing Deploy run.
3. Verify the backend health check and the affected user workflow.
4. Restore source-of-truth afterward: revert the offending change through an
   authorized PR to `main` and let **Deploy** build and verify the corrected
   revision. A portal-only rollback is temporary and can be replaced by the next
   deployment.

### Foundry `jarvis` agent version

The Deploy workflow creates a new hosted-agent version and routes 100% of
`jarvis` traffic to it. Existing sessions are not restarted by a version change.
For an emergency rollback, use the previous known-good version ID from the
Foundry project’s version list or its successful Deploy run. Set `$version` to
that ID and `$FOUNDRY_ADMIN` to the `foundryAdminEndpoint` output from
`jarvis-infra`, then use the same selector and PATCH commands as Deploy:

```bash
patch=$(jq -cn --arg version "$version" '{
  agent_endpoint: {
    version_selector: {version_selection_rules: [{agent_version: $version, traffic_percentage: 100, type: "FixedRatio"}]},
    protocol_configuration: {invocations: {}}
  }
}')
az rest --method patch --url "$FOUNDRY_ADMIN/agents/jarvis?api-version=v1" --resource https://ai.azure.com/ --headers Content-Type=application/merge-patch+json --body "$patch" --output none --only-show-errors
```

Verify Jarvis with a new chat turn. Keep both versions; do not delete the version
being rolled back from. As with a Container Apps rollback, follow up with an
authorized source change and Deploy so the deployed state is reproducible.

## Rotate the GitHub App private key

The backend reads `github-app-private-key` from Key Vault when it issues a GitHub
App token; the key is never sent to a sandbox.

1. In GitHub App settings, generate a replacement private key while the current
   key is still valid. Keep its PEM in a temporary, access-controlled location
   outside the repository and synced folders.
2. Set the Key Vault secret using the existing file-based command:

   ```powershell
   az keyvault secret set --subscription <subscription-id> --vault-name <key-vault-name> --name github-app-private-key --file <private-key.pem> --encoding utf-8 --output none
   ```

3. Verify metadata only; never display the secret value:

   ```powershell
   az keyvault secret show --subscription <subscription-id> --vault-name <key-vault-name> --name github-app-private-key --query "{id:id,enabled:attributes.enabled}" --output json
   ```

4. Verify a GitHub App-backed operation succeeds. Then revoke the old key in
   GitHub App settings and remove the temporary PEM copy.

## Rotate the GitHub App webhook secret

The backend caches `github-app-webhook-secret` after its first successful Key
Vault read, so a backend restart is required after replacing it.

1. Generate a new random secret and stage it temporarily outside the repository
   and synced folders.
2. Store it in Key Vault with the existing file-based command:

   ```powershell
   az keyvault secret set --subscription <subscription-id> --vault-name <key-vault-name> --name github-app-webhook-secret --file <webhook-secret.txt> --encoding utf-8 --output none
   ```

3. Update the webhook secret in **GitHub → Settings → Developer settings →
   GitHub Apps → Jarvis Software Factory → Webhook** to the same value.
   Preserve the configured URL and subscribed events.
4. Restart the backend Container App identified by the `backendAppName` output
   from `jarvis-infra` in the Azure portal. Then check **Recent Deliveries** for
   successful 2xx responses; redeliver any failed event after the restart.
5. Remove the temporary copy. Do not confuse the webhook secret with the App
   private key; they are separate Key Vault secrets.

## Re-seed the Codex login

Do this only when renewal has failed and Settings shows **Action needed**. The
login is the Jarvis-only ChatGPT Pro login, not Dan's personal Codex login.

1. Confirm no Codex task is running and no renewal is in progress. In a local,
   private Jarvis-only folder, set `CODEX_HOME` to
   `.secrets\codex-jarvis` and run `codex login`. Authenticate with the Jarvis-only
   account. Never copy Dan's own Codex login.
2. Store the resulting `auth.json` as the Key Vault secret `codex-login`, using a
   protected local file and no inline secret value:

   ```powershell
   az keyvault secret set --subscription <subscription-id> --vault-name <key-vault-name> --name codex-login --file <auth.json> --encoding utf-8 --output none
   ```

3. Delete the local `auth.json` after the write. Do not start another Codex task
   until the scheduled renewal succeeds and Settings reports a healthy status;
   the task store refuses Codex starts while the credential status is failed.
   No manual production renewal command is documented for the current backend.

## Recover a crashed task

1. Wait for heartbeat recovery to move the crashed task to **Needs attention**.
   Open its task detail page and review the latest event and task branch.
2. Select **Recover**. Recovery starts a fresh Foundry session using the existing
   task branch, original request, bounded steering history, and a summary of
   recent events. It does not restore uncommitted sandbox files.
3. Follow the task timeline. Confirm the branch and pull request on GitHub before
   treating the task as Done; the backend requires that evidence. If recovery
   fails or the state changes, inspect the new event before trying again; do not
   create a duplicate task or set task state manually.

## Use the sleep switch

Use the sleep switch on Jarvis's main page to put the backend to sleep or wake it.
Sleep is refused while tasks are **Ready**, **Running**, or **PauseRequested**.
Let them finish or cancel them through their supported controls, then try again.
To wake Jarvis, set the switch to awake. Azure SQL may also need to resume; wait
for the app's **Waking Jarvis…** indicator rather than repeating a write.
Do not scale the backend directly in Azure while using this control.

## Temporary SQL firewall access for an operator

SQL uses Entra-only authentication. `jarvis-sql-admins` is the server's Entra
administrator group; an operator must already be authorized through that group.
The Bicep-managed `AllowAzureServices` firewall rule (`0.0.0.0` to `0.0.0.0`)
allows Azure services; it is not an operator IP rule.

The repository has no operator firewall command. In the Azure portal, open the
SQL server identified by the `sqlServerName` output from `jarvis-infra`, add a
temporary firewall rule for only the operator workstation's current public IPv4
address (same start and end address), and connect using Entra authentication.
Remove the temporary rule as soon as the work is complete and confirm it is no
longer listed. Never allow a broad range or use a SQL password. Do not alter the
Bicep-managed `AllowAzureServices` rule for operator access.

## Restore the database to a temporary copy (drill)

Verified end to end on 13 October 2026 (P6-04, #65). The production database `jarvis` on server
`sql-jarvis-rmw7kae3bza6a` (resource group `rg-jarvis`) is serverless General Purpose Gen5 (0.5 to 1 vCore,
auto-pause after 60 minutes, about 254 MB used) with locally redundant backup storage. Azure keeps
point-in-time restore data; the earliest restore point on 13 October was 6 October 02:38 UTC (about seven days).

1. Pick a restore time in UTC inside the window, formatted `yyyy-MM-ddTHH:mm:ssZ`. Build it with the invariant
   culture; on a Danish-locale Windows machine `ToString('yyyy-MM-ddTHH:mm:ssZ')` renders the colons as dots and the
   request fails (the Azure CLI then fails with a deserialization error and creates nothing).
2. Restore into a new database on the same server with the ARM API. `az sql db restore` hung without submitting a
   request from the operator machine, so the REST call below is the verified path:
   `az rest --method put --uri https://management.azure.com/subscriptions/<sub>/resourceGroups/rg-jarvis/providers/Microsoft.Sql/servers/sql-jarvis-rmw7kae3bza6a/databases/jarvis-restore-drill?api-version=2023-08-01-preview --body @restore.json`
   with `restore.json` = `{"location":"swedencentral","sku":{"name":"GP_S_Gen5","tier":"GeneralPurpose","family":"Gen5","capacity":1},"properties":{"createMode":"PointInTimeRestore","sourceDatabaseId":"<resource id of jarvis>","restorePointInTime":"<time>","minCapacity":0.5,"autoPauseDelay":60,"requestedBackupStorageRedundancy":"Local"}}`.
   The response is `CreateRestoreRequest`.
3. Poll `az sql db show -g rg-jarvis -s sql-jarvis-rmw7kae3bza6a -n jarvis-restore-drill --query status` until
   `Online`. Observed: 104 seconds for this database.
4. Verify with the temporary firewall rule below (rule name `coordinator-temp`, delete it afterwards): connect to both
   databases with an Entra token and compare per-table row counts. Result on 13 October with a restore point 30
   minutes old: 67 of 67 tables present, 64 identical, and only the three busiest tables (`dbo.webhook_deliveries`,
   `dbo.workflow_runs`, `dbo.pull_requests`) differed, by the rows written after the restore point.
5. Delete the copy immediately: `az sql db delete -g rg-jarvis -s sql-jarvis-rmw7kae3bza6a -n jarvis-restore-drill --yes`,
   then delete the firewall rule and confirm only `jarvis` and `master` remain. A serverless copy that exists for
   a few minutes costs pennies; leaving it running does not.

To recover production data (not drilled): restore to a temporary copy as above, copy the needed rows back with a
reviewed script, then delete the copy. Do not rename databases or replace `jarvis` without a recorded decision.

Limits of this drill: it proves the point-in-time backup is restorable and complete for row counts. It does not
prove the application starts against the copy, restores of older points than 30 minutes, long-term retention (none
is configured), or geo-restore (backup storage is local, so a regional loss is not covered).
## Not verified by this runbook

These procedures document the repository's current configuration; they do not
claim a live production operation was performed. Dan must review this runbook.
Azure revision/Foundry rollback, webhook delivery after rotation, Codex reseeding,
live task recovery, sleep/wake, and temporary operator firewall access require
authorized production verification.

## References

- [Deploy workflow](../.github/workflows/deploy.yml) and
  [Runner deploy workflow](../.github/workflows/runner-deploy.yml)
- [GitHub App setup and secret commands](agent-context.md#github-app-setup)
- [Backend and sandbox credential behavior](architecture.md)
- [Task recovery and sleep control contracts](agent-context.md#setup-and-commands)
