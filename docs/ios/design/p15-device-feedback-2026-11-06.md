# 6 November device-feedback batch

## Owner testing of build 76 — current follow-up

The owner confirmed build 76 is available in TestFlight and reported that checks
1 (cold Voice/unified history), 2 (Home send/camera), 3 (task/reminder workflow) and
5 (Health pull refresh) work. These are owner reports, not additional automated
or exhaustive permission/delivery checks. The compact task list looks good.

The owner rejected the large shimmer travelling over an entire grouped surface,
the generic source label `Tasks` after priority, the full-width backing behind
Notes Search/Plus, and the opaque header/Health dashboard-selector regions. Prepare
one combined correction: subtle highlights confined to placeholder elements;
meaningful source context only in compact rows; floating glass dock controls;
transparent shared headers with structural protection against scrolling overlap.
Keep full source details, safe-area clearance, accessibility and Chat appearance.

Later screenshots add three medium-widget corrections: matching top-left icon/title,
smaller Factory counters and rows, and a balanced Workouts metric grid. Body trend
must show real graphs directly on the dashboard. The new plots preserve the actual
30-day dates, separate units, single-point state, point inspection and records
navigation. The visible Health selector rail also moves to the shared clear glass
surface. Scoped implementation/verification records are in `p15-build76-surfaces.md`,
`p15-widget-feedback.md` and `p15-body-trend-feedback.md`.

Initial surface candidate a5599089 passed CI 42236611082 and CodeQL 42236610687.
Native 42236610739 compiled, then was cancelled as superseded by these additional
owner requests. No native pass is claimed for that source. One combined candidate
will retain the existing 68 cases/app launches with added native chart/widget captures.

This changes the native source and needs one new combined simulator run, actual
resting/scrolled/large-text captures and loading-motion inspection before another
upload. Build 76's passing run does not qualify the new rendering changes. Copilot
diagnostics continue separately; neither line of work replaces the other.

## Final qualification and delivery

PR #1614 merged as `ab464314a25fd45f1f1fcccc44644f636607afca` after final
candidate `7e5ef5355363bce675d2020ea2f369d7079f3973` passed CI 42202162550,
CodeQL 42202162436 and native run 42202162500. All 68 native UI tests passed,
including the three corrected task-board checks. The native job ran from
10:22:27 to 11:25:16 UTC. CI passed 7,361 backend tests (one skipped), 497 Core
tests and Python suites of 380, 1,236 and 249 tests, plus the other selected jobs.

Scheme artifact 13497808767 and screenshots 13497624057 are retained. The
downloaded screenshots SHA-256 matches GitHub's digest:
`e726e36ef125eec4ac033905cb0bc4a8fb88c2fc42b1ef3ff126c7ac483c6bac`.
The final English/dark and Danish/light task groups, confirmed completion/details,
and large-text bottom boundary were inspected. Priority rows are compact, the
full detail title is readable, and the final task clears the search dock.
The corrected app source is identical to eb333e62, whose 16 shared-page captures
were also inspected: Settings, Home, Health, Usage, Status, Proactive and runtime
testing. Selected labels are sharp and normal Danish Settings choices are complete.
Sampled native frames show the selection change and the moving Factory loading
highlight. Hardware haptics and the exact cold-start voice scenario remain device
checks. The runtime chat capture contains the OS first-use keyboard tutorial;
large-text scrolling choices can be partially outside the horizontal viewport.

The merged complete source tree matches the qualified candidate; its app/test tree
is `b9bd418f6d41c1fb9cc35450d1da9711eaf1c81a`. Redundant automatic main Simulator
run 42210648987 was cancelled after that comparison. Scheduled run 42205743865
was also cancelled after proving it repeated the already verified build-75 tree
`cbc38ea1979d6a7d5b82e3bec1482bd04676f1cc`. Neither cancellation replaces a test pass.

Normal Deploy 42210649006 passed infrastructure, backend, hosted agent, web,
deterministic readiness and live conversation acceptance. Release evidence
13499252254 records `accepted: true` for ab464314 and qualification run
42202162550; its downloaded SHA-256 is
`ef6eda8267b7cf4320f74829a6c1f22ae1f9f9a45569de39693c14478a698aeb`.
Acceptance artifact 13500381339 verifies the required chat, identity, capabilities,
GitHub read, jobs, navigation and plain-approval checks. The optional PC bridge
reported down; this is not a claim that every integration was healthy.

Explicit comparison activation run 42212979149 used definition refresh. Its
managed job 127876394689 failed at 11:50:31 UTC with `azure_request_failed`, after
successful OIDC login and manifest retrieval but before `managed_chat_provisioned`
or the response canary. The existing diagnostic does not establish the failing
operation, a permission denial, or whether a write completed. Do not blindly
repeat the mutation. Bounded operation/status/code diagnostics and a GET-only
inspection path were qualified before another apply, as recorded below. Normal live acceptance
and its release-result job still passed; neither substitutes for the failed
comparison job.

TestFlight **build 76 uploaded successfully at 12:14:34 UTC / 13:14:34 Copenhagen**
through unchanged workflow 42215302636 (job 127883700403). Checkout logs confirm
verified source ab464314; the complete job and signing cleanup passed. UI
acceptance and the required normal backend dependency passed before dispatch.
Copilot activation continues separately without an app rebuild. Target metadata
verification controls selection; it does not establish successful inference. This follows the
owner's release authorization and existing partial-delivery cadence. The owner
subsequently confirmed build 76 is visible in TestFlight and began device testing.
Earlier mailbox searches had no processing confirmation; the owner report is the
current availability evidence. Device acceptance is still pending.

Diagnostic PR #1615, candidate bbb60479, passed full CI 42214612550 and CodeQL
42214612464 and merged as 8398f7a7. Its app/test tree is unchanged. Normal Deploy
42215955386 passed infrastructure, backend, hosted agent, web, readiness and live
conversation acceptance. Explicit read-only inspection 42215978680, job
127894869624, printed `managed_chat_inspection_ok` at 12:34:40 UTC: one existing
version, zero current-manifest matches, and the pin on the earlier version. No
comparison mutation, backend activation or inference occurred in that job.

Independent REST/SDK inspection then established a concrete refresh defect:
creating an immutable version requires `POST /agents/{agent_name}/versions`,
with the name in the path, whereas the old refresh used agent creation. PR #1617
corrects only that request and its diagnostic label, retaining initial creation,
ownership/readback checks and uncertain-write recovery. Candidate 43395466 passed
25 focused tests, scoped lint/compilation, CI 42217710063 and CodeQL 42217709998.
It merged as 67f02a58 with an identical source tree and unchanged app/test tree.
Normal Deploy 42219180536 later failed during registry authentication; explicit
activation 42219195236 provisioned successfully but failed its response canary. The API
contract establishes the bug but does not retrospectively identify the operation
behind the earlier opaque error. Live activation remains unverified.

In normal Deploy 42219180536, backend job 127902277829 successfully built and
pushed the image at 13:03:14 UTC. Its next `az acr manifest show-metadata` command
failed at 13:03:18 with the generic AAD/admin-credentials authentication error.
No Container Apps update or Copilot mutation occurred. The already queued manual
run has a fresh OIDC login, reuses successful infrastructure, and retries the
image build/read stage; no separate retry was dispatched.

Azure CLI's registry helper requests a separate audience token and hides its
underlying warning under `--only-show-errors`. A stale federated assertion after
the long build/queue is plausible, but the generic error does not prove expiry.
A bounded workflow correction merged through #1618 as 5cf9eb5b after CI
42223501315 and CodeQL 42223501346 passed: refresh the same pinned OIDC login
after each backend/agent build and before digest lookup. It adds no role,
password/admin fallback or write-retry loop. Normal Deploy 42225249865 passed.
Both new login/digest boundaries succeeded live: backend at 13:31:13–19 UTC and
hosted agent at 13:34:01–06 UTC. Readiness and normal conversation acceptance
also passed. This verifies the revised workflow, not the original failure's cause.

The already queued activation 42219195236 passed backend, hosted agent, web,
readiness and normal conversation acceptance. Comparison job 127913011998 printed
`managed_chat_provisioned` at 13:17:00 UTC, confirming the corrected version route
and verified target configuration. Its live canary then failed at 13:17:58 with
HTTP 400, `invalid_payload`, parameter `instructions`, at `response_start`.
The target remains configured: metadata/settings availability can be selectable
while actual inference fails. The successful release-result job does not override
this failed comparison check.

PR #1619, candidate 0043c403, moves the full trusted per-turn policy to supported
developer input instead of the rejected top-level override. It preserves original
user/tool roles, sends fresh policy on each application turn/change and avoids
identical repeats within that turn. Claims, history cursors and the strong canary
remain intact. All 78 focused tests, scoped lint/compilation, CI 42225996401 and
CodeQL 42225996097 passed. The candidate merged as cac5d05d with an identical
source tree and unchanged app/test tree. Normal Deploy 42227486613 passed hosted
agent deployment, readiness and normal conversation acceptance. Explicit comparison
42227506332 reused the existing version with definition refresh false and printed
`managed_chat_provisioned` at 13:48:33 UTC. Its response canary then failed at
13:49:08 with HTTP 400, `invalid_request`, no parameter and `BadRequestError` at
`response_start`. No actual model or reasoning effort was reported. Normal acceptance
and the release-result job passed, but the overall comparison run failed.

The second response does not establish that developer input, policy length or the
configured model is unsupported. Current published limits and the request contract
do not identify a further concrete incompatibility. Next: retain allowlisted nested
provider diagnostics and run a separate, explicitly selected diagnostic with fixed
synthetic request shapes on the already configured target. Each shape owns and cleans
up its new conversation, executes no tools and never counts as runtime acceptance.
The full production-policy canary remains required before claiming Copilot inference
works. Owner-authenticated conversation parity remains a separate check.

PR #1620 adds that diagnostic operation and a default-off workflow path. Candidate
cd06bda0 passed 306 focused checks plus 12 final diagnostic checks, scoped lint,
compilation, shell syntax and parsed workflow guards. Tests cover exact payloads,
target changes, timeout/cancellation cleanup, total budgets, skipped setup failures,
no configuration mutation, and malformed/private output. CodeQL 42231326544 passed;
CI 42231326592 passed. It merged as 2b58f2f2999adc425ded22a31f5baf1b0d44e11a;
the GitHub commit tree matches the qualified candidate's complete source tree,
ad9a2e20da0b1212bde9e2b2c0ac38c27b308994. Its app/test tree remains unchanged.
Normal Deploy 42232951549 passed all components, readiness and live normal-chat
acceptance. The fixed diagnostic is deployed but has not been invoked. Run one explicit
`diagnose_managed_chat=true` invocation; leave provisioning, inspection and definition
refresh false. The local GitHub CLI credential expired after merge; the connector
still supports repository work and result inspection, but not workflow dispatch.
The CLI device login expired without completion; the owner was told that its code
is no longer valid. Connected repository tools still allow the UI qualification.

## Combined visual correction candidate

PR #1621 publishes a559908925f4c88b743230cdbe6fe29c53954931 on main 2b58f2f2.
Its complete tree e16cbd3c9fd1e8794cb1e6415af563871506182c matches the locally
computed merge of the qualified runtime source and UI edits. Its app/test tree is
8d63ef96c2637e3acc1ffaa8ed92d3f1cf5e819c. The connected Git data tools published
the exact reviewed content while local CLI authentication was unavailable.

The patch confines shimmer to individual text placeholders, restores transparent
structural headers and floating Notes/Health docks, filters exact generic task
source labels, and adds localized full source details. The previous detail view
did not show that provenance; it is newly exposed here, not merely retained.
Chat appearance and backend behavior remain unchanged. See
[surface correction evidence](p15-build76-surfaces.md) for Apple references,
scope and remaining visual hypotheses.

CodeQL 42236610687 passed. CI 42236611082 and the single native run 42236610739
are running; the iPhone app compiled and the native job is testing/capturing.
The existing 68 tests and launches remain. Approximately 21 captures and one
Health AX navigation were added within them. The overall job allowance is 75
minutes after the previous 62m49s run; individual test limits remain 120/150
seconds. Compilation does not establish visual acceptance; inspect the actual
normal/scrolled/AX headers and docks plus light/dark motion before another upload.

## Release authorization

The owner explicitly lifted the hold after his final loading-animation feedback:
build everything and release after checks and UI inspection. The earlier hold
while testing build 75 is historical. PR #1614 contains the accumulated corrections
and the subsequently requested web/iOS runtime tester. Opening the draft PR automatically
started CI just before the hold. CI 42169223014, Simulator 42169222922 and CodeQL
42169222883 were cancelled. None verifies the held changes.

## Accepted corrections

- Notes → Tasks: match the owner's board screenshot with inset rounded groups,
  heading counts, quiet completion controls, concise metadata and trailing dates.
  Preserve full titles in details and accessibility sizes; render inline Markdown
  for display only, including Home task titles. Keep native swipe completion.
- Segmented bars, date ranges, scrolling alternatives and matching filter chips:
  common glass selection/press behavior, shared 16-point horizontal/10-point
  vertical label padding and reachable overflow. These values live in the existing
  control tokens, not per-screen copies. Respect reduced motion/transparency.
- Section headlines: primary foreground, white in dark mode and dark in light mode.
- Health: remove the manual sync button and repeated last-sync status. Pulling down
  on Health or Home reads/uploads Apple Health, then reloads relevant server/device
  data. Concurrent sync requests share one operation. Partial/failed refresh and
  stale data remain visible; complete refresh adds no persistent status block.
- Reminders: the advertised `once` cadence was refused on create, and date-time
  validation required one exact UTC spelling. Accept once and normalize equivalent
  zoned ISO instants. Advertise each operation's fields and preserve owner intent,
  open-task checks, quiet hours and duplicate-write protection.
- General tools: named `list_capabilities` lookup exposes the exact registered
  input schema. Voice discovery retains that schema instead of flattening it in
  result data. Strict voice validation now uses the same tool-specific guidance
  as HTTP; generic hints include schema constraints and relevant nested paths.
- One conversation: Chat no longer discards voice rows or restricts refresh to one
  chat transport session. Completed voice transcripts notify readers after storage.
  Typed replies still use chat transport IDs; no second visible conversation.
- Home send/camera: bind the pending action across navigation. Send once Chat's
  initialization/recovery finishes; camera opens without waiting for history.
  Replace the previous bounded polling/early-consumption path.
- Voice startup: activate the audio session before building the graph and require
  actual PCM frames before showing microphone readiness. Initial capture stalls,
  stream termination and audio-send errors enter the existing retry flow. This
  fixes confirmed gaps, but the exact reported first-launch failure has not been
  reproduced on an iPhone here.

## Verification remaining after OK

Review the full accumulated diff, compile it once through the existing CI/native
job, inspect bilingual light/dark and large-text captures against the supplied
board, and inspect selector motion with rapid presses and Reduce Motion. Existing
new task tests cover long titles, Markdown, confirmed completion, detail content
and bottom search clearance. Exercise pull-to-refresh success/failure and confirm
HealthKit refresh on a device; synthetic UI fixtures cannot establish real device
permissions, source parity or tactile feel. Preserve Chat's appearance and signing
configuration; later owner reports explicitly authorize its functional fixes.

The existing Today suite now requires an actual returned reply after Home send
and a visible shutter after Home Camera. The ChatComposer suite adds mixed voice/
chat history and a subsequent typed reply on the correct transport session. Run
these with the single normal native job after OK. Device checks must include a
fresh launch directly into Voice, initial permission approval, first audio and
reply, mute/unmute, leaving/reopening Voice, and a later voice session appearing in
the same Chat timeline. Also check denied permission/capture recovery, delayed
Chat loading and camera permission denial without losing the draft.

## Local verification before the release hold was lifted

- Six backend suites: tool arguments, owner reminders, realtime, startup, relay
  and repository tools — 373 tests passed. Command: `node node_modules/vitest/vitest.mjs
  run apps/backend/src/core/tool-arguments.test.ts
  apps/backend/src/proactive/owner-reminder-tools.test.ts
  apps/backend/src/voice/realtime.test.ts apps/backend/src/voice/startup.test.ts
  apps/backend/src/voice/relay.test.ts apps/backend/src/factory/repository-tools.test.ts
  --no-cache` (as one shell command).
- Final shared-schema review retained common root fields when selecting a union
  branch and added its regression: tool-arguments/realtime passed 101 tests.
- Capability instructions passed 18 tests. Discovery guidance was condensed to
  preserve the existing 15,000-code-point headroom budget in every presence mode;
  no limit or assertion was relaxed.
- `npm -w apps/backend run build`, ESLint on changed backend files and
  `git diff --check` passed. Tests use synthetic stores/transports, not live writes.
- No Swift compiler is available here. Native compilation, simulator checks,
  screenshots and hardware acceptance remain unverified. No CI, push or release
  was started for this held batch.


## Final approved additions

Shared page skeletons shimmer while loading; inline dots stop in the background
and both honor Reduce Motion. One existing native run retains motion evidence.
Shared identity revision 2 includes approval-bound self-improvement for both bugs/features
and attentive Personal/Work task context. Own-code issue/start tools stage proposals;
create_task cannot bypass them. Task tools default high priority, bind creation
retries to the owner request, and preserve explicit at-time reminders through the
vault/Azure discovery and delivery pipeline. Legacy reminders keep their lead time.

Local workflow checks: eight suites / 247 tests passed; backend TypeScript and
scoped ESLint passed. Final bypass-guard checks, CI, native review and deployment
are pending and will be recorded with exact runs here before upload.

## First candidate qualification

Candidate 3ce5d6d9: CI 42178648577 passed backend (325 suites), agent image,
Python, web, database, Foundry and other component checks. Core ran 493 tests with
two ambient-source guard failures: a system background in the selector's Reduce
Transparency fallback and raw Notes lists outside the shared layer. Both are
corrected by using the existing glassSolid token and extending JarvisList for
rows with their own grouped backgrounds; no guard was weakened. Native run
42178648500 compiled successfully but was stopped as superseded before acceptance.
Its duplicate queued run 42178649078 was cancelled without a second build.
The corrected candidate needs fresh CI/native qualification.

## Corrected candidate qualification

Candidate 4c9f62f4 passed general CI 42179796923, including all 493 Core tests
and 7,361 backend tests (one skipped). CodeQL analysis 42179796639 completed,
but its security gate identified a reflected-request response in the reminder
schema test. The test now captures parsed input locally and returns a fixed
acknowledgement, preserving the schema/no-field-stripping assertions. Its 12
focused tests and scoped ESLint pass. The security gate must pass on the final
commit before merge.

Native run 42179796750 compiled and completed 67 tests: 66 passed. Usage error
recovery failed because changing its period temporarily unmounted the recovery
selector. Keep that selector mounted after the first response, including while
retrying; initial loading still shows only its skeleton. The existing assertion
is retained, with selected-state and before/after capture coverage added. Chat,
Home, task-board and shimmer tests passed in this run. The job reached its overall
45-minute limit while finalizing the result bundle, and artifact export failed;
no screenshots from that run were available for visual acceptance. Increase the
job limit to 65 minutes to accommodate build/boot, the unchanged full suite,
result finalization and capture. Per-test limits and assertions are unchanged.

The owner subsequently requested web/iOS runtime testing. That implementation
and the recovery fix require a fresh combined native run; the test-only CodeQL
correction itself did not require a second simulator.

## Combined runtime candidate

Candidate 7dba227a passed all 68 UI tests in native run 42185446322, including
runtime isolation, mixed voice/chat history, Home send/camera and Usage recovery.
General CI 42185446432 passed backend (7,361 tests,
one skipped), Core (497 tests), web, agent, database and contract jobs. Its Python
job found the workflow guard still requiring the former literal 45-minute native
budget. The correction asserts the parsed 65-minute job cap and explicitly retains
both per-test time limits; final CI must qualify that change. CodeQL analysis
42185446195 and its aggregate security gate passed.

The stronger managed-runtime canary shares the real request builder and complete
chat policy, and activation requires its success marker. Its local qualification
passed 446 agent tests and 13 handoff tests. These backend/deployment-only changes
leave the native app/test tree unchanged. Retain and inspect the running native
evidence before pushing the final candidate, then cancel only redundant native
runs after proving app/test-tree equality. A green general deployment receipt
does not include the separately dispatched comparison job: that job and its
`managed_chat_comparison_canary_ok` result must also pass before claiming activation.

## Visual acceptance corrections after the 68-test pass

Retained artifacts: scheme 13489694193 and screenshots 13489594776. Downloaded
screenshots SHA-256 `a34a750b8f9766fc2c098c7f0541a64bafb8414993b3bf1aa70e0170d92f513b`
matches GitHub's digest. Actual task, Home, Usage and component captures plus 21
runtime/Settings/Health captures were inspected, including English dark, Danish
light and accessibility text. Sampled frames of the 3.4-second Factory recording
show the loading highlight travelling across the placeholder; tactile feel is
not established. The runtime transcript capture contains Apple's first-use
keyboard tutorial, so it does not establish the normal keyboard appearance.

The passing functional tests did not establish visual acceptance. Selected labels
were refracted by the detached glass background; priority task rows were much too
tall and hid their priority words; Danish Settings tabs truncated at normal text
size. The correction applies glass to the label-bearing view, uses a quiet material
rail, and falls back to scrolling when complete labels do not fit. Task metadata
uses explicit icon/text and natural vertical sizing; completion glyphs stay inside
their 44-point targets at accessibility sizes. The existing board tests now also
bound regular-size row height. Preserve the earlier results as evidence of these
findings; this actual native source change requires a fresh run and screenshot
inspection before release, not reuse of the 7dba227a app tree.

## Corrected rendering candidate eb333e62

General CI 42193478117 and CodeQL 42193477928 passed. Results include 7,361
backend tests (one skipped), 497 Core tests and Python suites of 380, 1,236 and
249 tests. Native run 42193478110 compiled and passed 65/68 UI tests. Retained
scheme artifact 13494420611 and screenshots artifact 13494326334 remain available;
the downloaded screenshots digest matches
`431150a08456e4b0cb4659f74053cc1d361aa99cbd278ff8264528d7ecb275d9`.
Fresh actual task captures show equal compact priority-row height, visible priority
words and sharp selected labels. The owner's roadmap-row feedback refers to the
earlier inflated-row capture; this fresh capture confirms that correction.

Three failures are in test positioning/measurement. AX returned
43.99999999999994 for a 44-point target. The comparison now allows at most one
millionth of a point of arithmetic error. Both normal-size completion checks
failed after the groups screenshot: the retained hierarchy places the control at
y=52–96, behind the fixed header at y=70–118, despite reporting the row hittable.
The test now re-resolves and reveals the full completion control between the
header and dock before tapping. The actual completion, disappearance, next-row
availability and full-title detail assertions remain. These test-only corrections
do not change app rendering; their fresh native run is required before release.

## 15:03 UTC — Fixed-input Copilot diagnostic

Normal Deploy 42232951549 passed all selected application/readiness/acceptance jobs
for merged #1620 / main 2b58f2f2. Explicit diagnostic 42239012647 completed without
configuration mutation. Plain text and simple user messages returned the expected
gpt-6.1-terra/high. Typed developer-message and complete managed-policy requests
failed at response_start with HTTP 400 invalid_request/BadRequestError, no field hint.
The diagnostic's success conclusion means the matrix finished, not that Copilot
passed acceptance. Because role and encoding both differ, PR #1622 adds fixed typed
user, simple developer, typed system and simple system controls before changing
production policy encoding. Full-policy acceptance remains required.

Default workspace GitHub access was restored; no new login is pending. The earlier
private CLI credential/device code expired and must not be reused.

## Combined native candidate b7e22951

PR #1621 now contains the complete owner feedback through Body trend and widgets.
Source `b7e22951e1dea5faaee07ffc81068c75246aa7aa`, full tree
`05ab4bb27be6c4b20ff2f26cfd304ecfab31fa93`, app/test tree
`0c1105c286d17b01ef632eb7cc7b3e76b95136e9`. General CI 42241800531,
CodeQL 42241800485 and the sole native qualification 42241800577 started on this
source. No pass, visual acceptance or next TestFlight upload is claimed yet.

## 15:21 UTC — Corrected chart conversion and next diagnostic

Both Core and native build for b7e22951 failed before simulator boot because Swift
could not type-check the chained body-trend conversion. The corrected 0f93aa09
uses an explicit typed loop, separate guards and sorting, preserving behavior and
assertions. Fresh runs: CI 42242238319, CodeQL 42242238354, native 42242238364.
The failed source has no UI-test pass or visual acceptance.

Diagnostic PR #1622 / c1999570 passed CI 42240555035 and CodeQL 42240554834 and
merged as 806d49db at 15:21 UTC. Normal Deploy 42242252546 is queued; its fixed
role/encoding matrix follows deployment. Production policy remains unchanged.

The 0f93aa09 build exposed the underlying Core boundary: JSON string/number
convenience accessors are app-local/file-private. Corrected 5a923e70 uses public
JSONValue case matching, with no visibility change. Native 42242719701,
CI 42242719791 and CodeQL 42242719674 now qualify this head. The preceding
builds stopped before simulator boot; neither is visual/test acceptance.

Corrected candidate `7acb5ec50fd7a054ebc6bb1469dc8a1ef9ff0ef5` has app/test tree
`cf9c686a58fdeb409a0575f528297108a5dfa11c` and full tree
`8cf23c1eeec054c261b3bfada019803646a242ad`. CI 42243718659's Core job
127981299831 passed all 502 tests with zero failures at 15:34 UTC. CodeQL 42243718445
passed. Native 42243718420 (job 127980347204) is still building; general CI and
native tests/captures remain pending. This source fixes only the named gallery
fixture/localized format checks after the three chart-data tests had already passed.

## 15:44 UTC — Role rejection isolated

Normal Deploy 42242252546 passed hosted-agent rollout, readiness and live Current
acceptance. Explicit diagnostic 42245489142 used the same 806d49db target with
inspect/provision/refresh false. The typed_user control passed with Terra/High;
developer_string, system_message and system_string each failed with HTTP 400
invalid_request at response_start. Together with the first matrix, this isolates
the trusted message roles rather than typed-message encoding or policy length.
No production policy has been demoted to user content or removed.

The next bounded investigation is the documented native Conversation item channel:
store trusted policy in a fresh owned conversation, then send a user-only response.
Require a policy-only sentinel despite a conflicting lower-priority user request;
a generic response cannot qualify it. This remains a planned diagnostic, not an
accepted production transport or a claim that Copilot works. Static definition
instructions alone would omit dynamic per-turn policy and are not an acceptable
shortcut.

General CI 42243718659 and CodeQL 42243718445 completed successfully for 7acb5ec5.
Native 42243718420 compiled and entered its single simulator test/capture pass;
actual test outcomes and visual inspection remain pending.

PR #1623 at de6a5681 passed CI 42247195691 and CodeQL 42247195606 and merged
as 114633765b44ec3f1cda849570fd361513086b72 at 16:04 UTC. Normal deployment
42248895975 is active. Its fixed stored-policy diagnostic uses two owned
conversations (developer/system), each with two policy updates and conflicting
user reply instructions; maximum four response calls. Both policy precedence and
replacement must pass. Production request construction remains unchanged.

A read-only merge-tree check against 11463376 confirms PR #1621 / 7acb5ec5 merges
without conflict and retains the qualified app/test tree cf9c686a58fdeb409a0575f528297108a5dfa11c.
Expected full merge tree at that base is 031bb1e9f233ce4326e8641059f84b7dda29cce1.
Recheck against actual main before merging; this is not a merge or native pass.

## 16:59 UTC — Retained UI failures corrected; policy channel remains incompatible

Native 7acb run 42243718420 completed 64/68 tests. Core 502/CI 42243718659 and
CodeQL 42243718445 passed. Both language tests selected historical chart points
successfully, but opening records produced a blank destination with only Back.
The initial empty Group prevented detail loading/navigation modifiers mounting.
The correction provides a concrete loading state/ZStack, retains localized decimal
readings (72.4 kg was incorrectly shown as 72 kg), and verifies loaded measurements
plus selection/scroll preservation on Back.

The AX recording shows the complete plot fits: fast test drags coasted past it.
Slow drags now hold before release with the same full-plot bounds. The actual
English/dark widget recording shows all three revised medium layouts fit. Its
header text has an optical 1.17 pt symbol-centering offset; the test allows up to 2 pt
while retaining full 16 pt content insets at 0.5 pt precision. Danish/light still needs
the next capture. Widget captures now precede assertions.

Health header/dock/plots and task Source details were visually inspected. Loading
highlights stay inside bars, but their translucent mask attenuated the effect twice;
it now clips to opaque rounded geometry at 14% peak. The motion sample was only 1.78 s
and included launch. The existing capture now settles 2 s and records 7 s. Native test
evidence and broad screenshots upload separately to keep each archive downloadable.

The 642 MB original screenshot archive exceeded the connector's 512 MiB limit and the
workspace could not download its blob redirect. Evidence-only runs 42255492646 and
42256149686 repackaged existing captures, with no build or simulator. Image/index
artifact 13521619175 SHA256 38b37b862831f8fe058e2e6878cb21ca8c9e74b9ce4044310cc2a01ad929a9be;
failed-test artifact 13522028042 SHA256 e4dc1fea90bf8102e12095d996b7ba56de700e2c9ab7cfad54ed028ec055594e.

Corrected candidate e0d6821e3fa9700de9ec07510ce7b03e41260d58 has app/test tree
`d3f0f3c1c7e71bd0ed0d97b0b7c11520255ad12a`. It includes the four-line localized
Copilot compatibility explanation. One fresh native run 42257412529, general
CI 42257412696 and CodeQL 42257412505 are active. Local YAML/diff checks and the two
existing iOS workflow guards passed using the installed Node YAML parser; no local
Swift compiler is available. Earlier 64/68 is not release qualification.

PR #1623 normal deployment 42248895975 succeeded, including Current acceptance.
Stored-policy probe 42252117950 completed 16:26:57 UTC; both developer and system items
failed `managed_probe_policy_not_applied` at response_stream. Logs do not identify
which of the two turns failed. No successful policy compatibility is claimed.
PR #1624 final bc49960e qualifies an exact target/model/effort/transport receipt,
checked by discovery, new sessions, existing sends and internal claims. Activation
clears stale evidence and grants a receipt only after two full-policy canary turns
satisfy changing policy-only sentinels against conflicting user input. The normal
runtime remains unaffected. Do not weaken policy or owner approval to enable Copilot.
