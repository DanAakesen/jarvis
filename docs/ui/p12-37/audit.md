# Daily accessibility and keyboard audit (P12-37)

**Date:** 18 October 2026
**Scope:** Daily shell, sections and shared presentation kit. Routes, visible copy,
data flow and switch behavior are unchanged.

The audit combined source review, Testing Library role/name/state queries, the
Daily test suite and a Chromium walkthrough with scratch-only authentication and
synthetic API fixtures. The browser used reduced motion and covered 390×844 and
1440×900 in light and dark, plus 320×844 in light. It reached all six sections
with the section tab strip, exercised workout and brief open/back, Nutrition
view switching, Body view and its measurement control, record details with
Escape/focus return, and the Data chart choice and scroll region. The Body view
was re-entered at its `view=body` URL after the nested-tab keyboard check so the
synthetic catalogue and measurement control had settled before operation.
Observed focus outlines were 3px solid; document scroll width equalled viewport
width at each configuration; no browser console/page errors occurred. This is
synthetic software-Chromium evidence, not a physical-device or live-data check.
Accessible roles, names and states below were checked in the DOM and Testing
Library; no spoken output from VoiceOver, NVDA or another physical screen reader
was verified.

| Section or control | Keyboard, focus and order | Role, name, state and assistive-technology output | Finding before → after |
| --- | --- | --- | --- |
| Daily section navigation | Native tab buttons; one `tabindex=0`; Left/Right and Home/End move selection and focus. Browser walkthrough cycled Overview, Workouts, Nutrition, Body & sleep, Briefs and Data. | Named navigation and tablist (`Daily sections`); tabs expose selected state. Testing Library checks the `navigation` and `tablist` names, selected tab, roving stop and focus after arrow/Home/End. | No defect found; unchanged. |
| Shared period control | Native select, custom From/To inputs and Apply period follow DOM order; Enter submits. | `Period` combobox; `From` and `To` labels; invalid range uses `alert`. Testing Library checks names, focus order and submitted date range. | No defect found; unchanged. |
| Refresh and freshness | Refresh is a named button; pending state disables the action, and keyboard activation remains native. | `Refresh records`; busy records region and a status describe refresh; freshness is plain timestamp/count text, not color-only. Existing Daily page tests cover pending and failure. | No defect found; unchanged. |
| Overview summaries and jumps | Summary tiles and collection actions are native links/buttons; focus follows rendered order. Browser tab navigation reached Overview. | Summary is a labelled section/list; collection actions use names such as `Open Measurements`; pending and failure use busy/status/alert semantics. | No defect found; unchanged. |
| Workouts list, detail and paging | List/detail/back controls are native; Enter opens and returns to the list. Browser exercised workout details and Back to workouts. Paging controls are named and disabled when unavailable. | Workout history is a list; detail and figures retain their labels and units; paging reports page and availability in text. | No defect found; unchanged. |
| Nutrition Day / Trend / Library | Native tabs and date controls; browser used arrow keys to change views. Previous, Next, Today and library actions are keyboard-operable native controls. | Named `Nutrition views` tablist; tabs expose selected state; dates and library controls have labels; disclosure remains native. | No defect found; unchanged. |
| Body and sleep | Named nested tablist; native `Measurement` and `Period` controls. Browser changed views with ArrowRight, operated Measurement by keyboard, and focused a chart. | Body/Sleep tabs expose selected state; charts expose `img` names and the chart data-table control. The metric picker preserves the current measurement when search filters options. | No defect found; unchanged. |
| Brief history and reading view | History open and Back are native buttons; browser used Enter to open and return. | History entries retain status and delivery text; detail has a heading and structured content. | No defect found; unchanged. |
| Data records explorer | Browse, Table/Chart, period, paging and detail controls are keyboard-operable; browser opened a record, pressed Escape, and verified focus returned to its opener. | `Record presentation` group exposes `aria-pressed`; detail trigger exposes `aria-expanded` and a valid `aria-controls` target; detail is a labelled region. | Closed triggers referenced a detail node that did not exist; mount the labelled region hidden until opened. |
| Data table rows | Table is available in the desktop table view and through the chart disclosure; first-column row identity is announced with its cells. | Caption names the table, column headers use `scope=col`, first cells use `scope=row`. Testing Library queries verify row and column header roles. | All body cells were `<td>`; render the first data cell as `<th scope="row">` and preserve its previous non-bold text weight. |
| Wide-table scroll wrapper | Wrapper is keyboard-focusable and can be reached before scrolling wide data; visible focus outline remains present. | Labelled `region` contains a captioned semantic table. Testing Library checks region name, `tabindex=0`, caption, column headers, row header and cell. | No wrapper defect found; semantics were added to the guard. |
| DailyChart and chart data | Chart is keyboard-focusable and supports point inspection; “View data table” exposes the same recorded values. | Chart is a named image; table has a caption, column headers and row headers. Existing chart choices and observations are unchanged. | No defect found; table semantics are guarded. |
| Sparkline, meter and decorative graphics | Non-interactive graphics do not enter tab order; meter state is also written as text. | Sparkline is a named image; meter uses `progressbar` name/min/max/current/text; decorative glyphs are hidden from assistive technology. Unknown meter values remain explicitly unknown. | Sparkline name previously described only the trend; name series of up to seven slots with ordered observations and label missing/non-finite points “Not recorded.” Longer series, such as a 90- or 366-day period, use a bounded summary (recorded count, first, last, lowest, highest) so the name stays short; dated values stay in the section tables and the Data section. |
| Shared state and retry | Retry/load-more remain native keyboard actions. | Loading, empty and partial states use polite status; errors use alert. Tests assert one status per state and alert for error. Retry remains available in its failed section. | No announcement-role defect found; live-region expectations are guarded. |
| Landmarks, headings and lists | Heading navigation and list traversal follow the rendered section structure. | Daily has a page heading, section headings and labelled navigation/regions; workout, overview and history collections use list structure. Tables use captions and scoped headers. | No defect found; unchanged. |
| Drawer and overlays | Record details open with focus moved into the panel; close and Escape return focus to the opener. Browser verified Escape return. | Record detail is an in-flow, nonmodal labelled region, not a dialog: it does not trap focus or inert the page. Its closed `aria-controls` target now exists but is hidden. No Daily popover/menu was found in scope. | Preserve the existing nonmodal behavior; do not add a modal trap or overlay. Keep the control target mounted while closed. |
| Motion | Essential content and state remain available when transitions do not run. Browser contexts requested reduced motion. | Existing reduced-motion rules disable Daily record transitions, status animation and meter transitions; token/status labels remain. | No production motion defect found; a focused regression guard now checks the three rules and retained text state. |

## Guard coverage

- `DailyHome.test.tsx`: section navigation name, one roving tab stop, selected
  state and focus after ArrowRight, Home and End.
- `DailyPeriodControl.test.tsx`: labelled preset/custom dates, keyboard order and
  Enter submission.
- `sections/workouts/WorkoutsSection.test.tsx` and
  `DailyPage.test.tsx`: named workout/detail actions, chart readout, retry,
  paging and loaded-record navigation.
- `sections/nutrition/NutritionSection.test.tsx`: Day/Trend/Library roving
  focus, selected state, date stepping, disabled Next and library filtering.
- `sections/data/DataRecords.test.tsx`: row header; valid closed/open
  `aria-controls` target; expanded state and focus entry/return.
- `DailyPage.test.tsx`: Browse, Table/Chart, period application, paging and
  record/brief detail navigation.
- `ui/ScrollTable.test.tsx` and `ui/DailyChart.test.tsx`: named region, caption,
  scoped headers, row headers and table cells.
- `ui/presentation-kit.test.tsx`, `ui/StatTile.test.tsx` and
  `sections/body-sleep/BodySleepSection.test.tsx`: sparkline values and explicit
  missing observations in its text alternative; `presentation-kit.test.tsx`
  also guards the seven-slot limit, the bounded summary for longer series
  (including a 366-day period) and the stable freshness status region on
  re-render.
- `ui/DailyState.test.tsx`: status/alert roles for loading, empty, partial and
  error states.
- `ui/daily-motion.test.ts`: reduced-motion rules and retained text/status
  treatment.
