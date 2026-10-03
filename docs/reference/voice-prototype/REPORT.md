# Report — Jarvis Danish voice prototype

Run 2 October 2026 in `rg-jarvis-voice-poc` (Sweden Central). Goal: [GOAL.md](GOAL.md). Raw evidence: `results\`.

## 1. Summary

**The Danish voice path works for Jarvis.** Voice Live → hosted Jarvis agent → tools → spoken Danish reply ran end to end on the deployed, documented-but-preview voice bridge. With the recommended settings, 20 of 20 Danish commands called the right tool with the right arguments, and 4 of 4 status questions got correct Danish answers.

Recommended configuration:

| Part | Choice | Why |
| --- | --- | --- |
| Speech to text | **MAI Transcribe** (`mai-transcribe`, language `da`) | 0–1.8 % word error rate vs 22–25 % for Azure Speech `da-DK`. It hears English product names inside Danish (Jarvis, Daily, Copilot, dark mode, README, Tailwind) correctly; Azure Speech turns them into "jobes", "delhi", "dog mode". |
| Jarvis model | **`gpt-5.6-luna`**, reasoning effort `none` | As accurate as `gpt-5.4-mini` with the strict prompt and about 4× cheaper (0.003 vs 0.011 DKK per command). |
| Prompt | **Strict action rules** (in `agent/jarvis_tools.py`) | Took both models to 80/80 on the hardest commands; without them the model sometimes asked instead of acting. |
| Voice | `en-US-Harper:MAI-Voice-2`, output locale `da-DK` | Dan's choice from eight sampled voices (Christel, Jeppe, Ava multilingual/HD/HD Omni, Harper and Mia MAI-Voice-2, Seraphina). Microsoft has no Danish MAI-Voice-2 voice; Harper speaks Danish when the locale is locked. Warm latency unchanged. |

Two design points the prototype surfaced:

1. **The model can describe an action it did not take.** Seen in an early run ("Jeg har sagt det til Codex" after creating a new task instead of steering) and in ad-hoc reproductions; not seen in 320 strict-prompt trials. Jarvis should speak confirmations from the backend's tool result, not only from the model's wording.
2. **The first turn of a new call takes about 5 s** (container cold start of the hosted agent); later turns take 2.7–3.9 s from end of speech to first audio. Warm the agent session when the call connects.

## 2. Results

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| V1 | Voice bridge | **Pass** | Voice agent (`kind: voice`) → hosted agent over Bridge Protocol 1.0 (`invocations_ws` 1.0.0) → Danish speech. Connect 2.5 s median. Every test session in `results\` used this path. |
| V2 | Danish speech to text | **Pass** (with MAI Transcribe) | Synthetic Danish speech, two voices (second 10 % faster with background noise), 20 commands each. Table below. `results\voice.json` |
| V3 | Intent accuracy | **Pass** | Direct, same tools and instructions, fresh data per command: `gpt-5.4-mini` 20/20, `gpt-5.6-luna` 20/20, `gpt-5.4` 19/20 (created a task instead of steering). Deployed final configuration (luna, strict prompt, text through the voice agent): **20/20**. `results\intent-direct.json`, `results\intent-deployed.json` |
| V4 | Danish status answers | **Pass** | 4/4 Danish answers matching the fake data, in every configuration. |
| V5 | End-to-end voice | **Pass** | Speech → MAI Transcribe → agent → tool: 18/20 with fresh sessions (`gpt-5.4-mini`, earlier prompt; misses: steer-vs-create model error, "login-side" heard as "loggede side"). Azure Speech `da-DK`: 14/20. Latency below. |
| V6 | Interruption | **Pass** | Speaking 1.5 s into an 18 s reply was detected in 563 ms with 16 s still to play; the follow-up "Stop. Hvad er status på Banking-opgaven?" was answered correctly. `results\interrupt.json` |
| V7 | Cost | **Pass** (estimate; billing check pending) | Section 3. Actual billed meters: run `infra\cost.ps1` after 3 October. |
| V8 | Live test by Dan | **Pending** | Run `client\talk.py` (README). |

Speech to text (V2), word error rate after normalizing spoken numbers:

| Setting | Christel | Jeppe (faster, noise) | Exact transcripts |
| --- | --- | --- | --- |
| **MAI Transcribe, `da`, phrase list** | **1.8 %** | **0 %** | 38/40 |
| Azure Speech `da-DK`, phrase list | 25 % | 23 % | 10/40 |
| Azure Speech `da-DK`, no phrase list | 31 % | — | 4/20 |
| Azure Speech, no language set | 97 % (heard German, French, English) | — | 0/20 |

The phrase list made no measurable difference for Azure Speech. Danish must always be set explicitly.

Latency, end of speech to first reply audio (includes the 700 ms end-of-speech silence):

| Path | Median | p90 |
| --- | --- | --- |
| MAI Transcribe, voice | 2.7–3.3 s | 3.9–4.3 s |
| Azure Speech `da-DK`, voice | 3.1–3.9 s | 4.7 s |
| Text through voice agent, final config | 3.7 s | 4.5 s |
| First turn of a new call (cold start) | 5.0 s | — |

Commands that need a lookup and an action use about 2.3 model rounds (`list_tasks`, then the action, then the answer); each round takes 1–2 s.

Action reliability (5 hardest commands × 8 trials, greeting in history; `results\reliability-*.json`):

| Model | Earlier prompt (effort none / low) | Strict prompt (none / low) |
| --- | --- | --- |
| `gpt-5.4-mini` | 38/40, 39/40 | 40/40, 40/40 |
| `gpt-5.6-luna` | 40/40, 40/40 | 39/40, 40/40 |

## 3. Cost

Measured usage at current Sweden Central list prices (DKK). Voice Live reports no token usage when a hosted agent is the conversation engine, so voice-minute cost uses the "Voice Live BYO" meters and Microsoft's documented audio token rates (≈10 tokens/s in, ≈20 tokens/s out).

| Item | Rate | Basis |
| --- | --- | --- |
| Jarvis model, `gpt-5.6-luna` | 0.003 per command | 1,922 input + 56 output tokens, 2.3 rounds (measured) |
| Jarvis model, `gpt-5.4-mini` | 0.011 per command | same commands |
| Voice input (Dan speaking or listening) | ≈0.05 per minute | BYO standard speech input 0.0822 / 1K tokens |
| Voice output (Jarvis speaking) | ≈0.18 per minute | BYO standard speech output 0.1513 / 1K tokens |
| Hosted agent sandbox | ≈0.89 per hour | 1 vCPU / 2 GiB while a call is open (coding-sandbox prototype rate) |

**Estimate for 30 minutes of voice per day** (whole call billed as input, Jarvis speaking 10 of the 30 minutes, 60 commands): 1.5 + 1.8 + 0.2 + 0.45 ≈ **4 DKK per day, ≈120 DKK per month**. If the standard Voice Live tier applies instead of BYO, about 10 % more. Whether MAI Transcribe adds a separate meter is unconfirmed; `infra\cost.ps1` shows the billed meters once Cost Management has the data. Idle cost of the deployed prototype: container registry ≈1.1 DKK/day.

## 4. Problems and workarounds

| Problem | Fix |
| --- | --- |
| Storage provisioning state `ResolvingDns` treated as failure | Added transient states to the wait loop. |
| Budget dates rejected | `ToString` used the Danish time separator "."; now invariant culture. |
| `az rest` URL with `&` broke on Windows (`az` is a `.cmd`) | Removed the query filter. |
| `requirements.txt` without trailing newline merged two pins | Fixed file; image rebuilt. |
| `FOUNDRY_PROJECT_ENDPOINT` rejected in agent environment | Platform reserves `FOUNDRY_*` and `AGENT_*` and injects the endpoint itself; removed. |
| Tool log empty in Azure | Table SDK sends Python ints as Int32; millisecond timestamps overflow. Large ints now Int64; unit-tested. Added `/diag` to read the tool log's state through the voice path. |
| Tool calls missing in test results | Container and PC clocks differ; rows are now matched as "new since before the command". |
| Intent scores skewed by earlier commands | Each scored command now gets a fresh, warmed session. |
| First interruption check judged the wrong thing | Speech synthesis is faster than real time, so replies are fully generated before Dan interrupts; interruption is the client stopping playback on `speech_started`. Check rewritten to measure detection while audio still plays. |
| Rate limit with parallel tests on one deployment | Lower concurrency and retry with backoff. |
| Live test: "Hosted Agent Bridge ended unexpectedly" | Background speech produced two fragments 0.4 s apart; interrupting the first answer of a freshly started agent ended the preview bridge (reproduced 1 of 4). The console now warms the agent silently before opening the microphone and reconnects automatically; a forced disconnect reconnected in 2.6 s. |
| Teardown and redeploy | Proven: teardown deleted 6 resources and purged the Foundry account; a fresh deploy (new names) succeeded on the first run and passed 24/24. |

## 5. Design impact (applied to `jarvis.md` and `jarvis-flows.html` on 2 October 2026, at Dan's request)

`jarvis.md`:

- Voice: use **MAI Transcribe with Danish set**; never leave the language on automatic. Azure Speech `da-DK` is a fallback only.
- Jarvis agent model: **`gpt-5.6-luna`**, reasoning effort `none`, strict action rules in the instructions.
- New learning: the model can claim an action it did not take; speak confirmations from the backend's tool result.
- New learning: the hosted agent's first turn per call has a ≈5 s cold start; warm the session at connect, for example with a no-model message.
- New learning: a no-model command through the voice path (`/diag` here) is a cheap health check and warm-up for the hosted agent.
- Load context (box 2.2): sending the current task list with each turn would save the `list_tasks` round (≈1–2 s) on most commands.
- Cost snapshot: voice ≈4 DKK per 30-minute day; Jarvis model ≈0.003 DKK per command.

`jarvis-flows.html` box colors:

| Box | Now | Proposed |
| --- | --- | --- |
| 1.3 Speak Danish | Docs | Proven |
| 1.4 Danish speech to text | Docs | Proven (MAI Transcribe) |
| 1.7 Voice quality and cost | Unknown | Proven (quality, latency); cost estimated, billing check pending |
| 1.8 Jarvis agent gets the text | Docs | Proven |
| 2.4 Choose an action | Docs | Proven |
| 2.6 Call a backend function | Docs | Proven with fake tools; real backend auth still assumed |
| 2.7 Danish intent accuracy and cost | Unknown | Proven |
| 6.5 Summarize status in Danish | Unknown | Proven |
| 6.7 Speak the answer | Docs | Proven |

## 6. Speech-to-speech (added after V1–V7)

Three model-backed voice agents use `gpt-realtime`: the model hears the audio and speaks itself, and Jarvis tools run in the console client with the same fake data. Created by `infra\create_realtime_agents.py`.

| Agent | Model | Voice | Smoke test ("Sæt Jarvis-opgaven på pause") |
| --- | --- | --- | --- |
| `jarvis-realtime` | `gpt-realtime-2.1` (Pro) | OpenAI `marin` | `list_tasks` → `pause_task` T-101; first audio 0.45 s |
| `jarvis-realtime-harper` (first tested with Christel) | `gpt-realtime-2.1` (Pro) | Azure `en-US-Harper:MAI-Voice-2`, locale `da-DK` | same tools; first audio 1.1 s; confirmed "Jeg har sat Jarvis-opgaven på pause" |
| `jarvis-realtime-mini` | `gpt-realtime-2.1-mini` (Standard) | OpenAI `marin` | same tools; first audio 0.7 s; confirmed |

Fast first audio comes from a spoken preamble ("Jeg finder lige opgaven …") while tools run. List-price estimate for a 30-minute day: ≈11 DKK (`gpt-realtime-2.1`), ≈3.4 DKK (`-mini`), versus ≈4 DKK for the voice bridge. OpenAI voices cannot speak fixed greeting text, so these agents use a model-generated greeting. Trade-off: in this setup the tools run in the client, so Jarvis would need the backend (not a hosted agent) to own the tool loop. Danish quality is Dan's call in the live test.

## 7. Next steps

1. Dan: live test (V8) with `client\talk.py`, and compare `--agent jarvis-realtime` / `jarvis-realtime-harper` / `jarvis-realtime-mini`; then this report is finalized.
2. After 3 October: run `infra\cost.ps1` to confirm billed meters.
3. Decide whether to keep `rg-jarvis-voice-poc` for further tests or run `infra\teardown.ps1`.
