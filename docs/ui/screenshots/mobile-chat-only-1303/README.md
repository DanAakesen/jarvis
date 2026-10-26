# Mobile Chat-only composer #1303

Actual App in Chromium mobile emulation, synthetic authentication/API responses,
390px width. No private owner screenshots, real camera, microphone or production
account are used. Desktop behavior is also asserted at 1440px.

## Scope and behavior

Use the same `/` predicate as the Chat navigation link. On phone routes other than
Chat, the message composer slot is hidden and the chat viewport hook is disabled.
The conversation stays mounted to preserve drafts, attachments and session state.
Hidden-input autofocus is suppressed; leaving while focused blurs it. The slot is
remeasured and off-Chat pages reserve navigation clearance only. Desktop and active
voice controls retain their previous behavior. Workspaces and Menu remain overlays
on the current route, not new page routes. Camera preview styling is untouched.

## Checks and inspected screenshots

- `chat-390.png`: Chat has the composer and normal bottom navigation at startup.
- `settings-390.png`: route changed while typing; composer hidden, focus released,
  keyboard attribute removed, composer height zero, navigation available.
- `usage-390.png`: opened via Menu, with no composer visible.
- `health-390.png`: opened via the Health navigation link, with no composer visible.
- `returned-typing-390.png`: Chat selected again; draft intact. All viewport heights
  shrink to 480px, navigation hides, composer bottom remains 472px. Expansion restores
  navigation. Direct Settings startup also avoids hidden input focus. Resizing to
  desktop leaves the original off-Chat composer behavior intact.

All five images were visually inspected. `measurements.json` records each state,
including zero page errors. Settings, Usage and Health show existing data-error
panels because this limited navigation fixture intentionally supplies minimal
synthetic responses; these are not live-backend failures or content validation.
The mobile route regression failed on released main before the change, while its
desktop counterpart passed. Final focused/full test counts and lint/build outcomes
are in the PR receipt.

## Reproduction

With the existing web/contracts installation and Vite on port 5173, temporarily
copy `fixtures/qa1303.html` and `fixtures/qa1303.tsx` into `apps/web/`. Run
`python docs/ui/screenshots/mobile-chat-only-1303/fixtures/browser.py`, then remove
the two temporary files before lint/build. Requires Python Playwright and
`/usr/bin/chromium`. Output root is `/workspace/jarvis`.

The fixture uses real App components and router actions, plus actual mobile Menu,
Health and Chat links. A route helper exercises leaving while the keyboard state
is active without relying on tapping a navigation bar hidden by the keyboard.
Synthetic Chromium is not physical iPhone acceptance. Native attachment-picker
behavior is outside this change.
