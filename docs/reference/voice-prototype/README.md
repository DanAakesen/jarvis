# Jarvis Danish voice prototype

Proves the Danish voice path: Voice Live → hosted Jarvis agent (Bridge Protocol 1.0) → fake Jarvis tools → spoken Danish reply. Goal: [GOAL.md](GOAL.md). Results: [REPORT.md](REPORT.md).

## Talk to Jarvis (live test)

Use a headset if you can; without one, add `--half-duplex` so Jarvis does not hear itself (you then cannot interrupt).

```powershell
cd C:\Repo\Jarvis\voice-prototype
.\.venv\Scripts\python.exe client\talk.py
```

Wait for "Forbundet", then speak Danish. The console shows:

- `Du:` what Voice Live heard
- `→ værktøj …` each Jarvis tool call and its arguments
- `· gpt-5.6-luna runde …` each model round with time and tokens
- `Jarvis:` the reply, with milliseconds from when you stopped talking

Press Ctrl+C to stop. The session is saved to `results\live-<time>.json`.

Things to try: "Hvad kører lige nu?", "Start en Codex-opgave på Jarvis: tilføj dark mode", "Sæt Jarvis-opgaven på pause", "Sig til Copilot, at den også skal skrive tests", "Hvordan går det med Banking-opgaven?". Talk over a reply to interrupt it.

The default is `jarvis-voice-mai` (MAI Transcribe, recommended). Others for comparison: `--agent jarvis-voice` (Azure Speech da-DK with phrase list), `jarvis-voice-nophrase` (no phrase list), `jarvis-voice-auto` (no language set; expect nonsense).

The fake data: Jarvis T-101 (Codex, dark mode, running), Daily T-102 (Copilot, login bug, paused), Banking T-103 (Codex, dependencies, done, PR #42). Each new session starts from this data.

### Speech to speech (gpt-realtime)

The realtime model hears and speaks itself; the Jarvis tools run in this console with the same fake data. Tool calls and an estimated cost are printed.

```powershell
.\.venv\Scripts\python.exe client\talk.py --agent jarvis-realtime            # gpt-realtime-2.1, OpenAI voice
.\.venv\Scripts\python.exe client\talk.py --agent jarvis-realtime-harper     # gpt-realtime-2.1, MAI-Voice-2 Harper in Danish
.\.venv\Scripts\python.exe client\talk.py --agent jarvis-realtime-mini       # gpt-realtime-2.1-mini, OpenAI voice
```

Create or update these agents with `.\.venv\Scripts\python.exe infra\create_realtime_agents.py` (also needed after a fresh deploy).

## Setup (once)

```powershell
cd C:\Repo\Jarvis\voice-prototype
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install "azure-ai-projects[voice]>=2.7.0" azure-identity azure-data-tables pyaudio websockets openai requests pytest pytest-asyncio ruff "azure-ai-agentserver-invocations==1.1.0"
```

Python 3.12 x64 is used because PyAudio has wheels for it. The Azure CLI must be signed in to the "Dan Aakesen" subscription; scripts pass the subscription explicitly and never change the CLI default.

## Deploy

```powershell
.\infra\deploy.ps1
```

Creates `rg-jarvis-voice-poc` (Sweden Central): Foundry account and project (fresh timestamped names), model deployments `gpt-5.4-mini`, `gpt-5.6-luna`, `gpt-5.4`, container registry, storage table for the tool log, Application Insights, a 100 DKK monthly budget, the hosted agent `jarvis-voice-target`, and four voice agents. Writes `infra\.deployment-state.json`. Options: `-JarvisModel`, `-ReasoningEffort`, `-SkipImageBuild -ImageTagOverride <tag>`.

## Checks

| Check | Command | Output |
| --- | --- | --- |
| Action reliability (repeated trials) | `.venv\Scripts\python.exe tests\run_reliability.py` | `results\reliability.json` |
| V3, V4 model comparison | `.venv\Scripts\python.exe tests\run_intent.py direct` | `results\intent-direct.json` |
| V3, V4 through the deployed agent | `.venv\Scripts\python.exe tests\run_intent.py deployed` | `results\intent-deployed.json` |
| V1, V2, V5 synthetic Danish speech | `.venv\Scripts\python.exe tests\run_voice.py` | `results\voice.json` |
| V6 interruption | `.venv\Scripts\python.exe tests\run_interrupt.py` | `results\interrupt.json` |
| Unit tests | `cd agent; ..\.venv\Scripts\python.exe -m pytest -q` and `cd tests; ..\.venv\Scripts\python.exe -m pytest -q test_scoring.py` | |

Set `$env:PYTHONIOENCODING = "utf-8"` first so Danish letters print correctly. Actual billed cost per meter: `.\infra\cost.ps1` (works after teardown; billing lags 8–24 hours).

## Tear down

```powershell
.\infra\teardown.ps1
```

Deletes the resource group, purges the soft-deleted Foundry account, verifies nothing remains, and removes the local state and audio cache. `results\` is kept.
