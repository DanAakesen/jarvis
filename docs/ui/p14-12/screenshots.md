# P14-12 synthetic Chromium evidence

These before/after captures use the actual Jarvis web application, a
scratch-only sign-in stub, and synthetic API responses. No real account,
backend, personal content, or media device was used. Chromium was launched from
`/usr/bin/chromium`; forced-colors and `prefers-contrast: more` were emulated.
All captures include keyboard focus on the composer.

| Viewport | Mode | Before | After |
| --- | --- | --- | --- |
| 390×844 | Light | [before](before-390x844-light.webp) | [after](after-390x844-light.webp) |
| 390×844 | Dark | [before](before-390x844-dark.webp) | [after](after-390x844-dark.webp) |
| 390×844 | Forced colours | [before](before-390x844-forced-colors.webp) | [after](after-390x844-forced-colors.webp) |
| 390×844 | More contrast | [before](before-390x844-more-contrast.webp) | [after](after-390x844-more-contrast.webp) |
| 1440×900 | Light | [before](before-1440x900-light.webp) | [after](after-1440x900-light.webp) |
| 1440×900 | Dark | [before](before-1440x900-dark.webp) | [after](after-1440x900-dark.webp) |
| 1440×900 | Forced colours | [before](before-1440x900-forced-colors.webp) | [after](after-1440x900-forced-colors.webp) |
| 1440×900 | More contrast | [before](before-1440x900-more-contrast.webp) | [after](after-1440x900-more-contrast.webp) |

Chromium confirmed the requested media emulation, theme token values, visible
focus, and field colors. Forced colours maps the after field to a white system
surface with black text/boundary; more-contrast maps focus and control-boundary
tokens to the text color. No page or console errors occurred. The 16 WebP files
total 684,982 bytes.
