# Mobile Chat-only composer #1303

Actual App in Chromium mobile emulation, synthetic authentication/API responses,
390px width. No private owner screenshots, real camera, microphone or production
account are used. Desktop behavior is also asserted at 1440px.

## Combined-tree validation

Revalidated after merging main `83563177288aafccf8cee63f9f941ac3f6fed02c`,
including attachment #1308, preview #1312 and continuous dictation #1310.
Runtime changes from this branch remain confined to composer visibility, focus
and clearance. Exact final-head local and hosted results are recorded in PR #1307.

The hidden/positioned cascade is also checked in the real browser: the ordinary
phone provider supplies no position, but a defensive state with both `hidden`
and `data-positioned` must still compute `display: none` with zero layout rects.
The old rule order reproduced `display: block`; moving the hidden rule after
the positioned rule fixes it without changing positioning behavior.

## Scope and behavior

Use `/` plus closed Workspaces pane state. On phone screens other than
Chat, the message composer slot is hidden and the chat viewport hook is disabled.
The conversation stays mounted to preserve drafts, attachments and session state.
Hidden-input autofocus is suppressed; leaving while focused blurs it. The slot is
remeasured and off-Chat pages reserve navigation clearance only. Desktop is unchanged. Voice sessions remain mounted internally, but their
composer controls are also visible only on Chat. Workspaces hides the composer even while the route remains `/`; Menu stays an
overlay with the composer visible. Camera preview styling is untouched.

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
Workspaces open/close and return through Chat are checked using the actual pane
and navigation buttons; both Menu overlays retain the composer. The mobile route regression failed on released main before the change, while its
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
