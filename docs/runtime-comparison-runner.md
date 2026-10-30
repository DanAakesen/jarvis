# Offline two-runtime comparison runner (#1350)

`agents/jarvis/tests/runtime_comparison_runner.py` runs explicit Current and
Copilot factories against the approved `chat_runtime_comparison.json` scenarios.
Its fixture/support files are included in the same candidate. The preparation
commits established isolated synthetic inputs before provider adapters existed.

Each runtime/scenario receives a new `ComparisonFixture` and `FixtureBackend`.
Both get the same synthetic source texts, step IDs, owner decisions, requested
`gpt-6.1-terra` / `high` settings and language. There is no model selection,
credential lookup, environment parsing, live inference or production tool route.
The backend dispatches only the fixture's explicit reads and synthetic no-op;
it verifies the current source ID. Its approval state belongs to that fixture
world. Current source context is set/reset around each actual streamed turn.

The callable is `await compare_runtimes({"current": current_factory, "copilot":
copilot_factory}, case_ids=..., turn_timeout_seconds=30)`. Each factory is an
asynchronous context manager taking `(runtime, fixture_backend, requested_settings)`
and yielding `RuntimeUnderTest(client, evidence_kind, observations)`. The client
implements the existing `StreamingModelClient` contract. The factory owns cleanup
of clients and all injected resources; it must remain fixture-only. The comparator
never calls `from_environment` and supplies no real provider default. Passing a
factory is executable Python authority: use reviewed local factories, not an
untrusted module. No command here requests provider credentials.

Run the actual-loop SDK mock demonstration from the repository root:

```sh
PYTHONPATH=agents/jarvis:agents/jarvis/tests \
python agents/jarvis/tests/runtime_comparison_runner.py \
  --factory-module test_runtime_comparison_runner \
  --output /tmp/jarvis-runtime-comparison-offline-1350.json
```

The CLI requires an
explicit local module exporting `current_factory` and `copilot_factory`, plus an
output destination. It can select individual scenarios using repeated `--case`.
No live factories are included. The demonstration exports factories from the
new test module and requires the existing development dependencies.

Reports record client-observed effective settings separately from requested
settings. A settings mismatch stops before any stream request. Every turn has
actual terminal outcome, retained partial/final text and acknowledgment boundaries.
Runtime/scenario duration is measured locally; it is not a provider benchmark.
Backend usage and optional factory-observed usage retain separate provenance;
missing usage stays null. Billing/currency are null with an explicit reason,
and no prices, cost thresholds, parity scores or automatic language-quality
verdicts are invented. Fixture completion evidence records missing reads and
actual no-op execution counts alongside expected counts. `fixtureChecks` compares
these counts only. `completed` means the stream completed, not that its answer
passed human review. Text review remains pending with the approved criteria.

Interruption and detach/reattach scenarios are `unsupported_control`, with
`executed:false`, no text turns and missing-read evidence retained. The model
streaming interface lacks application steering, background-turn subscriber and
reconnect lifecycle controls. Treating these inputs as ordinary sequential text
would falsely count unexecuted lifecycle behavior. Those cases need the actual
application runtime wrapper before execution; they are not passing comparisons.
External cancellation still propagates and `aclosing` closes an active model
iterator. Ordinary per-turn timeouts close it and produce `timeout`; setup/cleanup
exceptions are distinct from completed streams. Factories own bounded setup and
resource cleanup. Raw exception text is never included in the report.

`test_runtime_comparison_runner.py` drives both actual
`AzureOpenAIResponsesClient` and `ManagedCopilotClient` through installed
`AsyncOpenAI` with `httpx.MockTransport`. These are actual model-loop/protocol
checks with predetermined synthetic provider events, not real reasoning or
provider inference. Tests cover independent worlds, identical selected settings,
source binding, multiple reads, multi-turn conversation, synthetic approval-once
counts, decline, provider failure, timeout and client cleanup. A scripted
settings-mismatch test is explicitly labelled comparator-plumbing evidence.
The mock managed definition verifier asserts the fixture catalogue; it proves
neither deployed definition nor access. Human identity/language/source handling,
real approvals, policy parity, native durability, interruption/reconnect, live
latency/cost and the owner's UI test remain outstanding.

Validation in this worktree:

```sh
PYTHONPATH=agents/jarvis:agents/jarvis/tests \
python -m pytest agents/jarvis/tests/test_runtime_comparison_runner.py -q
ruff check agents/jarvis/tests/runtime_comparison_runner.py agents/jarvis/tests/test_runtime_comparison_runner.py
```
