# Operations runbook

For the owner or an authorised operator. Look up the intended resources in the infrastructure deployment's outputs. Do not copy secret values, live content or environment identifiers into the repository or a PR.

## Deploy

1. Follow [exact-tree PR qualification](agent-context.md#merge-and-release-procedure). [Deploy](../.github/workflows/deploy.yml) runs on `main` for production inputs, including `docs/features.md`, but not for ordinary docs. Do not trigger it to validate a docs PR.
2. Inspect the plan, component jobs, deterministic readiness and release result. A missing qualification receipt blocks Azure access; a skipped component may reuse compatible evidence. A green image build is not a ready revision.
3. [Runner deploy](../.github/workflows/runner-deploy.yml) is separate and uses the configured successful infrastructure deployment. It shares production deployment concurrency; do not start a competing out-of-band release.
4. Use [PLAN.md](../PLAN.md) for delivery state and the [TestFlight procedure](agent-context.md#testflight-build) for a signed build. Readiness, signed upload, Apple processing and device acceptance are separate. Live provider or notification probes require explicit approval.

## Triage

Use [diagnostic sources](reference/logs.md) and a narrow UTC window. Investigate the specific symptomatic surface, not a fresh model call.

| Symptom | Check first |
| --- | --- |
| Deploy reports `exact_qualification_missing` | Compare the merged tree with the CI receipt's PR/head and tested tree. Use a qualified PR to reconcile source; do not rerun an unqualified commit or bypass evidence. |
| Tool result is missing or uncertain | Compare `pi.stream_failed` with `pi.mcp_tool` and the stored receipt. The harness can refuse a name before the door sees it. Read back the intended result before retrying a possible write. |
| Voice never starts or does not end | Follow `voice.session_stage` to `jarvis.session.ready`; a WebSocket open is not service readiness. `voice.session_summary` names the closer and safe outcome. An interrupted close or missing upstream acknowledgement is a failure, not Ended. For a spoken request, correlate lifecycle/length events with the stored owner turn, not raw audio. |
| Brain appears idle | Inspect the retained status and `pi.brain_tick`/`pi.brain_run`: distinguish off, paused, no eligible sources, no due work and a failed wake. Do not enable the brain to diagnose it. |
| Status smoke is degraded | Read authenticated `GET /status` for retained results and `system.smoke_check` for the final allowlisted reason. `GET /status/smoke` runs checks; do not invoke it for routine diagnosis. Check discovery, tool receipt and reply assertions separately. |

## Owner session switch

The checked-in `JARVIS_OWNER_SESSION_ENABLED` pin is **true** in [Bicep](../infra/main.bicep). Keep ingress header logging off; Voice carries the session token through `Sec-WebSocket-Protocol`.

- **Incident:** Use authenticated `DELETE /auth/sessions` and check its success and revoked count. If no usable owner token is available, disable the switch through a reviewed change and Deploy.
- **Disable/re-enable:** Change the deployment pin through a reviewed PR and Deploy, not a portal override. Off mode returns 404 on the session routes and a new process attempts one revoke of retained sessions. Check `owner_session.boot_revoke` before turning it back on; a failed attempt needs an authorised retry by restarting the off revision. Off/on overlap can revoke newly minted sessions.
- **Verify:** After enabling, the owner signs in with Entra and checks mint/revoke in the intended client. A web client that cached a 404 may wait before minting again.

## Roll back a deployment

### Backend Container Apps revision

Failed readiness should leave the previous revision serving. If an unhealthy revision is already serving, use the backend app from the infrastructure outputs and activate the last known-good revision in **Revisions and replicas**. Verify health and the affected path within the authorised scope. Retain the failed revision and run evidence until triage, then reconcile through an authorised revert PR. Portal-only rollback is temporary.

### Foundry version

Determine which agent serves the affected path before changing a pin. Normal Chat and Voice use `jarvis-pi` and `jarvis-pi-live`, not the isolated hosted `jarvis` agent. Use the [agent ownership rules](architecture.md#the-two-foundry-agents) and the [readback procedure](agent-context.md#verify-the-live-agents-read-only). A version rollback is an owner operation: pin the known-good version, verify what is serving and preserve `KEEP THIS BLOCK`. Do not change Active concurrently with Deploy, delete the affected version or infer that existing sessions restarted. If the problem is code-owned, reconcile the source through a PR.

## Rotate credentials

- **GitHub App key:** Generate a replacement while the old key still works. Write the PEM to the `github-app-private-key` Key Vault secret from a protected temporary file, verify metadata and one authorised App-backed operation, then retire the old key and remove the temporary file. The key never goes to a sandbox.
- **GitHub webhook secret:** Write `github-app-webhook-secret` from a protected file, set the matching value in the GitHub App, and restart the backend to clear its cache. Verify recent deliveries after restart. Preserve the webhook URL and subscribed events.
- **Codex login:** Only re-seed when Settings reports **Action needed** and no Codex task or renewal is running. Use the Jarvis-only `CODEX_HOME`, not the operator's login. Write the resulting `auth.json` to `codex-login`, remove the temporary copy and let scheduled renewal verify health before starting another task.

For a Key Vault update, use the file form of `az keyvault secret set` with the configured vault and `--output none`. Never pass a raw value on the command line or print secret readback. [Infrastructure setup](../infra/README.md) owns configuration names.

## Recover a crashed task

Wait for **Needs attention** and inspect the Factory timeline and task branch. **Recover** starts a fresh session using the recorded branch, request and bounded history; uncommitted sandbox files are not restored. Verify actual branch and PR state before calling the work Done. Do not create a duplicate task or edit its SQL state directly.

## Use the sleep switch

Sleep is refused while tasks are Ready, Running or PauseRequested. Finish or cancel via the supported control. On wake, wait for backend and SQL readiness instead of repeating a write. Do not scale the backend directly while using the switch.

## Temporary SQL firewall access for an operator

Use Entra access through the authorised administrator group. If needed, add a temporary rule for only the operator's current public IP, then remove and verify removal. Do not broaden the Bicep-managed Azure services rule or add password auth.

## Restore the database to a temporary copy

Choose an available UTC point in the configured retention window. Use the [Azure SQL point-in-time restore procedure](https://learn.microsoft.com/en-us/azure/azure-sql/database/recovery-using-backups?view=azuresql) to restore to a new database, never over production. Verify the required schema and records with scoped access. Recover only the needed rows with an approved, reviewed script; clean up the copy and temporary access afterwards. Row-count agreement is not application recovery. Check retention and redundancy on the target before planning a regional recovery.
