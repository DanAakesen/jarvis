# 6 November device-feedback batch

## Release authorization

The owner explicitly lifted the hold after his final loading-animation feedback:
build everything and release after checks and UI inspection. The earlier hold
while testing build 75 is historical. Draft PR #1614 contains the first task-list
change at 30820b3c; subsequent changes remain local. Opening the PR automatically
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

## Local verification

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
