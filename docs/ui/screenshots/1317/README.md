# Unified camera delivery (#1317)

Enable video now owns automatic sampled JPEG delivery. Camera-specific Watch and
Look menu actions are removed. The UI confirms receiving only after backend
acceptance. Typed and spoken keep-describing requests set a standing narration
flag; ordinary camera awareness remains quiet. Stop, session transitions,
permission/capture failures and exhausted budgets preserve existing controls.
The ten-minute user-inactivity cutoff is unchanged and limits “until I tell you
to stop”; changing it needs a separate decision.

## Local evidence

- Final `npm test`: contracts 174 passed; web 153 files/2,388 passed; backend
  297 files/6,683 passed with one skipped; vault mirror 13 files/237 passed.
- Focused backend before review: 7 files, 161 tests passed (`vision`, capability instructions,
  visual context and tool parity). Covers typed and spoken tool dispatch,
  repeated unchanged observations, acknowledgement before/after frame arrival,
  busy voice dropping, feed generation stop, authorization and budget limits.
- `bash .github/scripts/python-ci.sh agents/jarvis`: Ruff, 929 tests and
  byte compilation passed.
- `npm run lint` and `npm run build`: all four workspaces passed. Build includes
  TypeScript checks; Vite retains its existing large-chunk advisory.
- Actual-App synthetic Chromium: 390×844 and 320×700 touch, 1440×1000 desktop.
  Four frames arrived in each viewport, including recovery after a deliberately
  stalled request; zero after preview Close. Receiving status expired after 15
  seconds and returned only after a fresh accepted response.
  The separate camera-watch action is absent, receipt status is visible, budget
  exhaustion turns capture off, and denied permission leaves no active stream.
  No page errors. `measurements.json` records the counts. PNGs contain only a
  generated canvas camera and synthetic conversation, never private screenshots.

Initial checks exposed stale test expectations, a prompt-length budget overrun
and an unavailable tool name in the generic capability prompt. These were fixed
without weakening limits. One concurrent focused run hit an existing one-second
wait timeout; its isolated rerun passed. The first full `npm test` included those
pre-fix failures and an unrelated synthetic Azurite startup failure; its isolated
rerun passed all 36 tests. The final aggregate rerun passed all four workspaces as listed above.

## Reproduce browser checks

From the repository root, with Python Playwright and `/usr/bin/chromium`:

```sh
cp docs/ui/screenshots/1296/fixtures/qaapp1296.* apps/web/
npm run dev --workspace @jarvis/web -- --host 0.0.0.0
# In another terminal:
python docs/ui/screenshots/1317/fixtures/browser.py
rm apps/web/qaapp1296.tsx apps/web/qaapp1296.html
```

The fixture uses synthetic sign-in, local HTTP responses and a canvas stream,
and disables WebGL. Inspect the app at desktop/touch widths, repeated menu
input, status text, permission denial and budget-stop recovery. Existing
surfaces and motion are retained; this is not GPU or hardware-camera acceptance.

## Limits

Local Node 24.19.0/npm 11.9.0 differ from CI's Node 22/npm 10. Initial npm install
failed on a lockfile Azure package-feed URL (403); installation succeeded using
the same integrity-checked versions from public npm and the lockfile was restored.
Physical iPhone/WebKit, live camera/microphone, actual model intent selection,
model narration and deployment are unverified. SQL integration and hosted
exact-head CI require the repository CI environment. Draft PRs deliberately
skip aggregate CI; parent coordinates readiness, integration and deployment.

Review follow-up: receiving status expires 15 seconds after the last accepted
frame and clears on request failure, with delayed/retrying feedback while the
bounded loop recovers. Camera startup and typed turns share one pending session
creation. A matching feed stop aborts pending plain-text comment writes through
the existing SQL cancellation helper and rechecks state after awaits. A database
write already committed before cancellation remains transcript history; stop
does not delete historical messages. Old feed-generation DELETEs cannot stop a
replacement feed. No database schema change.

Review regressions: web focus passed 107 tests, backend focus passed 187 tests,
the feed-generation/pending-write checks passed 51 tests, final freshness checks
passed 10 tests, and the final camera-service guard suite passed 26 tests. The
aggregate counts above include these regressions. Final lint and build passed
across all four workspaces.
