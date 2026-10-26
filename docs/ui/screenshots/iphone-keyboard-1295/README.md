# iPhone keyboard follow-up #1295

These captures render the actual App in Chromium with synthetic authentication,
API responses and draft text. They are not physical iPhone or native-keyboard
screenshots. No private owner images are included.

## Failure and correction

The shipped detector computed `max(innerHeight, clientHeight) -
visualViewport.height - offsetTop > 120`. When layout and visual viewport heights
are all 480px, that expression is zero even with a focused composer. A mounted
already-short viewport has no earlier full-size measurement either. The previous
#1293 browser fixture reduced only `visualViewport.height`, leaving layout height
844px; it could not expose this failure. This reproduces a source-level failure
path, not a claim about the owner's exact browser mode or measured viewport values.

The hook now treats composer focus as a typing-space fallback. It handles focus
before or after resize and inspects existing focus at mount/enable. Observed
viewport expansion restores navigation even if the native keyboard dismissal
leaves the caret focused; a later shrink hides it again. Size changes accumulate
across frames against the last focus/transition measurement. Focus departure is
rechecked next frame so event ordering does not leave stale typing state. Focus
transfers to composer controls/options retain the typing layout until the click
completes, avoiding a dock jump beneath the pointer. Existing
viewport coordinates, inset detection, zoom handling and teardown remain intact.
Only the viewport hook and its tests change runtime behavior. Composer controls,
attachments, menu, dictation, preview dragging and plus-menu behavior are unchanged.

## Actual-App captures

- `app-resized-layout-390x480.png`: focus first, then resize the actual browser
  viewport. Layout, inner and visual heights all equal 480px. Navigation is hidden;
  the composer ends at 472px with all controls usable.
- `app-mounted-short-390x480.png`: reload at 480px, then focus without any earlier
  full-height sample. Navigation is hidden and the unsent draft persists.
- `app-restored-390x844.png`: viewport expansion restores the navigation while the
  message remains focused; composer ends at 760px above the navigation.
- `app-blurred-short-390x480.png`: ending focus restores navigation without a resize.

`measurements.json` records all four states. Document width stays 390px; no page
errors occurred. Browser assertions also verify shrink/reopen without another
focus event and that the draft is unchanged. I inspected these synthetic pixels.

## Tests and reproduction

Three new regression cases failed on shipped main before the fix. The expanded
viewport suite covers layout-first and visual-first event ordering, pan offsets,
initial focused mount, later enabling, incremental dismissal/reopen, zoom and cleanup.
The five focused suites cover viewport, App, ConversationHistory, attachments and
MobileShell. A further regression checks focus handoff to the composer controls.
Final lint/build/full-suite results are recorded in the PR receipt.

Use the existing web/contracts installation and Vite dev server. Temporarily copy
`../mobile-corrections-1293/fixtures/qaapp1293.*` into `apps/web/`, run
`fixtures/1295-browser.py` with Python Playwright and `/usr/bin/chromium`, then
remove the temporary web fixtures before lint/build. The script uses `/workspace/jarvis`
as its output root. It intercepts only the local sign-in module and
`http://fixture.invalid` requests; no production account/backend is contacted.
No registry, security or CI settings change.

## Limits

The focus fallback intentionally reserves typing space even if a hardware keyboard
is used and no software-keyboard inset can be measured. Focus departure from the composer/options or observed
viewport expansion restores ordinary navigation. A keyboard dismissed without either
an expansion or blur cannot be identified reliably from these browser signals.
Physical iPhone acceptance remains required; no browser mode is inferred from the
owner image. The current Library helper returned `library file transfer failed:
download failed` (exit 1) for the private screenshot, with no HTTP diagnostic and
no returned workspace path. This executor did not inspect those pixels; the parent
reviewers did. There was no alternate transfer route or private screenshot upload.
