# Mobile corrections #1293

Synthetic Chromium evidence from the actual React components and complete App.
No private owner screenshots, credentials or production API data are included.
The parent/coordinator inspected the private references; this executor did not.

## Captures

- `app-composer-390.png`: full App, dark, 390×844; full-width draft and second-row icons.
- `app-menu-390.png`: six entries, three dots, clear backdrop and visible conversation.
- `app-listening-390.png`: browser-recognition fixture active; accessible Stop dictation.
- `app-error-390.png`: genuine permission-failure fixture above the composer surface.
- `app-keyboard-geometry-390.png`: simulated VisualViewport height 480px in a 390×844 layout. Navigation hidden; the entire measured composer stack ends at 472px. The blank/lower scene is not a rendered native keyboard.
- `app-menu-light-320.png`: narrow 320×700 light chrome, readable menu labels.
- `app-desktop-1440.png`: 1440×900 full App, existing inline desktop composer retained.
- `menu-page2-390.png` and `plus-390.png`: isolated actual-component fixtures exercise arrow paging and the existing action menu. Their header explicitly labels the fixture.

## Attachment review correction

`app-attachment-uploading-390.png`, `app-attachment-ready-390.png`,
`app-attachment-ready-320.png` and `app-attachment-error-320.png` verify the
preceding approved attachment contract: compact pills remain **inside** the
composer above the message row. Only failed-upload messages and selection
problems appear outside above it; failed pills remain removable inside.

The browser uploaded a generated 96×64 PNG (colored geometric shapes), awaited
`HTMLImageElement.decode()`, and asserted `naturalWidth=96`/`naturalHeight=64`.
At 390px the ready pill is 44px high, ends at y=617, and the 356px-wide message
field begins at y=633. The three 44px controls share y=707, below the field.
The pill's enclosing form is `conversation-composer`; document width stays
390px. Uploading/ready transitions and a separate 503 failure were verified with
zero page errors. See `fixtures/1293-attachments-browser.py` for reproduction.

After this correction, four affected suites passed all 254 tests, covering
attachment ownership during upload/ready, error placement/removal, dictation,
and stylesheet contracts. Web lint and TypeScript/Vite build passed (existing
large-chunk advisory only).
Earlier screenshots without attachments remain applicable.

## Observations

At 390px, the message field spans 356px. Plus, Dictate and Send are 44×44px,
share the lower row, and have transparent backgrounds and no borders at rest.
The menu is 194px tall, with three 48px item rows. Its backdrop computes to
transparent with no blur. Its dark surface is the shared 90% opaque chat token.
The 320px inspection found cramped labels; reduced internal padding, icon columns
and existing small type corrected that before final capture.

The error surface remains separate above the composer and supplies enough
background to read against the stage. It participates in dock measurement.
Stop/error/end simulation preserves the unsent draft without an alert; genuine
permission errors remain visible. Keyboard arrow paging, Escape, plus-menu
opening and reduced-motion menu visibility were exercised. Complete-App runs
reported zero page errors and no unexpected alerts after valid fixture responses.

## Reproduction

Install only the existing web/contracts lockfile workspaces if full repository
installation is unavailable:

```sh
npm ci --ignore-scripts --workspace @jarvis/web --workspace @jarvis/contracts --cache /tmp/jarvis-npm-cache-1293
```

Copy `fixtures/qa1293.*` and `fixtures/qaapp1293.*` temporarily into `apps/web/`,
start `npm run dev --workspace @jarvis/web`, and run the Python Playwright scripts
in `fixtures/` with Chromium at `/usr/bin/chromium`. Scripts use the task checkout
path `/workspace/jarvis` for output. Remove temporary web fixtures before normal
lint/build. The full-App script replaces only the local browser's sign-in module
and fulfills `http://fixture.invalid` requests with synthetic responses; it does
not authenticate against or call the real backend. No security/registry settings
were changed. No fixture belongs in the shipped application.

## Local checks

- Final changed-area and App regression run: 7 files / 392 tests passed
  (`App`, `ConversationHistory`, `MobileShell`, phone viewport, styles,
  stylesheet geometry and overlay contracts).
- Web lint passed with zero warnings; TypeScript/Vite build passed with the
  existing large-chunk advisory.
- Full web run before the final stop-icon refinement: 152 files passed; one
  App test failed waiting for the Training heading (2,354 passed / 2,355 total).
  The complete App suite passed in the final 392-test rerun without changing
  that test. This is reported as a transient failure, not an all-green full run.
- `git diff --check` passed. Local Node 24.19.0/npm 11.9.0 differs from pinned CI.

## Limits

This is controlled desktop Chromium, including touch emulation and synthetic
speech events. It does not verify physical iPhone/WebKit keyboard behavior,
real microphone recognition, native keyboard pixels, or the owner's exact
post-stop browser error code. Keyboard detection uses the visual/layout viewport
inset with a 120px toolbar guard and ignores pinch zoom. Source-image comparison
and final hosted qualification remain parent-owned; the PR stays draft.
