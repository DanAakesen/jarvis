# Spike results: managed Copilot-harness agent in Foundry

Spike for [#1851](https://github.com/DanAakesen/jarvis/issues/1851) (P15-158), part of the [Copilot-harness trial](README.md) (#1837). Written 15 Nov 2026.

## Outcome

**The spike was not run. Gate 0 is undecided, not failed.** The session had no Azure access, so the test agent, the Terra deployment and the budget could not be created, and per the owner's instruction nothing was worked around. No model tokens were spent: **0 DKK of the 30 DKK**. Nothing was created in Azure or GitHub, so there is nothing to delete.

What was done instead: the parts that need no Azure access, ready to use.

| Delivered | File |
| --- | --- |
| Inbox triage skill | [spike/SKILL.md](spike/SKILL.md) |
| MCP shim design with the identity and header test matrix and the approval test | [spike/mcp-shim-design.md](spike/mcp-shim-design.md) |
| 20 prompts in 5 buckets, checks, blind-scoring protocol | [spike/prompts.md](spike/prompts.md) |
| Exact steps, spend plan, day plan, exit checklist | [spike/runbook.md](spike/runbook.md) |

## What is missing and what Dan must do

| Missing | Detail |
| --- | --- |
| Azure CLI and credentials in the session | No `az`, no `~/.azure`, no `AZURE_*` variables. The sandbox's own identity endpoint was not touched: it is not the Jarvis tenant and nobody approved it |
| Rights to create a deployment and an agent | Needed: a deployment on the AI Services account, an agent in the Foundry project, a role assignment for the agent identity |
| Somewhere to host the shim | A scale-to-zero container app in a throwaway resource group, or a dev tunnel from Dan's PC |

Recommended path ([runbook](spike/runbook.md), option 1): Dan runs steps 1 to 6 (deployment with a 50k tokens-per-minute quota, budget, agent, skill, three MCP servers) from a PC with `az login`, then gives the session the agent name, endpoint and shim URL. The session then runs the 20 prompts, the timings and fills this file. About 45 minutes of Dan's time; the model spend stays within the plan below.

## The seven questions

| # | Question | Answer | Status |
| --- | --- | --- | --- |
| 1 | Does Terra work in the harness? Retest the 6 Nov rejection | Not tested. Prior art: the live 400 (`model_bad_request_reasoning`) was tied in source to a forced reasoning effort of `none` on the Terra branch of the smoke builder, but the provider message and the exact subfield were never captured (`docs/main-chat-harness-migration.md`). Retest the managed agent with effort omitted, `none`, `low` and `medium`, and record the status and the provider's error field | Open |
| 2 | Identity and headers at an MCP call; can a per-turn value pass? | Not tested. Six routes defined: agent identity, user token or OAuth passthrough, static header, turn reference as an argument, per-request metadata, hostile case. See the [shim design](spike/mcp-shim-design.md#q2-test-matrix-how-a-per-turn-value-could-reach-the-tool). Expectation, not a result: only routes that arrive without the model's help can prove authority; an argument can be forged by a prompt-injected model | Open |
| 3 | `require_approval` round trip | Not tested. New documentary finding from the Learn excerpt read today: during public preview **the service manages the approval policy for harness tools, and `require_approval` applies only to customer-configured MCP tools**. So approvals cover our MCP servers, not the built-in shell, files and web. That fits the design (writes go through our MCP) but means built-in tools are not gated by us. Per-tool granularity is still unknown | Open |
| 4 | Real tokens, cached tokens, context per call, cost per turn | Not measured. Budget arithmetic below is assumed list price, not a result | Open |
| 5 | Time to first token and streaming vs current chat | Not measured. Protocol: TTFT and total time for all 20 prompts on both stacks; pass is within 1.5 times current, with text before the first tool call streamed | Open |
| 6 | One conversation after 24 h and past its limit; compaction | Not tested. Plan: seed facts, resume the next day, then feed filler in fixed steps until a limit or compaction signal, capped at 8 DKK | Open |
| 7 | 20 prompts, blind scored against current Jarvis chat | Not run. Prompts and protocol ready | Open |

The sandbox meter and the 1 Dec bill checks follow the same path and are also open.

## Scorecard

Not run. Gate 0 needs Copilot to win at least 12 of 20 and at least 8 of the 12 reach and investigation prompts.

| Bucket | Prompts | Copilot wins | Needed |
| --- | --- | --- | --- |
| Azure | 4 | not run | 8 of 12 across Azure, GitHub and investigation |
| GitHub | 4 | not run | |
| Investigation | 4 | not run | |
| Inbox thread | 4 | not run | 12 of 20 overall |
| Plain chat | 4 | not run | |

## Cost per turn

No turn was run, so there is **no measured cost**. The table is the budget arithmetic that shaped the stop rules, using the turn shapes from [03-target-architecture.md](03-target-architecture.md#cost) and the assumed Terra list price ($1.00 input, $0.05 cached, $5.00 output per 1M tokens; 6.6 DKK per USD). All **assumed**.

```text
DKK per turn, one block = 0.2 DKK
Low       (3 x 15k, 85% cached)   ▌            0.09
Expected  (4 x 30k, 75% cached)   █▍           0.29
High      (6 x 80k, 50% cached)   █████████    1.80
```

| Shape | Turns that 30 DKK buys |
| --- | --- |
| Low | about 330 |
| Expected | about 100 |
| High | about 16 |

At the high shape the 20 prompts alone would exceed the cap, so the runbook stops the run and reports if the running total passes 10 DKK after 8 prompts.

## Findings that need no Azure access

| Finding | Consequence |
| --- | --- |
| A budget alert does not stop spend | The brake is the deployment's tokens-per-minute quota (50k proposed) and the stop rules. The alert is only a warning |
| The test deployment bills under the same AI Services account as today's chat, so a resource-group budget cannot isolate it | Set the budget to the Terra spend already booked this month plus 30 DKK, and count per-deployment tokens from deployment metrics. "Alert at 30 DKK" read literally would not isolate the spike |
| `require_approval` covers customer MCP tools only in preview | Approval design must assume the built-in shell, files and web are not gated by us. Egress controls in audit mode and a Reader-only identity carry that risk |
| Creating a harness agent needs the preview feature header (`MicrosoftCopilot=V1Preview`), and Toolbox or generated files need Foundry User on the project for the agent's own identity | Already in the runbook |
| Reader cannot read cost data | Cost reads stay with Dan or a separate Cost Management Reader grant; the spike does not need it for the agent |

Sources: the Learn page *Use the Microsoft Copilot harness with prompt agents*, read through search excerpts only (the page cannot be fetched from here); `docs/main-chat-harness-migration.md`; `infra/main.bicep`.

## Recommendation for Gate 0

**Hold. Do not pass and do not stop.** Gate 0 requires all seven checks answered, and none is. Nothing learned argues against the design, and nothing supports it yet.

| Decision | When |
| --- | --- |
| Run the spike through the [runbook](spike/runbook.md), option 1 | Next step; roughly 45 minutes of Dan's time, at most 30 DKK of models |
| Decide Gate 0 on the measured results | After the day-2 cost read, using the rules in [04-recommendation.md](04-recommendation.md#gates) |
| If Gate 0 fails on Terra, per-turn authority or the 12 of 20 rule | Stop, or try route 2 (Copilot SDK inside a hosted agent) as already planned |
| Do not start phase 1 (Test runtime selector) | Until Gate 0 passes |

## Exit

Nothing was created, so nothing needs deleting. Once the runbook is run, its [exit checklist](spike/runbook.md#exit-checklist) removes the agent, the deployment, the shim and the Azure MCP container, role assignments, connection secrets and the budget.
