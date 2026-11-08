# Apple Watch complication design references

## Large health complication

[Approved visual direction](health-rectangular-approved-concept.png), selected by the owner on 8 November 2026. This is a generated concept with illustrative values, not a screenshot of implemented watchOS UI.

- Left: daily steps, prominent count, smaller top-aligned `/ 8000` target, cumulative hourly step line with amber area fading into black, and active kcal beneath the chart. Small Daily label.
- Right: weekly Gym and Run counts versus targets with progress bars, then active kcal without a target or progress bar. Small Weekly label at bottom right.
- Amber and warm stone on black, rounded typography, minimal outer padding. No date, step donut, full-width divider, or duplicate workout footer.
- Active kcal means active energy burned, excluding resting energy. Daily and weekly totals must use consistent sources and timezone boundaries; week-start policy remains to be selected.

## Sizing evidence and limits

Apple HIG complication guidance, retrieved 8 November 2026: https://developer.apple.com/design/human-interface-guidelines/complications

Its rectangular large-image-without-title guidance lists 162 × 69 pt (40 mm), 171.5 × 73 pt (41 mm), 184 × 78 pt (44 mm), and 193 × 82 pt (45/49 mm). These are artwork guidance, not a guarantee for every WidgetKit family, model or face. Measure the actual accessoryRectangular container in watchOS previews.

The reference PNG is 1925 × 817 pixels (ratio 2.3562), within 0.11% of 193:82 (2.3537). Proportions match; actual-size typography and readability are NOT validated. In particular the chart ticks and Daily/Weekly labels may require simplification. Keep this original for visual comparison; do not ship the raster as the complication UI.

## Small complication proposals

These are proposed content choices, not approved implementations:

- Tasks Today: checklist icon, remaining incomplete tasks due today, Today label. Tap opens today’s tasks. Keep overdue tasks separate unless the owner requests inclusion. Zero means no remaining tasks; unavailable data must not show zero.
- Next Event: calendar icon, minutes until next event, Next label. Tap opens agenda. Handle in-progress events, all-day-only days, no upcoming event and stale data explicitly.
- Ask Jarvis: microphone icon and Ask label. Tap opens the Watch voice flow; the complication itself does not record audio. Voice feasibility and authentication remain unverified.

Apple lists regular circular artwork sizes of 42–50 pt depending on model. Validate accessoryCircular masking, text and actual bounds in previews; do not confuse this with the smaller legacy circular-small artwork sizes.

## Remaining work and handoff

No Watch app target or complication code was added. No build, simulator, device, tint, Always On or VoiceOver testing was run. No deployment, release or merge is authorized in this secondary thread.

Before implementation: confirm owner Watch model and watch face; approve small concepts; add a Watch target and assess JarvisCore watchOS compatibility; define HealthKit snapshot refresh, timezone/week boundaries and source deduplication; verify all layouts at actual bounds including small models, missing/stale data, large numbers and localized labels; verify tinted/Always On rendering and tap destinations. WidgetKit refresh is system-budgeted, not continuously live.

Primary thread retains implementation coordination, integration, deployment and final acceptance. Open PRs #1646 and #1532 touch iOS navigation/health; this branch only adds design documentation and the reference image.
