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

## Selected small complication requirements

The owner selected this set on 8 November 2026, superseding Next Event and the combined Ask Jarvis proposal. Visual designs for the two distinct voice entry points remain pending.

1. **Tasks Today:** checklist icon and remaining incomplete tasks due today. Tap opens today's tasks. Keep overdue tasks separate unless requested. Zero means no remaining tasks; unavailable data must not show zero.
2. **Dictate:** dedicated single-message entry point. Tap should start dictation with as few steps as watchOS permits, either by opening the Watch app or through a supported system surface. Capture speech as a message to Jarvis, distinct from an ongoing spoken conversation. Recording from the complication/watch face itself is not established. First-use permissions and locked/authentication states may add steps. Submission/confirmation behavior remains to be selected.
3. **Voice Session:** dedicated ongoing spoken conversation. Tap opens the Watch app and starts a session after necessary permissions/authentication. The desired session continues until the owner ends it, with an ongoing live tile that exposes End Session. Interpret the owner's wording “hours continue” as “should continue”; no multi-hour duration guarantee is established. Ending must stop microphone capture, playback and the backend session, and clear the active tile state. Repeated taps should resume the existing session rather than create duplicates.

Apple lists regular circular artwork sizes of 42–50 pt depending on model. Validate accessoryCircular masking, text and actual bounds in previews; do not confuse this with smaller legacy circular-small artwork sizes.

## Voice feasibility limits

The behaviors above are product requirements, not implemented or platform-verified features. A live tile is a status/control surface, not permission to keep microphone capture running. Do not promise an uninterrupted wrist-down or background conversation before device testing.

Apple documentation checked 8 November 2026:

- [Extended runtime sessions](https://developer.apple.com/documentation/watchkit/using-extended-runtime-sessions): ordinary apps can suspend when the wrist lowers. Extended sessions serve specific use cases, have time limits, and must be chosen for the actual use case; do not misclassify Jarvis as a workout or mindfulness app to obtain runtime.
- [Background audio](https://developer.apple.com/documentation/watchkit/playing-background-audio): background playback support does not establish continuous microphone recording or a duplex conversation during silent intervals.
- [Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities): iPhone-started activities may appear on paired Apple Watch. This does not establish a Watch-originated standalone session lifecycle or a working End action for Jarvis.

Investigate native Watch Smart Stack controls versus a paired-iPhone Live Activity, Watch-only versus phone-assisted audio, permissions, authentication, speaker/headphone routes, wrist-down behavior, silence, interruptions, network loss, reconnect and reliable termination. If uninterrupted background audio is unsupported, surface a truthful paused state and resume action rather than implying the microphone remains active.

## Remaining work and handoff

No Watch app target or complication code was added. No build, simulator, device, tint, Always On or VoiceOver testing was run. No deployment, release or merge is authorized in this secondary thread.

Before implementation: confirm owner Watch model and watch face; approve the revised Dictate and Voice Session visuals; add a Watch target and assess JarvisCore watchOS compatibility; define HealthKit snapshot refresh, timezone/week boundaries and source deduplication; verify all layouts at actual bounds including small models, missing/stale data, large numbers and localized labels; verify tinted/Always On rendering and tap destinations. WidgetKit refresh is system-budgeted, not continuously live.

Primary thread retains implementation coordination, integration, deployment and final acceptance. Open PRs #1646 and #1532 touch iOS navigation/health; this branch only adds design documentation and the reference image.
