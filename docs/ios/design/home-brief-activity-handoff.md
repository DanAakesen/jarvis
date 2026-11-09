## Implementation handoff — 9 November 2026

Draft PR: [#1689](https://github.com/DanAakesen/jarvis/pull/1689). Branch: `feature/home-brief-daily-activity`.
Qualified code revision: `c9837c00abe1c0e524a4f9b1ff0569b9d36d8623`, with main `70c669c99204fd5b1ed34ea5e3ac66c07ec09307` preserved.
Primary session `01a1adc7-aebe-76f2-b63d-a852c887204f` owns integration, deployment and acceptance.

Implemented: grounded cached Home brief; canonical native/web Instructions editor with independent existing scopes; Home-only instruction and integer visible-line setting (default 3, range 1–6) through existing settings/chat/voice tools; shared merged all-day active kcal and Apple exercise minutes for Today/7d/14d/30d; replacement daily sync/provenance and missing/zero/partial/stale handling. Accepted shared surfaces and transparent chrome are retained.

Qualified at the code revision above:
- Backend lint, 7,414 tests (no skips), TypeScript build and container smoke.
- Web lint, 2,535 tests and production build.
- 278 isolated loopback SQL Server migration/database tests.
- Swift build and 553 JarvisCore tests.
- 135 offline Foundry contracts and 1,317 hosted-agent Python tests.
- Unsigned physical Watch release, Watch Simulator and iPhone Simulator builds with Xcode 26.6: [native build run](https://github.com/DanAakesen/jarvis/actions/runs/42663871323).
- [Aggregate CI](https://github.com/DanAakesen/jarvis/actions/runs/42663871241) and CodeQL passed.

Unfinished automated checks: the full iPhone UI/screenshot run is queued behind an older cancelled capture that is uploading results. The four English/Danish, normal/accessibility line-limit cases and the saved-instruction editor UI case are implemented but are **not claimed passed**. Current results must be checked on the PR before treating visual qualification as complete. No screenshots of this exact revision have been inspected.

Remaining physical-device/model checks: HealthKit permissions and no-data ambiguity; a real zero versus unavailable quantity; late Watch synchronization; foreground across Copenhagen midnight/DST; actual Home/Health parity; real English/Danish brief quality; final visual/accessibility acceptance.

Runtime/rollout dependencies: deploy the compatible backend before the native client, because the new brief endpoint, Home settings and additive `daily_total` sync marker require it. Existing model deployment/credentials and connected calendar/task sources are reused. Legacy raw activity rows cannot establish all-day totals; a merged HealthKit sync refreshes the last 30 days. The Home brief excludes legacy health context facts until that adapter carries authoritative daily provenance; Home/Health activity tiles use the new readings.

No PR merge, deployment, infrastructure change, live settings mutation or live data modification was performed by this secondary thread.

## Secondary implementation — PR #1689

Branch: `feature/home-brief-daily-activity`. Backend/native/web implementation is in progress; isolated CI qualification is pending. Primary owns integration/deployment. No live settings, data or infrastructure were changed.

The Home brief currently uses calendar/tasks and optional nutrition/weather context. Health source facts are deliberately excluded until their context adapter carries the merged-daily provenance required to quote all-day activity safely. This does not affect the Home/Health activity tiles. Existing model deployment/credentials are reused; no new deployment is provisioned.

Remaining checks: installed iPhone/Watch HealthKit permissions and unavailable readings, late Watch synchronization, midnight/DST behavior, real English/Danish brief quality and final visual acceptance. Detailed tests and exact revision will be recorded in the draft PR after qualification.

# Home brief and activity totals — secondary implementation handoff

Investigated against main `6601dbb8ca074e3f8059300f34fc9d8a4733bfcb` on
9 November 2026. This is a source investigation and implementation brief, not an
implemented change or a read of the owner's current HealthKit data.

## Confirmed source behavior

- `JarvisTodayModel.greeting` supplies the next calendar event and today's due
  tasks to `JarvisTodayGreeting.make` in `JarvisTodayLogic.swift`. The result is
  fixed localized copy, not a model-generated briefing. Missing calendar/tasks
  currently become empty collections or zero before this call; consequently
  “Your day is clear” can also appear without a successful read.
- `JarvisTodayScreen.greeting` has no configurable line limit. It uses the
  accepted text/accent treatment and shared page geometry.
- Native Settings → General → Jarvis currently has separate Personality and
  Identity editors. Personality includes `personality.customInstructions`.
  Backend settings also persist `personality.modeInstructions` for Present,
  Away and On the move; web edits those in `Presence.tsx`. There is no existing
  Home-brief instruction or maximum-line setting.
- `JarvisTodayActivityDisplay` sums `JarvisGymLogEntry.durationMinutes` and
  `activeKilocalories` for **every** selected range. Empty workout history gives
  zero for both totals. The earlier build-86 correction preserved measurements
  when merging workout sources; it did not change these metric definitions.
- `JarvisHealthKitAccess` already requests `activeEnergyBurned` and
  `appleExerciseTime`. `JarvisHealthKitReader` uploads their quantity samples as
  `active_energy` in kcal and `apple_exercise_time` in minutes. Home currently
  consumes steps and workouts, not these daily activity metrics.
- Health's `JarvisHealthRingsSection.activeSeconds` also sums workout duration.
  Its current Active time label is therefore not an independent exercise-time
  reference. Do not silently give identically named metrics different meanings.
- Daily steps already use merged HealthKit statistics. The other quantity sync
  path reads raw samples; extending totals must handle overlapping sources,
  late uploads and replacement totals rather than blindly summing samples.

## Requested outcome

1. A useful, data-grounded Home brief guided by an owner-editable instruction and
   a maximum number of visible lines. Consolidate owner-editable Jarvis
   instructions into **Settings → General → Jarvis → Instructions** on iPhone,
   with equivalent web access. Keep identity, general style, presence modes and
   Home instructions as separate scopes backed by the existing settings store;
   consolidate navigation, not their runtime meanings. Inventory other existing
   instruction editors and link/reuse their canonical editor instead of copying
   values into a second store. Preserve saved settings and old navigation links.
2. Active kcal must represent Apple Health's active energy across the selected
   day/period, including activity outside recorded workouts and excluding basal
   energy. Keep the donut as a workout count. Use Apple exercise minutes for the
   time metric, label that definition clearly, and align Health where the same
   metric is shown. Exercise minutes are not every minute of incidental movement.

## Implementation boundaries

- Secondary implements, designs, builds and tests in its own feature branch.
  Primary session `01a1adc7-aebe-76f2-b63d-a852c887204f` (Jarvis2 primary) owns
  review, integration, migrations, signing and deployment. No secondary merge,
  deployment, live-setting change or infrastructure change.
- Read repository instructions and relevant product/architecture/design context.
  Leave Factory, notification rollout and Watch implementation outside this task.
- Extend authenticated settings validation, persistence, native/web clients and
  `get_settings`/`update_settings` so chat/voice can make the same authorized
  preference changes as the UI. Home-specific instructions must not leak into
  ordinary chat behavior or grant permissions. Preserve separate reset scopes.
- Suggested initial UI bounds: 1–6 lines, default 3. These are implementation
  defaults, not values the owner has already selected. Respect Dynamic Type,
  VoiceOver, English/Danish, Reduce Motion and accepted transparent chrome.
- Generate the brief through existing backend/model infrastructure using real
  permitted data and source availability. Cache/reuse it without a model call on
  each render; refresh on material data, day, language or instruction changes.
  Avoid a blank blocking screen, stale success claims, invented plans, generic
  filler and “day is clear” when relevant sources failed. Enforce the visible
  line limit in the UI as well as a concise generation budget.
- Reuse and extend existing HealthKit/statistics, health contracts and sync.
  Have one shared definition across Today/7d/14d/30d and matching Health values.
  Keep workout totals separate: do not add workout calories to daily active
  energy or add cached/server totals to the same local readings. Ensure the
  chosen calendar/timezone is consistent across local and server views, with
  explicit Copenhagen and DST tests. Re-read revised recent days appropriately.
- Preserve true zero, unavailable, stale and partial states. HealthKit does not
  disclose per-type read denial; an authorization request succeeding does not
  prove data access, and no samples do not establish a measured zero.

## Required evidence and handoff

- Synthetic no-workout day with positive active kcal/exercise minutes displays
  those values while the donut remains zero; measured zero and missing data have
  distinct states. A workout must not double-count daily activity totals.
- Verify Today/7d/14d/30d, midnight/DST, late Watch data, repeat sync and refresh,
  overlapping sources, offline/stale recovery and Home/Health agreement.
- Verify instruction/max-line save and readback, chat/voice settings parity,
  retained existing instructions, reset scopes, absent-source fallback and
  bounded generation refresh. Inspect short/long text at normal/accessibility
  sizes in both languages without regressing transparency or scrolling.
- Run relevant backend/contracts/Swift checks and native builds/UI checks when
  available. Update affected project docs; open a draft PR and report exact
  commit, tests, captures and device-only limitations. No live health-data writes
  or fabricated owner acceptance.
