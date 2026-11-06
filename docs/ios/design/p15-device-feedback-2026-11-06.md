# 6 November device-feedback batch

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
inspection path are being prepared before another apply. Normal live acceptance
and its release-result job still passed; neither substitutes for the failed
comparison job.

TestFlight **build 76 uploaded successfully at 12:14:34 UTC / 13:14:34 Copenhagen**
through unchanged workflow 42215302636 (job 127883700403). Checkout logs confirm
verified source ab464314; the complete job and signing cleanup passed. UI
acceptance and the required normal backend dependency passed before dispatch.
Copilot activation continues separately without an app rebuild; its unavailable
state remains visible until target verification succeeds. This follows the
owner's release authorization and existing partial-delivery cadence. Apple
processing is not independently confirmed: no matching email was available in
the connected mailbox at 12:15 UTC.

Diagnostic PR #1615, candidate bbb60479, passed full CI 42214612550 and CodeQL
42214612464 and merged as 8398f7a7. Its app/test tree is unchanged. Normal Deploy
42215955386 and explicit read-only inspection 42215978680 are in progress.

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
