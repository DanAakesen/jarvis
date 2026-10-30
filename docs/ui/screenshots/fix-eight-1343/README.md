# Synthetic browser evidence for #1343

Captured on 28 October 2026 from the actual local frontend with synthetic
authentication and backend fixtures. All final images were visually inspected.
No live account data is included. See [implementation and validation](../../../review-fixes-1343.md).

| Capture | State checked |
| --- | --- |
| [Phone Settings, scrolled](01-phone-settings-scrolled.png) | 390×844; Save remains in sticky header while lower sections scroll. |
| [Focused short viewport](02-phone-settings-focused-short.png) | 390×500; text field focused, explicit save succeeds, feedback and Save remain visible. This is a keyboard-space approximation. |
| [Narrow phone Settings](03-settings-320.png) | 320×700; single header Save, no horizontal overflow. |
| [Desktop Settings](04-desktop-settings-footer.png) | 1440×900; existing footer Save is retained. |
| [Terminal error after reload](05-error-retained-after-reload.png) | Warning, partial reply and submitted text remain visible after reload. |
| [Queued message after reload](06-queue-restored-paused.png) | Unsent message remains queued; no request occurs before explicit Send queued messages. |

[Browser measurements](browser-results.json) record Save bounds, document width,
focus and the explicit resumed synthetic request. There were no uncaught page
errors or unexpected external requests. The Settings fixture produces
duplicate-key console warnings/repeated Nutrition target rows; those unrelated
rows are not production acceptance evidence. Physical iPhone/Safari and the
native on-screen keyboard were not exercised.
