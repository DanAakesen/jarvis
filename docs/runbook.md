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

Confirmed offline correction: both cache rejection paths previously replaced
the original error, and stale fallback hid refresh failure. Typed boundary
diagnostics now survive those paths and the stdout/telemetry allowlist.
The actual recurring production failing stage remains unconfirmed until the
authorized post-deploy readback; no runtime-cause correction is claimed yet.

## Factory board source latency (#813)

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
