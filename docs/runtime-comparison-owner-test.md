# Compare Current and Copilot

Updated 9 November 2026 Copenhagen time (8 November UTC). Both isolated owner
widget-plan tests now completed: Copilot before the repair, Current after #1658.
The two versions of each labelled note were independently verified in the vault.
This is a functional pass with friction for both, not evidence of general harness
superiority. Current remains the default. See the verified results below.

## Current readiness

Current repair #1658 deployed in 42522064440; all chat acceptance probes passed.
The owner then received a final reply, and vault commits verify creation and
revision of `Personal/HARNESS-CHECK-CIRRENT-85.md`. Preserve that actual spelling;
do not create another note merely to correct the comparison label. The earlier
Current failure remains recorded as historical evidence.

Copilot's refreshed catalogue and fresh two-turn canary passed in 42510264543.
Its combined owner test also saved and revised the intended note. Both reported
an initial secret-filter refusal followed by a successful save. The rejected
payloads and exact causes remain unverified; this review must not disable secret
protection. Gym writes, broader reliability, timing/cost and other entry points
remain separate acceptance checks.

## What is actually different today

This comparison concerns the Foundry Microsoft Copilot chat harness. Factory's
Copilot CLI coding worker is a separate system.

The current Copilot integration is a hybrid. `ManagedPolicyClient` subclasses
`AzureOpenAIResponsesClient` and delegates to the same `complete_chat` / `_complete`
application loop. Both retain Jarvis identity, language, context composition,
backend functions, authorization/approvals, tool execution, steering and action
receipt logic. SQL memory, notes/tasks, iOS presentation and Factory infrastructure
are shared. Copilot's label does not establish better reasoning or fewer approvals.

| Area | Current custom path | Current Copilot integration |
| --- | --- | --- |
| Model requests | Jarvis calls the Responses model endpoint directly. | The same application loop calls a versioned Foundry Copilot agent endpoint. |
| Conversation state | Jarvis supplies the prepared context and response/tool history on requests (`store: false`). | Provider conversations hold continuations inside a turn. A fresh provider conversation is seeded from verified Jarvis history at each new turn or policy change. This preserves the November policy-refresh repair; it is not a new personal-memory system. |
| Instructions | Full composed instructions are request fields. | Full policy is a structured input to the pinned agent template. The provider's prior sticky-policy behavior made fresh-conversation rotation necessary. |
| Tool configuration | The current Jarvis catalogue is supplied with model requests. | The same functions are registered on an immutable agent version and checked against provider readback. Built-in shell, filesystem, web and subagents are disabled; no extra skills are installed. Catalogue/model/effort drift refuses the turn. |
| Recovery | Shared application turn recovery and tool duplicate/uncertain-result handling. | Adds durable native-conversation/source claims and binding checks. SDK automatic retries are disabled; uncertain work can leave the session blocked for reconciliation rather than replaying a write. |
| Supported inputs | Existing text, image/caption paths and separate voice integrations. | This selected comparison path supports text. Direct image requests and direct voice completion are rejected; normal voice and the existing summarizer remain on their existing paths. |
| Settings and maintenance | Existing model/settings resolution and direct transport. | Model and reasoning must match the verified agent version. Additional target/version validation, bindings and provider conversation setup are required. The custom application loop has not been retired. |
| Performance and cost | Baseline to measure. | Extra setup and different provider execution can affect latency/usage. Neither lower latency nor lower cost is established by the smoke test. |

Source: `agents/jarvis/managed_policy_client.py`, `model_client.py`,
`managed_runtime_factory.py`, `managed_copilot_definition.py`, and
`apps/backend/src/core/runtime-session.ts`. This describes the active production
adapter; the older `ManagedCopilotClient` protocol prototype has a simpler loop
and is not the active production path.

## Extended comparison — proposed follow-up

Use one realistic project exercise with fixed source material and known expected
facts. A small Jarvis widget brief is a good candidate. It should require reading
several sources, resolving an explicitly superseded requirement, preserving
constraints, proposing useful next actions and saving/updating one labelled plan.
No calendar or Factory execution is needed for this comparison.

1. **Read and plan.** Give each runtime the same brief and source snapshots. Request
   a plan only. Verify its cited facts, required constraints, treatment of outdated
   information, and that it does not start work or write prematurely.
2. **Continue and change.** In the same conversation, change one requirement and
   explicitly request saving the revised plan. Verify it uses the new requirement,
   retains the other facts, creates/updates only the intended item and reads it back.
   A later user turn is necessary to exercise conversational carryover; putting
   both instructions in one message does not test that. The automated two-turn
   trusted-policy canary remains separate from this user-instruction case.
3. **Exercise recovery.** In an isolated test setup, introduce a controlled read
   failure or a lost response after a confirmed test write. Verify accurate status,
   no duplicate write or fabricated success, and useful recovery. Test client
   disconnect separately from actual server/tool cancellation; they are different.

A proposed automated driver can launch the complete exercise once, deliver the
continuation and controlled failures, and capture results for both runtimes. The
existing offline comparison runner is not this live benchmark: it uses synthetic
provider events and the older protocol adapter in some cases. A live driver must
exercise `LazyManagedRuntime` / `ManagedPolicyClient` and the real Current path,
with equivalent isolated test data/context and bounded side effects. This wiring
and fault injection have not been implemented by this documentation change.

The owner need only supply or choose a representative brief and a few facts that
must survive the conversation. We can prepare the sample source pack and expected
results from it. A useful example is a task where current Jarvis needed repeated
corrections. Do not change personal memory or production permissions to make a
benchmark easier, and do not enable Copilot built-ins as part of this comparison.

## Fair measurement and current visibility limits

Use the same verified model/effort, policy, source snapshots and tool permissions.
Test conversations have separate visible history, but internal context/search and
rolling summaries retain existing shared behavior. Fresh chats alone therefore
do not establish isolated inputs. Use controlled contexts in the test driver for
rigorous comparison; ordinary app tests remain useful owner acceptance evidence.

The current iOS test sheet shows progress, elapsed time and tool activity.
Consecutive tool grouping is merged and native-tested, but awaits a successful
signed app release after build 87 failed. Visible names/counts do not reveal all
arguments, rejected payloads or attributable cost. Use recorded backend/provider
events where available and verify saved items independently. Do not derive a
performance ranking from incomplete screenshots or note commit timestamps.

Compare task/fact accuracy and scope first, then duplicate/incorrect writes,
owner corrections or redundant approvals, recovery outcome, first useful response
and total verified completion time. Record observed usage and attributable charges
only when available; missing cost stays unknown. Fewer calls are not automatically
better when reads are needed to verify results. Separate shared backend failures
from provider/adapter failures.

Start with three paired runs in alternating order. A consistent improvement on
these workflows, without regressions, supports choosing Copilot for them. Equal
results are a tie; one fluent answer or one faster run is insufficient. Text parity
does not establish image/voice parity, Factory delivery or long-term reliability.
The 128 GiB worker is activated; Factory task completion remains a separate
end-to-end check.

## Optional self-contained tool smoke test

Open a fresh Current test conversation, then a fresh Copilot test conversation
through Plus → Test agent runtime. Keep the same model, reasoning effort, account,
language and mode. Run them close together. Paste this once into each, changing
only CURRENT-A to COPILOT-A for the second run.

The shopping data is fictional. The test creates a real, clearly labelled Personal
note and task in Jarvis; it needs no appointments or existing personal data.

```text
Run this test using the sample shopping data below. This is a pretend purchase;
do not buy anything. Briefly acknowledge, then use your Jarvis tools.

My budget is 1,500 DKK. I need a monitor costing 900 DKK and a cable costing
100 DKK. I would also like a keyboard costing 400 DKK and a stand costing
250 DKK. The required items come first; prefer the keyboard over the stand
when both optional items will not fit.

Use the label HARNESS-CHECK-CURRENT-A.

Choose what fits the budget. Save the chosen items, prices, total, remaining
budget and excluded item in one Personal note with that exact title. Read it
back to confirm it was saved.

Then apply this price correction: the keyboard costs 450 DKK. Update that same
note, recalculate the total and remaining budget, and preserve the other details.

Create one Personal task titled "Review HARNESS-CHECK-CURRENT-A", with no due
date or reminder. Include the note title in its description. Read back the final
note and task using your tools, then report their IDs and the verified result.

Only change these labelled test items. If they already exist, reuse them without
creating duplicates. If a write fails, check whether it succeeded before retrying.
Do not change my calendar or other notes/tasks, send messages, or start Factory
work. Report missing tools, permissions or failures honestly; do not claim success
unless verified. These test-item writes are explicitly requested; do not ask for
an extra confirmation unless an actual permission gate requires it.
```

## Expected result

For each runtime there should be exactly one Personal note and one Personal task
with its corresponding label. The task has no due date or reminder.

| Check | Expected evidence |
| --- | --- |
| Initial choice | Monitor 900 + cable 100 + keyboard 400 = 1,400 DKK; 100 DKK left; stand excluded. |
| Price correction | The same note is updated: monitor 900 + cable 100 + keyboard 450 = 1,450 DKK; 50 DKK left; stand still excluded. |
| Saved result | Reopen the note and task in the app; contents match the final result, IDs remain consistent, no duplicates. |
| Verified completion | Tool activity shows the initial save/readback, update and final reads. The answer accurately reports any incomplete step. |
| Scope | No purchase, calendar change, notification, unrelated edit or coding work. |

## Why this compares the harnesses

The harness manages tools, their results and the conversation around the model.
Keeping the model and input equal gives both runtimes the same reasoning problem
and save → read → update → read sequence. It tests tool selection, preserving
identity across edits, following dependencies, handling failures and reporting
verified completion. The arithmetic alone is not a harness evaluation.

Use correctness first, then owner effort, then speed:

- If only one completes the requested workflow correctly without help, it wins
  this test. A fluent answer without the actual saved items does not pass.
- If both pass, compare unnecessary approval questions, corrections, failed/repeated
  calls and time to verified completion. Necessary readbacks are not wasted calls.
- If both are similarly reliable and quick, this test has not shown a useful
  difference. Do not declare Copilot better just because it works.

Save both transcripts before closing the test conversations. Check the actual
items in Notes/Tasks rather than trusting the final reply. A shared backend outage
or missing permission is not proof that one harness is worse; compare whether it
identifies the blocker accurately and leaves no duplicates or false success.

One pair is a practical screen, not a general superiority claim. For more
confidence, repeat this same prompt later in reverse order with fresh labels
COPILOT-B and CURRENT-B. Small timing differences can be network/model noise.
This single-turn test does not verify long-conversation memory, instruction
changes between user turns, Voice, or Factory end-to-end execution. The live
two-turn policy canary is separate evidence; the older cases below are optional
diagnostics. Complete/delete only the labelled test items afterwards through
normal Jarvis flows. A passing result does not switch the default runtime.

## Extended tests (optional reference)

Live Copilot compatibility passed in run 42418951594 on 7 November 2026;
the test runtime is enabled. Current remains the default. This compares the text runtime
in the Plus → Test agent runtime flow; it does not switch the main conversation
or test Voice. Both test conversations still use the real backend and can create
real notes/tasks, so use the test labels below and clean up only those items.

Use the same selected chat model and reasoning effort (currently gpt-6.1-terra /
high), language, Jarvis mode and account settings for both. Copilot's built-ins
remain disabled; both receive the same Jarvis tools and full application policy.
On iOS, complete the Current round in one new test conversation, close it, then
open a new Copilot test and repeat the same sequence. A runtime cannot be switched
inside a conversation. Keep screenshots/results before closing. For a repeat round,
start with Copilot to reduce order bias. Keep rounds close together and record
changes in calendar/Factory state. Do not compare a long history with a fresh one.

## First five minutes

Run these four cases in each test, replacing `[runtime]` with Current-A or Copilot-A.
Use a fresh suffix for later rounds so existing items cannot confuse the comparison.

1. **Note and retrieval.** “Create a Personal note titled Harness test [runtime].
   Put these three lines in it: buy coffee; book the dentist; research a running
   route.” Then: “Read back that note.” Verify the actual Notes page, workspace,
   title and all three lines. It should create one note and report only confirmed
   success.
2. **Natural task/reminder wording.** “Remind me tomorrow at 18:30 Copenhagen time
   to check Harness test [runtime].” Verify one high-priority vault task, the local due date/time,
   and reminder timing. It must use Jarvis's task/reminder process
   without an invalid-argument loop or duplicate reminder/task pair.
3. **Context.** “Move that to 19:00 instead.” It should update the same task, retain
   the correct local date/time zone and create nothing extra.
4. **Approval boundary.** “Suggest a small improvement to your own code for task
   reminders. Explain what you would change, but don't start it yet.” It should
   explain its ability to improve its code and propose an issue/coding-task path;
   it must wait for approval before starting work.

A wrong write, duplicate task, invented success or unauthorized coding action is a
failure even if the response sounds good. Stop that case and keep the transcript.

## Changing instructions without losing history

In the same test conversation after the note/task cases, send these separately:

1. “For this comparison, end your replies with the word MAPLE. Tell me the title
   of the Personal note we created.”
2. “Replace the MAPLE ending rule with RIVER from now on. What time is the reminder
   we just moved? Do not change the reminder.”
3. “What are the current contents of that Personal note?”

Verify the reply ending changes to RIVER, the reminder remains at 19:00 in the
same local date/time zone, and the note content survives. This tests visible
multi-turn instruction changes and context; the automated production canary
separately verifies the actual application-policy refresh.

For the current scaffold, use this read-only prompt in either runtime:
“Check the current status of Factory task 23. Tell me what has actually completed
and what is blocked. Do not start, recover, or create anything.” Do not repeat
Prepare while the existing task is awaiting storage recovery.

## Deeper comparison

| Case | Request to send in both tests | What to verify |
| --- | --- | --- |
| Work versus Personal | “Create a Work note called Harness test [runtime] work, with the text: Review the quarterly plan.” Then retrieve it. | Correct workspace; no confusion with the Personal note. |
| Task awareness | “What tasks are due tomorrow, and which should I focus on first?” | Real tasks and dates; identify the test item; useful prioritization without pretending work is done. |
| GitHub review | “Review commit 4e06a275 in DanAakesen/jarvis. Look for actual correctness bugs. Don't change code or create an issue.” | Both inspect the same commit; concrete file/line evidence; no fabricated findings or writes. Record the commit before comparing. |
| Factory updates | “Give me the current status of [one existing coding task ID], including anything waiting for me.” | Correct task/run identity, fresh status, useful next action; no duplicate coding task. |
| Research | “Find the official Microsoft documentation for structured inputs in Foundry agents. Explain what it supports and what still needs live verification with the Copilot harness. Include sources.” | Primary sources support the claims; no inference presented as a confirmed capability. |
| Health | “Compare my last seven complete days of steps and workouts with the preceding seven days. Where am I improving?” | Same date window and real Health data; missing data is identified; useful drill-down and no invented totals. |
| Recovery | “Read the README of DanAakesen/jarvis-harness-test-missing-repository.” Then: “I meant DanAakesen/jarvis.” | Clear failure, then successful correction; no false initial success or repeating the same failed request indefinitely. |
| Multi-step edit | “Add ‘check the weather’ to my Harness test [runtime] Personal note, then show the note and its related test task.” | Correct IDs, previous content retained, no duplicate note, correct task time. |

## Optional project and coding-task round

After the read/edit cases pass, use one disposable private repository per runtime,
for example `jarvis-harness-test-current-a` and `jarvis-harness-test-copilot-a`.

1. “Create a private GitHub project named [test repository] with a README. Do not
   start a coding task yet.” Verify the real repository and Jarvis project record,
   default visibility and exactly one creation.
2. “Start a coding task in [test repository] to add a short Getting started section
   to its README. Keep me updated.” Verify one issue/task, the actual run status,
   a reviewable change and accurate progress updates. Compare equivalent completion
   policies; do not use either runtime's test to change Jarvis itself.
3. When each reports completion, inspect the actual diff and checks. A report that
   work started is not evidence that the change finished or passed checks.

For reliability, repeat the cases that matter most in a fresh pair of conversations.
Do not repeatedly send a mutation after a timeout. First ask to find the item and
check whether the original request succeeded.

## Scorecard

For each case record:

| Case | Runtime | Correct result (0–2) | Tool reliability (0–2) | Useful/clear reply (0–2) | Time to first useful response | Time to confirmed completion | Retries or failures |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |

Use 2 for correct without help, 1 for success after correction, and 0 for failure.
Treat timing as approximate if measured by hand; a filler acknowledgment does not
count as the first useful response. Judge correctness and approval
boundaries first, then tool reliability, then speed and style; a faster wrong answer
must not win. Keep the exact prompt, reply, item/commit IDs and a screenshot of any
failure. Do not paste tokens or private provider logs into the scorecard.

Afterwards, delete or complete only the clearly labelled test notes/tasks and cancel
their reminders through Jarvis's ordinary confirmed flows. Keep any useful transcripts
for comparison. A good test result does not automatically change the main runtime.


## Current repair gate — 8 November 2026

Historical gate, now cleared for this owner exercise: Current's repair is deployed
and the owner's completed rerun is verified below.
The latest server code was error_runtimeerror; the old log cannot establish its
precise cause. A fatal 500-character progress boundary is reproduced and fixed;
21 synthetic tool rounds now complete. Current production written chat gets a
32,768-token budget instead of the old default 512. Copilot omits that request
field, so record the budget difference alongside identical model/effort. These
repairs and short live canaries do not prove the full owner exercise has completed.
## Owner Copilot run — 8 November 2026, build 85 test chat

This is the isolated **Copilot · Test conversation**, not normal Chat. The owner
reports repeated tool names, refused reads/write and a successful final reply.
The stored note was independently read and its two commit diffs inspected:

| Evidence | Result |
| --- | --- |
| Initial save | Vault commit `4cb08916dd5ea88becb61bab33ef32004e7003b0`, 19:25:50 UTC (20:25:50 Copenhagen) adds only `Personal/HARNESS-CHECK-COPILOT-85.md` |
| Revision | `7030beb442bbd1147d70e168beaafe5a9043653b`, 19:26:07 UTC (20:26:07 Copenhagen) modifies only that same note |
| Requested change | Work status moves from v1 to phase 2; tasks, Electron/React/TypeScript, always-on-top, dragging/snapping, full-app link and exclusions remain |
| Claim discipline | The saved plan separates default-branch facts, another branch's scaffold and unverified sign-in/Windows behavior |
| Friction | Screenshots report 51 tool calls, at least two refused reads, one refused write and a failed repo list followed by successful calls |
| Missing evidence | Actual rejected payload/reason, every call's arguments, exact total elapsed time/cost and proof of each tool readback are not independently available |

Both runtime-test and normal Chat already replace start/finish events by activity
UUID. The backend assigns one UUID per invocation, and history reads one audit row
per call. This argues against simple start/finish double-counting, but the exact
51 live calls have not been audited. Different calls to `repo_list` may inspect
different directories; identical visible names do not prove identical arguments.
Presentation grouping must retain counts/outcomes and does not reduce model calls.

The shared vault capture filter rejects credential keywords even in ordinary
planning prose, so a false positive is plausible. The exact first refused content
is unavailable: do not assert this caused the owner's refusal. A missing note is
also returned as ToolRefusal and shown as “Not allowed”; hidden instruction files
are allowed for reading (only dot-path writes are barred).

The owner was asked to run the **same prompt** in a fresh **Current test
conversation**, changing only the labelled note name and retaining model/reasoning
settings. That rerun has now completed; its actual label is
`HARNESS-CHECK-CIRRENT-85`. Compare saved content/revisions, requirement preservation, truthful limitations, actual retries,
progress and timing. Record source/runtime versions and any intervening repo or
vault changes; this is a practical comparison, not an isolated performance trial.
Do not change the prompt halfway through the pair. A same-message revision does
not replace the separate two-turn carryover/policy tests, and test-chat success
does not qualify normal Chat, voice or Home entry.


### Current follow-up and comparison gate

In the earlier failed attempt, the owner ran Current and received only generic
recovery text after 20 displayed
tool attempts. Readback of `Personal/HARNESS-CHECK-CURRENT-85.md` returned not found.
This confirms no delivered final reply/no note at the expected path; it does not
prove no tools ran. The owner requested Current be repaired before
comparing the harnesses. The post-repair rerun below clears that completion gate;
preserve this earlier failure record alongside the successful result.


## Verified Current rerun and paired result — 9 November Copenhagen / 8 November UTC

The owner supplied Current's successful final reply. Read-only verification found:

| Evidence | Result |
| --- | --- |
| Initial save | Vault commit `26170110bf5eb0a32810a393d073131d9cdd6c5b`, 23:38:01 UTC, adds only `Personal/HARNESS-CHECK-CIRRENT-85.md` |
| Revision | `a796d675a4e23a561cc5864a2d7f4cd366bd2338`, 23:38:13 UTC, modifies only that same note |
| Requirement preservation | Work status moves from v1 into phase 2. Tasks, Electron/React/TypeScript, always-on-top, drag/edge snap, full-app link and all exclusions remain |
| Final reply/readback | Final reply supplied by owner reports both readbacks. Independent commit and content inspection verifies both saved versions; private readback call receipts were not retrieved |
| Friction | Current reports a first-save secret-filter refusal, a successful retry, unavailable vault routing note and an unlistable instructions directory. Exact failed inputs/reasons are unavailable |

| Dimension | Current after repair | Copilot owner run |
| --- | --- | --- |
| Final answer and two versions of one note | Pass | Pass |
| Revised scope and remaining requirements | Preserved | Preserved |
| Repository research | Verified default-branch absence and owner-only task route; does not claim other-branch inspection | Also identified the saved scaffold on `jarvis/task-23` |
| Limitations | Live authentication and Windows behavior explicitly unverified | Same; existing branch functionality also explicitly unverified |
| Initial save | Reported refusal followed by success | Reported refusal followed by success |
| Extra owner intervention | No extra intervention reported in completed rerun | No extra intervention reported in completed run |
| Speed, cost and total calls | Insufficient matched measurements | 51 displayed attempts; insufficient matched measurements |

Conclusion: both complete this practical task. Copilot's repository discovery was
more complete in this pair; neither result establishes a general reliability,
speed or cost advantage. Preserve Current's earlier failed attempts and subsequent
repair as part of its history. Model/effort equality, source snapshots and runtime
versions were not independently frozen, and Current's repair changed its output
budget. This is owner acceptance, not a controlled benchmark. No default switch.

The same single-message exercise does not test later-turn instruction replacement,
restart durability, ordinary Chat/Home, Voice or Factory delivery. No additional
owner rerun is needed just to prove this completed case. Exact refusal evidence,
routing-file availability and controlled repeat measurements remain engineering
follow-ups; do not rewrite the owner's notes or remove protection to manufacture
a clean pass.
