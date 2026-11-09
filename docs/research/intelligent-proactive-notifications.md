# Intelligent notifications across Jarvis

Owner-approved implementation scope, 9 November 2026. PR [#1669](https://github.com/DanAakesen/jarvis/pull/1669), branch `research/data-driven-proactive-notifications`, based on main `d8967757`. The earlier research proposal is superseded by the owner's corrections below.

## Confirmed scope

1. Connect relevant context across existing Jarvis data.
2. Compute facts, progress, dates and trends from real records and saved goals.
3. Let the existing model select useful opportunities, connect evidence across domains and compose the notification.

The owner explicitly declined the proposed additional delivery-policy/validation stage, feedback learning and shadow mode. Notifications contain useful actual details for the sole owner; this feature adds no privacy-redaction layer. Existing authentication, source/category/scope preferences, pause, quiet hours, model-output schema checks, delivery receipts and budget remain in effect. No deployment or live push was performed by the secondary thread.

## Implemented

- Existing source registry now includes Health/training, nutrition, notes and memory, with independent saved source switches and availability status. Health/nutrition require the existing Health enablement and SQL; Notes uses the existing configured vault and SQL index; Memory uses the existing durable memory store.
- Health reads canonical daily metrics, sleep, workouts, manual gym sessions, lifts, sync coverage and saved training targets. Nutrition reads logged day totals, today's meals, saved targets and plans. Data windows are bounded: 28 days, up to 500 metric/workout rows, 100 manual workouts, 30 lifts, 12 current note excerpts, 25 memories and 5 nutrition plans. This is cross-domain context, not an exhaustive read of all historical data on every check.
- Code calculates Monday-based Copenhagen training periods, recorded sessions, saved-goal percentages/remaining counts, available-observation metric means/changes and logged protein progress. Distinct HealthKit IDs remain distinct; manual gym copies use the existing two-hour matching convention. Missing data stays unknown. Counts describe recorded activity; sync receipt alone cannot establish all permissions or completeness. Notes are read from the current vault blob, not stale indexed content.
- Open ordinary tasks are supplied as model-only commitments; existing high-priority deterministic alerts and explicit reminder timing retain their previous behavior.
- Prompt budgeting reserves source diversity so a busy task/calendar stream does not crowd out health, nutrition, notes or memory. The model selects and orders evidence-backed normal insights, with concrete details and optional next steps. There are no fixed motivational messages or default personal goals. Explicit silence (`findings: []`) is now a successful model result rather than invalid output.
- Existing alert hook sends the first normal model insight when no time-critical bundle takes priority. The same path supports scheduled checks and the owner's Check now action. Existing receipts, preferences, quiet hours and daily cap apply; model output cannot label itself time-critical. New context sources supply notifications only and cannot create automatic tasks through the legacy suggested-todo writer.
- Native delivery reuses existing owner iPhone token registrations and APNs alert transport. Actual generated title/body and the finding UUID are sent in category `jarvis.proactive`. A native recipient is sufficient without a browser subscription. Registered native devices are preferred; browser Web Push remains the fallback only when none are registered, avoiding a duplicate browser send after a native outcome. No claim of actual display follows from APNs acceptance.
- iPhone taps route through normal app authentication to Proactive and fetch/expand the exact finding, including older items. Missing or unavailable items show the existing failure view. Source labels/settings decode all 12 source IDs in native and browser clients, with English/Danish labels.
- Schedule remains 07:00 and 18:00 Europe/Copenhagen plus Check now; 22:00–07:00 quiet hours and the existing monthly spend limit remain. This scope adds no new event-driven schedule or background HealthKit upload mechanism. Model context comes from data already synchronized to Jarvis.

## Primary handoff

- Apply migration `0076_proactive_context.sql` before running the new backend. It expands existing source-status and alert-class constraints only. The down migration refuses to discard retained new-source or insight history.
- Coordinate the updated iPhone build with backend integration: older clients do not recognize new source IDs. Existing native Proactive UI PR #1526 overlaps source labels and finding presentation; no redesign was included here.
- Existing `JARVIS_PROACTIVE_ENABLED`, `JARVIS_PROACTIVE_ALERTS_ENABLED`, `JARVIS_PUSH_ENABLED`, Health enablement, model credentials/catalogue and APNs configuration govern availability. This branch does not change production switches or provision anything. Native registrations currently reuse the existing approval-notification registration service; it must be configured and the owner must allow iOS notifications.
- For owner testing: use Check now on synchronized data; confirm an evidence-backed normal insight, full push content, notification open destination, repeat behavior and existing reminders. Actual phone/Watch delivery and model usefulness need installed-device testing, as requested. No shadow-mode acceptance gate applies.

## Verification

Local checks passed with Node 22.23.3 and Swift 6.2:

- Full backend: 7,489 passed, one skipped. The first broad run caught the missing migration-manifest entry; it was fixed and the full suite rerun successfully.
- Proactive/push subset: 948 passed, included in the backend count.
- Full isolated SQL suite: 275 passed, including new context/owner-isolation and migration-retention checks. Disposable container removed afterward.
- JarvisCore: 545 passed, including notification finding lookup and new source compatibility/localization.
- Web push: 62 passed. Backend and browser builds/lint and Swift frontend parsing passed.

Native iPhone/Watch compilation uses the existing PR-only workflow; see the PR for exact revision and final result. It caught an iPhone-only source-icon switch missing the new cases, corrected before handoff. Fixture screenshots in that workflow cover Watch, not actual notification receipt or the new Proactive flow. No physical-device delivery, model usefulness or notification UI screenshot is claimed here.

Local tests use synthetic data and an isolated loopback SQL Server container only. No production data, cloud resources or live Factory tasks were touched. Primary owns integration, migration execution, deployment, installation and final acceptance.


## Primary review corrections — 9 November 2026

Reserve the bounded task context for high-priority tasks before ordinary
commitments, including a high-priority duplicate discovered later. Apply delivery
receipt and item-state eligibility before selecting the first normal insight so
a delivered or dismissed finding cannot starve a new one. Open notification
findings retain Add to tasks, Snooze and Dismiss, and opening marks them seen;
historical findings remain read-only. Transient finding-load failures have Retry.
Focused backend regressions pass (29 tests); native action, historical-open and
transient-error cases are added to the existing simulator suite. Integrated
qualification and installed-device push acceptance remain pending.


Native reminder integration review also found that both automatic and explicitly
requested reminders still checked only browser subscriptions. They now use the
same native-recipient availability check as intelligent insights, without changing
explicit reminder timing, preferences, claim ownership or duplicate suppression.
The 26 focused reminder/composition tests, backend typecheck and lint pass.

The three new native notification interactions passed in job 129175020846 of
run 42620677166: open finding actions/dismissal, read-only historical findings,
and transient-load recovery. The run also exposes three pre-existing Notes tests
that still follow the previous inline folder UI; those are not notification
regressions and are not reported as passing. The current iOS source tree is
identical to this tested revision; backend-only reminder corrections are separate.
