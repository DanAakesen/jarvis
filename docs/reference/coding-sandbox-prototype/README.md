# Jarvis Foundry coding-sandbox prototype

This prototype tests Microsoft Foundry Hosted Agents as the execution sandbox
for Jarvis coding tasks. The driver stays on the developer PC; the selected
coding agent and repository work happen in an isolated Foundry Hosted Agent
session.

## Prerequisites

- PowerShell 7.4 or newer, Azure CLI 2.80 or newer, Node.js 22, Python 3.11,
  `uv`, `git`, and `gh`.
- An Azure login that can create resources and assign roles in subscription
  `0ac7d719-89bc-4100-be87-a79d33e953a7`, in tenant
  `802efa29-17f2-4a79-8f5f-38f087aed96a`.
- These providers must already be registered in that subscription:
  `Microsoft.CognitiveServices`, `Microsoft.ContainerRegistry`,
  `Microsoft.KeyVault`, `Microsoft.Insights`,
  `Microsoft.OperationalInsights`, and `Microsoft.Consumption`. The
  deployment deliberately does not mutate subscription-level provider
  registration.
- `C:\Repo\Jarvis\.secrets\copilot-token.txt`: a fine-grained Copilot Requests
  token.
- `C:\Repo\Jarvis\.secrets\github-token.txt`: a fine-grained token scoped to
  `DanAakesen/jarvis-poc-target` with Contents and Pull requests write access.
- `C:\Repo\Jarvis\.secrets\codex-jarvis\auth.json`: a Jarvis-only ChatGPT Pro
  Codex login. Never use your own `%USERPROFILE%\.codex\auth.json`; the deploy
  script refuses it. Create the Jarvis login once:

  ```powershell
  $env:CODEX_HOME = "C:\Repo\Jarvis\.secrets\codex-jarvis"
  New-Item -ItemType Directory -Force $env:CODEX_HOME | Out-Null
  Set-Content "$env:CODEX_HOME\config.toml" 'cli_auth_credentials_store = "file"'
  npx -y @openai/codex@0.157.0 login
  Remove-Item Env:CODEX_HOME
  ```

  Without this file, deployment still succeeds and Codex tasks stay
  unavailable.
- The GitHub CLI is logged in locally for seed-repository maintenance. That
  login is never sent to Azure.

The deployment script reads these files into process variables and writes
their values to Key Vault. It seeds the Codex login only when Key Vault has
none, so a renewed copy is never overwritten; pass `-ReseedCodexLogin` to
replace it. It does not put credentials in the image or hosted agent version
environment variables. Keep `.secrets/`, `.env`, and `auth.json` out of source
control.

## Deploy

Run from this directory:

```powershell
pwsh -File .\infra\deploy.ps1
```

The script always passes the target subscription explicitly. It creates the
resource group, Foundry account and project, Basic ACR, Key Vault, a
resource-group-scoped Log Analytics workspace plus Application Insights,
budget, remote-builds the runner image with `az acr build`, creates the ACR
and App Insights Foundry project connections, and waits for the
`jarvis-runner` version to become active. It uses an explicit
target-tenant token for Foundry data-plane preflight and deployment calls.
Foundry administration uses the `services.ai.azure.com` project host; hosted
sessions use the account endpoint returned by ARM (normally
`cognitiveservices.azure.com`). The deployment configures the agent endpoint
selector and Invocations protocol before the Key Vault probe.
The only hosted-agent environment values are the Key Vault URI and the
working-directory path.

Deployment writes non-secret metadata to `infra/.deployment-state.json`, which
is ignored by git.

**Foundry account and project names are never reused.** Without
`-FoundryAccount` and `-ProjectName`, the script reuses the resource group's
single Foundry account and that account's single project, or creates new ones
named `jarvispoc<yyyyMMddHHmm>` and `jarvis-poc-<yyyyMMddHHmm>`. On 2 October
2026, names recreated right after teardown stayed stale for over an hour: the
project returned `Project not found` and the deleted project's old agent
version, and the account's runtime host never recognized its new project.
Freshly named accounts and projects worked within seconds. Teardown discovers
and purges every Foundry account in the resource group.

If a previous image is already available, use
`-SkipImageBuild` only when you intentionally want to reuse an existing image
tag, and pass it with `-ImageTagOverride`. `-ImageTagOverride` is an image tag
such as `runner-20261002003036`, not the ACR build run ID. When the image is
built, the script records the ACR run ID separately, waits for it to succeed,
and verifies the selected `jarvis-runner:<tag>` manifest before it attempts
to create a hosted-agent version. The verifier uses
`az acr manifest show-metadata --query digest --output tsv`, which returns the
registry metadata digest for the selected tag with the supported Azure CLI
contract. It requires a complete `sha256:` digest; a missing manifest or an
ACR build run ID used as a tag fails the deployment even when
`-AllowHostedAgentFailure` is supplied.

If the Hosted Agent data plane is unavailable in the selected subscription or
region, `-AllowHostedAgentFailure` leaves the supporting resources deployed,
records the exact API error in the state file, and exits successfully. The
normal command fails instead of silently claiming that an agent is active.

## Driver

Install and type-check the driver:

```powershell
npm --prefix .\driver install
npm --prefix .\driver run build
$state = Get-Content .\infra\.deployment-state.json -Raw | ConvertFrom-Json
$env:FOUNDRY_PROJECT_ENDPOINT = $state.runtimeProjectEndpoint        # runtime: sessions, Invocations
$env:FOUNDRY_CONTROL_ENDPOINT = $state.controlPlaneProjectEndpoint   # administration: connections, versions
$env:FOUNDRY_AGENT_NAME = "jarvis-runner"
$env:FOUNDRY_TENANT_ID = "802efa29-17f2-4a79-8f5f-38f087aed96a"
$env:FOUNDRY_SUBSCRIPTION_ID = "0ac7d719-89bc-4100-be87-a79d33e953a7"
```

Run the safe preflight before starting a task. It prints only tenant,
audience, subscription, endpoint, and HTTP status values; it never prints the
access token:

```powershell
npm --prefix .\driver start -- preflight
```

Start a task. The returned invocation and Foundry session IDs are the primary
evidence identifiers:

```powershell
npm --prefix .\driver start -- start --agent copilot --task "Clone DanAakesen/jarvis-poc-target, run its tests, make one small testable improvement, push a branch, and open an unmerged PR. Report the PR URL."
npm --prefix .\driver start -- start --agent codex --task "Clone DanAakesen/jarvis-poc-target, run its tests, make one small testable improvement, push a branch, and open an unmerged PR. Report the PR URL."
```

The task prompt must tell the agent to work in the test repository, use the
credential already supplied by its ACP environment, and leave the PR unmerged.
The runner puts CLI caches under the persistent session directory, enables
Copilot's non-interactive `--allow-all` mode, records the ACP session ID, and
stops the provider process after each turn so steer/resume can start a clean
ACP process and use `session/load`. Each turn logs `runner_instance` (host,
PID, start time) and whether the agent advertises ACP `loadSession`.

Commands supported by the driver:

```text
start             POST an Invocations request and create a session
events            print recorded ACP events; add --follow to poll until done
steer             interrupt the running turn and send a correction (--session, --agent, --message)
pause             stop the running turn at a safe point; the session then idles out
resume            send the next turn on a retained session
cancel            cancel an invocation
sessions          list sessions visible to this Entra identity
delete-session    delete a session and release its sandbox
test-steering     scripted steering check (--agent)
test-pause-resume scripted pause/resume check (--agent)
renew-codex       renew the Jarvis Codex login if 3 days or less remain (--force: renew now)
```

For example:

```powershell
npm --prefix .\driver start -- events --invocation <invocation-id> --follow
npm --prefix .\driver start -- steer --session <session-id> --agent copilot --message "The PR must include a test and must not be merged."
npm --prefix .\driver start -- pause --session <session-id>
npm --prefix .\driver start -- resume --session <session-id> --agent copilot --task "Continue from the existing worktree and open the PR."
npm --prefix .\driver start -- cancel --invocation <invocation-id>
npm --prefix .\driver start -- delete-session --session <session-id>
```

Delete each session after collecting its evidence. The final deployment must
have zero sessions.

## Codex login renewal

Key Vault holds the only copy of the Jarvis Codex login. Renew it while no
Codex task runs; `renew-codex` refuses while any session is active.

```powershell
npm --prefix .\driver start --silent -- renew-codex           # renews only if 3 days or less remain
npm --prefix .\driver start --silent -- renew-codex --force   # renews now
```

The runner marks its private copy as expired, runs `codex exec`, and writes
the renewed login back to Key Vault if it is newer than the stored copy. After
every Codex task it also writes back a login that Codex renewed on its own.
The output shows only timestamps (`last_refresh_*`, `expires_*`), never token
values. Run the plain command daily; the future backend schedules it.

To reseed after a failed renewal, create a new login (see Prerequisites), then:

```powershell
pwsh -File .\infra\deploy.ps1 -SkipImageBuild -ImageTagOverride <current-tag> -ReseedCodexLogin
```

## Checks and evidence

Run all nine checks below after `npm --prefix .\driver start -- preflight`
succeeds. Keep an
evidence ledger with the UTC start/end times, command output, invocation ID,
Foundry session ID, PR URL (if one exists), and the Azure correlation/request
IDs. Never paste a bearer token, a Key Vault value, or Codex `auth.json` into
the ledger.

The runner emits a final `capacity` event containing CPU count, peak RSS, and
session-disk used/free bytes. App Insights receives a corresponding trace; use
that event and the App Insights query in check 9 for the capacity evidence.

### 1. Both agents

Run the same small, reviewable change once with each provider:

```powershell
$task = 'Work only in DanAakesen/jarvis-poc-target. Run install, build, and tests; make one small test-backed improvement; push a branch and open one unmerged PR. Report the PR URL and do not merge it.'
npm --prefix .\driver start -- start --agent copilot --task $task
npm --prefix .\driver start -- events --invocation <copilot-invocation> --follow
npm --prefix .\driver start -- start --agent codex --task $task
npm --prefix .\driver start -- events --invocation <codex-invocation> --follow
```

Record both PR URLs and the corresponding session IDs. Confirm both PRs are
open with `gh pr list --repo DanAakesen/jarvis-poc-target --state open`, then
delete both sessions.

### 2. Subscriptions

`npm --prefix .\driver start -- preflight` is the safe target-tenant check. For provider
identity evidence, ask each running agent to report which authenticated
provider it is using, then corroborate the result with its event output.
Inspect only Key Vault secret names (not values):

```powershell
az keyvault secret list --vault-name jarvis-poc-sc-kv `
  --subscription 0ac7d719-89bc-4100-be87-a79d33e953a7 `
  --query "[].name" -o tsv
```

The expected names are `copilot-token`, `github-token`, and `codex-login`.

### 3. Parallel Codex

Start two Codex invocations before either finishes, save both invocation and
session IDs, and wait for both event streams:

```powershell
npm --prefix .\driver start -- start --agent codex --task $task
npm --prefix .\driver start -- start --agent codex --task $task
npm --prefix .\driver start -- events --invocation <first> --follow
npm --prefix .\driver start -- events --invocation <second> --follow
```

Confirm both branches/PRs are distinct and the next Codex invocation still
authenticates. Delete every session after collecting evidence.

### 4. Steering

A correction interrupts the running turn: the runner sends ACP
`session/cancel`, waits up to 90 seconds for the turn to stop (then forces
it), and sends the correction as the next turn in the same ACP conversation.
The scripted test does this end to end:

```powershell
npm --prefix .\driver start --silent -- test-steering --agent copilot > steering-copilot.json
npm --prefix .\driver start --silent -- test-steering --agent codex   > steering-codex.json
```

The agent is asked to write the numbers 1–300 to `steering/<agent>-<stamp>.md`
and open a PR. Once it is working, the correction asks for even numbers only
and the heading `# Even numbers`. **Pass:** the first invocation ends as
`interrupted` after `acp_cancel_sent`, the steering invocation completes, and
the PR file has the new heading and only even numbers. Check the file with
`gh api repos/DanAakesen/jarvis-poc-target/contents/<file>?ref=<branch>`.

### 5. Pause/resume after idle timeout

Pause stops the running turn at a safe point (ACP `session/cancel`), then no
request reaches the session, so Foundry deprovisions it after the 120-second
idle timeout. Resume sends the next turn on the same session; the runner
starts a new ACP process and reloads the conversation with `session/load`.

```powershell
npm --prefix .\driver start --silent -- test-pause-resume --agent copilot > pause-copilot.json
npm --prefix .\driver start --silent -- test-pause-resume --agent codex   > pause-codex.json
```

The first turn writes and commits a marker file and is given a code word that
it must not write down. The test pauses after the marker appears, waits
180 seconds (`JARVIS_IDLE_WAIT_SECONDS`), and resumes with a request to write
the code word to a file and finish the PR. **Pass:** the first invocation ends
as `paused`; `instanceBefore` and `instanceAfter` differ (the container was
replaced); the resumed turn logs `acp_session_loaded`; and the PR contains the
marker file with the expected value, the correct code word, and all numbers.

### 6. Long run

Use a task whose measured runtime is longer than 120 seconds (for example,
the repository's full install/build/test followed by a documented wait).
Record UTC start/end timestamps and show that the same invocation completed,
rather than being restarted as a new task.

### 7. Cancel

Cancel an active invocation, wait for its terminal event, then delete the
session:

```powershell
npm --prefix .\driver start -- cancel --invocation <invocation>
npm --prefix .\driver start -- events --invocation <invocation> --follow
npm --prefix .\driver start -- delete-session --session <session>
npm --prefix .\driver start -- sessions
```

The final sessions response must contain no canceled session. Query App
Insights and Azure Cost Management for the cancellation window and record
whether any compute continued after cancellation.

### 8. Credentials

Verify Key Vault names, the ACR image manifest, and the agent version
definition without retrieving secret values:

```powershell
az keyvault secret list --vault-name jarvis-poc-sc-kv `
  --subscription 0ac7d719-89bc-4100-be87-a79d33e953a7 --query "[].name"
az acr repository show-manifests --name jarvispocscacr --repository jarvis-runner `
  --subscription 0ac7d719-89bc-4100-be87-a79d33e953a7 --query "[].tags"
```

The deployment's exact manifest gate is equivalent to:

```powershell
az acr manifest show-metadata --registry jarvispocscacr `
  --name jarvis-runner:runner-20261002003036 `
  --query digest --output tsv `
  --subscription 0ac7d719-89bc-4100-be87-a79d33e953a7
```

Do not substitute `az acr manifest show --query digest`: with the installed
CLI it returns the manifest document without a top-level digest, so the
deployment deliberately uses `show-metadata`.

The report must show that no secret was present in the Docker build context,
image layers, or version environment. The runner-side deployment probe proves
the platform-created agent identity can read Key Vault, while returning only
a boolean.

### 9. Capacity and cost

For each completed task, record duration, peak memory, disk usage, and the
session size reported by the runner/platform. The Azure CLI's default login is
in another tenant, so `az monitor app-insights query` fails with
`InvalidTokenError`. Query Application Insights directly with a
target-subscription token instead (the token stays in a variable):

```powershell
function Invoke-AppInsightsQuery([string]$Kql) {
    $sub = "0ac7d719-89bc-4100-be87-a79d33e953a7"
    $appId = az monitor app-insights component show --app jarvis-poc-appins --resource-group rg-jarvis-poc --subscription $sub --query appId -o tsv
    $token = az account get-access-token --resource https://api.applicationinsights.io --subscription $sub --query accessToken -o tsv
    $body = @{ query = $Kql } | ConvertTo-Json
    (Invoke-RestMethod -Method Post -Uri "https://api.applicationinsights.io/v1/apps/$appId/query" `
        -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body $body).tables[0].rows
}
Invoke-AppInsightsQuery "union traces,requests | where timestamp > ago(1d) | summarize count() by itemType"
az consumption usage list --subscription 0ac7d719-89bc-4100-be87-a79d33e953a7 `
  --start-date (Get-Date).ToUniversalTime().AddDays(-1).ToString('yyyy-MM-dd') `
  --end-date (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
```

A `Blocked` result is valid only when a correctly bootstrapped project and
target-tenant preflight have succeeded and the exact external service error
or authoritative documentation reference is recorded. Authentication,
project bootstrap, or missing connection defects are not external blockers.

Recent traces for one session:

```powershell
Invoke-AppInsightsQuery "union traces,requests | where timestamp > ago(1d) | where tostring(customDimensions) contains '<session-id>' | project timestamp, itemType, message, name | order by timestamp asc"
```

## Teardown and redeploy proof

After the checks:

```powershell
pwsh -File .\infra\teardown.ps1
pwsh -File .\infra\deploy.ps1
```

`teardown.ps1` removes everything the prototype created in Azure, in this
order:

1. Discovers every Foundry account in `rg-jarvis-poc` and every project in
   each account, then lists and deletes the `jarvis-runner` sessions in each
   project using a target-tenant token. If a project's sessions cannot be
   listed, it warns and continues: the account purge in step 4 is what
   guarantees that no session keeps running or billing.
2. Deletes `rg-jarvis-poc` (all resources and the budget) and waits for it to
   disappear.
3. Checks the exact legacy Application Insights-managed workspace and resource
   group from the first deployment. Azure normally removes them with the
   resource group; if not, the script deletes only those exact, verified
   resources and stops on any authorization or identity mismatch.
4. Purges the soft-deleted Key Vault and every soft-deleted Foundry account
   from the resource group, then verifies that the group, workspace, and
   soft-delete entries are all gone. A nonzero purge response stops the
   script.
5. Prints what it deleted and a reminder to revoke the two fine-grained
   tokens.

Optional switches: `-DeleteTestRepo` deletes `jarvis-poc-target` (requires
`delete_repo` on the local `gh` login); `-DeleteLocalSecrets` deletes
`C:\Repo\Jarvis\.secrets\`. The next `deploy.ps1` creates fresh account and
project names.

## Quality gate

```powershell
pwsh -File .\check.ps1
```

The quality gate type-checks the driver, runs runner unit tests, and parses
every PowerShell file. It does not contact Azure or GitHub.
