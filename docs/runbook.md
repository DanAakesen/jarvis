# Operations runbook

For the owner or an authorised operator. Look up the intended resources in the infrastructure deployment's outputs. Do not copy secret values, live content or environment identifiers into the repository or a PR.

## Deploy

1. Follow [exact-tree PR qualification](agent-context.md#merge-and-release-procedure). [Deploy](../.github/workflows/deploy.yml) runs on `main` for production inputs, including `docs/features.md`, but not for ordinary docs. Do not trigger it to validate a docs PR.
2. List `main` runs with `gh run list --workflow deploy.yml --branch main`. In `release-evidence-<attempt>`, check `superseded`, which components are `applied` or `reused`, and `checks.smoke` for deterministic readiness. After a failed or partial rollout, verify the serving revision directly; the receipt can lag behind a traffic switch. `accepted: true` can include `checks.acceptance: skipped`. A docs-only merge does not replace the production receipt.
3. [Runner deploy](../.github/workflows/runner-deploy.yml) is separate and uses the configured successful infrastructure deployment. It shares production deployment concurrency; do not start a competing out-of-band release.
4. Use [PLAN.md](../PLAN.md) for delivery state and the [TestFlight procedure](agent-context.md#testflight-build) for a signed build. Readiness, signed upload, Apple processing and device acceptance are separate. Live provider or notification probes require explicit approval.

## Triage

Use [diagnostic sources](reference/logs.md) and a narrow UTC window. Investigate the specific symptomatic surface, not a fresh model call.

| Symptom | Check first |
| --- | --- |
| Deploy reports `exact_qualification_missing` | Compare the merged tree with the CI receipt's PR/head and tested tree. Use a qualified PR to reconcile source; do not rerun an unqualified commit or bypass evidence. |
| New backend revision rejects a boolean at startup | Check that Bicep renders `JARVIS_BACKEND_LOGS_ENABLED` and `JARVIS_PROACTIVE_EVENTS_ENABLED` as literal lowercase `true`/`false`, not ARM's `True`/`False`. The log flag rejects other values at startup; the events flag enables only on `true`. Verify the new revision's readiness, not just the previous revision's health. |
| Tool result is missing or uncertain | Compare `pi.stream_failed` with `pi.mcp_tool` and the stored receipt. The harness can refuse a name before the door sees it. Read back the intended result before retrying a possible write. |
| Voice never starts, stays on Speaking or does not end | Look for `session_started` in `voice.session_stage`, or `voice.stage_timeout` if startup stalls. `jarvis.session.ready` is sent to the client; an open socket is not readiness. Use `voice.session_summary` for the closer and outcome. On Watch, check phone reachability and playback separately from the relay and saved turn. |
| Brain appears idle | Compare Proactive status and `pi.brain_tick`/`pi.brain_run`: distinguish off, paused, no eligible or due work and a failed wake. With `daily_cap` and work queued, check the next due time against Copenhagen midnight; a due time does not prove a wake ran. Do not enable the brain to diagnose it. |
| Status smoke is degraded | Read authenticated `GET /status` for retained results and `system.smoke_check` for the final allowlisted reason. `GET /status/smoke` runs checks; do not invoke it for routine diagnosis. Check discovery, tool receipt and reply assertions separately. |
| TestFlight upload succeeded but the fix isn't visible | Check the Apple receipt for that build and compare it with the installed version. If availability is unconfirmed, use the authorised [receipt-only check](agent-context.md#testflight-build), not another upload. Availability is not installation or device acceptance. |

## Owner session switch

The checked-in `JARVIS_OWNER_SESSION_ENABLED` pin is **true** in [Bicep](../infra/main.bicep). Keep ingress header logging off; Voice carries the session token through `Sec-WebSocket-Protocol`.

- **Incident:** Use authenticated `DELETE /auth/sessions` and check its success and revoked count. If no usable owner token is available, disable the switch through a reviewed change and Deploy.
- **Disable/re-enable:** Change the deployment pin through a reviewed PR and Deploy, not a portal override. Off mode returns 404 on the session routes and a new process attempts one revoke of retained sessions. Check `owner_session.boot_revoke` before turning it back on; a failed attempt needs an authorised retry by restarting the off revision. Off/on overlap can revoke newly minted sessions.
- **Verify:** After enabling, the owner signs in with Entra and checks mint/revoke in the intended client. A web client that cached a 404 may wait before minting again.

## Roll back a deployment

### Backend Container Apps revision

In single-revision mode, Container Apps keeps the previous revision serving until the new one is ready. A later Deploy check can fail after traffic moves. Check the serving revision, not just `/health`.

Even if traffic never moved, the [applied migration ledger](../db/migrations/README.md) must match an unchanged prefix of the target image's migrations by name and checksum. If it does not, roll forward with a compatible image. Preserve applied migrations in the reconciliation PR.

If an unhealthy revision is serving and the known-good revision is compatible, use the backend app from the infrastructure outputs and [`az containerapp revision copy`](https://learn.microsoft.com/en-us/cli/azure/containerapp/revision?view=azure-cli-latest#az-containerapp-revision-copy) with `--from-revision <known-good-revision>`. Verify that the copy is serving, healthy and works for the affected path within the authorised scope. Retain the failed revision and evidence until triage; reconcile through a reviewed PR.

### Foundry version

Determine which agent serves the affected path before changing a pin. Normal Chat and Voice use `jarvis-pi` and `jarvis-pi-live`, not the isolated hosted `jarvis` agent. Use the [agent ownership rules](architecture.md#the-two-foundry-agents) and the [readback procedure](agent-context.md#verify-the-live-agents-read-only). A version rollback is an owner operation: pin the known-good version, verify what is serving and preserve `KEEP THIS BLOCK`. Do not change Active concurrently with Deploy, delete the affected version or infer that existing sessions restarted. If the problem is code-owned, reconcile the source through a PR.

## Rotate credentials

- **GitHub App key:** Generate a replacement while the old key still works. Write the PEM to the `github-app-private-key` Key Vault secret from a protected temporary file, verify metadata and one authorised App-backed operation, then retire the old key and remove the temporary file. The key never goes to a sandbox.
- **GitHub webhook secret:** Write `github-app-webhook-secret` from a protected file, set the matching value in the GitHub App, and restart the backend to clear its cache. In Recent Deliveries, redeliver failures from the rotation window and verify their 2xx responses. Preserve the webhook URL and subscribed events.
- **Codex login:** Only re-seed when Settings reports **Action needed** and no Codex task or renewal is running. Use the Jarvis-only `CODEX_HOME`, not the operator's login. Write the resulting `auth.json` to `codex-login`, remove the temporary copy and let scheduled renewal verify health before starting another task.

For a Key Vault update, use the file form of `az keyvault secret set` with the configured vault and `--output none`. Never pass a raw value on the command line or print secret readback. [Infrastructure setup](../infra/README.md) owns configuration names.

## Recover a crashed task

Wait for **Needs attention** and inspect the Factory timeline and task branch. **Recover** starts a fresh session using the recorded branch, request and bounded history; uncommitted sandbox files are not restored. Verify actual branch and PR state before calling the work Done. Do not create a duplicate task or edit its SQL state directly.

## Use the sleep switch

Chat and Voice can read, sleep or wake the Jarvis backend with `backend_sleep`. Sleep sets the minimum to zero so idle replicas can scale down. Wake keeps one replica warm and can incur costs. Read the switch to verify the setting. Revision restart and rollback use the existing operator and release procedures.

Sleep is refused while tasks are Ready, Running or PauseRequested. Finish or cancel via the supported control. On wake, wait for backend and SQL readiness instead of repeating a write. Do not scale the backend directly while using the switch.

## Temporary SQL firewall access for an operator

Use Entra access through the authorised administrator group. If needed, add a temporary rule for only the operator's current public IP, then remove and verify removal. Do not broaden the Bicep-managed Azure services rule or add password auth.

## Restore the database to a temporary copy

Choose an available UTC point in the configured retention window. Use the [Azure SQL point-in-time restore procedure](https://learn.microsoft.com/en-us/azure/azure-sql/database/recovery-using-backups?view=azuresql) to restore to a new database, never over production. Verify the required schema and records with scoped access. Recover only the needed rows with an approved, reviewed script; clean up the copy and temporary access afterwards. Row-count agreement is not application recovery. Check retention and redundancy on the target before planning a regional recovery.
