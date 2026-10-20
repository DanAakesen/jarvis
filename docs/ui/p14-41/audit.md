# Daily UI rebuild audit (P14-41, 20 October 2026)

Umbrella: [#1116](https://github.com/DanAakesen/jarvis/issues/1116). Ruling: rebuild the original Daily
components and data presentation in Jarvis styling (see [decisions](../../decisions.md)).

## Method and limits

- The owner supplied a screenshot and observation pack of the original app. It contains **no frontend
  source code**; component names, endpoints and request shapes of the original are unknown. This audit
  therefore maps what is visible, not code. No real values from the pack are reproduced here.
- Jarvis side: `apps/web/src/daily`, the `@jarvis/contracts` Daily query sources and the Daily docs
  (`docs/daily-migration.md`, `docs/reference/daily-v182/`).
- "Served" means the web app can read it today through `GET /daily/capabilities` and
  `POST /daily/query`. Those serve 13 sources: health metrics, sleep, workouts, workout detail, heart
  rate, metric catalogue, nutrition meals, favourites, plans, days, sync status, brief history and detail.
- Verdicts: **Match** (equivalent exists), **Partial** (exists, differs in composition or fields),
  **Gap-UI** (data is served, component is missing), **Gap-data** (nothing served), **Scope** (approved
  scope excludes it; needs an owner ruling before building).

## Screen audit

### Daily (`/`)

| Original component | Jarvis today | Data source | Verdict |
| --- | --- | --- | --- |
| Top navigation: Daily, Workouts, Nutrition, settings gear | One Daily page with section tabs (Overview, Workouts, Nutrition, Body & sleep, Briefs, Data); Settings in the shell | n/a | Partial. Separate Workouts/Nutrition routes are **Scope** |
| Greeting heading with the owner's first name | Fixed "Daily" heading | Signed-in profile (already in the web session) | Gap-UI |
| Freshness pill ("Cloud ...ago") with info popover | `FreshnessLine` and "About this data" disclosure | `daily.sync`, per-query read time | Partial: one pill plus popover is missing |
| Period tabs: Today, Yesterday, 1 week, 2 weeks, 1 month | `DailyPeriodControl`: 7 days, 30 days, 90 days, year, custom | Client-side period | Partial: presets differ |
| Training goal card: Gym, Run, Activity rings (sessions against weekly target, steps against daily target) | Workout summary tiles, no rings or targets | Workouts: `daily.health.workouts`. Weekly session targets and a step target: not served | Gap-UI (ring) and Gap-data (targets) |
| Protein tile and Calories-left tile | Nutrition totals against the loaded baseline | `daily.nutrition.meals`, `daily.nutrition.days`, health metrics | Partial |
| Meal coach strip (next meal, remaining targets) | Plans in Nutrition | `daily.nutrition.plans` | Partial: no overview strip |
| Health card: sleep today, protein today, intraday protein chart with target line | Sleep and body summary tiles, sleep chart | `daily.health.sleep`, `daily.nutrition.meals` | Partial: protein-today chart missing |
| Recomposition card: sessions, calories, duration, body trend (weight, fat mass, fat %, muscle) | Body view with metric charts | Health metrics (body measurements) | Partial. Baseline/status logic is **Scope** (coaching excluded) |
| To-dos: dated task timeline, All tasks / Priority only, expandable task | None | Not served for this module. Jarvis tasks live on the Notes page | Gap-data and **Scope** (task source is excluded) |
| Waiting for you / Waiting on others: mail attention rows with age badges, expand, hide | None | Not served; the feed services are inactive and have no web read source | Gap-data |
| Countdowns (All / 7 days) | None | Not served | Gap-data and **Scope** |
| Habits: weekly dot rows with counts | None | Not served | Gap-data and **Scope** |
| Small-screen carousel of the three top cards | Responsive grid | n/a | Gap-UI |
| Health panel with tabs Overview, Sleep, Activity, Workouts, Body, Nutrition, All data | Section tabs plus the Data record browser | Metrics, sleep, workouts, meals, metric catalogue | Partial: panel layout, Activity tab and the Overview stat grid are missing |

### Workouts (`/workouts`)

| Original component | Jarvis today | Data source | Verdict |
| --- | --- | --- | --- |
| Training summary: sessions, calories, day bars with Gym/Run legend, mini rings | Workouts summary and figures | `daily.health.workouts` | Partial: rings need targets |
| Gym, Run and Activity class cards (time, energy, distance or heart rate, steps) | Summary by type, workout glyphs | `daily.health.workouts`, `daily.health.metrics` | Partial |
| Available data inventory | Data notes and metric catalogue | `daily.health.metric-catalog` | Partial |
| Workout history list | Paged history with detail | `daily.health.workouts`, `daily.health.workout`, `daily.health.heart-rate` | Match |
| Today, 1 week, 2 weeks, 1 month | Shared period control | Client-side | Partial |

### Nutrition (`/nutrition`)

| Original component | Jarvis today | Data source | Verdict |
| --- | --- | --- | --- |
| Meal coach plan with remaining energy and protein, logged count | Plans, targets settings | `daily.nutrition.plans`, nutrition targets | Partial |
| Nutrition trend: energy balance and protein charts | Day and trend views | `daily.nutrition.days`, `daily.nutrition.meals` | Partial |
| Data inventory | Data notes | `daily.nutrition.days` | Partial |
| Meals list with components, quantities, macros, uncertainty, capture method, export state | Meal list and library | `daily.nutrition.meals`, `daily.nutrition.favorites` | Partial: field-by-field check needed |

### Rules & sources (`/settings`)

| Original component | Jarvis today | Data source | Verdict |
| --- | --- | --- | --- |
| Targets block with measurement inputs and derived daily targets | Nutrition targets settings | Nutrition targets, health metrics | Partial |
| Rule cards (access, behaviour, mail, tasks, calendar, refresh, notification) | None; Jarvis has its own Settings | Static copy | Gap-UI; only rules that still apply to Jarvis should appear |
| Source coverage list with status | Health upload settings, `daily.sync` | `daily.sync` | Partial |

## Gaps for backend or owner decisions

1. No served source for: mail attention (waiting for you and on others, with hide), weekly gym/run
   targets, a step target, tasks, habits, countdowns, calendar events, recomposition status.
2. Approved scope currently excludes the task, habit and countdown source, coaching and recomposition
   automation, and separate Workouts and Nutrition pages. The rebuild needs an owner ruling per item.
3. The original source code is not in the pack, so exact field-level parity (for example meal
   uncertainty and capture method) is checked against the screenshots only.

## Proposed split

1. P14-41-01: decision, scope reconciliation and this audit (docs only).
2. Shell: greeting, freshness pill and popover, period presets.
3. Today overview: training rings, protein and calorie tiles, meal strip, health and body cards.
4. Workouts: class cards, day bars with legend, history.
5. Nutrition: coach plan, trend, meals list.
6. Health panel: Overview stat grid, Activity tab.
7. Attention, tasks, countdowns, habits: states built, data pending (blocked on the gaps above).
8. Rules & sources.

Every component ships loading, empty, error and unavailable states. Values that are not served are never
invented.
