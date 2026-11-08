# Build 86 — Home workout totals

8 November 2026. PR #1654 merged as
`ef783da2ca6c4942060f758b303ff33654d2dccc`. Its iOS tree
`e9904fd30acc462b3bfda0781631aabf5b407469` exactly matches qualified PR head
`f80db7099846eb9cd24755aabf6994c364190ecb`.
TestFlight run [42515467682](https://github.com/DanAakesen/jarvis/actions/runs/42515467682)
successfully archived, signed and uploaded build 86. Apple processing/device
availability and owner acceptance of the Home correction remain unverified.

## Change

Home could count today's manually logged workouts but show zero active time and
kcal: its combined vault/manual/HealthKit source discarded the matching HealthKit
row and its measurements. It now retains the primary session/date/recorded values
and fills missing duration, active energy and source identities from the match.
Each primary row is matched once per source, choosing the nearest compatible log
within the existing two-hour window. Distinct unmatched workouts remain visible.
No layout, permissions, HealthKit writes or stored-data migration changes.

The owner confirmed the build-85 Notes correction is fixed. That acceptance and
the accepted shared header/footer transparency remain recorded in PLAN.md and
the owner checklist. Copilot and Factory capacity are separate backend work;
Apple Watch remains with the secondary thread and is not included in this build.

## Validation

- The new nested-source regression fails on the old code with two Today workouts
  and 0 minutes/0 kcal. The fixed synthetic case shows two workouts, 90 minutes
  and 600 kcal. All four ranges, preserved manual values/identities, distinct
  nearby workouts and source failure behavior are covered.
- All 533 JarvisCore tests pass locally in Swift 6.2 and in CI 42515170283.
  CI result, Python checks and CodeQL 42515170223 passed on the exact PR head.
- Native Simulator compilation passed in 42515170356. The broad interaction and
  screenshot sweep was cancelled after compilation for this Core data-merge
  correction; no fresh full native interaction pass is claimed. Duplicate
  post-merge Simulator run 42515444123 was cancelled before qualification.
- `git diff --check` passes. Physical-device acceptance of this correction is pending.

## Owner retest

1. Open Home with Today selected and compare time/kcal with the same workouts in Health.
2. Switch Today → 7d → Today; recorded totals must remain and workouts must not duplicate.
3. Refresh Home and confirm the totals survive. A log with no recorded duration
   or calories in any source still has no measurement to supply.

The [standing checklist](p15-owner-test-checklist.md) retains the other pending tests.
