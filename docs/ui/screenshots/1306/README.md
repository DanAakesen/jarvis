# Native attachment source continuity (#1306)

Base: `d76679646bc94b12d27f2176b72efd8b75469b17` (latest fetched main at start).

`ConversationMoreMenu` previously closed and restored trigger focus before
calling every action, including Attach file or photo. Its file input remained
mounted elsewhere in the form with clipped 1px bounds. The correction renders
the input beside its menu row with matching bounds, retains that row/menu during
native picker activation and cancellation, and closes after selection invokes
the unchanged upload handler. Other actions, plus toggling, paste/drop and
attachment validation retain their existing paths.

## Actual-component QA

The fixture imports the production App, styles, composer and menu. Authentication
and HTTP responses are synthetic; Chromium uses the existing WebGL fallback.
No private screenshot, private account data, custom menu stand-in or replacement
native picker is included. All three saved screenshots were pixel-inspected.

`measurements.json` records passing assertions at 390×844 dark/full motion,
320×700 light/reduced motion, and 1440×1000 desktop dark/full motion:

- Real browser `filechooser` event from the attachment action, with multiple files allowed.
- Input bounds equal the attachment row; row stays connected, visible and stationary.
- Simulated cancel leaves the same input/menu available and permits another activation.
- Plus toggle, Escape, outside pointer dismissal and Language selection still close.
- No browser page errors.

The screenshots show the retained source menu after interception of the native
file chooser. Chromium automation does not draw the iOS Photo Library / Take
Photo / Choose Files popover. Cancellation is simulated with its DOM event.
Vitest separately covers selected-file upload, closure/focus, no upload on cancel,
repeated activation and existing attachment flows.

## Reproduce

Use installed web dependencies, Python Playwright and `/usr/bin/chromium`.
Reuse the existing synthetic App entry fixture (unchanged):

```sh
cp docs/ui/screenshots/1301/fixtures/qaapp1301.* apps/web/
npm run dev --workspace @jarvis/web -- --port 5174
# In another shell, from /workspace/jarvis:
python3 docs/ui/screenshots/1306/fixtures/browser.py
rm apps/web/qaapp1301.html apps/web/qaapp1301.tsx
```

The browser script uses this executor's `/workspace/jarvis` path.

## Validation and limits

- Focused menu, history, attachments and stylesheet tests: 4 files / 178 passed.
- `npm test --workspace @jarvis/web`: 153 files / 2371 tests passed.
- `npm run lint --workspace @jarvis/web`: passed with zero warnings.
- `npm run build --workspace @jarvis/web`: TypeScript/Vite passed; existing large-chunk advisory.
- Local Node 24.19.0/npm 11.9.0 differs from pinned CI Node 22/npm 10.
- Physical iPhone native-picker placement and live upload services are unverified.
- Private Library image preparation succeeded, but the supported transfer helper
  returned `library file transfer failed: download failed`; no readable local
  bytes resulted. This executor did not inspect that image. Diagnosis uses the
  explicit report and code; screenshot pixels are not claimed as local evidence.
