> **Historical record.** Git dates: 2026-11-15 to 2026-11-16. Retained as evidence, not a current runbook. Original at `0ff1d1650`. Protected values omitted.

## PI built-ins: what they cost (16 November 2026, Deploys 43911904900, 43917007448 and 43917784950)

The harness built-ins (shell, filesystem read and write, web, sub-agents) are on. GitHub reaches PI through the Jarvis MCP door (118 GitHub tools found through `find_tools`, one `gh_issue_read` call checked by the smoke), so its tool list is not in the prompt. One thing was switched off per Deploy to see the cost of the built-ins.

| Measure | Built-ins on (43911904900) | Built-ins off (43917007448) |
| --- | ---: | ---: |
| Fixed-prompt input tokens | about 14.1k | 7.7k |
| Warm first text | 2.0 to 2.8 s (turn 2: 2.8 s, turns 3 and 4: 2.0 to 2.1 s) | 1.1 to 1.3 s |
| Voice plain, first text | 1.7 s | 1.4 s |
| Voice with a tool, first text | 1.8 s | 1.5 s |

Other numbers from 43911904900: cold 3.7 s, tool turn 3.3 s, github reach 1.7 s, smoke [money omitted] at list price.

Earlier full-server baselines, for the history of this change: GitHub attached as a harness tool (Deploy 43901841128) about 31k input and warm first text 2.4 to 5.7 s; the same with built-ins on (Deploy 43905474658) about 37.5k input, warm first text 3.5 to 4.3 s, voice plain 4.1 s and voice with a tool 8.9 s. Moving GitHub into the door removed about 23k tokens and about 7 s from the voice tool turn.

Reading: the built-ins cost about 6.4k tokens a turn and about 0.8 s on warm chat first text (about 0.3 s on voice). The four skill descriptions are about 0.25k tokens, so the `skills_off` variant was not run. The decision is in `docs/decisions.md`, 16 November 2026: built-ins stay on.

## PI voice leg and prompt size (16 November 2026, Deploy run 43831735508, `measure_pi` after #1908)

Observed through the gateway on agent `jarvis-pi` with the voice instructions and the brain, watches and workers skills. Reach servers were not attached, so no reach rows.

| Turn | First text | Total | Input | Cached | Output | DKK (list price) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Cold, new conversation | 3764 ms | 11099 ms | 40865 | 23255 | 426 | [money omitted] |
| Warm, turn 2 | 2394 ms | 2731 ms | 17760 | 17601 | 11 | [money omitted] |
| Warm, turn 3 | 1456 ms | 1785 ms | 17847 | 17757 | 12 | [money omitted] |
| Warm, turn 4 | 1176 ms | 1551 ms | 17936 | 17844 | 11 | [money omitted] |
| Tool turn (Jarvis MCP, 2 calls) | 1156 ms | 12822 ms | 55089 | 54444 | 122 | [money omitted] |
| **Voice, plain (PI leg only)** | **1641 ms** | 2007 ms | 18730 | 18569 | 9 | [money omitted] |
| **Voice, with a tool (PI leg only)** | **1442 ms** | 6321 ms | 57668 | 56958 | 119 | [money omitted] |

```text
First text (1 block = 0.1 s)
voice plain      |████████████████▍  1.6 s
voice with tool  |██████████████▍    1.4 s
warm turn 4      |███████████▊       1.2 s
cold             |█████████████████████████████████████▋  3.8 s
```

Voice checks passed: replies read as speech, a voice turn ran `list_jobs` through the MCP server with an `ok` result, and PI wrote a sentence before the tool call (the spoken acknowledgement). These are the PI leg only: Voice Live's audio in and out is not in them.

**The prompt grew.** A warm turn carried about 17.7k input tokens, against about 7.5k on 16 November before the brain, watches and workers skills and the voice section. At list price with no cached discount that is about [money omitted] per warm turn (was 0.05) and [money omitted] cold (was 0.05).

What the repository says about where the tokens are (Derived, from the files):

- The authored definition is small: `agents/pi/instructions.md` is about 6.6k characters (about 1.7k tokens), the persona kernel about 1.9k characters, and the four skill descriptions together about 1k characters (about 0.25k tokens). The skill bodies (about 10.5k characters, about 2.6k tokens) enter a conversation only when the model loads a skill.
- So the base prompt cannot have grown by 10k tokens from the definition alone. The cold turn (40.9k input over several calls) and the tool turn (55k over about three calls of about 18k) show the conversation itself getting large: the smoke's cold prompt ("say what you can do") makes the model load skills and look tools up, and those results stay in the conversation and are re-sent, cached, on every later turn.
- **Cached tokens are 99 percent of input from turn 2.** At the cached input rate assumed in the plan ([money omitted] per million, not yet checked against an invoice) a warm turn costs about [money omitted] and the cold turn about [money omitted], not 0.12 and 0.28. The ledger and the monthly cap still use the conservative list price on purpose (`core/usage-pricing.ts`), so they over-count by roughly an order of magnitude on warm turns.

Not yet measured: the base prompt on its own. The smoke now has a first row, "fixed prompt, new conversation" (a new conversation and the reply `ready`, no skill or tool), so the next `measure_pi` separates the fixed prompt from the growth.

Options, none implemented (the behaviour risk is larger than the saving until the baseline is known):

| Option | Saving | Risk and cost |
| --- | --- | --- |
| Shorter skill descriptions and bodies | at most about 1k tokens of the fixed prompt; bodies only when loaded | The model may stop loading the right skill; needs a quality check in the iOS test chat |
| Load the brain and watches skills only on wakes (a second agent definition for the brain) | about 0.1k tokens of descriptions in chat turns | Breaks the one-agent plan, doubles provisioning and gives the brain a cold prompt of its own. Not worth it |
| Keep the smoke's cold prompt from pulling skills in (only changes the measurement) | none in production | Hides real behaviour; better to read the baseline row |
| Price cached input in the ledger and cap | makes the cap realistic (about 10 times fewer false stops) | A decision for the owner: the cap is conservative by design. Needs one invoice check of the cached rate first |
| Shorter tool results (`find_tools` returns up to three full schemas and five short matches) | tool turns: tens of percent of a turn | Larger change in `pi/mcp.ts`; measure first with the baseline |

## PI live smoke and wake-up probe (16 November 2026, #1886)

Observed by the Deploy run with `measure_pi` and `probe_pi_wake` after the PI stack merged. Agent `jarvis-pi` version 2 (skills inbox-triage v4, workers v1, brain v1, watches v1; connection `jarvis-pi-mcp`).

### Latency through the gateway

| Turn | First text | Total | Input | Cached | Output | DKK |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Cold, new conversation | 3294 ms | 4167 ms | 7532 | 0 | 94 | [money omitted] |
| Warm, turn 2 | 1079 ms | 1413 ms | 7704 | 7529 | 12 | [money omitted] |
| Warm, turn 3 | 1275 ms | 1484 ms | 7795 | 7701 | 12 | [money omitted] |
| Warm, turn 4 | 1150 ms | 1464 ms | 7884 | 7792 | 11 | [money omitted] |
| Tool turn (Jarvis MCP, `list_jobs` ok, 2 tool calls) | 1219 ms | 5406 ms | 24939 | 24291 | 123 | [money omitted] |

```text
First text through the gateway (1 block = 0.5 s)
cold, new conversation |██████▌    3.3 s
warm turn 2            |██▏        1.1 s
warm turn 3            |██▌        1.3 s
warm turn 4            |██▎        1.2 s
tool turn              |██▍        1.2 s
```

Smoke total [money omitted] (list price, cached discount ignored, so DKK is an upper bound). All four checks passed: text streams in pieces, a Jarvis tool ran over MCP with an `ok` result, a cancelled turn stopped and the conversation still worked, a warm turn started faster than the cold one.

What this changes against the plan (section 6):

- Warm first text through the gateway is **1.1 to 1.3 s**, better than the 2 s local-runner figure and the 2.5 s target; cold is 3.3 s, inside the 3.4 to 4.4 s range.
- The fixed prompt is about **7.5k input tokens**, not 11k, and caching works inside the conversation (about 99 percent cached from turn 2).
- A plain turn costs about **[money omitted]**, against the [money omitted] assumed. A tool turn is about [money omitted] (assumed 0.2).
- Not measured here: the iOS network leg, the idle cache lifetime, and p95 (one run, four warm turns).

### Reach servers

The harness listed tools for **no MCP server other than Jarvis**: GitHub was not attached (the GitHub token secret was missing) and the Azure MCP container is not deployed. The reach turns therefore did not run and nothing about GitHub or Azure reach is proven yet.

### Wake-up features on a harness agent

| Feature | Result |
| --- | --- |
| Reminder tool `reminder_preview` | **Not supported** on a harness prompt agent. Foundry rejected the definition with `bad_request`: "Tool type 'reminder_preview' is not supported for an agent with kind 'prompt' and harness type 'github_copilot_preview'". It is documented for hosted agents only |
| Foundry routines (timer) | **Still untested as a waker.** The agent definition failed before a routine could be created, so the run shows only the cleanup step (ok) |

Conclusion: the managed harness has no working self-wake that we can use. Our own ticker and the vault stay the waker; that is what the watches were built on. The probe now only checks a routine on a plain harness agent, as a possible later swap for the timer part. It is not a dependency.

Also seen: the harness reports itself as `github_copilot_preview` (answering the open question in the plan: it is the same harness as `microsoft_copilot_preview`).

# Spike results: managed Copilot-harness agent in Foundry

Spike for [#1851](https://github.com/DanAakesen/jarvis/issues/1851) (P15-158), part of the [Copilot-harness trial](README.md) (#1837). Written 15 Nov 2026.

## Outcome

**The spike was not run. Gate 0 is undecided, not failed.** The session had no Azure access, so the test agent, the Terra deployment and the budget could not be created, and per the owner's instruction nothing was worked around. No model tokens were spent: **[money omitted] of the [money omitted]**. Nothing was created in Azure or GitHub, so there is nothing to delete.

Update 15 Nov 2026: later local runs measured latency, caching and cost on the managed harness; see [Latency rounds](#latency-rounds-on-the-managed-harness-15-nov-2026). They partly answer questions 1, 4 and 5 below; the table keeps the original status text.

What was done instead: the parts that need no Azure access, ready to use.

| Delivered | File |
| --- | --- |
| Inbox triage skill | [spike/SKILL.md](../../harness-trial/spike/SKILL.md) |
| MCP shim design with the identity and header test matrix and the approval test | [spike/mcp-shim-design.md](../../harness-trial/spike/mcp-shim-design.md) |
| 20 prompts in 5 buckets, checks, blind-scoring protocol | [spike/prompts.md](../../harness-trial/spike/prompts.md) |
| Exact steps, spend plan, day plan, exit checklist | [spike/runbook.md](../../harness-trial/spike/runbook.md) |

## What is missing and what Dan must do

| Missing | Detail |
| --- | --- |
| Azure CLI and credentials in the session | No `az`, no `~/.azure`, no `AZURE_*` variables. The sandbox's own identity endpoint was not touched: it is not the Jarvis tenant and nobody approved it |
| Rights to create a deployment and an agent | Needed: a deployment on the AI Services account, an agent in the Foundry project, a role assignment for the agent identity |
| Somewhere to host the shim | A scale-to-zero container app in a throwaway resource group, or a dev tunnel from Dan's PC |

Recommended path ([runbook](../../harness-trial/spike/runbook.md), option 1): Dan runs steps 1 to 6 (deployment with a 50k tokens-per-minute quota, budget, agent, skill, three MCP servers) from a PC with `az login`, then gives the session the agent name, endpoint and shim URL. The session then runs the 20 prompts, the timings and fills this file. About 45 minutes of Dan's time; the model spend stays within the plan below.

## Latency rounds on the managed harness (15 Nov 2026)

The Azure test agent of the runbook was not created by that session. The owner's dispatcher then measured the managed Copilot harness with a **local runner** (Terra in Sweden Central, `gpt-6.1-terra`, streaming). Round 1 about [money omitted], round 2 about [money omitted], **[money omitted] in total** of the [money omitted] cap. Samples are 3 repeats per case, so they show direction, not percentiles. The runner calls the harness directly: gateway and phone network time are **not** included. The runner reports the harness as `github_copilot_preview`; earlier docs say `microsoft_copilot_preview` (to be reconciled in phase 0 of the [PI plan](../../pi/plan.md)).

### Round 1

| Fact | Value |
| --- | --- |
| Terra works with and without reasoning effort | Yes. Effort must be set in the agent definition, not per request |
| Fixed harness prompt | About 11k input tokens per call |
| Cached tokens | Only inside multi-call turns, not across separate turns |
| Cost of a plain turn | About [money omitted] |
| First stream event | 2.3 to 3.3 s |
| First text | About 5 s, text mostly arriving as one chunk |
| Skills | Load through a function call |
| Not yet tested | GitHub MCP, Azure MCP, approvals, long sessions, quality |

### Round 2

| # | Question | Result |
| --- | --- | --- |
| 1 | New conversation | First stream event 2.3 to 3.0 s, first text token 3.4 to 4.4 s (default effort 4.43 s) |
| 1 | Turn 2 and later in the **same** conversation | First event 1.1 s, first text 1.9 s, 11k tokens cached, cheaper |
| 1 | Three separate conversations | No cache (0 cached tokens) |
| 2 | Reasoning effort none or low, set in the agent definition (per request is rejected with a 400) | Real token streaming (18 to 22 deltas) and about 0.7 s faster. Default effort buffers the whole answer as one delta |
| 3 | Prompt size | No effect: cutting input from 11k to 4.6k tokens (all tools disabled) changed nothing. Of the 11k, our instructions are about 10 tokens, about 6.4k is tool definitions, the rest is the fixed harness prompt |
| 4 | Smaller model (`gpt-6-luna`) | No faster |
| 5 | Request options | `service_tier`, `prompt_cache_key` and `max_output_tokens` are rejected for prompt agents (400). A priority header and `stream_options` were accepted and changed nothing. Provisioned throughput untested |
| 6 | Direct model call without the harness | About 1.4 s to first text. The harness adds about 1.2 s startup on a new conversation plus gateway time; model time itself is about 1.3 s |
| 7 | Cost | About [money omitted] per plain turn; later turns in a conversation are cheaper through caching |

```text
First text, local runner (1 block = 0.5 s)
new conversation, slowest case   |█████████  4.4 s
new conversation, fastest case   |██████▉    3.4 s
same conversation, turn 2+       |███▉        1.9 s
direct model, no harness         |██▉         1.4 s
```

What follows: chat on the harness is feasible at about 2 s to first text if the conversation is kept warm and effort is none or low. The owner accepts the 3.5 to 4.4 s first-turn wait when voice starts, so voice turns go through the agent with no separate fast path. Use in the [PI plan, section 6](../../pi/plan.md#6-latency-the-5-second-start).

Open questions for Microsoft: the 1.2 s startup on a new conversation; a supported priority or low-latency option for harness agents (`service_tier` and `prompt_cache_key` are rejected, a priority header changed nothing); idle cache lifetime.

## The seven questions

| # | Question | Answer | Status |
| --- | --- | --- | --- |
| 1 | Does Terra work in the harness? Retest the 6 Nov rejection | Not tested. Prior art: the live 400 (`model_bad_request_reasoning`) was tied in source to a forced reasoning effort of `none` on the Terra branch of the smoke builder, but the provider message and the exact subfield were never captured (`docs/main-chat-harness-migration.md`). Retest the managed agent with effort omitted, `none`, `low` and `medium`, and record the status and the provider's error field | Open |
| 2 | Identity and headers at an MCP call; can a per-turn value pass? | Not tested. Six routes defined: agent identity, user token or OAuth passthrough, static header, turn reference as an argument, per-request metadata, hostile case. See the [shim design](../../harness-trial/spike/mcp-shim-design.md#q2-test-matrix-how-a-per-turn-value-could-reach-the-tool). Expectation, not a result: only routes that arrive without the model's help can prove authority; an argument can be forged by a prompt-injected model | Open |
| 3 | `require_approval` round trip | Not tested. New documentary finding from the Learn excerpt read today: during public preview **the service manages the approval policy for harness tools, and `require_approval` applies only to customer-configured MCP tools**. So approvals cover our MCP servers, not the built-in shell, files and web. That fits the design (writes go through our MCP) but means built-in tools are not gated by us. Per-tool granularity is still unknown | Open |
| 4 | Real tokens, cached tokens, context per call, cost per turn | Not measured. Budget arithmetic below is assumed list price, not a result | Open |
| 5 | Time to first token and streaming vs current chat | Not measured. Protocol: TTFT and total time for all 20 prompts on both stacks; pass is within 1.5 times current, with text before the first tool call streamed | Open |
| 6 | One conversation after 24 h and past its limit; compaction | Not tested. Plan: seed facts, resume the next day, then feed filler in fixed steps until a limit or compaction signal, capped at [money omitted] | Open |
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

No turn was run, so there is **no measured cost**. The table is the budget arithmetic that shaped the stop rules, using the turn shapes from [03-target-architecture.md](03-target-architecture.md#cost) and the assumed Terra list price ([money omitted] input, [money omitted] cached, [money omitted] output per 1M tokens; [money omitted] per USD). All **assumed**.

[Historical cost chart and its values omitted.]

| Shape | Turns that [money omitted] buys |
| --- | --- |
| Low | about 330 |
| Expected | about 100 |
| High | about 16 |

At the high shape the 20 prompts alone would exceed the cap, so the runbook stops the run and reports if the running total passes [money omitted] after 8 prompts.

## Findings that need no Azure access

| Finding | Consequence |
| --- | --- |
| A budget alert does not stop spend | The brake is the deployment's tokens-per-minute quota (50k proposed) and the stop rules. The alert is only a warning |
| The test deployment bills under the same AI Services account as today's chat, so a resource-group budget cannot isolate it | Set the budget to the Terra spend already booked this month plus [money omitted], and count per-deployment tokens from deployment metrics. "Alert at [money omitted]" read literally would not isolate the spike |
| `require_approval` covers customer MCP tools only in preview | Approval design must assume the built-in shell, files and web are not gated by us. Egress controls in audit mode and a Reader-only identity carry that risk |
| Creating a harness agent needs the preview feature header (`MicrosoftCopilot=V1Preview`), and Toolbox or generated files need Foundry User on the project for the agent's own identity | Already in the runbook |
| Reader cannot read cost data | Cost reads stay with Dan or a separate Cost Management Reader grant; the spike does not need it for the agent |

Sources: the Learn page *Use the Microsoft Copilot harness with prompt agents*, read through search excerpts only (the page cannot be fetched from here); `docs/main-chat-harness-migration.md`; `infra/main.bicep`.

## Recommendation for Gate 0

**Hold. Do not pass and do not stop.** Gate 0 requires all seven checks answered, and none is. Nothing learned argues against the design, and nothing supports it yet.

| Decision | When |
| --- | --- |
| Run the spike through the [runbook](../../harness-trial/spike/runbook.md), option 1 | Next step; roughly 45 minutes of Dan's time, at most [money omitted] of models |
| Decide Gate 0 on the measured results | After the day-2 cost read, using the rules in [04-recommendation.md](04-recommendation.md#gates) |
| If Gate 0 fails on Terra, per-turn authority or the 12 of 20 rule | Stop, or try route 2 (Copilot SDK inside a hosted agent) as already planned |
| Do not start phase 1 (Test runtime selector) | Until Gate 0 passes |

## Exit

Nothing was created, so nothing needs deleting. Once the runbook is run, its [exit checklist](../../harness-trial/spike/runbook.md#exit-checklist) removes the agent, the deployment, the shim and the Azure MCP container, role assignments, connection secrets and the budget.
