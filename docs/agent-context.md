## Managed policy cause diagnostics (#1373; 30 October 2026)

Use the existing hosted pytest/Ruff environment. Focused checks:
`tests/test_managed_provider_cause.py`, `tests/test_managed_runtime_lifecycle.py`
and `tests/test_chat_runtime.py`; backend managed-provider-cause, chat-agent,
conversation, logging, chat-canary and system-status tests; contracts tests;
web conversation-history tests. Run affected workspace lint/build checks.

The HTTP-400 fixture's `instructions` parameter is synthetic, not a diagnosis.
This environment could not establish the live rejected field or a successful
Copilot test-chat turn. Preserve request shape, consumed-source and unknown-outcome
claim behavior until a new sanitized provider cause supplies evidence. Never
include provider messages or raw responses in diagnostics.

## Managed Copilot target persistence (#1350; 30 October 2026)

Ordinary Bicep deployment carries forward only the existing backend's complete,
validated Copilot agent name/version/fingerprint tuple. Missing values remain
absent; partial or invalid tuples fail before deployment. Focused offline checks:
`.github/scripts/tests/test_deploy_vault_mirror.py`,
`bash -n .github/scripts/deploy_bicep.sh`, and
`bicep build infra/main.bicep --stdout`.
The 30 October main deployment ran no infra/backend/agent update, and its normal
chat canary failed with the generic `acceptance_check_failed`; it did not capture
a managed Copilot `providerCause`. No successful original-path Copilot turn is
established. Do not change `_create_response` based on a synthetic rejection or
infer that the generic current-chat canary diagnosed the Copilot request.

## Managed conversation failure repair (#1350; 29 October 2026)

Use the production lazy wrapper with stateful synthetic claims in
`agents/jarvis/tests/test_managed_runtime_lifecycle.py`. A known setup failure may
finish its source as failed only before any inference attempt and with no backend
tool call; cancellation, unknown inference and possible actions retain the claim.
Do not reset an existing uncertain claim or replay a consumed source. Preserve
exact finite managed codes through hosted error SSE, backend SSE and the test UI.
Run hosted pytest/Ruff, backend conversation/status checks and lint/build, and
web stream/test-conversation checks and lint/build. Fixtures cannot establish the
first live failure cause; no live logs or owner request replay is available here.

Also run the complete `.github/scripts/tests` unittest suite: the release smoke
formatter must retain exactly the backend's fixed hosted-origin codes. Preserve
the exact-parity assertion and redaction of unknown managed-looking codes.
The correction passes all 203 script tests and 185 scoped hosted/wrapper tests.
Local script tests require PowerShell; temporary PowerShell 7.5.4 with writable
XDG cache/config/data directories satisfies that existing dependency. The two
smoke files retain the same five pre-existing Ruff findings as the prior head.

## Managed canary diagnostics (#1350; 29 October 2026)

Manual Deploy 40884299864 passed provisioning/configuration/readiness but failed
the canary assertion. Its exact reason was discarded; retained artifacts contain
normal acceptance, release plan and receipt only. Preserve private responses;
emit only existing allowlisted reason/stage, bounded HTTP status and model/effort
constants. The known fallback stage is `managed_text_canary`; runtime code is
unchanged. Run handoff/provisioning/deploy-plan tests, Ruff, compilation and shell syntax.
No new grants, fallback, reset, resource or retry belongs in this correction.
The availability guard checks metadata, not canary success; do not claim that
selectability proves working inference. No live availability request was made.

## Managed identity readback failure (#1350; 29 October 2026)

Manual Deploy 40877005757 failed at `agent_identity_unverified` after an active
comparison version was verified; backend activation and canary did not run.
Microsoft documents identity status as optional. Preserve enabled effective
state, UUID principal, exact existing version/definition and post-pin principal
checks while accepting unset status. Keep explicit disabled/unknown states
blocked. No actual missing permission or exact failed field is proven. Do not
create another resource/version or add grants. Run provisioning/handoff tests,
scoped Ruff/compilation and exact-head CI before reviewed release and handoff.

## Runtime comparison preparation (#1350; 29 October 2026)

Use the existing pinned dependencies; the protocol adapter adds no production
package. Hosted checks cover managed protocol/definition, source routing and
retained voice. Backend checks cover runtime session/store/migration and routes;
web checks cover selector/client/scoped conversation/menu/Modal and unchanged
normal chat. The repeatable synthetic browser check is
`scripts/check-runtime-test-browser.mjs`; its output is under
`docs/ui/screenshots/runtime-test-1350/`. These are offline checks, not live parity.
SQL integration requires the existing isolated database harness; no live migration
was applied in this preparation. Do not enable the managed option from local
configuration alone. See [remaining gates](managed-chat-adapter.md).

The comparison handoff is an explicit main-only manual Deploy dispatch with
`provision_managed_chat=true`, after exact-head qualification. Normal pushes do
not create the comparison agent. See [provisioning steps](managed-chat-provisioning.md).
No new Azure login or credentials are needed. A real permission rejection must be
reported by operation/current identity/scope before proposing a missing grant.
The fixed manifest operation exports only static instructions/current schemas;
it does not read personal context or invoke a tool. The canary has the same
210-second invocation ceiling as the existing chat bridge and never executes
functions. SQL qualification remains blocked locally by a Forbidden image pull;
do not substitute a different image. Database CI subsequently applied the committed
migrations and passed all four new runtime integration cases. After the three
stale schema-inventory assertions were corrected, CI 40864485219 passed Database
and Web. Backend failed only two lifecycle fixture teardown hooks: Node 22.23.3
left an unrequested fetch replacement socket after abort. The fixture now closes
its connections during teardown, with all lifecycle assertions unchanged; all
four cases pass locally on that exact Node version. Full CI requalification is
still pending.

## Whole-Jarvis log preparation (#1341; 29 October 2026)

Owner-confirmed whole-system scope replaces backend-only: retain Foundry Reader,
exclude unrelated projects, preserve redaction/bounds and keep the reader disabled
until expanded access is specifically approved and proven. Do not remove the role
or apply the earlier backend-only grant as though it authorized whole-system reads.
See [inventory/design/grant proposal](jarvis-logs.md). Issue #1341 remains canonical.
After the initial denial, the owner specifically approved its scope update and
inventory/design PR publication, test disclosures, readiness and integration after
checks. The one authorized issue-update retry succeeded. Parent owns readiness
and merge. Keep new grants and reader activation outside that publication step.

Local metadata preparation reads only existing-authorized ARM resource/table lists.
Exact canonical ID plus ownership tag is required; table plan/_ResourceId metadata
is not proof of routed data or enforcement. Keep the catalogue private, fixed
public labels, and all negative/unavailable states honest. Runtime source adapters,
capability replacement, grant execution and live qualification are still pending.
Run Python backend-log and pipeline tests, scoped Ruff/byte compilation and diff
checks. No actual log data, credentials or private identifiers enter GitHub.

## Smoke/normal settings parity (#1350; 29 October 2026)

The owner explicitly requires the same role settings in tests. Use the selected
model, reasoning and configured output budget; keep unsupported settings visible
rather than substituting another value. Run hosted tests/Ruff/compileall and
research-smoke/foundry-model tests plus backend lint. Local results: 1,025 hosted
and 56 backend tests passed. These do not prove the server's stored settings,
provider acceptance or ordinary-chat failure. Saved settings stay unchanged;
the owner approved publication with #1353, followed by normal checks/review. See
[local report](smoke-settings-1350.md).

## Reasoning and research smoke checks (#1350; 29 October 2026)

The real Deploy 40840605441 reports model_bad_request_reasoning in all required
chat scenarios; it does not prove none unsupported. Microsoft's Terra announcement
and OpenAI's model contract explicitly support none. Keep settings and model
requests intact until actual rejection detail identifies a correction. Run hosted
pytest/Ruff/compileall, backend research-smoke/web-research/system-status/chat-agent/
chat-canary/status tests plus lint/build, and Python test_smoke_reasons.py. Fixtures
must cover unknown/malformed provider metadata, independent runner HTTP/auth/
timeout/quota/result cases, cleanup, retained/HTTP reports and raw-detail redaction.
No real worker or subscription/API operation belongs in those tests. Preserve
current main's #1352 log-probe changes and separate authorization boundaries.

Local follow-up: 1,019 hosted tests, hosted Ruff/compileall, 349 focused backend
tests, full backend 6,902 passed/one skipped, backend lint/build and 13 sanitizer
tests pass. Node 24/npm 11 local evidence does not replace pinned Node 22/npm 10
qualification. No live correction or new provider operation is claimed.

## Foundry resource-log diagnosis (#1341; 29 October 2026)

Deploy #40836577365 is terminal: rollout/readiness passed and live acceptance
failed. Backend identity matched; console/other-app/other-table returned 403,
Foundry returned 400, and the real foreign control is absent. The reader is off.
This scoped follow-up uses fixed `AzureDiagnostics` aggregates and
`Prefer: include-permissions=true` only for the existing Foundry resource query.
It classifies bounded permission metadata privately and emits only fixed states,
separate from query status. None is an activation or isolation eligibility flag.

The metadata-only preflight verifies the Foundry ID from existing backend
configuration and reads `assignedTo` inventories at workspace, Foundry and
subscription scope using API 2022-04-01. ARM includes transitive group assignments;
no directory credential or permission is needed. Consume every page within the
existing budget or mark the scope unavailable/incomplete. Preserve all conditions
only in the existing private report. Do not change roles, workspace mode, reader
availability or the documented real-foreign-control requirement. Run focused
probe/reader/status/auth/config tests, backend lint/build and Python log/script
checks. All fixtures stay synthetic. Parent owns review/merge and live results;
the separate migration task owns chat BadRequest investigation.

## Main chat baseline checks (#1350; 29 October 2026)

Use the engineering skill. Run hosted-agent pytest/Ruff/compileall, backend
system-status and chat-agent/canary checks, and Python test_smoke_reasons.py.
Fixtures must contain synthetic SDK errors and prove raw messages, codes, nested
property names and URLs never reach the failure stream/log or retained smoke
artifact. No live request, login, grant, worker or model switch is part of local
validation. The new failure codes diagnose a rejected field, not its root cause.
Preserve #1341/#1349 log observations and their separate authorization gates.
See [migration notes and manual test questions](main-chat-harness-migration.md).

## Backend-log authorization observations (#1341; 29 October 2026)

Deploy #40828872899 is terminal: metadata/infrastructure/backend/web/agent/readiness
passed, live acceptance failed. Logs remain disabled. The preflight's resource
log-grant warning and missing foreign workspace control are unresolved.
The next reviewed stage adds fixed aggregate observations to the existing smoke
route using the actual backend credential; no new endpoint/auth allowance/grant.
Private preflight data is consumed in that same infrastructure job, never uploaded.
`backend_log_probe_parameters.py` validates freshness/ownership/shape; its private
Bicep parameter file is deleted on script exit. `backend_log_probe_verdicts.py`
emits only fixed values from the optional smoke object. Do not treat its
`authorization_observations` stage or empty/allowed negative queries as proof.
Missing foreign controls stay `not_configured`; no fake workspace is substituted.
After an empty resource-group inventory, metadata discovery may list workspaces
already visible to the same deploy identity in the existing subscription. A failed
read remains unavailable; do not request new permission to make the inventory work.
The probe caches once per process; grant changes require a fresh backend process
and post-change proof before enabling the separate reader flag.
Run focused authorization/reader/status/auth/config tests, Python backend-log and
deployment-script tests, backend lint/build, Ruff/byte compilation and offline
Bicep compilation. All fixtures must be synthetic. Preserve the existing approved
scope, actual negative controls, grant readback and no-private-ID publication.
Do not retry the denied PR-body metadata writes.

## Backend log preflight ARM wire contract (#1341; 28 October 2026)

29 October: reconcile #1348 with main `10d6d170` without altering #1345 runtime,
migration, UI or artifact blobs. Retain both documentation prefixes and requalify
the resulting head through normal synchronize CI. Readiness/merge are owner
approved; the parent integrates. No Azure grant or activation is applied here.

Deploy #40761349594 failed closed before Bicep at `builtin_role_mismatch`.
The `az rest` role-definition response uses `properties.type`, not the CLI
model's `roleType`. Keep the exact built-in permission allowlist and reject
custom/CLI-only shapes. Run `PYTHONPATH=.github/scripts python -m unittest
discover -s .github/scripts/tests -p test_backend_log_preflight.py`, scoped Ruff
and byte compilation. Fifteen synthetic tests pass for the correction; no live
rerun, grant or enablement is claimed. Existing Azure scope approval persists.

## Current-main reconciliation for #1345 (28 October 2026)

Main `61d19366` adds #1346 log preflight/guidance; merge it into review-fix
head `2f039761` while preserving both scopes. Only PLAN, PRODUCT, agent-context,
architecture and decisions prepend conflicts overlap; retain both sets of text.
Non-overlapping implementation/test/workflow/artifact blobs are verified unchanged
from their respective parent; only documentation is combined/annotated.
Run combined synthetic log/settings/capability and factory/Gmail regressions,
the 14 Python preflight fixtures, backend lint/build and exact-head hosted CI.
No live preflight/Azure access or PR-body metadata retry belongs to this task.
Local combined results: 388 backend and 14 Python preflight tests, backend
lint/build passed. Exact-head hosted qualification is still required.

## Owner-approved log activation preflight and awareness (#1341; 28 October 2026)

Owner approval for persistent backend-only log reads plus basic workspace metadata
is received; do not ask again for this scope or a new Azure sign-in. Existing
qualified main-only OIDC is the execution route. This follow-up first installs a
fixed read-only metadata preflight before infrastructure deployment, with no role
assignment or reader enablement. Preserve the no-private-identifier publication
boundary and never upload `backend-log-preflight.private.json`.

Run Python `test_backend_log_preflight.py`, pipeline/deploy tests, Ruff and byte
compilation; backend settings/capability/registry/production-module/log-reader
suites plus lint/build. Fixtures are synthetic. No local test establishes live
Azure grants, group membership, supported conditional access or negative data
isolation. After review and normal release, inspect only content-free preflight
verdicts and continue the approved assignment/probe/activation work. Stop if live
identity/schema differs, broader access is unresolved or foreign workspace proof
is unavailable; never widen permissions or switch modes as a workaround.

## Eight review fixes: validation (#1343; 28 October 2026)

Scope: issue-label replay, issue conversation origin, atomic completion receipts,
honest Gmail receipts/uncertainty, chat warning/queue reload recovery, sticky
mobile Settings Save, visible oversized-start failure, explicit Settings approvals.
The owner expressly replaced Settings draft preservation: do not add guards,
autosave or draft persistence. Azure logs #1341/#1342 and optional audit ideas
remain separate.

Use synthetic fixtures only. Run full backend/web tests, contracts and backend/web
lint/build. Migration 0068 and transaction/concurrency regressions additionally
require the normal isolated SQL Server CI job; local unit mocks are not proof of
SQL behavior. Chromium screenshots live under `docs/ui/screenshots/fix-eight-1343/`;
390/320px and a focused short viewport are simulated, not physical iPhone acceptance.
No Azure access, real workers, mail sends, notifications or health writes are part
of these checks. Local verification results are recorded in
[PR #1345](https://github.com/DanAakesen/jarvis/pull/1345) and the
[validation report](review-fixes-1343.md).

Local results: full web 2,447, contracts 174, final ConversationHistory 126 and
backend/web lint/build passed. Backend aggregate: 6,776 passed, two failed, one
skipped; the stale Settings approval assertion was corrected and both affected
suites passed a 16-test rerun with original timeouts. Preserve that aggregate
failure distinction. The coordinator subsequently marked the PR ready. Hosted
SQL run 40756774334 had 281 passes and two test-setup failures, corrected by
including the issue-delivery index in its catalog query and unwinding newer
migrations again before the second Workspaces rollback. Preserve every index,
round-trip and latest-only assertion. New-head hosted qualification is required.

CI 40757610202 passed on `5cf8da23`: SQL 283, backend 6,778/one skipped, web
2,448 and contracts 174. The next recovery hardening fixes the confirmed bot
finding at discussion_r4405317215. Run conversation-recovery and
ConversationHistory tests, web lint/build and new-head hosted CI. Boundaries cover
100,000/100,001 ASCII characters, exact 512 KiB ASCII and multibyte replies,
invalid warning isolation and snapshot-budget compaction that retains queued
messages and uncertainty warnings. No PR-body metadata retry is authorized.

## Backend log reader checks (#1341; P11-42; 28 October 2026)

Follow-up review found that rejected Content-Length cleanup could await a
transport cancellation forever and retain the single-query gate. Cleanup is now
nonblocking, consistent with the streamed-body path. Two synthetic regressions
use invalid/oversized lengths and never-resolving cancellation, then prove another
query enters the provider. All 44 reader tests and backend lint/build pass.
The original head's qualification is superseded;
normal exact-head hosted checks are required for this correction. No permission
or activation change is included.

Use the engineering skill. Run backend `operations/backend-logs.test.ts`, signed
`auth/auth.test.ts`, registry, production-module, config, logging/source and shared
capability-budget suites, then backend tests/lint/build and normal hosted checks.
All records must be synthetic. Configuration stays off; no new log role,
assignment, access-mode, retention, ingestion or credential change is part of this
PR. [Backend logs](backend-logs.md) contains the exact conditional-grant proposal
and action-time owner approval/live isolation gates. Do not infer Azure proof
from local fixtures or widen workspace access when a query fails.

Local results: seven focused suites/262 tests, final reader/instruction rerun/59,
backend lint/build and hosted agent 930 tests/Ruff/byte compilation pass. The full
backend aggregate has 6,760 passed, one failed, one skipped: workspace session
language `en` acknowledgement timed out and passes its isolated single-worker
rerun under original limits. No timeout/check was weakened. Repository script
checks: 141 passed, three cannot launch missing `pwsh`. Node 24.19.0/npm 11.9.0
were available locally; normal hosted Node 22 qualification is pending while the
PR remains draft. Frozen dependency installation used public versions with the
same integrity pins after a configured mirror 403; lockfile bytes are restored.

## Terra main-chat preparation checks (#1337; 27 October 2026)

Run backend model-catalog, settings, model-tools, settings-tools and
agent-contract tests, backend lint/build, hosted-agent tests/Ruff/byte compilation,
and Bicep v0.44.1 offline build/lint. Terra has a required `terraChatCapacity`
parameter, now supplied as 150 in committed `main.parameters.json`, matching the
established chat allocation. PR CI remains offline; the normal main-only
Deploy/OIDC path validates live Azure acceptance. No new sign-in is needed to
prepare this request, and available quota is not claimed. Stop/report any Azure
quota/capacity rejection without silently changing allocations or access.
After the normal release, inspect and
update only the saved chat model through Settings. Do not interpret the code
default as the owner's active model. No Azure login, paid inference or live
settings mutation belongs in this preparation.

Local results on Node 24.19.0/npm 11.9.0: focused backend 219 passed, full backend
300 files/6,718 passed/one skipped; hosted agent 930 passed plus Ruff/byte
compilation. Backend ESLint/TypeScript and standalone Bicep v0.44.1 build/lint
pass. Compiled baseline comparison changes only the new Terra resource/required
parameter and the following decision deployment's ordering dependency. Repository
script checks: 141 passed; three cannot launch missing `pwsh`. The public npm
mirror substitution used the same integrity-pinned tarballs and restored the
lockfile byte-for-byte. Draft #1338 is not hosted qualification; independent
review, Node 22 CI, Azure acceptance and saved owner selection remain
pending. No live/cost verification is implied by the synthetic tests.
Microsoft's public Global Standard list rates are now sourced in `infra/README.md`;
account rates, Azure context-tier billing rules and actual quota/capacity remain
unverified. Dan approved USD 20/month, accepted existing alerts and declined a
new spending guard. No new runtime price/budget implementation or login handoff
is required. Keep review/qualification and main-only deployment controls intact.
28 October continuation: the updated saved-default regression asserts the stored
model key, owner Settings readback and new agent Settings readback while retaining
reasoning/other settings. All five focused suites pass 220 tests, plus backend
lint/build and updated Bicep v0.44.1 build/lint. Existing runtime/agent code stays
unchanged; full backend/hosted-agent results above are retained prior evidence.

## Deadline notification checks (#1335; 27 October 2026)

Run backend `proactive/detect.test.ts`, `proactive/deadline-notifications.test.ts`,
`proactive/alerts.test.ts`, `proactive/push-delivery.test.ts` and
`push/webpush.test.ts` (124 tests passed locally). Pipeline fixtures cover single
and bundled Danish/English alerts, existing generic records, distinct deadlines
with identical task names, actual Web Push encryption and private-text exclusion.
Also run workspace tests, lint/build and the existing repository/Python checks.

This executor uses Node 24.19.0/npm 11.9.0 and Python 3.12.14. The frozen npm
install encountered mirror HTTP 403; installing the same integrity-pinned public
npm tarballs with temporary resolved-URL substitution succeeded. The committed
lockfile was restored byte-for-byte. Workspace lint/build and Python component
checks pass. Full web (2,441) and contracts (174) tests pass. Initial backend:
6,701 passed, 10 failed, one skipped; vault mirror: 232 passed, five failed.
All 15 failures pass targeted single-worker reruns (15 backend matching cases,
five vault cases), with original timeout limits. The aggregate run itself failed;
retain that distinction. Python components pass 374 runner and 929 agent tests.
Three repository script checks need missing `pwsh`; the other 141 pass. Hosted
qualification and physical iPhone appearance remain unverified.

## Compact screen Stop checks (#1333; 27 October 2026)

Run ConversationHistory (compact screen-share Stop control), screen-context and
VoiceControls suites, then full web, lint and build. The Stop button carries
`data-preserve-typing-focus`; it relies on the mobile focus guard from #1331 for
the phone mouse-down behavior. No physical-device check is implied.

## Mobile composer focus checks (#1315; 27 October 2026)

Run ConversationHistory, ConversationMoreMenu, phone-chat-viewport and
send-diagnostic suites, full web, lint/build. Owner-sequence replay and native
Chromium checks/limits are in `docs/ui/screenshots/composer-control-focus/README.md`.
Form toolbar buttons may opt in with `data-preserve-typing-focus`; no global touch
suppression. Keep diagnostic privacy and independent screen-share UI scope.

## Passive Send diagnostic checks (local)

Run send-diagnostic, ConversationHistory and phone-chat-viewport tests plus web
lint/build. Data allowlist, memory bound, lifecycle and explicit copy retrieval
are documented in `docs/ui/screenshots/send-diagnostic/README.md`. No publication.

## Unified camera delivery checks (#1317; 26 October 2026)

## Whole-number meal estimate lists (#1327; 26 October 2026)

Display kcal and all nutrient grams rounded to whole numbers in one canonical
meal-estimate list. Retain protein, calories, fat, carbohydrates and fiber; keep
unknown distinct from zero. Calculations, stored values, approval fingerprints
and idempotency retain full precision. Chat and voice consolidate existing
nutrition bullets using server presentation; acknowledgment-only replies still
receive the complete list. Validate with synthetic fractional nutrition fixtures.


The 14:21–14:22 UTC approval supersedes older idle-expiry checks below: active
video must survive silence beyond ten minutes, while preview Close, workspace
start/stop, teardown, permission loss, fatal errors and budgets remain enforced.

Run `npm test`, `npm run lint`, `npm run build` and
`bash .github/scripts/python-ci.sh agents/jarvis`. Focused coverage is in
web `vision-watch.test.tsx`, `camera-capture.test.tsx`, backend `vision/` and
`core/capability-instructions.test.ts`. Actual-App synthetic browser checks
cover repeated silent frames and camera stop at 320/390px touch and 1440px desktop;
see `docs/ui/screenshots/1317/README.md`. No physical-iPhone acceptance claimed.

# Agent context

## Bubble frost checks (#1324; 26 October 2026)

Run web tests, lint/build and aggregate repository checks. Actual-App synthetic
browser reproduction and limitations are in `docs/ui/screenshots/chat-bubble-frost/`.
Check actual scene blur, translucency, item-mask fade versus baseline, lists,
scrolling, header and Plus menu across desktop/mobile and both themes. Run
`fixtures/performance-corners.py` for observer replacement, long-history scrolling
and repeated mobile history-toggle corner checks; desktop borders stay unchanged.
Keep backdrop-filter and masks off bubble ancestors; preserve the visible fade
through the item masks. No real data or private screenshots belong in fixtures.


## Mobile chat scroll verification (26 October 2026; local)

Run the phone viewport and ConversationHistory tests, web lint and web build.
`docs/ui/screenshots/mobile-chat-scroll/README.md` records the actual-component
Chromium swipe comparison, continued typing and one-tap Send. Keyboard geometry
is simulated; physical Safari remains unverified. No camera/menu changes.
## Health meal estimate checks (#1321; 26 October 2026)

Run backend daily, conversation, owner-interaction, realtime/relay/startup, registry,
parity and production-module suites; web ReviewSummary, ConversationHistory,
AttentionPopover and ToolCallChip suites; hosted-agent model-client/tool tests;
backend/web build and lint. Use synthetic food only. Browser component fixtures and
limits are in `docs/ui/screenshots/1321/README.md`. Hold integration pending parent camera/release coordination; #1320 is included via main `1c1029a3`.

## Composer Plus checks (#1319; 26 October 2026)

Run contracts/web lint, tests and build plus the selected shared Python checks.
The actual-App dense-text browser fixture and reproduction are in
`docs/ui/screenshots/1319/README.md`. Check dark/light mobile/desktop, popup
readability, top-to-bottom keyboard order, repeated Plus toggle, Language,
native attachment chooser anchoring/cancellation and the separate Dictate icon.
Physical iPhone acceptance remains separate. Integrated main #1316; the revised
queue places this fix before camera #1318. Do not import its unmerged changes.

## Mobile Send focus checks (#1315; 26 October 2026)

Run the ConversationHistory and phone-chat-viewport suites for focused coverage;
full web tests, web lint and web build also pass locally. The actual-component
Chromium touch reproduction, event traces, screenshot and instructions are in
`docs/ui/screenshots/1315/README.md`. It controls keyboard viewport geometry and
intercepts every external request with synthetic responses. Physical iPhone
keyboard behavior remains unverified; the combined baseline is 6ec8af1e and
final hosted qualification/merge remain parent-owned.


## Desktop composer checks (#1309; 26 October 2026)

Run contracts/web lint, tests and build. Actual-App synthetic Chromium coverage
and reproduction are in `docs/ui/screenshots/1309/README.md`. It checks desktop
window geometry, popup hit targets, dictation controls, attachment/error rows and
phone regression. Preserve the continuous dictation lifecycle from #1305 and the
attachment submenu from #1308 when integrating; #1303 visibility stays phone-only.

## Continuous dictation checks (#1305; 26 October 2026)

Run `npm test --workspace @jarvis/web`, web lint and web build. Focused regression
coverage is in `ConversationHistory.test.tsx`; the actual-App simulated speech
browser check and reproduction steps are in `docs/ui/screenshots/1305/README.md`.
Check interim replacements, final replay, pause/end and no-speech restart,
explicit stop, repeated toggles, draft editing, stale callbacks and fatal errors.
These checks do not establish physical iPhone or real speech-provider acceptance.

## Accepted chat recovery checks (#1311; 26 October 2026)

After integration onto `5dd52b07`, local aggregate lint/build, 9,487 JavaScript
tests (one existing conditional skip) and 929 Python tests passed. Hosted Node 22
exposed four fixture teardown timeouts after successful disconnect assertions;
the same failure reproduced locally on Node 22. The HTTP fixture now closes its
owned connections in `preClose`, after assertions, without changing production
shutdown or increasing timeouts. All 221 focused backend tests passed on Node 22
with that correction. Hosted SQL database contracts passed; final pinned CI is
tracked on PR #1314.

Review correction: retain Dan's P8-35 no-Stop-button choice. The explicit
cancellation endpoint/client mechanism remains; no new visible cancellation control
is introduced. Added signed-token coverage in `src/auth/auth.test.ts` verifies
401 for missing credentials and 403 for non-owner, hosted-agent, runner and deploy
principals on discovery, replay and cancellation. Owner positive controls prove
route registration. Conversation tests reject mismatched-session replay/cancel
without aborting the original turn, and assert unchanged original message/turn IDs.
The follow-up passed 221 selected backend tests and 252 selected web tests;
Chromium rechecked reload, navigation, absence of Stop and explicit cancellation
through the client API at 390×844 and 1440×900. This is author review evidence,
not an independent reviewer trace or hosted exact-head CI.

Run focused backend `src/core/recoverable-chat.test.ts`, `src/core/conversation.test.ts`,
`src/core/owner-interactions.test.ts`, `src/daily/tools/food-review.test.ts` and
`src/daily/tools/food.test.ts`; web `src/conversation-history.test.ts` and
`src/ConversationHistory.test.tsx`. Aggregate checks are `npm test`, `npm run lint`,
`npm run build`, plus `bash .github/scripts/python-ci.sh agents/jarvis`.
Use synthetic meals only. Replay is process-local under the existing single replica;
completed replies use SQL history. Restart interrupts pending work and must never
resubmit it. Keep deployment/restart limitations distinct from disconnect tests.

Synthetic coverage includes disconnect while the model is running, while an exact
food proposal is pending, and after an approved action commits but before its
final response is emitted. Replaying that result twice asserts one agent execution
and one action write. Expiry and explicit cancellation assert zero writes; existing
food-tool tests cover source/proposal fingerprints, presence and committed receipts.
The Chromium App fixture at 390×844 and 1440×900 recovered the exact proposal on
reload and retained execution through ordinary navigation without adding a Stop
control or another turn POST. Explicit cancellation is tested through its API. No screenshots or private meal data were published.

The SQL nutrition integration command was attempted but refused to collect because
no isolated loopback SQL Server is configured. Do not interpret synthetic action
counters as real SQL transaction/concurrency or live-provider/device evidence.
This executor uses Node 24.19.0/npm 11.9.0; pinned Node 22/npm 10 qualification stays
with CI. Locked npm package installation needed temporary public npm tarball URLs
for configured-feed 403s; the tracked lockfile, versions and integrity hashes are
unchanged. PR #1314 is ready and rebased onto main `5dd52b07` after desktop
#1313. Additive documentation and test-setup conflicts preserved both workstreams.
Runtime/CSS comparison retains the merged desktop, composer, dictation, preview
and attachment changes. Exact-head local and hosted qualification follows the
rebase; parent owns merge and deployment.


## Settled shell glass checks (#1301; 26 October 2026)

Use `npm test --workspace @jarvis/web`, web lint and web build, plus the actual-App
browser fixture in `docs/ui/screenshots/1301/fixtures/browser.py`. Reproduction
commands and limits are in that folder's README. It measures per-frame fill,
blur and opacity, waits after three menu opens and deferred settings, and
checks scene-color transmission under header/composer/dock/popup pixels.
Only synthetic App data and the existing WebGL fallback are used. No private
reference image or real device/media acceptance is included. Keep existing
phone viewport and startup-autofocus tests intact.


## Camera/menu verification (#1296; 26 October 2026)

Run `npm test --workspace @jarvis/web`, `npm run lint --workspace @jarvis/web`
and `npm run build --workspace @jarvis/web`. The reproducible full-App fixture,
Chromium browser assertions, synthetic screenshots and exact setup commands are
in `docs/ui/screenshots/1296/README.md`. It supplies synthetic sign-in, HTTP
responses and a canvas camera stream; WebGL is disabled to exercise the actual
app's fallback without software-renderer contention. No private pixels, real
camera, microphone or external provider is exercised. This executor uses
Node 24.19.0/npm 11.9.0, not the pinned CI Node 22/npm 10.


## Mobile browser food confirmation checks (#1290; 25 October 2026)

Use the existing natural-food checks below, plus backend
`src/core/phone-approval.test.ts`, `src/voice/startup.test.ts` and
`src/daily/tools/food.test.ts`. The food-review HTTP fixture starts at
discovery/lookup, stages through the tool route and reads the exact invitation
from the still-open conversation SSE stream before steering `Log it`; fresh and earlier-refusal
histories use isolated synthetic records. Relay tests start from an estimate
request and actual tool execution in both direct and compact discovery modes
for English/Danish. They require invitation transcript/audio frames on the browser
socket before sending a new owner reply, then require the committed result
transcript. They also cover deferral during user speech, expiry before delivery,
and interrupted invitation responses retaining the tool-result continuation.
The internal invitation event carries the existing confirmation's presentation,
not a second approval lifecycle. #1259 acknowledgement is not invitation evidence.
Typed-chat client/parser tests in `conversation-history.test.ts` and
`ConversationHistory.test.tsx` require visible inline review/invitation before
`Log it`, then the final receipt, plus withdrawal and invalid-payload handling.
`core/conversation.test.ts` also checks source/session isolation and subscription
cleanup. Chromium inspection at 1440px/390px used the real conversation
component/client with synthetic streaming responses and scratch-only providers,
not the hosted signed-in App, real provider, SQL or a physical device.
Full local qualification uses `npm run lint`, `npm test`, `npm run build`, and
the isolated SQL command below when its loopback fixture is available.
Hosted-agent qualification:
`bash .github/scripts/python-ci.sh agents/jarvis`.
These are mocked-provider/in-memory tests, not live-provider, SQL persistence,
microphone or physical-device acceptance. Do not write production meals.

## System status freshness checks (#1288; 25 October 2026)

Focused synthetic checks from the repository root:

```sh
npm test --workspace @jarvis/backend -- src/system-status.test.ts src/vault/vault.test.ts
npm test --workspace @jarvis/web -- src/status/StatusPage.test.tsx
npm run lint --workspace @jarvis/backend
npm run lint --workspace @jarvis/web
npm run build --workspace @jarvis/backend
npm run build --workspace @jarvis/web
```

The backend cases cover no-change syncs with old chunk times, incomplete
coverage, failed and stale attempts, and unknown evidence after restart. Status
page fixtures cover Foundry/runner explanations, vault evidence times and
ordinary refresh. These checks do not run live model/runner probes or access
private vault data.

## Shared confirmation lifecycle checks (#1281; 25 October 2026)

Focused offline checks from the repository root:

```sh
npm test --workspace @jarvis/backend -- src/core/pending-action.test.ts src/core/owner-interactions.test.ts src/google src/daily/tools/food-review.test.ts src/daily/tools/saved-food.test.ts src/voice/realtime.test.ts src/voice/relay.test.ts
npm test --workspace @jarvis/backend -- src/factory/pending-action-tools.test.ts src/factory/tools.test.ts src/factory/github-approval.test.ts src/factory/github-app-tools.test.ts src/factory/pull-request-tools.test.ts src/factory/repository-tools.test.ts
```

These use synthetic stores/providers, not live account mutations or physical
voice acceptance. `core/pending-action.ts` owns confirmation transitions;
adapters keep permission checks, routing indexes and result receipts.
Food API compatibility tests exercise opt-in `foodEstimate` delivery and
`resolveFoodEstimateReply` with synthetic persisted replies and injected
decisions. The reconciled tree includes #1278's merged call-site, phrase and
streaming changes and retains its real SQL fixture below. The focused combined
checks do not establish live-device acceptance or qualify branch-only #1264
target clarification. The reconciled tree also includes #1259's reviewed
acknowledgment and response-delivery changes.

## Natural food confirmation checks (#1277; 25 October 2026)

Use synthetic food records only. Focused checks from the repository root:

```sh
npm test --workspace @jarvis/backend -- src/core/owner-interactions.test.ts src/core/approval-interpreter.test.ts src/daily/tools/food-review.test.ts src/core/conversation.test.ts src/core/chat-agent.test.ts src/voice/realtime.test.ts src/voice/relay.test.ts
npm test --workspace @jarvis/web -- src/conversation-history.test.ts
```

Text steering and persisted English/Danish browser-voice transcripts resolve
only the current session's pending estimate; Now remains available. Stream
readers use the existing hosting budgets (browser 240 seconds, backend 210 seconds
below ingress), not a new food lifetime.
Local HTTP/WebSocket fixtures are not live microphone, provider or device evidence.

The SQL nutrition review fixture uses `createConversationStore(pool)` for both
the tool request and owner-interaction service, with persisted source/reply
messages. Its nutrition clock follows the source timestamp. Keep the real SQL
approval/replay assertions for both browser-button and natural estimate replies:

```sh
npm run test:database --workspace @jarvis/backend -- src/database/nutrition.integration.test.ts
```

This command requires the isolated loopback SQL Server configuration used by
Database CI; never point it at production.

## Research result recovery (#1237; 25 October 2026)

Focused offline checks from the repository root:

```sh
npm test --workspace @jarvis/backend -- src/core/research.test.ts src/core/jobs.test.ts src/core/workspaces.test.ts src/database/background-job-store.test.ts src/database/html-artifact-store.test.ts
npm test --workspace @jarvis/contracts -- src/index.test.js
npm test --workspace @jarvis/web -- --run src/JobsChip.test.tsx
```

The additive `0066_research_result_recovery.sql` change is covered by the
backend's disposable SQL Server integration workflow:
`npm run test:database --workspace @jarvis/backend`. A local offline test does
not validate SQL Server execution. Use only synthetic reports and owner IDs.
Workspace delivery is separate from research completion; `delivered` means the
client acknowledged applying its command, not that a person viewed it. A
physical iPhone/tab reconnect remains owner acceptance, not CI evidence.

## Per-finding feedback checks (#1240)

From the repository root, use `npm run build --workspace @jarvis/backend` and
`npm test --workspace @jarvis/backend -- src/proactive/feedback-tool.test.ts src/proactive/tools.test.ts src/proactive/routes.test.ts src/proactive/store.test.ts src/database/proactive-store.test.ts src/proactive/alerts.test.ts src/proactive/reminders.test.ts src/proactive/reminder-ticker.test.ts`.
These synthetic checks exercise the actual chat dispatcher and realtime voice
executor; they do not contact live providers or write real feedback/preferences.
SQL query-shape checks are offline, not a live SQL Server concurrency check.
Combined reminder/feedback integration also exercises `src/production-modules.test.ts`
and `src/core/capability-instructions.test.ts`: the full catalogue contains recall,
preferences, per-item feedback and owner reminders together, and instruction-budget
checks include reminders in every existing feature/mode combination.

## Conversational task write checks (#1236; 23 October 2026)

Use synthetic vaults only; no live settings, grants, credentials or deployment.
Focused backend checks: `npm test --workspace @jarvis/backend -- src/vault
src/core/capability-instructions.test.ts src/voice/realtime.test.ts`.
Panel refresh: `npm test --workspace @jarvis/web -- src/tasks/TasksPanel.test.tsx`.
Run existing backend/web builds and lint for their changed boundaries.
Physical iOS/Obsidian synchronization and real speech acceptance remain separate.
Local results: 172 backend tests, 26 panel tests and 107 hosted-agent tests passed;
backend/web builds and scoped ESLint/Ruff passed. No real-browser inspection or
live speech/sync check was performed. Python CodeQL found no alerts; JavaScript
analysis was skipped for database size and the automated review binary was absent.

## Owner session switch, revocation and checks (22 October 2026; #1217; default off in code, on in production since 23 October 2026)

The backend can give the owner a revocable 10-day session after one Entra
sign-in. The web client supports it. The backend switch is off by default in
code and on in production: `infra/main.bicep` pins it to `true` since 23 October
2026, with the owner's explicit approval, and it remains the rollout kill switch.

| Setting | Values | Default | Read |
| --- | --- | --- | --- |
| `JARVIS_OWNER_SESSION_ENABLED` | exactly `true` or `false` | `false` | At startup |

Any other value, or `true` with no SQL settings, stops startup with a
configuration error.

With the switch enabled, an owner session may read Health upload credential
status but cannot create, rotate or revoke that long-lived credential; those
POSTs require an Entra owner token. Settings continues to load status with its
session-first token and uses a fresh Entra token for changes, explaining when
Microsoft requires an interactive sign-in. With no owner session, the existing
Entra-only behavior is unchanged.

**Turn on.** Deploy migration 0064 and the backend revision first. To enable,
change the `infra/main.bicep` pin and this session's pin test together to the
exact string `true` in one reviewed change, with the owner's explicit approval,
then deploy; production has been enabled this way since 23 October 2026. After
a 404, the web client waits up to six hours before its next mint attempt; a
device may need a reload or time before it starts using sessions, and an
explicit Sign in clears the wait at once.
Locally, set the variable in the backend's environment together with the SQL
settings; the offline skeleton cannot run sessions.

**Turn off (kill switch).** Set the value to `false` or remove the entry, then
deploy or restart. From the next request, verification stops: every `js.` token
is a 401, and
`POST /auth/session`, `DELETE /auth/session` and `DELETE /auth/sessions` answer
404. The next process start attempts one background, best-effort revoke of all
active rows in `dbo.owner_sessions`, with a one-minute timeout and no retry. This
touches SQL at startup and can wake a paused serverless database; the revoke does
not delay or fail startup. A missing table or other database failure is logged
without secrets. No SQL means no boot revoke. If an off revision starts while an
on revision is overlapping, it may revoke sessions that revision just minted;
the owner signs in again.

**Revoke all sessions** (a lost phone or a suspected leak):

- Call `DELETE /auth/sessions` with a session token or an Entra owner access
  token. It answers 200 with the number revoked. Requests fail immediately after
  revocation; open voice and Now/Factory event streams close on the replica that
  handles it, and other replicas recheck them within about five minutes.
- To end only the calling device, call `DELETE /auth/session` with that device's
  session token (204); its tracked voice and event-stream connections close too.
- With a usable session or Entra owner token, call `DELETE /auth/sessions` first,
  then turn the switch off if needed. With no usable token, turn the switch off;
  the next process start attempts the revoke once. Before turning the switch back
  on, confirm that start logged `owner_session.boot_revoke` with outcome
  `revoked`, and restart the off revision after `failed`. Rolling back migration
  0064 drops the table and ends every session too.

Operating notes:

- The numbers live in `apps/backend/src/auth/session/config.ts`: 10 days idle,
  extended at most once an hour; a 30-day cap; at most 10 active sessions per
  owner (creating one more revokes the least recently used); 5 creations per
  minute and 30 per hour; dead rows purged 30 days after revocation or expiry.
  The creation limit and the lookup admission below are in process, so they
  apply per replica.
- A client sees only a plain 401 for any rejected session. The log has
  `owner_session.rejected` with a reason (`malformed`, `unknown_session`,
  `secret_mismatch`, `revoked`, `absolute_expired`, `idle_expired`,
  `owner_mismatch`, `disabled`, `store_unavailable`, `throttled`, `rate_limited`
  or `forbidden`) and, when a lookup judged the token, the first eight characters
  of the token. A session past both the cap and its idle expiry is logged as
  `absolute_expired`.
- Lookup admission keeps callers without a session away from SQL. A well-formed
  `js.` token for a session id this replica has not recently verified spends a
  budget of 30 lookups per minute, at most 8 such lookups run at once, and at
  most 64 lookups of any kind. Over a limit the answer is a 429 with
  `Retry-After` (1 to 60 seconds for the budget, 5 for a cap), the body
  `{"error":"Too many requests"}` and the log reason `throttled`. It is never a
  401, so a client keeps its session and retries. Up to 32 ids that verified in
  the last 30 minutes skip the budget, so the owner's own traffic does not
  throttle itself, but each request still reads the store and compares the
  secret: a revocation applies to the next request. Open session-authenticated
  voice and event-stream connections are also closed locally on revoke and
  periodically rechecked without extending idle expiry. An id refused for any
  reason leaves the set. The set is in memory, so a restart empties it. The limit
  is keyed on the session id, never on the client address, which the backend does
  not trust. With the switch off no token lookup or admission logic runs; a
  separate off-mode process start with SQL configured attempts the boot revoke
  described above. The numbers are in
  `lookupAdmission` in `config.ts`.
- Reading `throttled` lines: a burst with no owner complaint is a flood of random
  tokens being shed as designed. The budget bounds database work but not wake-up,
  so a steady stream just under it can still keep a paused serverless database
  awake. A replica that has just started also throttles a burst of more than 8
  parallel first requests, which succeed on retry. While a flood lasts, a session
  that replica has not verified yet can wait up to a minute; the owner can sign in
  with Entra again, which never reaches the session lookup.
- A session-store outage is a 503 with `Retry-After`, never a 401, so a client
  keeps its session and retries. Browsers cannot read `Retry-After` from this API
  because CORS does not expose it; the same holds for the throttled 429.
- `POST /auth/session` takes no body or a JSON object `{"deviceLabel": "..."}`.
  A client must send `{}` or nothing: an empty body with a JSON content type is a
  400.
- A session token is refused on `GET /status/smoke` (403); deployment
  verification keeps its own identity. Like an Entra token, the secret is
  forwarded to the hosted chat agent for the owner's turns.

Checks, from `apps/backend`:
`npx vitest run src/auth src/config.test.ts src/logging.test.ts src/database/owner-session-store.test.ts src/database/migrations.test.ts`
(run `src/logging-source.test.ts` alone, it is slow under load), and
`npx vitest run src/voice/relay.test.ts src/core/now.test.ts src/factory/tasks.test.ts`
(long-lived connection close behavior),
`npx tsc --project tsconfig.json --noEmit` and `npm run lint`. The SQL Server
checks, `npm run test:database`, run only in CI. The node `mssql` driver cannot
reach a Windows LocalDB instance, so a local check of the migration and the store
statements needs a different client, for example ADO.NET over the instance's
named pipe. Live sign-in, the web client, real devices and production
configuration are not exercised by any of these.

Web client checks from the repository root:

```sh
npm test --workspace @jarvis/web -- --run src/owner-session.test.ts src/backend-request-owner-session.test.ts src/auth.test.ts src/useSignIn.test.tsx src/pages.test.tsx src/DatabaseWakeStatus.test.tsx src/AccountSettings.test.tsx src/App.test.tsx
npm run lint --workspace @jarvis/web
npm run build --workspace @jarvis/web
```

Web tests use mocked auth and backend responses; they do not verify a live
Microsoft sign-in or real device. Owner-session checks also cover the delayed
wake cue, bounded Entra fallback, mint-storage revocation and confirmation
single-flight. To verify the safe rollout path locally, keep
`JARVIS_OWNER_SESSION_ENABLED=false`: `POST /auth/session` returns 404, the
client waits six hours before another mint attempt, and sign-in continues with
Entra. A session request returning 401 after the switch is disabled clears the
session only after confirmation and resumes the ordinary Entra flow. Do not
enable the backend switch or change CORS for this client change.

## Bounded history continuation checks (22 October 2026; #1201)

From the repository root, the following local checks passed:

- `npm test --workspace @jarvis/backend -- src/daily src/core/agent-contract.test.ts src/core/tool-registry.test.ts`
  — 1,093 tests across 62 files. This includes synthetic grouped-schema year
  traversal for meals, metrics, sleep and workouts, independent exhaustion,
  equal ordering keys, scope/cursor refusals, backdated/deleted meals, later-page
  failures, cancellation, deadline/byte limits and assistant contract assertions.
- `npm run build --workspace @jarvis/backend` and
  `npm run lint --workspace @jarvis/backend`.
- `npm test --workspace @jarvis/contracts` — 173 tests; contracts build and lint.
- From `agents/jarvis`: `.venv/bin/python -m pytest -q` — 898 tests, and
  `.venv/bin/python -m ruff check .`.

No SQL fixture is configured in this sandbox; no live/private records, device
completeness, model/provider acceptance, merge or deployment were exercised.
The aggregate CI skips draft PRs. PR #1203's code commit `4809a9e` triggered
run `39809082829`, which was skipped, not passed; its title gate separately
failed because the generated title lacked the required
task-ID/`fix-main:`/`docs:` format. Fresh exact-head qualification remains
required after the PR metadata/ready gate permits it. Read-only review found
no remaining significant issues after correcting legacy meal-ID replay.
Secret scanning passed. The mandatory parallel validation was attempted, but
its review binary was unavailable and its CodeQL analysis skipped for database
size; neither is a clean automated-review/security qualification.

## Vault mirror freshness checks (19 October 2026; P14-29)

Review corrections: `npm test --workspace @jarvis/backend -- src/proactive`
passed 506 tests; `npm test --workspace @jarvis/web -- src/status` passed
46 tests. Backend/web lint and builds passed (existing web chunk-size warning).
Synthetic Chromium checked 48 loading-to-result cases at 1280×900, 390×900 and
320×900, normal/reduced motion: all six reported states, omitted mirror field
and failed fetch. It verified one stable node, expanded/focused state retention,
Enter/Space, recovery text and overflow. This is the actual Status component
and stylesheet in a scratch harness, not live auth, Azure RBAC/storage,
Obsidian, a physical phone or Safari.

Focused web checks from the repository root:
`npm test --workspace @jarvis/web -- src/status`,
`npm run lint --workspace @jarvis/web` and
`npm run build --workspace @jarvis/web`.
Backend checks:
`npm test --workspace @jarvis/backend -- --run src/{vault-mirror-status,core/status,system-status,proactive/vault-mirror,proactive/engine,proactive/composition}.test.ts`,
`npm test --workspace @jarvis/contracts`, backend build, and backend/contracts
lint. Verified locally: 138 targeted backend tests, 172 contracts tests,
1,874 web tests, web/backend builds and web/backend/contracts lint.
The web build retains its existing bundle-size warning.
The Status reader consumes the existing storage account through managed
identity; it needs no feature flag, new secret or container provisioning.
Missing `vault-mirror-status/status.json` is a normal not-set-up state.
Keep browser fixtures synthetic and outside the repository; never capture real
vault conflict paths. Local fixtures do not verify Azure identity/RBAC,
production storage or the live Obsidian service.

## Vault mirror runner checks (19 October 2026; P14-27)

From the repository root: `npm run build:vault-mirror`,
`npm run typecheck:vault-mirror`, `npm run lint:vault-mirror` and
`npm run test:vault-mirror`. Shared status checks use
`npm test --workspace @jarvis/contracts`. Build and smoke-test the image from the
repository root with:

```sh
docker build --file apps/vault-mirror/Dockerfile --tag jarvis-vault-mirror:local .
docker run --rm --entrypoint ob jarvis-vault-mirror:local --version
docker run --rm \
  --mount "type=bind,source=$PWD/apps/vault-mirror/test/container-smoke.mjs,target=/tmp/container-smoke.mjs,readonly" \
  --entrypoint node jarvis-vault-mirror:local /tmp/container-smoke.mjs
```

`node apps/vault-mirror/dist/main.js` performs one run and exits. The runtime
requires `KEY_VAULT_URI`, `AZURE_CLIENT_ID`, `GITHUB_APP_ID` and
`VAULT_MIRROR_STORAGE_URL`; secrets are read from Key Vault at runtime. Keep
`VAULT_MIRROR_WRITE_BACK` at `dry-run` (unrecognized values also mean `dry-run`)
unless the owner explicitly enables `on`. The caps default to 25/3 and hard max
at 100/10. Freshly initialized bases suppress Obsidian writes even in `on`.
Never log plans, policies, note content or paths; only conflict paths are allowed
in private status. Local checks use synthetic values and never contact the live
service. Production runs the job every ten minutes: live since 20 October 2026
and with write-back `on` since 22 October 2026 (see the decision log). See the
workspace README and P14-33 decision for runner ordering, recovery and CLI
assumptions.

P14-33 bounds the in-memory state archive to 64 MiB and gives each `ob` call the
remaining 420-second run budget minus a 90-second reserve. A child timeout saves
the workspace and Headless state for the next pull-only reconciliation; an
expired overall deadline cannot persist because its lease signal is cancelled.
The runner uses the pinned 0.0.14 CLI source to disable attachment/config sync
per device; empty `--file-types` restores defaults, so it stores an empty
`allowTypes` array after `sync-config`. The production job exercises this
source-derived behavior; checkpoint recovery after a timeout has not been
confirmed live.
The image builds `better-sqlite3` from source with build tools in the CLI-only
Docker stage; those tools are not copied into the non-root runtime stage.

CI has a reusable `vault-mirror-ci.yml`, impact mapping and a required aggregate
result dependency. Changes to this wiring require the dispatcher's explicit
protected-path approval. Mirror-only source edits do not deploy existing apps.

## Suggested todos, alerts and reminders are on in production (P13-15; 18 October 2026)

Dan delegated the decision and switched proactive milestones 3 and 4 on after the
todo writer (P13-11), alerts (P13-12) and reminders (P13-13) shipped dark. Two
lines do it, and the code defaults stay off. Both are backend only: there is no
web flag, parameter, secret, resource or dependency, and `deploy.yml` is unchanged.
Each is set in `infra/main.bicep` as a backend container app `env` entry with the
exact value `'true'`, beside the two switches that came before it.

| Flag | Set in | Gates |
| --- | --- | --- |
| `JARVIS_PUSH_ENABLED` | `infra/main.bicep`; `VITE_PUSH_ENABLED` in `deploy.yml` | Web Push subscriptions and sends (P13-03) |
| `JARVIS_PROACTIVE_ENABLED` | `infra/main.bicep`; `VITE_PROACTIVE_ENABLED` in `deploy.yml` | Checks, the Proactive page and its Settings section (P13-14) |
| `JARVIS_PROACTIVE_TODO_WRITES_ENABLED` | `infra/main.bicep` | Todo additions (milestone 3, P13-15) |
| `JARVIS_PROACTIVE_ALERTS_ENABLED` | `infra/main.bicep` | Alert and reminder pushes (milestone 4, P13-15) |

Todo additions run only inside an enabled check. Alerts and reminders also need
push switched on and a subscribed device, and they share the one alert flag.

What now happens, exactly:

- Todos: eligible proactive tasks go only to an existing `Personal/Inbox.md` or
  `Work/Inbox.md`; every new task starts `- [ ] (proactive)`. Project/software,
  Factory, PR/build/check and engineering suggestions are excluded across all
  sources. Ambiguous scope, missing identity or an unavailable/unwritable
  destination means no write and a content-free skip reason. Stable source/action
  receipts and hidden markers deduplicate across wording, elapsed time, finding
  category and inbox routing, including after owner completion or removal.
  Existing tasks and the `Suggested by Jarvis` section are untouched, and root
  `Task.md`/`Tasks.md` is never a write destination. The writer adds at most 3
  lines per check and 5 per Copenhagen day and follows pause, the Todo list
  switch, and existing scheduled quiet-hour behavior.
- Alerts: only a time-critical finding (a todo due within 24 hours, or a calendar
  clash starting within 48 hours) found by the scheduled 07:00 or 18:00 check, or
  its catch-up, can send a push. At most one push per check and 3 a day, never
  between 22:00 and 07:00, and never for "Check now". P13-21 includes bounded
  stored titles in the encrypted payload; tapping it opens the item. Everything
  else waits on the Proactive page.
- Reminders: about one hour before a todo with an explicit time is due, Jarvis
  sends one push. A date-only todo is covered by the 24-hour deadline alert
  instead. P13-21 pushes show a due-time headline and todo title, or a bundled
  count headline with up to three time/title lines and an overflow count; tapping
  opens a private Proactive item. At most 8 reminders per
  Copenhagen day. A reminder that falls in the quiet window is held until 07:00
  and shown as due soon or overdue. A todo added after the last check is covered
  from the next check on; "Check now" covers it immediately.

To switch these off:

- No deploy: Settings → Proactive → "Pause proactive checks" stops scheduled
  checks, todo additions, alerts and reminders, including reminders already
  planned. The "Todo list" source switch in the same section stops todo additions
  and stops new reminders from being planned. Settings → Notifications → "Turn
  off" stops pushes on that device.
- Deploy: revert the whole P13-15 change (removes the gate lines and the pin test
  updates together), or set the value(s) to `false` AND update the pin tests in the
  same commit. To switch one feature off on its own, set only its value to `false`
  and update only its pin: `todo-writes-default-off.test.ts` for todo additions,
  `alerts-default-off.test.ts` for alerts and reminders. Removing only a line fails
  the pin in CI before Deploy can run. Lines Jarvis already added stay in the todo
  file (it never deletes them), and findings, feedback, settings and send history
  stay in SQL.

Open point: Dan's 17 October decision in `docs/decisions.md` says quiet hours also
apply to manual checks, but the shipped engine lets "Check now" run at any hour
(see the P13-14 section), so the writer can add todo lines on a manual check at
night. Pushes never go out between 22:00 and 07:00. This change alters neither; a
stricter rule would be its own code change.

CI proves the wiring only. Whether a todo line is added, and whether an alert or
reminder push reaches the iPhone, is established by Dan's test on the deployed
app, not by any check here. Local checks:
`npm test --workspace @jarvis/backend -- --run src/proactive/todo-writes-default-off.test.ts src/proactive/alerts-default-off.test.ts src/proactive/enabled-switch.test.ts src/push/enabled-switch.test.ts src/daily/default-off.test.ts src/config.test.ts`.
The Bicep compile and lint (`az bicep build` and `az bicep lint`) run in CI only.

## Proactive checks are on in production (P13-14; 18 October 2026)

Dan switched proactive milestone 2 (read-only checks) on after the P13-05 to
P13-10 slices shipped dark. Two lines do it, and the code defaults stay off:

- Backend: `infra/main.bicep` sets `JARVIS_PROACTIVE_ENABLED` to `'true'` in the
  backend container app's `env`, beside `JARVIS_PUSH_ENABLED`.
- Web: the web job's "Load infrastructure outputs" step in
  `.github/workflows/deploy.yml` writes `VITE_PROACTIVE_ENABLED=true` to
  `$GITHUB_ENV` beside `VITE_PUSH_ENABLED`, so the production build includes the
  Proactive page, its Settings section and the Background work link.
  `vite.config.ts` reads the flag; `apps/web/config/public-config.ts` does not.

`JARVIS_PROACTIVE_TODO_WRITES_ENABLED` and `JARVIS_PROACTIVE_ALERTS_ENABLED` were
set nowhere when this change shipped, so a check read sources and stored findings
but wrote no todo and pushed nothing; P13-15 (the section above) switches
milestones 3 and 4 on. `apps/backend/src/proactive/enabled-switch.test.ts` pins the
backend value and fails if its name appears in any other file (the todo-writes and
alert flags keep their own pins, `todo-writes-default-off.test.ts` and
`alerts-default-off.test.ts`);
`apps/web/config/proactive-switch.test.ts` pins the web value and fails if any
other workflow, Dockerfile, package file, web config or Bicep/parameter file names
it. Changing a gate is therefore a reviewed edit to those two files and to the pins.

To switch proactive checks off, revert the whole P13-14 change (removes the two
gate lines and the pin tests together), or set both values to `false` AND update
the pin tests in the same commit. Removing only the two lines fails the pin tests
in CI before Deploy can run. Once Deploy has run, the backend registers no
proactive routes and starts no scheduler, and the web build drops the Proactive
page and Settings section. Stored findings, feedback and settings stay in SQL and
are reused if checks are switched on again. No secret, identity, resource or
dependency is involved.

First-run behaviour: the first scheduled check runs at the next 07:00 or 18:00
Europe/Copenhagen slot, or as one catch-up when the latest slot is under 12 hours
old and the clock is outside 22:00 to 07:00. Scheduled work is cancelled at 22:00.
"Check now" on the Proactive page runs one check at any time, including during
quiet hours, unless checks are paused, no source is on, the monthly budget is used
up, a check is already running, or the limits of one manual check per five minutes
and six per Copenhagen day are reached. (Dan's 17 October decision in
`docs/decisions.md` says quiet hours also apply to manual checks, but the shipped
engine and route do not enforce that, as `PRODUCT.md` and #935 state; this change
alters neither, and a stricter rule would be its own code change.) Spend is an
estimate; the monthly cap defaults to 100 DKK and Dan can change it in Settings
(0 to 1,000 DKK). A source that cannot be read, such as a todo file that is not
found, is reported as unavailable with a reason; that is expected, not a fault.

CI proves the wiring only. Whether a scheduled check runs, what it finds and
whether each source reads correctly in production is established by Dan's test on
the deployed app, not by any check here. Local checks:
`npm test --workspace @jarvis/backend -- --run src/proactive/enabled-switch.test.ts src/push/enabled-switch.test.ts src/daily/default-off.test.ts src/config.test.ts`
and `npm test --workspace @jarvis/web -- --run config/proactive-switch.test.ts`.
The Bicep compile and lint (`az bicep build` and `az bicep lint`) run in CI only.

## Web Push is on in production (P13-03; 18 October 2026)

Dan switched Web Push milestone 1 on after the P13-01 backend and the P13-02 web
client shipped dark. Two lines do it, and the code defaults stay off:

- Backend: `infra/main.bicep` sets `JARVIS_PUSH_ENABLED` to `'true'` in the
  backend container app's `env`, beside `STATIC_WEB_APP_ORIGIN`.
- Web: the web job's "Load infrastructure outputs" step in
  `.github/workflows/deploy.yml` writes `VITE_PUSH_ENABLED=true` to
  `$GITHUB_ENV` beside `VITE_BACKEND_URL`, so the production build includes the
  Notifications section and worker.

`apps/backend/src/push/enabled-switch.test.ts` pins both values and fails if any
other workflow, Dockerfile, package file, web config or Bicep/parameter file
names either switch, so changing a gate is a reviewed edit to those two files
and to the pin.

To switch push off, revert the whole P13-03 change, which removes the two gate
lines and the pin test together, or set both values to `false` and update the pin
test in the same commit. Reverting only the two lines fails the pin test in CI
before Deploy can run. Once Deploy has run, the backend registers no push routes,
so nothing can send, and the web build drops the Notifications section and worker
registration. The VAPID key pair and stored subscriptions stay in SQL and are
reused if push is switched on again. No secret, identity or resource is involved.

CI proves the wiring only. Delivery to an iPhone is established by Dan's device
test on the installed Home Screen app (iOS 16.4 or newer), not by any check here.

## P13-01 Web Push backend (17 October 2026)

`JARVIS_PUSH_ENABLED` enables the authenticated Web Push backend only when its
value is exactly `true`; unset and all other values leave routes unregistered
and avoid push-store/database/provider work. P13-01 itself set no deployment
value; P13-03 (above) sets it in production. The VAPID private key stays in
server-side SQL; routes expose only its public half. The v2 test push says
`Test notification` / `Push notifications are working on this device.`
No Teams delivery path exists. The user-started test is not subject to
quiet hours; any future system-started delivery must enforce 22:00–07:00
Europe/Copenhagen without an emergency exception.

Focused checks:
`npm test --workspace @jarvis/backend -- --run src/push/validation.test.ts src/push/webpush.test.ts src/push/routes.test.ts src/config.test.ts src/database/migrations.test.ts`,
`npm run build --workspace @jarvis/backend` and
`npm run lint --workspace @jarvis/backend`. SQL Server schema/store integration
uses `npm run test:database --workspace @jarvis/backend -- src/database/schema.integration.test.ts`
with the isolated loopback test database; do not claim it ran without that
service. A green local test or build does not establish real iPhone delivery.

## P13-05/P13-06 proactive foundation and engine (18 October 2026)

`JARVIS_PROACTIVE_ENABLED`, `JARVIS_PROACTIVE_TODO_WRITES_ENABLED` and
`JARVIS_PROACTIVE_ALERTS_ENABLED` are independent exact-`true` flags, all off by
default in code. The latter two do not activate work unless the main proactive flag is
on. P13-14 and P13-15 (above) set all three in deployment, each only in
`infra/main.bicep`; do not set them in any other workflow or infrastructure file. This
composition registers owner-bound status/settings/items/run routes and starts
the in-process scheduler only when enabled. Idle ticks do not query SQL. The
engine supports fake sources and a fake model; real source adapters and proactive
sends remain separate slices. P13-05 and P13-06 themselves needed no index,
workflow or infrastructure activation.

Focused checks:
`npm test --workspace @jarvis/backend -- --run src/config.test.ts src/proactive/routes.test.ts src/proactive/store.test.ts src/proactive/time.test.ts src/proactive/budget.test.ts src/proactive/language.test.ts src/proactive/sources/registry.test.ts src/database/migrations.test.ts src/push/routes.test.ts`,
`npm test --workspace @jarvis/contracts`,
`npm test --workspace @jarvis/web -- --run src/JobsChip.test.tsx`,
`npm run build --workspace @jarvis/backend`,
`npm run build --workspace @jarvis/web`, and lint for both workspaces.
Engine checks:
`npm test --workspace @jarvis/backend -- --run src/proactive src/database/conversation-store.test.ts`,
`npm run build --workspace @jarvis/backend`, and
`npm run lint --workspace @jarvis/backend`.

## Conversational proactive suggestion preferences (#1207)

Chat, voice and the Proactive Settings section share owner-scoped category and
personal/work preferences through `ProactiveStore.settings`. Migration 0062
defaults all categories to enabled and scope to `all`, including for existing
accounts. Restricted scopes exclude unknown/mixed findings. The tool requires a
matching direct owner request and patches one category or scope; findings and
source text cannot authorize it. These preferences constrain unsolicited
proactive generation/delivery only, not explicit owner tasks. Re-enabling does
not alter pause, sources, budget or unrelated settings. Existing findings,
todos and reminders are not deleted.

The 23 October follow-up uses the existing bounded approval model for natural
Danish/English preference instructions, with its own exact-change verification
prompt and no approval-word shortcut. Without a configured model, canonical
requests still work; other wording refuses with a focused clarification.
Cancellation and current-message provenance are checked again before saving.
No new configuration, migration or tool-budget change is needed. Reverting the
follow-up preserves saved settings and restores canonical-only wording.
Add `src/core/approval-interpreter.test.ts` to the focused checks below.
Synthetic model-port tests verify dispatch and safeguards, not live language
accuracy; live chat/voice acceptance remains owner verification.

23 October follow-up local results:
`npm test --workspace @jarvis/backend -- --run src/proactive/tools.test.ts src/core/approval-interpreter.test.ts`
passed 199 tests. `npm test --workspaces` passed: contracts 174, web 2,262,
backend 6,272 (one skipped), vault-mirror 237. Backend build and lint passed.
The isolated SQL command below stopped before running tests because no loopback
SQL Server test configuration was available. Secret scanning found no secrets;
independent review found no blocking issues. Automated review was unavailable
(missing binary), and CodeQL skipped analysis because its database was too large.
No live preferences, provider sessions or deployments were exercised.

24 October same-branch integration (Refs #1207): merged main `33f0ab9` with
both task/stale-write protections (#1244) and food-review behavior (#1235)
unchanged, preserving their documentation. Negative preferences such as
“I do not want travel suggestions” explicitly disable that category;
“do not change my preferences” disclaims authorization even alongside a preference.
Voice preference writes also verify the live transcript source marker and
persisted owner text/session; superseding, revised or pending transcripts refuse
rather than relying on the original tool-call snapshot.
Focused integrated backend checks passed 485 tests. All workspace builds and
lint passed. With the existing CI SQL Server image in a disposable loopback-only
container, `npm run test:database --workspace @jarvis/backend` passed all 278
tests; the container was removed afterward.
The first aggregate web run had one unchanged contrast-audit timeout (15 seconds);
its isolated rerun passed all seven tests without changing its timeout or source.
The same contended run also reported a Health upload admission test failure.
Final aggregate reruns and exact-head CI must be reported separately from the
23 October results above; they are not implied by those earlier green checks.

Coordination: #1246/#1247 are merged into main and included in this integration.
This preference follow-up adds no SQL schema/store edit, catalogue member or cap.
The combined tree preserves the preference guard, feedback grounding, conditional
SQL writes, optional reminder registration and all four advertised proactive
tools. Fresh CI must qualify this integrated head. No #1249 or #1241 work is imported.
Live speech/model comprehension and owner acceptance remain unverified.

## P13-22 proactive controls (24 October 2026; Refs #1252)

Settings, chat and voice use the same owner-bound preference store and
capability-backed help. Settings shows one automatic-suggestion switch, the
preferences currently enforced, a natural-language editor and examples supported
by the same backend capability source. Writes preserve hidden advanced settings,
use a full-record revision to reject stale edits and confirm only after readback.
Focus/reconnect/poll refreshes retain unsaved text; explicit reload is the
discard path. Pause/source changes cancel ongoing automatic work and are checked
again before automatic task writes and push delivery. Explicit owner-requested
reminders stay separate.

Focused synthetic checks passed locally:
`npm test --workspace @jarvis/backend -- --run src/proactive/tools.test.ts src/proactive/routes.test.ts src/proactive/engine.test.ts src/proactive/alerts.test.ts src/proactive/todo-writer.test.ts src/proactive/reminder-ticker.test.ts src/proactive/owner-reminder-ticker.test.ts src/proactive/store.test.ts`
(303 tests), and
`npm test --workspace @jarvis/web -- --run src/stylesheets.test.tsx src/ProactiveSettings.test.tsx`
(73 tests). These cover capability-backed help/state, failure and conflict
handling, retained UI drafts, cancellation and final automatic side-effect
checks. Aggregate `npm test --workspaces` passed: contracts 174, web 2,262,
backend 6,449 (one skipped), and vault-mirror 237. The schema integration case
also checks settings across store instances
and rejects a stale revision. Using an isolated loopback SQL Server container,
`NODE_ENV=test npm run test:database --workspace @jarvis/backend -- --run src/database/schema.integration.test.ts`
passed 86 tests; the container was removed afterward. Scratch-only auth/API
fixtures in actual-App Chromium verified Settings at 1440×900 and 390×844,
capability examples, a persisted pause change, no horizontal overflow and no
console errors. Aggregate checks, physical-device behavior and live provider
acceptance are reported separately.

What Dan tests:
- Discover the supported examples in Settings and ask Jarvis what proactive help is available.
- Change a supported preference by voice and see it appear in already-open Settings.
- Edit a preference in Settings and ask chat to read it back.
- Turn automatic suggestions off and verify automatic behavior stops without changing requested reminders.

24 October review-gap follow-up:
`npm test --workspace @jarvis/backend -- --run src/proactive/tools.test.ts src/proactive/routes.test.ts`
passed all 198 tests after a corrected test assertion. Tests exercise the shared
semantic resolver with synthetic model/interpreter fixtures for varied EN/DA
scope, pause and category language; this proves dispatch, exact-candidate
matching and fail-closed writes, not live model language accuracy.
`npm test --workspace @jarvis/web -- --run src/ProactiveSettings.test.tsx src/ProactiveArea.test.tsx`
passed 37 tests. Backend and web lint and builds passed; the web build reported
its existing large-chunk advisory. Aggregate CI 40129098305 and CodeQL passed
at a7e5205, before this semantic resolver change. CI for the corrected final
head must be checked separately. Live-model/device acceptance remains
unverified.

24 October 2026 interpreter-contract correction:
`npm test --workspace @jarvis/backend -- --run src/core/approval-interpreter.test.ts`
exercises the real `createApprovalInterpreter` with a captured synthetic model
boundary. It verifies the actual proactive prompt covers pause/resume of automatic
suggestions, does not alter explicit owner-requested reminders, and directs
ambiguous/source-management requests to refusal; bare agreement remains blocked
by the deterministic fast path. Model responses are fixtures, not evidence of
live-model language accuracy. Re-run aggregate CI on the corrected head;
live-model/device acceptance remains outstanding.

## Owner-requested reminders (#1239)

Explicit reminders are runtime-only owner requests, separate from automatic
priority-based due reminders. Do not seed schedules, alter task deadlines,
change proactive preferences, or claim device acknowledgement from provider
acceptance. Chat and voice share the owner-bound tool; phone-channel calls are
not accepted. The ticker revalidates stable task identity and stops on
completion, deletion or ambiguity. Quiet-hour times are refused; automatic
reminders for the same task within five minutes of an explicit occurrence are
suppressed.

Focused synthetic checks:
`npm -w apps/backend exec -- vitest run src/proactive/owner-reminder-store.test.ts src/proactive/owner-reminder-tools.test.ts src/proactive/owner-reminder-ticker.test.ts src/proactive/tools.test.ts src/proactive/todo-file.test.ts src/proactive/policy.test.ts src/database/migrations.test.ts`
and `npm -w apps/backend run build`. SQL persistence has not been exercised
against a live database here, and real-device push delivery remains unverified.

Focused local checks:
`npm test --workspace @jarvis/backend -- --run src/proactive/tools.test.ts src/proactive/policy.test.ts src/proactive/engine.test.ts src/proactive/store.test.ts src/proactive/routes.test.ts src/proactive/todo-writer.test.ts src/proactive/alerts.test.ts src/proactive/reminder-ticker.test.ts src/proactive/vault-push-reminders.test.ts src/database/proactive-store.test.ts src/database/migrations.test.ts src/voice/realtime.test.ts src/voice/startup.test.ts src/core/settings.test.ts src/production-modules.test.ts`,
`npm test --workspace @jarvis/web -- --run src/ProactiveSettings.test.tsx`,
backend/web builds and lint. SQL persistence, existing-row migration defaults and
rollback protection are covered by
`npm run test:database --workspace @jarvis/backend -- src/database/schema.integration.test.ts`;
it requires the isolated loopback SQL Server configuration. Local voice tests
cover registration/dispatch inputs, not a live voice-provider session.

## P14-09 overlay verification (18 October 2026)

Local web checks passed: `npm test --workspace @jarvis/web` (1,623 tests,
118 files), `npm run lint --workspace @jarvis/web`,
`npm run build --workspace @jarvis/web`, and `npx tsc --noEmit` from
`apps/web`. The build reports its existing chunk-size warning.

Scratch Chromium used the actual App with scratch-only auth and synthetic API
fixtures. Rendered checks passed at 320×844 and 390×844 touch (71 assertions
each), and 1440×900 dark (56 assertions): focus entry/wrapping/return,
Escape/outside dismissal, dirty-form protection, scroll locking, internal
scrolling, no horizontal overflow, reduced motion and a simulated 400px
keyboard viewport. Pin feedback preceded content without overlap on Settings,
Factory, Notes, Usage and Status. All four capture configurations had no
console errors.

Exit tests cover inert, ID-free visual copies, cancellation on reopening and
both reduced-motion preferences. Closed persistent sheets become inert before
their visual exit finishes. Feedback is excluded from page entrance transforms.

The 24 WebP contact sheets below total 1,486,292 bytes. Each contains actual
browser screenshots with external synthetic-state labels. Dialog sheets show
the project and danger confirmations; overlay sheets show More and its flyout,
Background work and attention, plus navigation/context sheets on phones.

| Viewport/theme | Before | After |
| --- | --- | --- |
| 390×844 light | [Settings](ui/p14-09/before-390-light-settings.webp), [dialogs](ui/p14-09/before-390-light-dialogs.webp), [overlays](ui/p14-09/before-390-light-overlays.webp) | [Settings](ui/p14-09/after-390-light-settings.webp), [dialogs](ui/p14-09/after-390-light-dialogs.webp), [overlays](ui/p14-09/after-390-light-overlays.webp) |
| 390×844 dark | [Settings](ui/p14-09/before-390-dark-settings.webp), [dialogs](ui/p14-09/before-390-dark-dialogs.webp), [overlays](ui/p14-09/before-390-dark-overlays.webp) | [Settings](ui/p14-09/after-390-dark-settings.webp), [dialogs](ui/p14-09/after-390-dark-dialogs.webp), [overlays](ui/p14-09/after-390-dark-overlays.webp) |
| 1440×900 light | [Settings](ui/p14-09/before-1440-light-settings.webp), [dialogs](ui/p14-09/before-1440-light-dialogs.webp), [overlays](ui/p14-09/before-1440-light-overlays.webp) | [Settings](ui/p14-09/after-1440-light-settings.webp), [dialogs](ui/p14-09/after-1440-light-dialogs.webp), [overlays](ui/p14-09/after-1440-light-overlays.webp) |
| 1440×900 dark | [Settings](ui/p14-09/before-1440-dark-settings.webp), [dialogs](ui/p14-09/before-1440-dark-dialogs.webp), [overlays](ui/p14-09/before-1440-dark-overlays.webp) | [Settings](ui/p14-09/after-1440-dark-settings.webp), [dialogs](ui/p14-09/after-1440-dark-dialogs.webp), [overlays](ui/p14-09/after-1440-dark-overlays.webp) |

Pixel inspection covered the phone/light overlay contact sheet; remaining
captures have geometry checks, not complete visual sign-off. Physical keyboards,
live authentication/providers and hardware rendering remain unverified.
The aggregate CI run is draft-skipped; the PR title gate requires `P14-09:`.
Local automated review was unavailable and CodeQL skipped its oversized database.
A separate read-only review found the closed-sheet inertness issue, now fixed.
Proactive SQL contracts are in
`src/database/schema.integration.test.ts` and the narrow conversation reader has
coverage in `src/database/conversation-store.integration.test.ts`; run them only with the isolated
loopback SQL Server fixture via `npm run test:database --workspace @jarvis/backend -- src/database/schema.integration.test.ts`.
Do not report SQL integration coverage unless that service ran.

## Azure operations budget warning period (#1238; 23 October 2026)

Azure's Consumption budget `timeGrain: Monthly` recurs by calendar month. Its
`timePeriod.startDate` is the original activation date, not the current period.
The backend validates that the budget is monthly and derives the activity key
`budget-80:YYYY-MM` from the current UTC date. The original October 2026 key stays
unchanged, preserving existing history; the November key is distinct. The unique
SQL `activity.alert_key` index makes repeats idempotent across polling, restart and
concurrent checks. Dismissal only sets `dismissed_at`, so it does not re-enable
that month's warning. Invalid, unsupported or future period data fails the check.
No Azure budget setting, infrastructure, permission or threshold changes.

Focused checks:
`npm test --workspace @jarvis/backend -- --run src/operations/budget-alert.test.ts`,
backend build/typecheck and lint. SQL deduplication, restart, concurrent recording
and dismissal coverage is in `src/database/schema.integration.test.ts`; run with
`npm run test:database --workspace @jarvis/backend -- src/database/schema.integration.test.ts`
only using the isolated loopback SQL Server fixture. Azure's [budget tutorial](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets)
describes recurring monthly budgets. Unit/integration checks do not establish live
Azure polling or production behavior in a future month.

## P13-12 proactive run alerts (18 October 2026; default off in code, on in production since P13-15)

The alert hook is composed only when the proactive, push and alert flags are all
on and its push store/sender dependencies exist. It alerts only on scheduled or
catch-up runs and only for new, time-critical deadline, clash or travel findings.
The hash-only ledger retries one failed send, settles sent/twice-failed keys and
counts daily pushes by distinct run bundle. The sender rechecks quiet hours;
P13-21 system payloads include bounded stored titles and due times, encrypted
end to end with `aes128gcm`. Details must never enter logs, metrics, errors or job
output, and the payload must not be stored. Titles never repeat `Jarvis`: iOS
adds `from Jarvis` itself, which the app cannot remove. The owner can hide
lock-screen details with Settings → Notifications → Jarvis → Show Previews.
Appearance remains unverified until the owner checks the deployed Test
notification on the device. Since P13-15 only `infra/main.bicep` sets
the alert switch, and `alerts-default-off.test.ts` pins that.

Focused synthetic checks:
`npm test --workspace @jarvis/backend -- --run src/proactive/alerts.test.ts src/proactive/composition.test.ts src/proactive/push-delivery.test.ts src/proactive/alerts-default-off.test.ts src/database/proactive-alert-store.test.ts src/database/migrations.test.ts src/push/routes.test.ts src/push/webpush.test.ts`,
`npm test --workspace @jarvis/web -- --run src/push.test.ts`,
backend/web builds and lint. SQL Server checks are in
`src/database/schema.integration.test.ts`; run only with the isolated loopback
SQL Server fixture using `npm run test:database --workspace @jarvis/backend -- src/database/schema.integration.test.ts`.
Do not claim the SQL integration tests ran unless that service was available.

## P13-13 proactive todo reminders (18 October 2026; default off in code, on in production since P13-15)

The planner and ticker reuse `JARVIS_PROACTIVE_ALERTS_ENABLED` with the existing
proactive and push flags and have no setting of their own; P13-15 (the section at
the top of this file) sets the alert flag in production. The
planner runs for every trigger after the successful todo read. The ticker is
constructed only when its vault, reminder store, alert ledger, push store and
shared sender dependencies are available. It has no database, vault or push
work while idle or during Copenhagen quiet hours. P13-21 reminder details come
from rows already in memory; alert details use read-only item lookups without
marking items loaded or seen, and failed/missing detail reads still send the
count headline. Details go only into the encrypted push payload, never logs or
other telemetry. The worker clamps v2 text (60-code-point title, 240 body,
80 per line), removes controls and preserves legacy generic headlines with empty
bodies. Open tasks from safe
Markdown notes under `Personal/` and `Work/` (excluding Archive and hidden paths)
plus the root task dashboard are eligible when marked `⏫`,
`priority:: P1 - High` or `priority: P1 - High`. `🔺` is not high.
`🕒 HH:mm` works before or after the due date in Copenhagen local time.
Discovery shares path/SHA-cached parsed tasks between source and ticker, with
256-file, 4-MiB-total, 256-KiB-per-file and four-concurrent-read limits under
the existing 20-second abort. Exceeded bounds or partial reads are unavailable;
unchanged SHAs need only the tree listing. Reminder keys exclude note paths.
The writer still targets only the root dashboard and does not deduplicate
suggestions against other notes. The ticker cancels tasks that are no longer
high-priority and suppresses after repeated vault-verification failures.

Focused synthetic checks:
`npm test --workspace @jarvis/backend -- --run src/proactive/todo-file.test.ts src/proactive/todo-discovery.test.ts src/proactive/sources/todos.test.ts src/proactive/reminders.test.ts src/proactive/composition.test.ts src/proactive/alerts.test.ts src/proactive/push-delivery.test.ts src/database/migrations.test.ts`,
`npm run build --workspace @jarvis/backend`, and
`npm run lint --workspace @jarvis/backend`.
The SQL store integration test is
`npm run test:database --workspace @jarvis/backend -- src/database/proactive-reminder-store.integration.test.ts`.
It requires the isolated loopback SQL Server fixture; do not claim it ran unless
that service was available. A todo added after the last check is covered from
the next check on; "Check now" covers it immediately.

## P13-10 proactive web client (18 October 2026)

`VITE_PROACTIVE_ENABLED` is an exact-`true` build flag that is off by default in
code. P13-14 (above) sets it in the production web build only; do not set it in any
other workflow or environment file. Its web-only implementation does not
change the backend, contracts or authorization. The feature gate test
(`config/proactive-switch.test.ts`) scans the repository's configuration files and
pins that one reviewed setting.

Focused web validation:
`npm test --workspace @jarvis/web -- --run config/proactive-switch.test.ts src/ProactiveArea.test.tsx src/ProactiveSettings.test.tsx src/App.test.tsx src/JobsChip.test.tsx src/ProactiveItemPage.test.tsx`,
`npm run lint --workspace @jarvis/web`, and
`npm run build --workspace @jarvis/web`. Run the full web tests with
`npm test --workspace @jarvis/web`.

For visual inspection, use a scratch-only auth/API fixture and the actual web
application in Chromium at 390×844 and 1440×900, light and dark. Exercise the
feature with synthetic responses and reduced motion; never create a production
auth stub, persist fixture content, or use real personal data. Browser fixtures
and screenshots belong outside tracked application assets unless explicitly
approved.

## P13-09 proactive news source (18 October 2026)

The registry includes a dark RSS/Atom news adapter. It validates configured
HTTPS feed URLs, pins DNS resolution to public addresses, rejects redirects and
unsafe XML, and bounds each response to ten seconds and 2 MiB. The source emits
only sanitized title, publication time and feed host facts. It does not turn on
any proactive flag or run by itself.

Focused checks:
`npm test --workspace @jarvis/backend -- --run src/proactive/sources/news-url.test.ts src/proactive/sources/safe-fetch.test.ts src/proactive/sources/news-parse.test.ts src/proactive/sources/news.test.ts src/proactive/sources/registry.test.ts`,
`npm run build --workspace @jarvis/backend`, and
`npm run lint --workspace @jarvis/backend`. Tests use mocked HTTPS and injected
DNS/feed readers only; do not make live feed requests. Do not claim SQL Server
integration tests ran without the isolated loopback SQL Server fixture.

## P13-07 proactive read-only sources (18 October 2026)

Focused synthetic checks:
`npm test --workspace @jarvis/backend -- --run src/proactive/todo-file.test.ts src/proactive/sources/todos.test.ts src/proactive/sources/factory.test.ts src/proactive/sources/weather.test.ts src/proactive/sources/registry.test.ts src/proactive/time.test.ts src/database/task-store-proactive.test.ts src/core/weather.test.ts`,
`npm run build --workspace @jarvis/backend`, and
`npm run lint --workspace @jarvis/backend`. The backend build is the TypeScript
check. The SQL snapshot is covered by the isolated database integration suite
only when its loopback SQL Server fixture is available; do not claim it ran
otherwise. No source flag is enabled by these checks.

## P13-11/P13-20 proactive suggested-todo writer (18/21 October 2026)

P13-20 replaces the former root-dashboard destination and selection behavior.
The writer now targets only existing Personal/Work inboxes and stores a
content-free skip reason for excluded project suggestions or ambiguous scope.
Its receipt key hashes stable cited source identities, not finding wording,
category, elapsed time or the selected inbox. Missing or unverified destinations
fail closed. The writer never changes old `Suggested by Jarvis` lines.

The writer is constructed only inside the enabled proactive composition and
only when `JARVIS_PROACTIVE_TODO_WRITES_ENABLED` is exactly `true`. The flag
defaults off in code; since P13-15 only `infra/main.bicep` sets it, and
`src/proactive/todo-writes-default-off.test.ts` pins that. The existing
pause/Todos switches and independent writer flag are the controls.
The writer also requires the SQL pool for durable receipt and daily-cap storage.
The hook keeps the P13-07 bounded limits and uses read-only task discovery for
duplicates; its only write destinations are `Personal/Inbox.md` and
`Work/Inbox.md`. It does not create or delete files and logs no suggestion text
or vault path. SQL receipts are covered by the isolated schema integration suite.

Focused checks:
`npm test --workspace @jarvis/backend -- --run src/proactive/todo-writer.test.ts src/proactive/todo-lines.test.ts src/proactive/prompt.test.ts src/proactive/engine.test.ts src/proactive/sources/todos.test.ts src/proactive/sources/mail.test.ts src/proactive/sources/calendar.test.ts src/proactive/sources/calendar-reader.test.ts src/proactive/sources/news-parse.test.ts src/proactive/sources/news.test.ts src/proactive/sources/weather.test.ts src/proactive/sources/factory.test.ts`,
`npm test --workspace @jarvis/backend -- --run src/config.test.ts src/logging.test.ts src/logging-source.test.ts src/proactive/todo-lines.test.ts src/proactive/todo-writer.test.ts src/proactive/composition.test.ts src/proactive/todo-writes-default-off.test.ts src/proactive/store.test.ts src/database/proactive-todo-store.test.ts src/database/migrations.test.ts src/vault/vault.test.ts`,
`npm run build --workspace @jarvis/backend`, and
`npm run lint --workspace @jarvis/backend`. SQL Server checks use
`npm run test:database --workspace @jarvis/backend -- src/database/schema.integration.test.ts`
with the isolated loopback database; do not claim them without that service.

## P13-08 proactive calendar, mail and travel sources (18 October 2026)

P13-08 adds registered read-only calendar, metadata-only mail and
calendar-derived travel sources, but does not invoke them or enable any flag.
Calendar facts use Europe/Copenhagen midnights and bounded pagination; Gmail
reads no body, snippet or attachment; travel has no external provider.

Focused checks:
`npm test --workspace @jarvis/backend -- --run src/proactive/time.test.ts src/proactive/sources/registry.test.ts src/proactive/sources/calendar-reader.test.ts src/proactive/sources/calendar.test.ts src/proactive/sources/mail.test.ts src/proactive/sources/travel.test.ts src/google/tools.test.ts`,
`npm run build --workspace @jarvis/backend`, and
`npm run lint --workspace @jarvis/backend`.

## Chat acceptance pacing and rate-limit recovery (#1232, 25 October 2026)

Read a failed chat check's safe reason in the acceptance artifact first; never
call smoke, model or provider endpoints to investigate an old run. A bare
`agent_error` is now an unexpected exception that is neither a labelled
backend-side failure nor a hosted error event. Backend-side failures report
`agent_auth_unavailable`, `agent_request_failed`, `agent_http_<status>`
(`agent_http_other` for an unlisted status), `agent_response_invalid`,
`agent_stream_failed` or `agent_stream_ended`. A hosted error event without a
safe code is `agent_error_code_missing`; with an unlisted code,
`agent_error_code_unlisted`. `rate_limit_exceeded` is an allowed hosted, canary,
smoke-log and artifact reason, not an unlisted error. The agent-defined
`tool_loop_stalled` code is also preserved as a fixed safe reason. Degraded
identity and no-timestamp reasons appear as `not_reported_or_redacted` in
artifacts (open web clients accept HTTP reasons only for down checks); read them
in the `system.smoke_check` events instead.

`rate_limit_exceeded` retries a check once. A numeric SSE `retry_after`
(seconds) or HTTP `Retry-After` hint sets the wait, clamped to 30–60 seconds;
without a valid hint it waits a full 60 seconds after the rejection. Retries
re-enter the same pacing queue. A second throttle fails with the named reason,
including `chat_canary`; other second-attempt failures retain their actual reason.
`chat_github_read` also retries `github_issue_unavailable` once, through the same
queue without the rate-limit backoff. Both retry causes share a two-attempt cap.
A successful `github_read` / `issue_get` receipt for issue 700 with a nonblank
title passes without requiring the reply to repeat the title. A failed retry
retains its actual safe reason in acceptance/release evidence; other errors,
assertion failures and timeouts never retry. A rescued first
throttle is not retained in the report; inspect dependency telemetry too. #816's
coordination client is never opened for smoke turns; the agent test
`test_smoke_invocations_open_no_coordination_connection` pins that.

The acceptance-only queue starts hosted calls at least eight seconds apart and
allows at most three active calls, including the plain-approval follow-up and
retries. Eight hosted calls (roughly 15 model calls) span at least 56 seconds.
Expect about 60–90 seconds without throttles; rate-limit recovery and slow calls
can take longer, bounded by a 240-second suite deadline and 25 seconds per active
hosted call. The deployment request allows 250 seconds within the unchanged
five-minute job timeout. Normal chat and retained Status reads bypass this queue.
No capacity or infrastructure change is part of this fix.

Several `chat_*` checks failing together with `rate_limit_exceeded` (or historical
`agent_error_code_unlisted`) while the
backend tool callbacks return 200 is not automatically a flake. Before rerunning,
query the Foundry Responses API `invoke_agent` dependency spans in Application
Insights (`AppDependencies`, `error.type` in the span properties) for
`rate_limit_exceeded`. The acceptance run sends about 15 Chat model calls and 57K
to 66K input tokens in one minute, which exceeded the 50,000 tokens per minute of
the `gpt-6-astra` deployment until its capacity was raised to 150 on 23 October.
Failures recurred at capacity 150 on 25 October: short bursts, not just minute
totals, matter. Check actual call spacing, concurrency and retry timing before
rerunning; do not assume an authentication failure or raise capacity as a fix.
Completion still requires two consecutive production releases passing acceptance
on their first attempt with no throttled dependency spans, checked after each
deploy. Unit tests are not that live verification.

Targeted commands:
`npm test --workspace @jarvis/backend -- src/core/chat-agent.test.ts src/core/chat-canary.test.ts src/system-status.test.ts`,
`$env:PYTHONPATH='.github\scripts'; python -m unittest discover -s .github\scripts\tests -p "test_smoke_reasons.py" -v`
and, from `agents/jarvis`, `python -m pytest tests/test_chat_runtime.py -k smoke`.
Local limits: a fresh worktree cannot restore the backend dependency tree (the
configured feed lacks `ip-address@10.7.4`), so the three backend files were run
locally only through an uncommitted vitest alias that stubs `voice/relay.ts`
(219 tests passed); the agent test cannot import `azure.ai.agentserver` locally
and is left to CI. Normal pinned CI remains the authority.

## Fixed hosted origins in acceptance evidence (#820, 17 October 2026)

The canary now retains only explicitly enumerated `ChatAgentError.code` values
already emitted by hosted chat. `settings_*` codes identify the settings
boundary, `capability_instructions_too_large` identifies its existing budget
validation, and `catalogue_unavailable`, `context_unavailable`,
`usage_unavailable` and `response_too_large` name their existing boundaries.
Fixed `error_*` entries retain only known exception-class categories; for
example, `error_runtimeerror` locates a hosted runtime failure but does not prove
its exclusive cause. Unknown codes, code-shaped private text and untyped
exceptions remain `agent_error`, not invented diagnoses.

The existing smoke formatter and immutable acceptance/release artifacts retain
the same allowlist. No raw response, message, provider body, tool data or new
field/store is added; existing source/tree/run/component identities remain.
Required failures still fail. Read pipeline evidence for the exact qualified
release; do not call smoke/model/provider endpoints to investigate an old run.
Deploy39043117488's generic capabilities failure and earlier plain-approval/
GitHub/navigation failures have no established shared cause.

Targeted commands:
`npm test --workspace @jarvis/backend -- src/core/chat-canary.test.ts src/system-status.test.ts`
and
`$env:PYTHONPATH='.github\scripts'; python -m unittest discover -s .github\scripts\tests -v`.
The local backend command is blocked before collection because `vitest` is
absent. Do not substitute another checkout's graph or start restore loops;
normal pinned CI supplies backend lint/test/build qualification. Local Python
uses3.11.15, not the pinned CI3.12 baseline. All122 script tests pass locally
with `GITHUB_RUN_ATTEMPT=2`; scoped Ruff and whitespace checks pass. Preserve the app-managed runtime;
no exposed `/remote` control is available and remote-enabled state is unverified.

## Ready/draft qualification race (#880, 17 October 2026)

#882 merged with its exact qualified tree as `f6530a59`. Its automatic
Deploy39041096612 passed all eight jobs; verified receipt12104850448 reports
all four components applied and accepted=true, backend revision0000341 and
agent109. All required smoke entries passed; only the existing nonblocking
PC bridge was down. No historical generic agent_error cause/fix is established.
This first baseline does not prove subsequent reuse/sensitive readback.
During #881 integration, ready_for_review at14:32:35Z admitted CI39041201026;
a delayed synchronize event carrying draft=true admitted39041201353 one second
later. The shared concurrency key cancelled the ready qualification, then the
draft snapshot skipped itself. This is a pipeline event-order failure, not an
observed Daily source failure.

One safe recovery reruns only cancelled ready-event39041201026 attempt2 at
exact integrated520c9ba8, preserving impact selection and its non-draft
snapshot. No active CI overlapped; green CodeQL/review were not rerun.
The bounded correction gives draft snapshots a separate concurrency suffix.
Ready head updates still supersede older ready qualifications; delayed skipped
draft runs cannot cancel them in either admission order. The synthetic workflow
regression and actionlint cover the key; required selection/result gates remain
unchanged. Draft snapshots also publish a different, explicitly unqualified
aggregate check name: a newer skipped draft check cannot satisfy the required
`CI result` context while the ready qualification runs.

The single #881 recovery exposed one pipeline test-fixture error on attempt2:
the latest-run fixture implicitly inherited `GITHUB_RUN_ATTEMPT` and mocked the
wrong API response shape. Pin that fixture to attempt1 and separately exercise
attempt2's previous-attempt receipt lookup. No production fallback or check
waiver is added; the whole script suite is checked under a synthetic attempt2.
All118 cases pass locally with `GITHUB_RUN_ATTEMPT=2`, plus scoped Ruff,
actionlint and whitespace checks. Normal exact-source qualification/review
remains required. Daily's subsequent first-attempt green run is not a repair
receipt for this attempt-sensitive fixture; no second recovery was dispatched.

## Continuous delivery ownership (#880, 17 October 2026)

Dan selected operating model 2. This supersedes the older coordinator-removal,
combined-batch, coordinator-test and routine human release-acceptance instructions
below for this repository's delivery work.

- The coordinator handles intake, canonical GitHub backlog/board state, dispatch,
  integration and mechanical merge conflicts only. Keep it responsive; it does
  not develop features, run tests, investigate logs or reproduce reported bugs.
- At most two implementation builders are active. A builder owns its code,
  automated regression tests, exact-candidate CI failures and failure fixes.
  Route pipeline evidence to that existing builder, not a new diagnostic worker.
  Use completion events; do not recreate the old recurring timer or change
  host/session autopilot settings.
- Every feature, bug and real-world test report becomes an issue or a clearly
  linked update to existing backlog work. GitHub Project 2 is canonical:
  Ready means queued; worker label/draft PR means In progress; ready linked PR
  means In review; unresolved dependencies/deferred work stay Backlog;
  genuine authority decisions use Needs Dan. Done follows actual issue closure,
  not a worker's claim. Applied/accepted release facts remain in pipeline receipts.
- Qualified current-main-compatible source flows through the existing main-only
  release path without a batch cutoff or routine Dan sign-off. Required failures
  still block release acceptance. Historical failures remain failures; a new
  successful run does not rewrite them. Real-world reports do not authorise
  coordinator reproduction campaigns.
- Builders publish a reviewable PR and return exact PR/head/run/artifact evidence.
  The integration owner merges only after all required checks/review pass and
  latest-main reconciliation. A builder never merges its own PR.

`ci.yml` selects affected checks and dependencies with `pipeline_impact.py`.
The lightweight workflow-script tests always run; shared/unknown changes and
unusable bases keep full coverage. `CI result` rejects failed, cancelled,
missing or unexpectedly skipped selected checks and publishes immutable
`ci-evidence-<attempt>` with the tested Git tree, PR/head/run and owning issue IDs.
Deployment requires a successful exact-tree receipt before any Azure job.
Do not substitute another revision's green badge or manually dispatch CI just
to obtain a duplicate green result.

Deploy records `release-evidence-<attempt>` even when final acceptance fails.
It separates component input fingerprints, image digests/web bundle hash,
original producer source/run/attempt, deterministic readiness, and live
conversation acceptance. The latest trusted main receipt, not the latest
wholly green release, controls reuse. Missing/expired/invalid state is not a
cache hit; a newer unknown/partial state cannot be bypassed with an older green
receipt. Bicep/configuration changes invalidate downstream application state.
Vault-mirror Dockerfile copy inputs and `.dockerignore` select infrastructure;
the existing infrastructure invalidation then reapplies all components. Docs-
only changes do not select deployment, and the image/resources remain opt-in.
Superseded source cannot deploy, including manual dispatch.
Sensitive budget-contact configuration is not hashed into either receipt.
Only after exact qualification, a candidate infrastructure reuse reads the
existing `jarvis-alerts` recipients through the same main-only deploy identity
and compares them in memory with the protected configuration. A mismatch
reapplies infrastructure and downstream components; missing/invalid readback
blocks. No value, hash, new secret, role or version marker is retained.
Supersession uses the verified applied-source horizon, not a newer docs-only
`main` commit that has no deployment.
The plan's read-only GitHub permissions include pull requests, required by
commit-to-merged-PR qualification lookup. A backend receipt retains immutable
image `origin` separately from `revision_origin`: an agent-only identity update
is an applied backend revision produced by that agent job's actual run/attempt,
not a newly built backend image. Reuse requires both provenance records.

For a failed release, hand the existing builder its linked qualification PR,
source/tree, run/attempt, exact artifact identity and fixed failing check/reason
codes. The raw smoke response is never uploaded. Missing diagnostic evidence is
explicitly unavailable, not inferred from a generic `agent_error`. No unchanged
diagnostic release, speculative retry or new live conversation probe is justified
by this agreement. GitHub's failed-jobs retry can retain successful components
and their original producer attempts; a deliberate whole-run retry can reuse
the preceding attempt's compatible receipt.

Local checks use the standard library:
`$env:PYTHONPATH='.github\scripts'; python -m unittest discover -s .github\scripts\tests -v`.
The 35 pipeline, seven formatter and 11 planner cases pass locally, as does
scoped Ruff. Pinned actionlint 1.7.12 passes after excluding only its unsupported
schema diagnostic for the already-present `concurrency.queue: max`; the queue
protection remains unchanged. Initial full local discovery found a missing
`run_attempt` in one new synthetic fixture; its correction passes the narrow
suite. Normal CI is the full-runtime authority, not that partial local run.
Initial exact-head CI39038876598 passed all12 jobs and CodeQL39038876634
passed all four analyses at43aa1af2. Its review identified the secret-derived
fingerprint issue above; the correction requires successor normal qualification,
not reuse of that earlier green receipt. No secret-bearing release ran from it.
Successor ca9a CI39039891173 and all four CodeQL39039891273 analyses passed.
Its exact-head review identified the missing plan read scope and agent-created
backend revision attribution above; both corrections require new-source normal
qualification, not a duplicate rerun of ca9a's green checks.
Copilot-ready dispatch passes its existing PR number to CI; the result gate
checks live ready-PR/head/base identity before emitting qualification evidence.
Offline Bicep CI pins 0.44.1. Existing local
missing-Fastify/jose constraints do not justify restores, stubs or another
worktree's dependency graph. This app-managed isolated runtime has no exposed
session `/remote` control; `/remote` and `copilot --remote` state remain
unverified. Preserve host configuration and do not launch a replacement CLI.
No new Azure access, credentials, roles, resources, private provider traffic,
Daily activation/import/device changes or interference with Dan's tabs/5173.

## Inactive Daily feed tool checks (17 October 2026; P12-09)

Use synthetic fixtures and existing tooling only. `daily_feed` is installed only
by explicit `DailyData.feeds`; optional fifth `createDailyData` feed dependencies
reuse the current pool/change hub and existing Google/semantic adapters without
calling them during construction. Missing Google configuration refuses refresh;
missing semantic configuration retains its real independent error. Every feed
entrypoint denies the nutrition-only connector. No production registration,
consent/scope/setup, original-source/schema/data, provider, device or activation
action is authorised.

This fresh isolated worktree has no npm dependency tools. Targeted
`npm test --workspace @jarvis/backend -- src/daily/feeds/attention.test.ts
src/daily/feeds/calendars.test.ts src/daily/feeds/refresh.test.ts --maxWorkers=1
--no-file-parallelism` and `npm run build --workspace @jarvis/backend` fail before
execution because Vitest/TypeScript are absent. No restore, substitute graph or
pass is claimed. Python Ruff passes both changed agent files; selected
`test_jarvis_tools.py` timeout cases cannot collect without OpenTelemetry.
Normal pinned CI must qualify actual new service/schema/module/audit/native
confirmation, relay/agent deadlines and isolated feed SQL cases, followed by the
coordinator's integrated candidate. The implementation owner fixes code failures.

The app-managed runtime exposes no supported existing-session `/remote` control.
Its state is unverified; no replacement CLI/profile or reconnection is claimed.
#724/#725 stay open; stored-grant/CalendarList/live-model/provider, private
reconciliation, physical-device and cutover acceptance remain separate.

Initial pinned CI39038540472 at085ab460 passed all other component jobs and
3794backend cases, including all22new service/native-confirmation and17schema
cases, but the new dispatcher test failed its non-owner HTTP403 assertion.
Root auth intentionally admits verified human identities; resource authorisation
belongs to the tool/service, and the dispatcher returns the normal200/error
envelope. Add the same feed-owner guard to the tool boundary so even an injected
service cannot bypass it. Assert error metadata/redaction and zero service calls
for non-owners, retaining root403 checks for runner/nutrition-connector roles.
The original failure remains recorded; the corrected head requires qualification.

Integrated520c's automatic review5558252668 found the180second enclosing
deadline could not fit a valid120second review plus60seconds of provider work
and persistence. Only `daily_feed` now uses210second service/relay and225second
hosted-agent read deadlines below unchanged240second ingress. Food tools retain
180/210seconds. A deterministic real-native-confirmation/refresh lifecycle test
approves at119seconds, spends59seconds in provider reads and10seconds persisting,
then asserts the actual completed attempt at188seconds without cancellation.
The synthetic test maps AbortSignal deadlines to its controlled clock; production
timers are unchanged apart from the exact feed budget.

801e CI39041917082 passed all selected checks and CodeQL39041917062 all four
analyses, but independent review5558345536 found suppression1001 could poison
bounded reads and restoration. Additions now enforce1,000 active entries per
type under the existing owner lock; updates/no-ops stay valid. Exact-key
restoration no longer depends on full listing. Synthetic real-SQL coverage
tests both exact capacity boundaries and recovery from a seeded oversized set;
service native review also proves restoration when listing is unavailable.
No limit increase, schema change, automatic deletion or acceptance waiver.

Initialf069 CI39043061387 passed application checks and234SQL assertions, but
both new oversized-list controls exposed the feed transaction replacing an
already sanitised `ToolFailure` limit message with generic persistence failure.
Preserve known safe `ToolFailure` alongside `ToolRefusal`; unknown exceptions
remain sanitised. The exact capacity/update/restore assertions before that
point passed. Keep the initial failure; successor qualification is required.

## Safe release reason logging (17 October 2026)

Deploy smoke status lines and the required gate remain unchanged. The standard
library `smoke_reasons.py` helper emits only fixed chat-check/reason code pairs.
Unknown, absent or mismatched reasons are explicitly redacted; raw details,
responses, tool arguments, provider bodies and report contents are never printed.
CLI reads at most64KiB and fails explicitly on invalid/unreadable reports.
Seven new formatter/wiring/redaction/CLI cases plus five existing smoke cases
passed locally; Ruff passes. No dependency or runtime identity change.

Historical #879 used the previous all-workflow deploy policy. #880 replaces
that policy with exact component inputs and job-specific recipes; it does not
waive any required failure or introduce an Azure identity. Bicep0.44.1 passed offline build/lint;
do not upgrade the tool or use local Azure APIs. Normal exact-head CI/review and
the established main-only workflow are the release boundary.

## Retained brief-history checks (17 October 2026; inactive P12-14 source)

Final a947 qualification passed normal CI39028701880, all10 jobs
(backend3754/SQL231/web1081/contracts48), four actual analyses and exact review.
Normal mergecca9 matches qualifiedb048. Deploy39029329877 applied backend339/
web and passed health200/root/settings, but **failed required chat acceptance**.
Attempt1: GitHub chat read down/aggregate canary down; attempt2's single bounded
smoke-only diagnostic recheck recovered that but navigation was down. PC bridge
and identity warnings remain separately nonblocking. No further retries,
timeout increases, gate weakening, credential borrowing or direct Azure access.
Existing component job timestamps prove no rebuild on the recheck. Need retained
`system.smoke_check` reason codes or authorised operator telemetry; pipeline logs
print only IDs/statuses. User unavailable is not a permission waiver. This release
must not be reported as fully verified or trigger another unchanged deploy.

The source adds bounded metadata/history and exact body reads from existing
`briefing_runs` to the same query/tool/page. No migration, new store, notification
job, schedule, grant or provider call. Preserve raw stored timestamp/ID ordering;
unknown source time cannot become freshness. Briefs explicitly refuse the
nutrition-only `dailyConnectorPrincipal` in both service and reader; the shared
owner resolver intentionally permits that principal for nutrition, so it is not
a sufficient resource check on its own. Existing nutrition MCP stays allowlisted
to its three nutrition sources.

Local native contract4 checks, focused web25 checks, full web types and scoped
web/backend lint pass. A compiler ref-taint warning from a handler-object prop
was corrected with conventional event props; final page9 cases passed, including
brief cursor/detail/back restoration and escaped body text. Real shared HTTP/
tool/auth and added real-SQL case/cursor/body-budget/owner isolation checks are
authored for normal pinned CI; no local runtime/SQL pass or dependency restore
is claimed on the known missing-Fastify/jose graph.

Actual App with synthetic data/auth only was inspected at1440px desktop dark,
390px touch light and320px touch dark. Brief history/detail/back, verbatim
timezone-less timestamp, literal nonexecuted script text and metadata/body
separation worked; no page overflow, under44px controls or off-origin resources
were observed. This is not private imported-history or physical-phone proof.
The single-page foundation #877 is already released/receipted; do not requalify it.

First665 CI's final real-SQL byte assertion exposed SQL bigint-as-text; compare
with BigInt while retaining the exact threshold. Source review found expanded
v1 capability advertisement would reject cached clients. Correct with explicit
Accept-negotiated capability v2, original v1 source list and new-client v1
fallback; keep every query-string selector rejected and shared CORS unchanged.
Added native contracts, real HTTP old/new consumer and client compatibility cases.
Corrected source requires normal exact-head qualification before release.

## Inactive Daily page checks (17 October 2026)

P12-34 (18 October 2026) replaces the legacy presentation described below.
From `apps/web`, run `npm test -- src/daily/DailyPage.test.tsx src/daily/sections/data/DataRecords.test.tsx src/daily/DailyHome.test.tsx src/stylesheets.test.tsx src/daily/ui/svg-cascade.test.ts`
for focused Data coverage; `npm run lint`, `npm run build` (includes typecheck)
and `npm test` are the existing complete web checks. Old browser assertions
change only for the page-status wording, “Not recorded,” the kit chart markup,
and workout/brief actions moving into readable record details.
The responsive tests cover phone cards, breakpoint changes, field units,
raw-record disclosure, close/Escape focus return, shared periods, source callbacks,
partial freshness, loading/Retry/empty states and pagination boundaries.
Refresh regressions also verify stable detail selection after reordered records,
raw disclosure/focus retention when the read timestamp changes, and focus
recovery when the selected record disappears.

Synthetic captures under `docs/ui/p12-34/` use the actual App with scratch-only
sign-in and API fixtures, Chromium and an advisory-checked scratch browser driver.
No fixture configuration or browser dependency is added to the repository.
The browser transport tool was unavailable. Desktop/mobile light/dark geometry,
detail/raw-record keyboard behavior, chart readout/table alternative, paging
focus, lower coverage evidence and sync facts were exercised; no console errors
were observed. Native 320px and desktop 200% CSS zoom have no page overflow.
Combining 320px with 200% CSS
zoom exposes the existing shell's `body { min-width: 280px }`; shell geometry is
outside this presentation change. Physical phones and live owner data remain
unverified. The image viewer's one-image limit prevented a complete final
pixel review of every capture; final browser geometry and interactions were
checked independently of the captures.

Use the existing approved x64 Node22.23.3 and pinned single-React graph; do not
restore or stub missing backend/contract dependencies. From `apps/web`, the
focused Vitest selection is `daily/presentation`, `daily/client`, `daily/DailyPage`,
`page-navigation`, `App` and `NowFeedPanel` with native config, one thread and no
file parallelism. It passed144; a subsequent test-only compiler lint correction
retained the owner-remount assertions and that case passed again. Web types,
changed-source web/backend ESLint, capability-instruction15 checks, contract JS
syntax and whitespace checks pass. Earlier failed harness/lint attempts remain
evidence, not baseline source failures. Full contracts collection failed before
assertions because Fastify is absent locally; normal pinned CI must qualify it.

Keep the private default-false App prop, production bootstrap/public configuration
and all locks unchanged. Browser inspection uses actual App source on an owned
temporary local fixture with conspicuously synthetic records/auth/API, never
real login, provider data or the other owner's released5173. Browser viewport/
touch checks are not physical-iPhone, provider or imported-data proof. Do not
stop shared Chrome services or other tabs; dispose only owned page/fixture.
Actual inspection covered1440px desktop/dark and390/320px touch/light/dark,
native date-picker application with loaded-period/focus readback, cursor paging,
same-date chart points, workout/detail/heart-rate, separate sync facts, empty/
503 recovery and403 row clearing. Default-off composition showed no Daily link,
heading or Daily API requests. No off-origin resources were observed; deliberate
synthetic503/403 were the recorded console errors. The reduced setting produced
a0s records transition; OS reduced-motion emulation and physical phone remain
unverified. Final640px wide table scrolls within a236px region at320px, including
actual ArrowRight scrolling, without page overflow. Eight page cases passed
again after that final layout correction.

## Daily overview page checks (18 October 2026; P12-15)

The Daily area opens on an overview (`daily/DailyHome`, `DailyOverview`, the cards
in `sections/overview`) behind the build-time switch `VITE_DAILY_ENABLED`
(see "Daily switch checks"). From `apps/web`, run
`npx vitest run src/daily/sections/overview src/daily/DailyHome.test.tsx src/daily/DailyPage.test.tsx config/daily-switch.test.ts src/App.test.tsx`,
then `npx tsc --noEmit` and `npx eslint <changed files> --max-warnings 0`. Run
one heavy command at a time. A Vitest worker that stalls on start is the pool's own
start timeout, not a test failure, so retry it once. The tests mock `fetch` with
synthetic responses and check concurrency (at most two reads), refresh and retry,
focus movement on Open and Back, the Daily-off navigation and the build switch
values.

Browser inspection uses a temporary harness page and entry file under `apps/web`
that mount the real `DailyHome` with the real stylesheet and a synthetic `fetch`
(not committed; delete both afterwards), served by Vite on a spare port with
`VITE_DAILY_ENABLED=true` in the shell environment only. Never use another
session's port or tab, and never real login, records or provider data. The
harness has no 3D stage, header or MSAL, and OS reduced-motion was not emulated,
so none of that is claimed. Phone width means 390×844 touch plus 320; also check
768 and 1280. Local runs and synthetic-browser checks are not qualification: CI is
the authority, and no live record, physical phone or Daily activation is proved.

## Workout lift log checks (P15-17 / #1423)

Use synthetic lift entries only. From the repository root, run
`npm test --workspace @jarvis/web -- src/daily/presentation.test.ts src/daily/lifts-client.test.ts src/daily/sections/track-workout/TrackWorkoutSection.test.tsx src/daily/sections/overview/LastLifts.test.tsx`,
`npm run build`, and `npm run lint`. Backend coverage includes
`src/daily/lifts/lifts.test.ts`, `src/daily/lifts/lifts-store.test.ts`,
`src/daily/routes/lifts.test.ts`, `src/daily/query.test.ts`,
`src/daily/index.test.ts` and `src/database/migrations.test.ts` from
`apps/backend`; the migration test checks the offline reverse batch. Contract
guards live in `packages/contracts/src/daily.test.js`.

The shared read path is `/daily/query` with source `daily.health.lifts`; recent
history is cursor-paged, while `lastPerExercise` returns one latest active entry
per normalized exercise key. Write routes are owner-only, and the Jarvis agent
does not receive access. Keep the iOS client on these same routes; this issue
does not authorize an iOS screen or endpoint.

## Daily view tool checks (18 October 2026; P12-16)

`daily_show` (`apps/backend/src/daily/tools/show.ts`) and its pure builder
(`daily/show/views.ts`) show queried Daily data as a table, chart, detail or text
in the workspace. Nutrition trends can chart one selected nutrient from bounded
per-day results; unknown and lower-bound values remain disclosed. The shared
query/show descriptions guide intent selection, while backend source, period,
selector and coverage validation stays deterministic. From `apps/backend`, run
`npx vitest run src/daily/show/views.test.ts src/daily/tools/show.test.ts src/daily/query.test.ts`.
`composition.test.ts`, `index.test.ts`, `production-modules.test.ts` and
`routes/query.test.ts` build real Fastify applications or the whole module list, so
they need the pinned CI graph where those packages are unavailable locally. From
`apps/web`, run `npx vitest run src/GeneratedViewRenderer.test.tsx src/styles.test.tsx`,
then `npx tsc --noEmit` and `npx eslint <changed files> --max-warnings 0`. Run one
heavy command at a time. Every check uses synthetic records and a fake workspace;
none reads real data, calls a provider or probes a live service. The tool takes no
new environment variable and its tests need no secret.
The synthetic tests do not verify a live model/provider's English/Danish
interpretation, real Health records or a physical device.

Browser inspection follows the harness rules of the overview page section: a
temporary page under `apps/web` mounts the real `Workspace` window with the real
stylesheet and real builder output, is served on a spare port and is deleted
afterwards. Check 390×844 touch in dark and light and 1280×800: no horizontal
overflow, the source footnote inside the window and legible, whole words and numbers
in every table cell, and no console errors. The harness has no sign-in, 3D stage or
navigation rail, and keyboard focus and OS reduced-motion were not exercised, so
none of that is claimed. Local runs and synthetic-browser checks are not
qualification: CI is the authority, and no live record, physical phone or
acceptance is proved.

## Internal Frida binding checks (17 October 2026; P12-09)

The current source-only continuation registers owner-authenticated
`daily_food_lookup` only with an explicit `DailyData.foodLookup` capability.
Optional adapter injection reuses the existing data-owner guard and Frida
client; neither construction nor ordinary Daily composition contacts a provider.
No new access/token/credential, live Frida request or private data is authorised.
Keep real provider/device acceptance separate, including the retained earlier
cloud CONNECT403 limitation.

Pure lookup-schema checks pass9 on the existing approved Node22/Vitest5 graph;
changed TypeScript ESLint passes all10 source/test files with zero warnings.
Actual Fastify/null roundtrip, callback cancellation/budget/size/error,
data-owner/no-SQL, optional composition, ordinary voice30second control and
unchanged external protocol semantics require normal pinned CI. No local
full-graph pass, restore, stub or live browser/provider proof is claimed.
Reference lookup uses20seconds, below unchanged ordinary tool deadlines; never
increase the caller budgets or add approval for this read.
Actual a8 CI39012012991 passed all10jobs: backend200files/3746tests,
lookup5/schema9/realHTTP1/composition7/externalMCP34/realVoice173; SQL230 and
agent732/runner374Python. Four actualCodeQL39012012938 analyses and automatic
exact-head review6230967513 passed without findings. Global ProjectBoard
concurrency cancelled a metadata-only job; recover only that job, not source CI.
After its successful recovery all fresh guards passed: normal #876 merge9334d3ed
has qualifiedtree6da17b0c. Deploy39012842333 selected backend only, ready0000337,
health200, actual13/15smokeok with PC bridge down/recurring identity degraded.
No causal source/auth attribution or extra canary. Receipt6231173591 and #724
opening matched independent readbacks; this inactive release is finished.

## Food photo estimates and checks (22 October 2026; #1196)

Use the existing conversation attachment and image-capable model paths. Frida
resolves only generic food nutrients; it does not recognize food or measure
portions. The existing `daily_food_review` groups read-only `lookup_components`
and final `log_estimate`, preserving the tool catalogue count and the 128-name
ceiling. Final component inputs are resolved again server-side before totals
and the exact browser Now proposal are built. Unmatched identity, missing
grams/calories and unknown macros remain explicit; no write occurs before the
existing approval callback. Photo capture and source fingerprints derive from
validated persisted attachment references, not model/tool arguments. Daily
remains default-off; public Frida availability and physical-device acceptance
are not established.

Focused source checks passed: backend food review/composition/lookup tests
(73 tests), backend build and lint, backend conversation/history persistence
tests (74 tests), web conversation attachment tests (19 tests), and the existing
agent image-input tests (`agents/jarvis/.venv/bin/python -m pytest -q
agents/jarvis/tests/test_image_context.py`, 68 tests). Do not interpret local
synthetic tests as live provider, deployment, or device acceptance.

Food review confirmations keep the existing 4,000-character Now cap. Corrections
summarize only changed fields and relevant unchanged context; estimates and
deletions show compact complete details. Oversized reviews refuse without
truncation, with a recovery that does not require splitting an existing meal to
rename it. Run the focused summary, tool-path and expiry regressions with:
`npm test --workspace @jarvis/backend -- --run src/daily/nutrition/review.test.ts src/daily/tools/food-review.test.ts src/core/owner-interactions.test.ts`.

## Internal Daily saved-food checks (17 October 2026; P12-09)

The current source batch groups owned lookup/preferences and four native-reviewed
saved-food mutations in `daily_saved_food`. Use only synthetic owned records.
The additive fifth factory preserves existing four-argument callers and every
default-off/read-only/external gate. Check frozen source/plan snapshots, native
one-time approval, revision/fingerprint guards, real replay/uncertain readback,
unknowns versus zero and persisted preference clears. No new intake/Health row
may result. Preference commits refresh favourites, not meals; replays stay quiet.
Real loopback SQL coverage appends after earlier count-dependent fixtures.

Pure `saved-schema.test.ts` passes 10 cases locally with approved Node22 x64
and pinned Vitest5, native config, one thread/no parallel files. Actual
Fastify/Ajv, tool/relay/application, SQL and Python semantic qualification still
requires the existing pinned CI graph; local Fastify/jose/OpenTelemetry are
unavailable. Do not restore, stub or alias those imports. Initial changed-source
TypeScript lint passed; Ruff caught two new test lines over 100 characters.
Both lists were formatted without suppressing the rule; successor Ruff and the
last saved-tool lint pass. Preserve that initial lint failure.
Both final voice relay source/test files also pass the same existing ESLint
with zero warnings; no local live browser or actual relay semantics are claimed.

Trace every wrapper before publication: the browser relay separately imposed
30 seconds before native food execution. The source correction gives only
`daily_food_review`/`daily_saved_food` 180 seconds there. Real WebSocket fixtures
check the exact budget, recorded outcome, privacy and session-end cancellation;
all other tools retain their default. The hosted agent gives both tools210
seconds below ingress240. Native approval remains120 with shared SQL/card/timer
expiry; no detached writer or live-account/device acceptance is introduced.
Actual final14e CI39009675867 passed all10jobs:197backendfiles/3729tests,
SQL11files/230tests with20nutrition, agent732/runner374Python. Four actual
CodeQL39009675825 analyses and automatic exact-head review6230639748 passed
without findings. Normal merge195bc89c has qualifiedtreec12eca94. Automatic
Deploy39010283459 passed backend+agent/Smoke with infra/web skipped:
backend0000336 ready/healthy, active Foundry107, health200, actual14/15smokeok
and only existing PC bridge down. Receipt6230819873 and #724 opening were
independently read back. No source/semantic failure, qualification rerun or
waiver; initial local style failures remain above. This finished inactive
release is not actual food/client/device/provider or activation acceptance.

## Owner nutrition targets checks (17 October 2026; P12-09)

The targets store, route and `daily_nutrition_targets` tool compose only through
the sixth `createDailyModules` argument with Daily on. Use synthetic figures
only: they are the owner's private health data, so no real value may appear in a
fixture, document, log or PR text, and no check writes the owner's values.
Check that Daily off leaves routes, tools and capabilities unchanged, that an
unset target is "needs configuration" rather than a default, that a change needs
the exact browser Now approval, and that audit redacts the values. The tool joins
`daily_food_review`/`daily_saved_food` in the 180-second browser relay budget and
the 210-second hosted-agent read; other deadlines are unchanged. Pure targets
tests and lint run locally. Real Fastify route, composition, relay and Python
agent semantics need the existing pinned CI graph; local Fastify/jose are
unavailable.

The web Settings section (`apps/web/src/daily/`) has its own tests, again with
synthetic figures only. Check that Daily off renders no section and makes no
request, that a save sends only the changed fields (a cleared field sends
`null`), that an invalid entry sends nothing, and that no server text is
rendered. Run the web tests, lint and `npx tsc --noEmit` from `apps/web`. A
machine whose locale is not en-US fails the existing credentials-date test in
`SettingsPage.test.tsx` (it expects "Oct 5, 2026") on the locale alone; CI is the
authority.

## Nutrition suggestion adapter checks (17 October 2026; P12-09)

`daily_nutrition_suggest` composes only through the seventh `createDailyModules`
argument, with Daily on, shared data and the targets accessor. Use synthetic
figures and fake read sources only: the targets, burn and meals are the owner's
private health data, so no real value belongs in a fixture, document, log or PR
text, and no check reads or writes real Health, nutrition or settings data.
Check that Daily off leaves routes, tools and capabilities unchanged, that every
unknown (unset target, no burn row, unread page, failed health read, a meal
without a value) is named and leaves its figure null rather than zero, that only
the exact active-energy metric counts and resting energy is never read, and that
the tool description carries no digits. The tool is read-only, so it joins no
approval or relay-budget list; its 20-second bound sits inside the ordinary
30-second agent and voice budgets. Pure budget and adapter tests and lint run
locally; the route, composition and tool tests that load Fastify or `jose` need
the pinned CI graph where those packages are unavailable locally. The
`active_energy` metric name is not verified against a live export.

## Daily switch checks (17 October 2026; P12-09; updated 18 October 2026, P12-15)

The backend composes Daily only when the environment variable
`JARVIS_DAILY_ENABLED` is exactly `true`. Absent or `false` leaves Jarvis
unchanged and any other value stops startup. It is a server switch, not a secret,
and it is off by default in code, so local runs, tests and any other environment
stay off. Production turns Daily on for the owner in exactly two reviewed files:
`JARVIS_DAILY_ENABLED: 'true'` in the backend container environment in
`infra/main.bicep`, and `VITE_DAILY_ENABLED: 'true'` on the web build step of
`.github/workflows/deploy.yml`. No other workflow, Bicep, infrastructure, `.env`
or deploy file may mention either name, and no session sets one anywhere else.
`daily/default-off.test.ts` allows only those two files and checks that each sets
only its own switch, once, to the exact string `true`; changing the allow-list is
turning Daily on or off somewhere else and needs its own reviewed change. The Vite
build and dev server read the web switch by name only: absent or `false` is off,
`true` is on, and any other value, including an empty one, stops them. Never set
it in a local `.env` that is committed.

To turn Daily off, revert the whole enabling change, which removes both values and
the scan test's new expectations together, or set both to `false` and update
`daily/default-off.test.ts` in the same commit. Reverting only the two values fails
that test in CI before Deploy can run. Both files are release inputs, so the next
deploy re-applies infrastructure, backend, web and agent; stored Daily data stays. After a deploy that sets the switches, the owner's
read-only live check is: `/health` is OK, Daily appears in the side rail and the
phone menu and opens on the period control and the Training, Health and Body cards
(a card saying "Not recorded" is a valid answer before any data exists), and Settings shows the
Nutrition targets section, empty until Dan enters his own values. None of it needs
a write, and a failed read is a finding to record.

Check the composition with
`npm test --workspace @jarvis/backend -- src/config.test.ts src/production-modules.test.ts src/daily/default-off.test.ts src/daily/composition.test.ts`.
All of it uses synthetic owners and an untouched stand-in pool; no check reads or
writes real data or probes a live service. `composition.test.ts` builds real
Fastify applications, so it needs the pinned CI graph where those packages are
unavailable locally. Check that Daily off leaves routes, tools, instructions and
startup unchanged, that Daily on adds exactly the module's routes and seven tools,
and that all composed tools remain registered and advertised. There is no
global tool-count ceiling or reserved-slot requirement; description and
serialized-catalogue byte limits still apply (see
[`docs/decisions.md`](decisions.md#catalogue-count-is-not-a-global-limit)).

## Internal Daily review checks (17 October 2026; P12-09)

The current inactive continuation registers `daily_food_review` only with the
explicit internal nutrition factory. Use synthetic owned meals and persisted
chat/voice metadata. Exercise actual browser-only Now approval: no mutation
before acceptance, browser confirmation in Away as well as Present, one-time consumption,
rejection/cancellation, changed presence/revision, immutable proposals,
matching uncertain-result recovery, exact/favourite one-step routing and
old-history correction/deletion. No live food/Health write or activation.

The new pure review/model/intent/record selection initially passed 95 assertions.
Its serial changed-file lint failed on one unused mock delivery parameter,
subsequently used for the browser-only contract assertion. That original failed
receipt is retained. The final review/model selection passed 50 assertions,
then final schema/review selection passed all 15 cases. Changed-file lint
passes with zero warnings. These are not local tool/SQL acceptance.
Local application/tool imports still lack `jose`; use the existing pinned CI
for real service/registry/SQL qualification, not a restore, stub or alternate
graph. Run approved Node22 x64 checks serially, one worker from apps/backend.
Real SQL coverage appends to the existing nutrition fixture because earlier
cases depend on their original meal/favourite counts.

Initial actual CI39002775817 passed 3691/3692 backend assertions, all other
components including SQL, and all four CodeQL analyses. The sole new HTTP-schema
failure exposed unknown nutrient nulls being coerced to zero; single nullable
numeric types correct the input schema, with explicit null/zero HTTP controls.
Independent source review identified the hosted-agent approval timeout.
Corrective5c8da563 CI39003491542 passed all ten job entries, but a fresh review
then identified the actual 240-second Container Apps ingress ceiling.
The next correction explicitly uses two-minute food cards (SQL/card/timer),
a three-minute whole operation and a 210-second agent read deadline. Default
five-minute confirmations and unrelated tool/connection deadlines stay intact.
Test custom expiry/consumption/cancellation and invalid lifetime rejection;
the real SQL workflow checks the visible two-minute lifetime.
Corrective pure review selection passes 16 cases; changed TypeScript ESLint and
Python Ruff pass. Local HTTP collection lacks `fastify`; Python deadline-test
collection lacks `opentelemetry`. Neither ran semantic assertions. Do not
restore or stub either graph; successor normal CI must qualify both corrections.
Actual ingress-safe `766ffd3f` CI39004516029 passed all ten job entries:
194 backend files/3698 tests, 11 SQL files/229 tests (19 nutrition), and 730
Python tests. All four actual CodeQL analyses passed. Exact-head review found
generic phone approval could precede food's unsupported-session refusal.
The successor adds `denyOnPhone` before approval, with real HTTP private/public
denial controls and both actual food metadata assertions. Keep their unchanged
normal-phone approval/public controls. Local real HTTP collection remains
unavailable; do not represent preceding green CI as successor qualification.
Seven changed TypeScript files pass the existing root ESLint with zero warnings.
The first launcher incorrectly looked for ESLint inside the backend workspace
and failed before linting; no graph change or restore was needed.
Final `d17fe622` CI39005389697 passed all ten job entries: backend194files/3700
tests, SQL11files/229tests including19nutrition, hosted-agent730 and runner374
Python tests. All four CodeQL39005389669 analyses ran successfully. Exact-head
independent review completed without findings; all three earlier threads were
proved and resolved. Normal #874 merge `f1d410b1` has the qualified `c0f112bf`
tree. Deploy39006050135 passed backend/agent/Smoke, with infra/web correctly
skipped: ready/healthy backend revision0000335, active Foundry version106 and
routine health200. Actual smoke14/15ok; existing PC bridge down, chat identity
ok this run without source attribution. Release receipt6230241795 and the #724
opening were independently read back. No extra live, rendered-browser, private
food, client/account/provider/device or activation acceptance follows.

## Internal Daily direct-intake checks (17 October 2026; P12-09)

Use synthetic persisted Dan messages and owned favourite snapshots only.
`daily_food` is an explicit fourth-argument composition; do not enable Daily,
reuse MCP write permission, access original Daily or run live food/Health writes.
The new direct syntax is intentionally limited to explicit saved-favourite
names and exact labels. It does not implement estimate staging/acceptance or
general conversational parity.

The first local four-file selection passed 79 pure tests but could not import
the tool suite because `jose` is missing. After tightening source-only name
derivation, the three pure intent/model/record files pass 77 tests. These are
not local tool, application or SQL acceptance. Keep the existing dependency
graph; actual owner/session/registry/SQL cases require normal pinned CI.
Use the approved Node 22.23.3 x64 and one worker, and run selectors from
`apps/backend`. No restore, stubs, source aliases or substitute graph.
The final local pure selection passes 81 tests, including literal multiword
label names and qualified-request refusals. Changed-file ESLint passes with
zero warnings. Its first run reported two unused mock parameters, subsequently
corrected; that failed receipt is retained, not reported as a pass.
Initial `a618a802` CI passed 192 backend files / 3656 tests, including 21 actual
tool and 41 intent cases; SQL passed 11 files / 228 tests. All four actual
CodeQL analyses passed. Review found the overlapping favourite-edit retry race,
not covered by the original same-snapshot concurrency case. The successor adds
actual receipt recovery and a gate-controlled SQL interleaving; initial green
results do not qualify that correction.

## Voice preview correction checks (16 October 2026; P11-07)

Use synthetic tool receipts, never private bookings or live Calendar writes.
The four new realtime unit cases fail on unchanged execution and pass after
the hook is connected. Both complete realtime/capability-instruction files
pass locally: 65 tests with approved Node 22.23.3 and Vitest 5.0.3, native
config loader, one thread and no file parallelism. The initial guidance
candidate exceeded the existing 15,000-code-point mode budget in two cases;
shortening the relevant guidance restores that budget without changing it.
At `494cb945`, ESLint passed all seven changed backend files with zero warnings.
Normal CI at `494cb945` passed all 187 backend test files, including the real
36-case work-presentation and 105-case workspace-command suites; all four
CodeQL analyses ran successfully. Review then identified an intermediate
approval-lookup presentation race. The correction suppresses that internal
lookup only, with approval/decline regressions. The synthetic HTTP route now
sets JSON content type explicitly rather than reparsing the serialized result.
The successor's 65-test selection includes both approval/decline regressions.
Final `0672dfb8` passed all ten CI jobs (`38970010952`) and four actual CodeQL
analyses (`38970011036`). Both review threads are resolved; test-route alert 24
is fixed without dismissal. Normal #866 merge `4129f9bb` has the qualified tree
and Deploy `38971353611` passed backend release/smoke on revision `0000328`.
The PC bridge is the unchanged nonblocking warning; chat identity is ok.

The initial local integration attempt executed no assertions because Vitest
could not resolve from this checkout. The reused per-package junction graph
supports the unit selection but lacks Fastify and jose; full real-app
work-presentation/workspace-command integration requires normal pinned CI.
Do not disguise missing dependencies with source aliases or install a second
graph. Preserve the existing localhost5173 preview, auth and remote runtime.
Local unit evidence is not live voice/provider or physical-phone acceptance.

## Mobile composer focus hotfix (16 October 2026)

P11-06 / #860 starts independently from released `3d3a12ab`; header #859 is not
included. Use controlled auth/API fixtures on an owned listener, not the signed-in
released localhost5173 preview. Saved desktop geometry is the important control:
without it the existing phone dock works; with it released `Workspace` still
publishes a separately scheduled inline fixed composer anchor.

The new focused Workspace regression fails on unchanged production source with
`{ left: 110, top: 558, width: 800 }` where phone mode requires no manual anchor.
The actual-App Chromium fixture measures saved-layout composer top546 versus
phone dock top766 at 390x844; this is controlled geometry evidence, not native
keyboard proof. Original hidden-chat harness-readiness and unsupported runner
`--cacheDir` errors are retained separately; neither ran a semantic check.
Candidate checks pass: four complete `Workspace`, `phone-chat-viewport`,
`conversation-layout` and `styles` suites, 139 tests; selected `App` and
`ConversationHistory` lifecycle/draft/held-open-table/reader/resize cases, 10 tests.
Use the pinned Vitest 5.0.3 with `--configLoader native --pool=threads
--maxWorkers=1 --no-file-parallelism`. Per-package read-only junctions exclude
shared dot caches; this checkout owns its cache and current contracts link.
Changed-file ESLint 10.12.0, full web `tsc --noEmit -p tsconfig.json` and Vite
8.3.2 production build pass. Node is the approved 22.23.3 x64; no dependencies,
pins or source aliases changed. Ordinary jsdom canvas notices and existing
production chunk-size warnings remain.

The first candidate union had 137 passes and one obsolete phone-resize-control
assertion. Desktop mouse/touch resize and drag coverage is retained explicitly;
the new phone regression verifies the controls are absent. The final green
union does not relabel that failure. Original rendered-harness growth/caret and
default-desktop seam assumptions are likewise retained as failed receipts.
The corrected actual-App Chromium 155 fixture checks four default/saved,
dark/light combinations at 390x844, 844x390 touch landscape and 1440x900 desktop.
It verifies immediate and settled viewport geometry, focus/typing,
hide/close/restore, unchanged drafts/preferences and desktop restoration.
Screenshots were inspected; light mode uses reduced motion. Synthetic auth,
history and viewport rectangles are not real keyboard or physical Safari proof.
The owned fixture/browser helpers are stopped; released5173/auth is untouched.
PM completed full normal CI `38952176445` and all four CodeQL analyses in
`38951934641` at exact final head `315c85b6`. #863 merged as `6192574e`,
tree `52bc3fe6`; normal Deploy `38953446877` passed web and smoke while
backend, infra and agent were correctly skipped. Public `main-BHyATt-B.js`
matches that build and returns HTTP 200. The only nonblocking smoke warning is
`pc_bridge: down`; `chat_identity` is ok. Issue #860 is open with
`needs-decision` for physical-phone acceptance. Local preview source switches
require its existing owner and preserve origin/auth; a production release alone
does not update that source. No production source changed after PM's review
of `5b3a5933`.

## Header dismissal follow-up (16 October 2026; P11-05)

P11-12 supersedes device-only dismissal: the server owns finished-entry
visibility per owner. Preserve raw lifecycle history; import the old scoped
UUID preference once, removing it only after server confirmation. A failed
import keeps the local hides and exposes a retryable error. Header running-work
Hide remains separate from permanent finished-work Dismiss.

`JobsChip` must render `useJobs().jobs`, not the unfiltered `history`, in its
Background work list and selected details. The previous implementation saved
scoped dismissals correctly but retained hidden rows and removed only their
crosses. Do not fix this by deleting records or filtering the store's raw
history: App still needs real running lifecycle state and a stable phone
summary. Keep failures, saved-result recovery, explicit cancellation and
storage/load errors truthful. Verify desktop and phone interactions using an
isolated fixture; preserve the signed-in released preview and never run real
indexing/research to manufacture evidence.

## Combined-source qualification boundary (16 October 2026)

Use the final all-workstream base-`2823585` patch and manifest, not an earlier
UI-only or Daily v1 snapshot. The existing Style owner qualifies its own clean
artifact snapshot with final candidate contracts and one owned pinned React
graph; do not borrow sibling source links. `@jarvis/contracts` exports runtime
`src/index.js` and declarations `src/index.d.ts`, not `index.ts`.
Factory/Calendar qualified component evidence and Mobile v1 results do not
replace fresh combined or pinned gates. Daily v3b's first unchanged synthetic
HTTP/module test timed out at 5 seconds; remaining query cases, store and lint
did not execute. Keep its failed receipt and unchanged source identity.

The parent alone owns the approved combined normal PR/CI/deployment pipeline.
No new worker, dependency restore, private action or Daily activation follows
from source integration. Internal patch artifacts may retain historical
itinerary deletion hunks; do not publish those artifacts or old screenshots.
The old Daily export/import route, including the Sites database-export/preflight
path, is withdrawn and is not a prerequisite for #1005; do not revive it.
Source-compatible API/schema work remains required. Device, source-parity and
physical-phone acceptance remain separate gates. Earlier lane-specific
publication holds describe those earlier stages and do not override the full
#1005 scope below.

## Calendar batch/reply recovery checks (16 October 2026; local candidate)

Initial reconciliation used exact released `28235851`; #848 already carries
the original #839/task-15 implementation from historical draft #849. Keep that
ownership/history; this correction does not start another Factory worker.
Dan chose one later approval for the complete displayed two-event proposal.
The additive 2–10-event tool preserves the existing process-local ten-minute
confirmation model. Batch receipts are not durable across restart.

Use synthetic backend/provider callbacks only. The new regression conversation
covers the supplied incomplete request, two hotel records, later approval and
ordinary follow-up questions without accessing personal mail/calendar.
Released-source guard controls reproduce 22 failures/5 passes after explicitly
loading immutable baseline modules; the candidate fixes those controls.

The owned Windows Python environment uses 3.12.10, not pinned CI's 3.12.14.
`uv` direct downloads fail TLS; the configured pip packagefeed can restore the
original hash-pinned `agents/jarvis/requirements-dev.txt`. Its Linux lock omits
pytest's Windows-only colorama, supplied in child artifacts as exact 0.4.6 with
wheel SHA256 `4f1d9991f5acc0ca119f9d443620b77f9d6b33703e51011c16baf57afb285fc6`.
No repository lock or shared packages are changed. `pip check` passes.
Focused checks use `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`,
`-p pytest_asyncio.plugin` and the owned `.venv\Scripts\python.exe`; initial
calendar/model checks passed 182 tests; the subsequent full existing agent
suite passed 470 tests with changed-file Ruff clean. Those results precede the
new partial-streaming correction and its Event-held regression additions.
An earlier focused two-file run collected 247 tests: 235 passed and 12 new
Event-held tests failed with cross-task ContextVar token resets. Its five-file
Ruff check passed and before/after source hashes matched. Keep that failed
receipt. Corrected fixtures now iterate and close each response in one owning
consumer task. Production context ownership/reset was not changed or weakened.
Do not reuse the historical 470-pass result for later edits.
The coordinator subsequently authorised verified-message identity metadata:
the final focused selection adds four existing runtime tests with explicit
loader/current-request/steering/smoke ID assertions and Ruff over eight changed
Python files. This does not cover PR #816 transport/disconnect integration.
Batch approval refuses missing verified request IDs, including callers that do
not supply them; do not infer IDs to restore that path or claim voice-batch
acceptance. Normal single-event/legacy `ModelMessage` callers stay compatible.

Frozen v1 local checks passed **367 tests** in 13.03 seconds, then clean
Ruff over eight Python files. The selection is both complete
`test_calendar_flow.py`/`test_model_client.py` plus runtime cases
`test_chat_streams_text_and_sets_tool_source_message`,
`test_system_smoke_invocation_skips_user_history_and_persistence`,
`test_steered_invocation_uses_saved_language_and_authorized_round_boundary` and
`test_load_verified_history_checks_token_and_uses_stored_context`.
Actual tools: pytest 9.1.1, pytest-asyncio 1.4.0, Ruff 0.16.10; the interpreter
is AMD64 Python on an ARM64 Windows host. Before/after source hashes match.
The immediately preceding 365-pass/2-failure run exposed a missing synthetic
health-tool catalogue declaration in the new steering fixture; keep that
receipt rather than relabel it a pass.

Direct boundary review produced a source-only v2 correction in
`calendar_flow.py`, `model_client.py` and `test_calendar_flow.py`: contextual
"Add those two." inherits recent calendar routing/guarding, never an identity;
Notes/mail context stays separate and newer creations cannot fall back to older
proposal origins. The same claim matcher now covers "I've put both in your
calendar." Both-provider controls cover matching real stages, missing/mismatched/
older origins, other-workflow requests and no-evidence claims. Questions,
negatives and conditions remain distinct. Final v4 additionally recognises
Danish demonstrative "de/disse to", not English preposition `to`.
The final allocated run used the same full calendar/model plus four runtime
selectors and eight-file Ruff: **444 passed in 19.11 seconds, Ruff clean**,
with identical before/after Python source hashes. The preceding v3 run's
411 passes and all older packets remain historical and immutable.

Publication preparation adds fixture-only v3 in `test_calendar_flow.py`,
`google\calendar-batch.test.ts` and `google\tools.test.ts`: synthetic hotel
names/reference, June/December 2027 stays and matching local/UTC expectations.
Copenhagen +02:00/+01:00, both full summaries and all approval/partial assertions
are preserved. Targeted scanning of the eight owned changed test files found
no original itinerary labels/reference/stay dates. Some literals already existed
in released base282; removal does not purge Git history or deletion hunks.
V1/v2 packets remain immutable. The final verified full-base patch goes to the
existing Factory integrator and coordinator, not a new worker or publication
by this lane. Original root Google tests remain unrun despite fixture cleanup.

The child-owned exact backend offline cache restore fails `ENOTCACHED` for
`ip-address@10.7.4`; previous proxy/direct attempts failed 404/TLS respectively.
Do not repeat the network chase, weaken TLS or change pins. Existing read-only
Node tooling is a qualified fallback only (Vitest 5.0.2/Vite 8.3.1 versus current
pins); its old snapshot lacks several newer backend dependencies. Keep
workspace aliases, compiler outputs and caches child-local and never install
or write through a read-only package junction.
The sole authorised offline addon restore also stopped at its first miss:
the copied old addon cache cannot resolve current `@fastify/multipart@10.1.3`
(`ETARGET`). That original addon directory has no lock. Only the child copy
omitted its mandatory ARM64 rolldown dependency to match the actual
Node 22.23.3 / win32 / x64 interpreter; the read-only base snapshot has an
x64-binding package entry. The attempted install used
`--offline --ignore-scripts`; no usable addon installation or exact-lock
acceptance is claimed.

The frozen v1 qualified fallback ran the real Google-module boundary test,
pending-action tests and capability tests: **58 passed across three suites** in
4.89 seconds, one fork, normal isolation, no file parallelism. Node is
22.23.3/win32/x64; actual snapshot tools are Vitest 5.0.2, Vite 8.3.1,
TypeScript 6.0.3, ESLint 10.11.0 and Node types 22.20.4. Per-package read-only
junctions live under the child-owned modules directory; `@jarvis/contracts`
resolves this worktree's actual source. `--configLoader native` and child-owned
Vite/Node-compile/temp caches avoid writes through snapshot packages. No install
was repeated. An initial 56-pass/2-budget-failure receipt is retained; compacting
only the calendar instruction restored the unchanged 15,000-code-point
headroom gates. Its source and contracts hashes match before/after.
The fixture-safe v3 rerun passed **58 tests across the same three suites in
11.03 seconds** with the same qualified tool versions and isolation settings.
The subsequent Danish-only Python correction reused that just-completed Node
result after all eleven owned backend/contracts source and fixture hashes
were compared unchanged; both Node run snapshots are retained. No second
Node run or dependency restore was required.
This is not pinned backend, root `buildApp`, auth/audit/voice, full type/build
or live-provider acceptance; those gates remain outstanding.

Combined PR #858 CI `38892246588` subsequently exposed two Calendar-owned
failures: an unregistered batch failure log and missing explicit read/write
proof guidance in voice instructions. The source-only follow-up registers
`google.calendar_batch_item_failed` with existing sanitized error fields and
extends the existing logger privacy cases. Calendar wording restores both
proof rules and shows each proposal item's fields, preserving staging, later
exact-list approval, recovery and no-replay guidance. No instruction limit or
existing assertion is weakened. The V4 444/58 receipts remain historical for
these changed sources; new tests and actual budget gates are UNRUN pending an
explicit allocation. No approval-origin, runtime/transport or provider behavior
changes are included.

No supported existing-session `/remote` control is exposed here; remote-enabled
state remains unverified. Do not launch a duplicate CLI or change shared
settings. No private/model/Google/PC action, commit, push, PR or deployment is
part of this local handoff.

## Resumed inactive Daily read integration (16 October 2026)

Current continuation (17 October): after the delivered voice, collection-read
and CI corrections, JarvisPM is implementing an optional inactive hosted
nutrition MCP adapter in this same worktree. This supersedes the earlier
read-only implementation hold below, not private/access/device/cutover gates.
Use the existing dependency graph and maintained split SDK; manifest changes
authorise its normal restore, not stubs or a second graph. Initial restore
failed on a package-download timeout; an offline-preferred retry then used
stale client metadata (ETARGET). Fresh online registry metadata confirms client
2.3.1. Do not conflate either failed install with source/test results.

See `apps/backend/src/daily/mcp/README.md` for exact inactive composition,
protocol/confirmation/replay limits and scoped checks. Qualification requires
actual build, lint and synthetic protocol/root-auth checks; record exact-head
results in the PR receipt. Production startup/configuration is unchanged; no account linking,
OAuth scope/client/grant, credential provisioning, provider/private operation
or production Daily enablement is implied. Preserve the other owner's released
5173 preview and Dan's existing runtime/remote settings.

Connector audit requires the existing SQL store's `recordDailyMcp` method and
0049's UUID correlation; a generic message-backed sink is insufficient.
Normal message FKs remain required and rollback refuses retained connector
audit. Server-to-server only: reject browser Origin, retain shared root CORS,
and explicitly negotiate modern protocol in synthetic SDK clients.
Saved-name lookup uses the existing `lookup_food`, owner-bound resolver and
query DTO projection; preserve original component inputs and deployed 0049.
The saved-food continuation adds native-reviewed favourite/alias, plan
save/soft-delete and canonical preference writes plus bounded preference reads.
Migration 0050 owns the new constrained audit names, target-only revisions and
null-clear tombstones; never edit deployed 0049. Actual SQL CI must exercise
source-snapshot rechecks, repeat/stale writes and guarded down/up. Historical
0043/0049 rollback tests use their applicable ledgers, not a newer manifest.
Local pure model/record tests ran; migration/application suites currently lack
`mssql`/Fastify/jose in the existing graph. Do not substitute or restore a second
graph; exact-head normal CI remains authoritative for those checks.

Historical read continuation: Dan ordered deployment first, then Daily. After #866's
successful deployment, JarvisPM claimed partial #724 directly in the existing
local UI session; the historical Daily child is not reassigned. Reuse the
delivered read foundation for favourites/meal plans, ID-only cursors (maximum
100), safe DTOs and collection-specific acknowledged-commit invalidation.
No new writer/connector/authority, schema, provider access or activation.
Run `node --test packages/contracts/src/daily.test.js` and scoped changed-file
lint locally; existing query/store/HTTP integration and Database CI cover the
actual application and SQL graph. The local reused graph still lacks
Fastify/jose: no stub, reinstall or second graph to pretend that integration ran.
Keep #724 open and #730's native blockers intact. The dated original receipt
below is history, not a new worker assignment or release restriction.

Delivered #867 / `10baebc6` has the exact qualified `e17ae341` tree.
CI `38975315146` passed all ten jobs; CodeQL `38975315029` passed all four actual
analyses. Normal Deploy `38976366790` passed backend/readiness/smoke, with
infrastructure, web and agent correctly skipped. This does not activate Daily
or establish hosted-client, provider, private-data or physical-phone acceptance.

First collection candidate `c1332fb2` failed strict backend compilation:
grouping both collection literals in one union member prevented negative source
narrowing in the remaining health-history branch. The emulator suite's setup
also failed at that same compiler invocation, not an emulator/runtime defect.
Split the two declaration discriminants; do not cast the health input, weaken
compiler settings or skip the suite. A direct check against the actual contract
reproduced the three diagnostics before correction and passed after the split.
Fresh full CI is required.

Dan selected the existing Daily session under coordinator ownership. This
supersedes the general #724 engineering hold only for its nonprivate inactive
read API/tool and committed-invalidation slice; no duplicate worker or broader
activation follows. Base: `2823585184d67980c580127f9dbbce97109fa91b`.
`createDailyModules()` remains empty; explicit enabled composition with
`createDailyData(existingPool, configuredOwner)` exposes `/daily/query` and one
sensitive `daily_query` tool through the existing registry/authentication.
The production entry point is unchanged.

Target contracts plus `src/daily/query.test.ts`, `src/daily/routes/query.test.ts`,
`src/daily/health/processor-commit.test.ts`, accepted health read/normalizer and
nutrition store/handler tests, and existing Daily/module/auth regressions.
Run backend strict build/lint and normal isolated SQL/exact-head release gates
when their pinned dependencies are available. Transaction doubles and synthetic
root-auth fixtures are not SQL, real OAuth, deployed-client or device proof.
Existing read-only Node/dependency fixtures are qualified alternatives, not
permission to stub missing modules, weaken checks or install into parent caches.

No food-write route/tool, guessed intent/confirmation, hosted ChatGPT OAuth,
provider/model call, UI, coaching, widget, device credential or cutover is
released here. The cancelled #717/#741 export path is not resumed.
Source identity/parity and real iPhone/provider acceptance remain unverified;
the original Daily remains canonical. Stop before commit,
publication, merge or deployment; coordinator owns integrated review/release.

## Chat format and phone viewport follow-up (16 October 2026; local candidate)

Owned frontend work starts from released `28235851`; do not reuse the older
mixed P9-101 checkout. Normal chat is list-first for bookings/events. The
calendar sibling owns `CHAT_FORMAT_INSTRUCTIONS`; frontend GFM table support
is compatibility for well-formed existing/model text, not repair of a supplied
one-line malformed table. Keep HTML disabled and current URL security.

Focused checks: web `MarkdownContent`, `ConversationHistory`,
`conversation-history`, `phone-chat-viewport`, `Workspace`,
`conversation-layout` and `styles` suites, web lint and web build. Use offline
actual-App auth/API fixtures only; no real provider, calendar write or private
account read. Browser receipts must distinguish native browser layout,
synthetic VisualViewport/innerHeight/safe-area overrides and physical Safari.
The existing session's `/remote` state is unverified; no duplicate CLI or
shared setting was changed.

Initial pinned five-file serial batch: 117 passed, 2 failed. Four suites
(`MarkdownContent`, transport, viewport and styles) passed. The history suite
exposed the documented Windows `2,5`/`2.5` voice-unit mismatch and a misplaced
new nested test. After correcting placement, the fresh isolated history,
Workspace, conversation-layout and viewport batch ran 150 tests: 149 passed,
with only the unchanged Windows voice-unit assertion failing. The new table
streaming/completion/reload regression and geometry guards passed. Runner:
approved Node 22.23.3 x64, pinned Vitest 5.0.3, `--pool=threads --maxWorkers=1
--no-file-parallelism`, normal isolation, no `NODE_OPTIONS`; duration 91.28s.
Worker-start timeouts from an earlier overloaded-host attempt
ran no tests and are not semantic results. Do not suppress the locale test
or describe either batch as fully green. Lint, types/build and candidate
rendered-browser inspection are separate gates. Scoped ESLint 10.12.0 for all
eight changed TS/TSX files and full web TypeScript 6.0.3 both pass using the
approved native ARM64 Node 22.23.3. Type command: `tsc --noEmit -p tsconfig.json`;
the single declared project includes source, tests, config and Vite config.
No heap override, tsconfig change or build-info emission was used. x64 Vite
build passed for v1 using Vite 8.3.2 in 17.28s, retaining ordinary chunk-size
warnings. The runner's default numeric locale is en-DK (`2.5` formats as
`2,5`); the original locale assertion remains unchanged and unwaived.

Actual-App Chromium 155 inspection then found a held-open stream-follow race
and unnecessary desktop table clipping. V2 uses pre-paint content following
and permits only table replies to exceed the prose measure. Actual held-open
readback measured gaps 0/0 across repeated growth; a reader at scrollTop 100
remained there through two more growths, with gaps 866/1182. Eight phone
keyboard/accessory/pan/safe-area/show/hide/blur cases pass; orientation/draft,
history opt-out, keyboard table focus/scroll and desktop columns were observed.
Basic More/navigation and synthetic voice-shell entry/teardown used no real
microphone/provider call; this is not real voice acceptance. List/flattened
fixtures were inspected at 320px. Earlier exact supplied-itinerary screenshots
are internal evidence, not publication assets. Harness-only selector/helper
errors remain in the logs and are not product acceptance results.

The v2 held-open real-component regression, table-width guard and wholly
synthetic hotel/stay/price fixtures require fresh targeted/static/build gates;
v1 results must not be relabelled. The owned fixture listener/page are stopped.
No physical Safari, live formatting/provider or remote-enabled-session claim
is established by these local receipts.

For this Windows ARM host, existing authorised x64 Node 22.23.3 plus
`npm ci --workspace @jarvis/web --include-workspace-root --cpu=x64 --os=win32
--cache <owned-copy-of-authorised-cache> --offline --no-audit --no-fund`
restores the pinned web toolchain, not an older tooling snapshot. Do not edit
pins or disable TLS to resolve a package-feed failure.

## Jarvis control styling (16 October 2026; project-local rule)

For every control change, reuse `apps/web/src/styles.css` and the common
contract in `DESIGN.md`; audit equivalent controls outside the current route.
Use the existing `--radius-control` for action/icon buttons, tabs, filter and
segmented choices, search and form fields. Keep `--radius-pill` for compact
noninteractive status, with genuine switches, orb/media and panel/window
geometry as semantic exceptions. Do not add arbitrary route-specific radii,
another token inventory, a theme, a component framework or a blanket reset.

Non-button quiet actions are borderless with existing `--glass-hover`/
`--glass-pressed` feedback. Selected choices use the existing
`--state-selected-*` surfaces/text, weight and semantic ARIA state. Dan's direct
instruction of 18 October 2026 supersedes the earlier button appearance limits:
buttons use the P14-07 hierarchy in `DESIGN.md` and token-based tonal primary
and danger fills with visible borders and restrained accent shadows. This
exception applies to buttons only; do not add `--glass-selected-glow`, bevels or
inset-shadow borders to buttons or other controls. Preserve neutral
`--control-rule` field boundaries and `--rule` structure, semantic
error/success text/icons and `--focus` keyboard outlines.

Shared action levels are `.primary-button`, `.secondary-button`,
`.ghost-button`, `.danger-button`, and `.danger-button--filled`. Use
`.button-group` or the existing action-row classes for wrapping and spacing;
buttons themselves have no layout margin. Preserve compact 36px controls only
for fine pointers and restore at least 44px on coarse pointers. Busy actions
keep their label width, set `aria-busy`, remain disabled and show the shared
inline `Loader`.

Preserve existing compact desktop density and at least 44px touch targets.
Check desktop and narrow phone layouts in both appearances, selected hover and
press, keyboard focus, disabled/loading/recovery states and reduced motion.
Use actual components with guarded synthetic responses, never live private
data or fabricated metrics presented as real. Keep screenshots as inspection
evidence, not product assets. The 16 October supplied images establish shape
inconsistency and rejected bevelled tabs, not a replacement visual reference.
Only repository-local guidance changes belong here; do not modify global
instructions or `C:\Repo\templates`.

## Push notification feature gate (P13-02; 17 October 2026)

Web push is default-off in code. The Vite build reads only `VITE_PUSH_ENABLED` in
addition to its existing explicit backend override and injects enabled only
when the value is exactly the string `true`. Do not expose arbitrary environment
variables. P13-02 did not set the gate; P13-03 sets it in the production deploy
(see the first section), and CI or local builds stay off unless the variable is
set. When off, the web app registers no worker, requests no push endpoints,
renders no Notifications section and has no proactive-item route. Physical iOS
permission and delivery checks are Dan's device test after P13-03.

This worktree starts from released/remote main `2823585184d67980c580127f9dbbce97109fa91b`.
Pinned web dependencies can be restored from an owned copy of the authorised
offline cache with `npm ci --workspace @jarvis/web --include-workspace-root
--cpu=x64 --os=win32 --cache <owned-cache> --offline --no-audit --no-fund`.
Use the authorised x64 Node 22 runtime for native web tools on this ARM host;
do not alter manifests, pins or TLS security. Run web tests from `apps/web`
because their source paths are relative to that workspace. CLI help support
for `copilot --remote` is not proof that this existing session has `/remote`
enabled; do not launch a duplicate CLI or change shared settings to claim it.

## Factory cache ownership (16 October 2026; local, v2 component checks passed)

The local successor to released `2823585` keeps one pending board owner per
project through invalidation, coalesces one immediate dirty follow-up, and
marks a follow-up invalidated again stale/expired. Ordinary task/webhook
publication is project-local; task lookup failure preserves safe diagnostics
without a global fallback. Existing explicit global invalidation remains.
Each attempted snapshot still passes full route validation; typed failure,
last validated fallback, TTL/LRU and waiter isolation retain their owners.
Outer source/task/release failures preserve the first cause and await started
branches before releasing ownership; error settlement can wait for cleanup.

The selected frozen-`2823585` direct-cache control actually failed at the intended
predicate: expected one source owner, observed two. In a separate fresh process,
all 12 direct-cache cases and four real-Fastify route lifetime controls passed,
with zero skips, on retained v1 source. Later review found eviction could remove
a snapshot's invalidation reachability before its waiter settled. Eviction now
marks that object stale/expired without dirtying its pending owner. A new
fixed-clock/gated control actually failed at its freshness assertion on the
retained v1. Current v2 passed all 17 component cases (13 cache, four route),
with zero skips. Both versions and their raw receipts remain distinct.
Node 22.23.3, Vitest 5.0.2/Vite 8.3.1 and Fastify 5.12.5 were
verified; Vitest/Vite differ from current pins. These are component checks, not
root authentication, publisher composition or full-app acceptance.

The validation slot is released. Existing buildApp/publication/auth suites and
pinned lint/types/build remain UNRUN/blocked. Do not repeat the known blocked
offline backend restore (`ip-address@10.7.4`) or failed addon extraction
(`@fastify/multipart@10.1.3`); do not chase the registry. Exact baseline board/app
source, candidate/config identities and actual JSON/log receipts persist in
this session's artifacts. No further heavy work without a parent allocation;
no commit, push, PR, deployment, live/private read or historical-502 claim is
authorised.

Combined CI run `38892246588` on source `2f9b59d3` exposed three Factory
test-contract defects, not evidence that runtime invalidation must change.
Task publication still emits the existing present-mode Now-feed `refresh`
alongside its scoped board event; their independent subscribers do not define
an ordering contract. Webhook fixtures must cache by project ID, as the board
route already did at base `2823585`, not by repository name. Corrected controls
require target reload, unrelated-project retention, and no reinvalidation from
duplicate signed deliveries. Runtime/cache code and the earlier 17 controls
remain unchanged. These source-only test corrections need allocated execution
and exact-head CI; no new passing result is claimed here.

## Steered source verification (16 October 2026; local successor)

Chat steering saves an interrupted Jarvis partial after the new Dan message,
then starts the next agent round using that Dan message ID. A latest-row-only
lookup therefore rejects legitimate steered computer requests. Resolve at most
one predecessor when the latest row is explicitly interrupted Jarvis; require
the same session and exact current source ID with Dan role. Do not skip a
completed reply or search arbitrary older history. Check cancellation after
each awaited lookup and propagate read failures. Additional synthetic controls
retain Gmail refusal and verify isolation/cancellation. Full fresh gates and
normal release remain required; old batches are not semantic acceptance.

## Hosted Gmail source guard (16 October 2026; local, not released)

#837's existing MIME reader and post-mail guards are already shipped via #848.
A new exact-`6e702e7a` synthetic reproduction found pre-discovery fallback:
without the Google module, a hosted request's current Dan message ID did not
cause its Gmail text to be checked before `pc_open` dispatched Chrome.
The native verified-message request correctly refused the same action.
Do not close #837 from its related merge or reuse prior green CI for this fix.

`gmail-access-policy.ts` now resolves the same existing one-message history
boundary before computer dispatch when an authenticated hosted source ID needs
hydration. Require the matching current Dan message; stale/missing/non-Dan
sources refuse, source failures propagate and cancellation prevents dispatch.
No private text enters the turn ledger or logs. Independently requested exact
operations keep their scoped nested exception; actual Gmail sites/windows and
generic fallback remain refused. Original Google/PC suites are unchanged.
New focused registry regressions and unchanged catalogue-budget controls use
existing isolated local tooling, not the pinned CI environment. Full original
integration suites, types/build and normal exact-head gates remain required.
No new worker, consent, provider/model/private/PC call or Google write is needed
for this source correction. Genuine live product approvals remain separate.

## Released Factory lifecycle acceptance (15 October 2026; 23:51 UTC)

PR #856 is released as `6e702e7a` / tree `628d7ca5`. Fresh attempt-one
CI `38822420126` passed all ten jobs: backend lint/actual build and 3,344 tests,
219/219 real-SQL cases with zero skips, and pinned Python 3.12.14 runner 374,
agent 431 and scripts 73. CodeQL `38822420647` passed all four analyses.
Keep the genuine earlier V4e and V4f2 SQL failures; do not relabel or rerun them.
Normal Deploy `38823507753` readied backend revision 324 with image `8a8408d4`
and passed required smoke; optional PC bridge stayed down. Unchanged infra,
web and main-agent components were skipped, not newly released. Normal Runner
deploy `38823507866` published all four variants, retaining their identities:
base 1x2 version 26; base 2x4 and both dotnet tiers version 21.

One new native Task 19 delivered the exact 53-byte synthetic artifact in
`DanAakesen/jarvis-test-target#6`, head `549fe564`. Backend proof matched session
18, generation 1, its invocation and that exact remote work commit. Automatic
Done at 23:49:53 UTC survived a full reload; fresh Status at 23:51 UTC reported
current source, SQL OK and zero tracked sessions, with no active runner probe.
Both the 12-minute overall and three-minute after-artifact bounds passed.
The no-check repository used its existing two-minute grace, not fabricated CI.
No manual Done, cancellation, steering, second task or merge was needed.

This is clean-completion/logical lifecycle acceptance only. Physical cloud
deallocation and Task 18's original failure remain unproved; do not retry the
denied Foundry read or infer either from accounting. The held records below are
historical. Continue eligible board work without releasing Daily/new coaching,
device/private or genuine product-confirmation holds. Remote-enabled state
remains unverified; do not start a duplicate CLI or change shared settings.

## Reviewed recovery correction (15 October 2026; V4g local and held)

Preserve the pinned V1/V2 snapshots, Codex HOLD evidence and source-reviewed V3
tree `7303f6e5`. V3 corrects the
reproduced pending-recovery policy race using migration 0048's task/session
generation, the existing policy lock, and an absent start lease. Both Done and
the deferred approved merge compare proof/session/task generation. Failed start
retains the new task generation; an old runtime cannot receive a fresh valid
proof for it. Apply the additive migration before starting this backend.

Local real-SQL execution reports missing isolated loopback SQL configuration;
it is not a mock pass. Full backend types still report the existing missing
multipart/image/PDF/health-upload dependencies. The migration manifest's existing
POSIX-path-only assertion also fails on Windows and has not been weakened.
Obtain exact-source Linux/SQL/build evidence through the normal gates.
Do not reuse V2's 283-test receipt for changed V3 source.

The signed-in overnight browser was read successfully through its existing
canvas. Dan authorised workers, release and bounded live trials, then the next
eligible board task after actual shutdown acceptance. Retain the specific Daily
hold and Foundry 403 no-workaround rule. Do not call graceful cleanup a necessary
condition for durable work to exist, or use a PR alone as current-execution and
stopped-writer proof. V4 adds persisted successful-work and verified-provider-stop
booleans for final cleanup-failed invocations. Only post-provider cleanup phases
qualify, and ordinary generation/GitHub/policy checks still apply. Failed work,
unknown teardown, legacy/malformed markers, cancelled/nonterminal status and
idle expiry stay ineligible. Runner failure remains visible. Source review,
actual SQL/Linux/build/release and fresh live acceptance remain required.

V4b's independent review held its generic-completed-outcome work marker: actual
no-commit question turns share that outcome. V4c's marker must originate in the
verified delivery-work branch, including an actual-worker delayed question
publication-failure control. The backend also rejects question-bearing snapshots.
Keep the held V4b evidence and do not publish it.

V4c corrected that question-only finding and passed 142 offline runner controls
with 11 POSIX skips, but its source review remains HOLD: a local commit was not
bound to the published PR. V4d records `work_commit_sha`, verifies that exact
remote branch/PR head on all delivery paths, and compares the proof commit with
the policy candidate under the shared SQL lock, including deferred approval.
Both clean and cleanup-failed completion require the binding. Legacy unbound
snapshots remain readable but cannot authorise new Done/merge; obtain fresh
verified runtime work rather than backfilling old events. Completed unbound
invocations receive explicit verification attention, not invented runner
failure. Preserve all held snapshots and receipts. Fresh pinned review and
normal actual SQL/Linux/build/release/live gates remain required.

V4d's source review confirmed commit binding but held the unverified-completion
cleanup path: without an early completion event, it could persist a completed
invocation as a crashed session and failed turn. V4e passes observed completion
to both explicit attention cleanup and its concurrent state-change subscriber,
without recording completion proof or invoking delivery. The task remains
NeedsAttention and policy remains denied. Four offline controls reproduced the
old flags; real-SQL controls assert session/turn status for heartbeat and
reconciliation, including the subscriber race. SQL remains unexecuted locally.
All eight focused backend suites passed 359 controls on owned Windows tooling;
the three newly changed backend files passed lint. Full production types still
fail on the same 12 missing-dependency/derivative diagnostics, not a build pass.
Runner source is unchanged from V4d; its 198/11 qualified receipt is not a fresh
Linux or full-source acceptance pass.

V4e received SOURCE-ONLY PASS and was published as ready PR #856 at `dbfff31d`
with tree `e7d02384`. Its automatic attempt-one CI `38816753978` genuinely
passed full backend build, eight component jobs and the pinned Python step,
but real SQL failed with error 468; aggregate CI correctly failed. CodeQL
`38816754153` passed. JSON proof inherits the database-default collation,
whereas `foundry_session_id` is explicitly binary-collated. V4f uses explicit
`Latin1_General_100_BIN2` for proof-identity comparisons, retaining exact opaque
IDs without changing database/schema collation. Added SQL controls reject
case-only session/invocation mismatches. The same SQL batch also showed three
rollback controls blocked by 0048's correctly enforced generation-retention
guard: their shared fixture had already executed tasks. V4f gives those controls
fresh disposable loopback databases and adds a real-SQL control for unused
rollback versus retained used generations. No guard or stored generation is
reset to make rollback succeed. Preserve the failed batch; no unchanged rerun
or merge. Fresh source review and normal new-head SQL/CI acceptance remain
required. V4f's eight local unit suites passed 359 tests and its three changed
backend files passed lint; local production types still report the same 12
missing-dependency/derivative errors. These are not real-SQL acceptance, and the
local dependency limitation is separate from the genuine V4e full-build pass.

Reviewed V4f2 was published exactly at `3ae3ff51`, tree `7aadc27d`. Automatic
CI `38820033386` passed eight component jobs, including actual backend build
and pinned Linux Python, but SQL remained failed: 210 passed / 9 failed / 219,
zero skipped. CodeQL `38820033362` passed all four analyses. The binary-identity,
generation/policy and all rollback controls passed; reconciliation tried to
backdate a heartbeat before its session start, and another fixture mixed a
JavaScript start time with SQL's end time. The pre-start cancellation test also
attempted recovery from inside the cancellation policy lock that now excludes
it. V4g changes fixtures only: use the existing dispatcher observation clock for
staleness, one SQL clock for lifecycle timestamps, and exercise an absent-runtime
SQL snapshot after legitimate recovery, then cancel through the dispatcher.
Register fixtures before fallible inserts and cancel them in `finally` so an
insertion failure cannot strand a Running capacity consumer. Production runtime,
constraints, deadlines, migrations and all test cases remain. The other failed
claims must still be observed passing in fresh exact-head SQL; source analysis
is not that acceptance. No unchanged rerun, merge or release is authorised.

The relocated V3 harness initially failed because deeper Windows fixture paths
made Git clone exceed its path limit. A separate short-temp-path harness passed
84 tests with 11 POSIX skips, without changing frozen source. Preserve that
qualified evidence; do not reuse it as a V4 or Linux pass.

## Factory failure-recovery follow-up (15 October 2026; local candidate)

Exact normal release `5c5be688`/tree `326e8e3a` passed backend/agent/web release
and required smoke, separately from the retained e17 runner image receipt.
Task 18 then delivered the exact new artifact in test-target PR 5, but reported
GitHub policy refusal and `ACPShutdownError` before remaining Running.
Supported native cancellation reached Cancelled at 15:56:43.568Z. The 30.026s
runner-epoch gap does not identify its hidden failed cleanup phase. Do not
resubmit its fixture or relabel cancellation as automatic Done or physical
deallocation.

The separate exact-5c source candidate adds owned POSIX group teardown, safe
phase diagnostics, existing read-token/PUT policy repair, and current-runtime
completion proof before policy Done/merge. It also gives explicit runner failure
precedence over early result events, immediately admits eligible ended sessions
to reconciliation, and bounds finalization work. It does not change pins, identity
grants, model settings, existing ACP phase limits or capacity. Migration 0048
adds task/session execution generations. Existing nonterminal
tasks without fresh backend proof remain held; no historical proof backfill.
The original checkout, older snapshots and failed release/trial receipts stay
unchanged.

Focused Node tests use existing owned x64 Node 22.23.3/Vitest 5.0.2 tooling,
not the pinned Linux toolchain. Local Python hashed restore is blocked by the
Linux lock's missing pinned Windows pytest/colorama dependency; do not weaken
hashes or install OS features. Linux real-child/procfs controls, real SQL
policy-provenance regressions, full backend types/build and all normal
automatic gates remain required. Local full backend types are blocked by
missing existing multipart, image/PDF and health-upload dependencies, not a
passed build. Read-only dependency reuse must not alter shared packages.

The first candidate's seven focused backend suites passed 278 tests, with ESLint
passing all 13 changed backend files. Revision two adds five backlog controls;
use its exact manifest for final results, not the earlier candidate's counts.
An actual-source AST harness reproduced the three unbounded
released IO waits and passed nine candidate controls, including cancellation
resistance, exhausted budgets, shared-deadline clamping and queued-turn ownership.
This is synthetic IO on Windows Python 3.11.15, not full pytest, real SQL,
Linux process or live provider proof. Full runner pytest cannot load the missing
Azure dependency locally. A first 200ms shared-budget test mixed filesystem
latency with IO deadlines; measured credential-file reading exhausted that budget
before its gate started. IO tests retain their one-second terminal assertion and
short IO caps; a separate no-filesystem test checks the shared deadline.

Independent review of the revised frozen exact patch precedes publication.
The first candidate stranded multi-batch work in three reproduced controls.
Revision two adds stable task-ID keyset paging, idle follow-up for full batches,
deferred rescan for expiry wakes, delayed SQL-error retry and stop handling.
The real SQL selector/pagination controls still require normal SQL CI.

After exact reviewed publication, one normal automatic gate/release batch and
one genuinely new bounded Factory artifact trial are the acceptance path.
Foundry 403 STOP, separate physical-proof qualification, Daily #724 hold and
new-coaching exclusion remain. `/remote` remains unverified; do not launch a
duplicate CLI or alter shared settings to claim otherwise.

## Backend attachment-cleanup startup correction (15 October 2026; local candidate)

The exact `e17cbb0` normal deployment failed backend revision 322 readiness;
agent, web and smoke were skipped. Runner deployment succeeded separately.
Source tracing found attachment-cleanup hooks inside post-listen re-embedding;
real Fastify 5.12.5 reproduces `FST_ERR_INSTANCE_ALREADY_LISTENING` for that
operation. The historical fatal exception was discarded, so do not describe
the live cause or recovery as proved.

The correction moves this existing job to app construction/readiness/close,
without changing retention, batch size, interval, authentication, SQL schema
or startup failure policy. Required validation is `src/app.test.ts` and
`src/core/conversation-attachment-cleanup.test.ts`, then existing shutdown,
attachment, settings and logging regressions plus backend types/lint/build.
Use the exact-base owned snapshot and declared lockfile; do not mutate the
parent checkout, shared dependencies or frozen release receipts.

The AST-extracted actual production callback rejects after real Fastify listen
before the correction and resolves afterward, using fake jobs/vault and no
provider, SQL or private-record calls. Strict local dependency restoration
failed on the proxy's missing `ip-address` tarball and the public registry's TLS
handshake; TLS and pins were not weakened. Repository tests and types/build
remain unverified locally, not passed by the callback-only reproduction.

No unchanged redeploy or timeout increase. Normal independent review,
exact-head automatic gates, actual backend readiness and required smoke still
precede a fresh Factory shutdown acceptance job. Daily #724 remains explicitly
held; new coaching remains excluded. Existing `/remote` state is unverified;
do not start a duplicate CLI or change shared settings to claim otherwise.

## Fixed stage performance work (15 October 2026; local)

Dan approved one balanced implementation and accepts the current local look;
no tiers, quality modes or new settings are authorised. Stage work stays
separate from the parent's immutable header/cancellation release. Preserve
the dirty phone/Status and frozen Factory paths and do not publish mixed
`ui/shell-iteration` history.

Owned `stage-performance-before` snapshots preserve the pre-stage source/docs.
Owned `stage-performance-fixture` retains local test/lint/browser evidence;
its offline App uses synthetic auth/chat/voice and the actual Three.js stage.
The scene tests use actual geometry/Reflector/scheduling with a fake GPU
boundary. Run tests from `apps\web` because existing CSS tests read relative
paths. Scope: stage scene/quality/owner/motion, App, Workspace, styles and
VoiceOrbStatus; use original Vite configuration with an owned cache/output.
Available Vite 8.3.1/Vitest 5.0.2 remain distinct from declared 8.3.2/5.0.3.
CSS is not linted; retained ESLint tooling uses original-equivalent rules.
Final gates: 26 scene/owner/quality/motion tests, 94 App, 66 Workspace,
24 styles and three VoiceOrbStatus tests (213 unique tests across eight
suites); `tsc --noEmit`; ten TS/TSX files with zero lint errors/warnings;
and an owned-output production build with the existing chunk-size warning.
The initial root-cwd run failed existing relative CSS reads and exposed a
new test's wrong home-link label, which was corrected. The proper-cwd fork
run completed App/voice but hit worker-start timeouts for the other suites;
Workspace/voice and styles passed using the supported thread pool without
changing test timeouts. These failed attempts remain in the evidence.
Browser inspection uses actual WebGL on the local Adreno/ANGLE renderer,
not a GPU timer, CPU-utilisation or battery profile. In a 2s desktop sample
the stage drew 60 main frames and 26 mirrors; on Settings it drew none.
The phone typing stage fits 390px; synthetic voice retains the same canvas.
The pre-change phone scene also obscures the docked voice orb and produces
the same geometry coordinates; this separate existing defect remains open.

Port 5173 was restarted and responded HTTP 200 during this work; do not
assume it survives Dan's reboot. Temporary fixture 5399 is for bounded local
inspection only. No production/model/provider/device call, shared dependency
edit, duplicate CLI or shared settings change is part of this correction.
Existing `/remote` state remains unverified.
A separate fresh-main artifact applies the frozen stage increment without
source adaptation or replaying mixed UI history. The eleven source/test/CSS
blobs match the retained evidence. The new scene test was LF-normalised
after execution with code unchanged and final-byte lint; browser samples
precede the final still-mirror invalidation guard covered by scene tests.
This is evidence reuse, not a new-main or pinned-toolchain CI run.
All prior main document bytes and PLAN rows remain; no publication or new
live/device/provider run is part of this packaging step.


## Model-round timing source candidate (15 October 2026; not released)

The diagnostics-only increment is based on exact `6e2c1b95`, not the separately
accepted stage/UI candidate. New optional `model_auth_max` and
`model_request_max` retain bounded per-turn maxima while every existing timing
keeps its first observation. Backend decoding/logging accepts them; browser
completion replies retain only the existing phase field set. No model arguments,
reasoning, retries, deadlines, settings, permissions or stream lifecycle change.
This does not explain or fix latency, verify Factory cancellation, or resolve the
separately owned physical composer.

Owned-fixture validation uses the existing read-only local Node 22.23.3 /
Vitest 5.0.2 / TypeScript 6.0.3 snapshot, not complete pinned CI dependencies.
New decoder/logging controls first reproduced three missing-phase failures
against baseline production; final two suites pass 152 tests. All six changed
backend files pass existing scoped ESLint, and four changed Python files pass
Ruff and syntax compilation. Strict production plus selected-test comparison
retains the same 28 diagnostics as exact baseline, with no new diagnostic;
this is not a clean production type build.

Both exact baseline and candidate Python pytest collection stop on missing
`opentelemetry`; model SDK prerequisites are also incomplete. The conversation
suite cannot load missing `sharp`. The unchanged logging-source registry scan
exceeds its existing five-second limit on both baseline and candidate. No
dependency was installed, package stub added, or check/timeout weakened.
These limits remain for coordinator review and the meaningful combined CI batch.
The immutable source/test/docs handoff makes no commit, publication, deployment,
live provider/tool/job call or overall Factory acceptance claim.

## ACP shutdown validation boundary (15 October 2026)

The bounded ACP shutdown candidate is prepared only in an owned archive of
main `6e2c1b95`; it does not change the existing checkout/index/refs or live
runtime. Use `runner/tests/test_acp_shutdown.py` with the existing finalization,
app and workspace controls. Synthetic subprocesses/reader gates prove local
lifetime behavior, not the exact await responsible for Task 17's live stall.
The parent's later supported Task 17 Cancel HTTP 200 is separate evidence,
not automatic-Done acceptance, provider DELETE or physical release proof.
Do not bypass the existing agent-read 403 or infer the old image was patched.

Local validation uses an owned Python 3.12.10 venv, not pinned CI's 3.12.14.
Initial collection lacked Azure SDK packages. The authorised strict dependency
restore found pytest's Windows-only colorama missing from the Linux lock.
Only existing hash-pinned entries were restored with `--require-hashes
--no-deps`; the pre-existing Python 3.12 colorama is read after venv packages,
without changing shared packages or manifests. Disable unrelated pytest plugin
autoload for these local checks and preserve initial failures in the receipt.
Require fresh pinned Linux CI; no local image/provider/live claim follows.

## Confirmed Daily scope exclusion (15 October 2026)

Dan removed NEW P12-08/#723 coaching/recovery/recomp automation from planned
scope and the combined release. Withdraw the candidate; retain its first and
waist-corrected freezes byte-exact as archived evidence, not accepted/merged
work. Do not remove existing main Daily health, nutrition, workout/tracking,
integration capabilities or records. Original Daily stays canonical and its
source/schema/data are untouched.

Core P12-09/#724 API/tools work must exclude new coaching and must not wait for
#723 acceptance or missing coaching semantics. No activation is released here.
Keep one Daily page plus existing on-demand GenUI in the same conversation,
no widget, extra Workouts/Nutrition pages or mandatory four native views.
Parent handles GitHub dependency/issue/board changes after this source update.
The coordinator verified plan-status recreates native links from PLAN: change
only P12-09's dependency cell from `P12-08` to retained completed
`P12-05, P12-07` (#720/#722). Preserve all 381 row positions, 309 task IDs,
every Status cell and the other 380 rows byte-exact; do not delete #723's row.
This retains actual prerequisites rather than bypassing dependency gates.

Do not chase or guess maintenance/TDEE, nutrition-completeness,
freshness-expiry or readiness-scale contracts for the excluded feature.
Existing core validation/freshness and source-compatible API/schema and
historical ingestion, authoritative-original-source/parity, real-device/provider, final-delta,
rollback and cutover gates remain. The coordinator's read-only original-repo
identity comparison is not health-schema or data-parity proof; this lane must
not search that original app. This is a docs-only exact-base handoff: no
source/build/test/lint/SQL, dependency, provider/device, setting or publication
work follows from it. Earlier coaching scope/validation statements are
historical and do not override this confirmed exclusion.

## Pre-start cancellation boundary and release evidence (15 October 2026)

Published `0b4e79c2` passed all ten actual CI jobs (SQL 176 tests) and all four
CodeQL analyses. Later complete review found a distinct correctness gap:
`failStart`, exhausted retries or expired pre-start leases can leave an existing
NeedsAttention task with no session ever recorded and no end reason.
The published correction recognises only the trusted runtime getter's four-null
generation, never a missing getter result, partial record or absent target alone.
No provider call is made for trusted absence. Existing transactional identity
checks still reject insertion of the first runtime after capture before
terminal events or cleanup. New focused controls and SQL cases retain their
own validation qualifications and fresh complete exact-head gates; prior-head green is
not acceptance of this follow-up. Historical freezes remain immutable.

## Standing delivery authority (15 October 2026)

Dan approved V5 continuation and stated that authorised Jarvis work does not
need repeated approval for committing, pushing, gated merging or deploying.
This supersedes historical per-candidate publication/release permission holds.
Keep independent review, current-main/ownership checks, complete exact-head
CI/CodeQL and serial guarded release/smoke checks. Source review holds are
not another user-permission question. Use normal publication on the owned
branch; do not force, rewrite history or mutate the user's checkout.
This grants no extra sandbox/provider job or turn, private/device/access/model
scope, resource creation or shared settings change. Existing live-job limits
and genuine product-action confirmation requirements remain.

## Combined header validation and release status (15 October 2026)

The combined candidate preserves reviewed V5 cancellation/runtime production
source and its exact corrected SQL fixture, adding only the header owner's
six frozen App/JobsChip/styles source/test blobs and reconciled docs.
The header owner's five suites passed 189 tests, strict web types, scratch
build and five-file TSX lint; CSS was not linted. Those retained results and
offline actual-App Chromium checks apply to identical header blobs, not
fresh combined CI. Desktop checks covered 701/800/1280/1920 px, crowded tabs
and jobs, focus/Close/details/Escape and retained chat/voice feedback.
Phone checks covered 320/390 px sheets with 44px rows; reduced motion was
checked. Data/auth were synthetic, non-fixture fetches blocked and the room
renderer disabled. This is not physical-device/provider/full-scene acceptance.

V5 has independent source-only PASS and final-file fixture lint. Its corrected
real-SQL cases, combined exact-head CI/CodeQL and release remain pending.
Final combined local checks pass eight UI suites / 259 tests, full strict web
types and package-scoped five-file header TSX lint. The initial generic test
wrapper lacked the app's public config define and package working directory;
the corrected run uses existing Vite configuration and the actual package cwd.
Mixed-package lint hit parser root ambiguity; separate package execution passes.
These execution-context failures remain in artifacts, not hidden source fixes.
Dan requested the header correction in the next deploy. His physical
mobile-composer report remains unresolved and is not claimed fixed here.
Earlier candidate-specific approval and local-only statements below are
historical where superseded by this current authority/status.

## Attention cancellation candidate (15 October 2026; local only)

The bounded patch based on exact main `2c7ce24a` permits confirmed cancellation
of NeedsAttention tasks without answering their question or starting work.
Active owned invocations require a matching cancellation acknowledgement;
replacement targets, pending merges and unknown runtime ownership fail closed.
The terminal task-store transaction checks expected state and runtime generation
under the task update lock and session/turn range locks. Runtime generation
retains the latest session across all statuses and its latest turn, including
when no control target remains. Existing session-end accounting and owned-session deletion are
awaited and cleanup errors remain failures. Runner and hosted-chat runtime
blobs, recovery/resume safety, capacity, settings and authentication are untouched.

Local checks use the coordinator-provided read-only dependency snapshot through
an owned junction: portable x64 Node 22.23.3, Vitest 5.0.2, Vite 8.3.1,
TypeScript 6.0.3 and ESLint 10.11.0, not the complete pinned CI toolchain.
Scratch configs retain project strict compiler options, map contracts only to
this worktree and keep generated output/caches in session artifacts. The
controller/lifecycle/heartbeat/store checks pass 180 tests; TaskControls plus
task-list/detail interactions pass 70. Exact-main implementation with new tests
reproduces 27 backend failures and five UI failures. Scoped lint and web strict
types pass; backend production types have the same twelve diagnostics as exact
main with this incomplete snapshot. Selected backend tests retain 47 diagnostics
versus the original baseline's 49, with none in the new runtime regression tests.
Local route checks cannot load missing `@fastify/multipart`; the added isolated SQL
state/generation/recovery integration cases were not run at the V4 local freeze.
Do not install or stub packages to disguise those limits.

V4 corrects only the cancellation route's negative verifier fixture: a non-owner
case injects `AuthenticationDenied(403)`, rather than returning a trusted
`UserPrincipal`. It checks propagated verifier denial and zero controller calls;
anonymous 401 and runner 403 remain separate. Owner-OID/scope enforcement belongs
to `createTokenVerifier`, not a second controls-route ownership check. Existing
signed-token owner/scope denial cases in `auth/auth.test.ts` were attempted but
cannot load the full app with this snapshot. A supplemental offline check of the
unchanged actual verifier passes five owner/denial cases with ephemeral locally
signed JWTs and an in-memory JWK set; it is not full-app HTTP proof. No production
auth or V3 runtime implementation changed. V2/V3 freezes remain immutable.

Published V4 (`428555d5`) subsequently reached real CI SQL execution:
job `116295620002` passed 174 of 176 tests. The two new Active/completed ABA
fixtures failed before constructing a replacement: `endTaskSessions` with its
default `invocationCompleted=false` intentionally leaves completed Active
sessions alone, while `claimRecovery` requires no Active session. V5 corrects
only that fixture contract by using the existing completed-invocation end and
usage-accounting helper after capturing the old expectation. It asserts prior
Ended/Idle state, actual Running recovery, a distinct Active replacement and
the original atomic rejection. All four cases and production guards remain.
Existing V4 CI/CodeQL/backend observations are not V5 validation or release
acceptance. V5 real-SQL execution remains pending; standing delivery authority
now covers normal publication after exact combined-source review and fresh
CI/release gates. No additional provider turn or live action is authorised.
The same published V4 head's Linux backend job `116295620202` passed all
179 files / 3241 tests, including `factory/tasks.test.ts` (37) and
`auth/auth.test.ts` (60), plus lint and the production tsc build. All four
CodeQL analyses passed. Full-app HTTP is therefore executed for published V4
under CI, despite local snapshot loading limits. Complete CI still failed
from the two SQL setup cases and aggregate; none of these prior-head results
are fresh V5 CI, real-SQL success or live/E2E proof.

Independent review rejected V2's state-only guard: NeedsAttention can change to
Running and back while recovery replaces its runtime. Eleven deterministic
actual-dispatcher/actual-transition regressions fail against V2 and pass here,
covering Active, completed, Idle and absent targets, already-ended replacements
and newer completed turns in the same session. V2's freeze and all earlier
receipts remain unchanged; neither V2 nor this local candidate is release PASS.

An offline actual-component browser fixture exercised desktop and 390 px iframe
confirmation, recovery coexistence, pending/failure and terminal rendering.
It used synthetic data and made no live request. Its unchanged UI/style blobs
are preserved in this revision; no fresh browser or deployed acceptance is claimed.
Existing SDK CLI launch
arguments do not show `--remote`; no supported in-session `/remote` control was
available, and nothing was relaunched or reconfigured.

The coordinator's one authorised sandbox job has been consumed. Its later
owner cancel returned 409 while NeedsAttention; physical cleanup remains
coordinator-owned and is not claimed here. The older preparation statements
below that no job was consumed are historical, not permission for another run.
V5 source review passed; the combined uncommitted candidate requires exact-tree
review. No release, original acceptance or live cancellation/deallocation
proof is established.

## Current Factory composition after accepted recovery (15 October 2026)

Recovery #852 passed narrow independent review and exact-head CI `38665077108`
with ten actual jobs and CodeQL `38665077057` with four actual analyses.
Normal squash reached main `5765d882`, exactly reviewed tree `c5831563`.
Automatic Deploy `38666983966` passed all six actual jobs, including required
smoke `116203572330` at 01:51 UTC. Backend revision `0000320` is ready; the
genuine owner's refreshed retained Status report shows all fifteen smoke entries
OK without another model call. This accepts the current normal release, not
exclusive timeout causation, original Google/private/device acceptance or #820
historical attribution. The older BCE/C0 failures below remain historical.

Normally integrate accepted `5765d882` into the existing #850 delivery, retaining
the exact V2 runner/test blobs, every outside-eight-path main entry and all 381
PLAN pipe lines. Prior `467cb5d` genuinely passed ten CI `38659103136` jobs and
four CodeQL `38659103178` analyses, including pinned runner204/agent398.
That is prior-head proof: the newly composed head requires fresh full CI/CodeQL
before normal squash. Normal Deploy AND exact-released-SHA Runner deploy with
actual deploy steps remain mandatory; normal Deploy alone does not ship runners.

No approved live fixture or sandbox job has been consumed. Public existing
`DanAakesen/jarvis-test-target` PRs 3/2/1 link tasks 9/8/6, but current owner
task/project/session isolation and later authentic product-write confirmation
remain unverified. Stop before launch on any missing eligibility or confirmation;
do not invent a task, approval or provider retry. Recorded provider/session
ending is still not physical Foundry deallocation.

The following earlier preparation snapshots are preserved, not current holds.

## Reviewed runner delivery and current release hold (14-15 October 2026)

Recovery #848 passed all ten actual CI `38656025688` jobs and four CodeQL
`38656025581` analyses at reviewed head `0519d12d`. Pinned Linux ran
runner165/agent398 and backend178files/3170tests. Normal squash reached main
`bce6e02a` with exactly reviewed tree `6c0c9aa7`; normal Deploy `38658184723`
is in progress, not yet accepted. The last completed C0 release failed.
Original Google/private/device acceptance and historical #820 attribution remain
separate. No additional smoke, provider job or private record was consumed.

The parent independently passed frozen Factory V2: two unchanged parent controls
and 61 selected repository tests, with the exact runner/test blobs and eight-path
replay verified. These are Windows Python 3.12.10 synthetic provider/publisher/
metadata fixtures with real temporary Git and owned children, not Linux/POSIX
or live acceptance. Original E9 remains rejected and immutable.

Existing draft #850 contained only an empty "Initial plan" commit on `51bda5cb`;
its unique source diff is empty. Use it for the remaining reviewed runner
delivery rather than adding another PR. Its original Gmail issue #837 remains
open; Google implementation/release belongs to existing #848. Normal integration
of source main `c0d0aeef` first produced exactly main's tree, so this does not
roll back accepted maintenance, Factory, Status or inactive Daily changes.
Only the eight reviewed runner/context paths may differ from that main.
Published-ready `99fdb727` passed ten actual normal-dispatch CI `38656814220`
jobs and four CodeQL `38656417765` analyses: pinned Linux runner204/agent335,
with neither component skipped. Its preceding ready PR event skipped every
component with zero steps; that event is not validation. The existing documented
ready-Copilot workflow dispatch supplied the real full gate, without a rerun.
This is prior C0-based evidence, not the next BCE-composed head's gate.

The owned source now normally integrates tested main `bce6e02a` while its
release runs. Preserve the exact V2 runner/test blobs, all other main entries
and every PLAN table line. This preparation is not an ordinary main merge or
release acceptance. Require new composed-head full CI/CodeQL.

Last completed normal Deploy `38649690138` failed the required capability reply smoke.
Do not merge this unrelated runner correction until the main release gate
recovers. Full exact-head Linux runner/backend/SQL/image CI remains required,
followed by normal Deploy AND exact-released-SHA Runner deploy. Normal Deploy
alone does not ship `runner/app.py`. The one approved owner job additionally
requires an eligible existing isolated non-Google/non-private test task and
matching open PR; none is claimed selected. Stop on missing eligibility or
actual restart confirmation, never invent another task/approval/provider retry.
Recorded provider/session end is not physical Foundry deallocation.

## Current required release and terminal transport (15 October 2026)

#848 normally merged as `bce6e02a` with independently reviewed tree6c after
fresh exact0519 ten-job CI/four CodeQL analyses. Actual Deploy `38658184723`
passed five deployment jobs and health/runtime-host checks but failed required
smoke `116175695208`. Ready backend revision `0000319` and the genuine owner's
retained Status report show a whole-suite timeout. The unchanged 55-second suite
catch overwrites individual results; do not infer that every prompt failed,
that the shared capability rule failed or that #820's original cause is known.
C0's earlier incomplete capability reply remains a separate historical failure.

The narrow local backend correction treats application SSE `done` as terminal
and awaits its owned reader cancellation instead of waiting for socket EOF.
Ten added transport cases cover ordinary/smoke metadata, split completion,
real loopback HTTP cancellation, trailing frames, legacy EOF parsing,
pre-terminal errors, caller abort and exact 1 MiB/1 MiB+1 byte limits.
The exact baseline transport blob
`e31e80454675df83d120e42a3e8669ad6d6aa8ac` fails five of those cases; the five
preservation controls already pass. Corrected transport plus unchanged canary
tests pass 71 cases. Existing Windows Node 22.23.3/Vitest 5.0.2 tools were reused
through an owned local dependency junction; no restore, pins, TLS, shared settings
or runtime limits changed. Scoped lint passes. Strict types still report twelve
local missing-package/coupled diagnostics, independently identical to the exact
baseline under unchanged full-program compiler options; a complete pinned build
is not claimed.
This is actual module/reader and loopback transport evidence, not a live Foundry
reproduction or exclusive explanation of the release timeout.

Freeze and independent narrow review, fresh changed-head full Linux CI/CodeQL
and normal required release remain mandatory. Preserve `chat_runtime.py`'s
separate #816 owner. Existing Foundry agent-read permission returned 403;
no new grant, alternative identity, token extraction or bypass is allowed.
Do not increase deadlines, weaken smoke or retry the unchanged failed release.

Factory #850 is ready at `467cb5d`, with eight-path BCE containment, exact V2
runtime/tests and all 381 PLAN pipe lines preserved. Fresh CI `38659103136`
passed ten actual jobs, CodeQL `38659103178` four analyses; pinned Linux
runner204/agent398 both executed. Merge remains held on main release recovery.
Require normal Deploy and exact-released-SHA Runner deploy before the one
authorised existing-task sandbox job. No approved fixture/job has been consumed.
#851 was externally closed on 14 October, not closed by this coordinator;
#849 contains real source and must not be treated as an empty delivery surface.

## Historical required release gate (14-15 October 2026)

Reference #830 was normally squashed into `c0d0aeef` after its reviewed ten CI
jobs and four CodeQL analyses. Normal Deploy `38649690138` successfully ran the
other five selected jobs but failed required smoke job `116148437669` at
22:54:48 UTC. This is not an accepted release. The genuinely signed-in owner
Status page read the retained report without running another canary:
`chat_capabilities` displayed "Capabilities reply incomplete"; every other
individual check displayed OK. The verified C0 canary branch
`capabilities_reply_incomplete` follows successful actual discovery and a complete
Notes/Calendar/GitHub receipt. Which reply category was missing is not retained;
do not infer a raw reply, blame the reference pin or claim the historical #820
cause.

The local candidate adds one shared model instruction rule for chat, voice and
smoke: summarize every successfully discovered category without inventing
categories, treating labels as data, and preserving failure/refusal reporting.
It does not rewrite model output or change canary predicates, token limits,
permissions or resources. Fifteen synthetic actual-handler cases cover both
request rounds, EN/DA chat/smoke, voice, successful/refused/failed discovery and
unchanged incomplete provider output. The existing Windows Python 3.12.10
snapshot ran all 398 agent tests successfully; the fifteen new cases fail
against the asserted exact `3e29a04e` baseline model blob. These are instruction-delivery controls,
not proof that a real model now answers completely. Independent review, changed
head full CI/CodeQL and the legitimate normal release gate remain required.
Only demonstrated `fix-main:` delivery may merge while the release gate is broken.

Existing #848 head `3e29a04e` passed all ten actual CI `38650651609` jobs and four
CodeQL `38650651464` analyses, including 178 backend files / 3,170 tests and
strict backend/web builds. It is not merged/released/live-accepted. Keep the
original Google issues open and preserve their approved write/fixture boundaries.
The original frozen Google and Factory review receipts remain immutable.

## Accepted recovery and Factory release (14 October 2026)

Diagnostic #831 merged normally as `51bda5cb` after independent review,
all ten actual jobs in CI `38618143799` and all three CodeQL analyses.
Normal Deploy `38622011802` passed backend, web and actual smoke checks;
unchanged infrastructure and hosted-agent deployment were skipped.
Backend revision `0000315` is ready with the new image. The bounded
19:22–19:24 UTC revision-only log query returned 314 backend rows and
15 smoke events; chat canary, capabilities and GitHub read each reported
`ok` once at 19:23:18 UTC. No provider/prompt/result text was retrieved.
This establishes that accepted release, not the historical cause
or original phone/voice/Google acceptance. #820 remains open.

The owned #842 integration preserved its two accepted Factory UI blobs
and all 309 main task rows. Head `8c630f7e` passed all ten actual jobs in
CI `38625737093` and all three CodeQL analyses, then merged normally as
`36d72090`. Normal Deploy `38629181064` passed Web, its deployed deep-link
check, backend health and actual smoke at 20:09:21 UTC. Backend,
infrastructure and hosted-agent deployment were correctly skipped.
This accepts the asset release, not the original production trigger,
performance or human first-turn navigation; issue #813 remains open.

Next-delivery snapshot: #818's independently reviewed inactive body-fat
correction preserved every reviewed health blob and main task-table cell
after integrating `36d72090`. Head `af5ac2e7` passed all ten actual jobs in
CI `38631864211` and all three CodeQL `38631863844` analyses, then merged
normally as `5939fb54`. Normal Deploy `38633353086` passed backend image
deployment, backend health and actual smoke at 20:43:27 UTC; unchanged web,
infrastructure and hosted-agent deployment were skipped. This accepts the
inactive correction release, not registration, activation, original Daily/data
or private/device acceptance. #720 subsequently closed at 22:13 UTC for its
original inactive code/synthetic scope: the acceptance lane found no new gap,
and the coordinator verified 63 relevant inputs against the actual tested
#841 head, accepted `202ead5b` and later main. That tested/accepted tree is
`b05a2380`. Actual CI `38636782270` passed health-processing SQL 18,
health-upload SQL 12, normalization 45, read-model 2, upload 15 and lint/build.
The lane's npm proxy/TLS failures remain unexecuted local checks, not those
hosted results. Existing #808/#818 source and native #718/#719 dependencies
needed no new code/release. Activation, real HAE/source/phone parity and
private backup/import/cutover remain separate unverified gates.
The six maintenance deliveries reached accepted main `202ead5b` through
existing #841. Exact-head CI `38636782270` passed all ten actual jobs and
CodeQL `38636782376` all four analyses, including real production C#
extraction. The reference check actually used Python 3.13.16: both baseline
and combined manifests verified all 90 pins, passed pip check, 42 offline
tests and a synthetic HS256 round trip. The earlier local TLS failure
remains a failed local installation, not that hosted evidence.
Normal Deploy `38638073176` passed all six selected jobs: Plan,
Infrastructure, Backend, Hosted agent, Web and Smoke. None was skipped.
The six original issues completed after acceptance; superseded PRs
#822/#823/#824/#834/#836 closed without another release. Project run
`38640886223` executed token-backed Sync board successfully; this is not
browser observation or blanket advisory clearance.

Google freezes `3073B943`, `F3BD79DA` and `CEC84A7A` remain immutable FAIL.
The same independent reviewer passed replacement `3AF653B5`, head
`139ca8f7` / tree `05c77007`, for the two CEC residuals and coupled controls.
The coordinator integrated current main `5064afe4` normally without conflicts;
the later main commit changes only generated PLAN status cells. Reviewed
runtime/test blobs remain the publication boundary. Full pinned CI, the
previously unrun app/relay checks and normal release remain pending; no
Google release or original live acceptance is claimed.

## Consolidated main recovery (14 October 2026; local)

Dan directed important work to local sessions and deferred the proposed Factory
release-policy redesign. This recovery combines existing PR #831 (`291cca34`)
and #832 (`85e55164`) with current main `81580919` in an owned worktree,
uncommitted and unpublished. The coordinator owns publication and normal release;
do not create another issue/PR, rerun smoke or redeploy unchanged images.
Preserve main's unrelated source, including the eight accepted mobile blobs.

Smoke discovery returns Notes, Calendar and GitHub labels from the registered
tool names; the agent extracts those into its actual tool receipt. The smoke role
does not receive the normal-chat capability instruction block. Missing explicit
smoke discovery guidance is a candidate, not an established production cause,
and this patch does not change model instructions. The authorised fixed-format
numeric model-round query in the existing Log Analytics workspace returned no
matching records for 17:32–17:34 UTC. It read no provider or personal text.

Both HTTP Status routes omit reasons unless a check is `down`, preserving
already-open legacy clients during parallel backend/web deployment. Internal
snapshots retain allowlisted degraded reasons. Only an authorised smoke run
emits `system.smoke_check` through the existing stdout/telemetry allowlists;
ordinary `/status` reads do not rerun or re-log checks. No new access, provider
experiment, budget/timeout/model or confirmation change. SDK-managed Copilot
processes omit `--remote`; remote-enabled state remains unverified and no
duplicate process or shared settings change is made.

Qualified local checks: 169 tests pass across chat-canary, system-status,
chat-agent and logging; 42 contracts tests, contracts lint/build and all thirteen
affected backend files' zero-warning lint pass. The independent review passed
the diagnostic patch, not production recovery. Tooling is an owned copy of a
read-only snapshot (Vitest 5.0.2, Vite 8.3.1, ESLint 10.11.0, Node types 22.20.4,
TypeScript 6.0.3), with aliases pointing only to this child source. The supplied
portable Node 22.23.3 x64 resolves the original ARM64/native-binary mismatch
without a global Node/PATH change. Five app-dependent suites cannot import
missing `@fastify/multipart`; the full backend build also lacks `sharp`,
`pdfjs-dist`, `@azure/storage-queue` and `@fastify/rate-limit`, with derivative
declaration errors. These are blocked checks, not passing builds or source
failures. No pins, TLS settings, types or checks were weakened. Exact-head
pinned CI and the safe live failing predicate remain coordinator-owned gates.

## Mobile/Status review publication (14 October 2026)

Dan approved commit, push and a separate review PR for the accepted
fourteen-file mobile/Status correction. Use its separately scoped app
publication worktree, not mixed `ui/shell-iteration` history. This supersedes
the earlier publication holds below, but not merge/deployment, live turns,
physical-phone/voice acceptance or downstream #798/#797/#792 holds.

The publication base is `439a000b07199060cdfcf9d424638950394e9be5`.
Main's generated PLAN updates restored the original `In progress` cell;
implementation and configuration match reviewed runtime base `b787788`.
Preserve complete current-main document bytes and actual cells.
The eight source paths remain byte-identical to accepted patch `427F2A2E`;
its two hook files already use LF, distinct from the linted CRLF raw hashes.

Retained runtime receipt `validation-evidence.json` has SHA256
`B94CC9E8C855B0F42F52723E2AAF61AF2089D1B43A86E3020878568635195CBA`:
nine files/258 passing tests, types/build/whitespace, with actual main Factory
and contracts rather than frozen Factory runtime. Available Vite 8.3.1,
Vitest 5.0.2 and Node types 22.20.4 differ from declared 8.3.2, 5.0.3 and
22.20.5; this is not pinned-toolchain CI. No additional local gate ran here.
Retain `F77C1785` seven-file lint evidence through normalised source and
unchanged configuration equivalence; CSS remains excluded, not linted.

Preparation uses a read-only seed and an owned bare clone/worktree. Parent/UI
working files, HEAD, drafts, shared dependencies and original5173 are not
changed. The configured checkouts share Git metadata; do not claim the
common metadata globally unchanged. Existing `/remote` state remains
unverified; do not start a duplicate CLI or change shared settings.
The original production trigger, phone/voice acceptance and router rollback
are not established by this publication.

## Page completion deadline follow-up (14 October 2026; local)

This supersedes the previous coupled App/test hashes and their final lint
receipt below, without changing the preserved mobile-only or Factory work.
The current App hash is
`F87741542F326E4CE407BAA4F2206B4D133B1C337FB698EC099FC8A898ABC85F`;
the current App.test hash is
`C74809A4CF7B7C006415057D0A3303F5ABC7B673BD66686B7490FA8DA00B0F75`.
Both successful completion paths recheck the captured deadline. Existing
refusal reasons and disposal remain intact; late routing is not rolled back.

Final six probes replayed against the pinned reviewed `759B8BDA` actual App
produce four false-success failures and two pre-deadline passes. The same
probes pass against the correction, with 149 passing assertions across App,
page-navigation, now-feed, NowFeedPanel and StatusPage. Only the deadline
callback is held; React/testing timers remain native and the command timeout
is not extended. The fixture also tests one late callback without a second ACK.
Final strict types pass. Scratch production build covers the unchanged
`F8774154` runtime source; the native-timer fixture correction subsequently
passed types/tests. Final seven-file scoped lint passes with zero errors and
warnings at 2026-10-14T10:56:26.341Z, with unchanged original configuration
and all seven raw source hashes plus CSS checked before/after. CSS is
excluded. The new coordinator receipt is
`status-phone-deadline-lint-receipt.json`, SHA256
`F77C1785D7BB8DF87F8F4428A7B0E9966FFD71CD456D6B80FFC538441010968B`.
The previous receipt remains byte-exact. Neither receipt claims subsequent
LF-normalized hook hashes or new-main CI.

The previous nine-file/252-test receipt remains historical, not a fresh run of
unchanged mobile suites. No new-main CI, original production attribution,
physical-phone/voice acceptance, publication or live activity is claimed.
Original5173, settings/drafts and shared dependencies remain untouched.

## Phone keyboard correction and current Status gate (14 October 2026; local)

The user-directed phone correction uses the actual Workspace/transcript/input
in an owned offline Chromium fixture. All API/provider fetches are blocked;
its messages and VisualViewport events are explicitly synthetic. Draft
preservation uses the native textarea value setter plus bubbling input, not
an untracked DOM assignment. Geometry proof does not establish an actual
iPhone keyboard, Safari, device audio or voice acceptance.

The mobile-only five affected suites pass 186 assertions; strict TypeScript
and a scratch-output production build pass. The earlier expanded six-suite run
passed 243/244: its unchanged voice-unit assertion expects `2.5`, whereas this
machine's default en-DK formatter returns `2,5`. No test or format is weakened.
The preserved mobile-only snapshots pass isolated scoped lint for six
TypeScript/TSX files, zero errors/warnings, with the unchanged project config
and seven before/after source hashes. CSS is explicitly excluded: existing
ESLint has no CSS configuration. That receipt covers the preserved F607 App,
not the later coupled Status App revision. No shared dependencies/manifests
or config are changed.

The final coupled revision also passes isolated scoped lint for seven
TypeScript/TSX files, zero errors/warnings, checked at
2026-10-14T09:47:49.171Z. All seven requested source hashes and the unchanged
CSS hash were verified before/after against the original config; CSS remains
excluded from lint. Receipt: coordinator session artifacts
`status-phone-lint-receipt.json`. The final App/test hashes are
`759B8BDAC2EDE7FDBD81A0CE58FA65EA353A9ECEFD4059DD0498C9247A3E0D1C`
and `2FECAD811EE1D45C97F63D9334479C5DBD80FFCBCCB89BB623858D4E064B03BF`.

Dan has now performed the ordinary Status turn: first completion claim
without visible navigation, then follow-up recovery. Earlier absent-user
statements below are historical, not the current #799 blocker. The local
actual-App trace reproduced a first-ack route-commit race, not the original
live cause. Six first-ack cases and four held-route cancel/deadline/supersede/
unmount cases cover the correction; all nine affected test files pass 252 tests,
with exact final types/build/whitespace checks. A pending route's waiter
observes completion only; it does not roll back an already-requested route.
Held-loader recovery fixtures explicitly change route before releasing old
work and prove no stale success acknowledgement. No substitute live/model turn,
production navigation, physical-phone claim or downstream #798/#797/#792.
Coordinator-only isolated Factory publication approval is not permission
to publish this mixed local checkout or merge/deploy these corrections.

## Read-only Status page (14 October 2026)

P9-101/#799 adds `/status`, rail/phone entries, the existing voice/chat target
and page/window readback. It reads only authenticated `GET /status`, validates
all eleven checks and optional smoke, exposes failure/unavailable reasons,
PC connection/pause state and timestamps, and marks five-minute-old evidence
stale. Refresh never calls `/status/smoke` or model canaries; that report lacks
a release/commit association. Failed refresh retains explicitly previous data.

Local validation: 103 tests across StatusPage, page-navigation and App;
TypeScript, scoped ESLint with zero warnings and Vite build. Chromium fixtures
cover 1440x1000 dark/ordinary motion and 320x700 light/touch/reduced motion:
real controls, broker ack/Status selector, the same Settings-to-Status stream,
stale/failing/unknown evidence, missing versions, disabled pending refresh,
retained HTTP 503 failure and Retry. No document overflow or smoke invocation.
The fixture room is disabled and API responses are synthetic. Exact-head
CI/release and authenticated Status/voice acceptance remain pending.
The 14 October smoke-reader follow-up preserves only fixed per-check allowlisted
reasons for down/degraded results. The original deployed chat-canary failure
cause remains unknown; diagnose retained evidence through `/status`, never by
invoking `/status/smoke` or a model canary.
Keep this PR separate from latency QA, presence/Routines/phone Save work,
unrelated pin changes and the coordinator's #811 backend investigation.

#815 merged at `6e7d85dd` after the final `8c0f2cb2` exact-head gates passed.
Its initial Deploy 38491884715 rolled out successfully but failed smoke:
`chat_canary` reported `acceptance_check_failed` and `chat_capabilities`
reported `capabilities_missing`. The original failed turn's cause remains
unconfirmed under #820; diagnostic-only #821 is not a proven repair.
Normal Deploy 38497362534 on `1590a1c3` passed all six jobs and fifteen actual
production smoke checks. Its Web build and the existing signed-in canvas
both use `main-KDrAC0O7.js` and `main-CA1t_Hqv.css`; no reload was needed.

The coordinator accepted the bounded released read-only snapshot. Actual
Settings-to-Status rail navigation returned `/status` 200 at
2026-10-14T02:15:07.149Z; ordinary Refresh returned 200 at 02:16:07.551Z,
with a newer snapshot time. Both accepted HTTP 204 workspace state/readback:
`page: status`, `viewId: page-status`, 2894 UTF-8 bytes. All eleven system
and fifteen smoke rows rendered without an alert or document overflow at
897x890. Retained smoke was 15/15 OK at 01:55:08.275Z and correctly stale;
it still has no deployment association. PC connection/pause state rendered,
and null bridge/Chrome-extension versions remained "Not reported".
Settings-to-Status and Refresh kept one workspace session, zero new Now
stream requests and the live-connected indicator. Native details worked;
the temporary observer was removed. No extra model/smoke calls, board Retry,
injected commands, Note/native Chrome/draft interaction or settings changes.

Dan subsequently performed the ordinary Status turn. It claimed success
without visibly navigating; the follow-up "I dont see it" navigated correctly.
First-turn live navigation acceptance failed, with no established cause.
This is no longer an absent-human-turn gate, and recovery does not establish
acceptance. No agent-created turn substitutes for Dan's evidence.
Physical-phone, voice and broker acknowledgement are not established by this
report or the earlier browser snapshot. #799 stays open; #798 is held,
followed separately by #797 and #792.

The coordinator authorised one coupled release-gate exception in #815:
the PR-title normalizer, linked-issue ID extraction and PLAN reconciliation
must preserve full two-or-more-digit task numbers, including P9-101. The old
bot renamed it P9-10 and stopped the guarded merge; PLAN parsing also ignored
full rows/issues and shortened dependencies. Five title-gate and nine PLAN
unittest methods cover full IDs/idempotence, boundaries, rows, mapping,
dependencies/ranges and legacy two-digit/WIP/bracket/fix-main/docs formats.
Each dependency range expands at most 1000 tasks; larger ranges raise an
actionable ValueError before iteration, without limiting identifier width.
Allowed-boundary, over-limit and no-large-allocation regressions cover this.
All 57 workflow-script tests and Bash syntax pass locally. Status/ownership
policies are unchanged, including reopened-issue handling. No other workflow,
backend or dependency changes.
The corrected head passed fresh exact-head gates before merge.
The Status branch integrated #808 (`446ce371`), preserving its scoped
health documentation and inactive code without activation or live acceptance.

## Factory consumer refresh correction (#813, local only; 14 October 2026)

This is a separate local delta from the preserved Status release-context
edits above. Controlled actual-component fixtures reproduced repeated
cancellation of deferred 10-second reads, without establishing which event
triggered the original released storm. Automatic invalidations now preserve
an active same-scope read and coalesce into one follow-up; notifications
during that follow-up remain pending for the next read. Scope/identity
replacement, explicit reload and unmount still cancel obsolete work.
Failures remain visible with retained snapshots; there is no unconditional
retry loop or change to the central Now stream, validation, cache TTL or API.

The coupled actual-context check reproduced premature missing-issue and
absent/replaced task-link refusals after an older snapshot settled but before
its queued follow-up started, and during the ordinary idle debounce. The
resolver now consults the request owner's pending/queue/timer state. It waits
within the unchanged budget, never starts a speculative read or applies a
late navigation after timeout, and returns a failed follow-up's visible error.

All 181 focused consumer/store/stream/navigation tests across eight files,
strict TypeScript and the scratch-output production build pass locally.
Controlled browser fixtures exercise retained DOM/scroll/focus, queued late
updates and failure/recovery at desktop and 320px light/reduced motion.
The final navigation delta also passes isolated actual-context browser checks:
missing issues and new task links remain loading across the queued/debounce
gap and active follow-up, then resolve from its snapshot without extra reads.
These are synthetic fixtures, not production, broker, model or device proof.
The isolated 320px frame reports 2px document overflow at the release branch
label; it is not a full-shell layout pass, and no unrelated CSS fix is included.
The coordinator's isolated repository-pinned tooling linted both changed
source/test files with the unchanged repository config: zero errors and
warnings, without altering shared dependencies or manifests.
The frozen review made no backend, dependency, workflow or settings change,
commit, push or release. Dan subsequently authorised only this correction's
commit, push and review PR, not merge or deployment. Publication preserves
the frozen consumer/test bytes and updates the supplied Status evidence.
#813 production cadence/performance acceptance, #798, the main-release gate
and P12 holds remain unchanged.

## GitHub-aligned Factory board (13 October 2026)

P10-07/#793 is owned by Dan and the UI session after merged/deployed #791 and
before #792. The web board now reads the project-required canonical board API,
not the task list. GitHub column placement stays backend-owned; no backend,
contract, dependency or workflow files are changed. The central Now stream
delivers validated board invalidations and reconnect refreshes. Task-free
issues remain usable, and real overlays retain their valid controls/details.

Local checks pass: 160 tests across TasksPage, now-feed, NowFeedPanel, the board
store, ContextPanel, App, styles and TaskControls; TypeScript and scoped ESLint
with zero warnings. Chromium fixtures exercise desktop dark/ordinary motion
and 320x700 light/touch/reduced motion, using a real bounded local SSE fixture
with the production decoder and central publisher. Checks cover canonical
columns, links, local filters/collapse, issue movement, retained board/scroll,
keyboard focus after movement, Recover, failed refresh and cached-data retry.
The card focus resolver fixes the observed narrow-screen return failure after
reparenting. The 3D room is disabled for these isolated board checks; fixtures
intercept all API writes, so this is not live GitHub or physical-phone proof.

PR #806 merged at `100e767d`; exact-head CI 38455208975 passed all 900 Web
tests and Deploy 38456539127 passed Web/smoke. The authenticated
`jarvis-live-release` canvas is the live read path; do not disturb Dan's active
Chrome or extract credentials. After backend #807's Deploy 38464175571 passed,
one read returned HTTP 200. Actual API placement and fresh GitHub Project 2
readback agree: #790 Done, #792 Ready, #793 Done. Rendered placement is not yet
verified: raw closed dates omit `.sss`, so the shared validator correctly
rejected that snapshot. After #809's Deploy 38469134623, the single authenticated
Retry returned HTTP 502 again; no cards rendered at 21:30Z. Fresh Project
placement still reads Done/Ready/Done. At 21:41Z, one authorised read set
returned `/status` 200 with `github_app` status `ok`, Factory tasks 200 and
project 2 releases 200. No repeated board retries, credential extraction or
Note changes. After diagnostic Deploy 38475702418 on `d35f332b`, the one
authorised project-2 board read returned 200 at 22:18:24Z, with `stale: false`
and canonical closed dates. The entire response passed web validation and all
six columns rendered without an alert. Actual visible DOM cards place #790
and #793 in Done and #792 in Ready, matching fresh Project 2 readback.
This verifies that rendered-board gate, not a root cause or sustained recovery.
The coordinator owns backend/provider investigation; do not weaken validation
or edit backend code.

The user-directed post-merge issue-number navigation follow-up is implemented
locally with page-owned lookup, exact search/unfold/reveal, truthful bounded
acknowledgement and cancellation. The shell keeps its Now stream mounted
while portalling its panel into Settings, avoiding broker disconnection.
Local navigation checks pass: 121 scoped regressions, a final nine-test
reveal-cleanup check, TypeScript, zero-warning scoped lint and Vite build.
Chromium fixtures pass at 1440x1000 dark/ordinary motion and 320x700
light/touch/reduced motion. They verify an issue visible above the composer,
task-free and linked-task navigation, the existing task-ID path, filter/cap
and collapsed-column recovery, delayed acknowledgements, cancellation and a
single stream through Settings. Settled screenshots preserve the existing
Settings layout and foreground task-window focus; no document overflow.
One concurrent run failed to start a Vitest worker; the isolated full rerun
passed without changes to timeouts or checks. The fixture room is disabled;
these checks do not prove live voice, physical phones or production navigation.
PR #810 shipped with its review follow-up: epoch/session-bound command queues
and actual issue-focus workspace selectors with lifecycle clearing. Local
scoped regressions pass 125 tests, and the separately requested unchanged
Workspace online pin-recovery regression passes locally without changing its
assertions or timeout. These are not the full Web suite. Exact-head CI and
CodeQL passed for `177e73e3`; merged at `b4915164`, Deploy 38479582927 passed
Web/smoke. The signed-in production canvas loaded that release's bundle.
An ordinary chat request from Settings at 22:49:33Z received an applied HTTP
204 ack and HTTP 204 Factory state with issueNumber 792 and no stale window
selector; the real #792 title was focused in Ready. The session/stream
persisted without a new `/now/events` request. Actual collapse and route
clearing also received HTTP 204. Pure focus-away-only clearing remains
fixture-only because this background canvas emits no native focus events.
Coordinator logs independently corroborate the chat/broker/state/board reads.
Dan's original Note/native Chrome were untouched; the earlier 502 cause is
still unconfirmed and backend-owned. Keep port
5173 running, `.ui-session-handoff.md` untracked, `.impeccable` excluded and
the preservation stashes intact. Ship from `ui/shell-iteration`; report the
PR immediately and let the coordinator merge on exact-head green CI.

## Remaining UI release (13 October 2026)

Dan explicitly authorised "Deploy everything. so i can test live." Ship all
remaining chat/composer, Notes/graph and report-surface drafts together from
the existing `ui/shell-iteration` branch. This supersedes their earlier release
holds/split instructions below. Camera #750, loading #751 and windows #752
are already deployed. Do not change backend code, dependencies or workflows.
The coordinator merges on exact-head green CI; verify that merge's Web/smoke
deployment and public bundle before claiming the remaining UI is live.

Local checks pass: scoped ESLint `--max-warnings 0`, TypeScript `--noEmit`,
Vite build, and 368 tests across fourteen affected suites. One unchanged
Windows-locale voice-unit case is excluded locally; CI runs it normally.
Desktop and 320px phone Chromium checks pass for chat geometry/scrolling,
Notes inventory/saves/conflicts and report controls/theme changes, with desktop
Notes WebGL/canvas continuity also checked. Fixtures intercept API writes.
Concurrency caused earlier timing failures; isolated reruns pass without
extending timeouts. Physical phones, live voice and real vault edits remain
Dan's post-deploy acceptance.

Keep port 5173 running against production and preserve the release-preparation
stashes. Keep `.ui-session-handoff.md` untracked and `.impeccable` cache out of
the release. Dependencies still use the corporate-feed junction; local
Vite 8.3.1/Vitest 5.0.2 do not replace CI's pinned 8.3.2/5.0.3.

Current P12 release (14 October 2026): Dan moved implementation to **local DailyMigrationMain**; both cloud workers stay idle. #808 delivered #720's inactive synthetic health processing; its automatic review found an unsupported body-fat unit fallthrough. The [existing #720 claim continues](https://github.com/DanAakesen/jarvis/issues/720#issuecomment-6157857536) for only that correction and synthetic normalization/SQL regressions in `C:\Repo\Jarvis-daily-migration`, branch `codex/p12-05-body-fat-units`, a separate Refs #720 follow-up from fresh main. Do not push the merged #808 branch. Fetch moving main, preserve unrelated work and require exact-head full CI/independent review; no own merge or next issue. No original Daily/source/data/credential, phone, resource/grant or activation changes. See [current boundary](#dailydevelopercloud--p12-execution-boundary) and [processing contract](../apps/backend/src/daily/health/README.md).

**Release clearance, 14 October 2026:** Dan directly approved inactive PR #818 after latest-main integration, required checks and independent review, and said routine CI/CD must not need approval again each time. For already-authorized inactive P12 scopes and their corrections, the independent release path may merge and use normal main-only deployment once those gates pass; do not add another per-PR human release-clearance gate. This supersedes the earlier #818 hold, not scope/dependency gates, branch protections or the no-own-merge rule. Both cloud workers stay idle. Activation, protected credentials/private-data operations, live/device acceptance and eventual cutover retain their existing authority and evidence gates; this does not start another scope or authorize a new worker.

## Workspace window release (12 October 2026)

Dan and the coordinator authorised #430 whole after #751 merged, including
pin-load idle/HMR recovery. The scoped candidate retains merged camera/chat
and excludes Notes, report surfaces and floating-chat geometry/density.
The coordinator merges on green and then starts #621. State the exact operation
names and first-`viewId`-frontmost cascade ordering in the PR description.

The exact candidate passes TypeScript, zero-warning scoped ESLint, Vite build
and 237 tests across App, Workspace, pins/loading, layouts, HTML pin bridge,
history and shared styles. One unchanged Windows locale assertion was excluded
locally, not altered in source. Chromium fixtures pass on desktop dark/light
and 320px light/touch/reduced motion, including pin failures, Retry, save/update,
reload, unpin, all-window actions, return/online recovery and camera handles.
These are synthetic API/stream checks, not live voice or physical-phone proof.
Keep port 5173 running and preserve all remaining drafts and preservation stashes.

Readback assertions now check all added snapshot fields with exact equality.
All eight readback tests pass, as do scoped lint and TypeScript. The broader
Windows run records 794 passes, three local failures (en-DK date expectations
and Vitest 5.0.2 Blob compatibility), and the unchanged voice-unit exclusion.
Corrected CI 38314502702 passes all 798 Web tests, lint and build. #752 merged
at a938d9ae; Deploy 38315279862 Web and smoke passed. Production serves
main-0nFp7WoF.js with window pins, chat loading and camera preview intact.
#621 is unblocked on main. These outcomes supersede earlier pending states.

## Chat loading correction (12 October 2026)

Camera #750 merged. The coordinator confirmed PR2 is chat loading only; do not
pull saved-pin infrastructure into it. PR3 is the whole #430, including tested
pin-load recovery. Continue on `ui/shell-iteration`, preserve the dirty local
drafts, and keep the port-5173 server running.

The isolated chat candidate passes `tsc -b apps/web`, scoped ESLint with
`--max-warnings 0`, Vite build and App/ConversationHistory suites: 122 pass,
one unchanged Windows decimal-format baseline excluded. Synthetic Chromium
checks cover pending history, first-load error/Retry and stable frame identity
at 1480x1000 dark and 320x700 light/touch/reduced motion. No live-outage claim.
The coordinator merges on green; no backend or dependency changes.

## Camera UI release (12 October 2026)

Dan approved shipping #695 at 21:20 via the coordinator; earlier release holds
and five-minute camera shutdown instructions below are superseded. Ship camera
alone from `ui/shell-iteration`, preserving Notes, floating-chat and #430 drafts.
The coordinator merges on green CI. Keep the port-5173 hot-reload server running.

The isolated camera candidate passes TypeScript, scoped zero-warning ESLint
and production build. After main reconciliation all twelve scoped suites pass
362 tests, with the unchanged OS-locale-specific
`Voice · 2.5 voice minutes` expectation excluded (Windows renders `2,5`).
Synthetic Chromium checks pass at 1440x1000 dark/ordinary motion and
320x700 light/touch/reduced motion: preview, direction/switch, unchanged composer,
docking, fresh handle-only chat/EN/DA payloads, Close and ten-minute idle shutdown.
API/WebSocket responses and camera streams are fixtures, not live voice evidence.
Dan and the coordinator report live chat image acceptance; physical phones and
live voice remain to check after deployment. No backend or dependency changes.


Project-specific working context for agents. The generated `AGENTS.md` is not edited; additions belong here.

## CI workspace ownership (16 October 2026; P11-08)

Web's lint, test and build commands explicitly select `@jarvis/contracts` then
`@jarvis/web`. The dedicated Backend workflow owns `@jarvis/backend`; unscoped
root scripts in Web duplicate those checks. Keep contracts in the Web selection,
root `npm ci`, every existing component/analysis and the aggregate gate. This is
execution deduplication, not permission to skip checks or run another local
test/build campaign. Normal exact-head CI verifies the actual command selection.

## Scope

- Phase 1 is the Jarvis core and Software Factory; active P7 tasks may add their named headless capabilities. P7-22 provides Google Calendar and Gmail tools only; P8 owns any UI. See [PRODUCT.md](../PRODUCT.md) and [PLAN.md](../PLAN.md).
- Do not add tables, pages, or code for Banking, Health and fitness, or other areas until their phase starts.
- P7-19 browser actions use only current screen-share context plus the existing P7-17/P7-18 browser path; do not add a separate bridge, persist page data, or access the live Jev key.
- Single user (Dan). Keep the design as small as the requirements allow.

## Sources

| Need | Read |
| --- | --- |
| Requirements, page data points, and actions | [PRODUCT.md](../PRODUCT.md) |
| Phases, tasks, task status, acceptance criteria | [PLAN.md](../PLAN.md) |
| One issue per task: start trigger, discussion, linked PR | [GitHub issues](https://github.com/DanAakesen/jarvis/issues) in `DanAakesen/jarvis` |
| Stack, runtime, sandbox, voice, dispatch, cost | [architecture.md](architecture.md) |
| Tables, relationships, and groups | [data-model.md](data-model.md) |
| Step-by-step flows with evidence status | [architecture-flows.html](architecture-flows.html) (open in a browser) |
| Decisions and learnings L1–L78 | [decisions.md](decisions.md) |
| Production operations | [Runbook](runbook.md) |
| Prototype code and reports to port in P2 and P4 | [reference/](reference/) |
| Open-source research | [open-source.md](open-source.md) |

## Development workflow

Every coding agent on this repository follows these rules. Normally this project requires one pull request per task; that overrides the template's "no PR required". Dan's current coordinator-directed consolidation uses the existing delivery PRs rather than creating duplicate PRs.

### Where work happens

- **Important implementation stays local; use selective cloud work when useful.** Dan's 14 October overnight direction permits parallel local subsessions and bounded Copilot cloud work for independent lanes. Google, Factory lifecycle and Daily acceptance stay separately owned locally; the existing #830 reference-compatibility continuation is cloud-owned. The coordinator owns existing delivery PRs, normal CI, releases and both boards. Do not duplicate owners or start cloud workers merely to move cards. This supersedes the earlier remote-default, P12-only exception and blanket no-cloud rule. `main` remains the shared source of truth; delivery requires current-main reconciliation, independent review and exact-head checks.
- The runner instructs coding agents on every turn, including resumed or recovered sessions, to commit and push small work-in-progress changes to the existing task branch after each meaningful step. Never force-push or push to `main`; report commit or push failures.
- **Stay within Dan's local authorisation.** The current direction already authorises scoped local implementation, review and coordinator integration; do not repeatedly request that permission. New destructive, access, private-data or otherwise unauthorised actions still need approval. Bootstrap and credential/login prompts remain human-owned.
- **No Azure access for agents.** Changes reach Azure only through the deploy workflows on `main`; GitHub Actions can sign in to Azure only for `main`. In a PR, check infrastructure without Azure (`az bicep build`, linter); the deploy after merge proves it against Azure. Verify Azure behaviour from those workflow runs, or ask Dan.

### Task status

- Every task in [PLAN.md](../PLAN.md) has a [GitHub issue](https://github.com/DanAakesen/jarvis/issues) in `DanAakesen/jarvis`. The title starts with the task ID (for example `P1-04: Tasks API`), the label is the phase (`P0`–`P6`), and the body copies the task, acceptance criteria, and dependencies. Find one with `gh issue list --repo DanAakesen/jarvis --state all --search "P1-04 in:title"`.
- **Dependencies:** the Depends on column is mirrored as GitHub issue dependencies ("Blocked by"). An issue shows **Blocked** until every issue it depends on is closed. A task is **ready** when its issue is open, not blocked, and has no worker label; list ready tasks with `gh issue list --repo DanAakesen/jarvis --search "is:open -is:blocked -label:Codex -label:Copilot -label:Dan -label:Jarvis"`. Ready tasks can run in parallel.
- Dependencies order tasks; they don't stop two ready tasks from changing the same files. That is what step 5 of [Start a task](#start-a-task) and the up-to-date rule in [Merge](#merge) are for.
- GitHub issues and Project 2 are the canonical backlog and live status. `PLAN.md`
  records implementation progress and context; reconcile stale plan text to
  the issue rather than overriding a newer user report or board state.
- When a PR adds a task to `PLAN.md` or changes one, its issue must match: create or update it, including its "Blocked by" dependencies. If you can't edit issues from your environment, list the needed issue changes in the PR body. P0-13 automates this.
- When a task row is added to `PLAN.md` on `main`, the plan-status workflow creates its issue in the standard format, with the phase label and "Blocked by" dependencies. If an existing task's description or acceptance criteria change, update the issue body too; the workflow reconciles dependencies but does not rewrite existing issue content.
- Status values: **Not started**, **In progress**, **Blocked**, **Complete**. The Issue and Status columns in `PLAN.md` on `main` are the shared issue and status view of the project.
- **Worker labels show who has taken a task:** `Codex`, `Copilot`, `Dan`, and `Jarvis` (Jarvis's own coding agents, from P2: the Software Factory, default agent `codex`). From P10 (8 October 2026) GitHub issues are the only backlog: adding `Jarvis` to an issue starts a Factory task for it, and Jarvis-raised work is created as a `P11-NN` issue first. **A worker label on an open issue means that worker has taken the task; nobody else may start it.** On a closed issue the label stays as a record of who did it. An issue has at most one worker label.
- **Board labels (8 October 2026):** a worker label means that worker is *actively* on the task. Dan's own manual steps and decisions use `needs-decision` (column **Needs Dan**), never `Dan`. UI-session work that has not started uses `deferred` (**Backlog**); the UI session swaps it for `Dan` when it starts. A PR that fully completes an issue can use `Fixes #N` (batch PRs list one line per issue); use `Refs #N` for partial handoffs whose acceptance issue must remain open after merge. GitHub may close issues from native closing associations or recognized closing keywords in the PR body—including singular verbs such as `fix`, `close`, or `resolve`, even inside negated sentences. Before merge, check both the PR body and GitHub's native `closingIssuesReferences`, and remove any unintended close reference. After merging partial work, verify the issue is still open and reopen it if GitHub closed it before acceptance is complete. The coordinator's board round closes issues whose work merged without a link and flags worker-labelled issues idle for 24 hours.
- Dan (or later Jarvis) starts a task, from the issue or directly in the agent's app. **The worker sets its own label** (step 1 of [Start a task](#start-a-task)); Dan never labels or assigns by hand, except `Dan` for work he does himself.
- A task is **In progress** when its open issue has a worker label or an open PR containing `Fixes #<issue>`. An issue closed as completed sets Complete; otherwise a manually set Blocked value is preserved. A merged linked PR completes only a closed issue; a historical merge does not complete an open or reopened issue. An open issue without a worker label or open linked PR is Not started.
- `.github/workflows/plan-status.yml` recomputes every task on issue assignment/unassignment/closure/reopen/label/unlabel, PR open/close/reopen/edit, completion of the Worker label workflow, or `workflow_dispatch`. A `PLAN.md` push also creates missing issues and dependency links. The workflow writes the Issue and Status columns; agents edit those columns only before P0-13 is merged. It serializes runs, commits only those columns, skips no-op commits, and rebases/retries once after a rejected push. `GITHUB_TOKEN`-made commits do not trigger another push workflow.
- The status workflow requires `contents: write`, `issues: write`, and `pull-requests: read`. A protected-`main` push and the REST issue-dependency writes have not yet been verified against a live workflow run. After merge, run **Plan status** through `workflow_dispatch` and verify the test task before relying on live writes.
- Issues that existed before worker labels: Codex's claims used Dan as assignee. Those were relabelled `Codex` on 3 October 2026; ignore an assignee without a worker label.

### Task board

Dan follows the work on the [Project Jarvis board](https://github.com/users/DanAakesen/projects/2). Every open issue is on it. [`project_board.py`](../.github/scripts/project_board.py) sets its Status column; nobody moves cards by hand, because the next sync moves them back.

| Column | Meaning (open issues) |
| --- | --- |
| **Backlog** | Blocked: at least one issue it depends on is still open. |
| **Needs Dan** | Unclaimed `needs-decision` issue, including a parked linked draft; a review-ready linked PR still takes precedence. |
| **Ready** | Not blocked, no worker label, no open linked PR: any worker may claim it. |
| **In progress** | Has a worker label, or an open draft PR with `Fixes #<issue>` without `needs-decision`. Task state/activity alone does not claim the issue. |
| **In review** | Has an open PR with `Fixes #<issue>` that is ready for review: waiting for checks and merge. |
| **Done** | Issue closed (the project's built-in "Item closed" workflow). |

- The rules are in `project_board.py` and its tests. Ready on the board is the same as **ready** above.
- **Who syncs:** [`project-board.yml`](../.github/workflows/project-board.yml), in the cloud. It reconciles every open issue on issue open/close/reopen/label/unlabel, PR open/close/reopen/ready/draft/edit, after each **Plan status** run, daily at 05:17 UTC, and on `workflow_dispatch`. It adds missing issues and writes only cards whose column changed. It uses `pull_request_target`, so PRs with merge conflicts still sync (L38), and never checks out PR code. Nobody needs to ask an agent.
- **Token:** projects owned by a personal account can only be edited with a classic token (`repo` scope); GitHub Actions tokens, GitHub Apps, and fine-grained tokens can't. The token is the `PROJECT_TOKEN` secret of the `project-board` environment, which only `main` may use (deployment branch policy), so workflows on agent PR branches can't read it. Verified on 3 October 2026: a workflow on a test branch was rejected with "Branch is not allowed to deploy to project-board". Without the secret, a run only warns.
- Manual run, for example to test: `DRY_RUN=1` lists the moves without writing; see the environment variables in the workflow.
- The project's built-in workflows may set a column first (item added, PR linked, PR merged); the sync runs seconds later and sets the final one. Built-in "Item closed" moves closed issues to Done.

### Start a task

1. **Claim the issue before anything else: set your worker label.** Find the issue by task ID, then:
   - If it already has a worker label that isn't yours, or an open PR with `Fixes #<issue>` that isn't yours, the task is taken: stop and say so.
  - **Codex:** add the `Codex` label and a comment, using `GH_TOKEN` from the environment: `gh issue edit <n> --repo DanAakesen/jarvis --add-label Codex` and `gh issue comment <n> --repo DanAakesen/jarvis --body "Claimed by Codex at <UTC time>."`. Don't assign the issue. Without `gh`, call the REST API with `curl` (`POST /repos/DanAakesen/jarvis/issues/<n>/labels` with `{"labels":["Codex"]}`, and `/comments`). If the claim fails, stop and report it; never work on an unclaimed task.
  - **Copilot cloud agent:** Copilot can't edit labels, so the [Worker label](../.github/workflows/worker-label.yml) workflow keeps `Copilot` on an open issue exactly while an open Copilot PR links it (`Fixes`/`Closes`/`Resolves #<issue>`), or while the issue is assigned to Copilot and no Copilot PR for it was closed unmerged. Each run recomputes all open issues ([rules](../.github/scripts/worker_label.py)). Started outside the issue, open the draft PR with `Fixes #<issue>` in its body first.
  - **Dan** adds `Dan` himself. **Jarvis** (from P2) adds `Jarvis` when its dispatcher starts a task.
  - **Releasing a task:** a worker that stops without delivering removes its label and says why in a comment. The Worker label workflow removes `Copilot` when Copilot's PR closes unmerged.
2. Read the current `main`: the Issue and Status columns and Current focus in `PLAN.md`, the relevant [decisions](decisions.md), and the files the `AGENTS.md` context map names for your area.
3. Check that `main` is green: the latest `CI` and deploy runs on `main` passed (before P0-11 adds deploy, only `CI` counts). If not, stop. The only allowed work is a fix for `main` (PR title `fix-main: …`).
4. Check your task: not Complete, not claimed by anyone else, and every task in its "Depends on" column Complete. If any check fails, stop and report it on the issue.
5. Look at the running tasks (issues with a worker label, In progress rows, and open PRs). Stay out of files they change, or say in your PR why you overlap.
6. Use one branch and one PR. The PR title is exactly `<task ID>: <short summary>`, for example `P0-05: Foundry account and project`: the ID, a colon, a space, no brackets. Copilot's temporary `[WIP] ` prefix is fine. Work outside a task uses `fix-main: …` or `docs: …`. The [PR title](../.github/workflows/pr-title.yml) workflow validates current same-PR/head metadata and fails with the normalizer's suggested title for small deviations; save that title rather than expecting an automatic edit. The PR body contains `Fixes #<issue>`. When the PR merges, GitHub closes the issue, and the tasks it blocked unblock automatically. Never remove "Blocked by" links by hand; they stay as history. If a task needs more than one PR, use `Refs #<issue>` in all but the last.

### Finish a task

Before marking the PR ready, update the repository in the same PR so the next agent needs no other context:

| What your task did | Update |
| --- | --- |
| Always | `PLAN.md`: task Status Complete; Current focus (active phase, next step, blockers) |
| Added or changed product behaviour or a requirement | [PRODUCT.md](../PRODUCT.md) |
| Changed the stack, packages, versions, service boundaries, data flows, identities, or deployment | [architecture.md](architecture.md) |
| Made a choice, accepted a trade-off, or answered a **Verify** item | [decisions.md](decisions.md) decision log: date, decision, rationale and evidence, status |
| Hit a mistake or pitfall another agent could repeat | [decisions.md](decisions.md): a new learning (next free L#) |
| Added or changed tables, columns, indexes, or migrations | [data-model.md](data-model.md) |
| Added or verified a command, environment variable, secret name, or setup step | this file |
| Built or proved a step in a flow | [architecture-flows.html](architecture-flows.html): the box status |
| Settled a visual direction or found a UI issue | [DESIGN.md](../DESIGN.md) |
| Added, changed, removed or verified a feature (including new planned tasks) | [features.md](features.md): its row's status, surface and tasks |
| Found work outside the task | `PLAN.md`: a new task (next free ID in its phase, Depends on filled in, Not started) or an entry under Ideas. Update the Depends on column of any task this changes. Never drop it silently. |

The PR body states what changed, how it was verified (commands and results), what remains unverified, and follow-ups. Then mark the PR ready for review; never merge a draft, and never merge a PR whose diff against `main` is empty or whose only commits are a plan or merges from `main` (L69).

Every task issue ends with the same "Before you start" and "Definition of done" checklist that summarises these rules. New task issues get it too.

### Merge

- The integration coordinator or Dan squash-merges a PR when it is ready (not a draft; see Copilot drafts below), no agent is still working on it, its title starts with a task ID, `fix-main:`, or `docs:`, all required checks/review pass, and it contains the latest `main`. The coordinator owns mechanical integration conflicts; substantive corrections return to the existing builder. Requalify a changed candidate, never assemble unrelated green receipts.
- **Actions minutes cost money.** The account's free Actions minutes are limited; CI skips draft PRs, and agents push in few, meaningful commits. Never add scheduled or per-event workflows without checking their minute cost (L83).
- **Never start from a broken `main`.** After every merge, deploy runs on `main` (CI already passed on the up-to-date PR, so it is not repeated on `main`, L83); deploy skips documentation-only changes and deploys only the parts that changed ([P0-11](../PLAN.md#p0--foundations)). If either fails, merge only `fix-main:` PRs until `main` is green again. Only a **failed** run blocks: a queued, pending or in-progress Deploy is not a broken `main`, so start or continue your task (L75).
- **Copilot drafts:** Copilot cloud agent never marks its own PR ready; it finishes by removing `[WIP]` from the title and requesting review. The [Copilot PR ready](../.github/workflows/copilot-ready.yml) workflow then marks the PR ready, also after follow-up rounds and while the PR has merge conflicts (L Follow-up rounds (after an `@copilot` comment) can't edit the title, so on Copilot's closing comment the workflow also drops a leftover `[WIP]` prefix.
- Agents never merge their own PRs, push to `main`, or weaken or skip checks.
- Parallel PRs edit the same documents. When your branch is updated, keep other agents' entries, take the next free numbers (task IDs, L#), and recheck that your updates still hold.
- The old #12 coordinator-removal instruction is superseded by operating model 2
  above. Existing Project board sync and its `project-board` environment remain;
  no new scheduler, coordinator service or permission grant is introduced.
## Azure

| Item | Value |
| --- | --- |
| Subscription | "Dan Aakesen", `0ac7d719-89bc-4100-be87-a79d33e953a7` |
| Tenant | Novaro, `802efa29-17f2-4a79-8f5f-38f087aed96a` |
| Region | Sweden Central |
| Dan's Entra object ID | `12bcfab7-49ba-4cf7-8be7-780a13911f93` (the backend's allow-list) |
| Resource group | `rg-jarvis` (one production environment) |
| Bootstrap IDs | [`infra/bootstrap.output.json`](../infra/bootstrap.output.json); also Actions variables in `DanAakesen/jarvis` |

- `infra/main.bicep` deploys into the existing `rg-jarvis`; it does not create the group or bootstrap identities. Run `az bicep build --file infra/main.bicep` and `az bicep lint --file infra/main.bicep` in PRs; the build writes `infra/main.json`, which is generated output and must not be committed. These checks need no Azure access.
- P6-22 records that production does not configure Microsoft 365 or Teams; P10-10 removes the backend Teams bot, messaging sender, cards, audio route, and Teams-specific configuration parsing. Away and Present confirmations both wait in the authenticated Now feed, and active English browser voice sessions announce pending approvals and task status. Existing database tables/rows and installed packages remain; no migration, data cleanup, or infra change is made. Any prior Bot/Speech resources or role assignments require separate authorization to clean up.
- The Bicep deployment must supply `backendIdentityResourceId`, `sqlAdminGroupObjectId` and `foundryNameTimestamp`; `backendImage` is optional (empty skips the backend app, used only before the first backend image exists). The timestamp is fixed at `20261003200000` in `infra/main.parameters.json`, so every deploy updates the existing Foundry account and project in place. Change it only to recover from a deleted account, and then to a fresh value (L2).
- Bicep sets `BACKEND_CONTAINER_APP_RESOURCE_ID` and grants `id-jarvis-backend` a custom role limited to Container App read/write on that app. The sleep API uses this fixed target and the existing `SQL_MANAGED_IDENTITY_CLIENT_ID` for ARM authentication. Local tests inject the scaler; a local app without an Azure managed identity cannot perform live scaling, and the Bicep build/lint checks do not verify the deployed role.
- `sqlAdminGroupName` defaults to `jarvis-sql-admins`; the budget defaults to 300 in the subscription billing currency. Deploy requires the `JARVIS_BUDGET_CONTACT_EMAILS` GitHub secret, a comma-separated list including Dan's email. It passes the values through a mode-0600 temporary parameters file to the required Bicep `budgetContactEmails` parameter, then deletes the file. Do not commit email addresses. The first Azure deployment and real resource behavior are verified by Deploy, not by local Bicep build/lint.
- The [Deploy workflow](../.github/workflows/deploy.yml) is the only routine path
  to Azure: qualified `main` pushes and manual dispatch apply incompatible or
  unproven components, retaining exact compatible applied versions. A manual
  dispatch cannot overwrite newer applied source. Bicep remains `jarvis-infra`.
- GitHub Actions OIDC: GitHub signs this repository's tokens with the immutable-ID subject `repo:DanAakesen@68902534/jarvis@1403065900:ref:refs/heads/main`, not `repo:DanAakesen/jarvis:ref:refs/heads/main`. `infra/bootstrap.ps1` reads the IDs with `gh api repos/DanAakesen/jarvis` and registers the federated credential `github-main-ids`. An `AADSTS700213` sign-in failure means the credential is missing: Dan re-runs bootstrap; the subject is printed under "Federated token details" in the `azure/login` step (L49).
- Dan's Azure CLI defaults to the Microsoft tenant: pass `--subscription` in every command and script (L7). For Microsoft Graph, get the token with `az account get-access-token --subscription <id> --resource-type ms-graph`; `--tenant` picks the wrong account.
- **Google Calendar and Gmail setup (Dan only):** Create a Google Cloud project and select it in the project picker. Open **APIs & Services → Library**, search for **Gmail API**, open it and click **Enable**; repeat for **Google Calendar API**. Open **Google Auth Platform → Branding** and configure the app name and support contact; under **Audience**, choose **External** for Dan's personal account. Under **Data Access**, add `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/gmail.compose`, `https://www.googleapis.com/auth/gmail.send`, `https://www.googleapis.com/auth/gmail.modify`, and `https://www.googleapis.com/auth/calendar.events`, and `https://www.googleapis.com/auth/calendar.calendarlist.readonly` (read-only list of calendars, for the Daily all-calendars feed). Return to **Audience** and click **Publish app** so the publishing status is **In production**, not **Testing**; Testing-mode refresh tokens expire after seven days. Google may show an unverified-app warning or require OAuth verification for restricted Gmail scopes.
- In Google Auth Platform, open **Clients → Create client**, choose **Desktop app**, create the client, and keep its client ID and secret ready to enter into the hidden prompts. Do not download or commit the client file. On Dan's Windows machine, sign in to the expected Azure subscription and GitHub repository with their CLIs, open **Windows PowerShell 5.1** (not PowerShell 7), change to the repository root, and run exactly `& .\infra\setup-google.ps1`. The script runs loopback OAuth with PKCE, validates consent state, stores `google-oauth-client-id`, `google-oauth-client-secret`, and `google-refresh-token` in the deployed Key Vault, and removes the temporary vault role assignment it creates. It sets only nonsecret `JARVIS_GOOGLE_TIME_ZONE` as a GitHub Actions variable. Dan needs permission to create/delete role assignments and write Key Vault secrets; no coding agent runs this script or accesses the tenant.
- After setup, deploy from `main` to enable the configured backend module. For the P9-27 Gmail permissions, Dan must add `gmail.modify` under **Data Access** and rerun `& .\infra\setup-google.ps1` from Windows PowerShell 5.1; complete the Google consent prompt so the script replaces the Key Vault refresh token. Verify agenda and mail reads for `danaakesen@gmail.com`, test calendar and Gmail changes only after exact later-message confirmation, test a Gmail reply draft (Dan sends it from Gmail), and test sending only to an explicitly approved test recipient. Wrong, expired, and same-turn confirmation codes must not cause writes. Live Google consent, deployment, and API behavior remain unverified until Dan performs these checks.
- **GitHub vault setup (Dan once):** install the existing Jarvis GitHub App on the private `DanAakesen/vault` repository with Contents read/write permission, preferably selecting only that repository for this installation. The backend uses a repository-scoped installation token; never create or use a personal access token. The App already subscribes to `push`; the backend indexes `master` at startup and after verified `master` pushes. If the App is not installed on the vault, search/write are unavailable and the backend reports the missing installation. No Graph or Azure permission is needed. Live installation and note access remain unverified; see [infrastructure setup](../infra/README.md#github-vault-setup).
- **Vault mirror setup:** after the approved infrastructure deploy and the companion `apps/vault-mirror/Dockerfile` is on `main`, install the [official Obsidian Headless CLI](https://github.com/obsidianmd/obsidian-headless) only to run `ob login`. Never run `ob sync-setup` or `ob sync` on a computer that runs desktop Obsidian Sync. From Windows PowerShell 5.1 at the repository root, sign in to the expected Azure subscription with `az`, authenticate `gh` to the repository, and run `& .\infra\setup-vault-mirror.ps1`. The script uses hidden prompts, writes secrets directly to Key Vault without a local file, and reads back only presence/version; it initializes write-back to `dry-run` and does not enable the switch. Set `JARVIS_VAULT_MIRROR_ENABLED=true` as a repository Actions variable and manually dispatch **Deploy** from `main`. A missing Dockerfile/image or App ID is logged as a visible skip and must not block core infrastructure. First inspect Container Apps job **Executions** and, after the companion backend status reader is deployed, the authenticated Jarvis Status page. Vault-to-GitHub reads are live from the first run; writing back to Obsidian remains off until the owner has checked clean dry-runs and deliberately sets `JARVIS_VAULT_MIRROR_WRITE_BACK=on` with conservative caps, then manually dispatches **Deploy** again. To roll back writes, return that variable to `dry-run` and manually redeploy; to stop all scheduled work, set `JARVIS_VAULT_MIRROR_ENABLED=false` and manually dispatch **Deploy**. The workflow removes the job, its identity and role assignments, but intentionally retains private state/status containers for recovery; permanent deletion requires a separately approved backup/teardown. The mirror has run live since 20 October 2026 and with write-back `on` since 22 October 2026; see [the vault-mirror runbook](../infra/README.md#vault-mirror-setup) and the decision log.
- Away mode is manual by decision P6-22; no Graph presence permission, monitor, or setup script is used. Active authenticated browser requests to `POST /now/present` mark Dan present; passive feed refreshes do not. The Now feed and browser approvals remain available in either away state. Live browser voice announcements and approval delivery remain unverified.
- `az` runs through a `.cmd` file: avoid `&`, parentheses, and pipes inside arguments such as `--query` (L20); filter JSON in PowerShell instead.
- Never reuse a deleted Foundry account or project name; generate timestamped names (L2).
- `FOUNDRY_*` and `AGENT_*` environment variables are reserved in hosted agents (L18).
- Foundry has separate administration (`*.services.ai.azure.com`) and runtime (`*.cognitiveservices.azure.com`) hosts (L10).
- Create the Log Analytics workspace in the resource group before Application Insights (L8).
- Every component that opens a hosted-agent session deletes it (L14).
- Windows scripts: no `&` in `az` arguments; format dates with the invariant culture (L20).
- Creating or deleting Azure resources, spending money, or deploying needs Dan's approval unless it runs through the approved GitHub Actions workflows.

## Secrets

- Local secrets live in `.secrets/` (git-ignored). Never print, copy, or commit them.
- In Azure, secrets live only in Key Vault; services use managed identities, and GitHub Actions uses OpenID Connect.
- Codex: the Jarvis-only login follows the [Codex login rules](architecture.md#sandbox-credentials). Never copy Dan's own Codex login.
- Codex cloud environment: `GH_TOKEN` is a fine-grained token for `DanAakesen/jarvis` with only **Issues: read and write**, used to claim issues. It is an environment variable, not a Codex secret, because Codex removes secrets before the agent runs. Never print it, write it to files, or use it for anything else.
- P0-01 exception: Dan explicitly authorized using the existing `GH_TOKEN` to open its linked PR. PR #78 creation succeeded. This task-specific authorization does not change the issue-claim restriction for other tasks.

## GitHub App setup

[`github-app-manifest.json`](github-app-manifest.json) is the registration settings reference for the private Jarvis GitHub App. Enter these values in GitHub's **Register a new GitHub App** form; GitHub's settings form does not import this JSON. The `Jarvis Software Factory` name may be changed if GitHub reports it is unavailable.

| GitHub permission | Access | Reason |
| --- | --- | --- |
| Contents | Read and write | Read task repositories and push agent branches |
| Pull requests | Read and write | Create, inspect, and merge pull requests |
| Issues | Read and write | List issues; create Factory issues, post progress comments and manage labels (P10) |
| Workflows | Read and write | Let Factory branches change files under `.github/workflows` |
| Repository creation | Read and write | Create repositories for confirmed new projects |
| Environments | Read-only | Read deployment environments |
| Commit statuses | Read-only | Read commit status contexts |
| Checks | Read-only | Read check results |
| Actions | Read-only | Read workflow runs |
| Deployments | Read-only | Read deployment status |

Subscribe to `check_run`, `deployment_status`, `issue_comment`, `issues`, `pull_request`, `push`, and `workflow_run`. GitHub requires repository metadata read access automatically. Install only on the repositories Dan selects for Jarvis; do not grant access to all repositories by default.

Do not configure a webhook URL or secret until P0-16 has deployed the backend and P3-03 has implemented its receiver. The manifest intentionally has no webhook URL. A GitHub App ID is not a secret; the private key and webhook secret are.

Dan's manual setup checklist:

1. Wait for [P0-16](https://github.com/DanAakesen/jarvis/issues/131) to deploy the Key Vault and backend. Use the deployed `keyVaultName` output; do not guess a vault name.
2. In GitHub, register the App using the settings above, leave the webhook URL unset until P3-03 is deployed, and install it only on the intended repositories. This requires Dan's GitHub account to administer the owner and selected repositories.
3. Generate one private key from the App's settings. Download it to a temporary, access-controlled location outside the repository and any synced folder. Never paste or upload it to GitHub, a PR, chat, GitHub Actions, or a sandbox.
4. From Dan's signed-in Azure CLI, import the PEM file directly into the deployed vault. Replace placeholders locally; do not add the key or its value to the command:

   ```powershell
   az keyvault secret set --subscription <subscription-id> --vault-name <key-vault-name> --name github-app-private-key --file <private-key.pem> --encoding utf-8 --output none
   ```

   `--output none` suppresses the returned secret value. Dan needs permission to set secrets on this vault (for example, Key Vault Secrets Officer); cloud coding agents must not run this command or access Azure.
5. Verify only the secret metadata, never its value:

   ```powershell
   az keyvault secret show --subscription <subscription-id> --vault-name <key-vault-name> --name github-app-private-key --query "{id:id,enabled:attributes.enabled}" --output json
   ```

6. Remove the temporary local PEM copy. The backend managed identity reads the key from Key Vault for app authentication; never pass the key to a runner. The App ID is not secret: set repository Actions variable `JARVIS_GITHUB_APP_ID`; the Deploy workflow maps it to backend configuration `GITHUB_APP_ID`, not to the sandbox.
7. P3-02 rollout: leave `JARVIS_GITHUB_APP_TOKEN_ENABLED` unset (defaults to `false`) while deploying the backend and confirming the Key Vault secret is available. Then set that repository Actions variable to `true` and manually dispatch **Runner deploy** from `main`; the workflow requires `JARVIS_GITHUB_APP_ID` and configures new runner versions for App tokens. Run a live sandbox push to `DanAakesen/jarvis-test-target`. Keep the existing `jarvis-github` secret/token and runner read grant until that check passes; remove them and the legacy fallback in a follow-up only after success.
8. After P3-03 is merged and deployed, read the `backendFqdn` and `keyVaultName` outputs from the `jarvis-infra` deployment. Generate a separate random webhook secret with a password manager and temporarily stage it outside the repository and synced folders. Import it into Key Vault without displaying the value:

   ```powershell
   az deployment group show --subscription <subscription-id> --resource-group <resource-group> --name jarvis-infra --query "properties.outputs.{backendFqdn:backendFqdn.value,keyVaultName:keyVaultName.value}" --output json
   az keyvault secret set --subscription <subscription-id> --vault-name <key-vault-name> --name github-app-webhook-secret --file <webhook-secret.txt> --encoding utf-8 --output none
   ```

   In **GitHub → Settings → Developer settings → GitHub Apps → Jarvis Software Factory → Webhook**, set the URL to `https://<backendFqdn>/github/webhooks`, choose `application/json`, paste the same secret, enable the webhook, and subscribe to `pull_request`, `check_run`, `workflow_run`, `deployment_status`, `push`, and `issues`. Save the settings, remove the temporary local copy, and inspect **Recent Deliveries** for a successful 2xx response to GitHub's initial `ping`. The receiver records that signed but unsupported event as ignored. Never put either copy in source control or logs.

Status, 4 October 2026: Dan registered the App, installed it on all repositories of his account, trimmed its permissions, and stored `github-app-private-key` in Key Vault (P3-10). P3-02 code is merged but its live token issuance and sandbox push are not yet verified. On 7 October Dan added Issues, commit statuses and environments read to the App; P7-45 issue summaries request Issues read, so they cover private registered repositories. On 8 October Dan granted Issues write, Workflows read and write, and Repository creation, and accepted them on the installation (P10-01, #573). The coordinator verified the installation permissions in production and minted an `issues: write` token for `jarvis` (HTTP 201). The webhook receiver (P3-03) is implemented; webhook secret provisioning, App URL configuration, and live delivery remain Dan's post-merge steps. P3-05 uses a separate repository-scoped token with only Actions read permission in the backend, stores failed-job logs in the existing private `logs` container, and never passes that token to the sandbox. The backend setting `global.max_check_attempts` defaults to 3 and accepts 0–10; 0 disables automatic repairs. The receiver caches the webhook secret after its first successful lookup, so restart the backend when rotating it.

## Accepted visual reference handoff

The read-only [centred stage prototype](reference/ui-stage-prototype/README.md) and [selected images/captures](ui/centred-stage/README.md) support P8-28–P8-33. Its isolated lockfile is not part of the root workspaces; follow its README to run it. The accepted standalone is copied unchanged. Prototype commands/check reports are historical evidence, not validation of the production app or its Node 22 toolchain. The production scene was merged in PR #375 and is lazily loaded on the Jarvis route only; do not ship the prototype, its demo replies, simulated states or comparison fixtures.

The 3D stage/large orb are Jarvis-only, light mode re-lights the same room, and dormant visuals do not enable microphone capture. Reduced motion, hidden-tab pause, WebGL fallback/context restoration and route teardown are implemented. Labelled software-Chromium empty/typing/voice/window captures and three motion frames are in `ui/screenshots/p8-28-*`; three repeated route cycles reported no off-route canvas and lost each prior context. This run used scratch auth/API/voice fixtures; Factory's unconfigured API endpoints deliberately return 503. P8-31's shared-glass implementation was merged in #376; review readability over the reflected stage with the selected images. SwiftShader consumed several CPU cores, so hardware-GPU, physical-device, live-voice and reported transition-flicker acceptance remain unverified. P8-33's adaptive quality, context recovery, CSS fallback and phone checks are in draft PR #391; current dark/light, landscape, context-loss and unavailable-WebGL captures are `ui/screenshots/p8-33-*`. In this fixture, software WebGL had very poor RAF cadence after adaptation; it is not hardware performance evidence. Original reference snapshots stay read-only.

P8-30's baseline Chromium trace found the voice update wrapped in a document-wide View Transition that included the live stage/mirror (`ready` about 348 ms; `finished` about 1.2 s). PR #386 removes that snapshot and the pending workspace FLIP overlay. Local fixture checks recorded 73 desktop CDP frames and 32 phone frames at 390×844 across voice/window lifecycles; the same canvas and scene camera/platform remained, draft/focus returned, phone overflow stayed false, and command acknowledgements were truthful. The integrated SwiftShader page rendered at only about two animation frames per 500 ms, so this does not prove normal-rate flicker-free motion; the exact mirror flash, hardware GPU, live voice/audio and physical-device criteria remain unverified.

P8-33's local scratch-browser evidence exercised responsive layouts at 390×844, 320×700, 320×568 and 844×390, Activity menu bounds at 390×844 and 320×568, End voice bounds in landscape, simulated 390×520 keyboard height, 1.5× page scaling, dark/light, reduced motion, hide/resume, route teardown/re-entry, resize, forced WebGL loss/restore and unavailable-WebGL fallback. Voice fixtures remained independent from render failure and existing HTML actions remained mounted. The recorded SwiftShader RAF intervals (90 samples after reaching tier 2) averaged 327ms at 1440×900 and 151ms at 390×844, so normal-rate performance is not verified. These scratch checks are not physical-browser or live-provider evidence; hardware GPU/battery, physical keyboard, Safari, real English/Danish audio and exact flicker acceptance remain open. Screenshots: `ui/screenshots/p8-33-*`.

## Setup and commands

The repository uses npm workspaces for `apps/web`, `apps/backend`, `apps/vault-mirror`, and
`packages/contracts`, one root lockfile, and shared strict TypeScript
configuration. P8-14 keeps the versioned JSON Schema and browser/backend view
types in the contracts workspace; P7-14 adds the bounded typed web-research
result contract there. P0-02 implements the web
skeleton with React/Vite, routing, ESLint and Vitest; P0-03 adds the Fastify
backend with `/health`, safe structured logs, ESLint, Vitest and a Dockerfile.
Python runtime remains in its planned tasks. Issue #7 adds the database connection and startup migration infrastructure; P1-01 (#15) adds the first domain tables (groups 1–3), and P2-01 (#27) adds sandbox and operations groups 4 and 6.
P0-04 adds the Bicep template; its first Azure deployment is P0-16. Bicep sets backend `KEY_VAULT_URI`; the backend uses its managed identity to read `github-app-webhook-secret`. Locally, the URI can be omitted; webhook requests then fail with 503. The secret is cached in memory after a successful lookup and requires a backend restart to rotate.
P7-04 reads the Jev API key `jev-api-key` from the same Key Vault with the backend identity. Dan provisions it after merge with the coordinator's `set-jev-key.ps1` outside this repository; agents must not run that script or access the live key. The reflex uses the configured `jev-latest` model. Live Jev latency and Voice Live behavior are not covered by offline tests.
P7-07 and P7-19 reuse that existing Jev key; P7-19 also uses P7-18's default-off Chrome toggle. They add no secret, environment variable, or setup command. Dan's live Windows UI Automation, shared-form, Jev/Foundry, Voice Live, Chrome, and confirmation checks remain post-merge work.
P7-35/P9-35 reuse that key and existing global settings storage
(`routine.<hash>` keys); legacy `recipe.<hash>` rows are read and migrated on
write, with no new migration or configuration. Routine storage is bounded to 100
records; Dan can list, rename and delete routines through `task_routines` or the
Dan-only `/routines` API. `task_recipes` and `/recipes` remain one-release aliases.
P5-14 `chat.latency` phases `recipe_select`, `recipe_verify`, `recipe_plan` and
`recipe_run` contain only durations, never goals, target labels or entered values.
Controlled offline speedup is not evidence of live Windows/Chrome/Jev latency.

Use Node.js 22.23.3 (`.nvmrc`), npm 10.9.9 (`packageManager`), TypeScript 6.0.3,
and Python 3.12.14 (`.python-version`, for future Python work). Install from the
repository root. The standalone reference prototype's dependencies remain
outside npm workspaces; production `apps/web` uses `three@0.180.0` and dev-only
`@types/three@0.180.0`.
See [README.md](../README.md) for public web configuration and overrides.

P9-89 presence behavior is shared in `agents/jarvis/presence-instructions.json`.
Keep it in both Docker images and both the root and hosted-agent `.dockerignore`
allowlists. Focused
checks: `npm test --workspace @jarvis/backend -- src/core/settings.test.ts src/core/capability-instructions.test.ts src/voice/realtime.test.ts src/voice/relay.test.ts`;
from `agents/jarvis`, `.venv/bin/python -m pytest -q tests/test_model_client.py tests/test_voice_runtime.py tests/test_chat_runtime.py tests/test_jarvis_tools.py`.
Mode preferences may change style, not permissions or the approval rules.
Live chat and both voice languages still need post-deploy acceptance.

Verified in Codex cloud for P0-02:

| Purpose | Command |
| --- | --- |
| Frozen dependency installation | `npm ci` in the repository root |
| All workspace builds | `npm run build` in the repository root |
| All workspace lint checks | `npm run lint` in the repository root |
| All workspace tests (single run) | `npm test` in the repository root |
| Focused P9-35 routine storage/management checks | `npm test --workspace @jarvis/contracts`; `npm test --workspace @jarvis/backend -- --run src/core/task-recipes.test.ts src/core/recipe-management.test.ts src/database/recipe-store.test.ts src/logging.test.ts` |
| Shared generated-view contract | `npm test --workspace @jarvis/contracts`; `npm run lint --workspace @jarvis/contracts` |
| Focused P8-16 activity tests | `npm test --workspace @jarvis/contracts`; `npm test --workspace @jarvis/backend -- --run src/core/activity.test.ts src/core/conversation-activity.test.ts src/core/now.test.ts src/voice/relay.test.ts`; `npm test --workspace @jarvis/web -- --run src/App.test.tsx src/activity-context.test.tsx src/ConversationHistory.test.tsx src/VoiceControls.test.tsx src/VoiceOrb.test.tsx src/Workspace.test.tsx src/NowFeedPanel.test.tsx src/now-feed.test.ts` |
| Targeted web checks | `npm run lint --workspace @jarvis/web`; `npm test --workspace @jarvis/web` |
| Focused P8-30 voice/window checks | `npm test --workspace @jarvis/web -- --run src/ConversationHistory.test.tsx src/App.test.tsx src/Workspace.test.tsx src/VoiceControls.test.tsx src/voice-client.test.tsx src/JarvisStage.test.tsx` |
| Focused P8-28 scene and route lifecycle checks | `npm test --workspace @jarvis/web -- --run src/JarvisStage.test.tsx src/App.test.tsx` |
| Focused P3-11 checks | `npm test --workspace @jarvis/backend -- --run src/core/settings.test.ts`; `npm test --workspace @jarvis/web -- --run src/SettingsPage.test.tsx src/factory/ProjectsPage.test.tsx src/factory/TasksPage.test.tsx` |
| Focused P3-13 checks | `npm --workspace @jarvis/backend test -- --run src/github-app.test.ts src/factory/projects.test.ts`; `npm --workspace @jarvis/web test -- --run src/factory/ProjectsPage.test.tsx` |
| Focused P8-17 settings/theme checks | `npm test --workspace @jarvis/backend -- --run src/core/settings.test.ts src/core/theme.test.ts`; `npm test --workspace @jarvis/web -- --run src/SettingsPage.test.tsx` |
| Focused P9-97 fixed Danish voice checks | `npm test --workspace @jarvis/backend -- --run src/core/settings.test.ts src/core/settings-tools.test.ts`; `npm test --workspace @jarvis/web -- --run src/SettingsPage.test.tsx` |
| Focused P8-32 appearance checks | `npm test --workspace @jarvis/backend -- --run src/core/settings.test.ts src/core/theme.test.ts`; `npm test --workspace @jarvis/web -- --run src/theme-preference.test.tsx src/SettingsPage.test.tsx src/JarvisStage.test.tsx src/styles.test.tsx src/ConversationHistory.test.tsx`; `npm run lint --workspace @jarvis/web`; `npm run build --workspace @jarvis/web` |
| Focused P3-12 contracts | `npm test --workspace @jarvis/backend -- --run src/credentials/repo-admin.test.ts src/factory/new-project.test.ts src/factory/heartbeat.test.ts`; `runner/.venv/bin/python -m pytest -q runner/tests/test_app.py` from repository root |
| Focused chat UI and API tests | `npm test --workspace @jarvis/web -- --run src/ConversationHistory.test.tsx src/conversation-history.test.ts`; `npm test --workspace @jarvis/web -- --run src/App.test.tsx` |
| Focused P8-35 steering, queue, and control tests | `npm test --workspace @jarvis/web -- --run src/ConversationHistory.test.tsx src/conversation-history.test.ts`; `npm test --workspace @jarvis/backend -- --run src/core/conversation.test.ts src/database/conversation-store.test.ts`; `agents/jarvis/.venv/bin/python -m pytest -q agents/jarvis/tests/test_chat_runtime.py agents/jarvis/tests/test_model_client.py` |
| Focused P7-08 camera, shell, chat and voice checks | `npm test --workspace @jarvis/web -- --run src/camera-capture.test.tsx src/ConversationHistory.test.tsx src/VoiceControls.test.tsx src/App.test.tsx src/voice-client.test.tsx`; `npm test --workspace @jarvis/backend -- --run src/voice/relay.test.ts src/vision/screen.test.ts`; `agents/jarvis/.venv/bin/python -m pytest -q agents/jarvis/tests/test_chat_runtime.py` |
| Focused P6-01 usage API and SQL-store tests | `npm test --workspace @jarvis/backend -- --run src/core/usage.test.ts src/database/usage-store.test.ts` |
| Focused P7-13 memory-tool, embedding, and migration tests | `npm test --workspace @jarvis/backend -- --run src/core/memory.test.ts src/core/memory-embeddings.test.ts src/database/migrations.test.ts` |
| Focused P7-43 vault graph and workspace tests | `npm test --workspace @jarvis/contracts`; `npm test --workspace @jarvis/backend -- --run src/vault/vault.test.ts src/database/migrations.test.ts src/voice/realtime.test.ts`; `npm run build --workspace @jarvis/backend`; `npm run lint --workspace @jarvis/backend` |
| Focused P7-44 JSON embedding, backfill, and ranking tests | `npm test --workspace @jarvis/backend -- --run src/database/memory-store.test.ts src/database/migrations.test.ts src/core/memory-embeddings.test.ts src/core/memory.test.ts src/logging.test.ts src/vault/vault.test.ts`; SQL persistence checks use `npm run test:database --workspace @jarvis/backend -- src/database/schema.integration.test.ts` with the isolated loopback SQL Server configuration |
| Focused P7-14 research tests | `npm test --workspace @jarvis/contracts`; `npm test --workspace @jarvis/backend -- --run src/core/web-research.test.ts src/core/usage.test.ts src/foundry/client.test.mts src/config.test.ts src/database/tool-call-store.test.ts`; `npm test --workspace @jarvis/web -- --run src/usage/UsagePage.test.tsx`; `runner/.venv/bin/python -m pytest -q runner/tests/test_app.py -k codex_tool` |
| Focused P7-04 reflex, chat and voice tests | `npm test --workspace @jarvis/backend -- --run src/core/reflex.test.ts src/core/conversation.test.ts src/voice/relay.test.ts`; `agents/jarvis/.venv/bin/python -m pytest -q agents/jarvis/tests/test_chat_runtime.py agents/jarvis/tests/test_model_client.py` |
| Focused P7-15 image generation and artifact tests | `npm test --workspace @jarvis/backend -- --run src/core/image-generation.test.ts src/core/image-generation-routes.test.ts src/database/workspace-artifact-store.test.ts src/database/conversation-store.test.ts src/database/usage-store.test.ts src/core/usage.test.ts src/database/migrations.test.ts`; `npm test --workspace @jarvis/web -- --run src/ConversationHistory.test.tsx src/conversation-history.test.ts src/usage/UsagePage.test.tsx`; `npm test --workspace @jarvis/contracts`; `runner/.venv/bin/python -m pytest -q runner/tests/test_app.py -k 'codex_tool or image'` |
| Focused P7-27 workspace reflex checks | `npm test --workspace @jarvis/backend -- --run src/core/reflex.test.ts src/core/workspace-commands.test.ts src/core/conversation.test.ts src/voice/relay.test.ts src/logging.test.ts`; `npm test --workspace @jarvis/web -- --run src/Workspace.test.tsx src/NowFeedPanel.test.tsx src/now-feed.test.ts src/App.test.tsx` |
| Focused P7-31 PC app, media, UI Automation and reflex checks | `npm test --workspace @jarvis/backend -- --run src/pc-bridge/bridge.test.ts src/pc-bridge/pc-act.test.ts src/core/reflex.test.ts src/core/browser-agent.test.ts src/voice/realtime.test.ts`; `dotnet test pc-bridge/Jarvis.PcBridge.Core.Tests/Jarvis.PcBridge.Core.Tests.csproj`; `dotnet build pc-bridge/Jarvis.PcBridge/Jarvis.PcBridge.csproj -p:EnableWindowsTargeting=true`; `agents/jarvis/.venv/bin/python -m pytest -q agents/jarvis/tests/test_jarvis_tools.py` |
| Focused P7-23 chat latency checks | `npm test --workspace @jarvis/backend -- --run src/core/conversation.test.ts src/core/chat-agent.test.ts src/core/reflex.test.ts src/voice/relay.test.ts src/core/memory.test.ts src/core/memory-embeddings.test.ts src/logging.test.ts`; `agents/jarvis/.venv/bin/python -m pytest -q agents/jarvis/tests/test_chat_telemetry.py agents/jarvis/tests/test_chat_runtime.py agents/jarvis/tests/test_model_client.py agents/jarvis/tests/test_jarvis_tools.py` |
| Focused P7-30 cross-session follow-up checks | `agents/jarvis/.venv/bin/python -m pytest -q agents/jarvis/tests/test_chat_runtime.py agents/jarvis/tests/test_model_client.py`; `cd agents/jarvis && .venv/bin/python -m ruff check chat_runtime.py model_client.py tests/test_chat_runtime.py tests/test_model_client.py` |
| Focused P7-20 streaming voice reflex checks | `npm test --workspace @jarvis/backend -- --run src/voice/relay.test.ts src/core/reflex.test.ts src/database/conversation-store.test.ts src/voice/realtime.test.ts src/logging.test.ts`; `npm run lint --workspace @jarvis/backend`; `npm run build --workspace @jarvis/backend`; `agents/jarvis/.venv/bin/python -m pytest -q agents/jarvis/tests/test_voice_provisioning.py` |
| Focused P7-24 live partial-recognition checks | `npm test --workspace @jarvis/backend -- --run src/voice/relay.test.ts src/voice/realtime.test.ts src/voice/speech-recognizer.test.ts src/logging.test.ts`; `npm test --workspace @jarvis/web -- --run src/voice-client.test.tsx`; `npm run lint --workspace @jarvis/backend`; `npm run build --workspace @jarvis/backend` |
| P7-13 isolated SQL migration/store contracts | `npm run test:database --workspace @jarvis/backend` |
| Focused P9-81 visual grounding checks | `npm test --workspace @jarvis/backend -- src/vision/screen.test.ts src/vision/foundry-model.test.ts src/vision/watch.test.ts src/core/conversation.test.ts src/core/capability-instructions.test.ts src/database/conversation-store.test.ts src/database/migrations.test.ts src/voice/relay.test.ts`; `agents/jarvis/.venv/bin/python -m pytest -q agents/jarvis/tests/test_chat_runtime.py` |
| Focused P3-05 failed-check tests | `npm test --workspace @jarvis/backend -- src/database/checks-loop-blob.test.ts src/database/checks-loop-store.test.ts src/github/checks-loop.test.ts src/github/actions-logs.test.ts src/github/webhook.test.ts src/core/settings.test.ts src/github-app.test.ts` |
| Focused P6-01 usage page and navigation tests | `npm test --workspace @jarvis/web -- --run src/usage/UsagePage.test.tsx src/App.test.tsx` |
| Run web app | `npm run dev` in the repository root; open `http://localhost:5173` |
| Watch web tests | `npm run test:watch --workspace @jarvis/web` |

Web sign-in uses the fixed `http://localhost:5173` origin (`strictPort` in
`apps/web/vite.config.ts`); both `http://localhost:5173/` and
`http://localhost:5173/redirect.html` are registered in
`infra/bootstrap.output.json`. Do not change the port or remove the redirect
bridge URI without updating the Entra registration. On each device, tick
Microsoft's **Stay signed in** option once when prompted. That keeps Microsoft's
session across browser restarts; tenant sign-in-frequency policy and browser
storage behavior can still require sign-in sooner.

The Windows UI checkout can use its existing dependency junction and run from
`apps\web`: `node ..\..\node_modules\typescript\bin\tsc --noEmit -p .`,
`node ..\..\node_modules\vitest\vitest.mjs run --maxWorkers=1 --silent` and
`node ..\..\node_modules\vite\bin\vite.js build`. Keep Vitest module isolation
enabled for combined suites; `--no-isolate` contaminates mocked shell/Factory
modules between files. Local en-DK formatting differs from existing tests'
English date/decimal literals; report those separately, not as Notes failures.

P9-77 browser acceptance must intercept all vault writes in a scratch fixture
harness. Do not use real notes or production writes as screenshot evidence.
Cover the default graph, star/search selection into the editable popup,
immediately writable creation, nested destination selection and local new folders,
root/arbitrary-folder notes, source/preview, successive blob-SHA saves, 409
comparison, dirty close/note-switch/links/history/reload and phone dock clearance.
Notes is now a data-router route: component tests that mount it must provide
`createMemoryRouter`/`RouterProvider`, not a plain `MemoryRouter`.
Dan's 11 October full-vault requirement removes the four-section UI restriction;
he explicitly approved excluding hidden dot-folders. The frontend consumes
`GET /notes/tree` from #698 (`directories`, root count, truncation and a
non-null ISO last-sync timestamp; at most 10,000 directory entries).
Root `""` is implicit and must remain selectable even with an empty directory
array and no root notes. Deployed #699 derives directories from every Git-tree
file, including attachment-only folders, while root count remains Markdown-only.
Fixtures must
serve that endpoint, not make the graph/index stand in for the actual tree.
Cover malformed, 404-absent, 403, 503-not-ready, truncated and cancelled inventories. Do not
exercise real vault writes to verify the new scope.

Dan's latest Notes revision keeps the search centred with a plus-only Create new
inside it. Check the inventory time in the popup header with the phone folder
picker folded, no duplicate hidden-folder notice, and a visible focused Markdown
area. The dot-folder path safeguard remains in place.
Check per-folder plus visibility on desktop hover/keyboard focus and touch,
including root and collapsed leaf folders. Naming starts focused inside the
clicked parent even when another destination is selected. Enter/check adds,
Escape/cross cancels; both restore trigger focus, and no vault write occurs.
New drafts omit the removed instruction/path metadata row.
P9-79 camera acceptance must cover "can you see anything?" and "kan du se noget?"
through chat and both voice transports: fresh JPEG upload precedes transient
description delivery, and capture failure never becomes text-only success.
Desktop, including narrow desktop, must not expose the switch icon; mobile touch
input keeps it in both chat and voice. Synthetic transport checks do not verify
physical camera hardware or the live vision model.

The web starts with the bootstrap identities and the public production backend
origin in `apps/web/config.json` (optional `VITE_BACKEND_URL` override). With a
backend URL, MSAL signs in against the configured tenant and calls authenticated
`/me`; only the backend-approved display name is shown. The main-page sleep
switch reads and updates the backend's configured replica count; the API refuses
to sleep while tasks are Ready, Running, or PauseRequested.
`Web CI` checks lint, tests, and root builds as part of the aggregate `CI`
workflow (below). Local tests use signed fixture tokens and do not verify a live
Entra tenant or Azure deployment.

Browser checks of signed-in pages (verified in Copilot cloud agent for P1-07,
P1-10 and P1-11, where the Playwright MCP tools were unavailable; L45): in a scratch
directory outside the repository, run `npm install --no-save playwright-core`,
then drive
`chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] })`.
Signed-in pages need a scratch Vite config. It aliases `./auth` to a stub that
returns a profile and defines `__JARVIS_CONFIG__` with a placeholder backend
URL. For settings, serve a mock `/settings` response from that harness only.
P1-11 was inspected at 390 and 1280 px; save and disabled actions were exercised.

Workspace content responsiveness (#1260) has a synthetic Chromium fixture at
`apps/web/browser-tests/workspace-content.html`, driven by
`scripts/check-workspace-content-browser.mjs`. It reuses the web Vite config and
does not sign in or call live services. Install `playwright-core@1.64.1` into a
scratch directory, set `PLAYWRIGHT_CORE_MODULE` to its `index.mjs`, and run the
script from the repository root; the exact command, viewport matrix, screenshot
links, initial-phone chart-mark assertion, and known limits are in
`docs/ui/screenshots/workspace-content/README.md`.

P9-73 fixture checks used Chromium and WebKit at 390×844, 1280×900 and
844×390 in light/dark, replacing served CSS `env()` values only in the scratch
harness to simulate zero/34px bottom, 47px portrait top and landscape side insets.
Composer gaps measured 16px/50px on Home and Knowledge; desktop geometry matched
the baseline. Signed-out headers also cleared the portrait notch and landscape
side inset. Draft, More/Escape, restored-window sheets and voice entry/exit were exercised with
scratch-only auth/API/voice fixtures. Before/after captures are in
`docs/ui/screenshots/p9-73/`. These are not physical iPhone, browser-toolbar,
installed Home Screen or live microphone/provider verification.

P9-72 uses the same scratch-only auth/API browser approach with a voice-client
fixture. Chromium/WebKit checks at 390×844 and 1280×900 cover light/dark,
voice entry/exit, More/Escape, phone menu dismissal and Settings scrolling.
The phone voice container measures about 212px rather than 844px; its background
and backdrop filter are absent and its pointer events are disabled. The 60px
bar remains interactive. Before/after fixture captures and measurements are in
`docs/ui/screenshots/p9-72/`; these are not live audio or physical-device evidence.
P9-74 used the same scratch-only auth/API approach in Chromium and WebKit at
390×844 and 1280×900 in light/dark. Synthetic fixture notes reproduced raw YAML
before the change and verified its removal, wrapped titles/paths, the scroll cue,
button and keyboard scrolling to the final paragraph, close/reset and note-load
errors. Normal and reduced-motion scrolling passed; no page exceptions or horizontal overflow
were observed. Before/after captures: `docs/ui/screenshots/p9-74/`. No live vault
or physical-device behavior was inspected.

P7-15's conversation image preview was inspected in Chromium at 1280×900 and
390×844 using scratch-only signed-in and API fixtures. The existing history
rendered the image artifact with its accessible name and caption; the image fit
both viewports without horizontal overflow. The browser used a local illustration
for layout inspection after the fixture returned a mock Blob URL. This verifies
presentation only, not Codex generation, Blob authorization, or deployed
workspace acceptance.

P7-27 passed `npm test` (1,135 tests), `npm run lint`, and `npm run build`.
Scratch-only auth/API fixtures in Chromium at 1440×1000 and 390×844 verified
snapshot publication, tile/layer/enlarge, minimise/restore, context-panel
open/close (including repeated idempotent opens), focus/close and restored
agent-closed content. Reduced motion remained usable, with no phone overflow
or page errors. Fake voice tests prove execution before the final transcript
and no repeated final action. These checks do not prove live Jev/Foundry
latency; the coordinator must measure “tile my windows” from chat send to
visible layout change and verify it is under 1.5 seconds after deployment.
P8-17 was inspected at 390 and 1280 px using a scratch-only signed-in auth stub
and mock `/settings` and `/database/status` endpoints. The minimise-windows
toggle was off initially, saved by PATCH, and still on after reload; neither
viewport overflowed and the browser reported no errors. This verifies the web
form against mocks, not live Entra, backend, or SQL. The P8-13 theme controls
are not present here, so theme UI persistence and applying a Jarvis tool result
to an already-open shell remain unverified.
The P8-17 SQL Server integration suite passed in Database CI run `37233600074`;
running it locally still requires the isolated loopback SQL Server configuration.
P1-12 was inspected at 390 and 1440 px with mocked sleep-status, scale, refusal,
and failure responses; sleep/wake, refusal, retry, and the Settings link worked
without horizontal overflow or browser errors. Mocks do not verify ARM scaling.
P1-10 was inspected at 390 and 1280 px with scratch-only project/task API mocks;
list, create, update and archive worked, the settings form stacked on mobile,
there was no horizontal overflow, controls were at least 44 px high, and no
console exceptions occurred. Mocks do not verify live Entra, Azure SQL, or
production API behavior.
P8-05 conversation checks used the same scratch-only auth/API/audio fixtures at
1440×900 and 390×844, plus 320/280 px overflow checks. Long history stays inside
an independently scrolling transcript; the composer remains bottom-centred.
Streaming, interruption, history retry, explicit voice entry, microphone
permission denial, natural voice end, draft/focus restoration and reduced
motion were exercised. Screenshots in `docs/ui/screenshots/p8-05-*` contain
labelled local fixtures, not production conversations. A real phone keyboard,
physical microphone/speakers and live Azure round-trip remain unverified.
P8-35 Chromium screenshots at 1440×900 and 390×844 in dark/light capture a
streaming reply with a queued message and editable next draft. The browser
checks verified Ctrl+Enter queueing, language switching, enabled Send/language/
voice controls, no Stop button, no horizontal overflow and no console/page
errors. Steering and starting voice during streaming are covered by focused
component/API tests. These screenshots use scratch-only auth/API fixtures, not
live Entra or Foundry.
P8-11 used scratch-only auth/API/voice fixtures and the real workspace at
1440×900 and touch-emulated 390×844 in both appearances. Chromium CDP touch
gestures verified foreground switching at 390, 320 and 280px, alongside named
direct requests, retained input state, keyboard selection/focus, minimise/restore,
orb docking/return, End voice and Escape. The overflow menu was opened and its
bounds checked; foreground content ends above the dock, including reduced motion.
Shrinking to 390×480 simulated keyboard-height pressure; 844×390 checked resize
reflow. Neither substitutes for a physical phone keyboard or screen reader.
All-minimised typing tabs stay visible above the transcript, without moving the
composer offscreen; repeated start/end remains usable.
Native touch also verifies nested horizontal source scrolling without switching
views. Desktop camera/sharing controls render outside the phone disclosure and
remain visible after resizing.
Entering phone width keeps the desktop view being edited foreground and retains
its input focus.
Before/after screenshots use labelled local fixtures under
`docs/ui/screenshots/p8-11-*`; they do not demonstrate live Entra, hardware audio
or P8-15's generated-view/agent-command delivery. No production auth stub or
browser package was added.
Validation: `npm test --workspace @jarvis/web` passed 209 tests;
`npm run lint --workspace @jarvis/web`, `npm run build --workspace @jarvis/web`
and `git diff --check` passed (existing bundle-size warning).
P8-21 used the same scratch-only auth/API fixture workflow with Chromium at
1440×900 and touch-emulated 390×844 in dark/light appearances. Empty, history,
streaming, Now and workspace states are captured under `docs/ui/screenshots/p8-21-*`.
Comparison images place the selected concept beside empty/history/streaming;
phone concepts depict voice, so they are appearance references, not equivalent
typing-state captures. Browser checks covered 44px composer targets, visible
focus, relative metadata, 320/280px overflow, draft reflow, pending controls,
title dragging, edge resizing, Arrange keyboard/Escape focus, phone popup bounds,
minimise/restore, maximised-window precedence over another open Arrange menu,
and static readable reduced-motion states. Settled surface
contrast checks exceed AA. `npm test --workspace @jarvis/web` passed 201 tests;
`npm run lint --workspace @jarvis/web` and `npm run build --workspace @jarvis/web`
passed (existing chunk-size warning). P8-15 was also exercised in Chromium at
1280×900 and 390×844 with a scratch signed-in stub and mock Now/SSE/ack endpoints:
create, layout, move, resize, context-panel open/close, minimise, restore, show,
and close all applied and received owner-session acknowledgements. Generated
script-shaped text remained literal, the phone page had no horizontal overflow,
and the browser reported no page/console errors. A route-transition check
acknowledged a create command on Settings and showed the same in-memory view
after returning to the conversation. These checks exercise the real client and
authenticated event/ack flow against fixtures, not real chat/voice tool
invocation. Live Entra/Foundry delivery, real phone keyboards, and hardware audio
remain unverified.
P8-15 offline checks: `npm test --workspace @jarvis/contracts` (8/8);
`npm test --workspace @jarvis/backend -- src/core/workspace-commands.test.ts
src/core/now.test.ts` (14/14), backend lint and build pass; `npm test
--workspace @jarvis/web` (201/201), web lint and build pass. The web build reports
the existing advisory for a minified chunk over 500 kB.

P8-22 reused the scratch-only auth/API workflow with Chromium at 1440×900 and
390×844 in dark/light appearances. The real shell rendered the real Workspace
component with two explicitly identified local views; the screenshot harness
added the fixture-only footer after verifying it was absent from the app. The
production build also contains no footer text. Browser checks confirmed the home
breadcrumb is only “Jarvis,” the deep Factory breadcrumb is “Jarvis / Software
Factory / Tasks,” each window has one 44×44 overflow trigger and three 44×44
lifecycle buttons, the phone popup stays within 390×844, and reduced motion
removes window transitions. Keyboard Enter opens Arrange, Escape closes it and
returns focus, and arrow keys reorder a window. There were no browser console or
page errors. Screenshots and concept comparisons are
`docs/ui/screenshots/p8-22-{dark,light}-{desktop,phone}*.png`; phone comparisons
use the voice concepts as appearance references only, not layout parity, because
phone voice layout belongs to P8-11. Focused checks:
`npm test --workspace @jarvis/web -- --run src/App.test.tsx src/Workspace.test.tsx`
(44 passed), `npm run lint --workspace @jarvis/web`, and
`npm run build --workspace @jarvis/web` (existing chunk-size advisory). Live
Entra/API, physical phone hardware, and phone voice behavior remain unverified.
P8-16's local acceptance used scratch-only auth and voice-client stubs, a mock
backend/SSE fixture, and the real web app in Chromium at 1440×900 and 390×844.
It verified that the ready voice workspace showed no listening state until
microphone activation; then showed runtime listening, thinking, tool-call start
and outcome, and speaking states in the orb/top bar. An SSE workspace-create
fixture produced the matching temporary window shimmer. Neither
viewport overflowed and Chromium reported no console/page exceptions. The
screenshots and fixtures remain in `/tmp/p8-16-acceptance`, not the repository.
This exercises the real browser UI against local protocol fixtures, not live
Entra, Foundry, microphone hardware, or deployed streaming.

P8-23 reused a scratch-only fixture with the real `VoiceControls`, `VoiceOrb`,
`Workspace` and project CSS. Chromium captured desktop listening/thinking/
speaking at 1440×900 in dark and light, and phone speaking at 390×844 in both
appearances; the fixture used simulated voice state and labelled sample views.
Four comparison captures pair the dark/light desktop and phone speaking images
with their matching Concept B/C references.
Checks covered the hidden Workspace heading/header Arrange, window menus, voice
control names/tooltips, 320/280px overflow, hidden-document aurora pause,
reduced-motion readability/static presentation, menu Escape with focus return,
second Escape to end voice, End voice, and rapid entry/exit. No page errors or
failed requests were observed. Screenshots are labelled fixture evidence, not
live authentication, physical audio/camera, generated-window delivery or
P8-16 tool-event acceptance. A representative desktop speaking capture was
visually inspected; the other captures were checked for state/layout by the
browser harness. A ready-state fixture at 390, 372, 360, 320, 300 and 280px
verified the explicit microphone action has no inherited top margin, End voice
stays inside the dock, and the workspace clears the expanded dock. The status
heading and detail share one atomic live region, so permission feedback can be
announced even when the status remains Ready. Focused checks: `npm test
--workspace @jarvis/web -- --run src/Workspace.test.tsx
src/ConversationHistory.test.tsx src/VoiceControls.test.tsx
src/VoiceOrb.test.tsx src/App.test.tsx` (89 passed), `npm run lint
--workspace @jarvis/web`, and `npm run build --workspace @jarvis/web` passed;
the build retains its existing chunk-size advisory.
P8-31 used the scratch-only signed-in harness and API/SSE fixtures with the real
conversation, shell, temporary workspace, contextual panel, Factory and Settings
pages. Chromium captured conversation at 1440×1000 and 390×844 in dark and light;
additional captures cover the generated text view, empty context panel, Factory
tasks at desktop/phone sizes, and Settings at desktop/phone sizes. Fixture states
exercised conversation populated/empty/error/long text, Factory ready/loading/503,
Settings ready/503, the phone camera/sharing disclosure, and the contextual
panel's close/reopen behavior. Keyboard Arrange changed a layered view's position
and size, Escape closed the menu, and minimise/restore succeeded. At 390px there
was no horizontal overflow; visible app controls met 44px sizing, except the
keyboard-only skip link (41px high). Keyboard focus on Settings displayed a
solid 3px ring. Reduced motion matched and set the workspace transition to 0s.
Chromium reported no page exceptions. Follow-up review found the earlier dark
captures were taken while the 420ms light-to-dark surface transition was still
running; the conversation and Factory dark captures were regenerated after the
computed shell backgrounds matched the dark tokens. The settled colors are
recorded in
[`dark-rendered-styles.json`](ui/centred-stage/p8-31-browser/dark-rendered-styles.json).
A ten-frame, 990ms PNG sequence records a
workspace window entering; evidence and fixture summaries are in
[`docs/ui/centred-stage/p8-31-browser/`](ui/centred-stage/p8-31-browser/),
including a [side-by-side comparison](ui/centred-stage/p8-31-browser/glass-reference-comparison-dark-desktop.png)
with selected image 2.
All displayed conversation, task and generated-view content came from local
fixtures, not live accounts or production data. Contrast tests calculate primary
text, muted text, current-color icon and focus contrast on both glass surfaces
against black and white backing extremes. The light muted-text token was darkened
to meet AA, and conversation Markdown paragraphs now use the primary text role.
P8-29's signed-in browser checks used a scratch-only auth/API/WebSocket/SSE fixture
and Chromium with SwiftShader. Captures in
[`docs/ui/centred-stage/p8-29-browser/`](ui/centred-stage/p8-29-browser/) cover
dormant dark/light at 1440×1000 and 390×844, plus dark desktop connecting, ready,
decoded playback response, post-voice dormant and a schema-valid Now `thinking`
event. The stage kept one canvas through voice entry and exit; `getUserMedia` was
not called until the explicit Enable microphone action (one fake-device request).
The browser observed listening→speaking→listening from fixture playback PCM and
matched reduced motion. Phone had no horizontal overflow; there were no page or
shader errors after the shader fix. Existing P8-31 contrast tests check text,
muted text, icons and focus against black and white backdrops; the integrated
scene/glass text was also visually checked. No live backend/provider, real audio
device, hardware GPU, physical phone, Safari or transition-flicker acceptance is
claimed. The fixtures and generated audio are local test data, not production
simulated state controls.
P8-32 used a scratch-only auth/API fixture and Chromium with SwiftShader at
1440×900 and 390×844, with reduced motion enabled. The browser rendered the real
same-room WebGL stage under the light semantic palette; one canvas remained
mounted while the saved `system` mode followed OS dark↔light changes, an open
activity disclosure stayed open, and composer focus was retained. No microphone
request, horizontal overflow, or browser error occurred. Review captures are
[`p8-32-empty-light-desktop-1440.png`](ui/screenshots/p8-32-empty-light-desktop-1440.png)
and [`p8-32-empty-light-phone-390.png`](ui/screenshots/p8-32-empty-light-phone-390.png).
These use local API fixtures, do not verify live settings/provider behavior, and
do not constitute approval of a light-mode mockup. Hardware GPU, physical
devices, Safari, live voice, and P8-30 transition flicker remain unverified.
Focused web tests also cover pending/rejected theme saves, invalid-token
recovery, persisted system mode and stage activity/audio updates; shared
contrast tests cover text, muted text, icons and focus on both glass roles.
Follow-up review captures use the same scratch-only fixtures and reduced-motion
Chromium setup: the empty-state Activity disclosure sits just below/right of the
greeting at 1440×900 and 390×844, outside the orb rings, and Jarvis replies use
the semantic translucent surface in light mode. Captures:
[`p8-32-empty-dark-desktop-1440.png`](ui/screenshots/p8-32-empty-dark-desktop-1440.png),
[`p8-32-empty-dark-phone-390.png`](ui/screenshots/p8-32-empty-dark-phone-390.png),
and [`p8-32-conversation-light-desktop-1440.png`](ui/screenshots/p8-32-conversation-light-desktop-1440.png).
The conversation text is local fixture content, not a live conversation;
computed light-mode reply text is `rgb(23, 32, 42)` on the 92%-opaque
`rgb(240, 245, 247)` glass; its conservative black-backed contrast is 12.5:1.
No horizontal overflow or page errors occurred. This verifies local rendering,
not live conversation data or physical/hardware rendering.
P1-14 was inspected at 390 and 1440 px with scratch-only database-status and
project API mocks: “Waking Jarvis…” appeared during a reported wait, disappeared
when requests settled, and status polling stopped while idle. No horizontal
overflow or page exceptions occurred. This does not verify live SQL auto-resume.
Focused P1-14 checks: `npm test --workspace @jarvis/backend -- src/app.test.ts
src/factory/tasks.test.ts src/database/wake-retry.test.ts src/database/lifecycle.test.ts
src/database/config.test.ts` and `npm test --workspace @jarvis/web -- --run
src/DatabaseWakeStatus.test.tsx src/App.test.tsx src/task-events.test.tsx`.
P3-11 rechecked Settings and Projects at 390 and 1280 px: New projects defaults
load and save, and the Projects page retains edit/archive but has no create form.
The backend project POST route remains available to Jarvis for P3-12. Live Entra
and Azure SQL behavior remain unverified.
P3-13 was checked at 390 and 1280 px with scratch-only auth and API mocks:
managed projects appeared first, managing a repository needed no form and removed
it from the unmanaged list, and explicit refresh loaded the updated list. Neither
width overflowed, the management buttons were 44 px high, and no browser errors
occurred. Live GitHub App, Key Vault, Entra, and Azure SQL behavior remains
unverified.
P3-12 adds the authenticated `create_project` tool and backend-only Key Vault
repository creation. Backend and runner contract tests are local/offline; live
Entra, Key Vault, Azure SQL, private template access and the throwaway end-to-end
scaffolding PR remain unverified.
P1-08 was inspected at 390 and 1280 px with scratch-only auth and project/task/SSE
mocks. All six columns, task creation, filter submission, modal dismissal, and
focus return worked; the page had no horizontal overflow, controls were at least
44 px high, and no console errors occurred. The wide board scrolls within its
own region. Mocks do not verify live Entra, Azure SQL, or deployed SSE.
P1-09 was inspected at 390 and 1280 px with a scratch-only `./useSignIn` stub
and project/task/conversation/SSE mocks. The source message, project and branch
links, live SSE event, event filter, and expanded payload worked; P1-09 task
controls remained disabled until P2-07. Neither width overflowed, interactive
controls were at least 44 px high, and no console errors occurred. P2-07 was
inspected at 390 and 1280 px in Chromium with scratch-only auth and task API
mocks; steer, pause, resume, cancellation confirmation, and cancellation worked,
with no horizontal overflow or console errors. The live acceptance still
requires both agents on `DanAakesen/jarvis-test-target`, including intermediate
commits on the task branch; the coordinator runs it post-merge. Live Entra, Azure
SQL/Blob archive reads, deployed SSE, and live Foundry controls remain unverified.
P2-14's actual `TaskControls` component and styles were inspected in Chromium at
390 and 1280 px from a scratch Vite harness with only the controls POST mocked.
Continue showed a disabled pending state and success feedback; an active-crash
fixture still showed Recover. The button measured 44 px, neither viewport
overflowed, and there were no page errors. Live backend/Foundry expiry remains
unverified.
P8-34 was checked with existing web tests, lint and build, plus a scratch
Chromium/Vite harness (`node /tmp/p8-34-browser/verify.mjs`) using a temporary
`./useSignIn` alias and fixture task, project, release, usage, Now-feed, presence,
and SSE responses. At 1440×1000 and 390×844, dark and light runs showed all six
state columns (including pending pause), the selected-task pane and Running
controls; keyboard close returned focus to the selected card, task selection
retained board scroll, and switching projects hid the previous project's
commits. The page had no horizontal overflow or browser errors, the close target
was 44×44 px, and reduced-motion mode used an opacity-only transition. Three
additional frames record the Running-card transition with motion enabled.
Captures are
`docs/ui/screenshots/p8-34-fixture-{dark,light}-{desktop,phone}.png` and
`docs/ui/screenshots/p8-34-motion-running-{before,transition,settled}.png`.
`npm run build --workspace @jarvis/web` and
`npm run lint --workspace @jarvis/web` passed; the build retains the existing
large-chunk advisory. `npm test --workspace @jarvis/web -- --run
src/App.test.tsx src/ContextPanel.test.tsx src/ConversationHistory.test.tsx
src/factory/TaskControls.test.tsx src/factory/TaskDetailPage.test.tsx
src/factory/TaskReleaseBar.test.tsx src/factory/TasksPage.test.tsx` passed
(7 files, 99 tests).
All account and API responses in this run were fixtures; this does not verify
live Entra, backend/release data, deployed SSE, provider usage, voice, physical
phone, or hardware-GPU behavior.
P6-01 was inspected at 390 and 1280 px using the scratch `./auth` stub, a
placeholder backend origin, and a mocked `/usage` response. Project/agent/source
grouping, period selection, task links, 503 recovery, and the empty state worked;
the page had no horizontal overflow, selects measured 44 px, and only the table
scrolls horizontally. The expected mocked 503 produced a browser network log;
there were no other console errors or page exceptions. Live SQL and provider or
voice usage remain unverified.
P8-19 was re-inspected alongside P8-13 Appearance in Chromium at 1280×900 and
390×844 with scratch-only auth and `/settings` API mocks. Personality loaded,
saved, recovered after a mocked HTTP 500 without losing edits, and reset to
defaults; keyboard focus was visible, the page had no horizontal overflow, and
interactive controls measured at least 44 px. The expected mocked failure was
the only browser console error. Screenshots are in
`docs/ui/screenshots/p8-19-personality-{desktop,phone}.png`; live Entra and
Azure settings behavior remain unverified.

P3-08 was inspected at 390×844 (dark theme) and 1280×1300 (light theme) in
Chromium using scratch-only auth and mocked release/graph/API responses: opening
a release, refresh, and keyboard focus on a commit link worked; its hit area was
44×44 px and the document did not overflow either viewport. The desktop and
phone screenshots are
`docs/ui/screenshots/p3-08-release-view-desktop.png` and
`docs/ui/screenshots/p3-08-release-view-phone.png`; their fixture data is mocked.
Live Entra, Azure SQL, and GitHub behavior remain unverified.
P7-08 was inspected in Chromium at 1280×900 and 390×844 using scratch-only auth,
fake camera media, and mocked API/vision responses. The camera turned on and off,
one frame was sent through the existing screen-vision request, and the camera
track stopped; neither viewport overflowed and there were no browser errors.
Screenshots are
`docs/ui/screenshots/p7-08-camera-desktop.png` and
`docs/ui/screenshots/p7-08-camera-phone.png`; their account, camera stream, and
vision response are fixtures. Live camera hardware, Entra, backend, and deployed
Foundry image support remain unverified.
Never commit the stub or weaken sign-in in the app.

Backend commands:

| Purpose | Command |
| --- | --- |
| Backend lint / offline tests / targeted build | `npm run lint --workspace @jarvis/backend`; `npm test --workspace @jarvis/backend`; `npm run build --workspace @jarvis/backend` |
| Focused P3-07 release webhook contract | `npm test --workspace @jarvis/backend -- --run src/database/webhook-delivery-store.test.ts` |
| Focused P3-08 release API and GitHub graph tests | `npm test --workspace @jarvis/backend -- --run src/factory/release-view.test.ts src/github/release-graph.test.ts src/github-app.test.ts` |
| SQL Server migration, webhook mapping, and task-store integration tests (including event/activity transaction and sub-second publish contract) | `npm run test:database --workspace @jarvis/backend` (requires the isolated loopback SQL Server configuration used by `database-ci.yml`) |
| Focused P2-07 backend control tests | `npm test --workspace @jarvis/backend -- src/factory/dispatcher.test.ts src/factory/tasks.test.ts src/factory/heartbeat.test.ts src/factory/task-lifecycle.test.ts` |
| Focused P2-14 completion/expiry regressions | `npm test --workspace @jarvis/backend -- src/factory/heartbeat.test.ts src/factory/dispatcher.test.ts src/database/sandbox-heartbeat-store.test.ts` |
| Focused P2-07 web control tests | `npm test --workspace @jarvis/web -- src/factory/TaskControls.test.tsx src/factory/TasksPage.test.tsx src/factory/TaskDetailPage.test.tsx` |
| Focused P3-08 release view and project navigation tests | `npm test --workspace @jarvis/web -- --run src/factory/ReleasePage.test.tsx src/factory/ProjectsPage.test.tsx src/App.test.tsx` |
| P6-05 SQL Server parallel load test (CI `Database` job; prints a `P6-05 load:` summary line) | `npm run test:database --workspace @jarvis/backend -- src/database/dispatcher-load.integration.test.ts` (isolated loopback SQL Server only) |
| Focused P6-05 runner Codex limit test | `runner/.venv/bin/python -m pytest -q runner/tests/test_app.py -k codex_usage_limit` |
| Start compiled backend | `npm start --workspace @jarvis/backend` (after its build) |
| Build then start backend | `npm run dev --workspace @jarvis/backend` |
| Health request | `curl --fail http://localhost:3000/health` → `{"status":"ok"}` |
| Production container (GitHub Actions only; no Docker in an agent sandbox) | `docker build --file apps/backend/Dockerfile --tag jarvis-backend .` from the repository root |

Live parallel load test (P6-08; Dan runs it, because agents have no production
access):

1. Check that the latest Deploy on `main` passed and includes P6-05. The dispatcher
   now sends `task_id`; earlier backends could not start any task (L59). Codex
   and Copilot credentials must be current in Settings.
2. Create two or three projects on private test repositories (for example
   `DanAakesen/jarvis-test-target` and a second one created with
   `gh repo create --private`). Set global max parallel tasks to 4 and project
   limits to 2/2/1.
3. Note the remaining Codex allowance on the Jarvis ChatGPT account's Codex usage
   page. Then create about eight small tasks across the projects, alternating
   Codex and Copilot.
4. Watch the board and task details. Record the maximum number Running at once,
   the time from Ready to Running, every Needs attention reason (a Codex
   `failed` event reads `Codex usage limit reached`), and sandbox minutes/DKK from
   the Usage page. Afterwards, note the Codex allowance again.
5. Record the results as a dated entry in [decisions.md](decisions.md).

The factory tasks API provides authenticated create, filtered list, detail, and
state-aware control routes. The controls route accepts only `steer`, `pause`,
`resume`, `cancel`, or `recover` (the latter only for Needs attention); it never
accepts a client-supplied task state. Recovery starts a new Foundry session from
the task branch with the original request, bounded steering history, and an event
summary. Task list
filters are `projectId`, `agent`, `state`, `createdAfter`,
`createdBefore`, and `search`; `limit`/`offset` and `eventLimit`/`eventOffset`
bound result pages. Responses are capped at 1 MiB; event payloads above 4 KiB
are marked truncated. State is backend-owned; do not add a client state update.
The task store's transition operation must be used by backend dispatch/control
code, and `Done` requires GitHub verification of the task branch and a pull
request in the configured repository.

`PORT` defaults to 3000, matching Container Apps ingress. `LOG_LEVEL` defaults
to `info`. `STATIC_WEB_APP_ORIGIN` is an exact HTTPS origin with no trailing
slash, path or query; it is required when `NODE_ENV=production`. P0-11 supplies
the deployed Static Web App origin. Browser origins are limited to this value
and `http://localhost:5173`; requests with another Origin receive 403. Requests
without Origin (such as container health probes) are allowed. CORS is not
authentication. P0-08 installs a root bearer-authentication hook before CORS,
so future area routes inherit it. Only `/health` GET/HEAD and the generated CORS
preflight route are public; explicit OPTIONS business endpoints are protected.

`FOUNDRY_ADMIN_ENDPOINT` and `FOUNDRY_RUNTIME_ENDPOINT` are optional HTTPS Foundry
project endpoints, supplied by Bicep in production. Configure both to enable
sandbox dispatch and heartbeats; if absent, the backend starts with both disabled.
The backend identity uses `DefaultAzureCredential` with the SQL
managed-identity client ID and has Foundry User on the project. At startup, the
heartbeat reloads active sessions once; the dispatcher writes `agent_name` for
new sessions, calls `track()` after the SQL commit, and `untrack()` when sessions
end. The dispatcher wakes on task events and retry deadlines, not SQL polling;
expired start leases go to Needs attention rather than replaying a possibly
accepted Foundry start. Offline tests do not verify live Foundry access.
Every heartbeat poll emits `sandbox_heartbeat.decision` with the SQL session ID,
invocation ID, HTTP status (null before any response), and a controlled decision.
Use these fields to distinguish confirmation retries, committed crashes,
`idle_expired`, unchanged state, and soft/persistence failures; no provider body,
question, prompt, or credential is included.

P9-116's committed backend `sandbox_idle_expired` event requests one bounded
reconciliation scan even when no heartbeat session is tracked. Reconciliation
selects and rechecks the latest session and invocation; it does not infer a
crash or success from expiry. A verified delivery awaiting project policy keeps
the task Running and within capacity until the existing policy event resolves it.
The scan returns to no recurring SQL reads while idle. The original missed
delivery cause and live recovery of #837 remain unverified.
Validate the dispatcher with
`npm test --workspace @jarvis/backend -- --run src/factory/dispatcher.test.ts`
and SQL selection/admission with
`npm run test:database --workspace @jarvis/backend -- src/database/dispatcher.integration.test.ts`
only under the isolated loopback SQL Server configuration.

The optional `VOICE_LIVE_ENDPOINT` enables `/voice`; it must be a secure Azure
Voice Live WebSocket endpoint without credentials in its URL. The backend pins
`gpt-realtime-2.1`, gets the `https://ai.azure.com/.default` token with
`DefaultAzureCredential`, and owns session settings and tool execution. P0-16
must configure this endpoint and provider identity before live use. Local voice
tests use a mock WebSocket and do not verify Azure access or browser audio.

`JARVIS_CHAT_AGENT_NAME` names the hosted chat agent (`jarvis` in production);
`FOUNDRY_PROJECT_ENDPOINT` is the secure Azure AI project endpoint supplied by
Bicep. The main Deploy workflow configures the name after publishing the hosted
agent, and Bicep retains it on later infrastructure updates. The backend calls
Foundry's Invocations endpoint using its managed identity and the
`https://ai.azure.com/.default` scope. It sends the user's delegated authorization
and stored message ID in the application payload, not the Foundry HTTP
`Authorization` header. The agent validates the delegated token through `/me`,
verifies the source message through `/conversation/history`, then streams its
application-defined SSE reply. Never expose or log the delegated token. Without
the agent name, chat remains unavailable and returns a visible 503; live Azure
streaming and tool-call linkage require the post-merge acceptance check.

P7-13 also uses `FOUNDRY_PROJECT_ENDPOINT` and the Bicep-provided
`JARVIS_MEMORY_EMBEDDING_DEPLOYMENT_NAME` (`text-embedding-3-small`) with the
backend managed identity and `https://ai.azure.com/.default` scope. This setting
is optional for local development: memory retrieval falls back to SQL full-text
or substring search when embeddings are not configured or unavailable. No API
key or browser credential is used.

P7-14 uses the same configured Foundry runner and the existing `codex-login`
Key Vault secret; there is no Bing resource, search API key, new paid API, or
manual provider setup. Bicep's `codexToolModel` parameter configures the backend
setting `JARVIS_CODEX_TOOL_MODEL` (default `gpt-5.5`); the backend passes that
model to runner mode `codex-tool`, tool `web_research`. The runner uses a fresh
temporary workspace without a repository, disables Codex's `shell_tool`, and
deletes the workspace and auth file after the invocation. Do not enable the
shell tool or treat the read-only sandbox as a credential-file boundary.
Offline tests use fake provider processes. After merge, the coordinator checks
one harmless live query, its source URLs, explicit no-source behavior when
applicable, usage-limit handling if naturally available, and the daily count;
the coding agent must not access Azure or run live Codex acceptance.

Production runner calls use the optional paired `FOUNDRY_RUNTIME_ENDPOINT` and
`FOUNDRY_ADMIN_ENDPOINT`, plus `FOUNDRY_RUNNER_AGENT_NAME`. Bicep supplies the
project URLs and `jarvis-runner-base-1x2`; these are non-secret settings. When
configured, the backend uses its shared `DefaultAzureCredential`, selected with
`SQL_MANAGED_IDENTITY_CLIENT_ID`. The daily Codex renewal job requires database
and Foundry runner configuration, and uses the SQL credential lease; the task
dispatcher must start Codex work through `TaskStore.transition` so both
operations serialize. Bicep retains one `Foundry User` assignment for the
backend identity at project scope. P7-15 image generation uses the same runner
and adds `JARVIS_CODEX_TOOL_MODEL` (default `gpt-5.5`); it is a model name, not a
credential. The hosted runner uses its existing Key Vault Codex login. No API
key or paid image API is configured.

Backend authentication defaults to the nonsecret identities in
`infra/bootstrap.output.json`. `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID` and
`ENTRA_OWNER_OBJECT_ID` may override those UUIDs at startup. The API expects an
RS256 Entra v2 delegated access token with the API client ID as audience and
`access_as_user` scope; an ID token, app-only token or another user's object ID
is denied. `request.principal` contains only the verified object and tenant IDs.
The optional `ENTRA_JARVIS_AGENT_OBJECT_ID` (a UUID other than Dan's; P4-01)
admits the hosted Jarvis agent's app-only token with the `Jarvis.Tools` role,
and only on routes marked `config: { jarvisAgent: true }` (`GET /tools`,
`GET /factory/context`, `POST /tools/{name}`); elsewhere it gets 403. Unset or
empty denies the agent.
Missing/invalid credentials return 401; verified but unauthorized tokens return
403. Authentication failures never export token/claim/provider details.
Approved browser origins retain CORS headers on these early denials so the web
can read their status; unapproved origins receive no allow-origin header.

`npm test --workspace @jarvis/backend` includes real RSA/local-JWKS auth checks,
socket duplicate-header rejection, cached keys and bounded provider outages.
It also covers task API validation and every lifecycle edge. SQL Server
integration tests cover task creation, event persistence, filtering and
transitions against an isolated SQL Server 2022 instance; neither test suite
requires Azure identity or Azure access. The production JWKS
lookup timeout is five seconds. `/me` and browser sign-in remain P0-09; live
Azure token verification remains P0-16.

`APPLICATIONINSIGHTS_CONNECTION_STRING` is backend-only protected runtime
configuration supplied by P0-11 through Key Vault references. When absent,
logs go to stdout only and `telemetry.stdout_only` makes that state visible.
The isolated manual SDK receives the same safe events; automatic request and
dependency instrumentation is not enabled. Log output drops headers, bodies,
URLs, query strings, arbitrary messages and raw errors. Request IDs are generated
by the server. Telemetry tests use fake sinks, never Azure. SIGTERM/SIGINT stops
the backend and bounds close/flush/disposal to five seconds.

### Voice and PC bridge timing (P5-14)

`voice.turn_timing` logs one content-free event per voice turn, with all stage
times relative to `input_audio_buffer.speech_stopped`. `tools` contains only
tool names, start/finish offsets and normalized outcomes. `pc_bridge.command_timing`
records each bridge command name, outcome and round-trip milliseconds. The
existing logger allowlist drops transcripts, arguments and results.

List the latest N voice turns and their timing columns (change `N` as needed):

```kusto
let N = 50;
traces
| where message == "voice.turn_timing"
| extend turnId = tostring(customDimensions.turnId),
    transcriptCompletedMs = todouble(customDimensions.transcriptCompletedMs),
    jevDecisionMs = todouble(customDimensions.jevDecisionMs),
    firstAudioDeltaMs = todouble(customDimensions.firstAudioDeltaMs),
    responseDoneMs = todouble(customDimensions.responseDoneMs),
    tools = parse_json(tostring(customDimensions.tools))
| top N by timestamp desc
| project timestamp, turnId, transcriptCompletedMs, jevDecisionMs,
    tools, firstAudioDeltaMs, responseDoneMs
```

Calculate p50/p90 per voice step, voice tool and PC bridge command across the
same latest N voice turns and the latest N bridge commands:

```kusto
let N = 50;
let turns =
    traces
    | where message == "voice.turn_timing"
    | top N by timestamp desc
    | project timestamp, customDimensions;
let steps =
    turns
    | mv-expand step = pack_array(
        pack("name", "transcript_completed", "durationMs", todouble(customDimensions.transcriptCompletedMs)),
        pack("name", "jev_decision", "durationMs", todouble(customDimensions.jevDecisionMs)),
        pack("name", "first_audio_delta", "durationMs", todouble(customDimensions.firstAudioDeltaMs)),
        pack("name", "response_done", "durationMs", todouble(customDimensions.responseDoneMs)))
    | extend name = tostring(step.name), durationMs = todouble(step.durationMs)
    | where isnotnull(durationMs)
    | project name, durationMs;
let voiceTools =
    turns
    | mv-expand tool = parse_json(tostring(customDimensions.tools))
    | extend name = strcat("tool.", tostring(tool.name)),
        durationMs = todouble(tool.finishedMs) - todouble(tool.startedMs)
    | where isnotnull(tool.finishedMs)
    | project name, durationMs;
let bridgeCommands =
    traces
    | where message == "pc_bridge.command_timing"
    | top N by timestamp desc
    | extend name = strcat("bridge.", tostring(customDimensions.command)),
        durationMs = todouble(customDimensions.roundTripMs)
    | where isnotnull(durationMs)
    | project name, durationMs;
union steps, voiceTools, bridgeCommands
| summarize p50Ms = percentile(durationMs, 50), p90Ms = percentile(durationMs, 90) by name
| order by name asc
```

`Backend CI` runs the offline lint, tests and targeted build plus a production
container build and smoke test without Azure credentials. Its image uses pinned
Node.js, runs as non-root, and contains backend output and production dependencies.
Container verification belongs in Actions; live telemetry ingestion and Azure
connectivity remain unverified until P0-16.

Verified locally in P0-04 (Azure deployment remains pending P0-16):

| Purpose | Command |
| --- | --- |
| Build Bicep (generates git-ignored `infra/main.json`) | `az bicep build --file infra/main.bicep` |
| Lint Bicep | `az bicep lint --file infra/main.bicep` |

Dan requests a fresh checkout of the latest `main` for every task. A new cloud
task can use its provided checkout; a task started in an existing cloud session
uses a separate Git worktree and task branch. Git HTTPS access and GitHub API access are
separate: cloud environment network settings must allow `api.github.com` for
issue/PR operations, as well as GitHub Git access and package registries. Never
request a token merely because a network policy blocks that hostname.

Verified locally for issue #30 (no Azure access required):

| Purpose | Command from the repository root |
| --- | --- |
| Build the standalone backend Foundry client | `npm run build --workspace @jarvis/backend` |
| Lint the client module | `npx --no-install eslint --config apps/backend/src/foundry/lint.config.mjs apps/backend/src/foundry --max-warnings 0` |
| Run offline Foundry contract tests | `npx --no-install vitest run --config apps/backend/src/foundry/vitest.config.mts` |

The client constructor takes `runtimeEndpoint`, `adminEndpoint`, `agentName` and an injected `getToken(scope, signal)` identity provider. These are module options, not new environment variables. See the [module guide](../apps/backend/src/foundry/README.md) for operation ownership and fixture provenance. Recorded runner responses are captured locally with ACP stubbed; these checks establish the offline contract, not live Azure readiness. The dedicated `Foundry contract CI` workflow checks this module on the current skeleton without depending on the server implementation.

P2-13 task starts require `repository` (`owner/name`), `defaultBranch`, and
`branch` in addition to the task identifier. The runner prepares the Git
checkout before starting ACP; provider probes and Codex renewal do not clone a
repository. Keep the existing Git credential-helper interface when changing
token acquisition (P3-02). After merge, the coordinator must run one Copilot and
one Codex task on `DanAakesen/jarvis-test-target`, verify pushes to their
`jarvis/task-<id>` branches, and verify that a commit-free agent question appears
as Needs attention.

### Local PC bridge (P7-06)

The .NET 10 Windows tray companion is in `pc-bridge/`. Its portable command
policy and protocol projects run on Linux; `backend-ci.yml` also builds the
`net10.0-windows` app with Windows targeting enabled.

After merge, the coordinator must provision the app and deploy before installing
the companion on Dan's PC:

1. Run `infra/bootstrap.ps1` in Dan's signed-in Azure/GitHub session. It creates
   or repairs `jarvis-pc-bridge`, pre-authorizes its delegated `access_as_user`
   permission, and writes `JARVIS_PC_BRIDGE_CLIENT_ID` as an Actions variable.
   Run the main Deploy workflow so Bicep configures `ENTRA_PC_BRIDGE_CLIENT_ID`
   in the backend. Agents do not have Azure/tenant access.
2. Get `backendFqdn` from the `jarvis-infra` deployment output. On Dan's Windows
   PC, publish the self-contained app for the PC's architecture (Dan's PC is ARM64)
   to a temporary directory. The installer replaces every earlier install file except
   the loaded Chrome extension folder:

   ```powershell
   $rid = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'win-arm64' } else { 'win-x64' }
   dotnet publish .\pc-bridge\Jarvis.PcBridge\Jarvis.PcBridge.csproj `
     --configuration Release --runtime $rid --self-contained true `
     --output "$env:TEMP\jarvis-pc-bridge"
   ```

3. Install for the current Windows user with the IDs from
   `infra/bootstrap.output.json`:

   ```powershell
   .\pc-bridge\Install-Bridge.ps1 `
     -PublishPath "$env:TEMP\jarvis-pc-bridge" `
     -BackendUrl https://<backendFqdn> `
     -TenantId <tenant-guid> `
     -ApiClientId <jarvis-api-client-guid> `
     -BridgeClientId <jarvis-pc-bridge-client-guid>
   ```

   The installer stops existing tray and native-host processes, then retries file
   copies briefly if Chrome restarts a native host during the update. It copies app
   files under `%LOCALAPPDATA%\Programs\Jarvis.PcBridge`, updates only the
   connection fields in `%LOCALAPPDATA%\Jarvis\PcBridge\settings.json`, and
   creates a Startup shortcut. Existing browser automation and other user settings
   are retained; the installer prints whether Chrome automation is on. If extension
   files changed, reload the unpacked extension from `chrome://extensions`.
   Launch the installed executable once to sign in by device code; MSAL stores its
   refresh cache with Windows DPAPI. Re-running the installer updates the files
   without deleting that token cache. The bridge connects outbound and creates no
   inbound firewall rule.
4. Confirm the tray reports Online, then ask Jarvis to open an HTTP(S) URL and
   verify it opens in foreground Chrome—through the extension when connected and
   enabled, or the direct Chrome executable fallback when disconnected, never
   Edge. Open an allow-listed app as a separate check. Check the authenticated Now
   feed for online/offline status; verify active-window reads and exact-title
   focus with Dan present at the PC. Verify **Pause Jarvis control (on)** blocks
   PC actions and the same Now row reports paused; turn the toggle off and confirm
   actions resume and the row reports active.

The app allows only HTTP(S) URLs, VS Code, Edge, File Explorer, Windows Terminal,
folders below `C:\Repo` in VS Code, active-window title, and exact-title focus.
`pc_act` separately controls any foreground Windows app through UI Automation.
Pause Jarvis control is saved in the bridge settings and reported over the
authenticated socket; no shell or arbitrary command execution is exposed.
Offline policy/protocol tests do not verify live Entra sign-in or Windows
execution; those remain coordinator post-merge checks.

### Chrome browser executor (P7-18, P7-25)

The tray menu includes a persisted **Chrome browser automation (off/on)**
toggle; missing settings default to off. The extension transport is selected
when the Jarvis extension is connected in Dan's normal Chrome profile. The
installer registers a Chrome native-messaging host under the current user's
HKCU hive; the native host relays framed messages to the running tray bridge
over a current-user-only named pipe. It adds no network listener. The extension
uses only native messaging, does not declare `externally_connectable`, and
attaches with Chrome's debugger API only while carrying out browser work; Chrome
shows its debugger notification while attached and the executor detaches after
an action, with a 30-second idle detach as recovery. The existing loopback CDP
transport remains a fallback for a separately configured debugging endpoint.

Install the bridge using the steps above. In Dan's normal Chrome profile, open
`chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and
choose:

```text
%LOCALAPPDATA%\Programs\Jarvis.PcBridge\chrome-extension
```

This is a one-time step for the unpacked extension; a private Chrome Web Store
release can replace it later. Do not create or copy a profile, or restart Chrome
with `--remote-debugging-port`: since Chrome 136, remote debugging is ignored on
the default user-data directory. Jarvis must use the profile Dan already uses.
The extension calls `chrome.tabs` for tab discovery and uses fixed
`chrome.debugger` CDP operations; a fixed `chrome.scripting` check verifies that
the selected page can be scripted before debugger work starts.

For local acceptance, start the test page server from the repository root:

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory pc-bridge/test-pages
```

In Dan's normal Chrome, open `http://127.0.0.1:8765/browser-executor.html`,
right-click the Jarvis tray icon, and explicitly turn on **Chrome browser
automation**. With P7-17 available, ask Jarvis to list tabs and snapshot this
page. Test typing in **Ordinary text**, selecting **Two**, clicking **Safe
click target**, and using **Toggle target cover** before attempting another
click from the old snapshot. The covered click must be refused. Attempts to
type in Password or One-time code must be blocked; **Send test message** must
wait for Dan's P7-03 confirmation and the local page must not send anything.
Take a new snapshot after each page change. Then turn the tray toggle off and
stop the test server. Live acceptance also requires “open google.com” and
“search for X” in Dan's normal Chrome profile.

From the repository root, the offline checks are:

```text
dotnet test pc-bridge/Jarvis.PcBridge.Core.Tests/Jarvis.PcBridge.Core.Tests.csproj --configuration Release
dotnet build pc-bridge/Jarvis.PcBridge/Jarvis.PcBridge.csproj --configuration Release
pwsh -NoProfile -File pc-bridge/tests/BridgeInstaller.Helpers.Tests.ps1
npm test --workspace @jarvis/backend -- --run src/pc-bridge/bridge.test.ts
```

Fake-CDP and fake-extension-port tests exercise the shared indexed-action
contract; they do not prove Chrome profile behavior, native-host registration,
or tray interaction. Live Chrome, physical confirmation delivery, and Dan's
acceptance remain coordinator checks. Do not include unrelated personal tabs or
page contents in evidence.

### Offline wake word (P7-39)

The bridge detects "Wake up Jarvis" on Dan's PC with the Speech SDK
`KeywordRecognizer` and a custom keyword model. Agents cannot create the model;
the coordinator creates it in Dan's signed-in Speech Studio session:

1. Open Speech Studio → **Custom keyword** (`https://speech.microsoft.com/portal/customkeyword`)
   with the existing Jarvis Speech/AI Services resource. Select **Create a new
   project**, name it `jarvis-wake-word`, and choose **English (United States)**
   (one of the two supported languages).
2. Open the project and select **Create a new model**. Enter the keyword
   exactly as `Wake up Jarvis`, keep only the candidate pronunciations that match
   Dan's speech, and select the **Basic** model type. Training can take several
   hours. Wait for **Succeeded**.
3. Under **Tune**, download the model `.zip` and extract it. Copy the `.table`
   file to `%LOCALAPPDATA%\Jarvis\PcBridge\wake-up-jarvis.table` on Dan's PC.
   Do not commit it.
4. Add the absolute path to `%LOCALAPPDATA%\Jarvis\PcBridge\settings.json`,
   escaping backslashes:

   ```json
   "WakeWordModelPath": "C:\\Users\\<user>\\AppData\\Local\\Jarvis\\PcBridge\\wake-up-jarvis.table"
   ```

   The installer keeps this field. Optional fields: `WakeWordEnabled` (missing
   means on once the model exists) and `WebUrl` (Jarvis web origin; defaults to
   the production Static Web App origin). Restart the bridge from the tray.

Without a valid `.table` path, the tray's **Wake word** item is disabled and
explains the missing model. With it, the item shows listening, paused during
voice, or microphone unavailable, and toggling it is saved. Reload the unpacked
Chrome extension after installing (extension 1.0.3 adds `focus_jarvis_tab`).

Live acceptance (coordinator with Dan, after the page reacts to `voice-wake`):
say "Wake up Jarvis" with the Jarvis tab in the background, then with no
Jarvis tab open. Expect one chime, the existing Jarvis Chrome tab (or a new one,
never Edge) in front, and voice starting. During the voice session the tray
should show it is paused; after the session ends it should listen again. Turn
the toggle off and confirm the phrase does nothing. Offline tests use a fake
recognizer and do not prove microphone, model accuracy, or Chrome focus.

### Database access and migrations (#7)

- Configure `SQL_SERVER=<host>.database.windows.net`, `SQL_DATABASE=jarvis` and
  `SQL_MANAGED_IDENTITY_CLIENT_ID=<id-jarvis-backend client UUID>` in the backend
  deployment. These are identifiers, not passwords. `SQL_AUTH_MODE` may be omitted
  or `managed-identity`. Password/user/port overrides are forbidden in this mode;
  TLS certificate validation is always enabled.
- With no SQL variables, the offline skeleton logs `database.not_configured` and
  keeps `/health` available. Partial/invalid configuration fails startup. #11 must
  supply all three settings and verify identity membership/SQL connectivity.
- The backend owns a pool, runs migrations before listening and closes it on
  failed/cancelled startup or shutdown. SQL calls are bounded to 120 seconds,
  lock contention to 60 seconds, and complete startup to 300 seconds. Initialization
  is outside Fastify ready hooks so their 10-second timeout cannot abort SQL
  auto-resume. No idle SQL poll or periodic migration job is added.
- Append immutable files under `db/migrations/` as `NNNN_name.sql`; use one SQL
  batch per file, no `GO`, and never rewrite an applied file or insert before
  applied history. Add the reverse batch under `db/migrations/down/` with the
  same name; an offline test requires one for every migration, and
  `schema.integration.test.ts` reverts all of them newest first and reapplies.
  `0001_core_tables.sql` contains groups 1–3; `0002_sandbox_operations.sql`
  contains groups 4 and 6; `0003_sandbox_agent_name.sql` adds the heartbeat's
  Foundry routing field, and P6-03's `0005_task_event_archives.sql` indexes
  committed Blob chunks for on-demand task-history reads. P7-13's
  `0016_long_term_memory.sql` adds durable source-linked memories and conditional
  vector/full-text capabilities; startup applies it through the existing locked,
  checksummed migration runner.
  See [migration guide](../db/migrations/README.md).
- Offline checks: `npm test --workspace @jarvis/backend`,
  `npm run lint --workspace @jarvis/backend`,
  `npm run build --workspace @jarvis/backend`.
- Real SQL contracts: `npm run test:database --workspace @jarvis/backend` in
  `database-ci.yml`, called by aggregate `ci.yml` and included in `CI result`.
  Actions owns the disposable SQL Server container; agents do not run Docker or
  reach Azure SQL. Test-password mode requires `NODE_ENV=test`, `SQL_SERVER=127.0.0.1`,
  `SQL_USER`, `SQL_PASSWORD` and `SQL_DATABASE`; its isolated fixture is not a
  production credential. See [database guide](../apps/backend/src/database/README.md).
- Real Azure managed-identity exchange and applying/restarting a deployed revision
  remain #11. Offline contracts never establish live Azure readiness.
- P6-03 adds the Bicep-created private `task-events` Blob container. Bicep supplies
  `TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT`; the backend requires it when SQL is enabled
  and authenticates with its existing managed identity. No local credential or
  manual Azure setup is needed. Archive/restore contracts use a fake Blob store;
  the live Azure archive/restore check must happen after merge.
- P7-13 needs no separate portal or bootstrap action. The existing Deploy workflow
  reapplies Bicep and the backend startup migration applies `0016` through the
  idempotent migration runner. Memory-store startup executes the idempotent
  `db/migrations/setup/0016_long_term_memory.sql` after the migration transaction
  commits. After merge, the coordinator checks that Deploy creates the
  `text-embedding-3-small` deployment and that the backend is healthy;
  then verify a harmless memory through chat and voice, a later session after a
  backend restart, list/history, correction and forgetting. Confirm forgetting
  prevents recall while original conversation records remain. Never use sensitive
  real data for the smoke test.
- P7-15 image generation needs no new service or secret. The backend uses its
  existing Foundry runner agent and Blob managed identity; migration `0017`
  creates owner-scoped image metadata, and `0018` allows refused tool outcomes
  to be recorded for the daily per-tool Usage count. `JARVIS_CODEX_TOOL_MODEL`
  defaults to `gpt-5.5`; Dan locally verified Codex CLI 0.157.1 with his ChatGPT
  login, but deployed Codex behavior is unverified. After merge, the coordinator
  should ask for one approved image, verify its private Blob artifact in both
  chat and the workspace, and confirm usage-limit errors remain visible. This
  consumes the shared ChatGPT/Codex allowance; it is not a cost counter or a
  per-image API charge. Video is deferred; retention has no automatic cleanup.

Aggregate CI (P0-10), `.github/workflows/ci.yml`:

| Item | Detail |
| --- | --- |
| Triggers | Every `pull_request`, `push` to `main`, and `workflow_dispatch` for manual verification |
| Jobs | `Web`, `Backend` (lint, tests, build, container smoke), `Database` (isolated SQL Server contracts), `Foundry` and `Runner` (base and .NET images, packaged CLI and HTTP smoke) call the reusable `web-ci.yml`, `backend-ci.yml`, `database-ci.yml`, `foundry-contract.yml` and `runner-ci.yml`; `Python lint, test and build` (runner lint and tests moved here from `runner-ci.yml`); `CI result` |
| Gate | `CI result` fails unless every other job succeeded. It is the check to require on `main` and inspect before merging a PR |
| Python | `bash .github/scripts/python-ci.sh [dir ...]` (default `runner agents/jarvis`). A component with `pyproject.toml` must have a hash-pinned `requirements-dev.txt` with ruff and pytest; each gets its own venv, `ruff check`, `pytest -q` and `compileall`. A component without `pyproject.toml` is reported as skipped (notice and step summary), not passed |
| Local workflow lint (verified for P0-10) | `go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.7`, then `~/go/bin/actionlint` from the repository root. It passes for the CI files; it reports existing findings in `runner-ci.yml` (SC2034 warning) and `runner-deploy.yml` (an unquoted ` #11` ends the `prerequisite` step's YAML scalar, so that job failed on `main` at 290195b; needs a `fix-main:` PR) |

- Add a new component workflow as `on: workflow_call`, call it from `ci.yml`, and add it to `CI result`'s `needs`, so it runs once per PR and the gate covers it.
- Required checks on `main` are not enforced: branch protection on a private repository needs GitHub Pro. When available, Dan requires `CI result`; until then Dan or the authorized merging agent must read the `CI` run result itself.

CodeQL code scanning (P9-93), `.github/workflows/codeql.yml`:
Advanced CodeQL code scanning analyzes `javascript-typescript`, `python`, `actions`, and `csharp` using the `security-extended` query suite on pushes and PRs to `main` (path-filtered against markdown and docs) and a weekly schedule. The C# matrix entry uses manual build tracing: after CodeQL initialization, the workflow sets up .NET 10 and builds `pc-bridge/Jarvis.PcBridge/Jarvis.PcBridge.csproj` in Release configuration. This production application project references `Jarvis.PcBridge.Core`; tests are not built as part of extraction. Coverage is limited to source compiled by the traced production build; generated source is covered only when surfaced to that compiler invocation, and no separate generated-code guarantee is made. CodeQL remains non-blocking and operates independently of the `CI result` aggregate gate. Security findings, CWE classifications, and severity levels appear in GitHub under **Security → Code scanning alerts** (`GET /repos/DanAakesen/jarvis/code-scanning/alerts`); triage verdicts should distinguish real security flaws from false positives or test-only code before opening follow-up remediation issues. A successful job and populated `/language:csharp` upload are required evidence of extraction; zero alerts alone do not establish complete coverage or absence of vulnerabilities.

PR title (P9-113), `.github/workflows/pr-title.yml`:

- `validate-pr-title.sh` reads the event's PR number from the GitHub API and
  requires its current repository/number/head to match the event identity.
  Current title/body, not immutable event text, feed the existing normalizer.
  Issue lookup accepts `Fixes`, `Closes`, `Resolves`, or `Refs` with `#123`
  or `DanAakesen/jarvis#123`; the first matching same-repository link is used.
- API calls have a 30-second timeout. A second PR read must match the initial
  title/body/head/update timestamp before success. API/schema/identity/race
  failures fail closed: fix access or metadata and run a fresh current-head gate.
  Head pushes trigger the gate too. A replay after a head change must fail.
- The gate never writes PR titles: GitHub title updates have no atomic
  title/head compare-and-set guard. Noncanonical titles fail with the unchanged
  normalizer's suggestion; save the canonical title to trigger a fresh gate.
  Token permissions remain unchanged. Changes after the final API read are not
  atomically fenced by GitHub check publication; the new edit/push needs its own
  gate, and reviewers must use current-head/current-metadata evidence.
- Offline entry-path regressions and normalizer tests run with
  `PYTHONPATH=.github/scripts python3 -m unittest discover -s .github/scripts/tests -v`.
  Fixtures reject every unplanned `gh` request and never use the network.

Plan status, `.github/workflows/plan-status.yml`:

| Item | Detail |
| --- | --- |
| Triggers | Issue assigned/unassigned/closed/reopened; PR opened/closed/reopened/edited; push to `main` changing `PLAN.md`; manual `workflow_dispatch` |
| Status source | Paginated GitHub issue and PR lists; the offline rules and task-row parser are in `.github/scripts/plan_status.py` |
| New task rows | On a `PLAN.md` push or dispatch, create issues for task IDs without one, add phase labels, then ensure dependency links with the REST `blocked_by` endpoint |
| Commit | Only changes the Issue and Status cells in `PLAN.md`; no commit when unchanged; direct push to `main`, then one fetch/rebase/push retry if rejected |
| Permissions | `contents: write`, `issues: write`, `pull-requests: read`; no secrets or Azure credentials |
| Offline tests | `PYTHONPATH=.github/scripts python3 -m unittest discover -s .github/scripts/tests -v` |
| Live verification | Pending merge: dispatch the workflow and verify a test task; protected-branch push and issue-dependency writes remain unverified |

Deploy, `.github/workflows/deploy.yml` (P0-11):

| Item | Detail |
| --- | --- |
| Triggers | Push to `main` (except `*.md` and `docs/` only); `workflow_dispatch` on `main` redeploys everything |
| Scripts | `deploy_plan.py` (parts to deploy), `deploy_bicep.sh` (Bicep deployment `jarvis-infra`), `deploy_smoke.py` (Foundry hosts) in `.github/scripts/`; the Deploy workflow also calls the backend's authenticated `GET /status/smoke` |
| Permissions | `contents: read`; the plan job adds `actions: read` (last successful run); Azure jobs add `id-token: write` for the bootstrap OIDC identity. No stored secrets; the Static Web Apps token is read at run time and masked |
| Offline checks (verified for P0-11) | `PYTHONPATH=.github/scripts python3 -m unittest discover -s .github/scripts/tests -v` (plan and smoke rules); `az bicep build --file infra/main.bicep --stdout >/dev/null` and `az bicep lint --file infra/main.bicep`; `actionlint .github/workflows/deploy.yml` (actionlint 1.7.12 does not know `concurrency.queue` yet and reports it; GitHub documents it) |
| Live verification | Pending the first run (P0-16) |

After any component deploy, the serialized Smoke checks job obtains a short-lived
Azure Resource Manager access token from the existing OIDC deployment identity
and calls `GET /status/smoke`. The backend accepts that audience only for the
bootstrapped deploy service principal and that exact route; Dan can also call it
with his normal API token. The workflow masks the token, stores the JSON only in
the runner temp directory, requires the six original check IDs while accepting
additional entries, and prints IDs and statuses only. Google, GitHub App, vault,
embeddings, research, agent-contract, and chat-canary failures block acceptance;
an offline PC bridge is reported but does not block deployment.

### Backend modules

Backend modules are composed through the optional third `buildApp` argument;
defaults are `core` and `factory`. Module plugins inherit root security hooks and
contribute internal Jarvis tools without exposing a dispatcher. See the
[module guide](../apps/backend/src/modules.README.md). Register lifecycle hooks
before `ready()`/`listen()`; module startup failures must prevent listening.
The existing backend test/lint/build commands cover the module extension contract.

Future commands (unimplemented until their tasks):

| Purpose | Command |
| --- | --- |
| Bootstrap or repair identities | `./infra/bootstrap.ps1` (safe to re-run; needs Dan's signed-in `az` and `gh`) |
| Python tests | `pytest` in `runner` and `agents/jarvis`, through each package's `.venv` (see [Cloud agent environments](#cloud-agent-environments)); CI runs them through `.github/scripts/python-ci.sh` |
| Validate Mermaid diagrams (candidate; unverified) | `npx -y @mermaid-js/mermaid-cli@11 -i <file>.md -o <out>.md` |

Pin the Codex and Copilot CLI versions locally and in the sandbox image (L13).

### Cloud agent environments

P0-14 prepares both cloud agents with the same dependency step,
[`scripts/setup-dependencies.sh`](../scripts/setup-dependencies.sh). It is
noninteractive and safe to re-run. It fails unless Node.js, npm and Python
exactly match `.nvmrc`, `packageManager` and `.python-version` (it installs the
pinned npm when needed), runs `npm ci`, and gives each Python package (`runner`,
`agents/jarvis`) its own git-ignored `.venv`, installed with
`pip --require-hashes` from `requirements-dev.txt` (else `requirements.txt`). A
package without a hash-locked file fails; an absent package is reported as
skipped and has no tests. Setup fails if it changed any tracked file. It reads
no tokens, calls no Azure service, and builds no Docker image. Lint and tests
are not part of setup.

| Agent | Setup | Status |
| --- | --- | --- |
| Copilot cloud agent | [`.github/workflows/copilot-setup-steps.yml`](../.github/workflows/copilot-setup-steps.yml): `setup-node` and `setup-python` from the pin files, then the shared script. Copilot uses it only once it is on `main`; it also runs as a normal workflow when its inputs change, or manually | The `Copilot Setup Steps` workflow passed on the P0-14 PR; in the P0-14 Copilot session the shared script, `npm run lint`, `npm test` and the runner's ruff and pytest passed |
| Codex cloud | Setup script (and maintenance script) in the Codex environment settings: `bash scripts/codex-setup.sh`. It runs `nvm install`/`nvm alias default` for Node.js, `pyenv install`/`pyenv global` for Python (uv's managed Python if pyenv lacks the version), then the shared script | nvm + uv path verified outside Codex; the Codex image (pyenv path) and a Codex task are unverified: P0-15 |

For P0-15, Dan sets in the Codex environment: setup script `bash scripts/codex-setup.sh`;
optionally `CODEX_ENV_NODE_VERSION=22` and `CODEX_ENV_PYTHON_VERSION=3.12`
(the script installs the exact patch versions itself). The setup script
downloads from nodejs.org, registry.npmjs.org, python.org or GitHub (uv's
Python builds) and PyPI; Codex setup scripts normally have internet access, but
this is unverified for this environment. A Codex task then runs
`npm run lint` and `npm test`. The pyenv path compiles Python on first setup,
which takes a few minutes; Codex caches the result.

Python checks use each package's `.venv`. For the runner, from `runner/`:
`.venv/bin/python -m ruff check .` and `.venv/bin/python -m pytest -q`
(verified in the P0-14 Copilot session after setup: ruff passed, 36 tests passed).
P6-07 adds fake-filesystem coverage for snapshots, threshold configuration, and
the low-disk stop. These offline checks do not verify the Foundry writable disk;
Dan performs that measurement post-merge.

### Runner event identity (P2-03)

Runner deploy sets `JARVIS_BACKEND_URL` from the successful `jarvis-infra`
outputs and `JARVIS_API_SCOPE` from the bootstrapped `jarvis-api` identifier URI.
Each hosted runner sends events with its managed identity; the backend accepts
only the `Jarvis.Runner.Events` app role on `POST /factory/sandbox-events`.
Runner deploy sets `JARVIS_DISK_LOW_THRESHOLD_BYTES` from the same-named GitHub
Actions repository variable, defaulting to `1073741824` bytes (1 GiB). The runner
emits a disk snapshot at each task-turn start and checks free space every 15
seconds; `disk_low` stops the current turn and lets the backend own the task state.

After Runner deploy succeeds, use the four `principal_id` values in its
`runner-deployment` artifact to assign the role:

```powershell
./infra/bootstrap.ps1 -JarvisRunnerPrincipalIds '<base-1x2-id>','<base-2x4-id>','<dotnet-1x2-id>','<dotnet-2x4-id>'
```

Cloud agents cannot run bootstrap or reach Azure. After merge, Dan verifies the
role assignment with a task-ID-bearing runner invocation and confirms its event
appears in task history; browser live updates additionally require P1-06.

### Jarvis agent

`agents/jarvis` (P4-01) has its own `.venv` from the shared setup script. Verified
in the P4-01 Copilot session (Docker was available there):

| Purpose | Command |
| --- | --- |
| Lint and tests, from `agents/jarvis/` | `.venv/bin/python -m ruff check .`; `.venv/bin/python -m pytest -q` (100 passed) |
| Same check as CI, from the root | `bash .github/scripts/python-ci.sh agents/jarvis` |
| Image, from the root | `docker build --tag jarvis-agent:local agents/jarvis` |
| Model-free voice turn | Run the image with the variables below, then `agents/jarvis/.venv/bin/python agents/jarvis/scripts/smoke_test.py` (default `ws://127.0.0.1:8088/invocations_ws`, text `/help`) |
| Regenerate the hash locks, from the root, after editing a `.in` file | `uv pip compile --python-version 3.12 --generate-hashes agents/jarvis/requirements.in -o agents/jarvis/requirements.txt`, then the same for `requirements-dev.in` → `requirements-dev.txt` |

P4-04 fetches `GET /factory/context` before each model turn; it contains at most
20 running tasks and three recent events per task. The voice runtime supplies
the most recent 12 messages, bounded to 24,000 characters total and 8,000 per
message. The context endpoint is agent-authorized and adds no configuration or
secret. SQL-backed context behavior is covered by the database integration suite.

### Danish voice provisioning

The `Danish voice agent` workflow provisions `jarvis-voice-mai` after a successful
`Deploy` when its inputs change, or on manual dispatch from `main`. It checks out
the deployment commit, reads `foundryAdminEndpoint` from the `jarvis-infra`
deployment, and authenticates with GitHub OIDC. The hash-locked SDK inputs are
`agents/jarvis/requirements-voice-provisioner.in` and
`agents/jarvis/requirements-voice-provisioner.txt`. To check locally:

```sh
python -m pip install --require-hashes -r agents/jarvis/requirements-voice-provisioner.txt
python agents/jarvis/scripts/provision_danish_voice.py
```

The script requires `FOUNDRY_PROJECT_ENDPOINT` and an Azure CLI identity authorized
to manage project agents. The Deploy smoke step grants its identity `Foundry User`
on the project; Bicep grants the backend the same role. The backend receives the
project endpoint from Bicep and uses its managed identity; do not put credentials
in the browser.

Agent configuration (environment variables, no secrets):

| Variable | Meaning |
| --- | --- |
| `FOUNDRY_PROJECT_ENDPOINT`, `AZURE_AI_MODEL_DEPLOYMENT_NAME` | Required. Foundry project endpoint (`https://<host>/api/projects/<name>`) and model deployment |
| `JARVIS_BACKEND_URL` | Required. Backend origin: HTTPS, or HTTP only for `localhost`/`127.0.0.1`/`::1`; no path, query or credentials. Startup fails without it |
| `JARVIS_API_CLIENT_ID` | Optional `jarvis-api` client ID for the token scope `api://<id>/.default`; defaults to the bootstrap ID |
| `AZURE_OPENAI_API_KEY` | Optional local model key; without it the agent identity also gets the model token |
| `AZURE_OPENAI_SYSTEM_PROMPT`, `AZURE_OPENAI_MAX_OUTPUT_TOKENS`, `JARVIS_REASONING_EFFORT`, `LOG_LEVEL` | Optional overrides, as in the prototype |
| `JARVIS_SUMMARY_MODEL` | Optional (P9-105). Model deployment name for the conversation-summary call; defaults to the chat model. A name, not a secret |

The main Deploy workflow publishes the agent image by digest, creates a hosted
version with `JARVIS_BACKEND_URL`, and configures the backend with the version's
instance identity. After its summary reports `instance_identity.principal_id`,
run `./infra/bootstrap.ps1 -JarvisAgentPrincipalId <instance_identity.principal_id>`
to assign `Jarvis.Tools` and persist that same value as the
`ENTRA_JARVIS_AGENT_OBJECT_ID` Actions variable. Bicep uses that variable on later
infrastructure deployments. Cloud agents cannot run bootstrap or verify Azure;
Dan verifies the hosted deployment and tools after this local step. Tool calls
also need the stored message ID from P4-03, supplied by the caller in P4-06.

### Screen sharing and camera (P7-05/P7-08)

P9-83 verification: run `npm test --workspace @jarvis/backend -- src/voice/relay.test.ts`
for real local WebSocket image acknowledgement/fallback/correlation regressions.
These use fake upstream providers, not Azure. After deploy the coordinator must
inspect `visual.path` for `channel` values `chat`, `voice-en` and `voice-da` and
confirm `path: image` using a non-private fixture. EN and production DA both use
the realtime connector; the hosted DA fallback remains caption-only. Verify
the configured deployment's modality-specific tariff and reported image tokens
before treating reservations as billed image cost. Cloud agents must not run
Azure capability probes. No new migration or shared instruction-budget change
is introduced.

The backend uses the existing `FOUNDRY_PROJECT_ENDPOINT` and managed identity;
Bicep already grants that identity `Foundry User`, so these features add no Azure
resource, credential, or provisioning script. Migration `0015_screen_frame_usage`
adds the shared usage metric. `global.screen_share_daily_frame_cap` defaults to
300 and is editable in Settings (1–300); screen and camera requests share that
cap, the three-second per-session interval, and the same usage rows.

After merge, Dan/coordinator should:

1. Run the main `Deploy` workflow and confirm migration `0015_screen_frame_usage`
   applied and the backend revision is ready.
2. Confirm the configured `gpt-5.6-luna` deployment accepts image input and is
   Global Standard. The DKK estimate uses the 2 October 2026 price snapshot
   (1.3157 input and 7.8941 output DKK per million short-context tokens); update
   the rate table if the live SKU or current price differs.
3. In a signed-in browser, share a window and verify its persistent status/Stop
   control. Turn on Camera from More, grant permission, verify the Front/Back
   label and Switch/Turn off in Camera preview, not the composer or voice bar.
   Minimise it to a tab and ask by chat and both voice languages for one frame;
   restore it, then Close and confirm the track ends. Ask Jarvis to reopen
   Camera preview with already-granted permission; an ungranted permission must
   be refused without prompting. Confirm
   the camera stops at voice/app-session end and after five minutes. Check the
   shared three-second limit, daily cap, usage count, estimated DKK and absence of
   frame/message content in logs, transcripts, task events and history.

P7-08 adds no backend endpoint or migration: browser webcam frames use authenticated
`POST /screen/frames` and the existing `screen_frames` usage reservation, model
and token/cost accounting. Camera permission is requested only from the signed-in
More action; camera frames are captured only on demand and the track is stopped
on voice end, sign-out/unmount, or after five minutes. Fake stream/model tests cover
the offline path. Cloud agents cannot access the Azure tenant or verify billed
usage; live camera hardware, model image support, managed-identity exchange, SQL
usage and billed cost remain unverified.

Camera preview local checks pass 96 scoped tests, typecheck and the production
build. Desktop/phone Chromium fixtures cover local video, unchanged composer
geometry, docking with fresh-frame capture, mobile-only switching, both voice
transports, failure feedback and track shutdown. Normal motion was exercised
on desktop and short touch landscape; reduced motion on the 320px phone. These
are synthetic streams/intercepted services, not physical-camera or live-model
acceptance. Scoped lint has one pre-existing `Workspace.tsx` pin-loading
set-state-in-effect error; the new preview code passes.

P9-79 local acceptance uses synthetic camera streams and intercepted API/WebSocket
traffic only. Confirm no upload on enable/switch, a JPEG at `/screen/frames` for
each explicit English/Danish request, and a transient description downstream.
Start voice before enabling the camera to exercise callback freshness. Check
switch failure, missing direction, permission denial, capture readiness/deadline,
typing clearance and 44 px icon targets. There is no Look now button.
Physical-phone keyboard/camera, production vision requests and actual Jarvis
descriptions still require Dan's acceptance.

Natural camera wording (Dan, 12 October): do not narrate capture time or
snapshot-versus-live boilerplate for a fresh camera observation. The request
is with the coordinator for backend chat/EN/DA voice instructions. Keep
`capturedAt` validation/provenance and current UI evidence; do not strip
assistant text. Preserve ordinary age warnings for reused observations and
explicit unavailable feedback. No wording deployment is confirmed yet.

Live camera experience investigation (12 October): Dan's signed-in local
browser confirms two caption-only camera turns with `budget_unavailable`;
Dan reports three fingers were answered as four. Read-only Resource Timing
shows ordinary chat request-to-stream-completion at 18.416 s/12.437 s and
serial camera inspection plus chat at 19.694 s/23.494 s. Cross-origin
`requestStart`/`responseStart` are zero, so do not report those totals as
first-token latency. The UI starts chat 2-4 ms after inspection settles;
history refresh follows completion. The coordinator owns backend budget and
agent-latency diagnosis. Dan prioritises natural visual conversation and faster
chat; camera UI updates are parked. This supersedes earlier no-live-traffic
status, not actual-image acceptance. No continuous uploads or new live tests
are authorised by that diagnosis, and no UI release is approved.
Open-stream UTF-8/LF/CRLF transport regressions and the conversation component
suite pass 81 tests (one known locale baseline excluded); TypeScript passes.
No runtime performance change is claimed from those checks.

The coordinator subsequently reports measured server first tokens at
17.6/12.2/16.6/16.1 s and backend work under 0.5 s. #708 owns hosted-session
reuse and content-free timing diagnostics; retain the prior #344/#356 routing
rejection as a compatibility constraint until the new query path is proved.
#707 merged at 06:41:02 UTC, correcting image-resolver budget refusal for
unpriced models through the existing unverified 0.1 DKK hold. Deployment is
confirmed by the coordinator at the 12 October 08:52 local update. First real
image acceptance is still unverified. The coordinator also reports changing
live chat reasoning effort from medium to low; this is reversible in Settings
and is not a default/model change. No new completed turns appear in the
observed browser's timing buffer at 06:53 UTC; that read had no new measurement.
The coordinator's 10:54 local update subsequently reports live Log Analytics
from 07:52-07:53 UTC: cold then warm `chat.agent_session`, `sessionIdUsed: true`,
and first text delta at 12.2 s cold, then 5.2 s and 4.5 s warm. This is reported
backend first-token evidence, not a new local completion measurement or proof
of the 2.5 s target. Both camera turns still fall back to caption with
`image_context_limit` because request text exceeded 28,000 bytes. The
coordinator raised the ceiling to 400,000 bytes on #713; CI was running at
the update. At 11:01 local the coordinator confirms #713 merged/deployed with
backend, agent and smoke green; actual model image acceptance remains pending.
The budget fix does not remove the caption stage: the browser still
awaits `/screen/frames` and requires a real description before forwarding a
fresh handle. Do not invent a caption or direct-upload field to bypass that
contract. Wait for the coordinator's explicit deployed contract if this
sequence changes.

#713 (P9-85, closing #710) now deploys upload-only `mode: 'handle'` with no
description/vision call at capture, and description-optional handle-bearing
chat/EN+DA realtime context. Omitted mode stays caption-first and backwards
compatible. Final shapes, same-frame caption fallback, sixty-second handle
lifetime and unchanged item correlation are in `docs/architecture.md`.
Keep the local caller/decoder unchanged for now: the coordinator explicitly
holds this opt-in until Dan accepts the camera UI release. That permission is
not supplied by a backend deployment. Do not manufacture a description, enable
uploads for testing, or claim actual model image access. Confirm handle-only
history metadata before changing its parser. Fresh-answer wording is separate
pending P9-87/#714, not part of #713's delivered behavior.
#708's revised session plan uses the provider-accepted random 32-hex format,
not the rejected `chat-<id>` format, and requires cold/warm debug-header proof.
Its recovery is restricted to explicit pre-execution routing rejection;
generic invocation failures must not replay a potentially executed turn.
P9-99 implements the random 32-hex affinity in a process-local 256-entry
owner/conversation LRU and removes generic 4xx replay. No verified provider
pre-execution routing code is available for safe automatic recovery. New
completion timings distinguish agent preparation, all model/tool work before
first text and the backend's hosted-dispatch/transport residual; definitions
are in [architecture](architecture.md#conversation-storage-and-history).
Deploy and at least ten production turns remain coordinator acceptance, not an
offline test result.

Camera conversation callers (11 October, local): `App.tsx` passes
`cameraConversationDeployed = true` into `useCamera` after #702's backend,
agent and smoke deployment succeeded in run 38172562500. This enables the
question-aware caption/provenance stage, not actual model image delivery.
The local
path captures each camera-on chat turn at queue execution instead of steering,
and each item-correlated voice transcript with a ten-second inspection deadline.
Fresh optional frame references are forwarded once; cached caption fallback
never includes them. Same-stream/session observations retain server time and
original question, with explicit age/limit copy in preview and shared toasts.
Only recognised typed limits permit reuse. Pacing survives stop/switch; cached
content does not. Off/reconnect/session-end and obsolete turn work are cancelled.
Raw frames, references and questions are never added to telemetry or local
storage. No backend, physical-camera or actual answering-model acceptance is
claimed.

Merged #702 alignment (11 October): the PR merged at 20:31:21 UTC and its
backend/agent/smoke deployment succeeded; live camera/model acceptance is not
inferred from that smoke. Its generic response has `question: null`,
which must be accepted without inventing a question. Bounds are 500 Unicode
code points, not UTF-16 units. Voice capture sends optional `turnId` and checks
its response echo; identifiers allow 1–128 ASCII letters/numbers/underscore/
hyphen. Use actual relay unavailable names `vision_failed` and `timeout`;
the proposed `inspection_failed` is invalid and closes the socket. Validate
relay-originated typed limit feedback and show only the current item's notice.
The 103-test capture/voice/validator alignment suite, scoped lint and TypeScript
pass. Actual answering-model image acceptance is not satisfied by caption
work; see deployed #704/#706 and the live-acceptance boundary below.

The coordinator confirms the final deployed caption contract and migration
0040, with no voice upstream-event or agent-settings failures in deployment
checks. The relay holds camera-on turns for at most twelve seconds, accepts
the matching context/unavailable event and ignores settled-item late results.
Danish hosted voice disables automatic response creation while camera-on.
Relay ordering and legacy hosted-voice gateway translation have offline tests
only, not live-audio verification. Dan's review is still required for UI release.

Voice visual-source interlock: camera-on disables Look at screen with recovery
copy and guards requests before superseding any pending camera turn. Camera
activation/state/stream changes abort legacy inspection; no late failure can
send the uncorrelated unavailable event rejected by the camera-on relay.
Independent watch actions remain unchanged. The voice/client/App subset passes
108 tests (one stale Notes test excluded). Synthetic Chromium checks desktop
and touch/reduced-motion phone menus in both languages, plus long docked
every-turn phone capture, ten-minute idle expiry and visible recovery.

Local camera input evidence matches merged/deployed #704 (e5c83dbc,
11 October 21:46:10 UTC), not verified live image access. The final contract
matches the prepared draft implementation. Chat done has top-level `visualPath`/`visualReason`; history stores
them under the user message's `metadata.visualContext`; voice sends
`jarvis.visual_context { itemId?, visualPath, visualReason? }`. The shared parser
projects only bounded path/reason, stripping metadata, descriptions, handles
and bytes from UI history. Never infer image delivery from `frameId` or local
Live playback. Check missing legacy evidence, malformed-present failure,
image/caption rendering on the user bubble, current-item-only voice toasts
and duplicate/off/switch/reconnect suppression. The phone preview picture must
yield space to controls/limit text when the transcript is open; very constrained
heights permit content scrolling.

The ten-file local camera/conversation/App suite passes 307 tests (the same
two unrelated baselines excluded), TypeScript, scoped lint and production
build pass. Synthetic Chromium verifies desktop image-reported and 320px
touch/reduced-motion phone caption-only chat and both voice languages, with
persisted metadata reload and visible fallback. Image statuses are synthetic,
not live model proof. The coordinator confirms #704 backend/agent/smoke green
and no voice upstream-event or agent-settings failures. The deployed
`/screen/frames` handle is a private 32-character base64url string, memory-only,
single-use, owner/session/turn-bound and valid for at most sixty seconds.
Preserve the public 1–128-character parser bound; never resolve in the browser.
Chat/Danish-text image input is implemented but live model acceptance is
unverified. Deployed #706 (P9-83, closing #705) adds EN/DA realtime image
admission, image-budget accounting and content-free `visual.path` diagnostics;
hosted DA fallback remains caption-only. Actual realtime model image
acceptance is also unverified; #703 stays open until live evidence exists.
Final-shaped synthetic desktop/phone fixtures pass
with handles, correlated voice items, caption-only labels and recovery.
Actual image/audio acceptance and Dan's UI review/release remain required.
For `image_input_unverified`, both chat and voice must say model image support
has not been verified, not that image input is disabled. `legacy_agent` keeps
the disabled-input wording. The shared helper owns this distinction.
The corrected-copy subset passes 114 tests across helper/chat/voice (known
locale baseline excluded), typecheck, scoped lint and build pass. Synthetic
desktop/320px phone checks verify wrapping, restored history and both
voice-language feedback; these are not actual model-image or audio acceptance.

Budget feedback alignment (12 October): #706 is merged/deployed (55ee8e4b,
11 October 22:39:33 UTC); no live camera turn has exercised model image input.
Preserve capture-time typed 429
`budget_exhausted` and release the correlated voice hold with that existing
#702 reason. Do not substitute cached caption/handle success for a budget
denial. Incoming exhausted/unavailable-budget notices are current-item-only,
visible and never echoed; final `budget_unavailable` is relay-to-client only.
Four affected files pass 128 tests; types,
scoped lint and build pass. Synthetic desktop/phone verify both voice-language
budget notices, wrapping, no extra events and recovery. The fixture now awaits
the actual latest-history Retry response rather than assuming a hidden error
means the request finished. Live image/audio acceptance and UI release remain
blocked.

Deployed #706 requires no further local protocol change. The final diff
matches the prepared implementation; only PLAN baseline changes differ.
The combined ten-file camera/conversation/App suite passes 320 tests with
the same two known unrelated baselines excluded. Synthetic 1440x1000
dark/normal-motion desktop and 320x700 light/touch/reduced-motion phone
exercise image-reported chat/history and both voice languages, with fallback
when there is no fresh handle. These are intercepted image-status fixtures,
not actual image/model/audio evidence. Backend diagnostics are
`visual.path { path, reason, channel, latencyMs }`, without content or IDs;
the coordinator will inspect the first live turn. No UI release before Dan
reviews, and no live uploads are authorised by a deployment notification.

Final-contract compatibility rerun: all ten camera/conversation/App test files
pass with 310 tests and the same two known unrelated baselines excluded.
Two worker-start timeouts in the initial concurrent run cleared on retry,
including the complete suite. The rerun changes no runtime code or dependency
versions; prior types/build/scoped-lint results still apply.

Visual evidence recovery follow-through: latest history refresh and older-page
failures must have separate Retry ownership. Existing messages are not proof
that the failed request was an older page. Reproduced no-op/wrong-cursor retry
and added latest-null-cursor, latest-existing-cursor and older-cursor
regressions. The history/transport subset passes 79 tests (known locale
baseline excluded), types/build/scoped lint pass. Synthetic Chromium desktop
normal motion and 320px touch/reduced-motion phone exercise malformed metadata,
working Retry, restored evidence and stale/duplicate/uncorrelated voice results.

The activated camera/screen/App suite passes 243 tests across ten files, with
two observed unrelated baselines excluded: the en-DK decimal expectation and
an App Notes-navigation test still expecting the removed Start writing button.
The App voice fixture now includes camera state/unavailable methods and checks
real App camera-on/off state synchronisation. Scoped
lint, TypeScript and web build pass. Synthetic Chromium covers arbitrary chat
follow-ups, fresh/fallback payloads, docked limit feedback, off, and both voice
languages at 1440x1000 desktop dark/normal motion and 320x700 touch phone
light/reduced motion. Test-only browser routing substitutes
auth/API/audio/camera boundaries; it does not send
real frames. Backend single-response ordering and actual image delivery remain
deployment acceptance, not facts established by these fixtures.

Camera conversation follow-through (11 October, local): ten-minute idle
shutdown replaces the fixed five-minute camera cutoff. Chat submission,
speech start and final voice turns reset the timer; dock does not. Test a
conversation longer than ten minutes, idle expiry from a docked tab, visible
phone recovery, retry and explicit-stop cleanup with synthetic media/clock.
The earlier activation block on #701/#702 is superseded by the successful
deployment and local activation above. The normal local app now uses every-turn
capture; it is not a shipped UI release, verified live voice call or actual
answering-model image delivery. Local checks: 39 scoped camera/voice/preview regressions pass across
six files (128 unrelated tests skipped), typecheck and web build pass.
Synthetic Chromium at 1440x1000 dark/normal motion and 320x700 light/reduced
motion verifies long docked conversations, idle-track shutdown, fully visible
explanation/retry, restart and explicit-off timer cleanup. No real uploads or
physical-device acceptance were performed.

Optional question-aware `inspect` preparation is local only; production
callers do not supply its new fourth argument yet. Test exact 500-character
acceptance, 501-character refusal without upload, UTC capture-time validation,
matching question echo, legacy response compatibility and typed-versus-unknown
HTTP 429 errors before wiring #702. Missing legacy timestamps must never be
replaced by a fabricated fresh timestamp. The preparation passes 43
capture/session-command tests, typecheck and web build against synthetic
responses; it has not been exercised against a deployed question-aware API.

Voice protocol preparation exposes `setCameraState` and optional transcription
item IDs on result/unavailable events, with reconnect replay. Current UI
callers do not enable it against production. Synthetic tests for both voice
languages cover camera-on arbitrary/finger follow-ups, rapid correlated
events, on/off changes, reconnect signalling and unchanged legacy payloads.
Before integration, confirm the backend holds one response per item and
ignores a late result after timeout/reflex completion. Use a voice inspection
deadline shorter than the proposed twelve-second hold.
Combined protocol/API preparation passes 59 voice-client, camera-capture and
session-command tests, typecheck and web build. These are synthetic contracts,
not proof of deployed relay ordering or live every-turn camera capture.

The capture parser also prepares preservation of optional opaque `frameId`
for Dan's direct-image requirement. Shared validators and chat/voice send
adapters prepare the proposed 1–128-character `[A-Za-z0-9_-]` ID and bounded
single visualContext shape, excluding unknown fields and image bytes.
Chat refuses both structured and legacy screen context together; new voice
metadata requires an item ID. Final deployed shapes remain pending. No live
caller forwards the reference yet. The proposed sixty-second single-use
handle must be acquired when a queued chat turn executes and supplied before
the correlated voice reply is released. Do not cache/replay consumed handles
as though they were reusable images; retain only labelled prior observations
for fallback. Metadata must distinguish direct-image versus caption paths.
Capture/voice/chat/shared-validator preparation passes 82 tests, scoped lint,
typecheck and web build; all frame-reference results are synthetic. No actual
chat/realtime model image delivery has been verified.

## Release procedure

- Pin external workflow actions to a full commit SHA. Resolve `refs/tags/<release>` through GitHub's Git refs API; if it returns a tag object, dereference that object through the Git tags API until the target is a commit. Use the commit SHA in `uses:` and keep the release tag as a trailing comment. Dependabot updates GitHub Actions pins weekly.
- Every change reaches `main` through a qualified PR merged by the integration
  owner (see [Merge](#merge)). Deploy verifies the exact tested tree and applies
  only incompatible/unproven components; backend migrations still run at startup.
  A manual **Deploy** on `main` uses the same qualification, reuse and supersession
  gates; it is not a force-rebuild escape hatch.
- After the first successful deploy only (P0-16): run `./infra/bootstrap.ps1 -WebRedirectUris 'https://<Static Web App host>/redirect.html'` so sign-in works there (the redirect URI is MSAL's redirect bridge page, L63) (existing URIs are kept), set `backendUrl` in `apps/web/config.json` to the backend URL so `npm run dev` signs in, and set the Actions variable `JARVIS_INFRA_DEPLOYMENT_NAME` to `jarvis-infra` (`gh variable set JARVIS_INFRA_DEPLOYMENT_NAME --body jarvis-infra`). The Deploy run summary lists both URLs.
- No manual infrastructure portal changes.
- **P6-22 coordinator check after merge:** wait for Deploy to finish; verify the backend starts with and without legacy Teams environment variables and Bicep does not provision Teams Bot or separate Speech F0 resources. In the signed-in Now panel, verify an away task update and a browser approval appear while away, Approve runs only the confirmed test action, Reject does not, and an unanswered approval expires after five minutes. If an English browser voice session is active, verify it announces the pending approval and task status. Any leftover Azure resources from prior deployments require separate cleanup authorization.
- Managed-project workflow examples and Azure OIDC adoption steps are in [github-actions-templates.md](github-actions-templates.md). The templates assume npm/Node defaults that adopters must match or customize; no Azure access is available to verify an adopting project's federation or deployment.

## Documentation rules

- English; short bullets, tables, diagrams, and brief supporting text.
- Keep requirements, proposals, evidence, and open questions distinct.
- Keep stable decision (#) and learning (L#) numbers; add new ones at the end of [decisions.md](decisions.md).
- When a status, decision, or learning changes, update the matching boxes in [architecture-flows.html](architecture-flows.html) in the same change.
- Prototype reports keep only run instructions and raw evidence; decisions and learnings belong in [decisions.md](decisions.md).

## Runner setup and release

Factory finalization correction (14-15 October; local): the focused regression is
`python -m pytest -q tests/test_task_finalization.py` from `runner/`, using its
isolated environment. It covers delayed/failed provider teardown, event delivery
and publisher close, late pause/cancellation, and an appended event-chain tail.
It also exercises actual cancel-handler disconnects, repeated worker cancellation,
late stop deadlines, delayed ACP-cancel acknowledgements and forced termination.
The 39 cases use real temporary Git commits and child processes, with simulated
metadata/provider/event boundaries; they are not live E2E or POSIX-permission
proof. The full runner suite and packaged images still require normal Linux CI.
The Windows snapshot uses Python 3.12.10, pinned pytest 9.1.1/Ruff 0.16.10 and
existing system colorama 0.4.6; it does not establish the pinned Python 3.12.14
Linux result. Backend Vitest was unavailable after package-proxy 404 and normal
canonical-registry TLS failure; no pins, TLS checks or shared settings changed.
No supported session `/remote` control was available, so remote-enabled state
remains unverified; do not infer it from CLI help or start another CLI.
For this runner change, successful normal Deploy alone is insufficient: the
main-only Runner deploy must publish the exact released runner revision too.

Issue #28 adds the Python runner independently of the npm workspaces. With Python
3.12.14, create `runner/.venv` and install `runner/requirements-dev.txt` with
`python -m pip install --require-hashes -r ...`. Codex cloud validated frozen
installation with `uv pip sync --require-hashes`, `python -m pytest -q` and
`python -m ruff check .` from `runner/`; the local OpenAPI route returned HTTP 200.
Runner CI owns Docker builds and packaged CLI/HTTP checks because agents have no
Docker runtime here. Production Key Vault/Foundry acceptance is still unverified.

P2-11 provider option verification uses `npm ci --prefix runner/tools` and
`runner/tools/node_modules/.bin/copilot --help` (the pinned Copilot CLI reports
`--model` and `--reasoning-effort`). The pinned
`@agentclientprotocol/codex-acp` 2.1.1 README/source exposes `model` and
`reasoning_effort` via ACP `session/set_config_option`; no live provider
credentials are needed for these checks. Runner and Foundry contract tests
exercise the local wire behavior, not authenticated model availability.

P2-12 usage verification uses those pinned package docs and runner contracts.
Offline inspection found that the Codex ACP README advertises token-usage events,
without a confirmed field schema; the Copilot CLI README says each prompt consumes
a premium request, without documenting a per-turn ACP report. Neither establishes
what a live run sends. After merge, run one Codex task and one Copilot task, then
check task detail against each runner event and the provider's actual response;
record which token or premium-request fields, if any, were reported.

The main-only [runner deploy workflow](../.github/workflows/runner-deploy.yml)
requires Actions variable `JARVIS_INFRA_DEPLOYMENT_NAME`, set to `jarvis-infra` after
the first successful Deploy run. It consumes that deployment's existing outputs and bootstrap
Azure variables, queues under `jarvis-production-deploy`, builds the two images
in ACR, deploys both capacity tiers, and records identity-probe evidence. The main
Deploy workflow uses the same group; both set `queue: max` so no queued deploy is dropped. The workflow never seeds secrets;
`jarvis-github`, `jarvis-copilot`, and the Jarvis-only `codex-login` must already be
in Key Vault. P3-02 adds the opt-in App-token path, but the legacy Git-token path
remains available until the post-merge sandbox push check succeeds.
See [runner/README.md](../runner/README.md) for commands and the contract.

P3-02 uses repository Actions variable `JARVIS_GITHUB_APP_ID` to configure the
backend's `GITHUB_APP_ID` setting;
the private key stays in Key Vault as `github-app-private-key` and is read only by
the backend identity. Runner App-token mode is separately controlled by
`JARVIS_GITHUB_APP_TOKEN_ENABLED` (defaults to `false`), so deploying the backend
does not turn off the legacy Git credential path. Set it to `true` only after the
backend deployment and Key Vault setup are confirmed, then dispatch Runner deploy
from `main`. Keep the legacy secret and runner read grant until the live sandbox
push to `DanAakesen/jarvis-test-target` succeeds; remove them in a follow-up.

### Voice feedback and microphone lifecycle (#417)

PR #419 replaces Enable microphone with capture on explicit Start voice. Browser audio preparation and the native permission request happen in that gesture; sending requires the authenticated handshake. Reconnect keeps explicit mute, late permission grants after end are released, and denial/device loss exposes Retry microphone in More. No new secret, setting or backend contract is needed.

Focused web checks cover voice client lifecycle, presentation/status, scene persistence and motion envelopes. Copilot reported fixture browser layout and motion observations; the software-WebGL cadence was about 4 fps, so normal hardware motion quality remains unverified. Live microphone/speaker, English/Danish provider, physical phone and hardware-GPU acceptance remain post-deploy checks.

Reviewer verification against updated main: web lint, all 36 web test files (313 tests), and the production web build pass. Scratch Chromium exercised the real voice client with fake microphone hardware and an intercepted voice handshake: no microphone request before Start voice, one request after it, PCM sending after readiness, Listening below the orb without bar overlap or horizontal overflow at 1440×1000 and 390×844, one mounted canvas, and End voice returning the composer. No page errors occurred. Captures/report: `docs/ui/screenshots/p8-40-review-*`. This is fixture/software-WebGL evidence, not live Azure, real microphone/speaker or hardware-GPU verification.


## Voice UI hotfix browser evidence (#435)

The real app and browser voice client were inspected at 1440×1000 and 390×844 in
Chromium with scratch-only authentication, backend/socket fixtures and fake media
devices. Screen/camera start from More, sharing sends no frame until inspection,
permission denial uses a bottom-right toast, session end stops tracks, and the
composer remains 70 px high after a failure. Status is white with a transparent
background and no glyph; it stays above the bar, with no horizontal overflow or
page/shader errors. Dormant/awake frames show core movement; reduced-motion
Listening remains usable. Web lint, all 318 tests (37 files), and build pass;
build retains the existing large-chunk advisory. Screenshots and the report:
`docs/ui/screenshots/p8-43-{dormant,awake,toast,phone,typing-after-error}.png` and
`p8-43-browser-report.json`. Fixtures do not verify physical capture, live vision/
voice providers, Safari or hardware-GPU motion. No fixture auth is committed.

## Shell and conversation integration (#398)

Revised 12 October local scope supersedes the height-only refinement below:
all four borders and corners resize without visible brackets or a top grip;
Move beside Maximise moves the attached composer. Minimise keeps that composer
in place, as Dan selected. `conversation-layout.ts` validates browser-local
geometry/reference canvas dimensions and reports storage failures; fitting a
smaller viewport never overwrites the saved preference. Reference dimensions
keep preferred pixels stable when narrowing the composer wraps a draft.
The composer remains in its original React tree, avoiding a voice remount.
Initial shell-history loading uses an accessible status, not skeletons at the
top of an empty room. Standalone loading and failure/Retry remain.
Workspace move/resize commands use the saved chat geometry, including while
messages are minimised; snapshots identify the placed chat as manual.

Scrollbar follow-up: side hit regions end at the transcript's outer edge;
corner cutouts exclude the inward quadrant. `chat-scrollbar-*` Chromium
fixtures verify native desktop thumb dragging and phone touch scrolling without
geometry/storage changes, hit testing along the entire scroll track, all eight
resize targets, attached composer, cancellation, keyboard focus and refresh.
The native-scrollbar fixture explicitly removes Chromium's headless
`--hide-scrollbars` flag; phone overlays use touch instead of a fabricated thumb.
The focused styles suite passes 20 tests; typecheck and build pass. Signed-in
canvas hit testing confirms the resize cursor no longer covers the scrollbar.

The final five-file Workspace/layout/history/App/styles run passes 205 tests,
with the existing stale Notes-navigation and locale-format cases excluded.
TypeScript passes. Scoped lint reports only the inherited pin-load effect
`setPinLoadError('')` error; do not call this a clean lint pass. Scratch
`floating-chat-border-*` Chromium artifacts exercise desktop and actual CDP
touch, opening-motion first press/2px drag, every border/corner, header move,
cancellation, keyboard focus, draft continuity, minimise/maximise, reload,
and 520px-high viewport fitting. Desktop also exercises off-home chat.
They use synthetic auth/history and send no model turn or frame upload.
The signed-in local canvas confirms eight invisible border regions, no bracket
SVG or resize grip, 14px message paragraphs and a 16px composer. Physical
devices and Safari remain unverified; no commit, backend edit or release.

Local refinement, 12 October: the conversation's top grip resizes only typing
height. Focused Workspace/styles/App tests passed 126 tests with the existing
stale Notes-navigation assertion excluded; final Workspace/styles/stylesheet
checks passed 70 tests. TypeScript and the web production build pass, retaining
the existing large-chunk advisory. Scoped ESLint still reports the inherited
`react-hooks/set-state-in-effect` error at `setPinLoadError('')` in the unrelated
pinned-view loading effect; the new gesture and tests add no lint diagnostics.
Do not describe that run as a clean lint pass.

Scratch Chromium/auth/API fixtures checked desktop dark 1440x1000, light with
reduced motion 1075x940, and actual CDP touch gestures at 390x844 in both motion
modes. They exercise resize bounds and cancellation, keyboard/focus, retained
minimise/maximise height, unsent drafts, off-home docking, and shortened 520px
viewports. The paragraph renders at 14px/20.3px while the composer remains
16px. At a 620px desktop height, five complete synthetic messages fit versus
three at 380px; the longer phone fixture grows from two to four. Counts depend
on content, not a promised universal capacity. Opening/minimising transitions
were observed in motion; size dragging has no height transition. Reports and
captures are session artifacts `chat-height-{desktop,desktop-reduced,phone,
phone-reduced}*`, not product screenshots. No paid turn, frame upload, physical
camera or production setting was used. Physical phones/Safari are unverified;
the local change has not been committed or released.

PR #418 registers the avatar-free conversation history as the shared workspace
view `conversation`; its tabs, geometry, focus, snapshot and Jarvis commands use
the existing controller. The composer and voice client remain outside the window.
The footer is removed and database-waking feedback moves to the top bar.

Final integration preserves #419/#437's voice lifecycle, unframed status,
living orb and portal toasts. Voice/capture failures stay outside the composer;
the conversation overview hides during voice and phone window controls have
44px targets. Web lint, 329 tests and production build passed. Chromium fixtures
at 1440×1000 and 390×844 verified shared minimise/restore, maximise/restore,
close/reopen, draft continuity across voice, capture/inspection, denial feedback,
cleanup and reduced motion. Captures/report: `docs/ui/screenshots/p8-37-integration-*`.
These use scratch authentication/API/socket and fake media, not live providers.
## DailyDeveloperCloud / P12 execution boundary

**Current cleanup direction, 18 October 2026.** The Sites database-export and
bundle-import approach (#717/#721/#982) is withdrawn/not planned. PRs #741/#987
remain closed and unmerged; merged offline P12-22/#968 tooling and dedicated
format/runbook documentation are removed under #1006. Do not restart builders
or treat the cancelled issues as migration prerequisites. #1005 is the
source-contract-first direction for the original Daily API/schema,
corresponding Jarvis API/SQL schema and supported historical ingestion/replay.
This cleanup does not change permanent health upload/processing, SQL migrations,
the source-to-SQL mapping, original Daily or the separate #734 retirement gates.

**Current local exception, 13 October 2026.** Direct human approval supersedes cloud-only execution; use the isolated Jarvis local worktree/branch above and keep both cloud workers idle. #719's inactive SQL design merged in #805, with independent review, full combined-main CI38457298725 and Deploy38456829763/smoke passed. Its external issue closure does not prove live/private/device acceptance. #720 alone is now released for inactive synthetic processing/read models. Migration 0047 was allocated against fetched main; recheck allocation/containment before readiness, rerunning checks when main moves. Neither `index.ts` nor module composition registers a processor, route, flag, scheduler or credential. No Azure access, source edits, real records, secret extraction, new resource/grant, phone change or own merge. The prior PR805-only review-agent approval does not authorize another scope. Historical cloud releases below do not override this boundary.

Run backend lint/build plus permanent health-upload, auth, app, module and schema tests; normal full CI/isolated SQL/container checks remain required. Local `npm ci` encountered a configured mirror 404 and a public-registry TLS handshake failure on the unchanged lockfile: do not disable TLS or change global npm settings to bypass it. Report local checks as blocked unless a supported install succeeds; use normal repository CI, never another project's environment. No local SQL image or production SQL access is approved. Keep source-contract, historical ingestion/replay, credential delivery, live/device and rollback acceptance distinct from synthetic code evidence. No Sites database-export/import or protected-export credential work remains in scope.

### Historical cloud handoffs (superseded release instructions)

Current release is ONLY #727/P12-12 inactive export on `codex/p12-12-nutrition-export` / draft #758; #725 is parked open after merged #754, not active implementation. Use coordinator source comment 6134567097, canonical SQL meals and scoped root device-verifier contract; no production registration/verifier/issuance, credentials/access/resources or phone changes. Run focused export/nutrition/auth/module/migration tests, backend lint/build and exact-head normal full CI/isolated SQL/container smoke. 0044 was allocated against current main; don't allocate another migration without rechecking. No automatic uncertain/failed/out_of_sync requeue, no native exactly-once claim, no private records/source edits/own merge/next scope. Keep #758 draft until explicit coordinator readiness release after independent review. This current release supersedes the historical #725 checkpoint instructions below; post one compact PR handoff and final answer, then idle.

Current #725 continuation: #746 merged at `93553e9`; only the three feed-boundary corrections are released on `codex/p12-10-feed-boundary-corrections` / draft #754. Validate calendar ranges before any refresh/storage/provider/model work; preserve nonempty-number versus delivery-detail order grouping and full validated SENT-label direction before DTO truncation. Synthetic and isolated SQL regressions/full exact-head CI are required. Keep #754 draft until explicit coordinator readiness release after independent review, Refs #725/open issue/native dependencies, default-off and all consent/model/provider/private/device gates. No #727 dispatch or own merge. The following #746 checkpoint record is historical and does not override this continuation gate.

P12-10 (#725) remains sole released scope on `codex/p12-10-google-feeds` / #746. Verified pure source contracts drive resumable bounded Gmail/calendar retrieval, exact selectors/keys, owner-local snapshots/suppressions and independent manual refresh. Coordinator supplied the existing protected Foundry chat-completions boundary: inactive factory reuses configured endpoint, managed-identity callback, canonical chat settings/catalogue and usage accounting; JSON-object transport has strict local schema/source-date checks, no tools/runner relay/new model role. Missing/failed capability reports unavailable. Scan-generation/cancellation and per-source UTF-8/item bounds cannot promote partial results or lose healthy-source success. Existing calendar.events consent does not establish calendarList access (L125); no broader OAuth/resource/secret authorization. Run `npm test --workspace @jarvis/backend -- src/daily/feeds src/google src/core/tool-registry.test.ts src/modules.test.ts src/auth/auth.test.ts`, backend lint/build and exact-head SQL/full CI/container smoke. Real `feeds.integration.test.ts` uses only isolated loopback SQL CI; local SQL image remains forbidden. Coordinator accepted 895b7c3/full CI 38310725882 as a reviewed inactive intermediate implementation. Mark #746 ready after final documentation/exact-head full CI, retain Refs #725 and keep the issue/native dependencies open. CalendarList owner consent, deployed identity/model and Google/provider parity, source-compatible Daily ingestion and physical-device gates remain unverified; no activation or permission change. #717/#721/#982 and #741/#987 are cancelled/not planned; #1005 is the source-contract-first direction. Original Daily remains canonical. Post one final completion/blocker comment and final answer; no own merge/unsupported messaging.

P12-07 (#722) is released after closed/merged/deployed #718, on `codex/p12-07-nutrition-services` / draft #743. It owns nutrition services/typed handlers, synthetic SQL tests and narrow migrations 0042/0043; no registration. Coordinator supplied read-only source HEAD `9e193554c9c8c7c23a788ed3d2b0582580b76c0f`, release-10/Frida-5.5 public DOI/DTO evidence and empty bootstrap/header/cookie/array/numeric shape verification at 16:17:51 UTC. Null/missing provenance remains unavailable. Cloud CONNECT returns HTTP 403; never bypass/borrow sessions. Focused checks: `npm test --workspace @jarvis/backend -- src/daily/nutrition/model.test.ts src/daily/nutrition/store.test.ts src/daily/nutrition/frida.test.ts src/daily/nutrition/handlers.test.ts src/daily/index.test.ts src/daily/store/owner-store.test.ts src/database/migrations.test.ts src/modules.test.ts src/auth/auth.test.ts`, lint/build and exact-head Database/full CI (auth needs loopback permission). Latest coordinator gate keeps draft until final checks/independent review; no own merge. No private Daily tools; the cancelled #717/#721/#982 export/import path is not a prerequisite; #719 remains unreleased. No downstream dispatch.

Standing authorization: continue approved migration through coordinator dependency/gate releases without another generic approval; never independently dispatch blocked tasks or merge your own PR. For future Daily React/rich UI, read product-ui and current DESIGN.md; use current Jarvis canonical styles.css tokens/components/themes/density/motion and phone/workspace patterns, preserve data/capabilities through restyling, and provide actual mobile-first browser acceptance. No separate Daily skin/theme or replacement shell/voice/window manager; generated view theme context uses the existing trusted bridge without widening permissions. This does not expand #718 beyond backend/schema.

P12-02/#717 is cancelled/not planned; its export approach is not resumed.
P12-03/#718 owns `daily/store`, migration `0041_daily_owner_schema.sql` and
synthetic SQL tests. Run `npm test --workspace @jarvis/backend --
src/daily/index.test.ts src/daily/store/owner-store.test.ts src/modules.test.ts
src/auth/auth.test.ts`, backend lint/build, and real
`npm run test:database --workspace @jarvis/backend` using only the documented
loopback SQL fixture or exact-head GitHub Database CI. A local SQL image pull
was forbidden; CI must prove the actual DDL and behavior. No private data,
historical replay or source mutation.

Use the published DailyDeveloperCloud environment, explicitly source `/workspace/.jarvis-tools/activate.sh` before repository commands in every fresh shell, and read environment-owned STARTUP.md/setup-report.md. No automatic BASH_ENV activation. Node 22.23.3/npm 10.9.9/Python 3.12.14; Python components use separate retained .venv environments.

[Approved migration](daily-migration.md) and existing milestone #716–#734 govern Daily work. Dan released only #716 for this worker; later tasks require explicit release, dependencies and claim. Follow one-worker/one-issue/one-PR with small pushed codex/ commits from current main; never merge your own PR. Issue dependencies/worker labels are authoritative; board administration/sync stays with existing Actions/coordinator, no broad token. Coordinate shared contracts/docs/composition, avoid ongoing unrelated runtime work.

P12-01 checks: `npm test --workspace @jarvis/contracts`; `npm test --workspace @jarvis/backend -- src/daily/index.test.ts src/modules.test.ts src/auth/auth.test.ts`; affected workspace lint/build. Never disable test isolation or weaken checks. Tests are synthetic; default-off composition leaves current route/tool/navigation registration unchanged. This issue adds no production activation, SQL schema, import or UI page.

Dan approved P12 on 12 October 2026 and explicitly released only P12-01 for this worker. The later [execution authorization](https://github.com/DanAakesen/jarvis/issues/716#issuecomment-6124634183) supersedes the original backlog-only and extra cutover-approval wording. The source-contract-first API/schema and supported historical ingestion/replay direction is now specified in #1005; the cancelled database-export/bundle-import approach is withdrawn. Original Daily continues ordinary authorized food/health writes and remains running/canonical before any future cutover. This cleanup does not alter its application/source code/schema or records. Any final-delta, cutover or eventual legacy retirement follows its separate reviewed gates; never delete the original repository or data. New secrets/access and unapproved paid resources retain their explicit-confirmation boundaries. This issue performs no cutover or production writes.

No direct Azure access, original Daily checkout/Sites edits, private health/food data/exports or production credentials in coding/public Git. Reuse current login/session/owner and single conversation; no TickTick. Live-provider and physical-iPhone acceptance remain separately verified evidence; main-only release workflows apply.

## P11-03 / #838 execution boundary

Historical task-14 boundary (superseded by the local consolidation hold below):
work stayed on `jarvis/task-14` with backend-owned publication.
Calendar regression tests use fake Google responses only. No actual reservation
or calendar mutation is part of this code task. `calendar_get_pending_change`
requires the verified current Dan message and returns private process-local state.
Related #837 / `origin/jarvis/task-12` owns direct-only Gmail access policy; reuse
its MIME reader rather than implementing a second reader or duplicating PC guards.

Focused validation command: `npm test --workspace @jarvis/backend -- src/google
src/core/capability-instructions.test.ts`. Backend lint/build also apply; changed
agent instructions are covered by the backend contract test. Synthetic HTML
contains booking dates, nested alternatives and invisible padding; no personal
email, live Google call or computer-use session is required. The copied task-12
reader stays at its original path for the eventual related-branch merge.

Extraction checkpoint: 97 tests across six Google/instruction suites pass. The
backend TypeScript build passed; the reader's scoped zero-warning lint passes
following the invisible-character regex correction. Final broader registry/module
checks and full backend lint/build remain next. Python instructions compile; no
Python runtime logic changed and its full test environment is not installed.

Final P11-03 validation (14 October 2026):
- `npm test --workspace @jarvis/backend -- src/google src/core/capability-instructions.test.ts`: 97 passed.
- `npm test --workspace @jarvis/backend -- src/core/tool-registry.test.ts src/core/work-presentation.test.ts src/core/approval.test.ts src/modules.test.ts src/auth/auth.test.ts src/app.test.ts --maxWorkers=2`: the three core suites passed (79 tests), but the sandbox denied the auth fixture's loopback listener (`EPERM`) and four app/module tests timed out during concurrent checks.
- Unchanged suites rerun without extending timeouts: `src/auth/auth.test.ts --maxWorkers=1` with loopback permission, 60 passed; `src/modules.test.ts src/app.test.ts --maxWorkers=1`, 32 passed. Total selected coverage: 268 passing tests after reruns.
- `npm run lint --workspace @jarvis/backend` and `npm run build --workspace @jarvis/backend`: passed on the final code. Agent instruction source compiles; Python ruff/full pytest were not run because that environment is absent. Backend instruction contracts cover both shared and agent guidance; the largest built-in mode prompt is 14,959 code points, under 15,000.
- Final diff/whitespace review passed. No UI, migration, dependency, OAuth or deployment changes. No live mail was read and no calendar mutation was executed. Hosted-model/chat/voice and private-account acceptance remain unverified. The backend opens the PR; this task does not create one.

## Local Google delivery consolidation (14 October 2026)

The coordinator assigned one local outcome covering #837/#838/#839, seeded from
#848/task-14 `2c17c386`, integrating main `81580919`, useful #849/task-15
`2ae8e4f9` hunks and task-12 `bd052c0` direct-only guards. Keep one
`calendar_get_pending_change` catalogue entry. Preserve actual-main smoke/model
behaviour and all unrelated main blobs/generated PLAN cells. That author-only
preparation did not authorise live Google, private bodies, browser credentials,
permissions, model-setting changes or synthetic live approval. The original
frozen `3073B943` patch remains unchanged
and failed independent review. Five source-grounded corrections cover mail
versus calendar approval, observed Chrome/Gmail boundaries, unrelated status
queries, separately requested same-turn computer actions and decoded-empty
plain/HTML provenance with separately labelled snippets.

Targeted re-review rejected frozen `F3BD79DA` for three residuals. Preserve both
patches and their receipts. Current corrections prevent appointment words inside
actual mail reply receipts/read topics from selecting calendar scope, refuse PC
intent found only within mail-query/quoted subjects, and preserve native editor
windows whose filenames contain Gmail. Full unambiguous EN/DA independent
commands still work; real Chrome Gmail and later-action guards still refuse.

Targeted re-review passed those exact three cases but rejected `CEC84A7A` for
suffix-dependent process identification and over-narrow bare-mail command parsing.
Preserve its patch, receipt and immutable evidence directory. Current corrections
use actual structured process/site observations, including suffixless and exact
200-character native titles, missing-identity refusal, late native/confirmed
switches and window/clipboard export checks. Separate native snapshot stores
preserve UIA/visual action IDs; identity-only capture images are discarded, never
sent to a planner/model or audit. Clear topic-bearing EN/DA commands remain
independent, while quoted commands/how-to topics cannot authorise fallback.

Coordinator disposition: the same independent reviewer passed immutable
`3AF653B5` / `139ca8f7` / `05c77007` on the exact two residuals and coupled
compatibility controls. This is a bounded source/synthetic PASS, not full
build, pinned CI, provider/device acceptance or release. The coordinator's
normal integration with accepted `5064afe4` is conflict-free; all runtime/test
blobs must remain identical to this freeze. Existing #848 is the publication
surface; original issues stay open until their actual criteria are met.

Dan then explicitly approved one bounded live acceptance run after review,
normal CI and release: one synthetic Gmail draft, never sent; one calendar
event titled `Jarvis acceptance test`, without attendees or notifications;
readback and cleanup of only those newly created fixtures; and one isolated
Jarvis sandbox delivery job using existing resources and delivery PRs.
The coordinator owns the genuine authenticated owner path. Do not read
personal emails, overwrite existing pending actions, forge approvals or
provenance, scrape credentials, bypass consent, create new resources/access,
run extra jobs or treat synthetic fixtures as live evidence. Record unavailable
owner authentication as a blocker. Original Daily/data, activation, private
migration and physical-phone gates are unchanged.

The coordinator authorised normal owned commits to finish the earlier `81580919`
merge, integrate `51bda5cb`, and now integrate actual main once for these residual
corrections. Main `36d720909d30dc84b9f94b953758312465d9fec2` is integrated locally;
Factory, diagnostics, accepted mobile blobs and generated PLAN cells are unchanged.
The coordinator reports normal Deploy `38629181064` passed Web/deep-link,
backend health and actual smoke at 20:09:21 UTC; backend/infra/hosted-agent
deployment was correctly skipped. This is main evidence, not Google-delivery
release evidence. The historical release failure's cause remains unknown.
No push, PR creation/change, readiness metadata, hosted CI,
provider call or deployment is authorised here. The corrected frozen patch needs
independent review; the coordinator owns subsequent publication and release.
This replacement remains based on already-integrated `36d72090`; do not fetch or
chase later main. The coordinator owns reconciling later accepted main after PASS.

From `agents/jarvis`, run the isolated Python environment's pytest on
`tests/test_calendar_flow.py`, `tests/test_model_client.py`,
`tests/test_jarvis_tools.py`, `tests/test_chat_runtime.py` and
`tests/test_voice_runtime.py`; Ruff checks changed Python sources/tests.
296 tests and changed Ruff pass on Python 3.12.10, not pinned 3.12.14.
Development dependencies were restored with locked hashes in the worktree venv;
Windows-only `colorama==0.4.6` was added locally and `pip check` passes.

Combined Node checks cover `src/google`, instruction/parity, registry, browser,
PC and realtime/relay suites, plus backend lint/types/build. Frozen npm restore
failed on the feed's `ip-address@10.7.4` 404; official-registry TLS also failed.
An approved read-only tooling snapshot was copied into isolated dependencies,
with workspace aliases pointing only to this worktree. Verified portable
Node 22.23.3 x64 runs snapshot Vitest 5.0.2/Vite 8.3.1, not pinned CI versions.
327 tests across twelve runnable suites pass, as does full backend zero-warning
lint. Both automatic-capture variants retain the unchanged 15,000-code-point
built-in-mode headroom check. No parity or confirmation check was removed.

`src/google/tools.test.ts`, `src/tool-parity.test.ts` and
`src/pc-bridge/bridge.test.ts` cannot load because
`@fastify/multipart` is absent; `src/voice/relay.test.ts` cannot load because
`sharp` is absent. Full TypeScript/build validation is blocked by those packages
plus `pdfjs-dist`, `@azure/storage-queue` and `@fastify/rate-limit`, with consequent
request types unresolved. This is not passing CI. Do not stub packages, change
lockfiles, weaken TLS or repeat independent download loops.

The session artifact `google-local-receipt-check.mjs`, run from the worktree with
Node's experimental TypeScript transform, directly executes the actual Google
module, shared registry, pending store and direct-only guards. Synthetic receipts
prove read/stage/status/same-turn refusal/later approval, the exact provider payload
and summary, once-only replay/failure/expiry, and refusal of computer fallback
after incomplete or failed mail reads. This bypasses only missing HTTP-app tooling,
not the actual Google handlers or approval guard; it does not replace blocked
HTTP/relay tests or pinned exact-head CI.

Additional runnable production-boundary fixtures execute the actual registered
PC module with synthetic broker metadata and the actual Google module/registry:
opaque Gmail IDs, real `chrome` identity, guard-before-planner/vision, rechecking
actions and confirmed dispatch, Codex's guarded executor, independent Spotify
after failed/incomplete Gmail, and coexisting mail/calendar stages with mail-only
confirmation. Actual hosted-loop regressions exercise Gmail-only and Gmail-after-
calendar approval plus pending/none unrelated questions. Sixteen new actual EN/DA
relay cases cover pending/completed status isolation and subsequent yes, but are
not locally executed because relay collection is blocked. Do not present them as
passing tests or original live/provider acceptance.

Residual proofs use only synthetic data. `google-residual-handler-check.mjs`
reruns the unchanged original receipt guarantees, produces the actual
`mail_draft_reply` Dentist appointment receipt and confirms only its mail scope
while an older calendar remains staged. `google-residual-hosted-check.py` consumes
that generated receipt/code/confirmation result in the real hosted chat/voice loop:
four pending/none cases pass with model/mail handling and no calendar lookup or
confirmation. These session artifacts do not replace missing HTTP-app tooling.
The 48 calendar fixtures retain the original 34 cases and explicit calendar
mutation/status/repeated-yes controls. Actual registry+PC regressions include
both quoted/topic negatives, clear EN/DA commands, real `vscode` identity with
`gmail-access-policy.ts` title, native action/clipboard/window positives and a
native-to-Chrome Gmail switch refusal.
Fresh proofs run in the new `google-identity-intent-proof-work` session folder;
do not overwrite any prior frozen evidence. New paired registry regressions
cover the three exact EN/DA topic-bearing commands and prior how-to/quoted-subject
negatives. Actual PC module fixtures use fresh independent snapshot IDs to
detect invalidation, suffixless/truncated Chrome titles, missing identity,
before-dispatch/confirmation refusal and native metadata/control positives.

### Published Google delivery: pinned-CI fixture correction

Independent review passed frozen `3AF653B5`; the coordinator integrated its
runtime/test blobs into `f2afaca9` and published existing #848. Normal pinned
CI `38644147405` failed five backend tests (3163 passed, 176/178 files passed).
Both Backend and Web jobs report these same backend failures; Web's 75 frontend
files passed before the root test command also ran backend tests.

Four calendar HTTP fixtures registered `/fixture/calendar-reply` without
`config.jarvisAgent: true`. The unchanged authentication hook correctly denied
their agent identity before the confirmation helper ran. Explicitly opt in
only that test route, retaining verified-current-Dan, later-message, expiry,
cancellation, provider-failure and one-shot assertions. An unmarked-route
negative control asserts 403 with zero handler/provider calls.

The paused-PC fixture enables visual fallback with a one-element UIA tree.
Its first observation is followed by a second identity-only UIA read before
the paused connection refuses `window_capture` without dispatch. Assert the
exact two-read sequence and zero planner/vision calls; retain strict paused
refusal and resumed `open_app` dispatch. A dependency-light actual registry,
connection and synthetic WebSocket broker regression also checks zero
`pc_open`, capture or native-action dispatch while paused.
The corrected twelve-file Node selection passes 328 tests, including that
broker case and all 34 mail-policy controls. Changed-test zero-warning lint
passes; strict types retain exactly the earlier twelve environment errors.
Earlier Python and coupled hosted proof receipts apply to unchanged runtime
blobs and were not rerun for this test-only correction.

These are test-harness corrections, not production authentication or pause
policy changes. Local HTTP execution remains blocked by missing
`@fastify/multipart`; normal corrected-head pinned CI is coordinator-owned
and still required. Do not treat the published failing wave or local fixture
evidence as CI-green, original provider acceptance or release approval.

Installed CLI help supports `copilot --remote`. Observed existing SDK processes
run `--server --stdio --no-auto-update`, without `--remote`; this task neither
relaunches them nor claims in-session `/remote` is enabled. Remote session control
and original hosted-model/realtime speech/private-account acceptance remain
unverified.

## P14-01 web style audit and checks (18 October 2026)

`apps/web/src/styles.css` owns the shared UI tokens and control/surface forms;
route CSS owns composition and consumes those roles. The P14-01 variant
inventory and bounded follow-up are in [`docs/ui-audit.md`](ui-audit.md).
From the repository root, the local web checks are:

- `npm run build --workspace @jarvis/web` (TypeScript check and Vite build)
- `npm run lint --workspace @jarvis/web`
- `npm test --workspace @jarvis/web`

For visible style changes, verify the actual app at 390×844 touch and
1440×900, in light and dark, then exercise focus, pressed, disabled, loading,
empty and recovery states. Use only synthetic data in browser evidence. A
source audit or local test run is not a substitute for rendered acceptance.

The stylesheet geometry ratchet is part of the web tests:
`npm test --workspace @jarvis/web -- --run src/stylesheets.test.tsx`.
It parses every CSS file under `apps/web/src`; new exceptions need an exact
value and a reason in the allow-list.

## P12-29 Health Auto Export implementation (18 October 2026)

The source-to-Jarvis inventory is `docs/reference/daily-v182/source-to-jarvis-matrix.md`; the complete original contract remains under `docs/reference/daily-v182/`. The Health Auto Export API, owner-created credential lifecycle and restart-safe processor reuse the existing backend, SQL pool and owner authentication. `JARVIS_HEALTH_UPLOAD_ENABLED` defaults false in code; the reviewed backend infrastructure explicitly sets it true, with rollback by setting it false and updating the pin test in the same commit. The post-merge deployment succeeded, but endpoint-specific production authentication/processing and current credential status remain unverified. The UI derives the upload endpoint only from configured `backendUrl`; never construct a public URL from forwarded headers or document a guessed live endpoint/token. See `docs/reference/daily-v182/delivery-status.md`.

`docs/daily-health-ingestion/README.md` records the API shape, request/storage/normalization limits, activation and rollback, plus conservative historical batching instructions: preserve complete metric/date groups; cap ingress at 8 MiB; cap normalized output at 10,000 rows/8 MiB; and remain within the 256 MiB/10,000-row per-owner inbox. These are hard limits, not target batch sizes or proof of complete history. Health Auto Export date-range/chunking controls, settings-screen steps and current app behavior are unverified; do not substitute Health Sync. No synthetic test or local configuration is live phone acceptance.

The owner withdrew the old Daily export/import route for #1005. Keep all selected Daily API/schema/tool changes in that issue and PR; do not revive the withdrawn importer or use real records. The full 16-capability set includes nutrition history/analysis/balance, conversational Status, coach profile, meal preference and recovery; fixed renderers, commitments/orders/experiments, meal plans and Apple Health meal write-back stay excluded. Matrix entries distinguish tested local capability from source-path parity. Three grouped registrations currently cover the nine remaining operations; the exact nine-tool naming request is still a mismatch. A private credential handoff can happen only after deployment and owner creation; no real endpoint/token belongs in this repository.

For this boundary, run backend TypeScript/build, focused `daily/health-upload` and `daily/health` tests, `database/migrations.test.ts`, and web tests for `HealthUploadSettings`/Daily overview. The P14-35 pinned-schema inventory is checked with `npm test --workspace @jarvis/backend -- --run src/daily/source-schema.test.ts`; it validates 31 tables/360 source columns against migration-defined target columns and currently classifies 248 exact-name matches, 0 evidence-backed renames, 91 excluded columns, and 21 not-mapped columns. The later-partial replay case is in `src/database/health-processing.integration.test.ts` and requires the existing isolated loopback SQL Server arrangement used by Database CI. Never point SQL integration tests at production. Inspect the Settings panel at desktop and 380 px before claiming visual verification.

## P13-16 chat and voice recall (18 October 2026)

`proactive_recent_items` is part of the hosted tool catalogue only when
`JARVIS_PROACTIVE_ENABLED === true`; this task does not enable the flag. Its
bounded, sensitive result is marked untrusted and reads the same owner-scoped
Proactive item query as the web page. It never marks an item seen.

Focused checks:
`npm test --workspace @jarvis/backend -- --run src/proactive/tools.test.ts src/production-modules.test.ts src/database/proactive-store.test.ts src/proactive/store.test.ts src/core/capability-instructions.test.ts src/tool-parity.test.ts src/voice/realtime.test.ts src/core/settings.test.ts`,
`npm run build --workspace @jarvis/backend`, and
`npm run lint --workspace @jarvis/backend`.


## Mobile corrections validation (#1293; 26 October 2026)

The full frozen install in this executor failed on configured-feed HTTP 403 for
`pkce-challenge@5.0.1`. The existing web/contracts workspaces install successfully
with `npm ci --ignore-scripts --workspace @jarvis/web --workspace @jarvis/contracts
--cache /tmp/jarvis-npm-cache-1293`; no registry, lockfile or package versions change.
This permits normal web Vitest/lint/build and local Vite browser fixtures.
Local Node 24.19.0/npm 11.9.0 is not pinned CI Node 22/npm 10. Full-App synthetic
Chromium capture instructions and explicit limits are in
`docs/ui/screenshots/mobile-corrections-1293/README.md`.
Aggregate CI skips drafts; `pipeline_evidence.py` also rejects a dispatched PR
that remains draft. The parent owns readiness and normal exact-head qualification.

## Preview follow-up validation (#1304; 26 October 2026)

`docs/ui/screenshots/1304/README.md` records actual-App synthetic camera QA,
continuous frame/aspect-change assertions and commands. Controls use existing
chrome glass tokens. Stream replacement retains valid preview geometry and
playback resume refreshes it. No private source image or physical iPhone
acceptance is included. Composer visibility (#1303) remains separately owned.

## iOS Phase 1c

`apps/ios/Packages/JarvisCore` is a pure-Swift SwiftPM package that builds on
Linux. Run `swift build` and `swift test` from that directory. Cloud agent setup
installs Swift 6.2 through the pinned `swift-actions/setup-swift` action.

`JarvisCore` owns the cross-platform HTTP client and the `HTTPTransport`,
`TokenStore` and `AccessTokenProvider` seams. It calls the existing owner-session
and tools routes, sends bearer authorization on every request, asks the provider
to sign in again after a 401, and does not refresh sessions. Only idempotent
requests retry transient failures, with bounded attempts and delay; tool and
session writes are never retried. The Apple implementations remain in the app
target, not this package.

P15-04 adds `SSEParser` and a streaming transport seam whose default adapts
existing `HTTPTransport` fakes. `JarvisChatClient` reuses the authenticated
client for the existing conversation session, turn, active-turn, cancel,
history and multipart attachment routes. Stream events are typed; unknown
event names are retained, server `error` events become typed failures, and
consumer cancellation stops the stream. Reattach retries transient failures
every two seconds for at most 15 minutes using an injectable clock. No backend
route, Apple framework or third-party dependency is added.

P15-09 implements the `HTTPTransport` seam in the app target with
`URLSessionTransport`; request method, URL, headers and body are passed through,
each request receives its configured timeout, and stream cancellation stops
the URLSession task. `KeychainTokenStore` stores the token as a generic password
with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` and synchronization
disabled. `JarvisComposition` reads `JARVIS_API_BASE_URL` from the Info.plist
build setting and accepts the access-token provider as an input; it adds no
production host or sign-in implementation. P15-11 supplies the app's
`URLSessionWebSocketTransport` against the #1391 seam. App-target adapters are
compile-checked by the existing ready-PR Mac job; Linux does not compile Apple
frameworks.

P15-05 adds `JarvisApprovalsClient` and `JarvisWorkspaceClient` on those same
authenticated HTTP and SSE seams. Approvals decode only the pending-confirmation
fields from `GET /now`; each approve/reject `POST` is sent once, and 404 means
the confirmation is no longer available. Workspace events retain unknown
event names, keep only the current server-issued session ID, and reconnect with
a capped injectable backoff without replaying snapshots or commands. Snapshot
registration is flat beside `sessionId`; command acknowledgements validate
reason length locally and constrain the request timeout to the event expiry.
No screen, push, notification code, backend route, Apple framework or
third-party dependency is added.

### Synthetic fixture scenarios (P15-08)

`FixtureTransport` in `JarvisCore` replays HTTP responses and SSE chunks without
opening a network connection. The sample scenarios are bundled only with
`JarvisCoreTests`, under
`apps/ios/Packages/JarvisCore/Tests/JarvisCoreTests/Resources/`. They cover a
completed chat turn, a server error, a dropped stream and reattachment, empty
and cursor-paginated history, a pending confirmation followed by approval, and
listing and running a tool. `JarvisApprovalsClient` uses the existing `/now`
routes through the authenticated HTTP client; no app-specific backend is used.

### Health sheet-only logging checks and screenshots (P15-39 / #1480)

Run `swift test --filter JarvisHealthClientTests` and `swift build` from
`apps/ios/Packages/JarvisCore`, then the Core suite. Run
`PYTHONPATH=.github/scripts python3 -m unittest discover -s .github/scripts/tests -p test_pipeline.py`
from the repository root for sheet-only layout and screenshot cost-guard checks.
Linux can parse SwiftUI syntax but cannot compile Apple frameworks or capture
the simulator.

`--screenshot-health-fixture --screenshot-health-state=track|newlift|empty
--screenshot-health-language=da|en` uses synthetic `FixtureTransport` data only.
The existing ready-PR, one-boot Mac job captures these states in light/dark and
links its artifact beside the approved Health board in the PR comment.
The Mac job has a 30-minute limit for the combined Chat, sidebar, notifications,
Factory, and Health captures, upload, and cleanup; it still boots only once.
Those artifacts and native visual acceptance remain unverified until that job
runs. The board can be inspected locally with Chromium; that is not simulator
evidence.

### Software Factory UI fixture and screenshots (P15-19)

`JarvisFactoryFixtureScenario` in `apps/ios/Jarvis/` supplies the Factory
previews and simulator screenshots through `FixtureTransport`; its project,
board, task, release, event, usage and commit values are synthetic. CI selects
the screen with `--screenshot-factory-fixture`,
`--screenshot-factory-state=<state>` and
`--screenshot-factory-language=da|en`. Supported states are board, needs,
releases, detail, release, steer, newtask, empty, loading, error, offline,
stale, reconnecting and search. Capture all those states in light/dark and both
languages through the existing `ios-ci.yml` simulator boot; do not add a Mac
job, simulator boot or UI-test target.

The app's Factory project menu selects one project at a time. Needs Dan is
limited to that project's board; do not add a cross-project query or fan-out.
The owner's approved Factory concept is not present in the current checked-in
`docs/ios/design/board.html`, so do not claim a visual pixel/frame comparison
against that local copy. Keep the documented difference visible for owner
review.

To add a scenario:

1. Check the existing backend/web route and payload source cited in
   `docs/ios/integration-contract.md`; do not fill in UNVERIFIED details.
2. Write one JSON file in the fixture resource directory for the scenario.
   Include the request method and path for each exchange, with query matching
   when pagination needs it, and the HTTP response or SSE chunks to replay.
3. Use only newly written synthetic text and fake identifiers. Keep chat IDs
   numeric to match the shared backend contract. Mark any required 43-character
   confirmation ID as fake within the value. Do not copy real sessions, names,
   tokens, hosts or identifiers; use only reserved example domains if needed.
4. Add an end-to-end assertion using the real client and `FixtureTransport`,
   including the terminal result and consumed exchanges. Inject a fake
   `ChatClock` for response/chunk delays rather than waiting on wall time.
5. Run `swift build` and `swift test` from
   `apps/ios/Packages/JarvisCore`. The fixture safety tests scan resource files
   for email addresses, bearer-token patterns, unmarked token-shaped IDs and
   non-example hosts. Passing them is not permission to use real conversation
   data, nor evidence of live service or owner acceptance.

The format is `{"version": 1, "interactions": [...]}`. Interactions are ordered
and single-use; a mismatch does not consume the next one. For example:

```json
{
  "version": 1,
  "interactions": [
    {
      "method": "GET",
      "path": "/tools",
      "delayMilliseconds": 10,
      "response": {"statusCode": 200, "body": []}
    }
  ]
}
```

An interaction may include `query` (an exact string-to-string map; omitted means
no query) and `requestBody` (JSON equality, ignoring object key order). Choose
exactly one result: `response` with `statusCode`, optional `headers` and JSON
`body`; `stream` with `statusCode`, optional `headers` and `chunks`; or `failure`
set to `"network"` or `"timedOut"`. Each chunk has `text` containing raw SSE
framing and an optional `delayMilliseconds`. Set stream `drop` to `"network"`
to fail after its chunks; put the reattach response in the next interaction.
Use ordinary response status codes for 401, 429 (with a `Retry-After` header),
and 503. Delays default to zero and are limited to five minutes each; the
request timeout bounds playback.

Load a resource's bytes with `Data(contentsOf:)`, then construct
`FixtureTransport(scenario: data, clock: fakeClock)` and inject it into
`JarvisClient`. `recordedRequests()` retains only method, path and query, never
authorization headers, bodies or origins. Assert `remainingInteractions() == 0`
at the end so an incomplete workflow cannot pass unnoticed.

The SwiftUI app is generated from `apps/ios/project.yml` with XcodeGen 2.46.0.
The aggregate CI selects iOS for `apps/ios/` and shared inputs. Its Linux job
builds/tests the core and validates project, plist and entitlement metadata;
the macOS job builds for the generic iOS Simulator only after Linux passes, and
only for a ready pull request. Manual dispatch runs the Linux checks without
starting a Mac build. The Mac job uses Xcode 26.6 and
`CODE_SIGNING_ALLOWED=NO`, boots an available iPhone simulator, launches the app,
and captures the Chat screen in light and dark appearance plus the open sidebar
in light and dark appearance. It also captures the anchored plus menu using
`--screenshot-chat-plus-menu`. Chat captures use `--screenshot-chat-fixture` to
select clearly marked synthetic data without a backend; sidebar captures also use
`--screenshot-sidebar-open` to initialize the real navigation shell in its open
state. It uploads those PNGs as a 14-day workflow artifact and posts or updates
one pull request comment with the artifact link. GitHub comments cannot display
files directly from workflow artifacts, so the images are not inline previews;
open the artifact to view them. This job does not sign, use secrets, or upload
to TestFlight.

P15-38 adds light/dark Chat, Voice, Notifications (the existing Needs you sheet),
Factory, Settings, Notes, Health and sidebar comparisons in the same simulator
boot. Extract the artifact and open `comparisons.html`; each simulator PNG sits
beside an interactive copy of the checked-in board. The optional board web-orb
renderer requires network access. `--screenshot-screen=voice|notifications|settings|notes|health`
only selects synthetic screen states when an existing fixture flag is present.
Notes/Health reuse their preview transports and Health's fixed reference date;
Voice fixtures disable automatic session/microphone startup and controls.
Run `swift test --filter JarvisAmbientBackgroundTests` from
`apps/ios/Packages/JarvisCore` for main's shared gate palette/glow positions,
shared-screen and screenshot
source contracts. These do not compile SwiftUI or replace native visual checks.
The 1 November main merge preserves Chat's plus-menu capture and current
Chat/Sidebar/Voice behaviour; `jarvisAmbientBackground()` now uses main's existing
`JarvisScreenBackground`, as does the gate wrapper. No second renderer is retained.

For P15-29 / #1459, the same boot also captures `notifications-light.png` and
`notifications-dark.png` using `--screenshot-chat-fixture
--screenshot-notifications-open`. Compare the Chat bell and the sheet's Done
button; both use the shared plain toolbar-label style, without an extra glass
fill. Linux checks cannot verify the rendered toolbar. The #1448 artifact
([run 41241917037](https://github.com/DanAakesen/jarvis/actions/runs/41241917037))
has no open-sheet baseline; its light Chat capture is obscured by the gate.
Usable before/after simulator comparison remains pending; do not treat that
capture as visual acceptance.

P15-43 keeps the Chat Voice language control on the stone secondary accent and
insets the plus-menu content by 16 points. Empty Background activity retains the
no-activity icon and text without empty category or Away-off rows; the composer
Now bar is omitted until a turn or feed activity exists. The same Simulator boot
captures `background-activity-empty-{light,dark}.png` and
`background-activity-active-{light,dark}.png` in the existing artifact using
`--screenshot-activity-state=empty|active`. These synthetic captures do not
replace physical-iPhone visual acceptance.

P15-13 replaces the blank root with the navigation shell. `JarvisNavigationState`
and `JarvisDestination` in `JarvisCore` own the route stack and sidebar state;
SwiftUI binds them to a native `NavigationStack`. Chat is the root screen; Voice
and Notes are native screens; Settings is the native grouped-list area described
below. Other enabled destinations remain title-only pages. Banking remains
disabled and labeled Later. The fixed-behind sidebar opens through a right-side
drag or the localized VoiceOver action; its shared styling and gesture tokens
are in `JarvisSidebar.swift`.
P15-28 returns ended voice sessions to Chat, including when minimized, and resets
sidebar progress. Focused `JarvisCoreTests` cover the cleared stack, reopened
sidebar navigation and unchanged navigation for other voice states. SwiftUI
rendering and real-device voice-end interaction require Apple-target verification.

P15-10 implements the Chat screen in `JarvisChatScreen`; `JarvisChatModel` owns
screen state and calls the existing chat, Now-feed, approvals and workspace
clients. The Now bar and Needs you sheet use existing `/now` snapshot, activity
dismissal, confirmation and event routes. Final history supplies persisted tool
outcomes; reattachment prefers the active turn for the latest displayed session,
then falls back to the first server-ordered turn; the active-turn lookup repeats
when the Now stream reconnects. `ChatHistoryPagingState` preserves the oldest
loaded cursor across refreshes of the latest page. The web
limits are five attachments, up to 20 MB for documents and
10 MB for images. Local camera/photo data is uploaded only on send. Synthetic
fixtures are selected only in previews and screenshot mode. The app has no
native Entra sign-in provider, so its unavailable provider fails closed without
an existing Keychain session. ReplayKit remains disabled until its Broadcast
Upload Extension and Stop lifecycle exist. Fixture mode supports one sample
text turn; attachment uploads and feed writes are disabled rather than faked.
There is no backend route specific to iOS. Run `swift build` and `swift test` from
`apps/ios/Packages/JarvisCore` for Linux validation; the Mac job is the only
SwiftUI compile check.

P15-12 mounts the Notes area at the existing Notes destination. `JarvisNotesClient`
reuses the shared routes in section 11 of `docs/ios/integration-contract.md`.
The app-owned language preference selects the complete Notes localization catalog
and date locale; do not derive it from `GET /settings` or voice language. Keep the
web/backend source files there authoritative and do not add iOS routes.
Synthetic note/task/graph fixture scenarios and Linux tests live in
`JarvisCoreTests`. The SwiftUI area provides Notes, Tasks, List and Graph tabs,
creation sheets, conditional note saves and conflict recovery. It depends on an
existing stored owner session: no native Entra sign-in provider exists yet, and
the app must show an error instead of using fixture content when sign-in is
unavailable. No standalone folder creation, destructive note/task action,
task-create priority or offline cache is implemented.

P15-20 mounts the approved Settings area at the existing Settings destination.
`JarvisSettingsClient` wraps the shared `JarvisClient`; Settings views reuse only
the routes listed in section 12 of `docs/ios/integration-contract.md`. Pure
validation, target bounds, memory paging/filtering, dirty tracking and account
revocation remain in JarvisCore. The app-owned Danish/English language defaults
to Danish; the shared appearance theme is propagated to the app color scheme.
Remote notifications remain unavailable because APNs support is not implemented;
P15-36 separately adds local approval notifications while active. Health upload
credential creation stays disabled because the backend rejects owner-session
credential creation.
Advanced voice tuning, retrieval thresholds, timeouts and project administration
remain web-only. Use `--screenshot-settings-fixture` to start the screen with a synthetic Settings
response. The existing CI workflow retains one simulator boot and adds one
Lock Screen task/approval fixture capture.

Run `swift build` and `swift test` from `apps/ios/Packages/JarvisCore`. These
checks do not compile SwiftUI. The existing Mac job is the only SwiftUI compile
check and is gated on a ready pull request; keep the single simulator boot and do
not add UI tests. Notes-tab/state screenshots are not produced by CI.

## P15-36 Lock Screen task and approval surfaces

The app's ActivityKit controller follows real running tasks from the existing
`/now` feed and Factory task SSE; WidgetKit renders the shared
`FactoryTaskActivitySurface`. No backend progress fraction exists, so the linear
track is indeterminate. Local approval notifications sync real `/now`
confirmations while active, require device authentication for actions and call
the existing confirmation endpoint. Successful/failed results appear in the Now
activity sheet. If notification previews are disabled, the category has no
Approve/Decline actions.

The `--screenshot-lockscreen-task-fixture` plus
`--screenshot-lockscreen-language=da|en` launch arguments render synthetic
visual content only. CI captures this shared SwiftUI composition in light/dark
and Danish/English in the existing single simulator boot; it does not prove the
system Lock Screen or notification action behavior. The Linux checks are
`swift build` and `swift test` from `apps/ios/Packages/JarvisCore`, plus the iOS
project/plist metadata checks in `.github/workflows/ios-ci.yml`; only the Mac
job compiles the ActivityKit/WidgetKit targets.

Still required for remote updates: an owner-authorized device-registration route
and storage for APNs/ActivityKit push tokens; a backend APNs sender with a
protected provider key; pushes on confirmation creation, resolution and expiry;
Factory task state/activity updates and terminal ActivityKit updates; stale
notification reconciliation while suspended; and deployed/physical-device
verification. Do not claim remote updates before those pieces exist.

P15-16 adds `JarvisGatePolicy` to pure-Swift `JarvisCore`; its Linux tests cover
cold start, the 60-second background threshold, missing/expired sessions, denied
accounts and locked/unlocked routing. The app target uses MSAL 2.17.0 for the
tenant-specific `access_as_user` scope, `JarvisClient` for the existing
`POST /auth/session` route, and `KeychainTokenStore` for the opaque session token.
Set `JARVIS_ENTRA_CLIENT_ID`, `JARVIS_ENTRA_AUTHORITY_URL`,
`JARVIS_ENTRA_API_SCOPE` and `JARVIS_API_BASE_URL` as app build settings; do not
commit their values. The owner-started TestFlight workflow reads the same values
from the protected `ios-testflight` environment. The app covers its content while
inactive, locks on cold start and after 60 seconds in the background, and uses
LocalAuthentication with the system passcode fallback. Face ID failure, account
denial, sign-in failure and network failure remain distinct states. Interface
copy follows the preferred iOS language, Danish or English. No backend route is
added. The app target needs the Mac build for type-checking; device auth and
MSAL redirect acceptance remain unverified here.

P15-23 bounds MSAL token acquisition with the Core-owned `JarvisSignInRequest`
(120 seconds). Run `swift test --filter JarvisGatePolicyTests` in the same Core
package for timeout, callback failure, cancellation and late-callback recovery.
P15-24 selects the highest eligible visible window, including the gate's hosting
controller, but excludes the privacy-only cover and inactive scenes. The existing
gate window is retained during interactive sign-in. Run
`swift test --filter 'JarvisSignInPresentationTests|JarvisGatePolicyTests'`
for window/controller selection and existing timeout/cancellation recovery.
Linux tests cannot
verify system authentication-sheet presentation, signed TestFlight keychain
grants or the live Entra registration. Build 8's upload workflow succeeded; that
is not evidence of working device sign-in.

P15-06 adds the pure-Swift voice WebSocket protocol and fakeable
`WebSocketTransport` seam to `JarvisCore`. It reuses the web client's English
and Danish `/voice` endpoints and token subprotocols, preserves unknown server
messages, and retries drops at most eight times with an injectable clock.
Audio helpers only convert bounded PCM16 little-endian bytes to and from base64;
audio capture and playback remain outside the package. Upgrade-header
authentication and voice tool/error message shapes remain unverified.

P15-07 adds pure-Swift Codable models and path-specific validation for all
contracted generated-view renderers, actions, and stored HTML artifacts. It does
not render views or add routes. The parity test reads
`packages/contracts/src/index.js`, so keep the full repository checkout when
running `swift test`; it checks renderer/action names and the shared limits.
Pass the web validator's optional trusted Blob host or registered tool names
through `GeneratedViewDecodingContext` on `JSONDecoder.userInfo` when available.
The Swift source status also accepts `running`, matching the runtime guard even
though the TypeScript declaration and JSON schema omit it.

P15-14 adds the native Workspaces list and generated-view sheet in the app target.
Its `JarvisWorkspacesClient` uses only the existing list/open/patch/delete routes;
`WorkspaceRuntime` registers a phone snapshot, applies supported commands from
the existing `/now/events` stream and promptly acknowledges refused or applied
outcomes. Native generated-view previews cover each contracted renderer and
unknown-version fallback with synthetic data; Core fixture tests cover the
existing routes and command acknowledgement. Run `swift build` and `swift test`
from `apps/ios/Packages/JarvisCore`. The app-target SwiftUI files and previews
require the existing Mac compile check; no simulator boot or UI-test job was
added.

The screen follows the checked-in Workspaces frame's fixed-bottom search. Its
app and VoiceOver strings use `JarvisWorkspaceLocalization` resources in Danish
and English, selected by the persisted `JarvisAppLanguage` preference (Danish
default). The shared native gate orb uses dark glass and an orange center with
no orbit/meridian ellipses; the Workspaces frame itself has no orb.

The list renders table, list, detail, text, timeline, chart, task-card, status
and image views. HTML-app, knowledge-graph and code remain unsupported cards,
and supplied HTML is not executed. `JARVIS_WEB_APP_URL` is optional and accepts
only an HTTPS origin; it does not identify a workspace item. The app uses the
existing Keychain session and configured `JARVIS_API_BASE_URL`; no iOS-specific
backend route is added. Active-client choice and command replay after reconnect
remain unverified.

### Local voice Live Activity (P15-34)

`JarvisVoiceActivity` is the embedded WidgetKit extension. The app and extension
compile the same attributes, intents and Danish/English intent metadata from
`apps/ios/Shared`; view copy lives in the `VoiceLiveActivity` Core resources.
The extension reuses `JarvisOrbView` and `JarvisDesignSystem`. No App Group,
push entitlement, push token or backend registration is required. Signed builds
need provisioning for `com.danaakesen.jarvis.voiceactivity`; the existing
owner-started automatic signing workflow is unchanged.

Run `swift test --filter 'VoiceLiveActivityTests|VoiceSessionClientTests'` from
`apps/ios/Packages/JarvisCore`, then the existing build/full package tests.
These cover state projection, localized copy, PCM levels, stale/ended session
controls, command errors and muted capture, not Apple frameworks.
The existing ready-PR Mac job builds the extension and captures six synthetic
Lock Screen states in the same Simulator boot within the 30-minute job deadline.
Expanded notification, Factory and voice captures exceeded the previous 20-minute
limit in run 41259067682 after compilation succeeded; retain all captures and one
boot. The Live Activity states are Danish/English Listening, Speaking and Muted.
`--screenshot-voice-activity-fixture` is Simulator-only and uses
no real microphone, credentials or network. Capture uses Simulator's Lock/Home
keyboard shortcuts, which require macOS UI automation permission. Compare
`voice-lock-listening-en.png` with the included `voice-approved-board.png` in the
PR artifact. P15-35 still requires actual compact, minimal and expanded Island
screenshots beside the board; the current fixture does not capture those states.
Native dispatch and background audio still need locked-device checks: mute/unmute
must gate in-app capture, End must dismiss and stop audio, and old controls must
not affect a replacement session.

### Native voice screen and audio (P15-11)

P15-40 (#1482) adds End → reopen regression coverage. Run `swift test --filter
Voice` in `apps/ios/Packages/JarvisCore` to include both protocol and async
session-client tests (filtering only `VoiceProtocolTests` excludes lifecycle
tests). The existing ready-PR Mac capture now includes six synthetic Voice PNGs:
listening, thinking and speaking in light/dark, with board/surfaces links in its
PR comment and state-specific pairs in `comparisons.html`. `JarvisOrbRenderingTests`
checks transparent blur margins, radial alpha feathering and opacity-only core
animation; this source check does not replace inspecting the captured pixels.
The combined simulator build/capture has a 30-minute job bound: the merged
Factory, ambient and Voice captures exceeded the former 20-minute bound.
Simulator-only `--screenshot-voice-fixture` and
`--screenshot-voice-state=listening|thinking|speaking`, together with the existing
`--screenshot-chat-fixture`, select the rendered Voice screen without starting
microphone capture or a voice transport. These images do not verify live audio.
The Linux runner cannot capture Simulator images or compile Apple UI/audio code;
the requested images and physical End/start acceptance remain pending those checks.

The approved screen lives in `apps/ios/Jarvis/VoiceScreen.swift`; shared visual
values are in `JarvisDesignSystem.swift`, and protocol/frame sharing constants
used by both app and extension are in `apps/ios/Shared/VoiceScreenShareContract.swift`.
`VoiceScreenModel` connects the existing Keychain token, `GET /settings`,
`VoiceSessionClient`, and app-target URLSession/AVFoundation adapters. PCM16
microphone capture and speaker playback use mono 24 kHz; speech-start immediately
stops queued playback. The session can minimize to a persistent shell bar without
ending audio or the screen-share monitor.

After an established socket drops, `VoiceScreenModel` shows the localized
connection-lost surface while `VoiceSessionClient` runs its bounded reconnect
policy. Retry now cancels the current client and starts another session through
the same bounded path; stale callbacks are ignored, and End returns to Chat.
Initial connection failures do not use this surface. Both app-language catalogs
include its title and actions.
The ready-PR Mac job launches the synthetic state with
`--screenshot-voice-connection-lost` and `--screenshot-voice-language=da|en`,
uploads both simulator captures with the existing screenshot artifact, and links
the approved surface page in its PR comment. This fixture does not simulate a
live connection or replace device acceptance.

Camera inspection uses the existing `/screen/frames` handle request; shared
screen inspection uses the existing description request and sends its result on
the same voice socket. The `JarvisBroadcast` ReplayKit extension writes only
bounded JPEG frames and small lifecycle markers into the registered
`group.com.danaakesen.jarvis` container; the host app reads the latest fresh frame
and requests stop through that same container. No backend route or dependency
was added. The Linux metadata check
validates the extension target, its embed relationship, and both App Group
entitlements. The existing ready-PR Mac build is the only Apple compile check;
keep this PR in draft until Linux checks pass.

The current shell has no native sign-in flow. Voice requires an owner-session
token already present in Keychain; with an empty store it displays “Sign in
required” and keeps session controls disabled. Do not invent a backend route or
claim first-install voice acceptance until the separate native sign-in work is
available.

Run `swift build` and `swift test` from
`apps/ios/Packages/JarvisCore`. These checks do not compile SwiftUI, AVFoundation,
ReplayKit or camera code. Physical iPhone checks are still required for
permission recovery, full-duplex audio, immediate barge-in, camera preview/photo,
and starting/stopping screen share. Follow-ups to file separately: background
audio; Bluetooth; audio route changes; call interruption handling; microphone
recovery after device lock; microphone recovery after a phone call; CarPlay;
and Action Button. P15-34 implements local Live Activity support above; actual
background audio remains unverified. The extension App ID and
its App Group provisioning also need the owner's portal check before signed
device testing.

## iOS Phase 1b: owner-started TestFlight upload

`.github/workflows/ios-testflight.yml` is separate from `ci.yml` and runs only
on manual dispatch. The single `macos-26` job uses the `ios-testflight`
environment; the owner must restrict that environment to the `main` branch and
configure `APP_STORE_CONNECT_KEY_P8`, `APP_STORE_CONNECT_KEY_ID`,
`APP_STORE_CONNECT_ISSUER_ID`, `APPLE_TEAM_ID`, `JARVIS_API_BASE_URL`,
`JARVIS_ENTRA_CLIENT_ID`, `JARVIS_ENTRA_AUTHORITY_URL`, and
`JARVIS_ENTRA_API_SCOPE` there before dispatching.
The workflow refuses non-main refs, captures `xcodebuild` output rather than
logging signing identifiers, writes the key with mode 600, and deletes it in
an always-run cleanup step.

P15-26 retains automatic archive/export signing and the existing secrets.
After export (including archive/export failure), an always-run main-only step
uses Ruby's standard OpenSSL/HTTP libraries and the existing API key to list
App Store Connect certificates and revoke only `DEVELOPMENT` and
`IOS_DEVELOPMENT` types. All distribution, Mac-specific and unknown types are
preserved. This deliberately cleans all visible Apple/iOS development
certificates, including ones predating the run or used by another app; their
development profiles may need automatic renewal. No certificate/key identifiers,
JWTs or raw API errors are logged. Listing is paginated and bounded; failure
is reported rather than treated as success. The API key file is deleted even
if certificate cleanup fails. No P12/private-key export or profile secrets are
required. The existing key needs permission to list and revoke certificates;
verify that on the next owner-started run. If the account is already at its
limit, the first archive may fail, but final cleanup can free capacity for the
next run. A hard runner termination may prevent always-run cleanup.

Only the owner starts an upload: **Actions → iOS TestFlight**, select `main`,
then **Run workflow**. A merge or pull request does not upload anything. The
certificate-cleanup API permissions and real cleanup remain unverified; see the
setup checklist
and disabled `xcrun altool --upload-app` fallback in
[`docs/ios/build-plan.md`](ios/build-plan.md). Do not run or dispatch this
workflow while reviewing changes.
