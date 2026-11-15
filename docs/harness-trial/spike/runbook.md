# Spike runbook: what is needed and the exact steps

Spike #1851 (P15-158). Written because the spike session had **no Azure access**, so nothing below has been run. Commands are drafts built from the repository (`infra/main.bicep`, `docs/architecture.md`) and the Learn excerpts quoted in [03-target-architecture.md](../03-target-architecture.md). Learn pages cannot be fetched from the session, so every command is marked **verify** where a flag or name could differ.

## What blocked the session

| Needed | State in the session |
| --- | --- |
| Azure CLI or SDK | Not installed (`az: command not found`) |
| Azure credentials, any form | None: no `~/.azure`, no `AZURE_*` variables, no federated token. The only identity endpoint present belongs to the sandbox host, not to the Jarvis tenant, and was deliberately not used |
| Permission to create a deployment and an agent in the Foundry project | None |
| Learn and devblogs pages | Not reachable (DNS blocked), as in the earlier analysis |
| GitHub | Read access works (`gh` authenticated). No Actions secrets or variables are readable |

## What Dan has to do

Pick one. The first is quicker and keeps credentials off the session.

| Option | What | Effort |
| --- | --- | --- |
| **1. Dan runs the Azure steps** (recommended) | Run steps 1 to 6 below from a PC with `az login`. Then start a follow-up session, or paste the agent name, endpoint and the shim URL into this one, and the session runs the 20 prompts, the timings and writes the scorecard. The session needs the agent endpoint and a token that can call it, nothing else | About 45 minutes |
| 2. Give the session scoped Azure access | A service principal with: Contributor on a new scratch resource group `rg-jarvis-spike` only; `Cognitive Services Contributor` on the Foundry account (deployment create and delete); `Azure AI User` on the project; permission to read role assignments. Short-lived secret, revoked at exit. Still needs Dan for the budget and the role assignment for the agent identity | Larger blast radius; not recommended |

## Spend plan (30 DKK cap, model tokens only)

List price assumed: Terra $1.00 input, $0.05 cached input, $5.00 output per 1M tokens (GitHub Docs); 6.6 DKK per USD (the rate implied by the sandbox price in the cost section). **Assumed, not measured.**

| Turn shape (from the cost section bands) | Input per turn | Cached | Output | DKK per turn |
| --- | --- | --- | --- | --- |
| Low: 3 calls of 15k | 45k | 85% | 1k | 0.09 |
| Expected: 4 calls of 30k | 120k | 75% | 2k | 0.29 |
| High: 6 calls of 80k | 480k | 50% | 4k | 1.80 |

At the expected band 30 DKK buys about 100 turns; at the high band, 16. The 20 prompts alone are 20 turns, so the plan below leaves a margin and stops early if the high band shows up.

| Part | Ceiling (DKK) | Stop rule |
| --- | --- | --- |
| Q1 Terra retest, Q2 and Q3 probes | 2 | 10 short turns |
| Q4, Q5, Q7: 20 prompts on the test agent, once each | 15 | Stop and report if the running total passes 10 after 8 prompts |
| Q6 resume and push past the limit | 8 | Feed filler in fixed steps; stop at the first limit or compaction signal, or at 8 DKK |
| Reserve | 5 | Not planned |

The current Jarvis chat runs on the existing deployment and the existing monthly budget; the blind comparison costs about 20 normal turns there, outside the 30 DKK.

**A budget alert does not stop spend.** The real brake is the deployment's token-per-minute quota (step 1) and the stop rules above. A cost budget on the resource group also cannot isolate one deployment, because the test deployment bills under the same AI Services account as today's chat. Set the budget amount to **the Terra spend already booked this month plus 30 DKK** (read it first in Cost analysis, filtered by the Terra meter), alert at 100% actual and at 100% forecast, and use the deployment's metrics (`ProcessedPromptTokens`, `GeneratedTokens` by `ModelDeploymentName`) as the per-deployment count.

## Steps

All names are proposals. Resource names come from `infra/main.bicep`; look up the real AI Services account and project names first (`az cognitiveservices account list -g rg-jarvis`).

### 1. Dedicated Terra deployment with a low quota

```bash
az cognitiveservices account deployment create \
  -g rg-jarvis -n <aiservices-account> \
  --deployment-name terra-spike \
  --model-name gpt-6.1-terra --model-version 2026-10-26 --model-format OpenAI \
  --sku-name GlobalStandard --sku-capacity 50      # verify: 50 = 50k tokens per minute
```

50k tokens per minute caps a runaway at roughly 0.33 DKK per minute if all of it were uncached input, so 30 DKK would take about 90 minutes of continuous saturation. Lower it if the first turns fit (a 30k-token call needs more than 30k a minute).

### 2. Budget

Cost Management budget on `rg-jarvis`, filtered to the Terra meter, amount = booked spend + 30 DKK, alert at 100% actual and forecast, to Dan's address. Portal is simplest. **verify**: the exact meter name.

### 3. The test agent

From the Learn excerpt (JavaScript SDK; the Python and .NET equivalents are listed on the same page):

```js
await client.agents.createVersion("jarvis-harness-spike", {
  kind: "prompt",
  model: "terra-spike",                       // the deployment name from step 1
  instructions: "You are a test agent. Read-only. Be concise.",
  harness: { type: "microsoft_copilot_preview" },
}, { foundryFeatures: "MicrosoftCopilot=V1Preview" });
```

Confirm in the portal that the definition shows `kind: prompt` and `harness.type: microsoft_copilot_preview`, and that the agent is active.

### 4. Skill

Portal: Tools, Skills (Preview), New skill, Create skill. Name `inbox-triage`, description and body from [SKILL.md](SKILL.md) (the front matter gives the description). Then on the agent: Tools, Add, Add skills.

### 5. Three MCP servers

| Server | Auth | Notes |
| --- | --- | --- |
| GitHub, read-only | Key in a project connection. A fine-grained PAT limited to `DanAakesen/jarvis` with Contents, Issues, Pull requests and Metadata **read** | Remote server read-only path `https://api.githubcopilot.com/mcp/readonly` (**verify**). Connection keys are readable by project members: Dan only |
| Azure MCP | Project or agent managed identity | Needs a small container for the Azure MCP server (scale to zero). Give the identity **Reader** on `rg-jarvis`, nothing else |
| Jarvis shim | Shared-secret header, then the Q2 routes | See [mcp-shim-design.md](mcp-shim-design.md). Host in `rg-jarvis-spike`. `approval_probe` gets `require_approval` |

After the agent exists, its `instance_identity.principal_id` is the identity to give Reader to. If a Toolbox or generated files are used, it also needs **Foundry User** on the project (Learn excerpt).

### 6. Hand over

Give the session: the agent name, the project endpoint, the shim URL and a way to call the agent (a short-lived token or a script Dan runs). Everything else follows [prompts.md](prompts.md) and the stop rules above.

## Day plan

| When | What |
| --- | --- |
| Day 0, hour 1 | Q1 (Terra, effort omitted, `none`, `low`, `medium`), Q2, Q3 |
| Day 0, hours 2 to 4 | Q4, Q5, Q7: the 20 prompts, timed and streamed, plus the same 20 on current Jarvis chat |
| Day 0, end | Start the Q6 conversation: seed it with a few facts |
| Day 1 | Q6: resume after 24 hours, check the facts, then push toward the limit and watch compaction. Read the sandbox meter (Hosted or harness vCPU and memory) |
| Day 2 | Read Azure cost for Day 0 and 1. Write the final numbers into `spike-results.md`. Exit |
| 1 Dec bill | Check the sandbox line and whether idle time is billed |

## Exit checklist

- [ ] Agent `jarvis-harness-spike` deleted (all versions and conversations)
- [ ] Deployment `terra-spike` deleted
- [ ] Shim and Azure MCP containers deleted, `rg-jarvis-spike` deleted
- [ ] Role assignments for the agent identity removed
- [ ] Project connections holding the GitHub PAT and shim secret deleted; PAT revoked on GitHub
- [ ] Budget removed or reset
- [ ] `az resource list -g rg-jarvis` shows nothing that was not there before
