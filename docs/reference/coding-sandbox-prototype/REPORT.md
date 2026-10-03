# Jarvis Foundry prototype — report

Run: night of 1–2 October 2026. Subscription "Dan Aakesen"
(`0ac7d719-89bc-4100-be87-a79d33e953a7`), tenant Novaro
(`802efa29-17f2-4a79-8f5f-38f087aed96a`), resource group `rg-jarvis-poc`
in Sweden Central. Test repository:
[DanAakesen/jarvis-poc-target](https://github.com/DanAakesen/jarvis-poc-target).
All times are UTC. No token values are recorded here.

## 1. Summary

**Foundry Hosted Agents can run Jarvis coding tasks.** GitHub Copilot and
OpenAI Codex each ran a real task inside an isolated Foundry sandbox in Azure,
using Dan's own subscriptions, and opened a pull request on the test
repository. All nine checks pass, including steering a running agent and
pausing it, letting Azure shut the sandbox down, and resuming where it left
off. A sandbox costs about **0.89 DKK per hour**.

**Recommendation: keep Foundry, with these adjustments.**

- Use 1 vCPU / 2 GiB sandboxes; 0.5 vCPU / 1 GiB cannot start the image.
- Keep one long-lived Foundry account and project. Never recreate a deleted
  account or project name: Azure kept stale state for reused names, and the
  rebuild stalled until fresh names were used.
- Steer and pause through the agent protocol's cancel (ACP
  `session/cancel`), then continue with a new turn in the same conversation.
  Both agents stopped within a second and reloaded their conversation after
  a full sandbox restart.

Not tested: whether a run survives the idle timeout when no client is
polling. In every run, the driver polled the sandbox every few seconds.

**Current state:** the delete-everything script worked, and the rebuild after
it is complete. Agent version 3 (with the steering and pause fixes) is active,
the Key Vault check passed, and no sessions are running (see "Redeploy after
teardown").

## 2. Results

| Check | Result | Evidence |
| --- | --- | --- |
| Both agents | **Pass** | Copilot: Foundry session `07766b05dcf2ba9f00UWkr2jRJj7fYS4Wa1hunaIXWA1iDgExz` opened PR [#1](https://github.com/DanAakesen/jarvis-poc-target/pull/1). Codex: session `0066898273368fb600BqRMYcfsyW3UcmL6l4oPeTWN4KzjJIkR` opened PR [#2](https://github.com/DanAakesen/jarvis-poc-target/pull/2). Both open and unmerged. Application Insights ties each PR to its session (see "Telemetry correlation"). |
| Subscriptions | **Pass** | Codex used the ChatGPT Pro login file and Copilot used the Copilot Requests token, both read from Key Vault inside the sandbox. No pay-per-use API keys were configured. |
| Parallel Codex | **Pass** | Sessions `0a84130f7df9afe9002lbDUJKrWXfXooBy3oKeU1uXLEiinkqq` and `01f07c5722b315b800AKae9oXL6zqGxaYEtVjtEremb4nuMY98` started together at 05:03:53 and both finished at 05:05:43 on one shared Codex login. |
| Steering | **Pass** | Rerun on 2 October with runner version 3 (`test-steering`). Copilot: the correction stopped the running turn with ACP `session/cancel` at 09:34:11 (`stopReason: cancelled` within a second), the next turn reloaded the same ACP conversation, and PR [#7](https://github.com/DanAakesen/jarvis-poc-target/pull/7) contains only the even numbers 2–300 under `# Even numbers`. Codex: same sequence at 09:34:17, PR [#8](https://github.com/DanAakesen/jarvis-poc-target/pull/8). The overnight attempt failed because the runner queued corrections behind the running turn instead of interrupting it. |
| Pause/resume | **Pass** | Rerun with runner version 3 (`test-pause-resume`), pausing mid-turn with ACP `session/cancel`, then sending no requests for 180 s (idle timeout 120 s). Copilot: paused at 09:34:03 after committing the marker and numbers 1–20; on resume at 09:37:14 the container start time had changed (the sandbox was deprovisioned and restored), the same ACP conversation was reloaded, the agent wrote the code word `cobalt-458` that it had only been told (never written down), and continued from 21–40 to 200, PR [#9](https://github.com/DanAakesen/jarvis-poc-target/pull/9). Codex: paused at 09:47:34 after committing the marker, 1–20 and 21–40; resumed in a new container at 09:50:46, recalled `maple-758`, continued from 41–60, PR [#11](https://github.com/DanAakesen/jarvis-poc-target/pull/11). Resume after an already finished turn also passed for both agents (PRs [#5](https://github.com/DanAakesen/jarvis-poc-target/pull/5), [#6](https://github.com/DanAakesen/jarvis-poc-target/pull/6), [#10](https://github.com/DanAakesen/jarvis-poc-target/pull/10)). |
| Long run | **Pass** | The steering task ran 19 minutes (05:06:08–05:25:08) in one sandbox and completed; the Codex PR task ran 129 s, past the 120 s idle timeout. Caveat: the driver polled throughout. |
| Cancel | **Pass** | Invocation `inv_f6773760d2d79fd700WKv5jkBCUcQAPrtVlLqxTXhUFmUMyWBT` was cancelled mid-run, returned `cancelled`, and session `002f37713b61eb8900vZWcv5RCaQzNA18Wa4xUSdLlctlccDcJ` was deleted. |
| Credentials | **Pass** | Tokens were read from Key Vault at task time by the agent's own identity. The agent version's only environment values were the Key Vault URI and a work path. A scan of the image build context and git history found no token values. |
| Capacity and cost | **Pass** | Session `02ff55f62ec59cdb00KGp6RFUVcUoePsVm7rO3s5Gj38HHtSv3` on 1 vCPU / 2 GiB: adapter peak memory about 81 MiB, 2.1 GB disk used, 3.5 GB free. The runner image built in ACR in 3.2 minutes. Cost per sandbox-hour is in section 3. |
| Codex login renewal (added 2 October) | **Pass** | Runner version 5 with a Jarvis-only login (seeded 11:14:39 UTC; the PC-login copy was deleted and purged). `renew-codex` without force reported `fresh` with 9.98 days left. `renew-codex --force` in session `02edbcd6903ff86800BE98qe2984XhZXmf6o6f0JdLM4DhrvBE`: Codex renewed through its own client (`last_refresh` 11:43:27, access token now expires 2026-10-12 11:43:27) and the runner wrote it back to Key Vault. The next Codex task (session `056a29f75f5da23100IrHYDdEifbmKOUQoc8kwLw1pHuOcFk6K`) completed with the renewed login. Dan's own login still shows `last_refresh` 2026-09-27. An earlier attempt that only backdated `last_refresh` did not renew; the current client renews on access-token expiry. |

### Telemetry correlation

Application Insights traces carry the Foundry session ID. First and last trace
per session:

| Session | Work | Traces | First → last | Result |
| --- | --- | --- | --- | --- |
| `07766b05dcf2ba9f00…` | Copilot PR task | 77 | 04:59:27 → 05:03:54 | PR #1 created 05:00:55 |
| `0066898273368fb600…` | Codex PR task | 94 | 05:01:18 → 05:06:22 | PR #2 created 05:03:12 |
| `0a84130f7df9afe900…` / `01f07c5722b315b800…` | Parallel Codex | 76 / 76 | 05:03:53 → 05:05:43 | Both completed |
| `0a6933b39acae1b000…` | Overnight steering attempt (correction queued, not applied mid-run) | 397 | 05:05:58 → 05:25:08 | Superseded by the rerun |
| `05024507c951469200…` | Overnight pause/resume attempt | 72 | 05:39:25 → 05:44:54 | Superseded by the rerun |
| `002f37713b61eb8900…` | Cancel | 35 | 05:43:49 → 05:44:38 | Cancelled, deleted |
| `02ff55f62ec59cdb00…` | Capacity | 53 | 05:55:56 → 05:57:04 | Capacity trace recorded |

## 3. Cost

Azure retail prices for Foundry hosted agents in Sweden Central (Azure Retail
Prices API, 2 October 2026):

| Meter | Price |
| --- | --- |
| Hosted vCPU usage | 0.7193 DKK per vCPU-hour |
| Hosted memory usage | 0.0854 DKK per GiB-hour (unit assumed per GiB) |
| **1 vCPU / 2 GiB sandbox** | **≈ 0.89 DKK per hour** |

- **Per task:** the two PR tasks used about 4.5 and 5 minutes of sandbox
  time, about 0.07 DKK each.
- **This run:** 27 sessions with 5,096 seconds (1.4 hours) of traced
  activity, about 1.3 DKK. Allowing for the 120-second idle tail after each
  session, the upper bound is about 2.1 DKK.
- **Fixed costs while deployed:** Container Registry Basic 1.10 DKK per day
  (about 33 DKK per month); Key Vault, Log Analytics, and Application
  Insights are a few kroner per month at this volume.
- **Billed so far:** the 300 DKK budget showed 0.06 DKK; Azure billing lags up
  to a day.
- **Copilot and Codex usage** counts against Dan's Copilot (work) and ChatGPT
  Pro plans, not Azure. Check those accounts for exact consumption.

## 4. Problems and workarounds

1. **Our deploy script blocked itself.** It checked the `/agents` list
   route, which returns `Project not found`, and stopped. The named route
   `/agents/jarvis-runner/versions` works; deployment now uses it directly.
2. **0.5 vCPU / 1 GiB was too small.** The service returned `ImageError`; the
   runner uses 1 vCPU / 2 GiB.
3. **Two Foundry hostnames.** Administration (connections, versions) uses
   `*.services.ai.azure.com`; sessions and Invocations use the account's
   `*.cognitiveservices.azure.com` endpoint. The driver takes both.
4. **Cross-tenant Azure CLI.** The CLI's default login is Microsoft's tenant.
   Tokens must be requested with `--subscription`; `--tenant` alone picks the
   wrong account.
5. **Runner fixes.** Copilot needed a writable home/cache directory and
   non-interactive `--allow-all`; ACP requests needed a 1-hour timeout; the
   agent identity is read from `instance_identity.principal_id`.
6. **Application Insights created a workspace outside the resource group.**
   Deployment now creates the Log Analytics workspace inside
   `rg-jarvis-poc`; teardown removed the old managed group.
7. **Reused names stalled the redeploy.** After teardown, deployment
   recreated the account `jarvispocscfoundry` and the project `jarvis-poc`
   with their old names. The project returned `Project not found`, then the
   deleted project's old agent version 8. A freshly named project in the same
   account could be administered, but the account's runtime host still
   answered `Project not found` for over an hour. A freshly named account
   (`jarvispoc1002foundry`) worked within minutes. Deployment now creates
   timestamped account and project names, and teardown purges every account
   in the resource group.
8. **Steering was queued instead of interrupting.** The overnight runner
   sent a correction as a new turn that waited behind the running one, and
   pause stopped the whole sandbox mid-turn. Version 3 sends ACP
   `session/cancel` (forcing a stop after 90 s if needed), marks the turn
   `interrupted` or `paused`, and continues in the same conversation with
   `session/load`. The test tasks now include `sleep` between batches so the
   steer and pause land while the agent is working.
9. **Process.** One building agent spent about 2.5 hours overnight hardening
   teardown edge cases instead of fixing the blocker in problem 1. That is
   why the run finished late.

### Teardown evidence

`infra/teardown.ps1` ran once after the checks. Azure Activity Log:

| Time | Operation | Resource | Correlation ID |
| --- | --- | --- | --- |
| 06:01:05 | Resource group delete | `rg-jarvis-poc` | `258270f4-683f-4e05-b225-871d578a967a` |
| 06:01:15 | Resource group delete | App Insights managed group | `930159b9-0f7b-4c35-a802-e133f10808e5` |
| 06:03:13 | Key Vault purge | `jarvis-poc-sc-kv` | `e74f797a-052b-4300-a401-7da2bc125a79` |
| 06:03:48 | Foundry account purge | `jarvispocscfoundry` | `cac31651-7392-4985-a197-f45cef4cafc7` |

The script then confirmed that both resource groups, the soft-deleted Key
Vault, and the soft-deleted Foundry account were gone.

### Redeploy after teardown

Deployment first recreated the old names and stalled (problem 7):

- **06:05** — account `jarvispocscfoundry` recreated under its old name.
- **06:53** — project `jarvis-poc` recreated; `Project not found`, later the
  deleted project's agent version 8.
- **07:25–08:25** — a freshly named project in that account: administration
  worked (connections 200, version 1 active at 07:29), but the runtime host
  answered `Project not found` for an hour, so no session or Key Vault probe
  could run.

Redeploy with fresh names, using the normal `infra/deploy.ps1` path:

- **08:30** — account `jarvispoc1002foundry` and project
  `jarvis-poc-202610020830` created.
- **08:35** — connections 200; agent version 1 **active** with the
  120-second idle timeout and the Invocations endpoint.
- **08:36** — runtime host ready on the first check; the runner's Key Vault
  probe passed using the agent's own identity.
- **08:38** — driver preflight: tenant `802efa29-…`, audience
  `https://ai.azure.com/`, connections 200, agent versions 200. The probe's
  session was deleted with `npm start -- delete-session`; `npm start --
  sessions` lists one record with status `deleted` and no active sessions.
- **08:39** — the stale account was deleted and purged (correlation IDs
  `c9085257-deb6-4cbd-b251-043f9201b599` and
  `d661b0d8-4901-4528-80c8-4258c9960dc2`).

**Current state:** `rg-jarvis-poc` holds one Foundry account
(`jarvispoc1002foundry`), project `jarvis-poc-202610020830`, active agent
version 3 (versions 2 and 3 added the steering and pause fixes; same
account and project), zero active sessions, and the supporting registry, Key
Vault, Log Analytics workspace, Application Insights, and budget. Test PRs
#1–#11 remain open and unmerged.

## 5. Design impact

Proposed changes to `jarvis.md`; not applied:

- **Sandbox size:** 1 vCPU / 2 GiB minimum.
- **Cost:** about 0.9 DKK per sandbox-hour plus about 35 DKK per month fixed.
  This fits "keep costs as low as possible".
- **Foundry account and project:** keep one long-lived account and project;
  never recreate a deleted name.
- **Endpoints:** store administration and runtime endpoints separately.
- **Steering:** stop the current turn with ACP `session/cancel`, then send
  the correction as a new turn in the same conversation. Proven for both
  agents; both stopped within a second.
- **Pause/resume:** pause with ACP `session/cancel` and let the sandbox idle
  out; resume with a new turn on the same Foundry session. Files and the
  agent's conversation survived a full sandbox restart for both agents.
- **Provider switching mid-task (Decision #4):** not tested. Each provider
  keeps its own conversation, so a switch would need a handoff summary rather
  than `session/load`.
- **Long runs:** the backend should keep polling running tasks until the
  no-traffic case is tested.
- **Board events:** Application Insights traces keyed by session ID are a
  workable source for live task status.

## 6. Next steps

1. Review the PRs. [#1](https://github.com/DanAakesen/jarvis-poc-target/pull/1)
   and [#2](https://github.com/DanAakesen/jarvis-poc-target/pull/2) are the
   original task PRs; #3–#11 are steering and pause/resume test PRs. All are
   test changes; close or merge as you like.
2. Decide whether to keep the Azure resources (about 1.1 DKK per day while
   idle) or run `pwsh -File .\infra\teardown.ps1`.
3. Decide which design changes in section 5 to apply to `jarvis.md`.
4. After the review, revoke the two fine-grained GitHub tokens and delete
   `C:\Repo\Jarvis\.secrets\` (`teardown.ps1 -DeleteLocalSecrets`).
