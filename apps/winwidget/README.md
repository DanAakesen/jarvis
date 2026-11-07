# Jarvis Windows widget

An Electron, React and TypeScript scaffold in the Jarvis monorepo. The only
capabilities are moving, docking, expanding/collapsing and closing its window.
There is **no backend connection**, authentication, chat, voice, PC bridge,
autostart, installer or update service. Companion features will be discussed
with Dan separately.

Use the repository's Node.js 22.23.3 and npm 10.9.9 from the repository root:

```sh
npm ci
npm run dev:winwidget
```

Development binds Vite to `127.0.0.1:5183` with a fixed port and launches Electron.
Renderer edits use HMR; restart after changing Electron/preload code. Close the
widget or press Ctrl+C to stop both processes. The first launch downloads the
pinned Electron binary; npm and GitHub release access are required.

```sh
npm run build:winwidget
npm run start:winwidget
npm run lint --workspace @jarvis/winwidget
npm run test:winwidget
```

`build` emits `apps/winwidget/dist/electron` and `dist/renderer`. `start` uses
only these local outputs and does not need Vite. Run the same commands in
PowerShell on Windows 11 with an interactive desktop. This is a source-run
scaffold, not a distributable Windows installer. Never disable the Electron
sandbox to run it.

Drag the grip or title to move using the native OS drag loop. Releasing within
24 device-independent pixels of either work-area edge snaps flush to it. The
left/right buttons provide keyboard-accessible snapping; Tab and Enter operate
all controls. The taskbar work area, negative monitor coordinates and display
removal are handled in main. Expansion preserves a right-edge anchor. Native
resizing and snapping are immediate; the sidebar reveal uses Motion and turns
off movement under the OS reduced-motion preference. Close exits the app.

For renderer-only inspection, `npm run dev:renderer --workspace @jarvis/winwidget`
opens a browser preview with native actions disabled and explained.

## Security boundary

Main owns all window state and validates the sender webContents, main frame,
exact entry URL and each argument. The sandboxed CJS preload exposes only
`setExpanded(boolean)`, `dock('left' | 'right')` and `close()`; no IPC object,
Node API, arbitrary channel, filesystem, shell, credential or backend URL.
Context isolation, sandboxing and web security stay enabled; renderer Node and
webviews stay disabled. Popups, navigation, redirects, downloads and permissions
are denied. Production uses `jarvis-widget://app/` with an allowlist for built
HTML/JS/CSS and a CSP denying network and frames. The session also denies external
requests. Development permits only the fixed loopback Vite origin and its HMR
WebSocket; inline script is permitted only in development for React refresh.
Inline styles support Motion. Future backend work needs an explicitly designed
authentication/token boundary in main; do not put secrets in renderer or Vite env.

## Verification

Unit/component tests cover docking thresholds, monitor/work-area bounds,
expansion anchors, local-asset restrictions and honest placeholder/control states.
Windows runtime verification is **unverified** in the Linux implementation runner.
Before accepting native behavior, record the Windows version, scaling, monitor
layout and results for: always-on-top over another normal app; smooth grip/title
dragging; left/right snaps near and beyond threshold; taskbars; negative-coordinate
and mixed-DPI monitors; unplugging a monitor; repeated sidebar toggles; keyboard
controls; Close/Alt+F4; light/dark themes; and Windows Accessibility → Visual
effects → Animation effects off. A browser preview cannot establish those results.

No window position is persisted. Tiny work areas can reduce the window below its
nominal size; large OS text/zoom may require vertical scrolling. Always-on-top
does not promise display above exclusive fullscreen apps or secure OS surfaces.
