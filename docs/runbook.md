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
