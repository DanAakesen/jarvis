# Desktop composer verification (#1309)

Synthetic screenshots and measurements of the actual App, not private user data.
The fixture supplies sign-in, HTTP responses and browser speech recognition. The
existing WebGL fallback is rendered; no microphone or live service is contacted.

## Reproduce

From the repository root with web dependencies, Python Playwright and Chromium:

```sh
cp docs/ui/screenshots/1301/fixtures/qaapp1301.tsx apps/web/
cp docs/ui/screenshots/1301/fixtures/qaapp1301.html apps/web/
npm run dev --workspace @jarvis/web -- --host 0.0.0.0 --port 5174
# Separate shell, from the repository root:
python3 docs/ui/screenshots/1309/fixtures/browser.py
rm apps/web/qaapp1301.tsx apps/web/qaapp1301.html
```

## Rendered results

1440×1000 and 900×800 desktop: normal, keyboard-resized, maximized and restored
chat/composer left and right edges match within 2px. Resized widths are 868px and
765px, exceeding the old 740px inner cap. Positioned states keep the existing
2px seam overlap. The unpositioned default layout includes the existing WebGL
fallback notice between history and composer; its extra clearance is unrelated
to the fixed-wrapper width bug. Desktop rail remains visible.

Each state opens and closes Plus three times with animation allowed to settle.
Every enabled menu button passes `elementFromPoint` hit testing, including when
the conversation is maximized. Clicking Attach opens the actual file chooser.
The full-width draft sits above Plus, Dictate and Send. Dictate starts, accepts
synthetic recognized speech into the unsent draft and stops. Uploaded attachment
pills sit above the draft inside the glass; unsupported-file feedback sits above
the glass. 390×844 phone coverage repeats the controls/rows with reduced motion.
There are no browser page errors. Normal desktop and phone attachment captures
were visually inspected; the maximized popup was also inspected.

`measurements.json` records bounds and assertion outcomes. Screenshots contain
only the synthetic fixture message/files. Existing timestamp layout is retained.
These checks do not establish physical-device, WebKit, real microphone or live
provider acceptance. The fixture recognition adapter has a synthetic stop event;
continuous dictation behavior belongs to #1305 and must survive integration.

## Local qualification

- `npm ci --ignore-scripts --workspace @jarvis/web --workspace @jarvis/contracts --cache /tmp/jarvis-npm-1309 --no-audit --no-fund`: passed.
- `npm run lint --workspace @jarvis/contracts --workspace @jarvis/web`: passed.
- `npm run build --workspace @jarvis/contracts --workspace @jarvis/web`: passed; existing Vite large-chunk advisory.
- `npm test --workspace @jarvis/web`: 153 files / 2,370 tests passed.
- `npm test --workspace @jarvis/contracts --workspace @jarvis/web`: web passed; contracts blocked by missing backend `fastify` (131 contracts cases passed, one file could not load).
- `npm run lint`: passed across all four workspaces.
- `npm run build`: contracts/web passed; backend/vault-mirror failed on missing packages after the blocked full install.
- `npm test`: interrupted before completion to restore dependencies; contracts could not load `fastify`, and the concurrent web run hit one contrast-test timeout. The separate full web run passed.
- `python3 docs/ui/screenshots/1309/fixtures/browser.py`: passed on final production code.
- `PYTHONPATH=.github/scripts python3 -m unittest discover -s .github/scripts/tests -v`: 144 tests, 141 passed; three setup-vault-mirror checks could not run because `pwsh` is absent.
- `GITHUB_OUTPUT=/tmp/1309-impact-output python3 .github/scripts/pipeline_impact.py --base origin/main`: selects Web and shared Python checks.

The initial full workspace install failed with HTTP 403 for unchanged backend
`pkce-challenge@5.0.1` from the Microsoft package feed. No lockfile, registry or
TLS settings changed. Full install still failed after caching the public npm tarball; the locked feed
URL remained unavailable. Aggregate results above are not a clean qualification.
Affected web checks run independently. Local Node 24.19.0 /
npm 11.9.0 differs from CI Node 22 / npm 10. Draft CI intentionally skips full
qualification. The coordinator owns latest-main integration, exact-head CI,
review, merge and deployment.
